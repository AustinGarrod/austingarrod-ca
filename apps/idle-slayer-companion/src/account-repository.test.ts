import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createAccountRepository, type AccountRepository } from './account-repository'
import { accountKey, accountPersistence, documentKeys, rawForDocuments, readBundle, readDocuments, writeBundle } from './account-storage'
import { emptyCompanionProgress } from './domain/companion-progress'
import { createCompanionSession } from './domain/companion-session'
import { exportCompanionBackup } from './domain/companion-storage'
import type { ProfileLocks } from './domain/profile-session'

const repositories: AccountRepository[] = []
function repository(factory = new IDBFactory(), name = 'test-accounts') { const value = createAccountRepository({ factory, name, broadcast: false }); repositories.push(value); return value }
function states() { return { progress: emptyCompanionProgress('test'), intentions: { format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: {} }, checkpoints: { kind: 'progress-checkpoints', version: 1, entries: [] }, comparison: { kind: 'upgrade-comparison', version: 1, ids: [] } } }
function initialBundle() { return { version: 1 as const, accountId: 'A', clientId: 'client-A', raw: rawForDocuments(states(), 'test'), remote: {}, pending: {}, conflicts: {} } }
function coordinatedLocks(): ProfileLocks {
  const held = new Set<string>()
  return { async request(name, _settings, callback) { if (held.has(name)) return await callback(null); held.add(name); try { return await callback({}) } finally { held.delete(name) } } }
}
afterEach(() => { repositories.splice(0).forEach((value) => value.close()); vi.restoreAllMocks() })

describe('durable IndexedDB account repository', () => {
  it('keeps corrupt account bytes recoverable without exposing native JSON snippets in storage diagnostics', async () => {
    const first = repository(), original = 'PRIVATE_ACCOUNT_RECOVERY_BYTES_487206{broken'
    await first.reload(); await first.setItem(accountKey('A'), original)
    expect(() => readBundle(first, 'A')).toThrow('Saved account data needs recovery. Original documents were kept.')
    try { readBundle(first, 'A') } catch (error) { expect(String(error)).not.toContain(original.slice(0, 15)) }
    expect(first.getItem(accountKey('A'))).toBe(original)
  })
  it('acknowledges only after transaction completion and exact durable readback, then reopens the same data', async () => {
    const factory = new IDBFactory(), first = repository(factory)
    await first.reload(); await first.setItem('record', 'old')
    const put = IDBObjectStore.prototype.put, requestSuccess = vi.fn()
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      request.addEventListener('success', () => { requestSuccess(); expect(first.getItem('record')).toBe('old') })
      return request
    })
    await first.setItem('record', 'new')
    expect(requestSuccess).toHaveBeenCalledTimes(1); expect(first.getItem('record')).toBe('new')
    first.close(); const reopened = repository(factory); expect(reopened.getItem('record')).toBe(null)
    await reopened.reload(); expect(reopened.getItem('record')).toBe('new')
  })
  it('retains both previous durable state and cache when a transaction aborts after put succeeds', async () => {
    const factory = new IDBFactory(), first = repository(factory); await first.reload(); await first.setItem('record', 'original')
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key); request.addEventListener('success', () => this.transaction.abort()); return request
    })
    await expect(first.setItem('record', 'must-not-ack')).rejects.toMatchObject({ name: 'AbortError' })
    expect(first.getItem('record')).toBe('original'); vi.restoreAllMocks()
    const reopened = repository(factory); await reopened.reload(); expect(reopened.getItem('record')).toBe('original')
  })
  it('returns the quota cause without acknowledging or replacing either snapshot', async () => {
    const first = repository(); await first.reload(); await first.setItem('record', 'original')
    const cause = new DOMException('Synthetic quota exhaustion', 'QuotaExceededError')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw cause })
    await expect(first.setItem('record', 'unsaved')).rejects.toBe(cause)
    expect(first.getItem('record')).toBe('original'); vi.restoreAllMocks(); await first.reload(); expect(first.getItem('record')).toBe('original')
  })
  it('keeps a hydrated cache intact after a failed refresh rather than returning an empty account', async () => {
    const first = repository(); await first.reload(); await first.setItem('record', 'original')
    vi.spyOn(IDBObjectStore.prototype, 'getAllKeys').mockImplementation(() => { throw new DOMException('Synthetic read failure', 'UnknownError') })
    await expect(first.reload()).rejects.toMatchObject({ name: 'UnknownError' }); expect(first.getItem('record')).toBe('original')
    vi.restoreAllMocks(); await first.reload(); expect(first.getItem('record')).toBe('original')
  })
  it('atomically stores a large document and frozen outbox beyond the Web Storage quota', async () => {
    const factory = new IDBFactory(), first = repository(factory); await first.reload()
    const current = initialBundle()
    current.raw[documentKeys.progress] = 'raw-' + 'x'.repeat(4 * 1024 * 1024)
    const bundle = { ...current, pending: { progress: { operationId: 'frozen', mutationSequence: 1, baseRevision: 0, state: 'pending-' + 'y'.repeat(4 * 1024 * 1024) } } }
    await writeBundle(first, bundle)
    const reopened = repository(factory); await reopened.reload(accountKey('A'))
    expect(readBundle(reopened, 'A')?.raw[documentKeys.progress]).toBe(bundle.raw[documentKeys.progress])
    expect(readBundle(reopened, 'A')?.pending.progress).toEqual(bundle.pending.progress)
  })
  it('does not claim Companion saved when the real account bundle transaction aborts, and retry preserves an atomic outbox', async () => {
    const factory = new IDBFactory(), first = repository(factory); await first.reload(); await writeBundle(first, initialBundle())
    const persistence = accountPersistence({ id: 'A', revision: 'test', storage: first, locks: () => coordinated, uuid: () => 'operation-A', changed: () => {} }), coordinated = coordinatedLocks()
    const session = createCompanionSession({ revision: 'test', storage: persistence.storage, locks: persistence.locks }); session.initialize()
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      if (key === accountKey('A')) request.addEventListener('success', () => { expect(session.getState().pending).toBe(true); expect(session.getState().persistence).toBe('saving'); this.transaction.abort() })
      return request
    })
    const progress = structuredClone(session.getState().progress); progress.modules.material = { tracked: true, records: { unknown: { count: '90071992547409931234567890' } } }
    expect(session.applyCompanion(progress)).toBe(true)
    await vi.waitFor(() => expect(session.getState().pending).toBe(false))
    expect(session.getState().persistence).toBe('failed'); expect(session.getState().progress).toEqual(progress)
    expect(exportCompanionBackup(session.getState().progress).ok).toBe(true)
    expect(readBundle(first, 'A')!.pending.progress).toBeUndefined()
    vi.restoreAllMocks(); expect(await session.save()).toBe(true); expect(session.getState().persistence).toBe('saved')
    const reopened = repository(factory); await reopened.reload()
    expect(readBundle(reopened, 'A')!.pending.progress).toMatchObject({ operationId: 'operation-A', mutationSequence: 1, state: progress })
    expect(readDocuments(readBundle(reopened, 'A')!.raw, 'test').progress).toEqual(progress)
  })
  it('refreshes durable state inside the shared account lock so a stale tab cannot overwrite another tab', async () => {
    const factory = new IDBFactory(), first = repository(factory), second = repository(factory), coordinated = coordinatedLocks()
    await first.reload(); await writeBundle(first, initialBundle()); await second.reload()
    const a = accountPersistence({ id: 'A', revision: 'test', storage: first, locks: () => coordinated, uuid: () => 'A-write', changed: () => {} })
    const b = accountPersistence({ id: 'A', revision: 'test', storage: second, locks: () => coordinated, uuid: () => 'B-write', changed: () => {} })
    const one = createCompanionSession({ revision: 'test', storage: a.storage, locks: a.locks }), two = createCompanionSession({ revision: 'test', storage: b.storage, locks: b.locks })
    one.initialize(); two.initialize()
    const update = structuredClone(one.getState().progress); update.modules.achievement = { tracked: true, records: { 'from-A': { completed: true } } }; one.applyCompanion(update)
    await vi.waitFor(() => expect(one.getState().persistence).toBe('saved'))
    const stale = structuredClone(two.getState().progress); stale.ascension.showSpoilers = true; two.applyCompanion(stale)
    await vi.waitFor(() => expect(two.getState().pending).toBe(false))
    expect(two.getState().conflict).not.toBe(null); expect(two.getState().progress).toEqual(stale)
    await first.reload(); expect(readDocuments(readBundle(first, 'A')!.raw, 'test').progress).toEqual(update)
    expect(readBundle(first, 'A')!.pending.progress?.operationId).toBe('A-write')
  })
})
