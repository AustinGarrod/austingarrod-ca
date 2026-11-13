import { visibility } from './rules'
import type { Catalog, Profile } from './types'

/** Summarize recognized progress under an explicit viewing preference, without changing the profile. */
export function visibleProgress(catalog: Catalog, profile: Profile, showSpoilers: boolean) {
  const visible = visibility(catalog, { ...profile, showSpoilers })
  const ownedLocks = visible.upgrades.filter((upgrade) => upgrade.activation === 'after-ultra-ascension' && Object.hasOwn(profile.purchases, upgrade.id))
  return {
    owned: visible.owned,
    activeLocks: ownedLocks.filter((upgrade) => profile.purchases[upgrade.id].active).length,
    pendingLocks: ownedLocks.filter((upgrade) => !profile.purchases[upgrade.id].active).length,
    milestones: visible.milestones.filter((milestone) => profile.milestones[milestone.id] === true).length,
  }
}
