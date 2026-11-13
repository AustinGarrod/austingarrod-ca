import { satisfies, type visibility } from './rules'
import { presentCost } from './cost-presentation'
import type { Profile, Requirement, Upgrade } from './types'

export type RequirementRoute = { kind: 'upgrade' | 'milestone'; id: string } | { kind: 'history' }
export type VisibleRequirement =
  | { kind: 'leaf'; label: string; satisfied: boolean; route?: RequirementRoute; identity?: string }
  | { kind: 'all' | 'any'; requirements: VisibleRequirement[] }

type VisibleProgress = ReturnType<typeof visibility>

/** Presentation only: hidden leaves contribute no identity, state, count or grouping. */
export function visibleRequirement(requirement: Requirement, profile: Profile, visible: VisibleProgress): VisibleRequirement | null {
  if ('requirements' in requirement) {
    const requirements = requirement.requirements.flatMap((child) => {
      const view = visibleRequirement(child, profile, visible)
      return view ? [view] : []
    })
    if (!requirements.length) return null
    if (requirements.length === 1) return requirements[0]
    return { kind: requirement.kind, requirements }
  }
  switch (requirement.kind) {
    case 'always': return { kind: 'leaf', label: 'No prerequisites', satisfied: true }
    case 'ultra-ascended': return { kind: 'leaf', label: 'At least one Ultra Ascension', satisfied: satisfies(requirement, profile), route: { kind: 'history' } }
    case 'owned': case 'active': {
      const upgrade = visible.upgrades.find((node) => node.id === requirement.id)
      if (!upgrade) return null
      return { kind: 'leaf', label: `${upgrade.title}${requirement.kind === 'active' ? ' (active)' : ''}`, satisfied: satisfies(requirement, profile),
        route: { kind: 'upgrade', id: upgrade.id }, identity: `${upgrade.title} · ${presentCost(upgrade.cost).exact} SP` }
    }
    case 'milestone': {
      const milestone = visible.milestones.find((item) => item.id === requirement.id)
      return milestone ? { kind: 'leaf', label: milestone.title, satisfied: satisfies(requirement, profile), route: { kind: 'milestone', id: milestone.id } } : null
    }
  }
}

/** A review destination, not a purchase suggestion or an invented prerequisite route. */
export function requirementReviewTarget(visible: VisibleProgress, profile: Profile, selected: string | null): Upgrade | undefined {
  const blocked = visible.upgrades.filter((upgrade) => !Object.hasOwn(profile.purchases, upgrade.id)
    && (!satisfies(upgrade.purchase, profile) || !satisfies(upgrade.reveal, profile)))
  return blocked.find((upgrade) => upgrade.id === selected) ?? blocked[0]
}
