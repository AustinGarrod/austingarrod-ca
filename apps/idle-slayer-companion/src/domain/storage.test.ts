import { describe, expect, it } from 'vitest'
import { emptyProfile, type Profile } from './types'
import {
  exportProfileBackup,
  MAX_PROFILE_BYTES,
  migrateProfile,
  parseProfileBackup,
} from './storage'

function populatedProfile(): Profile {
  return {
    version: 1,
    catalogRevision: 'old-catalog',
    epoch: 3,
    purchases: {
      known: { epoch: 3, active: true },
      'removed-or-unknown': { epoch: 1, active: false },
    },
    milestones: { received: true, 'unknown-milestone': true },
    showSpoilers: false,
  }
}

describe('profile backups', () => {
  it('round trips ownership, purchase epochs, activation, milestones and spoiler preference', () => {
    const profile = populatedProfile()
    profile.showSpoilers = true
    const exported = exportProfileBackup(profile)
    expect(exported.ok).toBe(true)
    if (!exported.ok) throw new Error('Expected export success')
    expect(parseProfileBackup(exported.text)).toEqual({ ok: true, profile })
  })

  it('starts with hidden spoilers and an empty, versioned profile', () => {
    expect(emptyProfile('current')).toEqual({
      version: 1,
      catalogRevision: 'current',
      epoch: 0,
      purchases: {},
      milestones: {},
      showSpoilers: false,
    })
  })

  it('rejects malformed JSON without returning replacement progress', () => {
    expect(parseProfileBackup('{')).toMatchObject({ ok: false, error: { kind: 'invalid-json' } })
  })

  it.each([
    ['unsupported version', { ...populatedProfile(), version: 2 }],
    ['missing property', { version: 1 }],
    ['unexpected property', { ...populatedProfile(), cost: '100' }],
    ['numeric revision', { ...populatedProfile(), catalogRevision: 2 }],
    ['empty revision', { ...populatedProfile(), catalogRevision: '' }],
    ['negative epoch', { ...populatedProfile(), epoch: -1 }],
    ['fractional epoch', { ...populatedProfile(), epoch: 1.5 }],
    ['unsafe epoch', { ...populatedProfile(), epoch: Number.MAX_SAFE_INTEGER + 1 }],
    ['string epoch', { ...populatedProfile(), epoch: '3' }],
    ['string spoiler flag', { ...populatedProfile(), showSpoilers: 'false' }],
    ['array purchases', { ...populatedProfile(), purchases: [] }],
    ['null milestones', { ...populatedProfile(), milestones: null }],
    ['future purchase epoch', { ...populatedProfile(), purchases: { future: { epoch: 4, active: false } } }],
    ['invalid activation', { ...populatedProfile(), purchases: { invalid: { epoch: 0, active: 1 } } }],
    ['extra purchase property', { ...populatedProfile(), purchases: { invalid: { epoch: 0, active: false, title: 'extra' } } }],
    ['incomplete purchase', { ...populatedProfile(), purchases: { invalid: { epoch: 0 } } }],
    ['false milestone', { ...populatedProfile(), milestones: { invalid: false } }],
    ['empty purchase ID', { ...populatedProfile(), purchases: { ' ': { epoch: 0, active: false } } }],
    ['array root', []],
    ['null root', null],
  ])('rejects %s', (_label, candidate) => {
    expect(parseProfileBackup(JSON.stringify(candidate))).toMatchObject({ ok: false, error: { kind: 'invalid-profile' } })
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the reserved property %s at every record level', (key) => {
    const root = JSON.stringify(populatedProfile()).replace('"version":1', `"${key}":{},"version":1`)
    const purchaseId = { ...populatedProfile(), purchases: JSON.parse(`{"${key}":{"epoch":0,"active":false}}`) as Profile['purchases'] }
    const milestoneId = { ...populatedProfile(), milestones: JSON.parse(`{"${key}":true}`) as Profile['milestones'] }
    const purchaseProperty = { ...populatedProfile(), purchases: { item: JSON.parse(`{"epoch":0,"active":false,"${key}":true}`) as { epoch: number; active: boolean } } }
    for (const text of [root, JSON.stringify(purchaseId), JSON.stringify(milestoneId), JSON.stringify(purchaseProperty)]) {
      expect(parseProfileBackup(text)).toMatchObject({ ok: false, error: { kind: 'invalid-profile' } })
    }
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('limits UTF-8 bytes before parsing, including multibyte strings', () => {
    const tooLarge = 'é'.repeat(MAX_PROFILE_BYTES / 2 + 1)
    expect(tooLarge.length).toBeLessThan(MAX_PROFILE_BYTES)
    expect(parseProfileBackup(tooLarge)).toMatchObject({ ok: false, error: { kind: 'too-large' } })
  })

  it('accepts an exactly 4 MiB JSON file', () => {
    const text = JSON.stringify(emptyProfile('current'))
    expect(parseProfileBackup(text + ' '.repeat(MAX_PROFILE_BYTES - text.length)).ok).toBe(true)
  })

  it('validates profiles before export instead of silently serializing unsupported fields', () => {
    const candidate = { ...populatedProfile(), unexpected: true }
    expect(exportProfileBackup(candidate)).toMatchObject({ ok: false, error: { kind: 'invalid-profile' } })
  })

  it('rejects compact input whose supported save and export representation exceeds the limit', () => {
    const profile = emptyProfile('current')
    for (let index = 0; index < 65_000; index++) {
      profile.purchases[`future-${index}`] = { epoch: 0, active: false }
    }
    const compact = JSON.stringify(profile)
    expect(Buffer.byteLength(compact)).toBeLessThan(MAX_PROFILE_BYTES)
    expect(Buffer.byteLength(JSON.stringify(profile, null, 2))).toBeGreaterThan(MAX_PROFILE_BYTES)
    expect(parseProfileBackup(compact)).toMatchObject({ ok: false, error: { kind: 'too-large' } })
  })

  it('preserves a large accepted unknown-ID profile through export and parse', () => {
    const profile = emptyProfile('current')
    for (let index = 0; index < 55_000; index++) {
      profile.purchases[`future-${index}`] = { epoch: 0, active: false }
    }
    const parsed = parseProfileBackup(JSON.stringify(profile))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected an accepted backup')
    const exported = exportProfileBackup(parsed.profile)
    expect(exported.ok).toBe(true)
    if (!exported.ok) throw new Error('Expected an exportable accepted profile')
    expect(parseProfileBackup(exported.text)).toEqual(parsed)
    expect(Object.keys(parsed.profile.purchases)).toHaveLength(55_000)
  })
})

describe('catalog migration', () => {
  it('refuses a migration that would exceed the supported save/export size', () => {
    const profile = emptyProfile('a')
    const bytes = () => Buffer.byteLength(JSON.stringify(profile, null, 2))
    for (let index = 0; index < 4_000; index++) profile.milestones[`future-${index}-${'x'.repeat(1_000)}`] = true
    let index = 0
    while (MAX_PROFILE_BYTES - bytes() > 64) {
      const prefix = `padding-${index++}-`
      const length = Math.min(1_024, MAX_PROFILE_BYTES - bytes() - 32)
      profile.milestones[prefix + 'x'.repeat(length - prefix.length)] = true
    }
    expect(MAX_PROFILE_BYTES - bytes()).toBeGreaterThanOrEqual(0)
    expect(MAX_PROFILE_BYTES - bytes()).toBeLessThan(64)
    const compact = JSON.stringify(profile)
    expect(parseProfileBackup(compact).ok).toBe(true)
    expect(parseProfileBackup(compact, 'b'.repeat(512))).toMatchObject({ ok: false, error: { kind: 'too-large' } })
    expect(profile.catalogRevision).toBe('a')
    expect(exportProfileBackup(profile).ok).toBe(true)
  })

  it('retains unknown purchases and milestones while updating the catalog revision', () => {
    const source = populatedProfile()
    const migrated = migrateProfile(source, 'new-catalog')
    expect(migrated).toEqual({ ...source, catalogRevision: 'new-catalog' })
    expect(migrated.purchases['removed-or-unknown']).toEqual({ epoch: 1, active: false })
    expect(migrated.milestones['unknown-milestone']).toBe(true)
    expect(source.catalogRevision).toBe('old-catalog')
    migrated.purchases.known!.active = false
    expect(source.purchases.known!.active).toBe(true)
  })
})
