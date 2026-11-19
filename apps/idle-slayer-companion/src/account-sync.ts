import { APIError, createAccountClient, getSession, refreshSession, subscribeSession, type AccountSession, type RemoteDocument } from '../../../packages/accounts/client'
import { ACTIVE_ACCOUNT_KEY, accountKey, accountPersistence, captureRaw, documentKeys, documents, guestPersistence, rawForDocuments, readBundle, readDocuments, sameRaw, sameState, setRawDocument, validateDocument, writeBundle, type AccountBundle, type CompanionPersistence, type DocumentName, type RawDocuments } from './account-storage'
import type { ProfileLocks } from './domain/profile-session'
import { createAccountRepository, type AccountRepository } from './account-repository'

const APP = 'idle-slayer-companion'
type MigrationPreview = { migrationId: string; raw: RawDocuments; device: Record<DocumentName, unknown>; remote: Record<DocumentName, RemoteDocument | null>; choices: Record<DocumentName, 'device' | 'account' | null>; prepared?: boolean }
type MigrationJournal = MigrationPreview & { version: 1; accountId: string; clientId: string; selected: Record<DocumentName, unknown>; phase: 'prepared' | 'committed' | 'complete' }
const journalKey = (id: string) => accountKey(id) + '.migration.v1'
export interface SyncView { session: AccountSession | null; accountId: string | null; mount: number; status: string; busy: boolean; loading: boolean; preview: MigrationPreview | null; conflicts: DocumentName[] }
export function createCompanionAccountSync(options: { revision: string; storage: Storage; accountStorage?: AccountRepository; locks: () => ProfileLocks | undefined; uuid: () => string; enabled: boolean }) {
  let disposed = false, epoch = 0, running = false, timer: ReturnType<typeof setTimeout> | undefined
  let startup = 0, sessionWork = Promise.resolve(), unsubscribeStorage = () => {}
  const accountStorage = options.accountStorage ?? createAccountRepository()
  let view: SyncView = { session: null, accountId: null, mount: 0, status: 'Opening saved account data…', busy: false, loading: options.enabled, preview: null, conflicts: [] }
  const listeners = new Set<() => void>()
  let persistence: CompanionPersistence = guestPersistence()
  function publish(patch: Partial<SyncView>) { if (!disposed) { view = { ...view, ...patch }; listeners.forEach((listener) => listener()) } }
  function valid(id: string, ticket: number) { return !disposed && ticket === epoch && view.session?.enabled && view.session.user?.id === id }
  function ensureVisitSaved() {
    const visits = persistence.visitStates()
    if (!Object.keys(visits).length) return
    const raw = view.accountId ? readBundle(accountStorage, view.accountId)?.raw : captureRaw(options.storage)
    if (!raw) throw new Error('The current account copy could not be read. Export this visit before changing accounts.')
    const saved = readDocuments(raw, options.revision)
    if (documents.some((name) => name in visits && !sameState(validateDocument(name, visits[name], options.revision), saved[name]))) throw new Error('This visit has unsaved changes. It was kept open. Export or recover them with the existing backup controls before changing accounts or connecting data.')
  }
  function activate(id: string | null, persist = true) {
    if (view.accountId === id) return
    ensureVisitSaved()
    if (persist) { if (id) options.storage.setItem(ACTIVE_ACCOUNT_KEY, id); else options.storage.removeItem(ACTIVE_ACCOUNT_KEY) }
    epoch++
    persistence = id ? accountPersistence({ id, revision: options.revision, storage: accountStorage, locks: options.locks, uuid: options.uuid, changed: schedule }) : guestPersistence()
    publish({ accountId: id, mount: view.mount + 1, preview: null, busy: false, conflicts: [], status: id ? 'Account copy available on this device. Checking sync…' : 'Saved in this browser. Sign in to connect an account.' })
  }
  async function saveRecovery(id: string, raw: RawDocuments, label: string) {
    const key = accountKey(id) + '.recovery.' + options.uuid(), text = JSON.stringify({ version: 1, accountId: id, label, raw })
    await accountStorage.setItem(key, text)
    if (accountStorage.getItem(key) !== text) throw new Error('A recovery copy could not be verified. No saved copy was replaced.')
  }
  async function saveJournal(journal: MigrationJournal) {
    const text = JSON.stringify(journal); await accountStorage.setItem(journalKey(journal.accountId), text)
    if (accountStorage.getItem(journalKey(journal.accountId)) !== text) throw new Error('The prepared connection could not be saved. Browser originals remain active.')
  }
  function readJournal(id: string): MigrationJournal | null {
    const text = accountStorage.getItem(journalKey(id)); if (!text) return null
    const journal = JSON.parse(text) as MigrationJournal
    if (journal.version !== 1 || journal.accountId !== id || !journal.migrationId || !journal.clientId || !journal.selected || !journal.raw || !journal.device || !journal.remote || !journal.choices || !['prepared', 'committed', 'complete'].includes(journal.phase)) throw new Error('The prepared connection needs recovery. Browser originals were kept.')
    for (const name of documents) { validateDocument(name, journal.selected[name], options.revision); validateDocument(name, journal.device[name], options.revision) }
    return journal
  }
  async function locked<T>(id: string, callback: () => T | Promise<T>, allRecords = false): Promise<T> {
    const locks = options.locks(); if (!locks) throw new Error('Safe account saving is unavailable in this browser. Export a backup to keep this visit.')
    return locks.request(accountKey(id) + '.write', { mode: 'exclusive', ifAvailable: true }, async (lock) => { if (!lock) throw new Error('Another tab is saving. Retry when it finishes.'); await accountStorage.reload(allRecords ? undefined : accountKey(id)); return callback() })
  }
  async function importUnreleasedStorage(id: string) {
    await locked(id, async () => {
      const prefix = accountKey(id)
      for (let index = 0; index < options.storage.length; index++) {
        const key = options.storage.key(index)
        if (!key || !(key === prefix || key.startsWith(prefix + '.')) || accountStorage.getItem(key) !== null) continue
        const text = options.storage.getItem(key)
        if (text !== null) await accountStorage.setItem(key, text)
      }
    }, true)
  }
  function checkedRemote(name: DocumentName, remote: RemoteDocument): RemoteDocument {
    if (remote.app !== APP || remote.document !== name || remote.schemaVersion !== 1 || !remote.resourceId || !Number.isSafeInteger(remote.revision) || remote.revision < 1 || !Number.isSafeInteger(remote.acknowledgedSequence) || remote.acknowledgedSequence < 0) throw new Error('The account returned an unsupported document. Device data was kept.')
    validateDocument(name, remote.state, options.revision); return remote
  }
  function requireCurrentRevision(name: DocumentName, incoming: RemoteDocument, bundle: AccountBundle) {
    const known = [bundle.remote[name], bundle.conflicts[name]].filter((value): value is RemoteDocument => !!value).sort((a, b) => b.revision - a.revision)[0]
    if (!known) return
    if (incoming.resourceId !== known.resourceId) throw new Error('The account document identity changed. Device data and pending changes were kept for recovery.')
    if (incoming.revision < known.revision) throw new Error('An older account response was ignored. The newer device copy was kept; retry sync.')
    if (incoming.revision === known.revision && !sameState(validateDocument(name, incoming.state, options.revision), validateDocument(name, known.state, options.revision))) throw new Error('The same account revision returned different data. Device data was kept for recovery.')
  }
  function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => { void sync() }, 300) }
  async function sync() {
    const id = view.accountId, ticket = epoch
    if (!id || !valid(id, ticket) || running || view.busy) return
    const locks = options.locks(); if (!locks) return
    running = true
    try {
      await locks.request(accountKey(id) + '.sync', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock || !valid(id, ticket)) return
        const client = createAccountClient(id)
        for (const name of documents) {
          if (!valid(id, ticket)) return
          await locked(id, () => {})
          let bundle = readBundle(accountStorage, id); if (!bundle) throw new Error('Account data is unavailable on this device.')
          if (bundle.conflicts[name]) continue
          const pending = bundle.pending[name]
          let remote: RemoteDocument | null
          try {
            remote = pending ? await client.writeDocument({ app: APP, document: name, schemaVersion: 1, ...pending, clientId: bundle.clientId }) : await client.getDocument(APP, name, bundle.clientId)
          } catch (error) {
            if (!valid(id, ticket)) return
            if (error instanceof APIError && error.status === 409 && error.remote) {
              const conflict = checkedRemote(name, error.remote)
              await locked(id, async () => { if (!valid(id, ticket)) return; bundle = readBundle(accountStorage, id)!; requireCurrentRevision(name, conflict, bundle); bundle.conflicts[name] = conflict; await writeBundle(accountStorage, bundle!) })
              continue
            }
            throw error
          }
          if (!valid(id, ticket)) return
          if (!remote) { if (bundle.remote[name]) throw new Error('A saved account document is unavailable. Device data was kept.'); continue }
          const acknowledged = checkedRemote(name, remote)
          let changed = false
          await locked(id, async () => {
            if (!valid(id, ticket)) return
            bundle = readBundle(accountStorage, id)!
            requireCurrentRevision(name, acknowledged, bundle)
            const current = bundle.pending[name]
            if (pending) {
              if (acknowledged.acknowledgedSequence < pending.mutationSequence) throw new Error('The sync acknowledgement could not be verified. The saved mutation remains queued.')
              // A replay can return a newer cloud revision written elsewhere
              // after our original commit. It is a conflict, never permission
              // to overwrite that newer account state with our local tail.
              if (!sameState(validateDocument(name, pending.state, options.revision), validateDocument(name, acknowledged.state, options.revision))) bundle.conflicts[name] = acknowledged
              else if (current?.operationId === pending.operationId) {
                bundle.remote[name] = acknowledged
                const latest = readDocuments(bundle.raw, options.revision)[name]
                if (sameState(latest, validateDocument(name, acknowledged.state, options.revision))) delete bundle.pending[name]
                else bundle.pending[name] = { operationId: options.uuid(), mutationSequence: acknowledged.acknowledgedSequence + 1, baseRevision: acknowledged.revision, state: latest, ...(bundle.preservePrevious?.[name] ? { preservePrevious: true } : {}) }
                if (bundle.preservePrevious) delete bundle.preservePrevious[name]
              }
            } else if (current) {
              if (current.baseRevision !== acknowledged.revision) bundle.conflicts[name] = acknowledged
            } else {
              const local = readDocuments(bundle.raw, options.revision)[name], prior = bundle.remote[name]
              if (prior && !sameState(local, validateDocument(name, prior.state, options.revision))) bundle.conflicts[name] = acknowledged
              else { setRawDocument(bundle.raw, name, acknowledged.state, options.revision); bundle.remote[name] = acknowledged; changed = true }
            }
            await writeBundle(accountStorage, bundle)
          })
          if (changed) persistence.refresh()
        }
        if (!valid(id, ticket)) return
        const bundle = readBundle(accountStorage, id)!, conflicts = documents.filter((name) => !!bundle.conflicts[name]), pending = documents.some((name) => !!bundle.pending[name])
        publish({ conflicts, status: conflicts.length ? 'Sync needs review. Both account and device copies are kept.' : pending ? 'Changes saved on this device. Waiting to sync.' : 'Account changes synced. Device backups remain available.' })
        if (pending && !conflicts.length) schedule()
      })
    } catch (error) {
      if (error instanceof APIError && (error.status === 401 || error.code === 'account_changed')) void refreshSession().catch(() => undefined)
      if (valid(id, ticket)) publish({ status: error instanceof Error ? error.message : 'Sync could not finish. Saved changes remain on this device.' })
    } finally { running = false }
  }
  function receiveSession(session: AccountSession) {
    if (disposed) return Promise.resolve()
    const previous = view.session?.user?.id, id = session.enabled ? session.user?.id ?? null : null
    publish({ session })
    if (previous !== id) { epoch++; publish({ busy: false, preview: null }) }
    const ticket = epoch
    sessionWork = sessionWork.catch(() => {}).then(async () => {
      if (disposed || ticket !== epoch) return
      try {
        if (!id) { activate(null); publish({ status: 'Saved in this browser. Sign in to connect an account.' }); return }
        await importUnreleasedStorage(id)
        if (!valid(id, ticket)) return
        const bundle = readBundle(accountStorage, id)
        if (bundle) { readDocuments(bundle.raw, options.revision); activate(id); schedule() }
        else { activate(null); publish({ status: 'Signed in. Review your saved browser and account copies before connecting.' }) }
      } catch (error) { if (!disposed && ticket === epoch) publish({ status: error instanceof Error ? error.message : 'Account storage is unavailable. Browser originals were kept.' }) }
    })
    return sessionWork
  }
  let unsubscribe = () => {}
  async function start() {
    disposed = false
    if (!options.enabled) return
    const ticket = ++startup
    try {
      await accountStorage.reload()
      if (disposed || ticket !== startup) return
      const cachedId = options.storage.getItem(ACTIVE_ACCOUNT_KEY)
      if (cachedId) {
        await importUnreleasedStorage(cachedId)
        if (disposed || ticket !== startup) return
        const bundle = readBundle(accountStorage, cachedId)
        if (bundle) { readDocuments(bundle.raw, options.revision); activate(cachedId, false) }
      }
      unsubscribeStorage(); unsubscribeStorage = accountStorage.subscribe(() => { void refreshExternal() })
      unsubscribe(); unsubscribe = subscribeSession((session) => { void receiveSession(session) })
      publish({ loading: false })
      try { await receiveSession(await getSession()) }
      catch { if (!disposed && ticket === startup) publish({ status: view.accountId ? 'Offline account copy. Changes stay on this device until sign-in can be checked.' : 'Accounts are unavailable. Existing browser saves and backups still work.' }) }
    } catch (error) { if (!disposed && ticket === startup) publish({ loading: false, status: error instanceof Error ? error.message : 'Account device storage is unavailable. Browser originals and existing backup tools remain available.' }) }
  }
  async function reviewMigration() {
    const id = view.session?.user?.id, ticket = epoch
    if (!id || !view.session?.migrationEnabled || view.busy) return
    publish({ busy: true, preview: null })
    try {
      ensureVisitSaved()
      await locked(id, () => {}, true)
      if (!valid(id, ticket)) return
      const journal = readJournal(id)
      if (journal && journal.phase !== 'complete') { publish({ preview: { ...journal, prepared: true }, status: 'A prepared connection was recovered. Retry it to verify the same migration without replacing browser originals.' }); return }
      const raw = captureRaw(options.storage), device = readDocuments(raw, options.revision)
      const client = createAccountClient(id), clientId = options.uuid()
      const results = await Promise.all(documents.map((name) => client.getDocument(APP, name, clientId)))
      if (!valid(id, ticket)) return
      const remote = Object.fromEntries(documents.map((name, index) => [name, results[index] ? checkedRemote(name, results[index]!) : null])) as MigrationPreview['remote']
      const present = (name: DocumentName) => raw[documentKeys[name]] !== null || (name === 'progress' && raw['idle-slayer-ascension-map.profile.v1'] !== null) || (name === 'intentions' && raw['idle-slayer-ascension-map.goals.v1'] !== null)
      const choices = Object.fromEntries(documents.map((name) => [name, remote[name] && !present(name) ? 'account' : !remote[name] || sameState(device[name], validateDocument(name, remote[name]!.state, options.revision)) ? 'device' : null])) as MigrationPreview['choices']
      publish({ preview: { migrationId: options.uuid(), raw, device, remote, choices }, status: 'Review each document. Original browser saves and both account choices will be retained.' })
    } catch (error) { if (valid(id, ticket)) publish({ status: error instanceof Error ? error.message : 'Saved data could not be reviewed. Nothing was replaced.' }) }
    finally { if (valid(id, ticket)) publish({ busy: false }) }
  }
  function choose(name: DocumentName, choice: 'device' | 'account') { if (view.preview && !view.busy && !view.preview.prepared) publish({ preview: { ...view.preview, choices: { ...view.preview.choices, [name]: choice } } }) }
  async function adopt() {
    const id = view.session?.user?.id, ticket = epoch, preview = view.preview
    if (!id || !preview || view.busy || documents.some((name) => !preview.choices[name])) return
    publish({ busy: true })
    try {
      ensureVisitSaved()
      if (!sameRaw(preview.raw, captureRaw(options.storage))) throw new Error('Browser data changed during review. Review the current copies again.')
      const journal = await locked(id, async () => {
        if (!valid(id, ticket)) throw new Error('The account changed. Browser originals remain active.')
        const existing = readJournal(id)
        if (existing && existing.phase !== 'complete') {
          if (existing.migrationId !== preview.migrationId) throw new Error('Another tab prepared this account connection. Cancel this preview and review its saved attempt before continuing.')
          return existing
        }
        if (!valid(id, ticket)) throw new Error('The account changed. Browser originals remain active.')
        await saveRecovery(id, preview.raw, 'Before first account connection')
        if (!valid(id, ticket)) throw new Error('The account changed. Browser originals remain active.')
        const selected = Object.fromEntries(documents.map((name) => [name, preview.choices[name] === 'account' ? preview.remote[name]!.state : preview.device[name]])) as Record<DocumentName, unknown>
        const prepared: MigrationJournal = { ...preview, version: 1, accountId: id, clientId: options.uuid(), selected, phase: 'prepared', prepared: true }
        await saveJournal(prepared); return prepared
      }, true)
      if (!valid(id, ticket)) return
      publish({ preview: { ...journal, prepared: true } })
      const client = createAccountClient(id), selected = journal.selected, clientId = journal.clientId
      if (journal.phase === 'prepared') {
        for (const name of documents) {
          if (!valid(id, ticket)) return
          const baseRevision = journal.remote[name]?.revision ?? 0
          await client.stageMigration({ migrationId: journal.migrationId, app: APP, document: name, variant: 'device', schemaVersion: 1, state: journal.device[name], baseRevision })
          if (!valid(id, ticket)) return
          await client.stageMigration({ migrationId: journal.migrationId, app: APP, document: name, variant: 'selected', schemaVersion: 1, state: selected[name], baseRevision })
        }
      }
      if (!valid(id, ticket)) return
      await client.commitMigration({ migrationId: journal.migrationId, app: APP, clientId, documents: documents.map((name) => ({ document: name, baseRevision: journal.remote[name]?.revision ?? 0 })) })
      if (!valid(id, ticket)) return
      journal.phase = 'committed'; await saveJournal(journal)
      if (!valid(id, ticket)) return
      const results = await Promise.all(documents.map((name) => client.getDocument(APP, name, clientId)))
      if (!valid(id, ticket)) return
      const remote: AccountBundle['remote'] = {}
      for (const [index, name] of documents.entries()) {
        const document = results[index]; if (!document) throw new Error('An account document could not be read back. Browser originals remain active.')
        checkedRemote(name, document)
        if (!sameState(validateDocument(name, selected[name], options.revision), validateDocument(name, document.state, options.revision))) throw new Error('The account changed during connection. Browser originals remain active; review both copies again.')
        remote[name] = document
      }
      if (!sameRaw(preview.raw, captureRaw(options.storage))) throw new Error('Browser data changed while connecting. It remains active. Review the current copies again.')
      let activated = false
      await locked(id, async () => {
        if (!valid(id, ticket)) return
        if (!readBundle(accountStorage, id)) await writeBundle(accountStorage, { version: 1, accountId: id, clientId, raw: rawForDocuments(selected, options.revision), remote, pending: {}, conflicts: {} })
        journal.phase = 'complete'; await saveJournal(journal)
        if (!valid(id, ticket)) return
        activate(id)
        activated = true
      })
      if (!activated || disposed || view.accountId !== id || view.session?.user?.id !== id) return
      publish({ status: 'Connected and verified all four documents. Original browser saves were kept.', busy: false }); schedule()
    } catch (error) { if (valid(id, ticket)) publish({ status: error instanceof Error ? error.message : 'Connection could not finish. Browser originals remain active.', busy: false }) }
  }
  async function resolve(name: DocumentName, choice: 'device' | 'account') {
    const id = view.accountId, ticket = epoch
    if (!id || !valid(id, ticket) || view.busy) return
    publish({ busy: true })
    try {
      ensureVisitSaved()
      await locked(id, () => {})
      if (!valid(id, ticket)) return
      const before = readBundle(accountStorage, id)!, remote = before.conflicts[name]
      if (!remote) return
      const device = readDocuments(before.raw, options.revision)[name], selected = choice === 'device' ? device : remote.state, migrationId = options.uuid(), client = createAccountClient(id)
      await saveRecovery(id, before.raw, 'Before resolving ' + name)
      for (const variant of ['device', 'selected'] as const) {
        if (!valid(id, ticket)) return
        await client.stageMigration({ migrationId, app: APP, document: name, variant, schemaVersion: 1, state: variant === 'device' ? device : selected, baseRevision: remote.revision })
      }
      if (!valid(id, ticket)) return
      await client.commitMigration({ migrationId, app: APP, clientId: before.clientId, purpose: 'conflict', documents: [{ document: name, baseRevision: remote.revision }] })
      const result = await client.getDocument(APP, name, before.clientId)
      if (!valid(id, ticket)) return
      if (!result || !sameState(validateDocument(name, checkedRemote(name, result).state, options.revision), validateDocument(name, selected, options.revision))) throw new Error('The account changed during review. Both copies remain available.')
      await locked(id, async () => {
        if (!valid(id, ticket)) return
        const bundle = readBundle(accountStorage, id)!
        requireCurrentRevision(name, result, bundle)
        if (bundle.raw[documentKeys[name]] !== before.raw[documentKeys[name]]) { bundle.conflicts[name] = result; await writeBundle(accountStorage, bundle); throw new Error('Device data changed during review. Review the newer copies again.') }
        setRawDocument(bundle.raw, name, result.state, options.revision); bundle.remote[name] = result; delete bundle.pending[name]; delete bundle.conflicts[name]
        if (bundle.preservePrevious) delete bundle.preservePrevious[name]
        await writeBundle(accountStorage, bundle)
      })
      if (!valid(id, ticket)) return
      persistence.refresh(); publish({ conflicts: documents.filter((name) => !!readBundle(accountStorage, id)!.conflicts[name]), status: 'Conflict resolved. Recovery copies of both versions were retained.' })
    } catch (error) {
      if (valid(id, ticket) && error instanceof APIError && error.status === 409 && error.remote) {
        const conflict = checkedRemote(name, error.remote)
        try { await locked(id, async () => { if (!valid(id, ticket)) return; const bundle = readBundle(accountStorage, id)!; requireCurrentRevision(name, conflict, bundle); bundle.conflicts[name] = conflict; await writeBundle(accountStorage, bundle) }) }
        catch (storageError) { if (valid(id, ticket)) publish({ status: storageError instanceof Error ? storageError.message : 'Conflict storage could not be updated. The saved copies were kept.' }); return }
      }
      if (valid(id, ticket)) publish({ status: error instanceof Error ? error.message : 'Conflict review could not finish. Both copies were kept.' })
    }
    finally { if (valid(id, ticket)) { publish({ busy: false }); schedule() } }
  }
  async function refreshExternal() {
    const id = view.accountId, ticket = epoch
    if (!id || disposed) return
    try { await locked(id, () => {}); if (disposed || ticket !== epoch) return; persistence.refresh(); const bundle = readBundle(accountStorage, id); publish({ conflicts: documents.filter((name) => !!bundle?.conflicts[name]) }); schedule() } catch { publish({ status: 'Saved account data could not be read. Export this visit before closing it.' }) }
  }
  async function restartReview() {
    const id = view.session?.user?.id, ticket = epoch
    if (!id || view.busy) return
    try {
      await locked(id, async () => {
        if (!valid(id, ticket)) return
        const text = accountStorage.getItem(journalKey(id))
        if (text !== null) {
          const recoveryKey = accountKey(id) + '.recovery.' + options.uuid()
          await accountStorage.setItem(recoveryKey, text)
          if (accountStorage.getItem(recoveryKey) !== text) throw new Error('The prepared connection could not be preserved. Retry its existing verification.')
          await accountStorage.removeItem(journalKey(id))
        }
      }, true)
      if (!valid(id, ticket)) return
      publish({ preview: null }); await reviewMigration()
    } catch (error) { publish({ status: error instanceof Error ? error.message : 'The prepared connection was kept.' }) }
  }
  return {
    getState: () => view, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getPersistence: () => persistence,
    start, sync, reviewMigration, choose, adopt, resolve, refreshExternal, restartReview, recheckSession: () => refreshSession().then(receiveSession), cancelReview: () => { if (!view.busy) publish({ preview: null }) },
    exportOriginals: () => {
      const owner = view.session?.user?.id, prefix = owner && (!view.accountId || owner === view.accountId) ? accountKey(owner) : null
      const recovery = prefix ? [...Array(accountStorage.length)].map((_, index) => accountStorage.key(index)).filter((key): key is string => !!key && (key.startsWith(prefix + '.recovery.') || key === prefix + '.migration.v1')).map((key) => ({ key, value: accountStorage.getItem(key) })) : []
      return JSON.stringify({ version: 1, raw: captureRaw(options.storage), visit: !view.accountId || view.accountId === owner ? persistence.visitStates() : {}, recovery }, null, 2)
    },
    exportAccount: () => view.accountId ? JSON.stringify({ sourceAccountId: view.accountId, bundle: readBundle(accountStorage, view.accountId), visit: persistence.visitStates() }, null, 2) : null,
    dispose: () => { disposed = true; epoch++; startup++; unsubscribe(); unsubscribeStorage(); accountStorage.close(); if (timer) clearTimeout(timer) },
  }
}
export type CompanionAccountSync = ReturnType<typeof createCompanionAccountSync>
