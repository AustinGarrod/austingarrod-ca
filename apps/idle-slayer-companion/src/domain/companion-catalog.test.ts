import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { companionCatalogErrors, companionRequirementState, craftingShoppingList, deriveBestiaryMastery, visibleCompanionEntities } from './companion-catalog'
import { emptyCompanionProgress, recordCompanionEntity } from './companion-progress'
import type { Catalog } from './types'
import type { CompanionCatalog, CompanionEntity } from './companion-types'
const map = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const catalog = JSON.parse(readFileSync('public/companion-catalog.json', 'utf8')) as CompanionCatalog
const initial = emptyCompanionProgress(map.revision)
describe('companion catalog and projection', () => {
  it('validates the native catalog and keeps hidden names out of shared visibility', () => {
    expect(companionCatalogErrors(catalog)).toEqual([])
    const hidden = catalog.entities.find((entity) => entity.system === 'achievement')!
    expect(visibleCompanionEntities(catalog, initial, map).map((entity) => entity.id)).not.toContain(hidden.id)
    const earned = recordCompanionEntity(initial, 'achievement', hidden.id, { completed: true })
    expect(visibleCompanionEntities(catalog, earned, map).map((entity) => entity.id)).toContain(hidden.id)
  })
  it('keeps unknown fields distinct from explicit false and counts exact decimal strings', () => {
    const requirement = { kind: 'entity' as const, ref: { system: 'enemy' as const, id: 'fixture' }, field: 'count' as const, value: '90071992547409930001' }
    expect(companionRequirementState(requirement, initial, map)).toBeUndefined()
    const observed = recordCompanionEntity(initial, 'enemy', 'fixture', { count: '90071992547409930000' })
    expect(companionRequirementState(requirement, observed, map)).toBe(false)
  })
  it('aggregates recipe demand before subtracting stock, without treating unknown inventory as zero', () => {
    const entities: CompanionEntity[] = [
      { system: 'craft', id: 'a', title: 'A', description: '', category: '', reveal: { kind: 'always' }, provenance: [], recipe: [{ materialId: 'wood', quantity: '7' }] },
      { system: 'craft', id: 'b', title: 'B', description: '', category: '', reveal: { kind: 'always' }, provenance: [], recipe: [{ materialId: 'wood', quantity: '5' }] },
      { system: 'material', id: 'wood', title: 'Wood', description: '', category: '', reveal: { kind: 'always' }, provenance: [] },
    ]
    expect(craftingShoppingList(entities, initial, { a: '2', b: '1' })[0]).toMatchObject({ needed: '19', missing: undefined })
    const stock = recordCompanionEntity(initial, 'material', 'wood', { count: '10', discovered: true })
    expect(craftingShoppingList(entities, stock, { a: '2', b: '1' })[0]).toMatchObject({ needed: '19', owned: '10', missing: '9' })
  })
  it('rejects malformed nested requirements, quantities, references and source URLs without throwing', () => {
    const malformed = [
      { reveal: { kind: 'ascension', requirement: { kind: 'all', requirements: null } } },
      { tiers: {} },
      { tiers: ['1', 'not-a-number'] },
      { otherCosts: [{ unit: 'Divinity Points', quantity: '1.5' }] },
      { recipe: [null] },
      { masteryCountIds: ['unknown-enemy'] },
      { related: [{ system: 'craft', id: 'unknown-craft' }] },
      { provenance: [{ label: 'Invalid link', url: 'javascript:alert(1)' }] },
      { reveal: { kind: 'entity', ref: { system: 'enemy', id: 'missing-enemy' }, field: 'count', value: true } },
    ]
    for (const patch of malformed) {
      const modified = structuredClone(catalog)
      Object.assign(modified.entities[0], patch)
      expect(() => companionCatalogErrors(modified)).not.toThrow()
      expect(companionCatalogErrors(modified).length).toBeGreaterThan(0)
    }
  })
  it('uses every native evolution kill source once and leaves mastery unknown until all are observed', () => {
    const enemy = catalog.entities.find((entity) => entity.system === 'enemy' && entity.masteryCountIds!.length > 1)!
    expect(deriveBestiaryMastery(enemy, initial)).toBeUndefined()
    let progress = initial
    for (const [index, id] of enemy.masteryCountIds!.entries()) progress = recordCompanionEntity(progress, 'enemy', id, { count: index === 0 ? enemy.tiers![1] : '0' })
    expect(deriveBestiaryMastery(enemy, progress)).toEqual({ tier: 2, kills: enemy.tiers![1] })
    progress = recordCompanionEntity(progress, 'enemy', enemy.masteryCountIds![0], { count: '0' })
    expect(deriveBestiaryMastery(enemy, progress)).toEqual({ tier: 0, kills: '0' })
    progress = recordCompanionEntity(progress, 'enemy', enemy.masteryCountIds![1], { count: enemy.tiers![3] })
    expect(deriveBestiaryMastery(enemy, progress)).toEqual({ tier: 4, kills: enemy.tiers![3] })
  })
})
