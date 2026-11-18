import { describe, expect, it } from 'vitest'
import catalogData from '../../public/catalog.json'
import type { Catalog } from './types'
import { emptyProfile } from './types'
import { visibility } from './rules'
import { editComparison, emptyComparison, exportComparison, MAX_COMPARISON_BYTES, parseComparison, presentedComparison } from './saved-comparison'

const catalog = catalogData as Catalog
const visible = visibility(catalog, emptyProfile(catalog.revision))
const ids = visible.upgrades.slice(0, 5).map((node) => node.id)
const list = (ids: string[]) => ({ ...emptyComparison(), ids })

describe('saved upgrade comparison', () => {
  it('round-trips a separate stable-ID reference, including unavailable IDs', () => {
    const value = list([ids[0], 'future-upgrade'])
    expect(parseComparison(exportComparison(value))).toEqual(value)
    expect(exportComparison(value)).not.toContain('purchases')
  })
  it('rejects malformed, oversized, duplicate, unsafe and profile documents', () => {
    for (const text of ['null', '[]', '{}', '{', JSON.stringify(emptyProfile(catalog.revision)), JSON.stringify({ ...list(ids), ids: ids }),
      JSON.stringify(list([ids[0], ids[0]])), JSON.stringify(list(['__proto__'])), JSON.stringify(list(['<private>'])), JSON.stringify(list(['x'.repeat(129)])),
      JSON.stringify({ ...emptyComparison(), version: 2 }), JSON.stringify({ ...emptyComparison(), note: 'private' }), ' '.repeat(MAX_COMPARISON_BYTES + 1)]) expect(parseComparison(text)).toBeNull()
  })
  it('filters hidden entries without placeholder, count, capacity or export leakage', () => {
    const hidden = catalog.upgrades.find((node) => !visible.ids.has(node.id))!
    const value = list([hidden.id, ids[0], 'future-upgrade'])
    expect(presentedComparison(value, catalog, visible.ids).ids).toEqual([ids[0], 'future-upgrade'])
    expect(exportComparison(presentedComparison(value, catalog, visible.ids))).not.toContain(hidden.id)
    expect(editComparison(value, ids[1], visible.ids, catalog)?.ids).toEqual([ids[0], 'future-upgrade', ids[1]])
    expect(editComparison(value, hidden.id, visible.ids, catalog)).toBeNull()
    expect(value.ids).toHaveLength(3)
  })
  it('requires deliberate replacement at capacity and keeps same-title IDs distinct', () => {
    expect(editComparison(list(ids.slice(0, 4)), ids[4], visible.ids, catalog)).toBeNull()
    expect(editComparison(list(ids.slice(0, 4)), ids[4], visible.ids, catalog, ids[1])?.ids).toEqual([ids[0], ids[4], ids[2], ids[3]])
    expect(editComparison(list(ids.slice(0, 4)), ids[4], visible.ids, catalog, 'stale')).toBeNull()
    const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key').slice(0, 4).map((node) => node.id)
    let value = emptyComparison()
    const all = new Set(catalog.upgrades.map((node) => node.id))
    for (const key of keys) value = editComparison(value, key, all, catalog)!
    expect(value.ids).toEqual(keys)
    expect(editComparison(value, keys[0], all, catalog)).toEqual(value)
  })
})
