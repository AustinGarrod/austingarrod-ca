import { describe, expect, it, vi } from 'vitest'
import { createRetirementExports, type RetirementExportKind } from './retirement-exports'
import { CHECKPOINT_STORAGE_KEY, emptyCheckpoints } from '../src/domain/checkpoints'
import { emptyCompanionProgress } from '../src/domain/companion-progress'
import { COMPANION_STORAGE_KEY } from '../src/domain/companion-storage'
import { COMPANION_WORKSPACE_KEY, emptyCompanionWorkspace, parseCompanionWorkspaceStored } from '../src/domain/companion-workspace'
import { GOALS_STORAGE_KEY } from '../src/domain/goals'
import { COMPARISON_STORAGE_KEY, emptyComparison } from '../src/domain/saved-comparison'
import { PROFILE_STORAGE_KEY } from '../src/domain/storage'
import { emptyProfile, type Catalog, type Upgrade } from '../src/domain/types'

const upgrade = (id: string, hidden = false): Upgrade => ({
  id, title: id, description: '', cost: '1', icon: '', position: { x: 0, y: 0 },
  purchase: { kind: 'always' }, reveal: hidden ? { kind: 'milestone', id: 'secret-receipt' } : { kind: 'always' },
  retention: 'repeat', activation: 'immediate', sources: [],
})
const catalog: Catalog = {
  revision: 'reviewed-current', gameVersion: 'fixture', steamBuild: 'fixture', startId: 'visible',
  upgrades: [upgrade('visible'), upgrade('hidden', true)], milestones: [], connections: [], grants: [], ultraAscension: { kind: 'always' },
  verification: { coverage: false, purchaseRules: false, revealRules: false, resetRules: false, assets: false, evidence: [] },
}
const canonicalProgress = (progress = emptyCompanionProgress('prior-review'), legacyBaseline: string | null = null) => JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, progress, legacyBaseline })
const canonicalWorkspace = (workspace = emptyCompanionWorkspace(), legacyBaseline: string | null = null) => JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, workspace, legacyBaseline })
const legacyGoals = JSON.stringify({ version: 1, targets: [{ id: 'future-upgrade', mode: 'activate' }] })

function fixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const failedKeys = new Set<string>()
  const storage = {
    getItem: vi.fn((key: string) => { if (failedKeys.has(key)) throw new Error('PRIVATE synthetic storage failure'); return values.get(key) ?? null }),
    setItem: vi.fn(() => { throw new Error('Exports must not write') }),
    removeItem: vi.fn(() => { throw new Error('Exports must not remove') }),
    clear: vi.fn(() => { throw new Error('Exports must not clear') }),
  }
  const exports = createRetirementExports({ storage: () => storage, catalog })
  return { values, storage, failedKeys, exports }
}
function downloaded(f: ReturnType<typeof fixture>, kind: RetirementExportKind) {
  const result = f.exports.export(kind)
  if (!result.ok) throw new Error(result.message)
  return { ...result, value: JSON.parse(result.text) }
}

describe('retirement exports without editable sessions', () => {
  it('exports all four normalized formats, preserving unknown records without device metadata or storage writes', () => {
    const progress = emptyCompanionProgress('prior-review')
    progress.ascension.purchases['future-upgrade'] = { epoch: 0, active: false }
    progress.modules.material = { tracked: true, records: { 'future-material': { count: '12345678901234567890' } } }
    const workspace = { ...emptyCompanionWorkspace(), goals: [{ ref: { system: 'enemy' as const, id: 'future-enemy' }, mode: 'mastery' as const }], recipePlans: { 'future-recipe': '3' } }
    const checkpoints = { ...emptyCheckpoints(), entries: [{ id: 'one', name: 'PRIVATE snapshot name', capturedRevision: 'prior-review', profile: progress.ascension }] }
    const f = fixture({
      [COMPANION_STORAGE_KEY]: canonicalProgress(progress), [COMPANION_WORKSPACE_KEY]: canonicalWorkspace(workspace),
      [CHECKPOINT_STORAGE_KEY]: JSON.stringify(checkpoints), [COMPARISON_STORAGE_KEY]: JSON.stringify({ ...emptyComparison(), ids: ['visible', 'future-upgrade'] }),
    })
    const before = [...f.values]
    expect(Object.values(f.exports.read().exports).filter((row) => row.status === 'ready')).toHaveLength(4)
    const exportedProgress = downloaded(f, 'progress')
    expect(exportedProgress.format).toBe('companion')
    expect(exportedProgress.value).toEqual({ ...progress, catalogRevision: catalog.revision, ascension: { ...progress.ascension, catalogRevision: catalog.revision } })
    expect(exportedProgress.text).not.toContain('legacyBaseline')
    expect(downloaded(f, 'intentions').value).toEqual(workspace)
    expect(downloaded(f, 'checkpoints').value.entries[0]).toEqual({ ...checkpoints.entries[0], profile: { ...progress.ascension, catalogRevision: catalog.revision } })
    expect(downloaded(f, 'comparison').value.ids).toEqual(['visible', 'future-upgrade'])
    expect(JSON.stringify(f.exports.read())).not.toMatch(/PRIVATE|future-material|future-enemy|future-upgrade/)
    expect([...f.values]).toEqual(before)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.storage.removeItem).not.toHaveBeenCalled()
    expect(f.storage.clear).not.toHaveBeenCalled()
  })

  it('distinguishes missing documents from saved empty documents without creating substitute backups', () => {
    const f = fixture()
    expect(Object.values(f.exports.read().exports).every((row) => row.status === 'missing')).toBe(true)
    expect(f.exports.export('progress').ok).toBe(false)
    f.values.set(CHECKPOINT_STORAGE_KEY, JSON.stringify(emptyCheckpoints()))
    expect(downloaded(f, 'checkpoints').value).toEqual(emptyCheckpoints())
  })

  it('keeps legacy-only progress in the existing map format and normalizes legacy goals into intentions', () => {
    const profile = emptyProfile('prior-review')
    profile.purchases['future-upgrade'] = { epoch: 0, active: true }
    const f = fixture({ [PROFILE_STORAGE_KEY]: JSON.stringify(profile), [GOALS_STORAGE_KEY]: legacyGoals })
    const map = downloaded(f, 'progress')
    expect(map.format).toBe('map')
    expect(map.value).toEqual({ ...profile, catalogRevision: catalog.revision })
    expect(map.value.modules).toBeUndefined()
    expect(downloaded(f, 'intentions').value).toEqual({ ...emptyCompanionWorkspace(), goals: [{ ref: { system: 'ascension', id: 'future-upgrade' }, mode: 'activate' }] })
    expect(f.exports.read().exports['legacy-map'].status).toBe('missing')
  })

  it('does not substitute valid legacy data for malformed canonical documents, but preserves explicit recovery exports', () => {
    const f = fixture({ [COMPANION_STORAGE_KEY]: '{PRIVATE invalid}', [PROFILE_STORAGE_KEY]: JSON.stringify(emptyProfile('old')), [COMPANION_WORKSPACE_KEY]: '{PRIVATE invalid}', [GOALS_STORAGE_KEY]: legacyGoals, [COMPARISON_STORAGE_KEY]: JSON.stringify({ ...emptyComparison(), ids: ['visible'] }) })
    const snapshot = f.exports.read()
    expect(snapshot.exports.progress.status).toBe('invalid')
    expect(snapshot.exports.intentions.status).toBe('invalid')
    expect(snapshot.exports.comparison.status).toBe('invalid')
    expect(f.exports.export('progress').ok).toBe(false)
    expect(f.exports.export('intentions').ok).toBe(false)
    expect(downloaded(f, 'legacy-map').filename).toBe('idle-slayer-changed-legacy-map.json')
    expect(downloaded(f, 'legacy-intentions').value.goals[0].ref.id).toBe('future-upgrade')
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
    expect(f.values.get(COMPANION_STORAGE_KEY)).toBe('{PRIVATE invalid}')
  })

  it('never resurrects old data after a canonical document is removed during the visit', () => {
    const f = fixture({ [COMPANION_STORAGE_KEY]: canonicalProgress(), [PROFILE_STORAGE_KEY]: JSON.stringify(emptyProfile('old')), [COMPANION_WORKSPACE_KEY]: canonicalWorkspace(), [GOALS_STORAGE_KEY]: legacyGoals })
    f.exports.read()
    f.values.delete(COMPANION_STORAGE_KEY); f.values.delete(COMPANION_WORKSPACE_KEY)
    expect(f.exports.read().exports).toMatchObject({ progress: { status: 'invalid' }, intentions: { status: 'invalid' }, 'legacy-map': { status: 'ready' }, 'legacy-intentions': { status: 'ready' } })
    expect(f.exports.export('progress').ok).toBe(false)
    expect(f.exports.export('intentions').ok).toBe(false)
  })

  it('does not reveal known hidden comparison entries and retains unknown IDs', () => {
    const f = fixture({ [COMPANION_STORAGE_KEY]: canonicalProgress(), [COMPARISON_STORAGE_KEY]: JSON.stringify({ ...emptyComparison(), ids: ['visible', 'hidden', 'future-upgrade'] }) })
    expect(downloaded(f, 'comparison').value.ids).toEqual(['visible', 'future-upgrade'])
    const progress = emptyCompanionProgress(catalog.revision)
    progress.ascension.showSpoilers = true
    f.values.set(COMPANION_STORAGE_KEY, canonicalProgress(progress))
    expect(downloaded(f, 'comparison').value.ids).toEqual(['visible', 'hidden', 'future-upgrade'])
    progress.ascension.showSpoilers = false
    f.values.set(COMPANION_STORAGE_KEY, canonicalProgress(progress))
    expect(downloaded(f, 'comparison').value.ids).toEqual(['visible', 'future-upgrade'])
  })

  it('uses default visibility when no progress exists and never borrows checkpoint spoiler visibility', () => {
    const profile = { ...emptyProfile('old'), showSpoilers: true }
    const checkpoints = { ...emptyCheckpoints(), entries: [{ id: 'one', name: 'Past spoilers', capturedRevision: 'old', profile }] }
    const f = fixture({ [CHECKPOINT_STORAGE_KEY]: JSON.stringify(checkpoints), [COMPARISON_STORAGE_KEY]: JSON.stringify({ ...emptyComparison(), ids: ['hidden', 'future-upgrade'] }) })
    expect(downloaded(f, 'comparison').value.ids).toEqual(['future-upgrade'])
    expect(downloaded(f, 'checkpoints').value.entries[0].profile.showSpoilers).toBe(true)
  })

  it('keeps canonical documents primary when older writers diverge and exports alternatives without merging', () => {
    const oldMap = JSON.stringify(emptyProfile('old')), newerMap = JSON.stringify({ ...emptyProfile('old'), epoch: 4 })
    const oldGoals = JSON.stringify({ version: 1, targets: [] })
    const workspace = { ...emptyCompanionWorkspace(), recipePlans: { recipe: '7' } }
    const f = fixture({ [COMPANION_STORAGE_KEY]: canonicalProgress(undefined, oldMap), [PROFILE_STORAGE_KEY]: oldMap, [COMPANION_WORKSPACE_KEY]: canonicalWorkspace(workspace, oldGoals), [GOALS_STORAGE_KEY]: oldGoals })
    expect(f.exports.read().exports['legacy-map'].status).toBe('missing')
    expect(f.exports.read().exports['legacy-intentions'].status).toBe('missing')
    f.values.set(PROFILE_STORAGE_KEY, newerMap); f.values.set(GOALS_STORAGE_KEY, legacyGoals)
    expect(f.exports.read().warnings).toHaveLength(2)
    expect(downloaded(f, 'progress').value.ascension.epoch).toBe(0)
    expect(downloaded(f, 'legacy-map').value.epoch).toBe(4)
    expect(downloaded(f, 'intentions').value.recipePlans).toEqual({ recipe: '7' })
    expect(downloaded(f, 'legacy-intentions').value.recipePlans).toEqual({})
    expect(f.values.get(PROFILE_STORAGE_KEY)).toBe(newerMap)
    expect(JSON.parse(f.values.get(COMPANION_STORAGE_KEY)!).legacyBaseline).toBe(oldMap)
  })

  it('rejects unsupported checkpoint/comparison shapes and invalid legacy documents without altering bytes', () => {
    const f = fixture({ [PROFILE_STORAGE_KEY]: '{invalid}', [GOALS_STORAGE_KEY]: '{invalid}', [CHECKPOINT_STORAGE_KEY]: JSON.stringify({ ...emptyCheckpoints(), operation: 'invented' }), [COMPARISON_STORAGE_KEY]: JSON.stringify({ ...emptyComparison(), ids: ['visible', 'visible'] }) })
    const before = [...f.values]
    for (const kind of ['progress', 'intentions', 'checkpoints', 'comparison'] as const) expect(f.exports.read().exports[kind].status).toBe('invalid')
    expect([...f.values]).toEqual(before)
  })

  it('keeps independent exports available when another document cannot be read', () => {
    const f = fixture({ [COMPANION_STORAGE_KEY]: canonicalProgress(), [CHECKPOINT_STORAGE_KEY]: JSON.stringify(emptyCheckpoints()), [COMPARISON_STORAGE_KEY]: JSON.stringify(emptyComparison()) })
    f.failedKeys.add(COMPANION_STORAGE_KEY)
    expect(f.exports.read().exports.progress.status).toBe('unavailable')
    expect(f.exports.export('progress').ok).toBe(false)
    expect(f.exports.export('comparison').ok).toBe(false)
    expect(downloaded(f, 'checkpoints').value).toEqual(emptyCheckpoints())
  })

  it('cancels an export if a contributing key changes while its file is prepared', () => {
    const f = fixture({ [COMPANION_STORAGE_KEY]: canonicalProgress() })
    let reads = 0
    f.storage.getItem.mockImplementation((key) => {
      if (key === COMPANION_STORAGE_KEY && ++reads === 2) f.values.set(key, canonicalProgress({ ...emptyCompanionProgress('old'), ascension: { ...emptyProfile('old'), epoch: 2 } }))
      return f.values.get(key) ?? null
    })
    const result = f.exports.export('progress')
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('changed') })
    expect(downloaded(f, 'progress').value.ascension.epoch).toBe(2)
  })

  it('cancels a comparison export when current spoiler visibility changes during preparation', () => {
    const f = fixture({ [COMPANION_STORAGE_KEY]: canonicalProgress(), [COMPARISON_STORAGE_KEY]: JSON.stringify({ ...emptyComparison(), ids: ['hidden'] }) })
    let reads = 0
    f.storage.getItem.mockImplementation((key) => {
      if (key === COMPANION_STORAGE_KEY && ++reads === 2) {
        const progress = emptyCompanionProgress('old'); progress.ascension.showSpoilers = true
        f.values.set(key, canonicalProgress(progress))
      }
      return f.values.get(key) ?? null
    })
    expect(f.exports.export('comparison').ok).toBe(false)
    expect(downloaded(f, 'comparison').value.ids).toEqual(['hidden'])
  })

  it('validates both workspace storage forms without weakening wrapper or baseline limits', () => {
    const workspace = emptyCompanionWorkspace()
    expect(parseCompanionWorkspaceStored(JSON.stringify(workspace))).toEqual({ workspace })
    expect(parseCompanionWorkspaceStored(canonicalWorkspace(workspace, legacyGoals))).toEqual({ workspace, legacyBaseline: legacyGoals })
    expect(() => parseCompanionWorkspaceStored(canonicalWorkspace(workspace, 'x'.repeat(65537)))).toThrow()
    expect(() => parseCompanionWorkspaceStored(JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, workspace, legacyBaseline: null, extra: true }))).toThrow()
  })
})
