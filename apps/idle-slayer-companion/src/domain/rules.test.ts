import { describe, expect, it } from 'vitest'
import { emptyProfile, MAX_PROFILE_EPOCH } from './types'
import { exportProfileBackup, parseProfileBackup } from './storage'
import type { Catalog, Requirement, Upgrade } from './types'
import { conditionallyRetainedPurchases, planAstralActivation, planPurchase, planRemoval, planUltraAscension, searchVisible, visibility } from './rules'

// Deliberately synthetic fixtures exercise the engine; never shipped as game data.
const always: Requirement = { kind: 'always' }
const owned = (id: string): Requirement => ({ kind: 'owned', id })
const active = (id: string): Requirement => ({ kind: 'active', id })
const any: Requirement = { kind: 'any', requirements: [owned('a'), owned('b')] }
const upgrade = (id: string, purchase: Requirement = always, extra: Partial<Upgrade> = {}): Upgrade => ({
  id, title: id, description: '', cost: '99999999999999999999999', icon: '', position: { x: 0, y: 0 },
  purchase, reveal: always, retention: 'repeat', activation: 'immediate', sources: [], ...extra,
})
const catalog: Catalog = {
  revision: 'fixture', gameVersion: 'test', steamBuild: 'test', startId: 'a',
  upgrades: [upgrade('a'), upgrade('b'), upgrade('or', any), upgrade('child', owned('or')),
    upgrade('story', { kind: 'milestone', id: 'item' }, { title: 'Hero’s Gift', reveal: { kind: 'milestone', id: 'item' } }),
    upgrade('astral', owned('a'), { retention: 'astral', activation: 'after-ultra-ascension' }),
    upgrade('permanent', active('astral'), { retention: 'permanent' }), upgrade('retained-target')],
  milestones: [{ id: 'item', title: 'Item received', description: '', reveal: owned('a'), sources: [] }],
  connections: [{ from: 'a', to: 'story' }],
  grants: [{ when: active('astral'), ids: ['retained-target'] }], ultraAscension: always,
  verification: { coverage: false, purchaseRules: false, revealRules: false, resetRules: false, assets: false, evidence: [] },
}

describe('dependency planning', () => {
  it('fills an AND chain without mutating original progress', () => {
    const profile = emptyProfile('fixture')
    const result = planPurchase(catalog, profile, 'child', { 'or/purchase': 1 })
    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') expect(result.added).toEqual(['b', 'or', 'child'])
    expect(profile.purchases).toEqual({})
  })
  it('requires a choice for an unsatisfied OR even when one option is simpler', () => {
    expect(planPurchase(catalog, emptyProfile('fixture'), 'or')).toMatchObject({ kind: 'choice', key: 'or/purchase' })
  })
  it('reuses a valid alternate path and does not prompt unnecessarily', () => {
    const profile = emptyProfile('fixture'); profile.purchases.b = { epoch: 0, active: true }
    expect(planPurchase(catalog, profile, 'or').kind).toBe('ready')
  })
  it('does not invent external milestones or activation', () => {
    expect(planPurchase(catalog, emptyProfile('fixture'), 'story').kind).toBe('blocked')
    const result = planPurchase(catalog, emptyProfile('fixture'), 'astral')
    if (result.kind !== 'ready') throw new Error('fixture')
    expect(planPurchase(catalog, result.profile, 'permanent').kind).toBe('blocked')
  })
  it('does not auto-fill a hidden prerequisite whose external reveal gate is missing', () => {
    const gated: Catalog = { ...catalog, upgrades: [...catalog.upgrades,
      upgrade('hidden', always, { reveal: { kind: 'milestone', id: 'item' } }),
      upgrade('visible-target', { kind: 'active', id: 'hidden' })] }
    const profile = emptyProfile('fixture')
    expect(planPurchase(gated, profile, 'visible-target').kind).toBe('blocked')
    expect(profile.purchases).toEqual({})
  })
  it('cascades removal but preserves a valid OR alternate', () => {
    const result = planPurchase(catalog, emptyProfile('fixture'), 'child', { 'or/purchase': 0 })
    if (result.kind !== 'ready') throw new Error('fixture')
    expect(planRemoval(catalog, result.profile, 'a').removed).toEqual(['a', 'or', 'child'])
    result.profile.purchases.b = { epoch: 0, active: true }
    expect(planRemoval(catalog, result.profile, 'a').removed).toEqual(['a'])
  })
  it('does not treat arbitrary earlier repeat purchases as retained ownership', () => {
    const result = planPurchase(catalog, emptyProfile('fixture'), 'child', { 'or/purchase': 0 })
    if (result.kind !== 'ready') throw new Error('fixture')
    result.profile.epoch = 1
    expect(planRemoval(catalog, result.profile, 'a').removed).toEqual(['a', 'or', 'child'])
  })
})

describe('spoiler boundaries', () => {
  it('filters hidden search, milestones, connections and totals together', () => {
    const profile = emptyProfile('fixture')
    const visible = visibility(catalog, profile)
    expect(visible.ids.has('story')).toBe(false)
    expect(visible.milestones).toEqual([])
    expect(visible.connections).toEqual([])
    expect(visible.total).toBe(7)
    expect(searchVisible(catalog, profile, 'heros')).toEqual([])
    profile.milestones.item = true
    expect(searchVisible(catalog, profile, "HERO'S").map((item) => item.id)).toEqual(['story'])
  })
  it('retains visible locked upgrades and only reveals all with explicit spoilers', () => {
    const profile = emptyProfile('fixture')
    expect(visibility(catalog, profile).ids.has('child')).toBe(true)
    profile.showSpoilers = true
    expect(visibility(catalog, profile).total).toBe(8)
  })
})

describe('manual Astral activation', () => {
  it('records only the selected lock as earlier retained ownership without changing other history', () => {
    const profile = emptyProfile('fixture')
    profile.epoch = 3
    profile.purchases = { a: { epoch: 3, active: true }, astral: { epoch: 3, active: false }, 'retained-target': { epoch: 3, active: true }, unknown: { epoch: 1, active: false } }
    profile.milestones.item = true
    const before = structuredClone(profile)
    const result = planAstralActivation(catalog, profile, 'astral')
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') throw new Error('Expected a valid existing Astral activation')
    expect(result.profile).toEqual({ ...profile, purchases: { ...profile.purchases, astral: { epoch: 2, active: true } } })
    expect(profile).toEqual(before)
    expect(planRemoval(catalog, result.profile, 'a').profile.purchases.astral).toEqual({ epoch: 2, active: true })
    expect(planRemoval(catalog, result.profile, 'astral').profile.purchases.astral).toBeUndefined()
  })

  it('preserves an earlier purchase baseline and never awards an absent retention target', () => {
    const profile = emptyProfile('fixture')
    profile.epoch = 3
    profile.purchases.astral = { epoch: 1, active: false }
    const result = planAstralActivation(catalog, profile, 'astral')
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') throw new Error('Expected activation')
    expect(result.profile.purchases.astral).toEqual({ epoch: 1, active: true })
    expect(result.profile.purchases['retained-target']).toBeUndefined()
  })

  it('requires recorded Ultra Ascension history instead of creating activation at epoch zero', () => {
    const profile = emptyProfile('fixture')
    profile.purchases.astral = { epoch: 0, active: false }
    const before = structuredClone(profile)
    expect(planAstralActivation(catalog, profile, 'astral')).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('previous Ultra Ascension') })
    expect(profile).toEqual(before)
  })

  it.each(['unknown', 'a', 'absent', 'astral'])('refuses an ineligible %s target without changing progress', (id) => {
    const profile = emptyProfile('fixture')
    profile.epoch = 1
    profile.purchases = { a: { epoch: 1, active: false }, astral: { epoch: 0, active: true }, unknown: { epoch: 0, active: false } }
    const before = structuredClone(profile)
    expect(planAstralActivation(catalog, profile, id).kind).toBe('blocked')
    expect(profile).toEqual(before)
  })

  it('refuses an unowned Astral rather than awarding it', () => {
    const profile = { ...emptyProfile('fixture'), epoch: 1 }
    expect(planAstralActivation(catalog, profile, 'astral').kind).toBe('blocked')
    expect(profile.purchases).toEqual({})
  })
})

describe('Ultra Ascension', () => {
  it('refuses the maximum accepted epoch before activating, clearing or changing progress', () => {
    const profile = { ...emptyProfile('fixture'), epoch: MAX_PROFILE_EPOCH, purchases: {
      a: { epoch: MAX_PROFILE_EPOCH, active: true }, astral: { epoch: MAX_PROFILE_EPOCH, active: false }, 'retained-target': { epoch: 1, active: true }, unknown: { epoch: 0, active: false },
    }, milestones: { item: true as const } }
    const before = structuredClone(profile)
    const backup = exportProfileBackup(profile)
    expect(backup.ok).toBe(true)
    if (!backup.ok) throw new Error('The maximum safe epoch must remain supported')
    expect(parseProfileBackup(backup.text).ok).toBe(true)
    expect(planUltraAscension(catalog, profile)).toBeNull()
    expect(profile).toEqual(before)
    expect(exportProfileBackup(profile)).toEqual(backup)
  })

  it('allows the final safe increment and produces a valid exportable profile', () => {
    const profile = { ...emptyProfile('fixture'), epoch: MAX_PROFILE_EPOCH - 1, purchases: {
      a: { epoch: MAX_PROFILE_EPOCH - 1, active: true }, astral: { epoch: MAX_PROFILE_EPOCH - 1, active: false }, 'retained-target': { epoch: 1, active: true }, unknown: { epoch: 0, active: false },
    }, milestones: { item: true as const } }
    const reset = planUltraAscension(catalog, profile)!
    expect(reset.profile.epoch).toBe(MAX_PROFILE_EPOCH)
    expect(reset.profile.purchases.astral.active).toBe(true)
    expect(reset.cleared).toContain('a')
    expect(reset.profile.purchases.unknown).toEqual(profile.purchases.unknown)
    expect(reset.profile.milestones).toEqual(profile.milestones)
    const backup = exportProfileBackup(reset.profile)
    expect(backup.ok).toBe(true)
    if (!backup.ok) throw new Error('Expected a valid final safe increment')
    expect(parseProfileBackup(backup.text)).toEqual({ ok: true, profile: reset.profile })
    expect(planUltraAscension(catalog, reset.profile)).toBeNull()
  })

  it('separates ownership, epoch and activation through repeated resets and conditional retention', () => {
    const result = planPurchase(catalog, emptyProfile('fixture'), 'astral')
    if (result.kind !== 'ready') throw new Error('fixture')
    expect(result.profile.purchases.astral.active).toBe(false)
    expect(conditionallyRetainedPurchases(catalog, result.profile).has('retained-target')).toBe(false)
    const first = planUltraAscension(catalog, result.profile)!
    expect(first.cleared).toEqual(['a'])
    expect(first.activated).toEqual(['astral'])
    expect(first.profile.purchases.astral).toEqual({ epoch: 0, active: true })
    expect(first.conditionallyRetained).toEqual([]) // Never retain an unpurchased target.
    const second = planUltraAscension(catalog, first.profile)!
    expect(second.profile.epoch).toBe(2)
    expect(second.activated).toEqual([])
    expect(planRemoval(catalog, second.profile, 'a').profile.purchases.astral).toBeDefined()
    expect(second.profile.milestones).toEqual(first.profile.milestones)
  })
  it('preserves existing purchases through conditional retention after activating their source', () => {
    const result = planPurchase(catalog, emptyProfile('fixture'), 'astral')
    if (result.kind !== 'ready') throw new Error('fixture')
    result.profile.purchases['retained-target'] = { epoch: 0, active: true }
    const reset = planUltraAscension(catalog, result.profile)!
    expect(reset.conditionallyRetained).toEqual(['retained-target'])
    expect(reset.profile.purchases['retained-target']).toEqual({ epoch: 0, active: true })
  })
})
