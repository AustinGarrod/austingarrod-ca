import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { presentCost } from './cost-presentation'
import type { Catalog } from './types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
function representedInteger(value: string) {
  const { scientific, exact } = presentCost(value)
  if (!scientific) return BigInt(exact.replaceAll(',', ''))
  const [whole, fraction = ''] = scientific.coefficient.split('.')
  return BigInt(whole + fraction) * 10n ** BigInt(scientific.exponent - fraction.length)
}

describe('exact cost presentation', () => {
  it('keeps familiar grouped integers below a trillion and exact scientific notation for large costs', () => {
    expect(presentCost('0')).toMatchObject({ exact: '0', scientific: null })
    expect(presentCost('999999999999')).toMatchObject({ exact: '999,999,999,999', scientific: null })
    expect(presentCost('1000000000000').scientific).toEqual({ coefficient: '1', exponent: 12 })
    expect(presentCost('2150000000000000000').scientific).toEqual({ coefficient: '2.15', exponent: 18 })
    expect(presentCost('1000000000000000000').groups).toEqual(['1', '000', '000', '000', '000', '000', '000'])
  })
  it('represents every reviewed catalog cost exactly and preserves all same-title distinctions', () => {
    for (const node of catalog.upgrades) {
      expect(representedInteger(node.cost), node.id).toBe(BigInt(node.cost))
      expect(presentCost(node.cost).exact, node.id).toBe(BigInt(node.cost).toLocaleString('en'))
    }
    const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key')
    expect(new Set(keys.map((node) => JSON.stringify(presentCost(node.cost).scientific ?? presentCost(node.cost).exact))).size).toBe(keys.length)
  })
  it('never rounds future long mantissas, including one-SP distinctions beyond Number precision', () => {
    for (const value of ['9007199254740992', '9007199254740993', '12345678901234567890123456789012345678901', '10000000000000000000000000000000000000001']) {
      expect(representedInteger(value)).toBe(BigInt(value))
      expect(presentCost(value).scientific?.coefficient.replace('.', '')).toBe(value.replace(/0+$/, ''))
    }
    expect(presentCost('9007199254740992').scientific).not.toEqual(presentCost('9007199254740993').scientific)
  })
  it.each(['', '01', '-1', '1.5', '1e18', ' 1', '1,000'])('refuses non-canonical costs: %s', (value) => {
    expect(() => presentCost(value)).toThrow('canonical decimal integer')
  })
})
