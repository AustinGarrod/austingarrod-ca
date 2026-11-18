import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { comparePrerequisiteRoutes, projectRouteRequirement } from './prerequisite-routes'
import { emptyProfile, type Catalog, type Requirement, type Upgrade } from './types'
import { satisfies, visibility } from './rules'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!
const initial = emptyProfile(catalog.revision)
const target = (id: string, mode: 'acquire' | 'activate' | 'rebuild' = 'acquire') => ({ id, mode })
const active = (id: string): Requirement => ({ kind: 'active', id })
const owned = (id: string): Requirement => ({ kind: 'owned', id })
function upgrade(id: string, cost: string, purchase: Requirement = { kind: 'always' }, reveal: Requirement = { kind: 'always' }): Upgrade {
  return { ...catalog.upgrades[0], id, title: id, cost, purchase, reveal, retention: 'repeat', activation: 'immediate' }
}
function fixture(upgrades: Upgrade[]): Catalog { return { ...catalog, upgrades, startId: upgrades[0].id, milestones: [], connections: [], grants: [] } }
describe('read-only native prerequisite routes', () => {
  it('enumerates all four Legendary Belt routes, including nested OR and the target, exactly', () => {
    const result = comparePrerequisiteRoutes(catalog, initial, [target(node('Legendary Belt').id)])
    expect(result.bounded).toBe(false)
    expect(result.routes).toHaveLength(4)
    expect(result.routes.map((route) => route.cost).sort((a, b) => BigInt(a!) < BigInt(b!) ? -1 : 1)).toEqual(['436', '641', '651', '1006'])
    expect(result.routes.map((route) => route.added.length).sort()).toEqual([6, 9, 9, 9])
    for (const route of result.routes) { expect(route.added).toContain(node('Legendary Belt').id); expect(route.problems).toEqual([]); expect(new Set(route.added).size).toBe(route.added.length) }
    expect(initial).toEqual(emptyProfile(catalog.revision))
  })
  it('unions multi-target work instead of adding independent totals twice', () => {
    const quests = node('Permanent Quests'), reaper = node('Soul Reaper')
    expect(comparePrerequisiteRoutes(catalog, initial, [target(quests.id)]).routes[0].cost).toBe('9')
    expect(comparePrerequisiteRoutes(catalog, initial, [target(reaper.id)]).routes[0].cost).toBe('11')
    const route = comparePrerequisiteRoutes(catalog, initial, [target(quests.id), target(reaper.id)]).routes[0]
    expect(route.cost).toBe('14'); expect(route.added).toHaveLength(4)
    expect(route.shared).toEqual([node('Permanent Slayer').id, node('Soul Gatherer Bundle').id])
    expect(route.targets.map((item) => item.uniqueCost)).toEqual(['3', '5'])
  })
  it('uses one consistent shared OR choice across targets and keeps both valid alternatives', () => {
    const c = fixture([upgrade('a', '2'), upgrade('b', '3'), upgrade('fork', '1', { kind: 'any', requirements: [active('a'), active('b')] }), upgrade('x', '4', active('fork')), upgrade('y', '5', active('fork'))])
    const result = comparePrerequisiteRoutes(c, emptyProfile(c.revision), [target('x'), target('y')])
    expect(result.bounded).toBe(false)
    expect(result.routes.map((route) => route.cost)).toEqual(['12', '13'])
    for (const route of result.routes) {
      expect(route.choices).toHaveLength(1)
      expect(route.added).toHaveLength(4)
      expect(route.shared).toContain('fork')
      expect(route.targets.map((item) => item.uniqueCost)).toEqual(['4', '5'])
    }
  })
  it('identifies shared recorded prerequisites separately from new shared purchases', () => {
    const c = fixture([upgrade('base', '2'), upgrade('x', '4', active('base')), upgrade('y', '5', owned('base'))])
    const profile = { ...emptyProfile(c.revision), purchases: { base: { epoch: 0, active: true } } }
    const route = comparePrerequisiteRoutes(c, profile, [target('x'), target('y')]).routes[0]
    expect(route.cost).toBe('9'); expect(route.shared).toEqual([])
    expect(route.recordedShared).toEqual(['base'])
    expect(route.recorded).toEqual([{ id: 'base', kind: 'active' }, { id: 'base', kind: 'owned' }])
    expect(route.added).toEqual(['x', 'y'])
  })
  for (const [label, profile] of Object.entries({ hidden: initial, spoilers: { ...initial, showSpoilers: true }, retained: { ...initial, epoch: 2, showSpoilers: true, purchases: { [node('Permanent Slayer').id]: { epoch: 0, active: true } } } })) {
    const upgrades = visibility(catalog, profile).upgrades
    for (let offset = 0; offset < upgrades.length; offset += 48) it(`${label} catalog targets ${offset + 1}-${Math.min(offset + 48, upgrades.length)}: complete routes pass both native gates at every step`, () => {
      for (const upgrade of upgrades.slice(offset, offset + 48)) {
        const result = comparePrerequisiteRoutes(catalog, profile, [target(upgrade.id)])
        for (const route of result.routes.filter((item) => item.cost !== null)) {
          const planned = { ...profile, purchases: { ...profile.purchases } }
          let total = 0n
          for (const id of route.added) {
            const purchase = catalog.upgrades.find((item) => item.id === id)!
            expect(Object.hasOwn(planned.purchases, id), `Repeated purchase ${id}`).toBe(false)
            expect(satisfies(purchase.purchase, planned), `Purchase gate for ${id}`).toBe(true)
            expect(satisfies(purchase.reveal, planned), `Reveal gate for ${id}`).toBe(true)
            planned.purchases[id] = { epoch: profile.epoch, active: purchase.activation === 'immediate' }
            total += BigInt(purchase.cost)
          }
          expect(satisfies(owned(upgrade.id), planned)).toBe(true)
          expect(route.cost).toBe(total.toString())
          expect(route.problems).toEqual([])
        }
      }
    })
  }
  it('resolves transitive reveal gates as well as purchase gates and sums decimal strings', () => {
    const c = fixture([upgrade('base', '999999999999999999999'), upgrade('reveal', '3', owned('base')), upgrade('target', '1000000000000000000001', { kind: 'always' }, active('reveal'))])
    const before = JSON.stringify(c), profile = { ...emptyProfile(c.revision), showSpoilers: true }, bytes = JSON.stringify(profile)
    const route = comparePrerequisiteRoutes(c, profile, [target('target')]).routes[0]
    expect(route.added).toEqual(['base', 'reveal', 'target'])
    expect(route.cost).toBe('2000000000000000000003')
    expect(JSON.stringify(c)).toBe(before); expect(JSON.stringify(profile)).toBe(bytes)
  })
  it('requires explicit external-item assumptions and never records them', () => {
    const c = fixture([upgrade('base', '2'), upgrade('target', '10', active('base'), { kind: 'milestone', id: 'item' })])
    c.milestones = [{ ...catalog.milestones[0], id: 'item', reveal: { kind: 'always' } }]
    const profile = { ...emptyProfile(c.revision), showSpoilers: true }, before = JSON.stringify(profile)
    const blocked = comparePrerequisiteRoutes(c, profile, [target('target')]).routes[0]
    expect(blocked.cost).toBeNull(); expect(blocked.problems).toContainEqual({ kind: 'milestone', id: 'item' })
    const conditional = comparePrerequisiteRoutes(c, profile, [target('target')], { assumedMilestones: new Set(['item']) }).routes[0]
    expect(conditional.cost).toBe('12'); expect(conditional.assumptions).toEqual(['item'])
    expect(JSON.stringify(profile)).toBe(before)
  })
  it('keeps ownership, activation and future Ultra Ascension distinct without repurchasing pending locks', () => {
    const lock = { ...upgrade('lock', '10'), activation: 'after-ultra-ascension' as const, retention: 'astral' as const }
    const c = fixture([lock, upgrade('target', '3', active('lock'))])
    const profile = { ...emptyProfile(c.revision), epoch: 1, purchases: { lock: { epoch: 1, active: false } } }
    const bytes = JSON.stringify(profile)
    const acquire = comparePrerequisiteRoutes(c, profile, [target('lock')]).routes[0]
    expect(acquire.cost).toBe('0'); expect(acquire.recorded).toContainEqual({ id: 'lock', kind: 'owned' })
    const activation = comparePrerequisiteRoutes(c, profile, [target('lock', 'activate')]).routes[0]
    expect(activation.cost).toBeNull(); expect(activation.added).toEqual([])
    const dependent = comparePrerequisiteRoutes(c, profile, [target('target')]).routes[0]
    expect(dependent.cost).toBeNull(); expect(dependent.added).not.toContain('lock')
    expect(dependent.problems).toContainEqual({ kind: 'activation', id: 'lock' })
    const newLock = comparePrerequisiteRoutes(c, emptyProfile(c.revision), [target('lock', 'activate')]).routes[0]
    expect(newLock.cost).toBeNull(); expect(newLock.pending).toEqual(['lock'])
    expect(JSON.stringify(profile)).toBe(bytes)
  })
  it('buying the Ultra Ascension upgrade cannot fabricate prior history', () => {
    const c = fixture([upgrade('ua', '2'), upgrade('target', '3', { kind: 'all', requirements: [owned('ua'), { kind: 'ultra-ascended' }] })])
    const profile = emptyProfile(c.revision)
    const route = comparePrerequisiteRoutes(c, profile, [target('target')]).routes[0]
    expect(route.cost).toBeNull(); expect(route.problems).toContainEqual({ kind: 'history' })
    expect(profile.epoch).toBe(0)
  })
  it('rebuild uses actual retained ownership and does not stage a future reset', () => {
    const profile = { ...initial, epoch: 2, showSpoilers: true, purchases: { [node('Village Key').id]: { epoch: 1, active: true } } }
    expect(comparePrerequisiteRoutes(catalog, profile, [target(node('Village Key').id, 'rebuild')]).routes[0].cost).toBe('0')
    expect(comparePrerequisiteRoutes(catalog, profile, [target(node('Land Lord').id, 'rebuild')]).routes[0].problems).toContainEqual({ kind: 'rebuild' })
  })
  it('projects before satisfaction and budgets so hidden active OR operands never change visible route costs', () => {
    const hidden = upgrade('HIDDEN', '999999999999', { kind: 'always' }, { kind: 'ultra-ascended' })
    const c = fixture([upgrade('visible', '11'), hidden, upgrade('target', '100', { kind: 'any', requirements: [active('HIDDEN'), active('visible')] })])
    const profile = emptyProfile(c.revision)
    const a = comparePrerequisiteRoutes(c, profile, [target('target')], { maxWork: 2 })
    const b = comparePrerequisiteRoutes(c, { ...profile, purchases: { HIDDEN: { epoch: 0, active: true } } }, [target('target')], { maxWork: 2 })
    expect(a).toEqual(b); expect(a.routes[0].cost).toBe('111'); expect(JSON.stringify(a)).not.toContain('HIDDEN')
    hidden.cost = '1'; hidden.purchase = { kind: 'all', requirements: Array.from({ length: 100 }, () => active('HIDDEN')) }
    expect(comparePrerequisiteRoutes(c, profile, [target('target')], { maxWork: 2 })).toEqual(a)
  })
  it('withholds full totals for hidden AND gates with no hidden identities, multiplicity or work charges', () => {
    const c = fixture([upgrade('visible', '11'), upgrade('HIDDEN', '1', { kind: 'always' }, { kind: 'ultra-ascended' }), upgrade('target', '100', { kind: 'all', requirements: [active('visible'), active('HIDDEN')] })])
    const profile = emptyProfile(c.revision), route = comparePrerequisiteRoutes(c, profile, [target('target')], { maxWork: 2 }).routes[0]
    expect(route.cost).toBeNull(); expect(route.subtotal).toBe('111'); expect(JSON.stringify(route)).not.toContain('HIDDEN')
    c.upgrades[2].purchase = { kind: 'all', requirements: [active('visible'), ...Array.from({ length: 100 }, () => active('HIDDEN'))] }
    expect(comparePrerequisiteRoutes(c, profile, [target('target')], { maxWork: 2 }).routes[0]).toEqual(route)
    expect(projectRouteRequirement({ kind: 'any', requirements: [active('HIDDEN')] }, new Set(['visible']), new Set())).toBeNull()
  })
  it('bounds partial exploration honestly and distinguishes duplicate titles by ID', () => {
    const c = fixture([upgrade('a', '2'), { ...upgrade('b', '3', active('a')), title: 'a' }])
    const limited = comparePrerequisiteRoutes(c, emptyProfile(c.revision), [target('b')], { maxSteps: 1 })
    expect(limited.bounded).toBe(true); expect(limited.routes[0].added).toEqual(['a']); expect(limited.routes[0].cost).toBeNull()
    expect(comparePrerequisiteRoutes(c, emptyProfile(c.revision), [target('a'), target('b')]).routes[0].cost).toBe('5')
    c.upgrades[0].purchase = active('b')
    const cycle = comparePrerequisiteRoutes(c, emptyProfile(c.revision), [target('b')]).routes[0]
    expect(cycle.cost).toBeNull(); expect(cycle.problems).toContainEqual({ kind: 'cycle' })
  })
  it('filters hidden and unknown targets and assumptions before target capacity and work limits', () => {
    const c = fixture([upgrade('base', '2'), upgrade('target', '3', active('base')), upgrade('HIDDEN', '9999', { kind: 'always' }, { kind: 'ultra-ascended' })])
    c.milestones = [{ ...catalog.milestones[0], id: 'HIDDEN_ITEM', reveal: { kind: 'ultra-ascended' } }]
    const profile = emptyProfile(c.revision)
    const expected = comparePrerequisiteRoutes(c, profile, [target('target')], { maxWork: 2 })
    const requested = [...Array.from({ length: 20 }, () => target('HIDDEN')), target('UNKNOWN'), target('target')]
    const result = comparePrerequisiteRoutes(c, { ...profile, purchases: { UNKNOWN: { epoch: 0, active: true } }, milestones: { HIDDEN_ITEM: true, UNKNOWN_ITEM: true } }, requested, { maxWork: 2, assumedMilestones: new Set(['HIDDEN_ITEM', 'UNKNOWN_ITEM']) })
    expect(result).toEqual(expected)
    expect(result.bounded).toBe(false); expect(result.routes[0].cost).toBe('5')
    expect(JSON.stringify(result)).not.toContain('HIDDEN'); expect(JSON.stringify(result)).not.toContain('UNKNOWN')
  })
})
