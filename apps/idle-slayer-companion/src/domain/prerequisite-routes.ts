import type { Catalog, Profile, Requirement } from './types'
import type { GoalMode } from './goals'
import { satisfies, visibility } from './rules'

export const ROUTE_TARGET_LIMIT = 4
export const ROUTE_DISPLAY_LIMIT = 12
export type RouteTarget = { id: string; mode: GoalMode }
export type RouteRequirement = Exclude<Requirement, { kind: 'all' | 'any' }> | { kind: 'all' | 'any'; requirements: RouteRequirement[] } | { kind: 'unrevealed' }
export type RouteProblem = { kind: 'unrevealed' | 'history' | 'cycle' | 'limit' | 'gate' | 'rebuild' } | { kind: 'activation' | 'milestone'; id: string }
export type RouteChoice = { key: string; owner: string; phase: 'purchase' | 'reveal'; option: RouteRequirement }
export type RecordedRequirement = { id: string; kind: 'owned' | 'active' | 'milestone' }
export type PrerequisiteRoute = {
  key: string; added: string[]; shared: string[]; common: string[]; choices: RouteChoice[]
  recorded: RecordedRequirement[]; recordedShared: string[]; assumptions: string[]; pending: string[]; problems: RouteProblem[]
  cost: string | null; subtotal: string
  targets: { target: RouteTarget; added: string[]; unique: string[]; uniqueCost: string }[]
}
export type RouteComparison = { targets: RouteTarget[]; routes: PrerequisiteRoute[]; bounded: boolean }
type Options = { viewer?: Profile; assumedMilestones?: ReadonlySet<string>; maxWork?: number; maxCandidates?: number; maxSteps?: number; maxRoutes?: number }
type Branch = { profile: Profile; added: string[]; choices: RouteChoice[]; recorded: RecordedRequirement[]; assumptions: string[]; problems: RouteProblem[] }
const unique = <T,>(items: T[]): T[] => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]

/** Projection precedes satisfaction, branching and work budgets. Hidden operands are never traversed. */
export function projectRouteRequirement(requirement: Requirement, ids: ReadonlySet<string>, milestones: ReadonlySet<string>): RouteRequirement | null {
  if (requirement.kind === 'owned' || requirement.kind === 'active') return ids.has(requirement.id) ? requirement : null
  if (requirement.kind === 'milestone') return milestones.has(requirement.id) ? requirement : null
  if (requirement.kind !== 'all' && requirement.kind !== 'any') return requirement
  if (requirement.kind === 'all' && !requirement.requirements.length) return { kind: 'always' }
  const children = requirement.requirements.map((child) => projectRouteRequirement(child, ids, milestones))
  const shown = children.filter((child): child is RouteRequirement => child !== null)
  if (!shown.length) return null
  if (requirement.kind === 'all' && children.some((child) => child === null)) shown.push({ kind: 'unrevealed' })
  const distinct = unique(shown)
  return distinct.length === 1 ? distinct[0] : { kind: requirement.kind, requirements: distinct }
}
function met(requirement: RouteRequirement, profile: Profile): boolean {
  if (requirement.kind === 'unrevealed') return false
  if ('requirements' in requirement) return requirement.kind === 'all' ? requirement.requirements.every((child) => met(child, profile)) : requirement.requirements.some((child) => met(child, profile))
  return satisfies(requirement, profile)
}
function copy(branch: Branch): Branch {
  return { ...branch, profile: { ...branch.profile, purchases: { ...branch.profile.purchases }, milestones: { ...branch.profile.milestones } },
    added: [...branch.added], choices: [...branch.choices], recorded: [...branch.recorded], assumptions: [...branch.assumptions], problems: [...branch.problems] }
}
function problem(branch: Branch, issue: RouteProblem): Branch { return { ...branch, problems: unique([...branch.problems, issue]) } }
function branchKey(branch: Branch): string {
  return JSON.stringify({ added: [...branch.added].sort(), choices: branch.choices, recorded: branch.recorded, assumptions: [...branch.assumptions].sort(), problems: branch.problems })
}

/** Read-only current-progress routes. No reset, activation, milestone receipt or profile mutation is applied. */
export function comparePrerequisiteRoutes(catalog: Catalog, original: Profile, requested: readonly RouteTarget[], options: Options = {}): RouteComparison {
  // Future-stage callers freeze the real viewer's universe before any exploration.
  const visible = visibility(catalog, options.viewer ?? original), nodes = new Map(visible.upgrades.map((node) => [node.id, node]))
  const milestoneIds = new Set(visible.milestones.map((item) => item.id))
  const targets = unique(requested.filter((target) => nodes.has(target.id) && ['acquire', 'activate', 'rebuild'].includes(target.mode)))
    .filter((target, position, values) => values.findIndex((other) => other.id === target.id) === position)
  let bounded = targets.length > ROUTE_TARGET_LIMIT
  targets.splice(ROUTE_TARGET_LIMIT)
  if (!targets.length) return { targets, routes: [], bounded }
  const limit = (value: number | undefined, fallback: number, minimum = 0) => Number.isInteger(value) && value! >= minimum ? value! : fallback
  const maxWork = limit(options.maxWork, 4096), maxCandidates = limit(options.maxCandidates, 48, 1)
  const maxSteps = limit(options.maxSteps, 80), maxRoutes = limit(options.maxRoutes, ROUTE_DISPLAY_LIMIT, 1)
  const assumed = new Set([...(options.assumedMilestones ?? [])].filter((id) => milestoneIds.has(id)))
  // The simulation cannot short-circuit an OR gate using an unrevealed ownership record.
  const baseline: Profile = { ...original,
    purchases: Object.fromEntries(visible.upgrades.filter((node) => Object.hasOwn(original.purchases, node.id)).map((node) => [node.id, { ...original.purchases[node.id] }])),
    milestones: Object.fromEntries(visible.milestones.filter((item) => original.milestones[item.id]).map((item) => [item.id, true as const])) }
  const fresh = (): Branch => ({ profile: baseline, added: [], choices: [], recorded: [], assumptions: [], problems: [] })
  let work = 0
  function cap(branches: Branch[]): Branch[] {
    const values = [...new Map(branches.map((branch) => [branchKey(branch), branch])).values()]
    if (values.length > maxCandidates) bounded = true
    return values.slice(0, maxCandidates)
  }
  function recorded(requirement: RouteRequirement, branch: Branch): Branch {
    if (requirement.kind === 'all') return requirement.requirements.reduce((next, child) => recorded(child, next), branch)
    if (requirement.kind === 'any') {
      const child = requirement.requirements.find((item) => met(item, branch.profile))
      return child ? recorded(child, branch) : branch
    }
    if ((requirement.kind === 'owned' || requirement.kind === 'active' || requirement.kind === 'milestone') && met(requirement, baseline)) {
      return { ...branch, recorded: unique([...branch.recorded, { id: requirement.id, kind: requirement.kind }]) }
    }
    return branch
  }
  function ensure(requirement: RouteRequirement, branch: Branch, owner: string, phase: 'purchase' | 'reveal', path: string, visiting: ReadonlySet<string>): Branch[] {
    if (met(requirement, branch.profile)) return [recorded(requirement, branch)]
    switch (requirement.kind) {
      case 'always': return [branch]
      case 'unrevealed': return [problem(branch, { kind: 'unrevealed' })]
      case 'ultra-ascended': return [problem(branch, { kind: 'history' })]
      case 'owned': case 'active': return purchase(requirement.id, branch, requirement.kind === 'active', visiting)
      case 'milestone': {
        if (!assumed.has(requirement.id)) return [problem(branch, { kind: 'milestone', id: requirement.id })]
        const next = copy(branch); next.profile.milestones[requirement.id] = true
        next.assumptions = unique([...next.assumptions, requirement.id])
        return [next]
      }
      case 'all': {
        let branches = [branch]
        for (const [position, child] of requirement.requirements.entries()) branches = cap(branches.flatMap((next) => ensure(child, next, owner, phase, `${path}/${position}`, visiting)))
        return branches
      }
      case 'any': {
        const branches: Branch[] = []
        const key = `${owner}/${phase}/${path}`, chosen = branch.choices.find((choice) => choice.key === key)
        for (const [position, option] of requirement.requirements.entries()) {
          if (chosen && JSON.stringify(chosen.option) !== JSON.stringify(option)) continue
          const next = copy(branch); if (!chosen) next.choices.push({ key, owner, phase, option })
          branches.push(...ensure(option, next, owner, phase, `${path}/${position}`, visiting))
          if (branches.length > maxCandidates) { bounded = true; break }
        }
        return cap(branches)
      }
    }
  }
  function purchase(id: string, branch: Branch, active: boolean, visiting: ReadonlySet<string>): Branch[] {
    const node = nodes.get(id)
    if (!node) return [problem(branch, { kind: 'unrevealed' })]
    if (Object.hasOwn(branch.profile.purchases, id)) {
      const next = recorded({ kind: active ? 'active' : 'owned', id }, branch)
      return [active && !branch.profile.purchases[id].active ? problem(next, { kind: 'activation', id }) : next]
    }
    if (visiting.has(id)) return [problem(branch, { kind: 'cycle' })]
    if (work >= maxWork || branch.added.length >= maxSteps) { bounded = true; return [problem(branch, { kind: 'limit' })] }
    work++
    const stack = new Set([...visiting, id])
    const purchaseGate = projectRouteRequirement(node.purchase, visible.ids, milestoneIds) ?? { kind: 'unrevealed' as const }
    const revealGate = projectRouteRequirement(node.reveal, visible.ids, milestoneIds) ?? { kind: 'unrevealed' as const }
    const branches = cap(ensure(purchaseGate, branch, id, 'purchase', '', stack)
      .flatMap((next) => ensure(revealGate, next, id, 'reveal', '', stack)))
    return branches.map((value) => {
      const next = copy(value)
      if (!next.added.includes(id) && next.added.length >= maxSteps) { bounded = true; return problem(next, { kind: 'limit' }) }
      if (!next.added.includes(id)) next.added.push(id)
      // Native gates are checked at every proposed purchase, including while spoilers are shown.
      if (met(purchaseGate, next.profile) && met(revealGate, next.profile) && satisfies(node.purchase, next.profile) && satisfies(node.reveal, next.profile)) {
        next.profile.purchases[id] = { epoch: original.epoch, active: node.activation === 'immediate' }
        if (active && !next.profile.purchases[id].active) return problem(next, { kind: 'activation', id })
      } else if (!next.problems.length) return problem(next, { kind: 'gate' })
      return next
    })
  }
  const perTarget = targets.map((target) => target.mode === 'rebuild' && nodes.get(target.id)!.retention !== 'repeat'
    ? [problem(fresh(), { kind: 'rebuild' })] : purchase(target.id, fresh(), target.mode !== 'acquire', new Set()))
  type Combination = { branches: Branch[]; choices: Map<string, string> }
  let combinations: Combination[] = [{ branches: [], choices: new Map() }]
  for (const branches of perTarget) {
    const next: Combination[] = []
    combine: for (const combination of combinations) for (const branch of branches) {
      const choices = new Map(combination.choices)
      if (branch.choices.some((choice) => choices.has(choice.key) && choices.get(choice.key) !== JSON.stringify(choice.option))) continue
      branch.choices.forEach((choice) => choices.set(choice.key, JSON.stringify(choice.option)))
      next.push({ branches: [...combination.branches, branch], choices })
      if (next.length > maxCandidates) { bounded = true; break combine }
    }
    combinations = next.slice(0, maxCandidates)
  }
  const sum = (ids: readonly string[]) => ids.reduce((total, id) => total + BigInt(nodes.get(id)!.cost), 0n).toString()
  const routes: PrerequisiteRoute[] = []
  for (const combination of combinations) {
    const added = unique(combination.branches.flatMap((branch) => branch.added))
    const assumptions = unique(combination.branches.flatMap((branch) => branch.assumptions))
    let problems = unique(combination.branches.flatMap((branch) => branch.problems))
    const planned = { ...baseline, purchases: { ...baseline.purchases }, milestones: { ...baseline.milestones } }
    assumptions.forEach((id) => { planned.milestones[id] = true })
    for (const id of added) {
      const node = nodes.get(id)!
      const purchaseGate = projectRouteRequirement(node.purchase, visible.ids, milestoneIds) ?? { kind: 'unrevealed' as const }
      const revealGate = projectRouteRequirement(node.reveal, visible.ids, milestoneIds) ?? { kind: 'unrevealed' as const }
      if (met(purchaseGate, planned) && met(revealGate, planned) && satisfies(node.purchase, planned) && satisfies(node.reveal, planned)) planned.purchases[id] = { epoch: original.epoch, active: node.activation === 'immediate' }
      else if (!problems.length) problems = [{ kind: 'gate' }]
    }
    if (!problems.length && targets.some((target) => !satisfies({ kind: target.mode === 'acquire' ? 'owned' : 'active', id: target.id }, planned))) problems = [{ kind: 'gate' }]
    const shared = added.filter((id) => combination.branches.filter((branch) => branch.added.includes(id)).length > 1)
    const choices = unique(combination.branches.flatMap((branch) => branch.choices))
    const records = unique(combination.branches.flatMap((branch) => branch.recorded))
    const recordedShared = unique(records.map((item) => item.id)).filter((id) => combination.branches.filter((branch) => branch.recorded.some((item) => item.id === id)).length > 1)
    const value: PrerequisiteRoute = { key: '', added, shared, common: [], choices,
      recorded: records, recordedShared, assumptions,
      pending: added.filter((id) => planned.purchases[id] && !planned.purchases[id].active), problems,
      subtotal: sum(added), cost: problems.length ? null : sum(added),
      targets: targets.map((target, position) => {
        const ids = combination.branches[position].added, distinct = ids.filter((id) => !shared.includes(id))
        return { target, added: ids, unique: distinct, uniqueCost: sum(distinct) }
      }) }
    value.key = JSON.stringify({ added: [...added].sort(), choices, assumptions, problems, targets })
    if (!routes.some((route) => route.key === value.key)) routes.push(value)
    if (routes.length > maxRoutes) { bounded = true; break }
  }
  routes.splice(maxRoutes)
  const common = routes.length ? routes[0].added.filter((id) => routes.every((route) => route.added.includes(id))) : []
  routes.forEach((route) => { route.common = common })
  return { targets, routes, bounded }
}
