import { describe, expect, it } from 'vitest'
import { emptyCompanionProgress, getCompanionRecord, recordCompanionEntity } from './companion-progress'
import { exportCompanionBackup, exportCompanionStored, MAX_COMPANION_BYTES, parseCompanionBackup, parseCompanionStored } from './companion-storage'
import { exportProfileBackup } from './storage'

describe('companion progress portability', () => {
  it('round trips all seven modules, unknown identities and arbitrary-precision counters', () => {
    let progress = emptyCompanionProgress('old')
    progress = recordCompanionEntity(progress, 'achievement', 'future-achievement', { completed: false, count: '0' })
    progress = recordCompanionEntity(progress, 'material', 'future-material', { count: '123456789012345678901234567890' })
    progress = recordCompanionEntity(progress, 'quest', 'future-quest', { claimed: false })
    progress = recordCompanionEntity(progress, 'village', 'future-building', { built: true })
    progress = recordCompanionEntity(progress, 'enemy', 'future-enemy', { discovered: true, stage: '3' })
    progress = recordCompanionEntity(progress, 'divinity', 'future-divinity', { selected: true, active: false })
    const backup = exportCompanionBackup(progress)
    expect(backup.ok).toBe(true)
    if (!backup.ok) return
    const parsed = parseCompanionBackup(backup.value, 'new')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual({ ...progress, catalogRevision: 'new', ascension: { ...progress.ascension, catalogRevision: 'new' } })
    expect(parsed.value.modules.craft.records).toEqual({})
    expect(parsed.value.modules.craft.tracked).toBe(false)
  })
  it('normalizes item ownership into the shared map fact when accepting a portable record', () => {
    const progress = emptyCompanionProgress('fixture')
    progress.modules.craft.records.item = { completed: true }
    const parsed = parseCompanionBackup(JSON.stringify(progress))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.ascension.milestones.item).toBe(true)
    expect(parsed.value.modules.craft.records.item).toEqual({ completed: false })
    expect(getCompanionRecord(parsed.value, 'craft', 'item').completed).toBe(true)
  })
  it.each([
    (value: Record<string, unknown>) => { value.unrelated = 'preference' },
    (value: Record<string, unknown>) => { value.version = 2 },
    (value: Record<string, unknown>) => { value.modules = {} },
    (value: Record<string, unknown>) => { (value.modules as Record<string, unknown>).unreviewed = { tracked: true, records: {} } },
  ])('rejects unsupported envelopes', (mutate) => {
    const value = structuredClone(emptyCompanionProgress('fixture')) as unknown as Record<string, unknown>
    mutate(value)
    expect(parseCompanionBackup(JSON.stringify(value)).ok).toBe(false)
  })
  it.each([{ count: 0 }, { count: '-1' }, { count: '1e4' }, { count: '01' }, { count: null }, { completed: null }, { stage: '2.5' }, { filename: 'private' }])('rejects malformed records %s', (record) => {
    const value = emptyCompanionProgress('fixture')
    value.modules.enemy.records.id = record as never
    expect(parseCompanionBackup(JSON.stringify(value)).ok).toBe(false)
  })
  it('rejects poisoned identities and excessive input without echoing its contents', () => {
    const raw = JSON.stringify(emptyCompanionProgress('fixture')).replace('"records":{}', '"records":{"__proto__":{"completed":true}}')
    expect(parseCompanionBackup(raw).ok).toBe(false)
    expect(parseCompanionBackup('private-text').ok).toBe(false)
    expect(parseCompanionBackup(' '.repeat(MAX_COMPANION_BYTES + 1))).toMatchObject({ ok: false, error: { kind: 'too-large' } })
  })
  it('keeps the exact legacy migration baseline only in the device envelope', () => {
    const progress = emptyCompanionProgress('fixture')
    const legacy = exportProfileBackup(progress.ascension)
    if (!legacy.ok) throw new Error('Synthetic profile must export')
    const stored = exportCompanionStored({ progress, legacyBaseline: legacy.text })
    expect(stored.ok).toBe(true)
    if (!stored.ok) return
    expect(parseCompanionStored(stored.value, 'fixture')).toEqual({ ok: true, value: { progress, legacyBaseline: legacy.text } })
    const backup = exportCompanionBackup(progress)
    if (!backup.ok) throw new Error('Synthetic progress must export')
    expect(JSON.parse(backup.value)).not.toHaveProperty('legacyBaseline')
    expect(parseCompanionBackup(stored.value).ok).toBe(false)
    expect(parseCompanionStored(backup.value, 'fixture').ok).toBe(false)
  })
})
