import { describe, expect, it } from 'vitest'
import { requirementReviewTarget, visibleRequirement } from './requirement-view'
import { satisfies, visibility } from './rules'
import { emptyProfile } from './types'
import type { Catalog, Requirement, Upgrade } from './types'

const always: Requirement = { kind: 'always' }
const owned = (id: string): Requirement => ({ kind: 'owned', id })
const all = (...requirements: Requirement[]): Requirement => ({ kind: 'all', requirements })
const any = (...requirements: Requirement[]): Requirement => ({ kind: 'any', requirements })
const node = (id: string, purchase: Requirement = always, reveal: Requirement = always): Upgrade => ({ id, title: id, cost: '123456789012345678901234',
  description: '', icon: '', position: { x: 0, y: 0 }, purchase, reveal, retention: 'repeat', activation: 'immediate', sources: [] })
const catalog: Catalog = { revision: 'fixture', gameVersion: 'fixture', steamBuild: 'fixture', startId: 'A',
  upgrades: [node('A'), node('B'), node('C'), node('blocked', owned('B')), node('other-blocked', owned('C')),
    node('hidden', always, { kind: 'milestone', id: 'secret' })],
  milestones: [{ id: 'item', title: 'Item received', description: '', reveal: always, sources: [] },
    { id: 'secret', title: 'Secret item', description: '', reveal: owned('hidden'), sources: [] }],
  connections: [], grants: [], ultraAscension: always,
  verification: { coverage: false, purchaseRules: false, revealRules: false, resetRules: false, assets: false, evidence: [] } }

describe('visible requirement presentation', () => {
  it('preserves nested AND/OR and each visible leaf state without selecting a path', () => {
    const profile = emptyProfile(catalog.revision)
    profile.purchases.A = { epoch: 0, active: true }
    const before = structuredClone(profile)
    const requirement = all(any(owned('A'), owned('B')), owned('C'))
    const view = visibleRequirement(requirement, profile, visibility(catalog, profile))
    expect(view).toMatchObject({ kind: 'all', requirements: [{ kind: 'any', requirements: [
      { kind: 'leaf', label: 'A', satisfied: true, route: { kind: 'upgrade', id: 'A' } },
      { kind: 'leaf', label: 'B', satisfied: false, route: { kind: 'upgrade', id: 'B' } },
    ] }, { label: 'C', satisfied: false }] })
    expect(satisfies(requirement, profile)).toBe(false)
    expect(profile).toEqual(before)
  })

  it('distinguishes pending activation from owned and routes to the same visible ID', () => {
    const profile = emptyProfile(catalog.revision)
    profile.purchases.A = { epoch: 0, active: false }
    const visible = visibility(catalog, profile)
    expect(visibleRequirement(owned('A'), profile, visible)).toMatchObject({ satisfied: true, route: { kind: 'upgrade', id: 'A' } })
    expect(visibleRequirement({ kind: 'active', id: 'A' }, profile, visible)).toMatchObject({ label: 'A (active)', satisfied: false, route: { kind: 'upgrade', id: 'A' } })
  })

  it('offers only visible milestone and explicit history routes', () => {
    const profile = emptyProfile(catalog.revision)
    const visible = visibility(catalog, profile)
    expect(visibleRequirement({ kind: 'milestone', id: 'item' }, profile, visible)).toMatchObject({ label: 'Item received', satisfied: false, route: { kind: 'milestone', id: 'item' } })
    expect(visibleRequirement({ kind: 'ultra-ascended' }, profile, visible)).toMatchObject({ satisfied: false, route: { kind: 'history' } })
    expect(visibleRequirement({ kind: 'milestone', id: 'secret' }, profile, visible)).toBeNull()
  })

  it('omits hidden identities, states, counts and nested hidden topology', () => {
    const profile = emptyProfile(catalog.revision)
    const visible = visibility(catalog, profile)
    const plain = visibleRequirement(owned('A'), profile, visible)
    expect(visibleRequirement(all(owned('A'), owned('hidden')), profile, visible)).toEqual(plain)
    expect(visibleRequirement(all(owned('A'), any(owned('hidden'), all(owned('hidden'), { kind: 'milestone', id: 'secret' }))), profile, visible)).toEqual(plain)
    profile.purchases.hidden = { epoch: 0, active: true }
    expect(visibleRequirement(owned('hidden'), profile, visible)).toBeNull()
    expect(visibleRequirement(any(owned('hidden'), { kind: 'milestone', id: 'secret' }), profile, visible)).toBeNull()
  })

  it('uses shared explicit spoiler visibility without overriding native satisfaction', () => {
    const profile = { ...emptyProfile(catalog.revision), showSpoilers: true }
    expect(visibleRequirement(owned('hidden'), profile, visibility(catalog, profile))).toMatchObject({ label: 'hidden', satisfied: false })
  })

  it('keeps exact native cost and stable route identity for equal titles', () => {
    const profile = emptyProfile(catalog.revision)
    const same = { ...catalog, upgrades: [node('A'), { ...node('B'), title: 'A', cost: '2' }] }
    const visible = visibility(same, profile)
    expect(visibleRequirement(owned('B'), profile, visible)).toMatchObject({ label: 'A', identity: 'A · 2 SP', route: { kind: 'upgrade', id: 'B' } })
    expect(visibleRequirement(owned('A'), profile, visible)).toMatchObject({ identity: 'A · 123,456,789,012,345,678,901,234 SP' })
  })
})

describe('blocked suggestion review destination', () => {
  it('uses the selected visible blocked target, then visible catalog order, with no progress change', () => {
    const profile = emptyProfile(catalog.revision)
    const before = structuredClone(profile)
    const visible = visibility(catalog, profile)
    expect(requirementReviewTarget(visible, profile, 'other-blocked')?.id).toBe('other-blocked')
    expect(requirementReviewTarget(visible, profile, 'hidden')?.id).toBe('blocked')
    expect(profile).toEqual(before)
  })

  it('excludes owned and native-ready upgrades even with spoilers shown', () => {
    const profile = { ...emptyProfile(catalog.revision), showSpoilers: true }
    profile.purchases.blocked = { epoch: 0, active: false }
    profile.purchases.C = { epoch: 0, active: true }
    expect(requirementReviewTarget(visibility(catalog, profile), profile, 'blocked')?.id).toBe('hidden')
    profile.milestones.secret = true
    expect(requirementReviewTarget(visibility(catalog, profile), profile, 'blocked')).toBeUndefined()
  })
})
