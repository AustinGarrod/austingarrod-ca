import { satisfies, visibility } from './rules'
import type { Catalog, Milestone, Profile, Requirement, Upgrade } from './types'

export type HypotheticalEvent = { kind: 'purchase' | 'milestone'; id: string }
export type Eligibility = { purchase: boolean; reveal: boolean }
export type ImpactRow = { upgrade: Upgrade; before: Eligibility; after: Eligibility }
export type ForwardImpact =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'blocked'; event: HypotheticalEvent; target: Upgrade; reason: string }
  | { kind: 'ready'; event: HypotheticalEvent; target: Upgrade | Milestone; after: Profile; newlyEligible: ImpactRow[]; blocked: ImpactRow[]; alreadyEligible: ImpactRow[]; newlyRevealed: ImpactRow[] }

function mentions(requirement: Requirement, event: HypotheticalEvent): boolean {
  if ('requirements' in requirement) return requirement.requirements.some((child) => mentions(child, event))
  return 'id' in requirement && requirement.id === event.id
    && (event.kind === 'milestone' ? requirement.kind === 'milestone' : requirement.kind === 'owned' || requirement.kind === 'active')
}
function eligibility(upgrade: Upgrade, profile: Profile): Eligibility {
  return { purchase: satisfies(upgrade.purchase, profile), reveal: satisfies(upgrade.reveal, profile) }
}
const eligible = (state: Eligibility) => state.purchase && state.reveal

/** One native event only. Never fill prerequisites, activate locks, rank hidden nodes or write progress. */
export function forwardImpact(catalog: Catalog, profile: Profile, event: HypotheticalEvent): ForwardImpact {
  const visible = visibility(catalog, profile)
  const target = event.kind === 'purchase' ? visible.upgrades.find((node) => node.id === event.id)
    : visible.milestones.find((item) => item.id === event.id)
  if (!target) return { kind: 'unavailable', reason: 'This choice is no longer visible. Open a fresh analysis from current details or Milestones.' }
  if (event.kind === 'purchase') {
    const upgrade = target as Upgrade
    if (Object.hasOwn(profile.purchases, event.id)) return { kind: 'blocked', event, target: upgrade, reason: 'This upgrade is already owned. A purchase forecast cannot activate an owned Astral or correct earlier history.' }
    if (!eligible(eligibility(upgrade, profile))) return { kind: 'blocked', event, target: upgrade, reason: 'This purchase cannot occur under the current native purchase and reveal gates. Record actual progress first; this analysis never fills missing prerequisites.' }
  } else if (profile.milestones[event.id]) return { kind: 'unavailable', reason: 'This item is already recorded. Choose an unrecorded visible milestone to analyze its receipt.' }

  const after = structuredClone(profile)
  if (event.kind === 'purchase') after.purchases[event.id] = { epoch: profile.epoch, active: (target as Upgrade).activation === 'immediate' }
  else after.milestones[event.id] = true
  // The BEFORE universe governs every row/count/explanation, even if this event reveals more.
  const affected = visible.upgrades.filter((node) => !Object.hasOwn(after.purchases, node.id)
    && (mentions(node.purchase, event) || mentions(node.reveal, event)))
    .map((upgrade) => ({ upgrade, before: eligibility(upgrade, profile), after: eligibility(upgrade, after) }))
  return { kind: 'ready', event, target, after,
    newlyEligible: affected.filter((row) => !eligible(row.before) && eligible(row.after)),
    blocked: affected.filter((row) => !eligible(row.after)),
    alreadyEligible: affected.filter((row) => eligible(row.before) && eligible(row.after)),
    newlyRevealed: profile.showSpoilers ? affected.filter((row) => !row.before.reveal && row.after.reveal) : [],
  }
}
