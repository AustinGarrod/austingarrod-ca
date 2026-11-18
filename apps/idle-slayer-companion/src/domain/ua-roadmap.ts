import type { Catalog, Profile } from './types'
import { MAX_PROFILE_EPOCH } from './types'
import { planUltraAscension, satisfies, visibility } from './rules'
import { comparePrerequisiteRoutes, projectRouteRequirement, ROUTE_TARGET_LIMIT, type PrerequisiteRoute, type RouteComparison, type RouteRequirement, type RouteTarget } from './prerequisite-routes'

export const ROADMAP_PLAN_LIMIT = 2
export const ROADMAP_STAGE_LIMIT = 4
export type RoadmapStage = { targets: RouteTarget[]; assumedMilestones: string[]; routeKey?: string; resetAfter: boolean }
export type RoadmapPlan = { name: string; stages: RoadmapStage[] }
export const emptyRoadmapStage = (): RoadmapStage => ({ targets: [], assumedMilestones: [], resetAfter: false })
export type RoadmapProblem = 'previous' | 'choice' | 'route' | 'native' | 'eligibility' | 'epoch' | 'limit' | 'targets'
export type RoadmapStageResult = {
  state: 'complete' | 'blocked' | 'choose' | 'unavailable'; problem?: RoadmapProblem
  comparison: RouteComparison; route?: PrerequisiteRoute; before: Profile; after?: Profile
  added: string[]; reacquired: string[]; receipts: string[]; pending: string[]; cleared: string[]; activated: string[]; retained: string[]
  uaRequirement: RouteRequirement; uaEligible: boolean; cost: string | null; subtotal: string
}
export type RoadmapResult = { stages: RoadmapStageResult[]; cost: string | null; subtotal: string; complete: boolean }

function met(requirement: RouteRequirement, profile: Profile): boolean {
  if (requirement.kind === 'unrevealed') return false
  if ('requirements' in requirement) return requirement.kind === 'all' ? requirement.requirements.every((child) => met(child, profile)) : requirement.requirements.some((child) => met(child, profile))
  return satisfies(requirement, profile)
}
function fullyShown(requirement: Catalog['ultraAscension'], ids: ReadonlySet<string>, items: ReadonlySet<string>): boolean {
  if ('requirements' in requirement) return requirement.requirements.every((child) => fullyShown(child, ids, items))
  if (requirement.kind === 'owned' || requirement.kind === 'active') return ids.has(requirement.id)
  return requirement.kind !== 'milestone' || items.has(requirement.id)
}

/** Only the current/later route intentions are invalidated. Earlier choices stay deliberate. */
export function editRoadmapStage(plan: RoadmapPlan, position: number, update: Partial<RoadmapStage>): RoadmapPlan {
  return { ...plan, stages: plan.stages.map((stage, index) => index < position ? stage : index === position ? { ...stage, ...update, routeKey: undefined } : { ...stage, routeKey: undefined }) }
}
export function intendRoadmapRoute(plan: RoadmapPlan, position: number, routeKey: string): RoadmapPlan {
  return { ...plan, stages: plan.stages.map((stage, index) => index < position ? stage : index === position ? { ...stage, routeKey } : { ...stage, routeKey: undefined }) }
}

/** Hypothetical native transitions only. Display/exploration always uses the ORIGINAL real viewer. */
export function simulateRoadmap(catalog: Catalog, actual: Profile, plan: RoadmapPlan): RoadmapResult {
  const visible = visibility(catalog, actual), items = new Set(visible.milestones.map((item) => item.id))
  const nodes = new Map(visible.upgrades.map((node) => [node.id, node]))
  const uaRequirement = projectRouteRequirement(catalog.ultraAscension, visible.ids, items) ?? { kind: 'unrevealed' as const }
  const stages: RoadmapStageResult[] = []
  const earlierOwnership = new Set(Object.keys(actual.purchases).filter((id) => visible.ids.has(id)))
  let profile = structuredClone(actual), stopped = false, total = 0n
  for (const [position, stage] of plan.stages.slice(0, ROADMAP_STAGE_LIMIT).entries()) {
    const result: RoadmapStageResult = { state: 'unavailable', comparison: { targets: [], routes: [], bounded: false }, before: profile,
      added: [], reacquired: [], receipts: [], pending: [], cleared: [], activated: [], retained: [], uaRequirement, uaEligible: false, cost: null, subtotal: '0' }
    stages.push(result)
    if (stopped) { result.problem = 'previous'; continue }
    const stop = (problem: RoadmapProblem, state: RoadmapStageResult['state'] = 'blocked') => { result.state = state; result.problem = problem; stopped = true }
    if (plan.stages.length > ROADMAP_STAGE_LIMIT || stage.targets.length > ROUTE_TARGET_LIMIT || stage.resetAfter && position === ROADMAP_STAGE_LIMIT - 1) { stop('limit'); continue }
    if (stage.targets.some((target) => !nodes.has(target.id) || !['acquire', 'activate', 'rebuild'].includes(target.mode)) || new Set(stage.targets.map((target) => target.id)).size !== stage.targets.length) { stop('targets'); continue }
    // Never let future receipts reveal new item names or alter candidate/work budgets.
    result.receipts = [...new Set(stage.assumedMilestones.filter((id) => items.has(id) && !profile.milestones[id]))]
    result.comparison = comparePrerequisiteRoutes(catalog, profile, stage.targets, { viewer: actual, assumedMilestones: new Set(result.receipts) })
    result.route = stage.routeKey ? result.comparison.routes.find((route) => route.key === stage.routeKey) : result.comparison.routes.length === 1 ? result.comparison.routes[0] : undefined
    result.reacquired = (result.route?.added ?? []).filter((id) => earlierOwnership.has(id) && !Object.hasOwn(profile.purchases, id))
    if (stage.targets.length && !result.route) { stop('choice', 'choose'); continue }
    if (result.comparison.bounded) { stop('limit'); continue }
    if (result.route?.cost === null) { result.subtotal = result.route.subtotal; total += BigInt(result.subtotal); stop('route'); continue }
    const next = structuredClone(profile)
    result.receipts.forEach((id) => { next.milestones[id] = true })
    for (const id of result.route?.added ?? []) {
      if (Object.hasOwn(next.purchases, id)) continue
      const node = nodes.get(id)!
      // Replay the ordered concrete steps; projected OR positions are not native choices.
      if (!satisfies(node.purchase, next) || !satisfies(node.reveal, next)) { stop('native'); break }
      next.purchases[id] = { epoch: next.epoch, active: node.activation === 'immediate' }
      result.added.push(id)
    }
    result.subtotal = result.added.reduce((sum, id) => sum + BigInt(nodes.get(id)!.cost), 0n).toString()
    total += BigInt(result.subtotal)
    if (stopped) continue
    if (stage.targets.some((target) => target.mode === 'rebuild' && nodes.get(target.id)!.retention !== 'repeat' || !satisfies({ kind: target.mode === 'acquire' ? 'owned' : 'active', id: target.id }, next))) { stop('native'); continue }
    result.pending = result.added.filter((id) => !next.purchases[id].active)
    // Project BEFORE deciding eligibility so omitted native facts cannot become a hidden oracle.
    const projected: Profile = { ...next, purchases: Object.fromEntries(Object.entries(next.purchases).filter(([id]) => visible.ids.has(id))), milestones: Object.fromEntries(Object.entries(next.milestones).filter(([id]) => items.has(id))) }
    result.uaEligible = met(uaRequirement, projected) && satisfies(catalog.ultraAscension, next) && next.epoch < MAX_PROFILE_EPOCH
    if (stage.resetAfter) {
      if (next.epoch >= MAX_PROFILE_EPOCH) { stop('epoch'); continue }
      if (!result.uaEligible) { stop('eligibility'); continue }
      // A hidden retention source cannot become an oracle through a shown reset outcome.
      if (catalog.grants.some((rule) => rule.ids.some((id) => visible.ids.has(id) && Object.hasOwn(next.purchases, id)) && !fullyShown(rule.when, visible.ids, items))) { stop('route'); continue }
      const reset = planUltraAscension(catalog, next)
      if (!reset) { stop('eligibility'); continue }
      result.cleared = reset.cleared.filter((id) => visible.ids.has(id))
      result.activated = reset.activated.filter((id) => visible.ids.has(id))
      result.retained = Object.keys(reset.profile.purchases).filter((id) => visible.ids.has(id))
      profile = reset.profile
    } else profile = next
    result.added.forEach((id) => earlierOwnership.add(id))
    result.after = profile; result.cost = result.subtotal; result.state = 'complete'
  }
  const complete = !stopped && plan.stages.length > 0 && plan.stages.length <= ROADMAP_STAGE_LIMIT
  return { stages, cost: complete ? total.toString() : null, subtotal: total.toString(), complete }
}
