import { describe, expect, it } from 'vitest'
import { RECENT_UPGRADE_LIMIT, reconcileRecentUpgrades, visitRecentUpgrade } from './recent-navigation'

describe('session inspection context', () => {
  it('moves an inspected stable ID to the front without duplicating it or conflating same-title IDs', () => {
    const visible = new Set(['key-a', 'key-b', 'root'])
    const previous = ['key-b', 'key-a', 'root']
    expect(visitRecentUpgrade(previous, 'key-a', visible)).toEqual(['key-a', 'key-b', 'root'])
    expect(previous).toEqual(['key-b', 'key-a', 'root'])
    expect(visitRecentUpgrade(previous, 'key-b', visible)).toEqual(previous)
  })
  it('bounds distinct inspected IDs by recency and allows returning to an evicted ID as a new visit', () => {
    const ids = Array.from({ length: RECENT_UPGRADE_LIMIT + 5 }, (_, index) => `upgrade-${index}`)
    const visible = new Set(ids)
    const recent = ids.reduce<string[]>((trail, id) => visitRecentUpgrade(trail, id, visible), [])
    expect(recent).toEqual(ids.slice(5).reverse())
    expect(visitRecentUpgrade(recent, ids[0], visible)).toEqual([ids[0], ...recent.slice(0, -1)])
  })
  it('removes hidden and unknown IDs without retaining gaps, counts or duplicate identities', () => {
    const visible = new Set(['visible-a', 'visible-b'])
    const recent = reconcileRecentUpgrades(['hidden', 'visible-a', 'unknown', 'visible-b', 'visible-a'], visible)
    expect(recent).toEqual(['visible-a', 'visible-b'])
    expect(visitRecentUpgrade(recent, 'hidden', visible)).toEqual(recent)
    expect(reconcileRecentUpgrades(recent, new Set([...visible, 'hidden']))).toEqual(recent)
    expect(reconcileRecentUpgrades(recent, new Set())).toEqual([])
  })
})
