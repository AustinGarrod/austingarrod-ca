import { recordCompanionEntity, replaceAscensionProfile } from './companion-progress'
import type { CompanionProgress, CompanionRecord, CompanionSystem } from './companion-types'
import { planRemoval } from './rules'
import type { Catalog } from './types'

export type CompanionObservationResult =
  | { ok: true; progress: CompanionProgress; requiresPreview: boolean; removedUpgradeIds: string[] }
  | { ok: false; error: string }

/** Record observations without spending or rewards. Shared item corrections
 * retain the Ascension map's reviewed dependency-removal confirmation. */
export function planCompanionObservation(map: Catalog | null, progress: CompanionProgress, system: CompanionSystem, id: string, patch: CompanionRecord, observedAt = new Date().toISOString()): CompanionObservationResult {
  const removesReceipt = (system === 'craft' || system === 'village') && patch.completed === false && progress.ascension.milestones[id] === true
  if (removesReceipt && !map && Object.keys(progress.ascension.purchases).length > 0) {
    return { ok: false, error: 'Load the Ascension catalog before removing a recorded item while Ascension purchases are recorded. Progress was kept.' }
  }
  const recorded = recordCompanionEntity(progress, system, id, patch, observedAt)
  if (!removesReceipt || !map || !map.milestones.some((item) => item.id === id)) {
    return { ok: true, progress: recorded, requiresPreview: false, removedUpgradeIds: [] }
  }
  const mapIds = map.milestones.map((item) => item.id)
  const projected = { ...progress.ascension, milestones: Object.fromEntries(Object.entries(progress.ascension.milestones).filter(([key]) => mapIds.includes(key))) }
  const removal = planRemoval(map, projected, id, true)
  return { ok: true, progress: replaceAscensionProfile(recorded, removal.profile, mapIds), requiresPreview: true, removedUpgradeIds: removal.removed }
}
