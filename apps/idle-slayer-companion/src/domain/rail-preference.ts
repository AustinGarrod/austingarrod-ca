/** Device-local navigation rail choice. It is a display preference, never part of progress documents or sync. */
export const RAIL_PREFERENCE_KEY = 'idle-slayer-companion.rail.v1'

/** Access through a callback because the localStorage getter itself can throw. */
export function loadRailCollapsed(storage: () => Pick<Storage, 'getItem'>): boolean {
  try {
    return storage().getItem(RAIL_PREFERENCE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function saveRailCollapsed(collapsed: boolean, storage: () => Pick<Storage, 'setItem'>): boolean {
  try {
    storage().setItem(RAIL_PREFERENCE_KEY, collapsed ? 'collapsed' : 'expanded')
    return true
  } catch {
    return false
  }
}
