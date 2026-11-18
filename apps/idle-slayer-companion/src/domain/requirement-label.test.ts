import { describe, expect, it } from 'vitest'
import { formatRequirement } from './requirement-label'
import type { Requirement } from './types'

const owned = (id: string): Requirement => ({ kind: 'owned', id })
const all = (...requirements: Requirement[]): Requirement => ({ kind: 'all', requirements })
const any = (...requirements: Requirement[]): Requirement => ({ kind: 'any', requirements })
const label = (requirement: Exclude<Requirement, { kind: 'all' | 'any' }>) => 'id' in requirement ? requirement.id : requirement.kind

describe('requirement explanation grouping', () => {
  it('groups OR alternatives inside an AND expression', () => {
    expect(formatRequirement(all(any(owned('A'), owned('B')), owned('C')), label)).toBe('(A OR B) AND C')
  })

  it('groups AND paths inside an OR expression', () => {
    expect(formatRequirement(any(all(owned('A'), owned('B')), owned('C')), label)).toBe('(A AND B) OR C')
  })

  it('preserves multiple alternating levels and child order', () => {
    expect(formatRequirement(all(owned('A'), any(owned('B'), all(owned('C'), owned('D')))), label)).toBe('A AND (B OR (C AND D))')
  })

  it('does not add grouping to flat or repeated associative operators', () => {
    expect(formatRequirement(all(owned('A'), all(owned('B'), owned('C'))), label)).toBe('A AND B AND C')
    expect(formatRequirement(any(owned('A'), any(owned('B'), owned('C'))), label)).toBe('A OR B OR C')
  })

  it('preserves caller-supplied visible, active and hidden labels', () => {
    const requirements = all(any(owned('visible'), { kind: 'active', id: 'hidden' }), { kind: 'milestone', id: 'hidden-item' })
    const labels = (requirement: Exclude<Requirement, { kind: 'all' | 'any' }>) => requirement.kind === 'owned' ? 'Visible upgrade'
      : requirement.kind === 'active' ? 'Unrevealed upgrade (active)' : 'Unrevealed milestone'
    expect(formatRequirement(requirements, labels)).toBe('(Visible upgrade OR Unrevealed upgrade (active)) AND Unrevealed milestone')
  })

  it('passes single leaves through unchanged', () => {
    expect(formatRequirement({ kind: 'always' }, () => 'No prerequisites')).toBe('No prerequisites')
    expect(formatRequirement({ kind: 'ultra-ascended' }, () => 'At least one Ultra Ascension')).toBe('At least one Ultra Ascension')
  })
})
