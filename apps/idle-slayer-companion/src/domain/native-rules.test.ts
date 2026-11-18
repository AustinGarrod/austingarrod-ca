import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { conditionallyRetainedPurchases, planPurchase, planRemoval, planUltraAscension, retainedPurchasesOnReset, satisfies, searchVisible, visibility } from './rules'
import { emptyProfile, type Catalog, type Profile } from './types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const ids = {
  start: 'cjnr3qwntwqt4505351h',
  ultraAscension: '48hqttgm8yf9ouyaevkz',
  astralSlayer: 'p0j4c708uzl0gkldku4x',
  eternalRage: 'gmhcwrfgzcjt6j95g1lr',
  rageMode: '04u7349eha9vacsofx7l',
  rageParent: '9cd6a6o0l93hxbpxx4m5',
  soulReaperIII: 'i83imqpn2nbnxxjotkm3',
  upgradesOfTime: 'abkogu7ixwyterbuzjms',
  soulOfTheFallen: 'eqrbvffdm6zqxnrk7p6r',
  victorSoul: 'iwqw3uscrm8nbeibqtpz',
  guardianSoul: 'sxfhaw7yth9yevc5ti2w',
}

function node(id: string) {
  const upgrade = catalog.upgrades.find((item) => item.id === id)
  if (!upgrade) throw new Error(`Reviewed native ID ${id} is missing`)
  return upgrade
}

function own(profile: Profile, id: string, active = true) {
  profile.purchases[id] = { epoch: profile.epoch, active }
}

function resetFixture(includeRageMode: boolean) {
  const profile = emptyProfile(catalog.revision)
  profile.epoch = 1
  own(profile, ids.ultraAscension)
  own(profile, ids.astralSlayer)
  own(profile, ids.eternalRage, false)
  if (includeRageMode) own(profile, ids.rageMode)
  return profile
}

describe('reviewed native build 25551532 rules using the complete catalog', () => {
  it('keeps a visible ordinary node visible before its purchase prerequisites are met', () => {
    const profile = emptyProfile(catalog.revision)
    const upgrade = node(ids.ultraAscension)
    expect(satisfies(upgrade.reveal, profile)).toBe(true)
    expect(satisfies(upgrade.purchase, profile)).toBe(false)
    expect(visibility(catalog, profile).ids.has(upgrade.id)).toBe(true)
    expect(satisfies(node(ids.start).purchase, profile)).toBe(true)
  })

  it('preserves the native OR early return while applying its separate Ultra reveal gate', () => {
    const profile = emptyProfile(catalog.revision)
    own(profile, ids.rageParent)
    expect(satisfies(node(ids.rageMode).purchase, profile)).toBe(true)
    expect(satisfies(node(ids.rageMode).reveal, profile)).toBe(false)
    expect(planPurchase(catalog, profile, ids.rageMode).kind).toBe('blocked')
    expect(profile.purchases[ids.rageMode]).toBeUndefined()
  })

  it('blocks a hidden prerequisite with its own external gate without partially filling purchases', () => {
    const profile = emptyProfile(catalog.revision)
    profile.epoch = 1
    // All ordinary active dependencies are already recorded. The requested
    // branch's own Guardian gate is met, but Soul Reaper III's Victor gate is not.
    for (const upgrade of catalog.upgrades) own(profile, upgrade.id)
    delete profile.purchases[ids.upgradesOfTime]
    delete profile.purchases[ids.soulReaperIII]
    profile.milestones[ids.guardianSoul] = true
    const before = structuredClone(profile)
    expect(visibility(catalog, profile).ids.has(ids.upgradesOfTime)).toBe(true)
    expect(visibility(catalog, profile).ids.has(ids.soulReaperIII)).toBe(false)
    const plan = planPurchase(catalog, profile, ids.upgradesOfTime)
    expect(plan.kind).toBe('blocked')
    if (plan.kind === 'blocked') expect(plan.requirement).toEqual(node(ids.soulReaperIII).reveal)
    expect(profile).toEqual(before)
  })

  it('allows own ownership through the Astral reveal branch while still requiring the external item', () => {
    const profile = emptyProfile(catalog.revision)
    profile.epoch = 1
    own(profile, ids.soulReaperIII)
    profile.milestones[ids.victorSoul] = true
    expect(profile.purchases[ids.astralSlayer]).toBeUndefined()
    expect(visibility(catalog, profile).ids.has(ids.soulReaperIII)).toBe(true)
    delete profile.milestones[ids.victorSoul]
    expect(visibility(catalog, profile).ids.has(ids.soulReaperIII)).toBe(false)
    expect(searchVisible(catalog, profile, 'Soul Reaper III')).toEqual([])
  })

  it('keeps initial milestone names hidden and exposes an isolated native branch after explicit item entry', () => {
    const profile = emptyProfile(catalog.revision)
    expect(visibility(catalog, profile).milestones).toEqual([])
    expect(visibility(catalog, profile).ids.has(ids.soulOfTheFallen)).toBe(false)
    profile.showSpoilers = true
    expect(visibility(catalog, profile).milestones).toHaveLength(catalog.milestones.length)
    profile.milestones[ids.victorSoul] = true
    profile.showSpoilers = false
    expect(visibility(catalog, profile).ids.has(ids.soulOfTheFallen)).toBe(true)
    expect(planPurchase(catalog, profile, ids.soulOfTheFallen).kind).toBe('ready')
    // Its Astral descendants still use their native Astral Slayer ownership gate.
    expect(visibility(catalog, profile).ids.has(ids.soulReaperIII)).toBe(false)
  })

  it('activates a pending Eternal Rage before retaining an existing Rage Mode purchase', () => {
    const profile = resetFixture(true)
    const reset = planUltraAscension(catalog, profile)
    expect(reset).not.toBeNull()
    expect(reset!.activated).toContain(ids.eternalRage)
    expect(reset!.conditionallyRetained).toContain(ids.rageMode)
    expect(reset!.profile.purchases[ids.eternalRage]).toEqual({ epoch: 1, active: true })
    expect(reset!.profile.purchases[ids.rageMode]).toEqual({ epoch: 1, active: true })
    expect(reset!.profile.purchases[ids.ultraAscension]).toBeUndefined()
    expect(reset!.profile.epoch).toBe(2)
    expect(profile.purchases[ids.eternalRage].active).toBe(false)
  })

  it('does not award an absent Rage Mode purchase when Eternal Rage activates', () => {
    const reset = planUltraAscension(catalog, resetFixture(false))!
    expect(reset.profile.purchases[ids.eternalRage].active).toBe(true)
    expect(reset.profile.purchases[ids.rageMode]).toBeUndefined()
    expect(reset.conditionallyRetained).not.toContain(ids.rageMode)
  })

  it('clears the Legendary Rage Mode when its Astral retention source is absent', () => {
    const profile = resetFixture(true)
    delete profile.purchases[ids.eternalRage]
    const reset = planUltraAscension(catalog, profile)!
    expect(reset.cleared).toContain(ids.rageMode)
    expect(reset.profile.purchases[ids.rageMode]).toBeUndefined()
  })

  it.each([
    ['Astral Blessing', 'le7ke3q2jdjdmyhtzpgs', 'b68jn6acu00oiesllac3'],
    ['Eternal Rage', 'gmhcwrfgzcjt6j95g1lr', '04u7349eha9vacsofx7l'],
    ['Landlord', 'q1ohpayhstjat193jka8', 'vhxvp4q2i077pymnfhz0'],
    ['Multiverse', 'fxvp2gcw4zbve2cm35z4', 'utbtanttthwl6yjkv4yb'],
  ])('applies %s retention only to an existing native target', (_title, source, target) => {
    const profile = emptyProfile(catalog.revision)
    profile.epoch = 1
    own(profile, ids.ultraAscension)
    own(profile, source, node(source).activation === 'immediate')
    own(profile, target)
    const reset = planUltraAscension(catalog, profile)!
    expect(reset.profile.purchases[source].active).toBe(true)
    expect(reset.profile.purchases[target]).toEqual({ epoch: 1, active: true })
    expect(reset.conditionallyRetained).toContain(target)
    delete profile.purchases[target]
    const absentTarget = planUltraAscension(catalog, profile)!
    expect(absentTarget.profile.purchases[target]).toBeUndefined()
    expect(absentTarget.conditionallyRetained).not.toContain(target)
  })

  for (const retention of catalog.grants) {
    if (retention.when.kind !== 'active') throw new Error('Expected reviewed active-source retention')
    const source = node(retention.when.id)
    const target = retention.ids[0]
    it.each(['active', 'pending', 'absent-source', 'absent-target'] as const)(`predicts ${source.title} reset retention with %s ownership without changing progress`, (condition) => {
      const profile = emptyProfile(catalog.revision)
      profile.epoch = 1
      own(profile, ids.ultraAscension)
      if (condition !== 'absent-source') own(profile, source.id, condition !== 'pending')
      if (condition !== 'absent-target') own(profile, target)
      const before = structuredClone(profile)
      const currentRetention = conditionallyRetainedPurchases(catalog, profile)
      expect(currentRetention.has(target)).toBe(condition === 'active')
      expect([...currentRetention].every((id) => Object.hasOwn(profile.purchases, id))).toBe(true)
      const retained = retainedPurchasesOnReset(catalog, profile)
      const expected = condition === 'active' || condition === 'pending' && source.activation === 'after-ultra-ascension'
      expect(retained.has(target)).toBe(expected)
      const reset = planUltraAscension(catalog, profile)!
      expect(reset.conditionallyRetained.includes(target)).toBe(expected)
      expect(reset.profile.purchases[target]).toEqual(expected ? before.purchases[target] : undefined)
      expect(profile).toEqual(before)
    })
  }

  it('preserves historical retention on manual removal then reevaluates it at the next Ultra Ascension', () => {
    const reset = planUltraAscension(catalog, resetFixture(true))!
    const removal = planRemoval(catalog, reset.profile, ids.eternalRage)
    expect(removal.removed).toContain(ids.eternalRage)
    expect(removal.removed).not.toContain(ids.rageMode)
    expect(removal.profile.purchases[ids.rageMode]).toEqual({ epoch: 1, active: true })

    // Record the next ordinary run by selecting the first valid OR option when
    // the planner asks; this is a fresh UA purchase, not retained UA ownership.
    const choices: Record<string, number> = {}
    let purchase = planPurchase(catalog, removal.profile, ids.ultraAscension, choices)
    for (let count = 0; purchase.kind === 'choice' && count < catalog.upgrades.length; count += 1) {
      choices[purchase.key] = 0
      purchase = planPurchase(catalog, removal.profile, ids.ultraAscension, choices)
    }
    expect(purchase.kind).toBe('ready')
    if (purchase.kind !== 'ready') throw new Error('Native Ultra Ascension branch could not be recorded')
    const nextReset = planUltraAscension(catalog, purchase.profile)!
    expect(nextReset.profile.purchases[ids.rageMode]).toBeUndefined()
    expect(nextReset.cleared).toContain(ids.rageMode)
  })
})
