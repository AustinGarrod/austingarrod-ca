import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recommendUpgrades, type WikiPriorityData } from './recommendations'
import { planPurchase, planRemoval, planUltraAscension } from './rules'
import { emptyProfile, type Catalog, type Requirement, type Upgrade } from './types'

const always: Requirement = { kind: 'always' }
const source = { label: 'Reviewed test guide', url: 'https://example.test/guide?oldid=7187', revision: 7187, revisionTimestamp: '2026-07-05T09:50:07Z', gameVersion: '7.0.0' }

function upgrade(id: string, options: Partial<Upgrade> = {}): Upgrade {
  return { id, title: id, description: `${id} native effect`, cost: '10', icon: `${id}.png`, position: { x: 0, y: 0 }, purchase: always, reveal: always, retention: 'repeat', activation: 'immediate', sources: [], ...options }
}

function catalog(upgrades: Upgrade[]): Catalog {
  return { revision: 'test', gameVersion: '7.2.0', steamBuild: '25551532', startId: upgrades[0]?.id ?? '', upgrades, connections: [], milestones: [], grants: [], ultraAscension: { kind: 'active', id: 'ua' }, verification: { coverage: true, purchaseRules: true, revealRules: true, resetRules: true, assets: true, evidence: [] } }
}

function priorities(entries: [string, number, string?][]): WikiPriorityData {
  return { schemaVersion: 1, source, rows: entries.map(([id, priority, tier = 'Tier 1']) => ({ id, priority, tier, url: `${source.url}#${tier.replaceAll(' ', '_')}`, note: '' })) }
}

const native = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const wiki = JSON.parse(readFileSync('src/data/wiki-priorities.json', 'utf8')) as WikiPriorityData
const nativeStart = 'cjnr3qwntwqt4505351h'
const nativeRage = '04u7349eha9vacsofx7l'
const nativeRageParent = '9cd6a6o0l93hxbpxx4m5'

describe('read-only next-upgrade recommendations', () => {
  it('uses guide order before native cost and returns at most three ready choices', () => {
    const c = catalog([upgrade('cheap', { cost: '1' }), upgrade('first', { cost: '100000000000000000000' }), upgrade('third'), upgrade('fourth')])
    const result = recommendUpgrades(c, emptyProfile(c.revision), priorities([['first', 1], ['cheap', 2], ['third', 3], ['fourth', 4]]))
    expect(result.status).toBe('wiki')
    expect(result.suggestions.map((item) => item.upgrade.id)).toEqual(['first', 'cheap', 'third'])
    expect(result.suggestions[0].cost).toBe('100000000000000000000')
    expect(result.suggestions[0].source?.url).toBe(`${source.url}#Tier_1`)
    expect(result.suggestions[0].reason).toBe('First remaining upgrade in the wiki order whose requirements are met.')
    expect(result.readyCount).toBe(4)
    expect(result.wikiReadyCount).toBe(4)
    expect(result.unrankedReadyCount).toBe(0)
    expect(result.caveat).toContain('not an optimal build')
    expect(result.caveat).toContain('7.0.0')
    expect(result.caveat).toContain('7.2.0')
  })

  it('orders exact costs beyond Number precision and stable IDs on a priority tie', () => {
    const c = catalog([upgrade('a-more', { cost: '9007199254740993' }), upgrade('z-less', { cost: '9007199254740992' }), upgrade('b-tie', { cost: '9007199254740992' })])
    const result = recommendUpgrades(c, emptyProfile(c.revision), priorities(c.upgrades.map((node) => [node.id, 1])))
    expect(result.suggestions.map((item) => item.upgrade.id)).toEqual(['b-tie', 'z-less', 'a-more'])
    expect(result.suggestions.map((item) => item.cost)).toEqual(['9007199254740992', '9007199254740992', '9007199254740993'])
  })

  it('never fills unsatisfied OR, item, activation or Ultra Ascension requirements', () => {
    const c = catalog([
      upgrade('ready'),
      upgrade('or', { purchase: { kind: 'any', requirements: [{ kind: 'active', id: 'parent-a' }, { kind: 'active', id: 'parent-b' }] } }),
      upgrade('item', { purchase: { kind: 'milestone', id: 'item' } }),
      upgrade('ua-gate', { purchase: { kind: 'ultra-ascended' } }),
      upgrade('active-gate', { purchase: { kind: 'active', id: 'pending' } }),
    ])
    const p = emptyProfile(c.revision)
    p.purchases.pending = { epoch: 0, active: false }
    const before = structuredClone(p)
    const result = recommendUpgrades(c, p, priorities([['or', 0], ['item', 1], ['ua-gate', 2], ['active-gate', 3], ['ready', 4]]))
    expect(result.suggestions.map((item) => item.upgrade.id)).toEqual(['ready'])
    expect(p).toEqual(before)
    p.purchases['parent-b'] = { epoch: 0, active: true }
    expect(recommendUpgrades(c, p, priorities([['or', 0]])).suggestions[0].upgrade.id).toBe('or')
  })

  it('requires native reveal even when spoiler browsing exposes a node', () => {
    const c = catalog([upgrade('ready'), upgrade('hidden', { reveal: { kind: 'milestone', id: 'secret' } }), upgrade('reveal-active', { reveal: { kind: 'active', id: 'pending' } })])
    const p = emptyProfile(c.revision)
    p.showSpoilers = true
    p.purchases.pending = { epoch: 0, active: false }
    const result = recommendUpgrades(c, p, priorities([['hidden', 0], ['reveal-active', 1], ['ready', 2]]))
    expect(result.suggestions.map((item) => item.upgrade.id)).toEqual(['ready'])
    p.milestones.secret = true
    expect(recommendUpgrades(c, p, priorities([['hidden', 0], ['ready', 2]])).suggestions[0].upgrade.id).toBe('hidden')
  })

  it('does not impose a wiki tier or stage as an extra epoch gate', () => {
    const c = catalog([upgrade('later-guide-entry')])
    const result = recommendUpgrades(c, emptyProfile(c.revision), priorities([['later-guide-entry', 100, 'After second Ultra Ascension']]))
    expect(result.suggestions[0].upgrade.id).toBe('later-guide-entry')
    expect(result.suggestions[0].tier).toBe('After second Ultra Ascension')
  })

  it('excludes owned pending locks and waits for active prerequisites; new locks carry an activation note', () => {
    const c = catalog([upgrade('lock', { retention: 'astral', activation: 'after-ultra-ascension' }), upgrade('child', { purchase: { kind: 'active', id: 'lock' } })])
    const p = emptyProfile(c.revision)
    const guide = priorities([['lock', 1], ['child', 2]])
    expect(recommendUpgrades(c, p, guide).suggestions[0].activationNote).toContain('after your next Ultra Ascension')
    p.purchases.lock = { epoch: 0, active: false }
    const pending = recommendUpgrades(c, p, guide)
    expect(pending.status).toBe('blocked')
    expect(pending.suggestions).toEqual([])
    p.purchases.lock.active = true
    expect(recommendUpgrades(c, p, guide).suggestions[0].upgrade.id).toBe('child')
  })

  it.each([
    [true, false, ['target', 'other']],
    [true, true, ['other']],
    [false, false, ['other']],
    [false, true, ['other']],
  ] as const)('uses ownership and native eligibility with an active=%s retention source and owned=%s target', (active, owned, expected) => {
    const c = catalog([upgrade('source', { retention: 'astral', activation: 'after-ultra-ascension' }),
      upgrade('target', { purchase: { kind: 'active', id: 'source' } }), upgrade('other')])
    c.grants = [{ when: { kind: 'active', id: 'source' }, ids: ['target'] }]
    const p = emptyProfile(c.revision)
    p.purchases.source = { epoch: 0, active }
    if (owned) p.purchases.target = { epoch: 0, active: true }
    const before = structuredClone(p)
    expect(recommendUpgrades(c, p, priorities([['source', 0], ['target', 1], ['other', 2]])).suggestions.map((item) => item.upgrade.id)).toEqual(expected)
    expect(p).toEqual(before)
  })

  it('uses a clearly labeled cost fallback only when no eligible upgrade has a wiki rank', () => {
    const c = catalog([upgrade('a', { cost: '9007199254740993' }), upgrade('b', { cost: '9007199254740992' }), upgrade('wiki-locked', { purchase: { kind: 'milestone', id: 'missing' } })])
    const result = recommendUpgrades(c, emptyProfile(c.revision), priorities([['wiki-locked', 0], ['unknown-id', 1]]))
    expect(result.status).toBe('fallback')
    expect(result.suggestions.map((item) => item.upgrade.id)).toEqual(['b', 'a'])
    expect(result.suggestions.every((item) => item.basis === 'fallback' && item.reason.startsWith('Catalog fallback:') && !item.source)).toBe(true)
    expect(result.unrankedReadyCount).toBe(2)
    const ranked = recommendUpgrades(c, emptyProfile(c.revision), priorities([['a', 5]]))
    expect(ranked.suggestions.map((item) => item.upgrade.id)).toEqual(['a'])
    expect(ranked.unrankedReadyCount).toBe(1)
  })

  it('distinguishes all visible ownership from blocked requirements and does not reveal hidden counts', () => {
    const c = catalog([upgrade('visible'), upgrade('hidden', { reveal: { kind: 'milestone', id: 'secret' } })])
    const p = emptyProfile(c.revision)
    p.purchases.visible = { epoch: 0, active: true }
    const result = recommendUpgrades(c, p, priorities([['hidden', 0]]))
    expect(result.status).toBe('all-owned')
    expect(result.visibleUnownedCount).toBe(0)
    expect(result.readyCount).toBe(0)
    expect(result.suggestions).toEqual([])
    expect(recommendUpgrades(catalog([upgrade('blocked', { purchase: { kind: 'milestone', id: 'missing' } })]), emptyProfile('test'), priorities([])).status).toBe('blocked')
  })

  it('cannot change observable suggestions when only hidden nodes, ranks or unknown progress IDs change', () => {
    const c = catalog([upgrade('a'), upgrade('b')])
    const p = emptyProfile(c.revision)
    const guide = priorities([['a', 1], ['b', 2]])
    const result = recommendUpgrades(c, p, guide)
    const withHidden = structuredClone(c)
    withHidden.upgrades.push(upgrade('hidden', { cost: '1', reveal: { kind: 'milestone', id: 'secret' } }))
    const changed = structuredClone(p)
    changed.purchases['legacy-unknown'] = { epoch: 0, active: false }
    changed.milestones['unknown-item'] = true
    expect(recommendUpgrades(withHidden, changed, priorities([['hidden', 0], ['unknown-wiki-id', 0], ['a', 1], ['b', 2]]))).toEqual(result)
  })

  it('recomputes after purchase, removal and undo without mutating any input', () => {
    const c = catalog([upgrade('a'), upgrade('b')])
    const original = emptyProfile(c.revision)
    const guide = priorities([['a', 1], ['b', 2]])
    const before = structuredClone({ c, original, guide })
    const purchase = planPurchase(c, original, 'a')
    expect(purchase.kind).toBe('ready')
    if (purchase.kind !== 'ready') throw new Error('Fixture purchase failed')
    expect(recommendUpgrades(c, purchase.profile, guide).suggestions[0].upgrade.id).toBe('b')
    const removal = planRemoval(c, purchase.profile, 'a')
    expect(recommendUpgrades(c, removal.profile, guide).suggestions[0].upgrade.id).toBe('a')
    expect(recommendUpgrades(c, original, guide).suggestions[0].upgrade.id).toBe('a')
    expect({ c, original, guide }).toEqual(before)
  })

  it('recommends the native start for a new profile and repeats after a real Ultra Ascension', () => {
    const guide = wiki
    expect(recommendUpgrades(native, emptyProfile(native.revision), guide).suggestions[0].upgrade.id).toBe(nativeStart)
    const firstPurchase = planPurchase(native, emptyProfile(native.revision), nativeStart)
    if (firstPurchase.kind !== 'ready') throw new Error('Native start purchase failed')
    const next = recommendUpgrades(native, firstPurchase.profile, guide)
    expect(next.suggestions[0].upgrade.id).toBe('5ew02t2oprzthi4hmyk6')
    expect(next.suggestions[0].source?.url).toContain('?oldid=7187#Tier_1')
    const p = emptyProfile(native.revision)
    p.epoch = 1
    for (const node of native.upgrades) p.purchases[node.id] = { epoch: 1, active: true }
    for (const item of native.milestones) p.milestones[item.id] = true
    expect(recommendUpgrades(native, p, guide).status).toBe('all-owned')
    const reset = planUltraAscension(native, p)!
    const repeated = recommendUpgrades(native, reset.profile, guide)
    expect(repeated.suggestions[0].upgrade.id).toBe(nativeStart)
    expect(repeated.suggestions[0].tier).toBe('Tier 1')
    expect(reset.profile.epoch).toBe(2)
    expect(reset.profile.purchases['gmhcwrfgzcjt6j95g1lr']).toBeDefined()
    expect(recommendUpgrades(native, reset.profile, priorities([['gmhcwrfgzcjt6j95g1lr', 0], [nativeStart, 1]])).suggestions[0].upgrade.id).toBe(nativeStart)
  })

  it('labels an actual unranked native upgrade as fallback when every guide-covered upgrade is owned', () => {
    const p = emptyProfile(native.revision)
    p.epoch = 1
    for (const node of native.upgrades) p.purchases[node.id] = { epoch: 1, active: true }
    for (const item of native.milestones) p.milestones[item.id] = true
    const unranked = 'joffg528v6o2a86ldmnl'
    delete p.purchases[unranked]
    const result = recommendUpgrades(native, p, wiki)
    expect(result.status).toBe('fallback')
    expect(result.wikiReadyCount).toBe(0)
    expect(result.unrankedReadyCount).toBe(1)
    expect(result.suggestions[0].upgrade.id).toBe(unranked)
    expect(result.suggestions[0].basis).toBe('fallback')
    expect(result.suggestions[0].source).toBeUndefined()
    expect(result.suggestions[0].cost).toBe(native.upgrades.find((node) => node.id === unranked)!.cost)
  })

  it('rejects native Rage Mode before a prior Ultra Ascension despite the OR purchase early return', () => {
    const p = emptyProfile(native.revision)
    p.showSpoilers = true
    p.purchases[nativeRageParent] = { epoch: 0, active: true }
    const result = recommendUpgrades(native, p, priorities([[nativeRage, 0], [nativeStart, 1]]))
    expect(result.suggestions[0].upgrade.id).toBe(nativeStart)
    expect(result.suggestions.some((item) => item.upgrade.id === nativeRage)).toBe(false)
  })

  it('honors the result limit and keeps the earliest guide priority for a repeated native ID', () => {
    const c = catalog([upgrade('a'), upgrade('b')])
    const guide = priorities([['a', 10], ['a', 1], ['b', 2]])
    const result = recommendUpgrades(c, emptyProfile(c.revision), guide, { limit: 1 })
    expect(result.suggestions.map((item) => item.upgrade.id)).toEqual(['a'])
    expect(result.wikiReadyCount).toBe(2)
    expect(() => recommendUpgrades(c, emptyProfile(c.revision), guide, { limit: 0 })).toThrow('positive integer')
  })
})
