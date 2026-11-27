import { describe, expect, it } from 'vitest'
import type { CompanionEntity } from './domain/companion-types'
import { companionCategoryLabel, companionDisplayText, companionExactSum, companionGroupCount, companionGroups, companionPlannedCosts, companionPlural, companionRecordedStatus, companionRowSummary, companionSearchMatches, companionShoppingList, companionStatusText, companionSystemLabels, counterPercent } from './companion-view-model'
import type { RecordedStatus } from './companion-view-model'

const craft = (id: string, quantity: string): CompanionEntity => ({ system: 'craft', id, title: id, description: '', category: 'Permanent', reveal: { kind: 'always' }, provenance: [], recipe: [{ materialId: 'wood', quantity }] })

describe('companion presentation boundaries', () => {
  it('combines recipes before subtracting known stock once, with exact integer arithmetic', () => {
    expect(companionShoppingList([craft('axe', '9007199254740993'), craft('bow', '4')], { axe: '2', bow: '3' }, { wood: '5' })).toEqual([{ materialId: 'wood', required: '18014398509481998', stock: '5', remaining: '18014398509481993' }])
  })
  it('leaves unknown stock unknown and excludes plans outside the visible craft input', () => {
    expect(companionShoppingList([craft('axe', '3')], { axe: '2', hidden: '999' }, {})).toEqual([{ materialId: 'wood', required: '6' }])
    expect(companionShoppingList([craft('axe', '3')], { axe: '-1' }, { wood: '0' })).toEqual([])
  })
  it('retains non-material recipe charges separately by currency', () => {
    expect(companionPlannedCosts([{ ...craft('anvil', '1'), cost: '12', costUnit: 'Coins', otherCosts: [{ unit: 'Divinity Points', quantity: '300' }] }], { anvil: '2' })).toEqual([{ unit: 'Coins', quantity: '24' }, { unit: 'Divinity Points', quantity: '600' }])
  })
  it('never treats missing observations as recorded zero or incomplete', () => {
    expect(companionRecordedStatus(craft('axe', '3'), {})).toBe('unknown')
    expect(companionRecordedStatus(craft('axe', '3'), { completed: false })).toBe('incomplete')
    expect(counterPercent(undefined, '10')).toBeNull()
    expect(counterPercent('0', '10')).toBe(0)
    expect(counterPercent('99999999999999999999999999', '10')).toBe(100)
  })
  it('withholds incomplete cost totals and matches accents without mutating catalog identities', () => {
    expect(companionExactSum(['12', undefined])).toBeNull()
    expect(companionExactSum(['9007199254740993', '2'])).toBe('9007199254740995')
    expect(companionSearchMatches({ ...craft('native-1', '1'), title: 'Víctor’s sword' }, "victor's")).toBe(true)
  })
  it('replaces only the reviewed internal catalog phrases with plain wording, at render time', () => {
    const material: CompanionEntity = { system: 'material', id: 'wood', title: 'Wood', description: 'Native material. Recorded inventory is an observation; planning does not spend it.', category: 'Materials', reveal: { kind: 'always' }, provenance: [] }
    expect(companionDisplayText(material.description)).toBe('Crafting material. Record how many you hold; plans never spend it.')
    expect(companionDisplayText('Excluded from native Bestiary')).toBe('Not listed in the game’s Bestiary')
    expect(companionDisplayText('A native word inside other text stays as written.')).toBe('A native word inside other text stays as written.')
    expect(companionDisplayText('constructor')).toBe('constructor')
    // Search follows the displayed words, not the hidden internal ones.
    expect(companionSearchMatches(material, 'plans never spend')).toBe(true)
    expect(companionSearchMatches(material, 'observation')).toBe(false)
  })
  it('names recorded states and counts in the player’s words', () => {
    expect(companionStatusText({ system: 'achievement', category: '' }, 'complete')).toBe('Earned')
    expect(companionStatusText({ system: 'quest', category: 'Quest packs' }, 'incomplete')).toBe('Not owned')
    expect(companionStatusText({ system: 'enemy', category: '' }, 'unknown')).toBe('Not recorded')
    expect(companionSystemLabels.enemy).toBe('Bestiary')
    expect(companionPlural(1, 'entry', 'entries')).toBe('1 entry')
    expect(companionPlural(1200, 'entry', 'entries')).toBe('1,200 entries')
  })
  it('shows internal category identifiers as words without changing the stored category', () => {
    expect(companionCategoryLabel({ system: 'achievement', category: 'BestiaryMasteryTotalDiamond' })).toBe('Bestiary Mastery Total Diamond')
    expect(companionCategoryLabel({ system: 'achievement', category: 'TotalSP' })).toBe('Total SP')
    expect(companionCategoryLabel({ system: 'achievement', category: 'CpsAmount' })).toBe('Coins Per Second')
    expect(companionCategoryLabel({ system: 'quest', category: "Higgins' Quests" })).toBe("Higgins' Quests")
    expect(companionCategoryLabel({ system: 'enemy', category: 'Excluded from native Bestiary' })).toBe('Not listed in the game’s Bestiary')
    expect(companionCategoryLabel({ system: 'divinity', category: '' })).toBe('Divinities')
    const achievement: CompanionEntity = { system: 'achievement', id: 'a', title: 'Strong', description: '', category: 'PowerLevel', reveal: { kind: 'always' }, provenance: [] }
    expect(companionSearchMatches(achievement, 'power level')).toBe(true)
    expect(companionRowSummary({ description: 'No native Bestiary description is defined for this enemy.' })).toBe('')
    expect(companionRowSummary({ description: 'Slay 10 enemies.' })).toBe('Slay 10 enemies.')
  })
  it('groups entries by system and category in the given order, counting recorded and complete entries', () => {
    const entry = (system: CompanionEntity['system'], id: string, category: string): CompanionEntity => ({ system, id, title: id, description: '', category, reveal: { kind: 'always' }, provenance: [] })
    const entities = [entry('quest', 'q1', 'Rookie Quests'), entry('quest', 'q2', 'Hard Quests'), entry('quest', 'q3', 'Rookie Quests'), entry('village', 'v1', 'Village buildings'), entry('material', 'm1', 'Small Materials')]
    const status: Record<string, RecordedStatus> = { q1: 'complete', q2: 'incomplete', q3: 'unknown', v1: 'unknown', m1: 'incomplete' }
    const groups = companionGroups(entities, (entity) => status[entity.id])
    expect(groups.map((group) => [group.key, group.entities.map((entity) => entity.id), group.recorded, group.complete])).toEqual([
      ['quest:Rookie Quests', ['q1', 'q3'], 1, 1], ['quest:Hard Quests', ['q2'], 1, 0], ['village:Village buildings', ['v1'], 0, 0], ['material:Small Materials', ['m1'], 1, 0],
    ])
    expect(companionGroupCount(groups[0])).toBe('1 of 2 claimed')
    expect(companionGroupCount(groups[2])).toBe('0 of 1 complete')
    expect(companionGroupCount(groups[3])).toBe('1 of 1 recorded')
    expect(companionGroups([], () => 'unknown')).toEqual([])
  })
})
