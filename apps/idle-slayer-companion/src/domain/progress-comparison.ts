import { visibility } from './rules'
import type { Catalog, Profile } from './types'

/** Replacement details use the viewer's current graph, never incoming spoiler choices or unknown IDs. */
export function compareProgress(catalog: Catalog, current: Profile, incoming: Profile, viewer: Profile = current) {
  const visible = visibility(catalog, viewer)
  const upgrades = visible.upgrades.flatMap((upgrade) => {
    const before = Object.hasOwn(current.purchases, upgrade.id) ? current.purchases[upgrade.id] : undefined
    const after = Object.hasOwn(incoming.purchases, upgrade.id) ? incoming.purchases[upgrade.id] : undefined
    if (!before && !after || before && after && before.active === after.active && before.epoch === after.epoch) return []
    return [{ upgrade, before, after }]
  })
  const milestones = visible.milestones.flatMap((milestone) => {
    const before = current.milestones[milestone.id] === true
    const after = incoming.milestones[milestone.id] === true
    return before === after ? [] : [{ milestone, before, after }]
  })
  return { upgrades, milestones }
}

/** Context in a filename; the versioned JSON itself remains unchanged. */
export function progressBackupFilename(profile: Profile, at: Date = new Date()) {
  const timestamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `idle-slayer-progress-${timestamp}-ua${profile.epoch}.json`
}
