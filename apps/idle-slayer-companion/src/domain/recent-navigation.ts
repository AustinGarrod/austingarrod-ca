/** View-only, most-recent-first inspection context for this mounted visit. */
export const RECENT_UPGRADE_LIMIT = 20

export function reconcileRecentUpgrades(recent: readonly string[], visibleIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  return recent.filter((id) => {
    if (!visibleIds.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  }).slice(0, RECENT_UPGRADE_LIMIT)
}

export function visitRecentUpgrade(recent: readonly string[], id: string, visibleIds: ReadonlySet<string>): string[] {
  return reconcileRecentUpgrades(visibleIds.has(id) ? [id, ...recent] : recent, visibleIds)
}
