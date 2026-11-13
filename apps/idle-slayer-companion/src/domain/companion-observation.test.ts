import { describe, expect, it } from 'vitest'
import catalogData from '../../public/catalog.json'
import companionData from '../../public/companion-catalog.json'
import { emptyCompanionProgress, getCompanionRecord, recordCompanionEntity } from './companion-progress'
import { planCompanionObservation } from './companion-observation'
import type { CompanionCatalog } from './companion-types'
import type { Catalog, Requirement, Upgrade } from './types'
import { satisfies } from './rules'

const timestamp = '2026-10-16T12:00:00Z'
const always: Requirement = { kind: 'always' }
const item: Requirement = { kind: 'milestone', id: 'shared-item' }
function node(id: string, purchase: Requirement, retention: Upgrade['retention'] = 'repeat'): Upgrade {
  return { id, title: 'Synthetic upgrade', description: '', cost: '1', icon: '', position: { x: 0, y: 0 }, purchase, reveal: always, retention, activation: 'immediate', sources: [] }
}
const map: Catalog = {
  revision: 'fixture', gameVersion: 'synthetic', steamBuild: 'synthetic', startId: 'alternate', ultraAscension: always,
  milestones: [{ id: 'shared-item', title: 'Synthetic item', description: '', reveal: always, sources: [] }], connections: [],
  upgrades: [node('alternate', always), node('or-path', { kind: 'any', requirements: [item, { kind: 'owned', id: 'alternate' }] }), node('current-astral', item, 'astral'), node('older-astral', item, 'astral'), node('child', { kind: 'owned', id: 'current-astral' }), node('older-repeat', item), node('older-retained', item)],
  grants: [{ when: { kind: 'active', id: 'alternate' }, ids: ['older-retained'] }],
  verification: { coverage: true, purchaseRules: true, revealRules: true, resetRules: true, assets: true, evidence: [] },
}
function fixture() {
  let progress = recordCompanionEntity(emptyCompanionProgress('fixture'), 'craft', 'shared-item', { completed: true }, timestamp)
  progress = recordCompanionEntity(progress, 'craft', 'other-item', { completed: true }, timestamp)
  progress = recordCompanionEntity(progress, 'material', 'material', { count: '27', discovered: true }, timestamp)
  progress.ascension.epoch = 2
  progress.ascension.purchases = Object.fromEntries(map.upgrades.map((upgrade) => [upgrade.id, { epoch: upgrade.id.startsWith('older-') ? 1 : 2, active: true }]))
  progress.ascension.purchases['future-upgrade'] = { epoch: 0, active: false }
  progress.ascension.milestones['future-milestone'] = true
  return progress
}

describe('Companion observations and shared Ascension item corrections', () => {
  it('requires a review and preserves valid OR paths, earlier Astrals, earlier retained purchases and unrelated observations', () => {
    const progress = fixture(), original = structuredClone(progress)
    const result = planCompanionObservation(map, progress, 'craft', 'shared-item', { completed: false }, timestamp)
    if (!result.ok) throw new Error(result.error)
    expect(result.requiresPreview).toBe(true)
    expect(result.removedUpgradeIds).toEqual(['current-astral', 'child', 'older-repeat'])
    expect(Object.keys(result.progress.ascension.purchases)).toEqual(['alternate', 'or-path', 'older-astral', 'older-retained', 'future-upgrade'])
    expect(result.progress.ascension.milestones).toEqual({ 'other-item': true, 'future-milestone': true })
    expect(getCompanionRecord(result.progress, 'craft', 'shared-item')).toEqual({ completed: false })
    expect(getCompanionRecord(result.progress, 'craft', 'other-item')).toEqual({ completed: true })
    expect(result.progress.modules.material).toEqual(progress.modules.material)
    expect(progress).toEqual(original)
  })
  it('still reviews a shared correction with no dependent purchases to clear', () => {
    const progress = fixture()
    progress.ascension.purchases = {}
    const result = planCompanionObservation(map, progress, 'craft', 'shared-item', { completed: false }, timestamp)
    expect(result).toMatchObject({ ok: true, requiresPreview: true, removedUpgradeIds: [] })
  })
  it('ordinary observations neither clear purchases nor consume materials or award other completions', () => {
    const progress = fixture()
    for (const [system, id, patch] of [
      ['craft', 'other-item', { completed: false }], ['craft', 'new-item', { completed: true }],
      ['quest', 'quest', { completed: true, claimed: true }], ['material', 'material', { count: '28' }],
    ] as const) {
      const result = planCompanionObservation(map, progress, system, id, patch, timestamp)
      if (!result.ok) throw new Error(result.error)
      expect(result.requiresPreview).toBe(false)
      expect(result.removedUpgradeIds).toEqual([])
      expect(result.progress.ascension.purchases).toBe(progress.ascension.purchases)
      if (system !== 'material') expect(result.progress.modules.material).toBe(progress.modules.material)
      expect(result.progress.modules.achievement).toBe(progress.modules.achievement)
    }
  })
  it('refuses to bypass dependency review without the map when any Ascension purchases exist', () => {
    const progress = fixture()
    const result = planCompanionObservation(null, progress, 'craft', 'shared-item', { completed: false }, timestamp)
    expect(result).toEqual({ ok: false, error: 'Load the Ascension catalog before removing a recorded item while Ascension purchases are recorded. Progress was kept.' })
    expect(progress.ascension.milestones['shared-item']).toBe(true)
    // Unknown purchases cannot be assumed independent of a missing catalog.
    progress.ascension.purchases = { 'future-upgrade': { epoch: 0, active: true } }
    expect(planCompanionObservation(null, progress, 'craft', 'shared-item', { completed: false }, timestamp).ok).toBe(false)
    expect(planCompanionObservation(null, progress, 'achievement', 'shared-item', { completed: false }, timestamp)).toMatchObject({ ok: true, requiresPreview: false })
    progress.ascension.purchases = {}
    expect(planCompanionObservation(null, progress, 'craft', 'shared-item', { completed: false }, timestamp)).toMatchObject({ ok: true, requiresPreview: false })
  })
  it('covers the actual three shared permanent crafts and their current purchase dependencies', () => {
    const native = catalogData as Catalog, companion = companionData as unknown as CompanionCatalog
    const overlap = native.milestones.filter((milestone) => companion.entities.some((entity) => entity.id === milestone.id && ['craft', 'village'].includes(entity.system)))
    expect(overlap.map((entry) => entry.title)).toEqual(['Armory', 'Book of Death Pact', 'Crate'])
    const id = (title: string) => native.upgrades.find((entry) => entry.title === title)!.id
    for (const [title, current, expected] of [
      ['Armory', 'Chest In a Chest', ['Chest In a Chest', "Mimic's Corpse", 'Multiplier Manifest', 'Great Loot']],
      ['Book of Death Pact', 'Silver Spirit', ['Silver Spirit']],
      ['Crate', 'Steel Crate', ['Advanced Dark Divinities', 'Advanced Divinities', 'Cutting-edge Divinities', 'Boosted Swing', 'Sneaky Stealer', 'Steel Crate']],
    ] as const) {
      const shared = overlap.find((entry) => entry.title === title)!
      const progress = emptyCompanionProgress(native.revision)
      progress.ascension.epoch = 2
      progress.ascension.milestones = Object.fromEntries(native.milestones.map((entry) => [entry.id, true]))
      progress.ascension.purchases = Object.fromEntries(native.upgrades.map((upgrade) => [upgrade.id, { epoch: upgrade.activation === 'after-ultra-ascension' ? 1 : 2, active: true }]))
      const result = planCompanionObservation(native, progress, 'craft', shared.id, { completed: false }, timestamp)
      if (!result.ok) throw new Error(result.error)
      expect(result.requiresPreview).toBe(true)
      expect(result.removedUpgradeIds.map((upgradeId) => native.upgrades.find((upgrade) => upgrade.id === upgradeId)!.title)).toEqual(expected)
      expect(result.progress.ascension.purchases[id(current)]).toBeUndefined()
      expect(satisfies(native.upgrades.find((upgrade) => upgrade.id === id(current))!.purchase, result.progress.ascension)).toBe(false)
      if (title === 'Book of Death Pact') expect(result.progress.ascension.purchases[id('Sacred Tome of Death Pact')]).toEqual(progress.ascension.purchases[id('Sacred Tome of Death Pact')])
      if (title !== 'Book of Death Pact') {
        progress.ascension.purchases[id(current)].epoch = 1
        const retained = planCompanionObservation(native, progress, 'craft', shared.id, { completed: false }, timestamp)
        if (!retained.ok) throw new Error(retained.error)
        expect(retained.progress.ascension.purchases[id(current)]).toEqual({ epoch: 1, active: true })
      }
    }
  })
})
