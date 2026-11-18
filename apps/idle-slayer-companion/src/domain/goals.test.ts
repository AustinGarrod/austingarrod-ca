import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from './types'
import { emptyGoals, goalStatus, moveGoal, parseGoals, setGoal, visibleGoals } from './goals'
import { planUltraAscension, visibility } from './rules'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!

describe('separate local intentions', () => {
  it('preserves unknown IDs and exact order while rejecting malformed and duplicate entries', () => {
    const goals = { version: 1, targets: [{ id: 'future-unknown', mode: 'activate' }, { id: catalog.startId, mode: 'rebuild' }] }
    expect(parseGoals(JSON.stringify(goals))).toEqual(goals)
    for (const bad of [{ ...goals, purchases: {} }, { version: 2, targets: [] }, { version: 1, targets: [goals.targets[0], goals.targets[0]] }, { version: 1, targets: [{ id: '__proto__', mode: 'buy' }] }, { version: 1, targets: [{ id: catalog.startId, mode: 'acquire', name: 'private' }] }, { version: 1, targets: Array.from({ length: 21 }, (_, i) => ({ id: String(i), mode: 'acquire' })) }]) expect(() => parseGoals(JSON.stringify(bad))).toThrow()
  })
  it('sets and changes intention without mutating progress, or unrelated goals', () => {
    const goals = setGoal(emptyGoals(), { id: catalog.startId, mode: 'acquire' })
    const changed = setGoal(goals, { id: catalog.startId, mode: 'activate' })
    expect(goals.targets[0].mode).toBe('acquire')
    expect(changed.targets).toEqual([{ id: catalog.startId, mode: 'activate' }])
    expect(initial).toEqual(emptyProfile(catalog.revision))
  })
  it('distinguishes acquisition from activation and requires both native eligibility gates', () => {
    const scales = node('Astral Scales')
    const owned = { ...initial, showSpoilers: true, purchases: { [scales.id]: { epoch: 0, active: false } } }
    expect(goalStatus(scales, owned, 'acquire')).toEqual({ achieved: true, state: 'pending' })
    expect(goalStatus(scales, owned, 'activate')).toEqual({ achieved: false, state: 'pending' })
    expect(goalStatus(scales, { ...initial, showSpoilers: true }, 'activate')).toEqual({ achieved: false, state: 'blocked' })
    expect(goalStatus(node('Permanent Slayer'), initial, 'rebuild')).toEqual({ achieved: false, state: 'eligible' })
  })
  it('projects only current visible goals even when saved target IDs exist for hidden or missing upgrades', () => {
    const visible = visibility(catalog, initial)
    const hidden = catalog.upgrades.find((upgrade) => !visible.ids.has(upgrade.id))!
    const goals = { version: 1 as const, targets: [{ id: hidden.id, mode: 'activate' as const }, { id: 'missing-unknown', mode: 'acquire' as const }, { id: catalog.startId, mode: 'rebuild' as const }] }
    const rows = visibleGoals(catalog, initial, goals)
    expect(rows.map((row) => row.id)).toEqual([catalog.startId])
    expect(JSON.stringify(rows)).not.toContain(hidden.id)
    expect(goals.targets).toHaveLength(3)
  })
  it('reprioritizes visible targets without exposing or removing hidden positions', () => {
    const goals = { version: 1 as const, targets: [{ id: 'a', mode: 'acquire' as const }, { id: 'hidden', mode: 'activate' as const }, { id: 'b', mode: 'rebuild' as const }] }
    expect(moveGoal(goals, 'b', -1, new Set(['a', 'b'])).targets.map((goal) => goal.id)).toEqual(['b', 'hidden', 'a'])
    expect(moveGoal(goals, 'a', -1, new Set(['a', 'b']))).toBe(goals)
  })
  it('uses actual reset ownership for recurring targets including conditional retention', () => {
    const landlord = node('Land Lord'), village = node('Village Key'), start = node('Permanent Slayer')
    const before = { ...initial, epoch: 1, showSpoilers: true, purchases: Object.fromEntries(catalog.upgrades.map((upgrade) => [upgrade.id, { epoch: 1, active: upgrade.id !== landlord.id }])) }
    const untouched = JSON.stringify(before)
    const reset = planUltraAscension(catalog, before)!
    expect(reset).not.toBeNull()
    expect(goalStatus(village, reset.profile, 'rebuild').achieved).toBe(true)
    expect(goalStatus(start, reset.profile, 'rebuild').achieved).toBe(false)
    expect(reset.profile.purchases[landlord.id].active).toBe(true)
    expect(JSON.stringify(before)).toBe(untouched)
  })
})
