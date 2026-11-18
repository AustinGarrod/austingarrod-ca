import type { MapLayoutMode } from './map-layout'

export const LAYOUT_PREFERENCE_KEY = 'idle-slayer-ascension-map.layout.v1'

/** Access through a callback because the localStorage getter itself can throw. */
export function loadLayoutPreference(storage: () => Pick<Storage, 'getItem'>): MapLayoutMode {
  try {
    return storage().getItem(LAYOUT_PREFERENCE_KEY) === 'web' ? 'web' : 'native'
  } catch {
    return 'native'
  }
}

export function saveLayoutPreference(mode: MapLayoutMode, storage: () => Pick<Storage, 'setItem'>): boolean {
  try {
    storage().setItem(LAYOUT_PREFERENCE_KEY, mode)
    return true
  } catch {
    return false
  }
}
