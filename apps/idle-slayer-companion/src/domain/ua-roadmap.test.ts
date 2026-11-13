import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyProfile, MAX_PROFILE_EPOCH, type Catalog, type Profile, type Requirement, type Upgrade } from './types'
import { planUltraAscension, satisfies } from './rules'
import { comparePrerequisiteRoutes } from './prerequisite-routes'
import { editRoadmapStage, emptyRoadmapStage, intendRoadmapRoute, simulateRoadmap, type RoadmapPlan, type RoadmapStage } from './ua-roadmap'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!
const target = (id: string, mode: 'acquire' | 'activate' | 'rebuild' = 'acquire') => ({ id, mode })
const active = (id: string): Requirement => ({ kind: 'active', id })
const stage = (targets: RoadmapStage['targets'] = [], resetAfter = false): RoadmapStage => ({ ...emptyRoadmapStage(), targets, resetAfter })
function upgrade(id: string, cost = '1', purchase: Requirement = { kind: 'always' }, reveal: Requirement = { kind: 'always' }): Upgrade {
  return { ...catalog.upgrades[0], id, title: id, cost, purchase, reveal, retention: 'repeat', activation: 'immediate' }
}
function fixture(upgrades: Upgrade[]): Catalog { return { ...catalog, upgrades, startId: upgrades[0].id, milestones: [], connections: [], grants: [], ultraAscension: active('ua') } }
const plan = (...stages: RoadmapStage[]): RoadmapPlan => ({ name: 'Deliberate sequence', stages })
function choose(c: Catalog, original: Profile, input: RoadmapPlan): RoadmapPlan {
  let result = input
  for (let index = 0; index < input.stages.length; index++) {
    const simulated = simulateRoadmap(c, original, result), item = simulated.stages[index]
    if (item.comparison.routes.length > 1) result = intendRoadmapRoute(result, index, item.comparison.routes.find((route) => route.cost !== null)?.key ?? item.comparison.routes[0].key)
  }
  return result
}
describe('hypothetical full-UA roadmaps', () => {
  it('replays the real two-UA Land Lord/Scales chain, reacquires UA and leaves actual progress untouched', () => {
    const lord = node('Land Lord'), scales = node('Astral Scales'), slayer = node('Astral Slayer'), ua = node('Ultra Ascension')
    const actual = { ...emptyProfile(catalog.revision), epoch: 1, purchases: { [slayer.id]: { epoch: 0, active: true }, [lord.id]: { epoch: 1, active: false }, UNKNOWN: { epoch: 1, active: false } }, milestones: { UNKNOWN_ITEM: true as const } }
    const bytes = JSON.stringify(actual)
    const input = choose(catalog, actual, plan(stage([target(ua.id)], true), stage([target(scales.id), target(ua.id)], true), stage([target(scales.id, 'activate')])))
    const result = simulateRoadmap(catalog, actual, input)
    expect(result.stages.map((item) => ({ state: item.state, problem: item.problem, bounded: item.comparison.bounded }))).toEqual([{ state: 'complete', problem: undefined, bounded: false }, { state: 'complete', problem: undefined, bounded: false }, { state: 'complete', problem: undefined, bounded: false }])
    expect(result.complete).toBe(true)
    expect(result.stages[0].activated).toContain(lord.id)
    expect(result.stages[1].pending).toContain(scales.id)
    expect(result.stages[1].activated).toContain(scales.id)
    expect(result.stages[2].added).toEqual([])
    expect(result.stages[2].cost).toBe('0')
    expect(result.stages[0].cleared).toContain(ua.id)
    expect(result.stages[1].added).toContain(ua.id)
    expect(result.stages[1].reacquired).toContain(ua.id)
    expect(result.stages[1].after!.purchases[scales.id]).toEqual({ epoch: 2, active: true })
    expect(result.stages[1].after!.purchases[lord.id]).toEqual({ epoch: 1, active: true })
    expect(result.stages[1].after!.purchases.UNKNOWN).toEqual(actual.purchases.UNKNOWN)
    expect(result.stages[1].after!.milestones.UNKNOWN_ITEM).toBe(true)
    let replay: Profile = structuredClone(actual)
    for (const [index, item] of result.stages.entries()) {
      item.receipts.forEach((id) => { replay.milestones[id] = true })
      for (const id of item.added) {
        const upgrade = catalog.upgrades.find((entry) => entry.id === id)!
        expect(satisfies(upgrade.purchase, replay)).toBe(true); expect(satisfies(upgrade.reveal, replay)).toBe(true)
        replay.purchases[id] = { epoch: replay.epoch, active: upgrade.activation === 'immediate' }
      }
      if (input.stages[index].resetAfter) replay = planUltraAscension(catalog, replay)!.profile
      expect(item.after).toEqual(replay)
    }
    expect(JSON.stringify(actual)).toBe(bytes)
  })
  it('never purchases Scales through pending Land Lord or completes activation before its full boundary', () => {
    const lord = node('Land Lord'), scales = node('Astral Scales'), slayer = node('Astral Slayer')
    const actual = { ...emptyProfile(catalog.revision), epoch: 1, purchases: { [slayer.id]: { epoch: 0, active: true }, [lord.id]: { epoch: 1, active: false } } }
    const result = simulateRoadmap(catalog, actual, plan(stage([target(scales.id)], true), stage([target(lord.id, 'activate')])))
    expect(result.cost).toBeNull(); expect(result.stages[0].problem).toBe('route'); expect(result.stages[0].added).toEqual([])
    expect(result.stages[0].route!.added).not.toContain(lord.id); expect(result.stages[1].state).toBe('unavailable')
    expect(simulateRoadmap(catalog, actual, plan(stage([target(lord.id, 'activate')], true))).stages[0].problem).toBe('route')
  })
  it.each(catalog.grants.flatMap((rule) => rule.when.kind === 'active' ? [[rule.when.id, rule.ids[0]]] : []))('uses native activation order for %s retention and never awards absent %s', (source, retained) => {
    const ua = node('Ultra Ascension'), sourceNode = catalog.upgrades.find((entry) => entry.id === source)!
    for (const present of [true, false]) {
      const actual = { ...emptyProfile(catalog.revision), epoch: 1, showSpoilers: true }
      actual.purchases[ua.id] = { epoch: 1, active: true }
      actual.purchases[source] = { epoch: 1, active: sourceNode.activation === 'immediate' }
      actual.purchases[node('Permanent Slayer').id] = { epoch: 1, active: true }
      if (present) actual.purchases[retained] = { epoch: 1, active: true }
      const result = simulateRoadmap(catalog, actual, plan(stage([], true)))
      expect(result.complete).toBe(true)
      expect(result.stages[0].after!.purchases[source].active).toBe(true)
      expect(result.stages[0].after!.purchases[retained]).toEqual(present ? { epoch: 1, active: true } : undefined)
      expect(result.stages[0].retained.includes(retained)).toBe(present)
      expect(result.stages[0].cleared).toContain(node('Permanent Slayer').id)
      expect(result.stages[0].after).toEqual(planUltraAscension(catalog, actual)!.profile)
      delete actual.purchases[source]
      const absentSource = simulateRoadmap(catalog, actual, plan(stage([], true)))
      expect(absentSource.complete).toBe(true)
      expect(absentSource.stages[0].after!.purchases[retained]).toBeUndefined()
    }
  })
  it('requires UA eligibility again at every stage and refuses safe-integer overflow without a reset', () => {
    const c = fixture([upgrade('ua'), upgrade('repeat', '9')]), actual = emptyProfile(c.revision)
    const result = simulateRoadmap(c, actual, plan(stage([target('ua'), target('repeat')], true), stage([], true), stage([target('repeat')])))
    expect(result.stages[0].state).toBe('complete'); expect(result.stages[1].problem).toBe('eligibility'); expect(result.stages[2].problem).toBe('previous'); expect(result.cost).toBeNull()
    const atLimit = { ...actual, epoch: MAX_PROFILE_EPOCH, purchases: { ua: { epoch: MAX_PROFILE_EPOCH, active: true } } }
    const blocked = simulateRoadmap(c, atLimit, plan(stage([], true)))
    expect(blocked.stages[0].problem).toBe('epoch'); expect(blocked.stages[0].after).toBeUndefined(); expect(atLimit.epoch).toBe(MAX_PROFILE_EPOCH)
    const near = { ...atLimit, epoch: MAX_PROFILE_EPOCH - 1, purchases: { ua: { epoch: MAX_PROFILE_EPOCH - 1, active: true } } }
    expect(simulateRoadmap(c, near, plan(stage([], true))).stages[0].after!.epoch).toBe(MAX_PROFILE_EPOCH)
  })
  it('requires an explicit shared OR route and counts reacquired IDs again after UA', () => {
    const c = fixture([upgrade('ua'), upgrade('a', '999999999999999999999'), upgrade('b', '3'), upgrade('fork', '1', { kind: 'any', requirements: [active('a'), active('b')] }), upgrade('x', '4', active('fork')), upgrade('y', '5', active('fork'))]), actual = emptyProfile(c.revision)
    let input = plan(stage([target('ua'), target('x'), target('y')], true), stage([target('x'), target('y')]))
    const undecided = simulateRoadmap(c, actual, input)
    expect(undecided.stages[0].state).toBe('choose'); expect(undecided.stages[1].state).toBe('unavailable'); expect(undecided.cost).toBeNull()
    input = intendRoadmapRoute(input, 0, undecided.stages[0].comparison.routes.find((route) => route.added.includes('b'))!.key)
    const first = simulateRoadmap(c, actual, input)
    expect(first.stages[0].cost).toBe('14'); expect(first.stages[0].route!.shared).toContain('fork'); expect(first.stages[0].cleared).toContain('b')
    input = intendRoadmapRoute(input, 1, first.stages[1].comparison.routes.find((route) => route.added.includes('a'))!.key)
    const complete = simulateRoadmap(c, actual, input)
    expect(complete.cost).toBe('1000000000000000000023'); expect(complete.stages[1].added).toEqual(['a', 'fork', 'x', 'y'])
    const edited = editRoadmapStage(input, 0, { assumedMilestones: ['irrelevant'] })
    expect(edited.stages.every((item) => item.routeKey === undefined)).toBe(true)
    expect(simulateRoadmap(c, actual, { ...input, stages: [{ ...input.stages[0], routeKey: 'stale-index-1' }, input.stages[1]] }).stages[0].state).toBe('choose')
  })
  it('keeps explicit hypothetical receipts through later resets without editing actual milestones', () => {
    const c = fixture([upgrade('ua'), upgrade('lock', '7', { kind: 'milestone', id: 'item' })]); c.milestones = [{ ...catalog.milestones[0], id: 'item', title: 'Receipt item', reveal: { kind: 'always' } }]
    const actual = emptyProfile(c.revision), input = plan({ ...stage([target('ua'), target('lock')], true), assumedMilestones: ['item'] }, stage([target('lock', 'rebuild')]))
    const result = simulateRoadmap(c, actual, input)
    expect(result.complete).toBe(true); expect(result.cost).toBe('15'); expect(result.stages[0].receipts).toEqual(['item']); expect(result.stages[1].before.milestones.item).toBe(true)
    expect(result.stages[1].receipts).toEqual([]); expect(actual.milestones).toEqual({})
    expect(simulateRoadmap(c, actual, plan(stage([target('lock')]))).cost).toBeNull()
  })
  it('freezes original visibility before future UA, receipts, hidden branching and budgets', () => {
    const c = fixture([upgrade('ua'), upgrade('shown', '4'), upgrade('later', '777', { kind: 'always' }, { kind: 'ultra-ascended' }), upgrade('hidden', '888', { kind: 'always' }, { kind: 'milestone', id: 'hidden-item' }), upgrade('fork', '1', { kind: 'any', requirements: [active('shown'), active('hidden')] })])
    c.milestones = [{ ...catalog.milestones[0], id: 'item', title: 'Shown item', reveal: { kind: 'always' } }]
    const actual = emptyProfile(c.revision), input = plan({ ...stage([target('ua')], true), assumedMilestones: ['item', 'hidden-item'] }, stage([target('fork')]))
    const result = simulateRoadmap(c, actual, input)
    expect(result.complete).toBe(true); expect(result.cost).toBe('6'); expect(result.stages[1].added).toEqual(['shown', 'fork'])
    const altered = structuredClone(c); altered.upgrades.find((node) => node.id === 'hidden')!.cost = '99999999999999999999'; altered.upgrades.find((node) => node.id === 'hidden')!.purchase = { kind: 'all', requirements: Array.from({ length: 120 }, () => active('hidden')) }
    const other = simulateRoadmap(altered, { ...actual, purchases: { hidden: { epoch: 0, active: true } } }, input)
    const publicView = (value: ReturnType<typeof simulateRoadmap>) => value.stages.map(({ before: _before, after: _after, ...stage }) => stage)
    expect(publicView(other)).toEqual(publicView(result)); expect(other.cost).toBe(result.cost)
    expect(JSON.stringify(publicView(result))).not.toContain('hidden-item'); expect(JSON.stringify(publicView(result))).not.toContain('later')
    const broad = comparePrerequisiteRoutes(c, result.stages[0].after!, [target('later')])
    expect(broad.targets).toHaveLength(1)
    expect(comparePrerequisiteRoutes(c, result.stages[0].after!, [target('later')], { viewer: actual }).targets).toEqual([])
  })
  it('withholds hidden mandatory/retention proof and never uses hidden owned facts to claim progress', () => {
    const c = fixture([upgrade('ua'), upgrade('source', '10', { kind: 'always' }, { kind: 'ultra-ascended' }), upgrade('shown', '4', active('source'))])
    const actual = { ...emptyProfile(c.revision), purchases: { ua: { epoch: 0, active: true }, shown: { epoch: 0, active: true } } }
    c.grants = [{ when: active('source'), ids: ['shown'] }]
    const hiddenOwned = { ...actual, purchases: { ...actual.purchases, source: { epoch: 0, active: true } } }
    for (const profile of [actual, hiddenOwned]) {
      const result = simulateRoadmap(c, profile, plan(stage([], true)))
      expect(result.cost).toBeNull(); expect(result.stages[0].problem).toBe('route'); expect(result.stages[0].after).toBeUndefined()
      expect(simulateRoadmap(c, { ...profile, purchases: { source: { epoch: 0, active: true } } }, plan(stage([target('shown')]))).stages[0].problem).toBe('route')
    }
  })
  it('acquires Land Lord before a full boundary and starts Scales only after that activation', () => {
    const lord = node('Land Lord'), scales = node('Astral Scales'), slayer = node('Astral Slayer'), ua = node('Ultra Ascension')
    const actual = { ...emptyProfile(catalog.revision), epoch: 1, purchases: { [slayer.id]: { epoch: 0, active: true } } }
    const input = choose(catalog, actual, plan(stage([target(lord.id), target(ua.id)], true), stage([target(scales.id)])))
    const result = simulateRoadmap(catalog, actual, input)
    expect(result.complete).toBe(true); expect(result.stages[0].added).toContain(lord.id); expect(result.stages[0].pending).toContain(lord.id); expect(result.stages[0].activated).toContain(lord.id)
    expect(result.stages[1].added).toEqual([scales.id]); expect(result.stages[1].after!.purchases[scales.id]).toEqual({ epoch: 2, active: false })
    expect(actual.purchases).toEqual({ [slayer.id]: { epoch: 0, active: true } })
  })
  it('stops bounded partial paths and excessive stage/target inputs without future proof', () => {
    const c = fixture([upgrade('ua'), ...Array.from({ length: 82 }, (_, index) => upgrade(`chain${index}`, '1', index ? active(`chain${index - 1}`) : { kind: 'always' }))]), actual = emptyProfile(c.revision)
    const partial = simulateRoadmap(c, actual, plan(stage([target('chain81')]), stage([target('ua')])))
    expect(partial.stages[0].comparison.bounded).toBe(true); expect(partial.stages[0].problem).toBe('limit'); expect(partial.stages[1].problem).toBe('previous'); expect(partial.cost).toBeNull()
    expect(simulateRoadmap(c, actual, plan(...Array.from({ length: 5 }, () => stage()))).stages[0].problem).toBe('limit')
    expect(simulateRoadmap(c, actual, plan(stage(Array.from({ length: 5 }, (_, index) => target(`chain${index}`))))).cost).toBeNull()
  })
})
