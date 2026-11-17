import { COMPANION_STORAGE_KEY, exportCompanionStored, parseCompanionStored, parseCompanionBackup } from './domain/companion-storage'
import { emptyCompanionProgress } from './domain/companion-progress'
import { COMPANION_WORKSPACE_KEY, emptyCompanionWorkspace, parseCompanionWorkspace } from './domain/companion-workspace'
import { GOALS_STORAGE_KEY, parseGoals } from './domain/goals'
import { CHECKPOINT_STORAGE_KEY, emptyCheckpoints, parseCheckpoints } from './domain/checkpoints'
import { COMPARISON_STORAGE_KEY, emptyComparison, parseComparison } from './domain/saved-comparison'
import { PROFILE_STORAGE_KEY, parseProfileBackup } from './domain/storage'
import type { ProfileLocks } from './domain/profile-session'
import type { AccountRepository, DocumentStorage } from './account-repository'

export const documents = ['progress', 'intentions', 'checkpoints', 'comparison'] as const
export type DocumentName = typeof documents[number]
export const documentKeys: Record<DocumentName, string> = { progress: COMPANION_STORAGE_KEY, intentions: COMPANION_WORKSPACE_KEY, checkpoints: CHECKPOINT_STORAGE_KEY, comparison: COMPARISON_STORAGE_KEY }
export const originalKeys = [...Object.values(documentKeys), PROFILE_STORAGE_KEY, GOALS_STORAGE_KEY]
export const ACTIVE_ACCOUNT_KEY = 'idle-slayer-companion.accounts.active.v1'
export const accountKey = (id: string) => 'idle-slayer-companion.accounts.v1.' + encodeURIComponent(id)
export type RawDocuments = Record<string, string | null>
export type RemoteState = { resourceId: string; app: string; document: string; schemaVersion: number; revision: number; state: unknown; acknowledgedSequence: number }
export type PendingWrite = { operationId: string; mutationSequence: number; baseRevision: number; state: unknown }
export interface AccountBundle {
  version: 1
  accountId: string
  clientId: string
  raw: RawDocuments
  remote: Partial<Record<DocumentName, RemoteState>>
  pending: Partial<Record<DocumentName, PendingWrite>>
  conflicts: Partial<Record<DocumentName, RemoteState>>
}
export function captureRaw(storage: Pick<Storage, 'getItem'>): RawDocuments { return Object.fromEntries(originalKeys.map((key) => [key, storage.getItem(key)])) }
export function sameRaw(a: RawDocuments, b: RawDocuments): boolean { return originalKeys.every((key) => a[key] === b[key]) }
export function sameState(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}
export function validateDocument(name: DocumentName, state: unknown, revision: string): unknown {
  const text = JSON.stringify(state)
  if (name === 'progress') { const parsed = parseCompanionBackup(text, revision); if (!parsed.ok) throw new Error(parsed.error.message); return parsed.value }
  if (name === 'intentions') return parseCompanionWorkspace(text)
  if (name === 'checkpoints') { const parsed = parseCheckpoints(text, revision); if (!parsed) throw new Error('Saved checkpoints could not be validated.'); return parsed }
  const parsed = parseComparison(text); if (!parsed) throw new Error('Saved comparison could not be validated.'); return parsed
}
/** Read current and legacy documents without mutating either original. */
export function readDocuments(raw: RawDocuments, revision: string): Record<DocumentName, unknown> {
  const reference = (name: 'checkpoints' | 'comparison', empty: unknown) => {
    const text = raw[documentKeys[name]]; if (text === null) return empty
    try { return validateDocument(name, JSON.parse(text), revision) } catch { throw new Error(name === 'checkpoints' ? 'Saved checkpoints could not be validated.' : 'Saved comparison could not be validated.') }
  }
  let progress = emptyCompanionProgress(revision)
  if (raw[COMPANION_STORAGE_KEY] !== null) {
    const parsed = parseCompanionStored(raw[COMPANION_STORAGE_KEY], revision)
    if (!parsed.ok) throw new Error(parsed.error.message)
    if (parsed.value.legacyBaseline !== raw[PROFILE_STORAGE_KEY]) throw new Error('Review the changed legacy map in Backup & transfer before connecting an account.')
    progress = parsed.value.progress
  } else if (raw[PROFILE_STORAGE_KEY] !== null) {
    const parsed = parseProfileBackup(raw[PROFILE_STORAGE_KEY], revision); if (!parsed.ok) throw new Error(parsed.error.message); progress.ascension = parsed.profile
  }
  let intentions = emptyCompanionWorkspace()
  if (raw[COMPANION_WORKSPACE_KEY] !== null) {
    const parsed: unknown = JSON.parse(raw[COMPANION_WORKSPACE_KEY])
    if (parsed && typeof parsed === 'object' && 'format' in parsed && parsed.format === 'idle-slayer-companion-workspace-storage') {
      const wrapper = parsed as unknown as { workspace: unknown; legacyBaseline: unknown; version: unknown }
      if (Object.keys(parsed).sort().join(',') !== 'format,legacyBaseline,version,workspace' || wrapper.version !== 1 || wrapper.legacyBaseline !== raw[GOALS_STORAGE_KEY]) throw new Error('Review the changed legacy goals before connecting an account.')
      intentions = parseCompanionWorkspace(JSON.stringify(wrapper.workspace))
    } else intentions = parseCompanionWorkspace(raw[COMPANION_WORKSPACE_KEY])
  } else if (raw[GOALS_STORAGE_KEY] !== null) intentions.goals = parseGoals(raw[GOALS_STORAGE_KEY]).targets.map((goal) => ({ ref: { system: 'ascension', id: goal.id }, mode: goal.mode }))
  return {
    progress, intentions,
    checkpoints: reference('checkpoints', emptyCheckpoints()),
    comparison: reference('comparison', emptyComparison()),
  }
}
export function rawForDocuments(states: Record<DocumentName, unknown>, revision: string): RawDocuments {
  const raw: RawDocuments = Object.fromEntries(originalKeys.map((key) => [key, null]))
  for (const name of documents) setRawDocument(raw, name, states[name], revision)
  return raw
}
export function setRawDocument(raw: RawDocuments, name: DocumentName, state: unknown, revision: string) {
  const checked = validateDocument(name, state, revision)
  if (name === 'progress') {
    const parsed = parseCompanionBackup(JSON.stringify(checked), revision); if (!parsed.ok) throw new Error(parsed.error.message)
    const stored = exportCompanionStored({ progress: parsed.value, legacyBaseline: raw[PROFILE_STORAGE_KEY] ?? null }); if (!stored.ok) throw new Error(stored.error.message)
    raw[COMPANION_STORAGE_KEY] = stored.value
  } else if (name === 'intentions') raw[COMPANION_WORKSPACE_KEY] = JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, legacyBaseline: raw[GOALS_STORAGE_KEY] ?? null, workspace: checked })
  else raw[documentKeys[name]] = JSON.stringify(checked)
}
export function readBundle(storage: Pick<Storage, 'getItem'>, id: string): AccountBundle | null {
  const text = storage.getItem(accountKey(id)); if (text === null) return null
  let bundle: AccountBundle | null
  try { bundle = JSON.parse(text) as AccountBundle | null }
  catch { throw new Error('Saved account data needs recovery. Original documents were kept.') }
  if (!bundle || bundle.version !== 1 || bundle.accountId !== id || typeof bundle.clientId !== 'string' || !bundle.raw || !bundle.remote || !bundle.pending || !bundle.conflicts) throw new Error('Saved account data needs recovery. Original documents were kept.')
  return bundle
}
export function writeBundle(storage: DocumentStorage, bundle: AccountBundle): void | Promise<void> {
  const text = JSON.stringify(bundle), result = storage.setItem(accountKey(bundle.accountId), text)
  const verify = () => { if (storage.getItem(accountKey(bundle.accountId)) !== text) throw new Error('Account data could not be verified on this device.') }
  if (result && typeof result.then === 'function') return result.then(verify)
  verify()
}
export interface CompanionPersistence { storage: () => DocumentStorage; locks: () => ProfileLocks | undefined; matches: (event: StorageEvent, keys: string[]) => boolean; subscribe: (listener: () => void) => () => void; refresh: () => void; registerVisit: (name: DocumentName, read: () => unknown) => () => void; visitStates: () => Partial<Record<DocumentName, unknown>> }
function visitRegistry() {
  const visits = new Map<DocumentName, () => unknown>()
  return { registerVisit: (name: DocumentName, read: () => unknown) => { visits.set(name, read); return () => { if (visits.get(name) === read) visits.delete(name) } }, visitStates: () => Object.fromEntries([...visits].map(([name, read]) => [name, read()])) }
}
export function guestPersistence(): CompanionPersistence {
  return { storage: () => localStorage, locks: () => navigator.locks, matches: (event, keys) => event.storageArea === localStorage && (event.key === null || keys.includes(event.key)), subscribe: () => () => {}, refresh: () => {}, ...visitRegistry() }
}
/** One atomic account bundle keeps each durable edit and its outbox entry together. */
export function accountPersistence(options: { id: string; revision: string; storage: DocumentStorage & Partial<Pick<AccountRepository, 'reload'>>; locks: () => ProfileLocks | undefined; uuid: () => string; changed: () => void }): CompanionPersistence {
  const listeners = new Set<() => void>()
  const get = () => { const bundle = readBundle(options.storage, options.id); if (!bundle) throw new Error('Account data is unavailable.'); return bundle }
  const adapter: DocumentStorage = {
    getItem: (key) => get().raw[key] ?? null,
    setItem: (key, value) => {
      if (!originalKeys.includes(key)) throw new Error('Unsupported account document')
      const bundle = get(), name = documents.find((name) => documentKeys[name] === key)
      if (!name) throw new Error('Legacy account documents are read-only')
      bundle.raw[key] = value
      const state = readDocuments(bundle.raw, options.revision)[name]
      const remote = bundle.remote[name]
      // A possibly committed request must be replayed byte-for-byte after a lost
      // acknowledgement. Later edits live in raw until that frozen request acks.
      if (!bundle.pending[name]) bundle.pending[name] = { operationId: options.uuid(), mutationSequence: (remote?.acknowledgedSequence ?? 0) + 1, baseRevision: remote?.revision ?? 0, state }
      const result = writeBundle(options.storage, bundle)
      if (result && typeof result.then === 'function') return result.then(options.changed)
      options.changed()
    },
  }
  return {
    ...visitRegistry(),
    storage: () => adapter,
    locks: () => { const locks = options.locks(); return locks ? { request: async (_name, settings, callback) => await locks.request(accountKey(options.id) + '.write', settings, async (lock) => { if (lock) await options.storage.reload?.(accountKey(options.id)); return callback(lock) }) } : undefined },
    matches: () => false,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh: () => listeners.forEach((listener) => listener()),
  }
}
