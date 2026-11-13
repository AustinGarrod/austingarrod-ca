import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { forwardImpact, type ForwardImpact } from './forward-impact'
import { planPurchase, satisfies, visibility } from './rules'
import { emptyProfile, type Catalog, type Profile, type Requirement, type Upgrade } from './types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!
function buy(title: string, profile = emptyProfile(catalog.revision)): Profile {
  const choices: Record<string, number> = {}
  for (let i = 0; i < 100; i++) {
    const plan = planPurchase(catalog, profile, node(title).id, choices)
    if (plan.kind === 'ready') return plan.profile
    if (plan.kind === 'blocked') throw new Error(`${title}: ${plan.reason}`)
    choices[plan.key] = 0
  }
  throw new Error('Unresolved test fixture')
}
function ready(result: ForwardImpact) {
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw new Error('Expected a valid one-event forecast')
  return result
}
const ids = (rows: { upgrade: Upgrade }[]) => rows.map((row) => row.upgrade.id)

describe('native single-event forward impact', () => {
  it('enables Portal Traveler, keeps Map blocked without Stocks Buyer, and never purchases either', () => {
    const profile = buy('Soul Gatherer Bundle')
    const before = structuredClone(profile)
    const result = ready(forwardImpact(catalog, profile, { kind: 'purchase', id: node('Portals').id }))
    expect(ids(result.newlyEligible)).toEqual([node('Portal Traveler').id])
    expect(ids(result.blocked)).toContain(node('Map').id)
    expect(result.blocked.find((row) => row.upgrade.title === 'Map')?.after).toEqual({ purchase: false, reveal: true })
    expect(Object.keys(result.after.purchases)).toHaveLength(Object.keys(profile.purchases).length + 1)
    expect(result.after.purchases[node('Portal Traveler').id]).toBeUndefined()
    expect(result.after.purchases[node('Map').id]).toBeUndefined()
    expect(profile).toEqual(before)
    const withStocks = ready(forwardImpact(catalog, buy('Stocks Buyer', profile), { kind: 'purchase', id: node('Portals').id }))
    expect(ids(withStocks.newlyEligible)).toEqual([node('Map').id, node('Portal Traveler').id])
  })
  it('does not claim Belt is newly eligible when an OR alternative is already satisfied', () => {
    const profile = buy('Augmented Soul Gatherer')
    const proposal = node("Doesn't Matter to Me")
    // Both alternatives are ordinary repeat purchases; supply the first actual active path.
    const requirement = proposal.purchase as Extract<Requirement, { kind: 'any' | 'all' }>
    const first = requirement.requirements[0]
    if (first.kind !== 'active') throw new Error('Expected a native active OR path')
    const prepared = buy(catalog.upgrades.find((upgrade) => upgrade.id === first.id)!.title, profile)
    const result = ready(forwardImpact(catalog, prepared, { kind: 'purchase', id: proposal.id }))
    expect(ids(result.newlyEligible)).not.toContain(node('Legendary Belt').id)
    expect(ids(result.alreadyEligible)).toContain(node('Legendary Belt').id)
  })
  it('finds Armory receipt impact without requiring a native map edge', () => {
    const profile = buy('Bonus Stage 3', buy('Astral Slayer', { ...emptyProfile(catalog.revision), epoch: 1 }))
    const armory = catalog.milestones.find((item) => item.title === 'Armory')!
    expect(visibility(catalog, profile).milestones).toContain(armory)
    const result = ready(forwardImpact(catalog, profile, { kind: 'milestone', id: armory.id }))
    expect(ids(result.newlyEligible)).toContain(node('Chest In a Chest').id)
    expect(result.after.purchases).toEqual(profile.purchases)
    expect(result.after.milestones).toEqual({ ...profile.milestones, [armory.id]: true })
    expect(catalog.connections.some((edge) => edge.from === armory.id)).toBe(false)
  })
  it('keeps all eleven hypothetical Astral Key reveals outside default rows and counts', () => {
    const keys = node('Astral Keys')
    const keyTargets = catalog.upgrades.filter((upgrade) => upgrade.title === 'Astral Key')
    const excluded = new Set([keys.id, ...keyTargets.map((upgrade) => upgrade.id)])
    // Valid native gates with prior retained Astrals and actually received items.
    const profile: Profile = { ...emptyProfile(catalog.revision), epoch: 1,
      purchases: Object.fromEntries(catalog.upgrades.filter((upgrade) => !excluded.has(upgrade.id)).map((upgrade) => [upgrade.id, { epoch: upgrade.retention === 'repeat' ? 1 : 0, active: true }])),
      milestones: Object.fromEntries(catalog.milestones.map((item) => [item.id, true as const])),
    }
    expect(satisfies(keys.purchase, profile) && satisfies(keys.reveal, profile)).toBe(true)
    expect(keyTargets).toHaveLength(11)
    const hidden = ready(forwardImpact(catalog, profile, { kind: 'purchase', id: keys.id }))
    expect(hidden.newlyRevealed).toEqual([])
    expect([...hidden.newlyEligible, ...hidden.blocked, ...hidden.alreadyEligible]).toEqual([])
    const shown = ready(forwardImpact(catalog, { ...profile, showSpoilers: true }, { kind: 'purchase', id: keys.id }))
    expect(ids(shown.newlyRevealed)).toEqual(keyTargets.map((upgrade) => upgrade.id))
    expect(ids(shown.newlyEligible)).toEqual(keyTargets.map((upgrade) => upgrade.id))
    expect(catalog.connections.some((edge) => edge.from === keys.id)).toBe(false)
  })
  it('reports missing native gates even in spoiler browsing, without filling a purchase path', () => {
    for (const showSpoilers of [false, true]) {
      const profile = { ...emptyProfile(catalog.revision), showSpoilers }
      const result = forwardImpact(catalog, profile, { kind: 'purchase', id: node('Portals').id })
      expect(result.kind).toBe('blocked')
      expect(profile.purchases).toEqual({})
    }
    const profile = buy('Portals')
    expect(forwardImpact(catalog, profile, { kind: 'purchase', id: node('Portals').id }).kind).toBe('blocked')
    expect(forwardImpact(catalog, emptyProfile(catalog.revision), { kind: 'purchase', id: node('Astral Keys').id }).kind).toBe('unavailable')
    expect(forwardImpact(catalog, emptyProfile(catalog.revision), { kind: 'purchase', id: 'unknown' }).kind).toBe('unavailable')
    expect(forwardImpact(catalog, { ...emptyProfile(catalog.revision), showSpoilers: true, milestones: { [catalog.milestones[0].id]: true } }, { kind: 'milestone', id: catalog.milestones[0].id }).kind).toBe('unavailable')
  })
  it('native pending Astral purchase never becomes a future activation or changes recorded history', () => {
    const lock = node('Astral Scales')
    const profile: Profile = { ...emptyProfile(catalog.revision), epoch: 2,
      purchases: Object.fromEntries(catalog.upgrades.filter((upgrade) => upgrade.id !== lock.id).map((upgrade) => [upgrade.id, { epoch: upgrade.retention === 'repeat' ? 2 : 0, active: true }])),
      milestones: Object.fromEntries(catalog.milestones.map((item) => [item.id, true as const])),
    }
    const result = ready(forwardImpact(catalog, profile, { kind: 'purchase', id: lock.id }))
    expect(result.after.purchases[lock.id]).toEqual({ epoch: 2, active: false })
    expect(result.after.epoch).toBe(2)
    expect(result.after.milestones).toEqual(profile.milestones)
    expect(Object.keys(result.after.purchases)).toHaveLength(Object.keys(profile.purchases).length + 1)
    expect(profile.purchases[lock.id]).toBeUndefined()
  })
})

describe('event and privacy boundaries', () => {
  const base = node('Permanent Slayer')
  const lock: Upgrade = { ...base, id: 'lock', title: 'Same title', activation: 'after-ultra-ascension', retention: 'astral', purchase: { kind: 'always' } }
  const consumer: Upgrade = { ...base, id: 'consumer', title: 'Same title', purchase: { kind: 'active', id: 'lock' } }
  const revealOnly: Upgrade = { ...base, id: 'reveal-only', reveal: { kind: 'owned', id: 'lock' }, purchase: { kind: 'milestone', id: 'other-item' } }
  const fixture: Catalog = { ...catalog, upgrades: [lock, consumer, revealOnly], milestones: [], connections: [], grants: [] }
  it('purchases a lock pending, distinguishes a reveal from eligibility and preserves history/unknown records', () => {
    const profile: Profile = { ...emptyProfile(catalog.revision), epoch: 4, showSpoilers: true, purchases: { unknown: { epoch: 0, active: false } } }
    const before = structuredClone(profile)
    const result = ready(forwardImpact(fixture, profile, { kind: 'purchase', id: 'lock' }))
    expect(result.after.purchases.lock).toEqual({ epoch: 4, active: false })
    expect(result.after.purchases.unknown).toEqual(profile.purchases.unknown)
    expect(result.after.epoch).toBe(4)
    expect(result.newlyEligible).toEqual([])
    expect(ids(result.blocked)).toEqual(['consumer', 'reveal-only'])
    expect(ids(result.newlyRevealed)).toEqual(['reveal-only'])
    expect(result.blocked[1].after).toEqual({ purchase: false, reveal: true })
    expect(profile).toEqual(before)
    expect(forwardImpact(fixture, result.after, { kind: 'purchase', id: 'lock' }).kind).toBe('blocked')
  })
  it('hidden nodes, edges and same-title duplicates cannot affect the default result', () => {
    const profile = emptyProfile(catalog.revision)
    const result = ready(forwardImpact(fixture, profile, { kind: 'purchase', id: 'lock' }))
    expect(ids(result.blocked)).toEqual(['consumer'])
    const larger = { ...fixture, upgrades: [...fixture.upgrades, ...Array.from({ length: 30 }, (_, index) => ({ ...revealOnly, id: `hidden-${index}` }))], connections: [{ from: 'lock', to: 'reveal-only' }] }
    expect(forwardImpact(larger, profile, { kind: 'purchase', id: 'lock' })).toEqual(result)
  })
})
