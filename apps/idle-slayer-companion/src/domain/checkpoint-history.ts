import type { Catalog, Profile } from './types'
import type { ProfileHistoryEntry } from './profile-session'
import { compareProgress } from './progress-comparison'
import { planUltraAscension, visibility } from './rules'
import { sameRecordedProfile } from './checkpoints'
import type { HistoryAction } from './profile-history'
import { companionResetProofMatches } from './companion-reset-proof'

/** Only the actual current visit's bounded session history is evidence. Portable snapshots supply no operation claims. */
export function checkpointHistory(catalog: Catalog, first: Profile, second: Profile, current: Profile, past: ProfileHistoryEntry[], future: ProfileHistoryEntry[]) {
  const undone = [...future].reverse()
  const states = [...past.map((entry) => entry.profile), current, ...undone.map((entry) => entry.profile)]
  const entries = [...past, ...undone]
  const actions = entries.map((entry) => entry.action)
  const firstMatches = states.flatMap((profile, index) => sameRecordedProfile(profile, first) ? [index] : [])
  const secondMatches = states.flatMap((profile, index) => sameRecordedProfile(profile, second) ? [index] : [])
  if (sameRecordedProfile(first, second) || firstMatches.length !== 1 || secondMatches.length !== 1) return null
  const from = firstMatches[0], to = secondMatches[0], reversed = from > to
  const visible = visibility(catalog, current)
  const steps: HistoryAction[] = []
  const cleared = new Set<string>(), activated = new Set<string>()
  for (let index = Math.min(from, to); index < Math.max(from, to); index++) {
    const before = states[index], after = states[index + 1], action = actions[index]
    const resetAction = action === 'ultra_ascension' || action === 'companion_reset'
    const reset = resetAction ? planUltraAscension(catalog, before) : null
    // A label alone is insufficient: an alleged reset must exactly match the native plan.
    if (resetAction && (!reset || !sameRecordedProfile(reset.profile, after))) return null
    if (action === 'companion_reset' && !companionResetProofMatches(entries[index], before, after, catalog.revision)) return null
    const changes = compareProgress(catalog, before, after, current)
    if (changes.upgrades.length || changes.milestones.length || before.epoch !== after.epoch || before.showSpoilers !== after.showSpoilers) steps.push(action)
    if (reset && !reversed) {
      reset.cleared.filter((id) => visible.ids.has(id)).forEach((id) => cleared.add(id))
      reset.activated.filter((id) => visible.ids.has(id)).forEach((id) => activated.add(id))
    }
  }
  return { reversed, steps, cleared: [...cleared], activated: [...activated] }
}
