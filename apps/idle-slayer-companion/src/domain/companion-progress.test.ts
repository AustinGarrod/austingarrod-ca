import { describe, expect, it } from 'vitest'
import { emptyCompanionProgress, getCompanionRecord, migrateCompanionProgress, recordCompanionEntity, replaceAscensionProfile } from './companion-progress'
import { COMPANION_SYSTEMS } from './companion-types'
import { emptyProfile } from './types'

describe('observed companion progress', () => {
  it('starts every new module untracked, with unknown fields rather than false or zero', () => {
    const progress = emptyCompanionProgress('fixture')
    expect(Object.keys(progress.modules)).toEqual([...COMPANION_SYSTEMS])
    for (const system of COMPANION_SYSTEMS) {
      expect(progress.modules[system]).toEqual({ tracked: false, records: {} })
      expect(getCompanionRecord(progress, system, 'unobserved')).toEqual({})
    }
  })
  it('keeps one permanent item fact shared with the existing map', () => {
    const initial = emptyCompanionProgress('fixture')
    const owned = recordCompanionEntity(initial, 'craft', 'shared-native-id', { completed: true }, '2026-10-16T12:00:00Z')
    expect(owned.ascension.milestones).toEqual({ 'shared-native-id': true })
    expect(owned.modules.craft.records['shared-native-id'].completed).toBe(false)
    expect(getCompanionRecord(owned, 'craft', 'shared-native-id').completed).toBe(true)
    const cleared = recordCompanionEntity(owned, 'craft', 'shared-native-id', { completed: false })
    expect(cleared.ascension.milestones).toEqual({})
    expect(getCompanionRecord(cleared, 'craft', 'shared-native-id').completed).toBe(false)
    expect(initial.ascension.milestones).toEqual({})
  })
  it('recording a recipe or quest never changes recorded inventory or other rewards', () => {
    let progress = recordCompanionEntity(emptyCompanionProgress('fixture'), 'material', 'wood', { count: '8' })
    progress = recordCompanionEntity(progress, 'craft', 'recipe', { completed: true })
    progress = recordCompanionEntity(progress, 'quest', 'quest', { count: '5', completed: true, claimed: true })
    expect(progress.modules.material.records.wood).toEqual({ count: '8' })
    expect(progress.modules.achievement.records).toEqual({})
  })
  it('map-only replacement preserves companion item receipts while replacing the reviewed map universe', () => {
    let progress = recordCompanionEntity(emptyCompanionProgress('fixture'), 'craft', 'non-map-item', { completed: true })
    progress.ascension.milestones['map-item'] = true
    progress = recordCompanionEntity(progress, 'achievement', 'future-achievement', { completed: false })
    const next = replaceAscensionProfile(progress, emptyProfile('fixture'), ['map-item'])
    expect(next.ascension.milestones).toEqual({ 'non-map-item': true })
    expect(next.modules).toBe(progress.modules)
    expect(replaceAscensionProfile(progress, emptyProfile('fixture')).ascension.milestones).toEqual(progress.ascension.milestones)
  })
  it('catalog migration preserves unknown IDs and observation provenance without sharing mutable objects', () => {
    const progress = recordCompanionEntity(emptyCompanionProgress('old'), 'enemy', 'future-id', { count: '9007199254740993000', discovered: true }, '2026-10-16T12:00:00Z')
    const migrated = migrateCompanionProgress(progress, 'new')
    expect(migrated).toEqual({ ...progress, catalogRevision: 'new', ascension: { ...progress.ascension, catalogRevision: 'new' } })
    expect(migrated.modules).not.toBe(progress.modules)
  })
})
