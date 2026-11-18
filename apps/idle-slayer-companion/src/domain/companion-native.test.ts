import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import rules from '../../data/companion-native-rules.json'
import { encodeGameSaveFixture, nativeSaveFixture } from '../../tests/fixtures/game-save'
import type { Catalog } from './types'
import type { CompanionCatalog } from './companion-types'
import { emptyCompanionProgress, getCompanionRecord, recordCompanionEntity } from './companion-progress'
import { importCompanionGameSave, nativeUnsignedDecimal } from './companion-native'

const map = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const catalog = JSON.parse(readFileSync('public/companion-catalog.json', 'utf8')) as CompanionCatalog
const initial = emptyCompanionProgress(map.revision)
const mapping = (kind: string) => rules.imports.find((entry) => entry.kind === kind)!
const bytes = (options: Parameters<typeof nativeSaveFixture>[0] = {}) => encodeGameSaveFixture(nativeSaveFixture({ version: '7.3.4', ...options }))

describe('reviewed Companion native snapshot', () => {
  it('decodes all allowlisted modules together and discards unrelated native preferences', () => {
    const achievement = mapping('achievement'), material = mapping('material'), quest = mapping('quest'), divinity = mapping('divinity'), craft = mapping('permanentCraft')
    const result = importCompanionGameSave(map, catalog, initial, bytes({ integers: { [achievement.key]: 1, [quest.key]: -1, [craft.key]: 1 }, strings: { [material.key]: '1e20', [divinity.key]: '0#1', 'unrelated-account-token': 'private-synthetic-value' } }), '2026-10-16T12:00:00.000Z')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(getCompanionRecord(result.progress, 'achievement', achievement.id).completed).toBe(true)
    expect(getCompanionRecord(result.progress, 'material', material.id)).toEqual({ count: '100000000000000000000', discovered: true })
    expect(getCompanionRecord(result.progress, 'quest', quest.id).claimed).toBe(true)
    expect(getCompanionRecord(result.progress, 'divinity', divinity.id)).toEqual({ selected: true })
    expect(getCompanionRecord(result.progress, 'craft', craft.id).completed).toBe(true)
    expect(result.progress.modules.craft.records[craft.id].completed).toBe(false)
    expect(Object.values(result.progress.modules).every((module) => module.source === 'save' && module.tracked)).toBe(true)
    expect(JSON.stringify(result.progress)).not.toMatch(/unrelated-account-token|private-synthetic-value/)
    expect(initial.ascension.milestones).toEqual({})
  })
  it('distinguishes an undiscovered material from discovered zero stock', () => {
    const material = mapping('material')
    const absent = importCompanionGameSave(map, catalog, initial, bytes())
    const zero = importCompanionGameSave(map, catalog, initial, bytes({ strings: { [material.key]: '0' } }))
    if (!absent.ok || !zero.ok) throw new Error('Synthetic snapshot must be accepted')
    expect(getCompanionRecord(absent.progress, 'material', material.id)).toEqual({ discovered: false, count: '0' })
    expect(getCompanionRecord(zero.progress, 'material', material.id)).toEqual({ discovered: true, count: '0' })
  })
  it('rejects null recognized quantities without marking the material undiscovered', () => {
    const material = mapping('material')
    const fixture = nativeSaveFixture({ version: '7.3.4' })
    const model = { ...fixture, StringData: [...fixture.StringData, { Key: material.key, Value: null }] }
    expect(importCompanionGameSave(map, catalog, initial, encodeGameSaveFixture(model)).ok).toBe(false)
    expect(initial.modules.material.tracked).toBe(false)
  })
  it('applies the native empty default to the reviewed Ultra Ascension achievement counter', () => {
    const result = importCompanionGameSave(map, catalog, initial, bytes({ epoch: '' }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const counterRule = rules.imports.find((entry) => 'counterKey' in entry)!
    expect(getCompanionRecord(result.progress, 'achievement', counterRule.id).count).toBe('0')
  })
  it('checks numeric building deposits before accepting a built marker', () => {
    const building = mapping('building')
    const valid = importCompanionGameSave(map, catalog, initial, bytes({ strings: { [building.key]: '1#0#12#2147483647' } }))
    expect(valid.ok).toBe(true)
    if (!valid.ok) throw new Error(valid.error)
    expect(getCompanionRecord(valid.progress, 'village', building.id).built).toBe(true)
    for (const state of ['1#garbage', '1#', '1#-1', '1#2147483648', '1#1.5', '1\n']) {
      expect(importCompanionGameSave(map, catalog, initial, bytes({ strings: { [building.key]: state } })).ok, state).toBe(false)
    }
  })
  it('keeps legacy imports map-only and preserves unknown normalized records', () => {
    const current = recordCompanionEntity(initial, 'achievement', 'future-achievement', { completed: true })
    const result = importCompanionGameSave(map, catalog, current, bytes({ version: '7.2.0', epoch: '2' }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.progress.ascension.epoch).toBe(2)
    expect(result.progress.modules).toEqual(current.modules)
    const full = importCompanionGameSave(map, catalog, current, bytes())
    if (!full.ok) throw new Error(full.error)
    expect(full.progress.modules.achievement.records['future-achievement']).toEqual({ completed: true })
  })
  it('rejects unsupported recognized values atomically', () => {
    const achievement = mapping('achievement'), divinity = mapping('divinity')
    const original = JSON.stringify(initial)
    expect(importCompanionGameSave(map, catalog, initial, bytes({ integers: { [achievement.key]: 3 } })).ok).toBe(false)
    expect(importCompanionGameSave(map, catalog, initial, bytes({ strings: { [divinity.key]: 'opaque' } })).ok).toBe(false)
    expect(importCompanionGameSave(map, catalog, initial, bytes({ version: '7.9.9' })).ok).toBe(false)
    expect(importCompanionGameSave({ ...map, steamBuild: '99999999' }, catalog, initial, bytes()).ok).toBe(false)
    expect(JSON.stringify(initial)).toBe(original)
  })
})

describe('native exact integral quantities', () => {
  it.each([['0001', '1'], ['1.25e4', '12500'], ['90071992547409930000', '90071992547409930000'], ['0', '0'], ['12.00', '12']])('normalizes %s exactly', (input, expected) => expect(nativeUnsignedDecimal(input)).toBe(expected))
  it.each(['-1', '1.2', 'NaN', 'Infinity', '1e1000', '1,000', ''])('rejects %s', (input) => expect(nativeUnsignedDecimal(input)).toBeNull())
})
