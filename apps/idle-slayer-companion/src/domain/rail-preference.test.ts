import { describe, expect, it } from 'vitest'
import { COMPANION_STORAGE_KEY } from './companion-storage'
import { RAIL_PREFERENCE_KEY, loadRailCollapsed, saveRailCollapsed } from './rail-preference'

describe('navigation rail preference', () => {
  it('restores a collapsed rail and defaults to expanded', () => {
    expect(loadRailCollapsed(() => ({ getItem: () => 'collapsed' }))).toBe(true)
    expect(loadRailCollapsed(() => ({ getItem: () => 'expanded' }))).toBe(false)
  })

  it.each([null, '', 'true', '{broken', '"collapsed"'])('treats an absent or invalid value %s as expanded', (value) => {
    expect(loadRailCollapsed(() => ({ getItem: () => value }))).toBe(false)
  })

  it('stays expanded when storage or its getter throws', () => {
    const unavailable = () => { throw new Error('Storage unavailable') }
    expect(loadRailCollapsed(unavailable)).toBe(false)
    expect(loadRailCollapsed(() => ({ getItem: unavailable }))).toBe(false)
  })

  it('writes only its own device-local key, never the progress document', () => {
    const values = new Map([[COMPANION_STORAGE_KEY, 'existing-progress']])
    const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } })
    expect(saveRailCollapsed(true, storage)).toBe(true)
    expect(loadRailCollapsed(storage)).toBe(true)
    expect(saveRailCollapsed(false, storage)).toBe(true)
    expect(values).toEqual(new Map([[COMPANION_STORAGE_KEY, 'existing-progress'], [RAIL_PREFERENCE_KEY, 'expanded']]))
  })

  it('reports a refused write without throwing', () => {
    expect(saveRailCollapsed(true, () => ({ setItem: () => { throw new Error('Quota exceeded') } }))).toBe(false)
    expect(saveRailCollapsed(true, () => { throw new Error('Storage unavailable') })).toBe(false)
  })
})
