import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountSession, RemoteDocument } from '../../../packages/accounts/client'
import { IDBFactory } from 'fake-indexeddb'
const mocked = vi.hoisted(() => ({ session: null as AccountSession | null, listener: null as ((value: AccountSession) => void) | null, read: vi.fn(), write: vi.fn(), stage: vi.fn(), commit: vi.fn(), bound: vi.fn(), sessionReads: vi.fn(), refreshReads: vi.fn() }))
vi.mock('../../../packages/accounts/client', async () => {
  const actual = await vi.importActual<typeof import('../../../packages/accounts/client')>('../../../packages/accounts/client')
  return { ...actual, getSession: async () => { mocked.sessionReads(); return mocked.session }, refreshSession: async () => { mocked.refreshReads(); return mocked.session }, subscribeSession: (listener: (value: AccountSession) => void) => { mocked.listener = listener; return () => { mocked.listener = null } }, createAccountClient: (id: string) => { mocked.bound(id); return { getDocument: mocked.read, writeDocument: mocked.write, stageMigration: mocked.stage, commitMigration: mocked.commit } } }
})
import { createCompanionAccountSync, type CompanionAccountSync } from './account-sync'
import { ACTIVE_ACCOUNT_KEY, accountKey, captureRaw, documentKeys, documents, rawForDocuments, readBundle, writeBundle, type AccountBundle, type DocumentName } from './account-storage'
import { emptyCompanionProgress } from './domain/companion-progress'
import { createAccountRepository, type AccountRepository } from './account-repository'

function memoryStorage(): Storage { const map = new Map<string, string>(); return { get length() { return map.size }, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value) }, removeItem: (key) => { map.delete(key) }, clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null } }
function states() { return { progress: emptyCompanionProgress('test'), intentions: { format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: {} }, checkpoints: { kind: 'progress-checkpoints', version: 1, entries: [] }, comparison: { kind: 'upgrade-comparison', version: 1, ids: [] } } }
function remote(name: DocumentName, state: unknown, revision = 1, acknowledgedSequence = 0): RemoteDocument { return { resourceId: 'resource-' + name, app: 'idle-slayer-companion', document: name, schemaVersion: 1, revision, state, acknowledgedSequence } }
const locks = { request: async <T>(_name: string, _options: unknown, callback: (lock: unknown) => T) => callback({}) }
const active: CompanionAccountSync[] = []
function memoryRepository(storage: Storage): AccountRepository { return { get length() { return storage.length }, key: (index) => storage.key(index), getItem: (key) => storage.getItem(key), setItem: (key, value) => storage.setItem(key, value), removeItem: (key) => storage.removeItem(key), reload: async () => {}, subscribe: () => () => {}, close: () => {} } }
function make(storage = memoryStorage(), accountStorage = memoryRepository(storage)) { let seq = 0; const controller = createCompanionAccountSync({ revision: 'test', storage, accountStorage, locks: () => locks, uuid: () => 'uuid-' + ++seq, enabled: true }); active.push(controller); return controller }
async function start(controller: CompanionAccountSync) { await controller.start() }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mocked.session = { enabled: true, migrationEnabled: true, user: { id: 'A', email: 'private@example.test' }, csrfToken: 'csrf' }
  mocked.read.mockResolvedValue(null); mocked.stage.mockResolvedValue({ staged: true }); mocked.commit.mockResolvedValue({ documents: [] })
})
afterEach(() => { active.splice(0).forEach((controller) => controller.dispose()); vi.useRealTimers() })

describe('recoverable account migration and sync', () => {
  it('connects all four documents only after durable originals, atomic commit and checked readback', async () => {
    const storage = memoryStorage(), original = states(); storage.setItem(documentKeys.progress, JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: original.progress }))
    const before = captureRaw(storage), server = new Map<string, RemoteDocument>(), staged = new Map<string, unknown>()
    mocked.read.mockImplementation(async (_app: string, name: DocumentName) => server.get(name) ?? null)
    mocked.stage.mockImplementation(async (input) => { expect(storage.length).toBeGreaterThan(1); if (input.variant === 'selected') staged.set(input.document, input.state); return { staged: true } })
    mocked.commit.mockImplementation(async (input) => { expect(input.documents).toHaveLength(4); for (const name of documents) server.set(name, remote(name, staged.get(name))); return { documents: [...server.values()] } })
    const controller = make(storage); await start(controller); await controller.reviewMigration()
    expect(controller.getState().accountId).toBe(null); await controller.adopt()
    expect(controller.getState().accountId).toBe('A'); expect(captureRaw(storage)).toEqual(before)
    expect(readBundle(storage, 'A')!.remote).toHaveProperty('comparison')
    expect(mocked.stage).toHaveBeenCalledTimes(8); expect(mocked.commit).toHaveBeenCalledTimes(1)
    expect([...Array(storage.length)].map((_, index) => storage.key(index)).some((key) => key?.includes('.recovery.'))).toBe(true)
  })
  it('requires a deliberate choice for each differing account document', async () => {
    const changed = emptyCompanionProgress('test'); changed.ascension.epoch = 3
    const storage = memoryStorage(); storage.setItem(documentKeys.progress, JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: emptyCompanionProgress('test') }))
    mocked.read.mockImplementation(async (_app: string, name: DocumentName) => name === 'progress' ? remote(name, changed) : null)
    const controller = make(storage); await start(controller); await controller.reviewMigration()
    expect(controller.getState().preview?.choices.progress).toBe(null)
    await controller.adopt(); expect(mocked.stage).not.toHaveBeenCalled()
    controller.choose('progress', 'account'); expect(controller.getState().preview?.choices.progress).toBe('account')
  })
  it('blocks adoption before staging when a verified raw recovery copy cannot be stored', async () => {
    const base = memoryStorage(), storage = { ...base, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
    const controller = make(storage); await start(controller); await controller.reviewMigration(); await controller.adopt()
    expect(controller.getState().accountId).toBe(null); expect(mocked.stage).not.toHaveBeenCalled(); expect(base.length).toBe(0)
  })
  it('refuses invalid data and changed sources instead of uploading defaults', async () => {
    const storage = memoryStorage(); storage.setItem(documentKeys.comparison, '{broken')
    const controller = make(storage); await start(controller); await controller.reviewMigration()
    expect(controller.getState().preview).toBe(null); expect(mocked.read).not.toHaveBeenCalled(); expect(storage.getItem(documentKeys.comparison)).toBe('{broken')
    storage.removeItem(documentKeys.comparison); await controller.reviewMigration()
    storage.setItem(documentKeys.comparison, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: ['late-edit'] }))
    await controller.adopt(); expect(mocked.stage).not.toHaveBeenCalled(); expect(controller.getState().status).toContain('changed')
  })
  it('does not activate a partial or mismatched server readback', async () => {
    const controller = make(); await start(controller); await controller.reviewMigration(); await controller.adopt()
    expect(mocked.commit).toHaveBeenCalledTimes(1); expect(controller.getState().accountId).toBe(null)
    expect(controller.getState().status).toContain('read back')
  })
  it('keeps a durable failed mutation for retry using the same operation identity', async () => {
    const storage = memoryStorage(), current: AccountBundle = { version: 1, accountId: 'A', clientId: 'device-client', raw: rawForDocuments(states(), 'test'), remote: {}, pending: { comparison: { operationId: 'durable-op', mutationSequence: 7, baseRevision: 0, state: states().comparison } }, conflicts: {} }
    writeBundle(storage, current); storage.setItem(ACTIVE_ACCOUNT_KEY, 'A'); mocked.write.mockRejectedValue(new Error('offline'))
    const controller = make(storage); await start(controller); await controller.sync(); await controller.sync()
    expect(mocked.write).toHaveBeenCalledTimes(2)
    expect(mocked.write.mock.calls[0][0]).toEqual(mocked.write.mock.calls[1][0]); expect(readBundle(storage, 'A')!.pending.comparison?.operationId).toBe('durable-op')
  })
  it('ignores delayed acknowledgements after an account switch and keeps the old outbox', async () => {
    const storage = memoryStorage(), current: AccountBundle = { version: 1, accountId: 'A', clientId: 'device-client', raw: rawForDocuments(states(), 'test'), remote: {}, pending: { progress: { operationId: 'pending-A', mutationSequence: 1, baseRevision: 0, state: states().progress } }, conflicts: {} }
    writeBundle(storage, current); storage.setItem(ACTIVE_ACCOUNT_KEY, 'A')
    let finish!: (value: RemoteDocument) => void
    mocked.write.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const controller = make(storage); await start(controller); const syncing = controller.sync(); await Promise.resolve(); await Promise.resolve()
    expect(mocked.bound).toHaveBeenCalledWith('A')
    mocked.session = { ...mocked.session!, user: { id: 'B', email: 'other@example.test' } }; mocked.listener!(mocked.session)
    await controller.recheckSession()
    finish(remote('progress', states().progress)); await syncing
    expect(controller.getState().accountId).toBe(null); expect(readBundle(storage, 'A')!.pending.progress?.operationId).toBe('pending-A')
    expect(storage.getItem(accountKey('B'))).toBe(null)
  })
  it('does not start any session or network operation in disabled legacy mode', () => {
    const controller = createCompanionAccountSync({ revision: 'test', storage: memoryStorage(), locks: () => locks, uuid: () => 'id', enabled: false }); active.push(controller); controller.start()
    expect(mocked.listener).toBe(null); expect(mocked.read).not.toHaveBeenCalled(); expect(mocked.bound).not.toHaveBeenCalled()
  })
  it('resumes the same prepared migration after a lost commit acknowledgement and reload', async () => {
    const storage = memoryStorage(), selected = new Map<string, unknown>(), server = new Map<string, RemoteDocument>()
    mocked.read.mockImplementation(async (_app: string, name: string) => server.get(name) ?? null)
    mocked.stage.mockImplementation(async (input) => { expect(storage.getItem(accountKey('A') + '.migration.v1')).not.toBe(null); if (input.variant === 'selected') selected.set(input.document, input.state); return { staged: true } })
    let attempts = 0
    mocked.commit.mockImplementation(async () => { for (const name of documents) server.set(name, remote(name, selected.get(name))); if (++attempts === 1) throw new Error('commit response lost'); return { documents: [...server.values()] } })
    const first = make(storage); await start(first); await first.reviewMigration(); const id = first.getState().preview!.migrationId; await first.adopt()
    expect(first.getState().accountId).toBe(null); expect(first.getState().preview?.prepared).toBe(true); first.dispose()
    const resumed = make(storage); await start(resumed); await resumed.reviewMigration()
    expect(resumed.getState().preview?.migrationId).toBe(id); await resumed.adopt()
    expect(resumed.getState().accountId).toBe('A')
    expect(mocked.commit.mock.calls[0][0]).toEqual(mocked.commit.mock.calls[1][0])
    expect(mocked.stage.mock.calls.slice(0, 8)).toEqual(mocked.stage.mock.calls.slice(8, 16))
  })
  it('defaults an empty second device to existing account documents while retaining explicit-reset review', async () => {
    const cloud = states(); cloud.progress.ascension.epoch = 5
    mocked.read.mockImplementation(async (_app: string, name: DocumentName) => remote(name, cloud[name], 9))
    const controller = make(); await start(controller); await controller.reviewMigration()
    expect(controller.getState().preview?.choices).toEqual({ progress: 'account', intentions: 'account', checkpoints: 'account', comparison: 'account' })
    await controller.adopt()
    expect(controller.getState().accountId).toBe('A')
    const selected = mocked.stage.mock.calls.map(([body]) => body).find((body) => body.document === 'progress' && body.variant === 'selected')
    expect(selected.state.ascension.epoch).toBe(5)
  })
  it('queues a later replacement with the next sequence only after the frozen request acknowledges', async () => {
    const storage = memoryStorage(), first = { kind: 'upgrade-comparison', version: 1, ids: ['first'] }, latest = { kind: 'upgrade-comparison', version: 1, ids: ['latest'] }
    const current: AccountBundle = { version: 1, accountId: 'A', clientId: 'client', raw: rawForDocuments({ ...states(), comparison: latest }, 'test'), remote: {}, pending: { comparison: { operationId: 'frozen', mutationSequence: 1, baseRevision: 0, state: first } }, preservePrevious: { comparison: true }, conflicts: {} }
    writeBundle(storage, current); storage.setItem(ACTIVE_ACCOUNT_KEY, 'A'); mocked.write.mockResolvedValue(remote('comparison', first, 1, 1))
    const controller = make(storage); await start(controller); await controller.sync()
    expect(readBundle(storage, 'A')!.pending.comparison).toMatchObject({ mutationSequence: 2, baseRevision: 1, state: latest, preservePrevious: true })
    expect(readBundle(storage, 'A')!.pending.comparison?.operationId).not.toBe('frozen')
    mocked.write.mockResolvedValue(remote('comparison', latest, 2, 2)); await controller.sync()
    expect(readBundle(storage, 'A')!.pending.comparison).toBeUndefined()
    expect(mocked.write.mock.calls.map(([body]) => [body.mutationSequence, body.preservePrevious])).toEqual([[1, undefined], [2, true]])
  })
  it('treats newer cloud state returned by an exact mutation replay as a preserved conflict', async () => {
    const storage = memoryStorage(), local = { kind: 'upgrade-comparison', version: 1, ids: ['local'] }, cloud = { kind: 'upgrade-comparison', version: 1, ids: ['other-device'] }
    writeBundle(storage, { version: 1, accountId: 'A', clientId: 'client', raw: rawForDocuments({ ...states(), comparison: local }, 'test'), remote: {}, pending: { comparison: { operationId: 'lost-ack', mutationSequence: 1, baseRevision: 0, state: local } }, conflicts: {} }); storage.setItem(ACTIVE_ACCOUNT_KEY, 'A')
    mocked.write.mockResolvedValue(remote('comparison', cloud, 3, 1))
    const controller = make(storage); await start(controller); await controller.sync()
    expect(controller.getState().conflicts).toEqual(['comparison'])
    expect(readBundle(storage, 'A')!.pending.comparison?.operationId).toBe('lost-ack')
    expect(readBundle(storage, 'A')!.conflicts.comparison?.state).toEqual(cloud)
  })
  it('retains an unsaved in-memory visit when a session changes instead of remounting it away', async () => {
    const storage = memoryStorage(); writeBundle(storage, { version: 1, accountId: 'A', clientId: 'client', raw: rawForDocuments(states(), 'test'), remote: {}, pending: {}, conflicts: {} }); storage.setItem(ACTIVE_ACCOUNT_KEY, 'A')
    const controller = make(storage); await start(controller)
    controller.getPersistence().registerVisit('comparison', () => ({ kind: 'upgrade-comparison', version: 1, ids: ['unsaved'] }))
    const mount = controller.getState().mount
    mocked.session = { ...mocked.session!, user: { id: 'B', email: 'other@example.test' } }; mocked.listener!(mocked.session)
    await controller.recheckSession()
    expect(controller.getState().accountId).toBe('A'); expect(controller.getState().mount).toBe(mount)
    expect(controller.getState().status).toContain('unsaved'); expect(controller.exportAccount()).toContain('unsaved')
    await controller.sync(); expect(mocked.write).not.toHaveBeenCalled()
  })
  it('ignores a delayed GET that is older than a same-account recovery adopted in another tab', async () => {
    const storage = memoryStorage(), initial = { kind: 'upgrade-comparison', version: 1, ids: ['initial'] }, newer = { kind: 'upgrade-comparison', version: 1, ids: ['newer-recovery'] }, stale = { kind: 'upgrade-comparison', version: 1, ids: ['stale-get'] }
    writeBundle(storage, { version: 1, accountId: 'A', clientId: 'client', raw: rawForDocuments({ ...states(), comparison: initial }, 'test'), remote: { comparison: remote('comparison', initial, 2) }, pending: {}, conflicts: {} }); storage.setItem(ACTIVE_ACCOUNT_KEY, 'A')
    let finish!: (document: RemoteDocument) => void
    mocked.read.mockImplementation(async (_app: string, name: DocumentName) => name === 'comparison' ? new Promise<RemoteDocument>((resolve) => { finish = resolve }) : null)
    const controller = make(storage); await start(controller); const syncing = controller.sync()
    for (let i = 0; i < 100 && !finish; i++) await Promise.resolve()
    const advanced = readBundle(storage, 'A')!; advanced.raw = rawForDocuments({ ...states(), comparison: newer }, 'test'); advanced.remote.comparison = remote('comparison', newer, 4); writeBundle(storage, advanced)
    finish(remote('comparison', stale, 3)); await syncing
    expect(readBundle(storage, 'A')!.remote.comparison?.revision).toBe(4)
    expect(JSON.parse(readBundle(storage, 'A')!.raw[documentKeys.comparison]!).ids).toEqual(['newer-recovery'])
    expect(controller.getState().status).toContain('older account response')
  })
  it('marks an unreachable account service as unavailable and clears it only after a successful retry', async () => {
    const storage = memoryStorage(), before = captureRaw(storage)
    mocked.sessionReads.mockImplementationOnce(() => { throw new Error('Account service returned 404') })
    const controller = make(storage); await start(controller)
    expect(controller.getState()).toMatchObject({ unavailable: true, loading: false, accountId: null })
    expect(controller.getState().status).toContain('Accounts are unavailable')
    mocked.refreshReads.mockImplementationOnce(() => { throw new Error('Still offline') })
    await controller.retryConnection()
    expect(controller.getState().unavailable).toBe(true); expect(controller.getState().status).toContain('still unavailable')
    await controller.retryConnection()
    expect(controller.getState()).toMatchObject({ unavailable: false, session: mocked.session })
    expect(captureRaw(storage)).toEqual(before)
  })
  it('scopes recovery exports to the verified account instead of including other accounts or signed-out recoveries', async () => {
    const storage = memoryStorage(); storage.setItem(accountKey('A') + '.recovery.a', 'private-A-snapshot'); storage.setItem(accountKey('B') + '.migration.v1', 'private-B-snapshot')
    const controller = make(storage); await start(controller)
    expect(controller.exportOriginals()).toContain('private-A-snapshot'); expect(controller.exportOriginals()).not.toContain('private-B-snapshot')
    mocked.session = { ...mocked.session!, user: { id: 'B', email: 'other@example.test' } }; mocked.listener!(mocked.session)
    await controller.recheckSession()
    expect(controller.exportOriginals()).not.toContain('private-A-snapshot'); expect(controller.exportOriginals()).toContain('private-B-snapshot')
    mocked.session = { ...mocked.session!, user: null }; mocked.listener!(mocked.session)
    await controller.recheckSession()
    expect(controller.exportOriginals()).not.toMatch(/private-[AB]-snapshot/)
  })
  it('never publishes another account’s prepared journal after a delayed durable reload', async () => {
    const storage = memoryStorage(), accountStorage = memoryRepository(storage), state = states()
    storage.setItem(accountKey('A') + '.migration.v1', JSON.stringify({ version: 1, accountId: 'A', migrationId: 'prepared-A', clientId: 'client-A', raw: Object.fromEntries([...Object.values(documentKeys), 'idle-slayer-ascension-map.profile.v1', 'idle-slayer-ascension-map.goals.v1'].map((key) => [key, null])), device: state, selected: state, remote: Object.fromEntries(documents.map((name) => [name, null])), choices: Object.fromEntries(documents.map((name) => [name, 'device'])), phase: 'prepared' }))
    const controller = make(storage, accountStorage); await start(controller)
    let release!: () => void, held = false
    accountStorage.reload = async (key) => { if (key === undefined && !held) { held = true; await new Promise<void>((resolve) => { release = resolve }) } }
    const reviewing = controller.reviewMigration()
    for (let i = 0; i < 50 && !release; i++) await Promise.resolve()
    mocked.session = { ...mocked.session!, user: { id: 'B', email: 'other@example.test' } }; mocked.listener!(mocked.session); await controller.recheckSession()
    release(); await reviewing
    expect(controller.getState().session?.user?.id).toBe('B'); expect(controller.getState().preview).toBe(null)
    expect(mocked.stage).not.toHaveBeenCalled()
  })
  it('opens durable account storage before authentication and fails safely without mounting defaults', async () => {
    const storage = memoryStorage(), accountStorage = memoryRepository(storage)
    storage.setItem(documentKeys.comparison, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: ['guest-original'] }))
    accountStorage.reload = async () => { throw new DOMException('Device storage denied', 'SecurityError') }
    const controller = make(storage, accountStorage); expect(controller.getState().loading).toBe(true); await start(controller)
    expect(controller.getState().loading).toBe(false); expect(controller.getState().accountId).toBe(null)
    expect(mocked.sessionReads).not.toHaveBeenCalled(); expect(mocked.read).not.toHaveBeenCalled()
    expect(controller.exportOriginals()).toContain('guest-original')
  })
  it('copies unreleased localStorage account records into actual IDB without deleting originals', async () => {
    vi.useRealTimers()
    const storage = memoryStorage(), original = { version: 1 as const, accountId: 'A', clientId: 'old-client', raw: rawForDocuments(states(), 'test'), remote: {}, pending: {}, conflicts: {} }
    writeBundle(storage, original); storage.setItem(ACTIVE_ACCOUNT_KEY, 'A')
    const text = storage.getItem(accountKey('A')), repository = createAccountRepository({ factory: new IDBFactory(), broadcast: false })
    const controller = make(storage, repository); await start(controller)
    expect(controller.getState().accountId).toBe('A'); expect(controller.getState().loading).toBe(false)
    expect(storage.getItem(accountKey('A'))).toBe(text); expect(readBundle(repository, 'A')).toEqual(original)
  })
  it('resumes a lost commit from an actual IDB journal after reopening the repository', async () => {
    vi.useRealTimers()
    const storage = memoryStorage(), factory = new IDBFactory(), server = new Map<string, RemoteDocument>(), selected = new Map<string, unknown>()
    mocked.read.mockImplementation(async (_app: string, name: string) => server.get(name) ?? null)
    mocked.stage.mockImplementation(async (body) => { if (body.variant === 'selected') selected.set(body.document, body.state); return { staged: true } })
    let attempts = 0
    mocked.commit.mockImplementation(async () => { for (const name of documents) server.set(name, remote(name, selected.get(name))); if (++attempts === 1) throw new Error('commit response lost'); return { documents: [...server.values()] } })
    const one = make(storage, createAccountRepository({ factory, broadcast: false })); await start(one); await one.reviewMigration(); await one.adopt(); one.dispose()
    const two = make(storage, createAccountRepository({ factory, broadcast: false })); await start(two); await two.reviewMigration(); expect(two.getState().preview?.prepared).toBe(true); await two.adopt()
    expect(two.getState().accountId).toBe('A'); expect(mocked.commit.mock.calls[0][0]).toEqual(mocked.commit.mock.calls[1][0])
    expect(storage.getItem(accountKey('A'))).toBe(null)
  })
})
