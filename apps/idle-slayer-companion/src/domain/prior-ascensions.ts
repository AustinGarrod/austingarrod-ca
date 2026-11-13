import type { Catalog, Profile } from './types'

export const MAX_PRIOR_ASCENSIONS = 1_000_000

type PriorAscensionsPlan = { kind: 'blocked'; reason: string } | { kind: 'ready'; profile: Profile }

/** Enter existing history without resetting ownership or activation. */
export function planPriorAscensions(catalog: Catalog, profile: Profile, value: string): PriorAscensionsPlan {
  if (!value.trim()) return { kind: 'blocked', reason: 'Enter the number of previous Ultra Ascensions before reviewing history.' }
  const epoch = Number(value)
  if (!Number.isSafeInteger(epoch) || epoch < 0) return { kind: 'blocked', reason: 'Enter a whole number of previous Ultra Ascensions, zero or greater.' }
  if (epoch > MAX_PRIOR_ASCENSIONS) return { kind: 'blocked', reason: 'Manual history entry supports counts up to 1,000,000. Your recorded progress has not changed.' }
  if (epoch < profile.epoch) return { kind: 'blocked', reason: 'This control cannot lower the recorded count. Use Undo for an entry mistake in this session, or restore an earlier JSON backup.' }
  if (epoch === profile.epoch) return { kind: 'blocked', reason: 'This count is already recorded. Enter a higher count to review a history change.' }
  const knownIds = new Set(catalog.upgrades.map((upgrade) => upgrade.id))
  return { kind: 'ready', profile: {
    ...profile, epoch,
    purchases: Object.fromEntries(Object.entries(profile.purchases).map(([id, purchase]) => [id,
      purchase.epoch === profile.epoch && knownIds.has(id) ? { ...purchase, epoch } : purchase,
    ])),
  } }
}
