import type { Profile, Upgrade } from './types'
import { normalizeTitle, satisfies, searchUpgrades } from './rules'

export type UpgradeState = 'available' | 'locked' | 'purchased' | 'pending'
export type DiscoveryFilter = 'all' | 'available' | 'locked' | 'owned' | 'pending'

/** Native eligibility says nothing about the player's unrecorded SP balance. */
export function upgradeState(node: Upgrade, profile: Profile): UpgradeState {
  if (Object.hasOwn(profile.purchases, node.id)) return profile.purchases[node.id].active ? 'purchased' : 'pending'
  return satisfies(node.purchase, profile) && satisfies(node.reveal, profile) ? 'available' : 'locked'
}

/** Accept only the shared visible graph; hidden titles cannot affect identity labels. */
export function discoverUpgrades(visibleUpgrades: Upgrade[], profile: Profile, query: string, filter: DiscoveryFilter = 'all') {
  const titleCounts = new Map<string, number>()
  for (const node of visibleUpgrades) {
    const title = normalizeTitle(node.title)
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
  }
  return searchUpgrades(visibleUpgrades, query).map((node) => ({
    node,
    state: upgradeState(node, profile),
    duplicateTitle: (titleCounts.get(normalizeTitle(node.title)) ?? 0) > 1,
  })).filter(({ state }) => filter === 'all' || (filter === 'owned' ? state === 'purchased' || state === 'pending' : state === filter))
}
