import { describe, expect, it } from 'vitest'
import { accountKey, accountPersistence, captureRaw, documentKeys, documents, rawForDocuments, readBundle, readDocuments, sameState, writeBundle, type AccountBundle } from './account-storage'
import { emptyCompanionProgress } from './domain/companion-progress'
import { exportCompanionStored } from './domain/companion-storage'
import { PROFILE_STORAGE_KEY } from './domain/storage'
import { GOALS_STORAGE_KEY } from './domain/goals'

export function memoryStorage() {
  const values = new Map<string, string>()
  const storage: Storage = { get length() { return values.size }, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) }, clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null }
  return storage
}
export function states() { return { progress: emptyCompanionProgress('test'), intentions: { format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: {} }, checkpoints: { kind: 'progress-checkpoints', version: 1, entries: [] }, comparison: { kind: 'upgrade-comparison', version: 1, ids: [] } } }
export function bundle(id = 'account-A'): AccountBundle { return { version: 1, accountId: id, clientId: 'client', raw: rawForDocuments(states(), 'test'), remote: {}, pending: {}, conflicts: {} } }

describe('lossless account storage boundary', () => {
  it('reads legacy progress/goals without writing or dropping unknown IDs', () => {
    const storage = memoryStorage(), profile = emptyCompanionProgress('old').ascension
    profile.purchases['unknown-old-upgrade'] = { epoch: 0, active: false }
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)); storage.setItem(GOALS_STORAGE_KEY, JSON.stringify({ version: 1, targets: [{ id: 'old-goal', mode: 'acquire' }] }))
    const before = captureRaw(storage), result = readDocuments(before, 'test')
    expect(result.progress).toMatchObject({ ascension: { purchases: { 'unknown-old-upgrade': { epoch: 0, active: false } } } })
    expect(result.intentions).toMatchObject({ goals: [{ ref: { system: 'ascension', id: 'old-goal' }, mode: 'acquire' }] })
    expect(captureRaw(storage)).toEqual(before)
  })
  it('retains decimal precision, unobserved vs false and underlying hidden comparison IDs', () => {
    const current = states()
    current.progress.modules.material = { tracked: true, records: { future: { count: '90071992547409931234567890', completed: false }, unobserved: {} } }
    const raw = rawForDocuments({ ...current, comparison: { kind: 'upgrade-comparison', version: 1, ids: ['hidden-unrevealed', 'unknown-id'] } }, 'test')
    expect(readDocuments(raw, 'test')).toMatchObject({ progress: current.progress, comparison: { ids: ['hidden-unrevealed', 'unknown-id'] } })
  })
  it('refuses invalid current data and changed legacy baselines instead of falling back', () => {
    const storage = memoryStorage(); storage.setItem(documentKeys.progress, '{broken')
    expect(() => readDocuments(captureRaw(storage), 'test')).toThrow()
    const stored = exportCompanionStored({ progress: emptyCompanionProgress('test'), legacyBaseline: null }); expect(stored.ok).toBe(true)
    if (stored.ok) storage.setItem(documentKeys.progress, stored.value)
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(emptyCompanionProgress('test').ascension))
    expect(() => readDocuments(captureRaw(storage), 'test')).toThrow(/legacy/)
  })
  it('atomically saves account edits together with durable idempotent outbox metadata', () => {
    const storage = memoryStorage(), original = bundle(); writeBundle(storage, original)
    let n = 0
    const persistence = accountPersistence({ id: original.accountId, revision: 'test', storage, locks: () => undefined, uuid: () => 'operation-' + ++n, changed: () => {} })
    persistence.storage().setItem(documentKeys.comparison, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: ['hidden'] }))
    const saved = readBundle(storage, original.accountId)!
    expect(saved.pending.comparison).toMatchObject({ operationId: 'operation-1', mutationSequence: 1, baseRevision: 0, state: { ids: ['hidden'] } })
    expect(JSON.parse(saved.raw[documentKeys.comparison]!)).toMatchObject({ ids: ['hidden'] })
    expect(documents.filter((name) => !!saved.pending[name])).toEqual(['comparison'])
  })
  it('freezes an unacknowledged mutation while a later replacement stays durable', () => {
    const storage = memoryStorage(), original = bundle(); writeBundle(storage, original)
    let seq = 0
    const persistence = accountPersistence({ id: original.accountId, revision: 'test', storage, locks: () => undefined, uuid: () => 'op-' + ++seq, changed: () => {} })
    persistence.storage().setItem(documentKeys.comparison, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: ['first'] }))
    const frozen = readBundle(storage, original.accountId)!.pending.comparison
    persistence.storage().replaceItem!(documentKeys.comparison, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: ['second'] }))
    persistence.storage().setItem(documentKeys.intentions, JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, legacyBaseline: null, workspace: states().intentions }))
    const saved = readBundle(storage, original.accountId)!
    expect(saved.pending.comparison).toEqual(frozen)
    expect(saved.preservePrevious).toEqual({ comparison: true })
    expect(saved.pending.intentions?.mutationSequence).toBe(1)
    expect(readDocuments(saved.raw, 'test').comparison).toMatchObject({ ids: ['second'] })
  })
  it('quota failure preserves previous account data and outbox exactly', () => {
    const storage = memoryStorage(), original = bundle(); writeBundle(storage, original)
    const before = storage.getItem(accountKey(original.accountId))
    const blocked = { ...storage, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
    const persistence = accountPersistence({ id: original.accountId, revision: 'test', storage: blocked, locks: () => undefined, uuid: () => 'new', changed: () => {} })
    expect(() => persistence.storage().setItem(documentKeys.comparison, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: ['new'] }))).toThrow()
    expect(storage.getItem(accountKey(original.accountId))).toBe(before)
  })
  it('captures immutable namespaces and shares one write lock across documents', async () => {
    const storage = memoryStorage(); writeBundle(storage, bundle('A')); writeBundle(storage, bundle('B'))
    const names: string[] = [], locks = { request: async <T>(name: string, _options: unknown, callback: (lock: unknown) => T) => { names.push(name); return callback({}) } }
    const a = accountPersistence({ id: 'A', revision: 'test', storage, locks: () => locks, uuid: () => 'op', changed: () => {} })
    a.storage().setItem(documentKeys.comparison, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: ['from-A'] }))
    expect(readDocuments(readBundle(storage, 'B')!.raw, 'test').comparison).toEqual(states().comparison)
    await a.locks()!.request('progress', { mode: 'exclusive', ifAvailable: true }, () => {})
    await a.locks()!.request('intentions', { mode: 'exclusive', ifAvailable: true }, () => {})
    expect(names).toEqual([accountKey('A') + '.write', accountKey('A') + '.write'])
    expect(sameState({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true)
  })
})
