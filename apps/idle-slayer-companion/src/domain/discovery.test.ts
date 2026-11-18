import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Catalog, Upgrade } from './types'
import { emptyProfile } from './types'
import { visibility, searchVisible } from './rules'
import { discoverUpgrades, upgradeState } from './discovery'

const realCatalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const node = (id: string, extra: Partial<Upgrade> = {}): Upgrade => ({
  id, title: id, description: '', cost: '99999999999999999999999', icon: '', position: { x: 0, y: 0 },
  purchase: { kind: 'always' }, reveal: { kind: 'always' }, retention: 'repeat', activation: 'immediate', sources: [], ...extra,
})

describe('visible upgrade discovery', () => {
  it('matches normalized effects while giving title matches first priority', () => {
    const upgrades = [node('effect', { description: 'More Cöins from Hero’s quests.' }), node('title', { title: 'Hero’s Coins' })]
    const profile = emptyProfile('fixture')
    expect(discoverUpgrades(upgrades, profile, 'COINS').map(({ node }) => node.id)).toEqual(['title', 'effect'])
    expect(discoverUpgrades(upgrades, profile, "hero's").map(({ node }) => node.id)).toEqual(['title', 'effect'])
    expect(discoverUpgrades(upgrades, profile, ' missing ')).toEqual([])
  })
  it('returns the entire shared visible catalog and finds real effect-only coin matches', () => {
    const profile = emptyProfile(realCatalog.revision)
    const visible = visibility(realCatalog, profile)
    expect(discoverUpgrades(visible.upgrades, profile, '').map(({ node }) => node.id)).toEqual(visible.upgrades.map((node) => node.id))
    expect(visible.total).toBeGreaterThan(40)
    const coins = searchVisible(realCatalog, profile, 'coins')
    expect(coins.map((node) => node.title)).toEqual(expect.arrayContaining(['Boost Coin', "Doesn't Matter to Me", 'King of The Sea']))
    expect(coins.every((node) => visible.ids.has(node.id))).toBe(true)
  })
  it('distinguishes eligibility, ownership and activation with native purchase and reveal gates', () => {
    const upgrades = [node('available'), node('locked', { purchase: { kind: 'owned', id: 'missing' } }),
      node('owned'), node('pending', { activation: 'after-ultra-ascension', retention: 'astral' }),
      node('spoiler', { reveal: { kind: 'milestone', id: 'missing-item' } })]
    const profile = emptyProfile('fixture')
    profile.showSpoilers = true
    profile.purchases.owned = { epoch: 0, active: true }
    profile.purchases.pending = { epoch: 0, active: false }
    const ids = (filter: Parameters<typeof discoverUpgrades>[3]) => discoverUpgrades(upgrades, profile, '', filter).map(({ node }) => node.id)
    expect(ids('available')).toEqual(['available'])
    expect(ids('locked')).toEqual(['locked', 'spoiler'])
    expect(ids('owned')).toEqual(['owned', 'pending'])
    expect(ids('pending')).toEqual(['pending'])
    expect(discoverUpgrades(upgrades, profile, 'pending', 'owned')[0].state).toBe('pending')
    profile.purchases.pending.active = true
    expect(ids('pending')).toEqual([])
    expect(upgradeState(upgrades[3], profile)).toBe('purchased')
  })
  it('keeps stable duplicate-title IDs and exact costs without hidden identity hints', () => {
    const visible = [node('key-one', { title: 'Astral Key', cost: '10000000000000000000001' })]
    const profile = emptyProfile('fixture')
    expect(discoverUpgrades(visible, profile, 'key')[0].duplicateTitle).toBe(false)
    visible.push(node('key-two', { title: 'Astral Key', cost: '10000000000000000000002' }))
    expect(discoverUpgrades(visible, profile, 'key').map(({ node, duplicateTitle }) => [node.id, node.cost, duplicateTitle])).toEqual([
      ['key-one', '10000000000000000000001', true], ['key-two', '10000000000000000000002', true],
    ])
  })
  it('does not expose hidden effect matches or use hidden nodes to change visible result identity', () => {
    const profile = emptyProfile(realCatalog.revision)
    const visible = visibility(realCatalog, profile)
    const hidden = realCatalog.upgrades.filter((node) => !visible.ids.has(node.id))
    const modified = { ...realCatalog, upgrades: [...visible.upgrades, ...hidden.map((node) => ({ ...node, title: visible.upgrades[0].title, description: 'private-effect-sentinel' }))] }
    const modifiedVisible = visibility(modified, profile).upgrades
    expect(discoverUpgrades(modifiedVisible, profile, '')).toEqual(discoverUpgrades(visible.upgrades, profile, ''))
    expect(searchVisible(modified, profile, 'private-effect-sentinel')).toEqual([])
    for (const filter of ['all', 'available', 'locked', 'owned', 'pending'] as const) {
      expect(discoverUpgrades(modifiedVisible, profile, 'private-effect-sentinel', filter)).toEqual([])
    }
  })
})
