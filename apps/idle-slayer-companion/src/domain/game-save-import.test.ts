import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import priorities from '../data/wiki-priorities.json'
import { importGameSave, type GameSaveImportPreview } from './game-save-import'
import { MAX_GAME_SAVE_BYTES } from './save-codec'
import { planPurchase, planRemoval, planUltraAscension, satisfies, visibility } from './rules'
import { recommendUpgrades } from './recommendations'
import { exportProfileBackup, parseProfileBackup } from './storage'
import { emptyProfile, type Catalog, type Profile } from './types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!
const start = node('Permanent Slayer')
const repeat = node('Reinvest')
const locked = node('Land Lord')
const immediateAstral = node('Astral Blessing')
const target = node('Village Key')
const ultra = node('Ultra Ascension')

type RawSave = {
  StringData: { Key: string; Value: string | null }[]
  IntData: { Key: string; Value: number }[]
  FloatData: { Key: string; Value: number }[]
  BoolData: { Key: string; Value: boolean }[]
}
function model(epoch: string | null | undefined = '3', states: Record<string, number> = {}): RawSave {
  return {
    StringData: [{ Key: 'Last Played Version', Value: '7.2.0' }, ...(epoch === undefined ? [] : [{ Key: 'Ultra Ascensions', Value: epoch }])],
    IntData: Object.entries(states).map(([Key, Value]) => ({ Key, Value })), FloatData: [], BoolData: [],
  }
}
/** Synthetic protocol fixtures only; no player-save bytes or preferences. */
function encode(value: unknown): Uint8Array {
  const key = 'If you manage to get this string you are allowed to hack the game all you want'
  const text = JSON.stringify(value)
  let scrambled = ''
  for (let index = 0; index < text.length; index++) scrambled += String.fromCharCode(text.charCodeAt(index) ^ key.charCodeAt(index % key.length))
  return new TextEncoder().encode(scrambled)
}
function preview(value: RawSave, current = initial): GameSaveImportPreview {
  const result = importGameSave(catalog, current, encode(value))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  return result
}
function preparedUltraStates(): Record<string, number> {
  const profile = { ...initial, epoch: 3, milestones: Object.fromEntries(catalog.milestones.map((item) => [item.id, true as const])) }
  const choices: Record<string, number> = {}
  for (let attempt = 0; attempt < 100; attempt++) {
    const plan = planPurchase(catalog, profile, ultra.id, choices)
    if (plan.kind === 'ready') return Object.fromEntries(Object.keys(plan.profile.purchases).map((id) => [id, 1]))
    if (plan.kind === 'blocked') throw new Error('Synthetic Ultra Ascension fixture cannot satisfy native prerequisites')
    choices[plan.key] = 0
  }
  throw new Error('Synthetic Ultra Ascension fixture did not resolve')
}

describe('Steam game-save snapshot import', () => {
  it('replaces known state, imports only native IDs, and preserves unknown app state and spoiler preference', () => {
    const current: Profile = {
      ...initial, epoch: 5, showSpoilers: true,
      purchases: { [repeat.id]: { epoch: 5, active: true }, 'app-future-id': { epoch: 4, active: false } },
      milestones: { [catalog.milestones[0].id]: true, 'app-future-milestone': true },
    }
    const result = preview(model('3', { [start.id]: 1, 'unrelated-save-id': 1 }), current)
    expect(result.profile.epoch).toBe(3)
    expect(result.profile.catalogRevision).toBe(catalog.revision)
    expect(result.profile.showSpoilers).toBe(true)
    expect(result.profile.purchases).toEqual({ [start.id]: { epoch: 3, active: true }, 'app-future-id': { epoch: 3, active: false } })
    expect(result.profile.milestones).toEqual({ 'app-future-milestone': true })
    expect(result.summary).toMatchObject({ ownedUpgrades: 1, preservedUnknownPurchases: 1, preservedUnknownMilestones: 1, adjustedUnknownPurchaseEpochs: 1 })
    expect(result.warnings).toContain('Existing unknown map purchases were preserved, with their epochs adjusted to fit the imported Ultra Ascension count.')
    expect(parseProfileBackup(JSON.stringify(result.profile))).toEqual({ ok: true, profile: result.profile })
  })

  it('does not mutate source bytes, the current profile, the catalog or preserved record objects', () => {
    const current = { ...initial, purchases: { 'app-future-id': { epoch: 0, active: false } } }
    const bytes = encode(model('3', { [start.id]: 1 }))
    const beforeBytes = bytes.slice(), beforeProfile = structuredClone(current), beforeCatalog = structuredClone(catalog)
    const result = importGameSave(catalog, current, bytes)
    expect(result.ok).toBe(true)
    expect(bytes).toEqual(beforeBytes)
    expect(current).toEqual(beforeProfile)
    expect(catalog).toEqual(beforeCatalog)
    if (result.ok) result.profile.purchases['app-future-id'].active = true
    expect(current.purchases['app-future-id'].active).toBe(false)
  })

  it('maps pending locks, proven lock activation and immediate state2 separately', () => {
    const pending = preview(model('3', { [locked.id]: 1, [immediateAstral.id]: 2, [repeat.id]: 1 }))
    expect(pending.profile.purchases[locked.id]).toEqual({ epoch: 3, active: false })
    expect(pending.profile.purchases[immediateAstral.id]).toEqual({ epoch: 2, active: true })
    expect(pending.profile.purchases[repeat.id]).toEqual({ epoch: 3, active: true })
    expect(pending.summary).toMatchObject({ activeAstralLocks: 0, pendingAstralLocks: 1 })
    const active = preview(model('3', { [locked.id]: 2 }))
    expect(active.profile.purchases[locked.id]).toEqual({ epoch: 2, active: true })
    expect(active.summary).toMatchObject({ activeAstralLocks: 1, pendingAstralLocks: 0 })
  })

  it('protects active retained Astrals with missing repeat parents during unrelated removal', () => {
    const result = preview(model('3', { [immediateAstral.id]: 1, [start.id]: 1 }))
    expect(satisfies(immediateAstral.purchase, result.profile)).toBe(false)
    const removal = planRemoval(catalog, result.profile, start.id)
    expect(removal.profile.purchases[immediateAstral.id]).toEqual({ epoch: 2, active: true })
    expect(removal.removed).not.toContain(immediateAstral.id)
    expect(result.warnings).toContain('The save records current ownership, not purchase history. Active permanent and retained upgrades use an earlier-ascension baseline for map edits.')
  })

  it('protects only already-owned retention targets and reevaluates retention on the next Ultra Ascension', () => {
    const result = preview(model('3', { ...preparedUltraStates(), [locked.id]: 2, [target.id]: 1 }))
    expect(result.profile.purchases[target.id]).toEqual({ epoch: 2, active: true })
    const noTarget = preview(model('3', { [locked.id]: 2 }))
    expect(noTarget.profile.purchases[target.id]).toBeUndefined()
    const removal = planRemoval(catalog, result.profile, locked.id)
    expect(removal.profile.purchases[target.id]).toBeDefined()
    const reset = planUltraAscension(catalog, removal.profile)!
    expect(reset).not.toBeNull()
    expect(reset.profile.epoch).toBe(4)
    expect(reset.cleared).toContain(target.id)
    expect(reset.profile.purchases[target.id]).toBeUndefined()
  })

  it('activates imported pending locks at the next reset without inventing a missing retention target', () => {
    const result = preview(model('3', { [locked.id]: 1, [ultra.id]: 1 }))
    const reset = planUltraAscension(catalog, result.profile)!
    expect(reset.activated).toContain(locked.id)
    expect(reset.profile.purchases[locked.id]).toEqual({ epoch: 3, active: true })
    expect(reset.profile.purchases[target.id]).toBeUndefined()
  })

  it('imports all nine exact item ownership flags and does not infer items from other typed preferences', () => {
    const flags = Object.fromEntries(catalog.milestones.map((item) => [item.id, 1]))
    const result = preview(model('3', flags))
    expect(result.summary.recordedMilestones).toBe(9)
    expect(Object.keys(result.profile.milestones).sort()).toEqual(catalog.milestones.map((item) => item.id).sort())
    const otherTypes = model('3')
    otherTypes.StringData.push({ Key: catalog.milestones[0].id, Value: '1' })
    otherTypes.BoolData.push({ Key: catalog.milestones[0].id, Value: true })
    otherTypes.FloatData.push({ Key: catalog.milestones[0].id, Value: 1 })
    otherTypes.BoolData.push({ Key: 'synthetic-earlier-event', Value: true })
    expect(preview(otherTypes).profile.milestones).toEqual({})
  })

  it('uses only IntData ownership even when a native ID appears in every typed preference array', () => {
    const value = model('0')
    value.StringData.push({ Key: start.id, Value: '1' })
    value.FloatData.push({ Key: start.id, Value: 1 })
    value.BoolData.push({ Key: start.id, Value: true })
    expect(preview(value).profile.purchases[start.id]).toBeUndefined()
    value.IntData.push({ Key: start.id, Value: 1 })
    expect(preview(value).profile.purchases[start.id]).toEqual({ epoch: 0, active: true })
    value.StringData.push({ Key: 'synthetic-null-setting', Value: null })
    expect(preview(value).sourceVersion).toBe('7.2.0')
  })

  it('preserves a hidden known ownership flag without revealing it or recommending hidden upgrades', () => {
    const hidden = catalog.upgrades.find((upgrade) => !visibility(catalog, {
      ...initial, epoch: 3, purchases: { [start.id]: { epoch: 3, active: true }, [upgrade.id]: { epoch: 3, active: true } },
    }).ids.has(upgrade.id))!
    expect(hidden).toBeDefined()
    const result = preview(model('3', { [start.id]: 1, [hidden.id]: 1 }))
    expect(result.profile.purchases[hidden.id]).toBeDefined()
    expect(visibility(catalog, result.profile).ids.has(hidden.id)).toBe(false)
    const recommendations = recommendUpgrades(catalog, result.profile, priorities)
    expect(recommendations.suggestions.length).toBeGreaterThan(0)
    expect(recommendations.suggestions[0].upgrade.id).not.toBe(start.id)
    for (const suggestion of recommendations.suggestions) {
      expect(visibility(catalog, result.profile).ids.has(suggestion.upgrade.id)).toBe(true)
      expect(satisfies(suggestion.upgrade.purchase, result.profile)).toBe(true)
      expect(satisfies(suggestion.upgrade.reveal, result.profile)).toBe(true)
    }
    expect(result.warnings.join(' ')).not.toContain(hidden.title)
  })

  it.each(['0', '5', '5.0', '5e0', '5E+1', '+5', '1.0e3', '', '1e6'])('accepts an exact supported integral counter: %s', (counter) => {
    const result = preview(model(counter))
    expect(result.profile.epoch).toBe(counter === '' ? 0 : Number(counter))
  })

  it('uses the native zero default for a missing counter and preserves an unknown earlier epoch', () => {
    const value = model('0')
    value.StringData = value.StringData.filter((entry) => entry.Key !== 'Ultra Ascensions')
    const current = { ...initial, purchases: { 'app-future-id': { epoch: 0, active: true } } }
    expect(preview(value, current).profile.purchases['app-future-id']).toEqual({ epoch: 0, active: true })
  })

  it.each(['-1', '5.5', '1,000', '1e7', 'NaN', 'Infinity', '0x10', '1.0000000000000000001', ' ', null])('rejects a counter without coercion or history invention: %s', (counter) => {
    const result = importGameSave(catalog, initial, encode(model(counter)))
    expect(result).toEqual({ ok: false, error: 'The save has an unsupported Ultra Ascension counter. Map progress was not changed.' })
  })

  it('rejects an activated lock at epoch0 without inventing an Ultra Ascension', () => {
    expect(importGameSave(catalog, initial, encode(model('0', { [locked.id]: 2 })))).toEqual({ ok: false, error: 'The save records Astral activation without an Ultra Ascension. Map progress was not changed.' })
  })

  it.each(['7.1.0', '7.2.1', '7.2.0 ', null])('rejects an unsupported or null version without echoing it: %s', (version) => {
    const value = model('3')
    value.StringData[0].Value = version
    expect(importGameSave(catalog, initial, encode(value))).toEqual({ ok: false, error: 'Only reviewed Idle Slayer 7.2.0 or 7.3.4 Steam saves can be imported. Map progress was not changed.' })
  })

  it('rejects a missing version and an incompatible native catalog', () => {
    const value = model('3')
    value.StringData = value.StringData.filter((entry) => entry.Key !== 'Last Played Version')
    expect(importGameSave(catalog, initial, encode(value)).ok).toBe(false)
    expect(importGameSave({ ...catalog, gameVersion: '7.1.0' }, initial, encode(model('3'))).ok).toBe(false)
  })

  it.each([-1, 3, 2147483647])('rejects a known upgrade state outside supported writers: %s', (state) => {
    expect(importGameSave(catalog, initial, encode(model('3', { [start.id]: state })))).toEqual({ ok: false, error: 'The save has an unsupported Ascension ownership state. Map progress was not changed.' })
  })

  it('rejects unsupported milestone flags instead of treating any positive number as received', () => {
    expect(importGameSave(catalog, initial, encode(model('3', { [catalog.milestones[0].id]: 2 })))).toEqual({ ok: false, error: 'The save has an unsupported milestone ownership state. Map progress was not changed.' })
  })

  it('ignores arbitrary save keys, including prototype-like keys, without creating app records or pollution', () => {
    const value = model('3')
    value.IntData.push(...['__proto__', 'constructor', 'prototype', 'unrelated-save-id'].map((Key) => ({ Key, Value: 1 })))
    const result = preview(value)
    expect(result.profile.purchases).toEqual({})
    expect(result.profile.milestones).toEqual({})
    expect(Object.getPrototypeOf(result.profile.purchases)).toBe(Object.prototype)
    expect(Object.hasOwn(result.profile.purchases, '__proto__')).toBe(false)
  })

  it('rejects an unsafe app profile or catalog identity without modifying current progress', () => {
    const current = { ...initial, purchases: JSON.parse('{"__proto__":{"epoch":0,"active":true}}') }
    const before = JSON.stringify(current)
    expect(importGameSave(catalog, current, encode(model('3'))).ok).toBe(false)
    expect(JSON.stringify(current)).toBe(before)
    const invalidCatalog = structuredClone(catalog)
    invalidCatalog.upgrades[0].id = '__proto__'
    expect(importGameSave(invalidCatalog, initial, encode(model('3'))).ok).toBe(false)
    invalidCatalog.upgrades[0].id = invalidCatalog.upgrades[1].id
    expect(importGameSave(invalidCatalog, initial, encode(model('3'))).ok).toBe(false)
  })

  it('rejects malformed transport and preference schemas while keeping current progress exportable', () => {
    const current = { ...initial, purchases: { [start.id]: { epoch: 0, active: true } } }
    for (const bytes of [new Uint8Array(), new TextEncoder().encode('{broken'), encode({ ...model('3'), IntData: {} }), new Uint8Array(MAX_GAME_SAVE_BYTES + 1)]) {
      expect(importGameSave(catalog, current, bytes).ok).toBe(false)
      expect(exportProfileBackup(current).ok).toBe(true)
      expect(current.purchases[start.id]).toEqual({ epoch: 0, active: true })
    }
  })
})
