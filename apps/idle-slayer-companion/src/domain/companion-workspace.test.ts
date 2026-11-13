import { describe, expect, it, vi } from 'vitest'
import { COMPANION_WORKSPACE_KEY, COMPANION_WORKSPACE_WRITE_LOCK, createCompanionWorkspaceSession, emptyCompanionWorkspace, parseCompanionWorkspace, type CompanionWorkspace } from './companion-workspace'
import { GOALS_STORAGE_KEY } from './goals'
import type { ProfileLocks } from './profile-session'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const legacy = JSON.stringify({ version: 1, targets: [{ id: 'upgrade', mode: 'activate' }] })
function workspace(id = 'achievement'): CompanionWorkspace { return { ...emptyCompanionWorkspace(), goals: [{ ref: { system: 'achievement', id }, mode: 'complete' }], recipePlans: { 'future-recipe': '3' } } }
function wrapped(value = workspace(), legacyBaseline: string | null = null) { return JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, legacyBaseline, workspace: value }) }
function fixture(initial: { raw?: string; legacy?: string } = {}, coordination?: ProfileLocks | false) {
  const values = new Map<string, string>()
  if (initial.raw !== undefined) values.set(COMPANION_WORKSPACE_KEY, initial.raw)
  if (initial.legacy !== undefined) values.set(GOALS_STORAGE_KEY, initial.legacy)
  let failReads = false, failWrites = false, locked = false
  const storage = {
    getItem: vi.fn((key: string) => { if (failReads) throw new Error('Synthetic unavailable'); return values.get(key) ?? null }),
    setItem: vi.fn((key: string, text: string) => { if (!coordination) expect(locked).toBe(true); if (failWrites) throw new Error('Synthetic quota'); expect(key).toBe(COMPANION_WORKSPACE_KEY); values.set(key, text) }),
  }
  const locks: ProfileLocks = coordination || { request: vi.fn(async (name, options, callback) => { expect(name).toBe(COMPANION_WORKSPACE_WRITE_LOCK); expect(options).toEqual({ mode: 'exclusive', ifAvailable: true }); locked = true; try { return callback({}) } finally { locked = false } }) }
  const session = createCompanionWorkspaceSession({ storage: () => storage, locks: () => coordination === false ? undefined : locks })
  session.initialize()
  return { session, storage, values, readsFail: (fail: boolean) => { failReads = fail }, writesFail: (fail: boolean) => { failWrites = fail } }
}
function delayedLocks() {
  const pending: (() => void)[] = []
  const locks: ProfileLocks = { request: <T>(_name: string, _options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => T) => new Promise<T>((resolve) => pending.push(() => resolve(callback({})))) }
  return { locks, release: () => pending.shift()!() }
}

describe('separate companion intentions', () => {
  it('migrates legacy goal modes in memory without overwriting startup storage', async () => {
    const f = fixture({ legacy })
    expect(f.session.getState()).toMatchObject({ dirty: false, readable: true, workspace: { goals: [{ ref: { system: 'ascension', id: 'upgrade' }, mode: 'activate' }] } })
    expect(f.storage.setItem).not.toHaveBeenCalled()
    f.session.edit({ ...f.session.getState().workspace, recipePlans: { recipe: '5' } }); await settle()
    expect(f.values.get(GOALS_STORAGE_KEY)).toBe(legacy)
    expect(JSON.parse(f.values.get(COMPANION_WORKSPACE_KEY)!)).toMatchObject({ format: 'idle-slayer-companion-workspace-storage', legacyBaseline: legacy, workspace: { recipePlans: { recipe: '5' } } })
  })
  it('preserves the prior portable development format without startup rewrites', () => {
    const raw = JSON.stringify(workspace())
    const f = fixture({ raw })
    expect(f.session.getState().workspace).toEqual(workspace())
    expect(f.values.get(COMPANION_WORKSPACE_KEY)).toBe(raw)
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it('keeps unknown reference identities and recipe plans when accepting another observation', async () => {
    const f = fixture({ raw: wrapped() })
    const previous = f.session.getState().workspace
    f.session.edit({ ...previous, goals: [...previous.goals, { ref: { system: 'enemy', id: 'future-enemy' }, mode: 'mastery' }] }, previous); await settle()
    expect(f.session.getState().workspace.recipePlans).toEqual({ 'future-recipe': '3' })
    expect(f.session.getState().workspace.goals).toHaveLength(2)
    expect(parseCompanionWorkspace(JSON.stringify(f.session.getState().workspace))).toEqual(f.session.getState().workspace)
  })
  it('rejects a stale list even if the new edit concerns another system', async () => {
    const f = fixture()
    const baseline = f.session.getState().workspace
    f.session.edit(workspace('first'), baseline); await settle()
    expect(f.session.edit(workspace('stale'), baseline)).toBe(false)
    expect(f.session.getState().workspace.goals[0].ref.id).toBe('first')
  })
  it('never substitutes a valid legacy goals list for a corrupt authoritative workspace', async () => {
    const f = fixture({ raw: '{corrupt}', legacy })
    expect(f.session.getState()).toMatchObject({ readable: false, conflict: true, workspace: emptyCompanionWorkspace() })
    f.session.edit(workspace()); await settle()
    expect(f.values.get(COMPANION_WORKSPACE_KEY)).toBe('{corrupt}')
    expect(f.session.getState().workspace).toEqual(workspace())
    expect(f.session.getState().dirty).toBe(true)
  })
  it('detects older map writers across reloads from the retained exact legacy baseline', () => {
    const f = fixture({ raw: wrapped(workspace(), legacy), legacy: JSON.stringify({ version: 1, targets: [] }) })
    expect(f.session.getState()).toMatchObject({ conflict: true, dirty: true, workspace: workspace() })
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.useSaved()).toBe(false)
    expect(f.session.getState().workspace).toEqual(workspace())
  })
  it('requires a checked review before adopting saved intentions and acknowledges old writers under the lock', async () => {
    const changedLegacy = JSON.stringify({ version: 1, targets: [] })
    const f = fixture({ raw: wrapped(workspace(), legacy), legacy: changedLegacy })
    const draft = f.session.review()
    expect(draft.snapshot.kind).toBe('valid')
    expect(f.session.useSaved(draft)).toBe(true)
    await settle()
    expect(f.session.getState()).toMatchObject({ conflict: false, dirty: false })
    expect(JSON.parse(f.values.get(COMPANION_WORKSPACE_KEY)!).legacyBaseline).toBe(changedLegacy)
    expect(f.values.get(GOALS_STORAGE_KEY)).toBe(changedLegacy)
  })
  it('keeps an unsaved older-writer acknowledgement dirty until its private baseline is persisted', async () => {
    const changedLegacy = JSON.stringify({ version: 1, targets: [] })
    const f = fixture({ raw: wrapped(workspace(), legacy), legacy: changedLegacy })
    f.writesFail(true)
    expect(f.session.useSaved(f.session.review())).toBe(true)
    await settle()
    expect(f.session.getState()).toMatchObject({ conflict: false, dirty: true })
    expect(f.session.getState().error).toContain('could not be saved')
    f.writesFail(false)
    expect(await f.session.save()).toBe(true)
    expect(fixture({ raw: f.values.get(COMPANION_WORKSPACE_KEY), legacy: changedLegacy }).session.getState()).toMatchObject({ conflict: false, dirty: false })
  })
  it('offers an exact review of invalid saved data and permits deliberate guarded replacement', async () => {
    const f = fixture({ raw: '{corrupt}', legacy: '{corrupt-legacy}' })
    f.session.edit(workspace()); await settle()
    const draft = f.session.review()
    expect(draft.snapshot.kind).toBe('invalid')
    expect(f.session.useSaved(draft)).toBe(false)
    expect(await f.session.replaceSaved(draft)).toBe(true)
    expect(f.session.getState()).toMatchObject({ readable: true, dirty: false, conflict: false })
    expect(JSON.parse(f.values.get(COMPANION_WORKSPACE_KEY)!).workspace).toEqual(workspace())
    expect(f.values.get(GOALS_STORAGE_KEY)).toBe('{corrupt-legacy}')
    const portable = JSON.stringify(f.session.getState().workspace)
    expect(portable).not.toContain('legacyBaseline')
    expect(portable).not.toContain('corrupt-legacy')
  })
  it('refuses a saved replacement if either reviewed key changed before lock acquisition', async () => {
    const delayed = delayedLocks(), f = fixture({ raw: '{corrupt}', legacy }, delayed.locks)
    f.session.edit(workspace()); await settle()
    const draft = f.session.review()
    const saving = f.session.replaceSaved(draft)
    f.values.set(GOALS_STORAGE_KEY, 'changed-legacy')
    delayed.release(); expect(await saving).toBe(false)
    expect(f.values.get(COMPANION_WORKSPACE_KEY)).toBe('{corrupt}')
    expect(f.session.getState()).toMatchObject({ dirty: true, conflict: true, pending: false })
  })
  it('invalidates recovery on a later local edit and refuses forged drafts', async () => {
    const f = fixture({ raw: '{corrupt}' })
    const draft = f.session.review()
    f.session.edit(workspace()); await settle()
    expect(await f.session.replaceSaved(draft)).toBe(false)
    const fresh = f.session.review()
    expect(await f.session.replaceSaved({ ...fresh })).toBe(false)
    expect(f.values.get(COMPANION_WORKSPACE_KEY)).toBe('{corrupt}')
  })
  it('checks current raw bytes again before adopting a valid saved review', () => {
    const f = fixture({ raw: wrapped() })
    const draft = f.session.review()
    f.values.set(COMPANION_WORKSPACE_KEY, wrapped(workspace('later')))
    expect(f.session.useSaved(draft)).toBe(false)
    expect(f.session.getState().workspace).toEqual(workspace('later'))
  })
  it('supersedes a pending save when another tab writes without dropping the local workspace', async () => {
    const delayed = delayedLocks(), f = fixture({}, delayed.locks)
    f.session.edit(workspace('local'))
    f.values.set(COMPANION_WORKSPACE_KEY, wrapped(workspace('external')))
    f.session.refreshExternal(); delayed.release(); await settle()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.session.getState()).toMatchObject({ workspace: workspace('local'), conflict: true, pending: false })
  })
  it('adopts a clean external workspace atomically and does not resurrect old goals after deletion', () => {
    const f = fixture({ raw: wrapped(workspace(), legacy), legacy })
    f.values.set(COMPANION_WORKSPACE_KEY, wrapped(workspace('external'), legacy)); f.session.refreshExternal()
    expect(f.session.getState()).toMatchObject({ workspace: workspace('external'), dirty: false })
    f.values.delete(COMPANION_WORKSPACE_KEY); f.session.refreshExternal()
    expect(f.session.getState().workspace).toEqual(emptyCompanionWorkspace())
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })
  it.each(['missing-lock', 'busy-lock', 'quota'] as const)('retains exportable memory after %s', async (condition) => {
    const f = fixture({}, condition === 'missing-lock' ? false : condition === 'busy-lock' ? { request: async (_name, _options, callback) => callback(null) } : undefined)
    if (condition === 'quota') f.writesFail(true)
    f.session.edit(workspace()); await settle()
    expect(f.session.getState()).toMatchObject({ workspace: workspace(), dirty: true, pending: false })
    expect(parseCompanionWorkspace(JSON.stringify(f.session.getState().workspace))).toEqual(workspace())
    expect(f.values.has(COMPANION_WORKSPACE_KEY)).toBe(false)
  })
  it('keeps unreadable storage untouched and supports fresh explicit recovery once reads return', async () => {
    const f = fixture({ raw: wrapped(workspace('saved')) })
    f.readsFail(true); f.session.refreshExternal()
    f.session.edit(workspace('local')); await settle()
    expect(await f.session.replaceSaved(f.session.review())).toBe(false)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    f.readsFail(false)
    expect(await f.session.replaceSaved(f.session.review())).toBe(true)
    expect(JSON.parse(f.values.get(COMPANION_WORKSPACE_KEY)!).workspace).toEqual(workspace('local'))
  })
})

describe('intentions format limits', () => {
  it('bounds the combined goal list at twenty across systems', () => {
    const value = emptyCompanionWorkspace()
    value.goals = Array.from({ length: 20 }, (_, index) => ({ ref: { system: 'achievement', id: `future-${index}` }, mode: 'complete' }))
    expect(parseCompanionWorkspace(JSON.stringify(value))).toEqual(value)
    value.goals.push({ ref: { system: 'divinity', id: 'divinity' }, mode: 'select' })
    expect(() => parseCompanionWorkspace(JSON.stringify(value))).toThrow()
  })
  it.each([
    { ref: { system: 'achievement', id: 'a' }, mode: 'rebuild' },
    { ref: { system: 'ascension', id: 'a' }, mode: 'select' },
    { ref: { system: 'enemy', id: '__proto__' }, mode: 'mastery' },
    { ref: { system: 'unknown', id: 'a' }, mode: 'complete' },
  ])('rejects unsupported modes or identities %s', (goal) => {
    expect(() => parseCompanionWorkspace(JSON.stringify({ ...emptyCompanionWorkspace(), goals: [goal] }))).toThrow()
  })
  it('rejects malformed plans, duplicate goals and unrelated private fields', () => {
    for (const recipePlans of [{ recipe: 1 }, { recipe: '0' }, { recipe: '-1' }, { recipe: '1e4' }, JSON.parse('{"__proto__":"2"}')]) expect(() => parseCompanionWorkspace(JSON.stringify({ ...emptyCompanionWorkspace(), recipePlans }))).toThrow()
    expect(() => parseCompanionWorkspace(JSON.stringify({ ...workspace(), goals: [...workspace().goals, ...workspace().goals] }))).toThrow()
    expect(() => parseCompanionWorkspace(JSON.stringify({ ...workspace(), nativePreferences: 'private' }))).toThrow()
  })
})
