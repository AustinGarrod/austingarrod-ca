import { describe, expect, it } from 'vitest'
import type { CompanionEntity } from './domain/companion-types'
import { companionExactSum, companionPlannedCosts, companionRecordedStatus, companionSearchMatches, companionShoppingList, counterPercent } from './companion-view-model'

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
})
