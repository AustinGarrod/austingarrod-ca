import { describe, expect, it } from 'vitest'
import { createBackupBundle, detectBackup, MAX_BUNDLE_BYTES } from './backup-bundle'
import { exportCompanionBackup, parseCompanionBackup } from './companion-storage'
import { emptyCompanionProgress } from './companion-progress'
import { emptyCompanionWorkspace, parseCompanionWorkspace } from './companion-workspace'
import { emptyCheckpoints, exportCheckpoints, parseCheckpoints } from './checkpoints'
import { emptyComparison, exportComparison, parseComparison } from './saved-comparison'
import { emptyProfile } from './types'
import { exportProfileBackup, parseProfileBackup } from './storage'

const revision = 'test-revision'
function documents() {
  const progress = emptyCompanionProgress(revision); progress.ascension.epoch = 3; progress.modules.achievement = { tracked: true, records: { a1: { completed: true } } }
  const workspace = { ...emptyCompanionWorkspace(), goals: [{ ref: { system: 'achievement' as const, id: 'a1' }, mode: 'complete' as const }] }
  const progressText = exportCompanionBackup(progress)
  if (!progressText.ok) throw new Error('fixture')
  return {
    progress: progressText.value,
    intentions: JSON.stringify(workspace, null, 2),
    checkpoints: exportCheckpoints(emptyCheckpoints(), revision)!,
    comparison: exportComparison({ ...emptyComparison(), ids: ['start', 'future-upgrade'] }),
  }
}

describe('backup bundle', () => {
  it('holds all four documents and gives each back in a form its own parser accepts', () => {
    const parts = documents()
    const detected = detectBackup(createBackupBundle(parts, new Date('2026-11-27T10:00:00Z')))
    expect(detected.kind).toBe('bundle')
    if (detected.kind !== 'bundle') return
    expect(detected.exportedAt).toBe('2026-11-27T10:00:00.000Z')
    expect(Object.keys(detected.parts).sort()).toEqual(['checkpoints', 'comparison', 'intentions', 'progress'])
    const progress = parseCompanionBackup(detected.parts.progress!, revision)
    expect(progress.ok && progress.value.ascension.epoch).toBe(3)
    expect(parseCompanionWorkspace(detected.parts.intentions!).goals).toHaveLength(1)
    expect(parseCheckpoints(detected.parts.checkpoints!, revision)).toEqual(emptyCheckpoints())
    // Unknown comparison IDs survive the bundle exactly as the single export keeps them.
    expect(parseComparison(detected.parts.comparison!)?.ids).toEqual(['start', 'future-upgrade'])
  })

  it('leaves out a part that could not be exported instead of inventing an empty one', () => {
    const { progress, intentions } = documents()
    const detected = detectBackup(createBackupBundle({ progress, intentions }, new Date(0)))
    expect(detected.kind === 'bundle' && Object.keys(detected.parts).sort()).toEqual(['intentions', 'progress'])
  })

  it('recognises each single export by its own format or kind marker', () => {
    const parts = documents()
    expect(detectBackup(parts.progress)).toEqual({ kind: 'progress', text: parts.progress })
    expect(detectBackup(parts.intentions).kind).toBe('intentions')
    expect(detectBackup(parts.checkpoints).kind).toBe('checkpoints')
    expect(detectBackup(parts.comparison).kind).toBe('comparison')
  })

  it('recognises the original Ascension Map file by its shape, which its own parser still validates', () => {
    const profile = { ...emptyProfile(revision), epoch: 2, purchases: { start: { epoch: 2, active: true } } }
    const exported = exportProfileBackup(profile)
    if (!exported.ok) throw new Error('fixture')
    const detected = detectBackup(exported.text)
    expect(detected.kind).toBe('legacy-map')
    expect(detected.kind === 'legacy-map' && parseProfileBackup(detected.text, revision).ok).toBe(true)
  })

  it('rejects broken, oversized, unrelated and mislabelled files without guessing', () => {
    expect(detectBackup('{broken')).toEqual({ kind: 'unknown', reason: 'invalid-json' })
    expect(detectBackup(JSON.stringify({ hello: 'world' }))).toEqual({ kind: 'unknown', reason: 'unrecognized' })
    expect(detectBackup('[]')).toEqual({ kind: 'unknown', reason: 'unrecognized' })
    expect(detectBackup(' '.repeat(MAX_BUNDLE_BYTES + 1))).toEqual({ kind: 'unknown', reason: 'too-large' })
    const parts = documents()
    const swapped = JSON.parse(createBackupBundle(parts, new Date(0)))
    swapped.documents.progress = JSON.parse(parts.comparison)
    expect(detectBackup(JSON.stringify(swapped)).kind).toBe('unknown')
    const extra = JSON.parse(createBackupBundle(parts, new Date(0))); extra.documents.saves = {}
    expect(detectBackup(JSON.stringify(extra)).kind).toBe('unknown')
    const empty = JSON.parse(createBackupBundle({}, new Date(0)))
    expect(detectBackup(JSON.stringify(empty)).kind).toBe('unknown')
    expect(detectBackup(JSON.stringify({ format: 'idle-slayer-companion-backup', version: 2, exportedAt: '', documents: {} })).kind).toBe('unknown')
  })
})
