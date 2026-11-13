import { describe, expect, it, vi } from 'vitest'
import { createCompanionSession } from './companion-session'
import { emptyCompanionProgress, recordCompanionEntity } from './companion-progress'
import { COMPANION_STORAGE_KEY, exportCompanionBackup, exportCompanionStored, parseCompanionStored } from './companion-storage'
import { PROFILE_WRITE_LOCK, type ProfileLocks } from './profile-session'
import { PROFILE_STORAGE_KEY } from './storage'
import { emptyProfile } from './types'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const legacy = JSON.stringify({ ...emptyProfile('old'), milestones: { 'map-item': true }, purchases: { 'unknown-upgrade': { epoch: 0, active: true } } })
function storedProgress(legacyBaseline: string | null = null, id = 'saved') {
  const progress = recordCompanionEntity(emptyCompanionProgress('fixture'), 'achievement', id, { completed: true })
  const result = exportCompanionStored({ progress, legacyBaseline })
  if (!result.ok) throw new Error('Synthetic envelope must export')
  return result.value
}
function fixture(initial: { companion?: string | null; legacy?: string | null } = {}, coordination?: ProfileLocks | false) {
  const values = new Map<string, string>()
  if (initial.companion != null) values.set(COMPANION_STORAGE_KEY, initial.companion)
  if (initial.legacy != null) values.set(PROFILE_STORAGE_KEY, initial.legacy)
  let failRead = false, failWrite = false, held = false
  const locks: ProfileLocks = coordination || { request: vi.fn(async (name, options, callback) => {
    expect(name).toBe(PROFILE_WRITE_LOCK); expect(options).toEqual({ mode: 'exclusive', ifAvailable: true })
    held = true
    try { return callback({}) } finally { held = false }
  }) }
  const storage = {
    getItem: vi.fn((key: string) => { if (failRead) throw new Error('Synthetic read failure'); return values.get(key) ?? null }),
    setItem: vi.fn((key: string, value: string) => {
      if (failWrite) throw new Error('Synthetic quota failure')
      if (!coordination) expect(held).toBe(true)
      expect(key).toBe(COMPANION_STORAGE_KEY); values.set(key, value)
    }),
  }
  const session = createCompanionSession({ revision: 'fixture', storage: () => storage, locks: () => coordination === false ? undefined : locks, mapMilestoneIds: ['map-item'] })
  session.initialize()
  return { session, storage, locks, values, readsFail: (value: boolean) => { failRead = value }, writesFail: (value: boolean) => { failWrite = value } }
}
function delayedLocks() {
  const queue: (() => void)[] = []
  const locks: ProfileLocks = { request: <T>(_name: string, _options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => T) => new Promise<T>((resolve) => queue.push(() => resolve(callback({})))) }
  return { locks, release: () => queue.shift()!() }
}

describe('one companion session', () => {
  it('migrates a legacy map in memory without startup writes and only commits the new envelope on an actual edit', async () => {
    const f = fixture({ legacy })
    expect(f.session.getState().profile).toMatchObject({ catalogRevision: 'fixture', milestones: { 'map-item': true }, purchases: { 'unknown-upgrade': { epoch: 0, active: true } } })
    expect(f.session.getState().progress.modules.achievement.tracked).toBe(false)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.applyCompanion(recordCompanionEntity(f.session.getState().progress, 'achievement', 'achievement', { completed: true }))).toBe(true)
    await settle()
    expect(f.values.get(PROFILE_STORAGE_KEY)).toBe(legacy)
    const persisted = parseCompanionStored(f.values.get(COMPANION_STORAGE_KEY)!, 'fixture')
    expect(persisted.ok).toBe(true)
    if (!persisted.ok) return
    expect(persisted.value.legacyBaseline).toBe(legacy)
    expect(persisted.value.progress.modules.achievement.records.achievement.completed).toBe(true)
    expect(f.session.getState()).toMatchObject({ dirty: false, persistence: 'saved' })
  })
  it('keeps invalid authoritative companion data without falling back to a valid older map', async () => {
    const f = fixture({ companion: '{broken}', legacy })
    expect(f.session.getState()).toMatchObject({ profile: emptyProfile('fixture'), writable: false, errorKind: 'invalid-json', persistence: 'failed' })
    expect(f.storage.setItem).not.toHaveBeenCalled()
    f.session.applyProfile({ ...emptyProfile('fixture'), epoch: 2 }); await settle()
    expect(f.values.get(COMPANION_STORAGE_KEY)).toBe('{broken}')
    expect(f.session.getState().dirty).toBe(true)
  })
  it('does not resurrect retained legacy progress after deletion of an adopted companion key', () => {
    const f = fixture({ companion: storedProgress(legacy), legacy })
    f.values.delete(COMPANION_STORAGE_KEY); f.session.refreshExternal()
    expect(f.session.getState().profile).toEqual(emptyProfile('fixture'))
    expect(f.session.getState().persistence).toBe('new')
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('allows an explicit companion restore over malformed readable legacy data without changing that data', async () => {
    const f = fixture({ legacy: '{corrupt}' })
    expect(f.session.getState().writable).toBe(false)
    const restored = recordCompanionEntity(emptyCompanionProgress('fixture'), 'achievement', 'restored', { completed: true })
    expect(f.session.applyCompanion(restored, true, 'restore')).toBe(true)
    await settle()
    expect(f.session.getState()).toMatchObject({ persistence: 'saved', dirty: false })
    expect(f.values.get(PROFILE_STORAGE_KEY)).toBe('{corrupt}')
    expect(fixture({ legacy: '{corrupt}', companion: f.values.get(COMPANION_STORAGE_KEY) }).session.getState()).toMatchObject({ persistence: 'saved', dirty: false })
  })
  it('records a map operation and a module operation in the same exact 20-step Undo/Redo history', async () => {
    const f = fixture()
    const one = recordCompanionEntity(f.session.getState().progress, 'craft', 'non-map-item', { completed: true })
    f.session.applyCompanion(one, false, 'change'); await settle()
    const two = { ...f.session.getState().profile, epoch: 3 }
    f.session.applyProfile(two, false, 'prior_ascensions'); await settle()
    expect(f.session.getState().progress.modules).toBe(one.modules)
    expect(f.session.getState().history[0].profile).toBe(f.session.getState().history[0].progress.ascension)
    expect(f.session.undo()).toBe(true); await settle()
    expect(f.session.getState().progress).toBe(one)
    expect(f.session.redo()).toBe(true); await settle()
    expect(f.session.getState().profile.epoch).toBe(3)
    for (let count = 0; count < 22; count++) { f.session.applyCompanion(recordCompanionEntity(f.session.getState().progress, 'material', 'wood', { count: String(count) })); await settle() }
    expect(f.session.getState().history).toHaveLength(20)
    for (let count = 0; count < 20; count++) { expect(f.session.undo()).toBe(true); await settle() }
    expect(f.session.undo()).toBe(false)
    expect(f.session.getState().redoHistory).toHaveLength(20)
    f.session.applyProfile(emptyProfile('fixture')); await settle()
    expect(f.session.getState().redoHistory).toEqual([])
    expect(f.session.getState().profile.milestones['non-map-item']).toBe(true)
  })
  it('guards commands and replacement previews against changes in any module', async () => {
    const f = fixture()
    const expectedVersion = f.session.getState().version
    expect(f.session.command(expectedVersion, (progress) => recordCompanionEntity(progress, 'enemy', 'enemy', { count: '3' }))).toBe(true)
    await settle()
    const reduce = vi.fn((progress) => progress)
    expect(f.session.command(expectedVersion, reduce)).toBe(false)
    expect(reduce).not.toHaveBeenCalled()
    expect(f.session.getState().progress.modules.enemy.records.enemy.count).toBe('3')
  })
  it('projects only map item facts into legacy backups, transfers and history with stable snapshot identity', async () => {
    const values = new Map<string, string>()
    const session = createCompanionSession({ revision: 'fixture', storage: () => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, text) => { values.set(key, text) } }), locks: () => ({ request: async (_name, _options, callback) => callback({}) }), mapMilestoneIds: ['map-item'], companionItemIds: ['map-item', 'companion-item', 'quest-reward'] })
    session.initialize()
    let progress = recordCompanionEntity(session.getState().progress, 'craft', 'companion-item', { completed: true })
    progress = recordCompanionEntity(progress, 'village', 'quest-reward', { completed: true })
    progress.ascension.milestones['map-item'] = true
    progress.ascension.milestones['future-map-item'] = true
    session.applyCompanion(progress); await settle()
    const projected = session.getState().profile
    expect(projected.milestones).toEqual({ 'map-item': true, 'future-map-item': true })
    expect(session.getState().progress.ascension.milestones).toEqual({ 'companion-item': true, 'quest-reward': true, 'map-item': true, 'future-map-item': true })
    session.applyProfile({ ...projected, epoch: 1 }); await settle()
    expect(session.getState().history.at(-1)?.profile).toBe(projected)
    session.undo(); await settle()
    expect(session.getState().profile).toBe(projected)
    expect(session.getState().progress.ascension.milestones['companion-item']).toBe(true)
    expect(session.getState().progress.ascension.milestones['quest-reward']).toBe(true)
  })
  it('rejects an unobserved legacy writer before the first companion commit', async () => {
    const delayed = delayedLocks(), f = fixture({ legacy }, delayed.locks)
    f.session.applyCompanion(recordCompanionEntity(f.session.getState().progress, 'achievement', 'local', { completed: true }))
    f.values.set(PROFILE_STORAGE_KEY, JSON.stringify(emptyProfile('other')))
    delayed.release(); await settle()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.getState()).toMatchObject({ persistence: 'conflict', pending: false, dirty: true })
    expect(f.session.getState().progress.modules.achievement.records.local.completed).toBe(true)
  })
  it('detects an older-tab write after companion adoption even after a reload and never silently merges it', () => {
    const f = fixture({ companion: storedProgress(legacy), legacy: JSON.stringify(emptyProfile('older-writer')) })
    expect(f.session.getState()).toMatchObject({ persistence: 'conflict', writable: false, errorKind: 'stale' })
    expect(f.session.getState().progress.modules.achievement.records.saved.completed).toBe(true)
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('requires explicit recovery when a clean companion tab observes an older writer', async () => {
    const f = fixture({ companion: storedProgress(legacy), legacy })
    f.values.set(PROFILE_STORAGE_KEY, JSON.stringify(emptyProfile('other')))
    expect(f.session.refreshExternal()).toBe(true)
    const version = f.session.getState().version
    expect(f.session.getState().conflict?.kind).toBe('valid')
    expect(await f.session.save()).toBe(false)
    expect(await f.session.save(true, version)).toBe(true)
    const parsed = parseCompanionStored(f.values.get(COMPANION_STORAGE_KEY)!, 'fixture')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.legacyBaseline).toBe(f.values.get(PROFILE_STORAGE_KEY))
  })
  it('persists a checked saved snapshot acknowledgement so an older writer conflict stays resolved after reload', async () => {
    const changedLegacy = JSON.stringify(emptyProfile('older-writer'))
    const f = fixture({ companion: storedProgress(legacy), legacy: changedLegacy })
    expect(f.session.getState().conflict?.kind).toBe('valid')
    expect(f.session.useSaved(f.session.getState().version)).toBe(true)
    await settle()
    expect(f.values.get(PROFILE_STORAGE_KEY)).toBe(changedLegacy)
    const reloaded = fixture({ companion: f.values.get(COMPANION_STORAGE_KEY), legacy: changedLegacy }).session.getState()
    expect(reloaded).toMatchObject({ persistence: 'saved', dirty: false, conflict: null })
    expect(reloaded.progress.modules.achievement.records.saved.completed).toBe(true)
  })
  it('keeps a failed saved snapshot acknowledgement dirty and retryable', async () => {
    const changedLegacy = JSON.stringify(emptyProfile('older-writer'))
    const f = fixture({ companion: storedProgress(legacy), legacy: changedLegacy })
    f.writesFail(true)
    expect(f.session.useSaved(f.session.getState().version)).toBe(true)
    await settle()
    expect(f.session.getState()).toMatchObject({ persistence: 'failed', dirty: true, conflict: null, errorKind: 'storage-write' })
    f.writesFail(false)
    expect(await f.session.save()).toBe(true)
    expect(fixture({ companion: f.values.get(COMPANION_STORAGE_KEY), legacy: changedLegacy }).session.getState().conflict).toBeNull()
  })
  it('adopts an external complete companion snapshot atomically when clean and clears history', async () => {
    const f = fixture()
    f.session.applyProfile({ ...emptyProfile('fixture'), epoch: 2 }); await settle()
    f.values.set(COMPANION_STORAGE_KEY, storedProgress(null, 'external'))
    expect(f.session.refreshExternal()).toBe(true)
    expect(f.session.getState()).toMatchObject({ history: [], redoHistory: [], dirty: false, externalVersion: 1 })
    expect(f.session.getState().profile.epoch).toBe(0)
    expect(f.session.getState().progress.modules.achievement.records.external.completed).toBe(true)
  })
  it('supersedes a pending write on external changes and prevents stale recovery selection', async () => {
    const delayed = delayedLocks(), f = fixture({}, delayed.locks)
    f.session.applyProfile({ ...emptyProfile('fixture'), epoch: 2 })
    f.values.set(COMPANION_STORAGE_KEY, storedProgress())
    f.session.refreshExternal()
    const version = f.session.getState().version
    delayed.release(); await settle()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    f.values.set(COMPANION_STORAGE_KEY, storedProgress(null, 'newer'))
    expect(f.session.useSaved(version)).toBe(false)
    expect(f.session.getState().profile.epoch).toBe(2)
    expect(f.session.useSaved(f.session.getState().version)).toBe(true)
    expect(f.session.getState().progress.modules.achievement.records.newer.completed).toBe(true)
    expect(f.session.getState().history.at(-1)?.action).toBe('recovery')
  })
  it.each(['missing-lock', 'busy-lock', 'read-failure', 'quota'] as const)('keeps a complete portable memory snapshot after %s', async (condition) => {
    const f = fixture({}, condition === 'missing-lock' ? false : condition === 'busy-lock' ? { request: async (_name, _options, callback) => callback(null) } : undefined)
    if (condition === 'read-failure') f.readsFail(true)
    if (condition === 'quota') f.writesFail(true)
    f.session.applyCompanion(recordCompanionEntity(f.session.getState().progress, 'quest', 'quest', { claimed: true }))
    await settle()
    expect(f.session.getState()).toMatchObject({ pending: false, dirty: true })
    expect(f.values.has(COMPANION_STORAGE_KEY)).toBe(false)
    expect(exportCompanionBackup(f.session.getState().progress).ok).toBe(true)
  })
  it('rejects malformed commands before replacing otherwise usable session state', () => {
    const f = fixture()
    const original = f.session.getState().progress
    expect(f.session.command(f.session.getState().version, (progress) => ({ ...progress, ascension: { ...progress.ascension, epoch: -1 } }))).toBe(false)
    expect(f.session.getState().progress).toBe(original)
    expect(f.session.getState().history).toEqual([])
  })
  it('uses the same canonical shared item fact in memory and after a reload for accepted runtime snapshots', async () => {
    const f = fixture()
    const progress = emptyCompanionProgress('fixture')
    progress.modules.village.records.item = { completed: true }
    expect(f.session.applyCompanion(progress)).toBe(true)
    await settle()
    expect(f.session.getState().profile.milestones.item).toBe(true)
    expect(f.session.getState().progress.modules.village.records.item.completed).toBe(false)
    expect(progress.ascension.milestones).toEqual({})
    expect(fixture({ companion: f.values.get(COMPANION_STORAGE_KEY) }).session.getState().progress).toEqual(f.session.getState().progress)
  })
})
