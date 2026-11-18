import { describe, expect, it } from 'vitest'
import { LAYOUT_PREFERENCE_KEY, loadLayoutPreference, saveLayoutPreference } from './layout-preference'

describe('layout preference', () => {
  it.each(['native', 'web'] as const)('restores the saved %s layout', (mode) => {
    expect(loadLayoutPreference(() => ({ getItem: () => mode }))).toBe(mode)
  })

  it.each([null, '', 'game', 'detailed', '{broken', '"web"'])('defaults to Game for an absent or invalid value %s', (value) => {
    expect(loadLayoutPreference(() => ({ getItem: () => value }))).toBe('native')
  })

  it('defaults to Game when reading storage or obtaining it throws', () => {
    const unavailable = () => { throw new Error('Storage unavailable') }
    expect(loadLayoutPreference(unavailable)).toBe('native')
    expect(loadLayoutPreference(() => ({ getItem: unavailable }))).toBe('native')
  })

  it('remembers the last selection without changing progress or tracking preferences', () => {
    const values = new Map([
      ['idle-slayer-ascension-map.profile.v1', 'existing-progress'],
      ['idle-slayer-ascension-map.analytics.v1', 'disabled'],
    ])
    const storage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    expect(saveLayoutPreference('web', storage)).toBe(true)
    expect(loadLayoutPreference(storage)).toBe('web')
    expect(saveLayoutPreference('native', storage)).toBe(true)
    expect(loadLayoutPreference(storage)).toBe('native')
    expect(values).toEqual(new Map([
      ['idle-slayer-ascension-map.profile.v1', 'existing-progress'],
      ['idle-slayer-ascension-map.analytics.v1', 'disabled'],
      [LAYOUT_PREFERENCE_KEY, 'native'],
    ]))
  })

  it('reports failed writes without throwing or discarding a stored choice', () => {
    let stored = 'web'
    const storage = () => ({
      getItem: () => stored,
      setItem: () => { throw new Error('Quota exceeded') },
    })
    expect(saveLayoutPreference('native', storage)).toBe(false)
    expect(loadLayoutPreference(storage)).toBe('web')
    expect(saveLayoutPreference('native', () => { throw new Error('Storage unavailable') })).toBe(false)
    expect(stored).toBe('web')
  })
})
