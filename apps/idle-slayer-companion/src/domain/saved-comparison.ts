import type { Catalog } from './types'

export const COMPARISON_STORAGE_KEY = 'idle-slayer-ascension-map.comparison.v1'
export const MAX_COMPARISON_ENTRIES = 4
export const MAX_COMPARISON_BYTES = 4096
export interface SavedComparison { kind: 'upgrade-comparison'; version: 1; ids: string[] }
export const emptyComparison = (): SavedComparison => ({ kind: 'upgrade-comparison', version: 1, ids: [] })

/** A reference list, never a progress snapshot, cached catalog or title identity. */
export function parseComparison(text: string): SavedComparison | null {
  if (new TextEncoder().encode(text).length > MAX_COMPARISON_BYTES) return null
  try {
    const value = JSON.parse(text) as Partial<SavedComparison>
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'ids,kind,version'
      || value.kind !== 'upgrade-comparison' || value.version !== 1 || !Array.isArray(value.ids) || value.ids.length > MAX_COMPARISON_ENTRIES
      || value.ids.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id))
      || new Set(value.ids).size !== value.ids.length) return null
    return { kind: 'upgrade-comparison', version: 1, ids: [...value.ids] }
  } catch { return null }
}

export function exportComparison(value: SavedComparison): string {
  const text = JSON.stringify(value, null, 2)
  if (!parseComparison(text)) throw new Error('Unsupported comparison')
  return text
}

/** Known hidden entries contribute no row, count, capacity, identity or export. */
export function presentedComparison(value: SavedComparison, catalog: Catalog, visibleIds: ReadonlySet<string>): SavedComparison {
  const known = new Set(catalog.upgrades.map((upgrade) => upgrade.id))
  return { ...value, ids: value.ids.filter((id) => visibleIds.has(id) || !known.has(id)) }
}

export function editComparison(value: SavedComparison, id: string, visibleIds: ReadonlySet<string>, catalog: Catalog, replace?: string): SavedComparison | null {
  if (!visibleIds.has(id)) return null
  const next = presentedComparison(value, catalog, visibleIds)
  if (next.ids.includes(id)) return next
  if (replace !== undefined) {
    const position = next.ids.indexOf(replace)
    if (position < 0) return null
    next.ids[position] = id
  } else if (next.ids.length < MAX_COMPARISON_ENTRIES) next.ids.push(id)
  else return null
  return next
}
