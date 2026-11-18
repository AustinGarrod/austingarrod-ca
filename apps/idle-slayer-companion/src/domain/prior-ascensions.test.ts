import { describe, expect, it } from 'vitest'
import { planPriorAscensions, MAX_PRIOR_ASCENSIONS } from './prior-ascensions'
import { emptyProfile, MAX_PROFILE_EPOCH, type Catalog } from './types'

const catalog = { upgrades: [{ id: 'current' }, { id: 'retained' }, { id: 'pending' }] } as Catalog

describe('prior Ultra Ascension history planning', () => {
  it.each(['', ' ', '-1', '1.5', 'NaN', 'Infinity', '1000001', String(MAX_PROFILE_EPOCH)])('rejects invalid or unsupported entry %j without changing progress', (value) => {
    const profile = emptyProfile('fixture')
    expect(planPriorAscensions(catalog, profile, value).kind).toBe('blocked')
    expect(profile).toEqual(emptyProfile('fixture'))
  })
  it('explains decreasing and unchanged counts and preserves a higher safe profile epoch', () => {
    const profile = { ...emptyProfile('fixture'), epoch: 3 }
    expect(planPriorAscensions(catalog, profile, '2')).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('cannot lower') })
    expect(planPriorAscensions(catalog, profile, '3')).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('already recorded') })
    const maxProfile = { ...profile, epoch: MAX_PROFILE_EPOCH }
    expect(planPriorAscensions(catalog, maxProfile, String(MAX_PRIOR_ASCENSIONS)).kind).toBe('blocked')
    expect(maxProfile.epoch).toBe(MAX_PROFILE_EPOCH)
  })
  it('moves only known current-epoch purchases without resetting or activating ownership', () => {
    const profile = { ...emptyProfile('fixture'), epoch: 2, purchases: {
      current: { epoch: 2, active: true }, pending: { epoch: 2, active: false },
      retained: { epoch: 1, active: true }, unknown: { epoch: 2, active: false },
    }, milestones: { item: true as const }, showSpoilers: true }
    const result = planPriorAscensions(catalog, profile, String(MAX_PRIOR_ASCENSIONS))
    expect(result).toEqual({ kind: 'ready', profile: { ...profile, epoch: MAX_PRIOR_ASCENSIONS, purchases: {
      ...profile.purchases, current: { epoch: MAX_PRIOR_ASCENSIONS, active: true }, pending: { epoch: MAX_PRIOR_ASCENSIONS, active: false },
    } } })
    expect(profile.epoch).toBe(2)
    expect(profile.purchases.current.epoch).toBe(2)
  })
})
