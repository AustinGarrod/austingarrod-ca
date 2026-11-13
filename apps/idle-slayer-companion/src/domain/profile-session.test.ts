import { describe, expect, it, vi } from 'vitest'
import { createProfileSession, PROFILE_WRITE_LOCK, type ProfileLocks } from './profile-session'
import { emptyProfile, type Profile } from './types'
import { exportProfileBackup, MAX_PROFILE_BYTES, parseProfileBackup, PROFILE_STORAGE_KEY } from './storage'

const profile = (id: string): Profile => ({ ...emptyProfile('fixture'), purchases: { [id]: { epoch: 0, active: true } } })
function fixture(initial: string | null = null, locks?: ProfileLocks | false, revision = 'fixture') {
  let stored = initial
  let unavailable = false
  let denyWrites = false
  const storage = {
    getItem: vi.fn(() => { if (unavailable) throw new Error('Synthetic read failure'); return stored }),
    setItem: vi.fn((key: string, text: string) => { if (denyWrites) throw new Error('Synthetic quota failure'); expect(key).toBe(PROFILE_STORAGE_KEY); stored = text }),
  }
  const coordination: ProfileLocks = { request: vi.fn(async (_name, _options, callback) => callback({})) }
  const session = createProfileSession({ revision, storage: () => storage, locks: () => locks === false ? undefined : locks ?? coordination })
  session.initialize()
  return { session, storage, coordination, stored: () => stored, external: (text: string | null) => { stored = text }, failReads: (failed = true) => { unavailable = failed }, failWrites: (failed = true) => { denyWrites = failed } }
}
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
function delayedLocks() {
  const callbacks: (() => void)[] = []
  const locks: ProfileLocks = { request: <T>(_name: string, _options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => T) => new Promise<T>((resolve) => callbacks.push(() => resolve(callback({})))) }
  return { locks, release: () => callbacks.shift()!() }
}

describe('labeled visit-only Undo and Redo', () => {
  it('restores exact snapshots and action identity in both directions without changing backup fields', async () => {
    const f = fixture()
    const first = { ...profile('unknown-future'), epoch: 4, purchases: { unknown: { epoch: 1, active: false } }, milestones: { unknown: true as const } }
    const second = { ...first, showSpoilers: true }
    f.session.apply(first, false, 'game_import'); await settled()
    f.session.apply(second, false, 'spoilers'); await settled()
    expect(f.session.getState().history.map((entry) => entry.action)).toEqual(['game_import', 'spoilers'])
    expect(f.session.undo()).toBe(true); await settled()
    expect(f.session.getState().profile).toEqual(first)
    expect(f.session.getState().redoHistory.at(-1)?.action).toBe('spoilers')
    expect(f.session.undo()).toBe(true); await settled()
    expect(f.session.getState().profile).toEqual(emptyProfile('fixture'))
    expect(f.session.redo()).toBe(true); await settled()
    expect(f.session.getState().profile).toEqual(first)
    expect(f.session.redo()).toBe(true); await settled()
    expect(f.session.getState().profile).toEqual(second)
    expect(JSON.parse(f.stored()!)).toEqual(second)
    expect(Object.keys(JSON.parse(f.stored()!)).sort()).toEqual(Object.keys(emptyProfile('fixture')).sort())
    expect(f.session.getState().redoHistory).toEqual([])
    expect(f.session.redo()).toBe(false)
    expect(fixture(f.stored()).session.getState()).toMatchObject({ history: [], redoHistory: [] })
  })

  it('bounds past and future together to 20 snapshots and discards a redo branch on a new edit', async () => {
    const f = fixture()
    for (let epoch = 1; epoch <= 25; epoch++) { f.session.apply({ ...emptyProfile('fixture'), epoch }, false, 'prior_ascensions'); await settled() }
    expect(f.session.getState().history).toHaveLength(20)
    for (let count = 0; count < 20; count++) {
      expect(f.session.undo()).toBe(true); await settled()
      const state = f.session.getState()
      expect(state.history.length + state.redoHistory.length).toBe(20)
    }
    expect(f.session.getState().profile.epoch).toBe(5)
    expect(f.session.undo()).toBe(false)
    for (let count = 0; count < 10; count++) { f.session.redo(); await settled() }
    expect(f.session.getState().profile.epoch).toBe(15)
    f.session.apply(profile('new-branch'), false, 'purchase'); await settled()
    expect(f.session.getState().redoHistory).toEqual([])
    expect(f.session.getState().history.at(-1)?.action).toBe('purchase')
    expect(f.session.redo()).toBe(false)
  })

  it('does not move either history stack or version while a safe write is pending', async () => {
    const delayed = delayedLocks(), f = fixture(null, delayed.locks)
    f.session.apply(profile('first'), false, 'purchase')
    const before = f.session.getState()
    expect(f.session.undo()).toBe(false)
    expect(f.session.redo()).toBe(false)
    expect(f.session.getState()).toBe(before)
    delayed.release(); await settled()
    f.session.undo()
    const undoing = f.session.getState()
    expect(f.session.redo()).toBe(false)
    expect(f.session.undo()).toBe(false)
    expect(f.session.getState()).toBe(undoing)
    delayed.release(); await settled()
    expect(f.session.redo()).toBe(true)
    delayed.release(); await settled()
    expect(JSON.parse(f.stored()!)).toEqual(profile('first'))
  })

  it.each(['write-failure', 'missing', 'held', 'rejected'] as const)('keeps redo in memory and uses the existing safe persistence boundary with %s', async (condition) => {
    const locks: ProfileLocks = { request: async (_name, _options, callback) => {
      if (condition === 'rejected') throw new Error('Synthetic lock rejection')
      return callback(condition === 'held' ? null : {})
    } }
    const f = fixture(null, condition === 'missing' ? false : locks)
    if (condition === 'write-failure') f.failWrites()
    f.session.apply(profile('local'), false, 'restore'); await settled()
    f.session.undo(); await settled()
    expect(f.session.redo()).toBe(true); await settled()
    expect(f.session.getState()).toMatchObject({ profile: profile('local'), pending: false, persistence: 'failed' })
    expect(f.stored()).toBeNull()
    expect(f.session.getState().history.at(-1)?.action).toBe('restore')
    expect(exportProfileBackup(f.session.getState().profile).ok).toBe(true)
  })

  it.each([null, '{corrupt}', JSON.stringify(profile('external'))])('external progress %s clears both directions and action metadata', async (external) => {
    const f = fixture()
    f.session.apply(profile('first'), false, 'purchase'); await settled()
    f.session.apply(profile('second'), false, 'milestone'); await settled()
    f.session.undo(); await settled()
    f.external(external); f.session.refreshExternal()
    expect(f.session.getState()).toMatchObject({ history: [], redoHistory: [] })
    expect(f.session.undo()).toBe(false)
    expect(f.session.redo()).toBe(false)
  })

  it('supersedes a delayed redo write on external change and labels a confirmed saved-state recovery', async () => {
    const delayed = delayedLocks(), f = fixture(null, delayed.locks)
    f.session.apply(profile('local'), false, 'purchase'); delayed.release(); await settled()
    f.session.undo(); delayed.release(); await settled()
    f.session.redo()
    f.external(JSON.stringify(profile('external'))); f.session.refreshExternal()
    delayed.release(); await settled()
    expect(JSON.parse(f.stored()!)).toEqual(profile('external'))
    expect(f.session.getState()).toMatchObject({ profile: profile('local'), history: [], redoHistory: [] })
    expect(f.session.useSaved(f.session.getState().version)).toBe(true)
    expect(f.session.getState().history.at(-1)?.action).toBe('recovery')
    f.session.undo(); delayed.release(); await settled()
    expect(f.session.getState().profile).toEqual(profile('local'))
    f.session.redo(); delayed.release(); await settled()
    expect(f.session.getState().profile).toEqual(profile('external'))
  })
})

describe('coordinated profile persistence', () => {
  it('loads and migrates every portable field without rewriting saved input', () => {
    const incoming: Profile = {
      ...emptyProfile('older'), epoch: 3, showSpoilers: true,
      purchases: { known: { epoch: 3, active: true }, unknown: { epoch: 1, active: false } },
      milestones: { known: true, unknown: true },
    }
    for (const revision of ['older', 'newer']) {
      const text = JSON.stringify(incoming)
      const f = fixture(text, undefined, revision)
      expect(f.session.getState()).toMatchObject({ profile: { ...incoming, catalogRevision: revision }, persistence: 'saved', dirty: false, writable: true })
      expect(f.storage.getItem).toHaveBeenCalledWith(PROFILE_STORAGE_KEY)
      expect(f.storage.setItem).not.toHaveBeenCalled()
      expect(f.stored()).toBe(text)
    }
  })

  it('retains raw corrupt input without treating it as absent storage', () => {
    const text = '{corrupt}'
    const f = fixture(text)
    expect(f.session.getState()).toMatchObject({ persistence: 'failed', writable: false, errorKind: 'invalid-json' })
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.stored()).toBe(text)
  })

  it('refuses a migration that exceeds the portable limit without replacing saved input', () => {
    const incoming = emptyProfile('a')
    const bytes = () => Buffer.byteLength(JSON.stringify(incoming, null, 2))
    for (let index = 0; index < 4_000; index++) incoming.milestones[`future-${index}-${'x'.repeat(1_000)}`] = true
    let index = 0
    while (MAX_PROFILE_BYTES - bytes() > 64) {
      const prefix = `padding-${index++}-`
      const length = Math.min(1_024, MAX_PROFILE_BYTES - bytes() - 32)
      incoming.milestones[prefix + 'x'.repeat(length - prefix.length)] = true
    }
    const text = JSON.stringify(incoming)
    expect(parseProfileBackup(text).ok).toBe(true)
    const f = fixture(text, undefined, 'b'.repeat(512))
    expect(f.session.getState()).toMatchObject({ persistence: 'failed', writable: false, errorKind: 'too-large' })
    expect(f.stored()).toBe(text)
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })

  it('round trips a large accepted unknown-ID profile through the coordinated save boundary', async () => {
    const incoming = emptyProfile('fixture')
    for (let index = 0; index < 55_000; index++) incoming.purchases[`future-${index}`] = { epoch: 0, active: false }
    const parsed = parseProfileBackup(JSON.stringify(incoming))
    if (!parsed.ok) throw new Error('Expected an accepted backup')
    const f = fixture()
    expect(f.session.apply(parsed.profile)).toBe(true)
    await settled()
    const exported = exportProfileBackup(parsed.profile)
    if (!exported.ok) throw new Error('Expected export success')
    expect(f.stored()).toBe(exported.text)
    expect(parseProfileBackup(f.stored()!)).toEqual(parsed)
    expect(f.session.getState()).toMatchObject({ persistence: 'saved', dirty: false })
    expect(f.coordination.request).toHaveBeenCalledWith(PROFILE_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, expect.any(Function))
  })

  it('refuses malformed runtime progress at the supported save boundary', async () => {
    const f = fixture(JSON.stringify(profile('saved')))
    const malformed = { ...profile('local'), epoch: -1 }
    f.session.apply(malformed)
    await settled()
    expect(f.session.getState()).toMatchObject({ profile: malformed, dirty: true, persistence: 'failed', errorKind: 'invalid-profile' })
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.coordination.request).not.toHaveBeenCalled()
    expect(f.stored()).toBe(JSON.stringify(profile('saved')))
  })

  it('distinguishes checking, no saved profile, a loaded profile and unreadable progress', () => {
    const storage = { getItem: () => null, setItem: vi.fn() }
    const checking = createProfileSession({ revision: 'fixture', storage: () => storage, locks: () => undefined })
    expect(checking.getState().persistence).toBe('loading')
    checking.initialize()
    expect(checking.getState()).toMatchObject({ persistence: 'new', writable: true, dirty: false })
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(fixture(JSON.stringify(profile('saved'))).session.getState().persistence).toBe('saved')
    expect(fixture('{corrupt}').session.getState()).toMatchObject({ persistence: 'failed', writable: false })
    const unreadable = createProfileSession({ revision: 'fixture', storage: () => { throw new Error('Synthetic denied read') }, locks: () => undefined })
    unreadable.initialize()
    expect(unreadable.getState()).toMatchObject({ persistence: 'failed', errorKind: 'storage-read' })
  })

  it('only reports a confirmed save after the pending write completes and recovers after cancellation', async () => {
    const delayed = delayedLocks()
    const f = fixture(null, delayed.locks)
    const observed: string[] = []
    f.session.subscribe((state) => observed.push(state.persistence))
    f.session.apply(profile('local'))
    expect(observed).toEqual(['unsaved', 'saving'])
    expect(f.session.getState().persistence).toBe('saving')
    expect(f.stored()).toBeNull()
    f.session.cancelPending()
    expect(f.session.getState().persistence).toBe('failed')
    delayed.release(); await settled()
    expect(f.stored()).toBeNull()
    f.session.retry()
    expect(f.session.getState().persistence).toBe('saving')
    delayed.release(); await settled()
    expect(f.session.getState().persistence).toBe('saved')
    expect(JSON.parse(f.stored()!)).toEqual(profile('local'))
  })

  it('rejects saved input that cannot be portably exported while retaining its raw saved bytes', () => {
    const incoming = emptyProfile('fixture')
    for (let index = 0; index < 65_000; index++) incoming.purchases[`future-${index}`] = { epoch: 0, active: false }
    const compact = JSON.stringify(incoming)
    const f = fixture(compact)
    expect(f.session.getState()).toMatchObject({ profile: emptyProfile('fixture'), persistence: 'failed', writable: false, errorKind: 'too-large' })
    expect(f.stored()).toBe(compact)
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })

  it('persists only inside the named exclusive lock and preserves the portable schema', async () => {
    let held = false
    const locks: ProfileLocks = { request: async (name, options, callback) => {
      expect(name).toBe(PROFILE_WRITE_LOCK)
      expect(options).toEqual({ mode: 'exclusive', ifAvailable: true })
      held = true
      try { return callback({}) } finally { held = false }
    } }
    const f = fixture(null, locks)
    const setItem = f.storage.setItem.getMockImplementation()!
    f.storage.setItem.mockImplementation((key, text) => { expect(held).toBe(true); setItem(key, text) })
    const next = profile('unknown-future-id')
    expect(f.session.apply(next)).toBe(true)
    await settled()
    expect(JSON.parse(f.stored()!)).toEqual(next)
    expect(f.session.getState()).toMatchObject({ dirty: false, pending: false, conflict: null })
  })

  it('follows valid external state when clean and invalidates former undo/history', async () => {
    const f = fixture()
    f.session.apply(profile('first')); await settled()
    expect(f.session.getState().history).toHaveLength(1)
    const incoming = { ...profile('other-tab'), purchases: { ...profile('other-tab').purchases, unknown: { epoch: 0, active: false } }, milestones: { unknown: true as const } }
    f.external(JSON.stringify(incoming))
    expect(f.session.refreshExternal()).toBe(true)
    expect(f.session.getState()).toMatchObject({ profile: incoming, history: [], dirty: false, conflict: null, externalVersion: 1 })
    expect(f.session.undo()).toBe(false)
    expect(f.session.refreshExternal()).toBe(false)
  })

  it('refuses stale read/compare/write even before a storage event is delivered', async () => {
    const delayed = delayedLocks()
    const f = fixture(null, delayed.locks)
    f.session.apply(profile('local'))
    f.external(JSON.stringify(profile('other-tab')))
    delayed.release(); await settled()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.getState()).toMatchObject({ profile: profile('local'), dirty: true, pending: false, conflict: { kind: 'valid', profile: profile('other-tab') } })
  })

  it('does not allow a superseded pending callback to write after external conflict', async () => {
    const delayed = delayedLocks()
    const f = fixture(null, delayed.locks)
    f.session.apply(profile('local'))
    f.external(JSON.stringify(profile('other-tab')))
    f.session.refreshExternal()
    const version = f.session.getState().version
    delayed.release(); await settled()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.getState()).toMatchObject({ version, pending: false, dirty: true, profile: profile('local') })
    expect(f.stored()).toBe(JSON.stringify(profile('other-tab')))
  })

  it('accepts one pending local operation and safely cancels it for reload', async () => {
    const delayed = delayedLocks()
    const f = fixture(null, delayed.locks)
    expect(f.session.apply(profile('local'))).toBe(true)
    expect(f.session.apply(profile('later'))).toBe(false)
    expect(await f.session.save()).toBe(false)
    expect(exportProfileBackup(f.session.getState().profile).ok).toBe(true)
    f.session.cancelPending()
    delayed.release(); await settled()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.getState()).toMatchObject({ profile: profile('local'), pending: false, dirty: true })
  })

  it.each(['missing', 'held', 'rejected'] as const)('keeps an exportable memory session when coordination is %s', async (condition) => {
    const locks: ProfileLocks = { request: async (_name, _options, callback) => {
      if (condition === 'rejected') throw new Error('Synthetic coordination failure')
      return callback(null)
    } }
    const f = fixture(null, condition === 'missing' ? false : locks)
    f.session.apply(profile('local')); await settled()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.getState()).toMatchObject({ profile: profile('local'), pending: false, dirty: true, errorKind: 'unavailable' })
    expect(exportProfileBackup(f.session.getState().profile).ok).toBe(true)
  })

  it('retains unsaved edits on write failure, retries the current snapshot, and guards undo writes', async () => {
    const f = fixture()
    f.failWrites()
    f.session.apply(profile('local')); await settled()
    expect(f.session.getState()).toMatchObject({ dirty: true, persistence: 'failed', errorKind: 'storage-write' })
    f.failWrites(false)
    f.session.retry(); await settled()
    expect(f.session.getState()).toMatchObject({ dirty: false, persistence: 'saved', error: '' })
    expect(JSON.parse(f.stored()!)).toEqual(profile('local'))
    expect(f.session.undo()).toBe(true); await settled()
    expect(JSON.parse(f.stored()!)).toEqual(emptyProfile('fixture'))
    expect(f.session.getState().persistence).toBe('saved')
  })

  it.each([null, '{corrupt}'])('preserves dirty state when external storage becomes %s', async (external) => {
    const f = fixture(JSON.stringify(profile('previous')))
    f.failWrites(); f.session.apply(profile('local')); await settled()
    f.external(external); f.session.refreshExternal()
    expect(f.session.getState()).toMatchObject({ profile: profile('local'), dirty: true, persistence: 'conflict', history: [], conflict: { kind: external === null ? 'valid' : 'invalid', text: external } })
    f.failWrites(false)
    expect(await f.session.save()).toBe(false)
    expect(f.stored()).toBe(external)
    expect(await f.session.save(true, f.session.getState().version)).toBe(true)
    expect(f.session.getState().persistence).toBe('saved')
    expect(JSON.parse(f.stored()!)).toEqual(profile('local'))
  })

  it('follows deleted storage while clean without recreating it', () => {
    const f = fixture(JSON.stringify(profile('previous')))
    f.external(null); f.session.refreshExternal()
    expect(f.session.getState()).toMatchObject({ profile: emptyProfile('fixture'), dirty: false, persistence: 'new', history: [], conflict: null })
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })

  it('never overwrites unreadable storage through ordinary or explicit replacement', async () => {
    const f = fixture(JSON.stringify(profile('previous')))
    f.failReads(); f.session.refreshExternal()
    const version = f.session.getState().version
    expect(await f.session.save(true, version)).toBe(false)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.getState().profile).toEqual(profile('previous'))
    f.failReads(false); f.session.refreshExternal()
    expect(f.session.getState().conflict?.kind).toBe('valid')
  })

  it('requires the reviewed version for conflict choices and rechecks external text before replacement', async () => {
    const f = fixture()
    f.failWrites(); f.session.apply(profile('local')); await settled()
    f.external(JSON.stringify(profile('other-tab'))); f.session.refreshExternal(); f.failWrites(false)
    const reviewed = f.session.getState().version
    f.external(JSON.stringify(profile('newer-tab')))
    expect(await f.session.save(true, reviewed)).toBe(false)
    expect(f.stored()).toBe(JSON.stringify(profile('newer-tab')))
    expect(f.session.useSaved(reviewed)).toBe(false)
    expect(f.session.getState().profile).toEqual(profile('local'))
    expect(f.session.useSaved(f.session.getState().version)).toBe(true)
    expect(f.session.getState().profile).toEqual(profile('newer-tab'))
    expect(f.session.undo()).toBe(true); await settled()
    expect(JSON.parse(f.stored()!)).toEqual(profile('local'))
  })

  it('does not bypass a known conflict when applying restore/import/clear replacement state', async () => {
    const f = fixture()
    f.failWrites(); f.session.apply(profile('local')); await settled()
    f.external(JSON.stringify(profile('other-tab'))); f.session.refreshExternal(); f.failWrites(false)
    f.session.apply(profile('restored'), true); await settled()
    expect(f.stored()).toBe(JSON.stringify(profile('other-tab')))
    expect(f.session.getState()).toMatchObject({ profile: profile('restored'), dirty: true, conflict: { kind: 'valid' } })
  })

  it('allows a reviewed restore to replace unchanged corrupt startup storage, with undo still safe', async () => {
    const f = fixture('{corrupt}')
    f.session.apply(profile('restored'), true); await settled()
    expect(JSON.parse(f.stored()!)).toEqual(profile('restored'))
    expect(f.session.getState()).toMatchObject({ dirty: false, persistence: 'saved', writable: true })
    f.session.undo(); await settled()
    expect(JSON.parse(f.stored()!)).toEqual(emptyProfile('fixture'))
  })
})
