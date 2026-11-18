import { describe, expect, it } from 'vitest'
import nativeReset from '../data/companion-reset-rules.json'
import { deriveCompanionDivinityActive, DIVINITY_ACTIVITY_UPGRADES, planCompanionUltraAscension } from './companion-reset'
import { emptyCompanionProgress, getCompanionRecord, recordCompanionEntity } from './companion-progress'
import type { CompanionCatalog, CompanionEntity, CompanionProgress, CompanionSystem } from './companion-types'
import type { Catalog, Upgrade } from './types'
import { createCompanionSession } from './companion-session'
import actualCatalog from '../../public/companion-catalog.json'

const always = { kind: 'always' as const }
function node(id: string, retention: Upgrade['retention'] = 'repeat', activation: Upgrade['activation'] = 'immediate'): Upgrade {
  return { id, title: 'Synthetic upgrade', description: '', cost: '1', icon: 'synthetic.png', position: { x: 0, y: 0 }, reveal: always, purchase: always, retention, activation, sources: [] }
}
const ids = [...new Set(['ultra', 'repeat', ...nativeReset.materialReward.upgrades.map((item) => item.id), ...nativeReset.questClaims.map((item) => item.upgradeId), ...DIVINITY_ACTIVITY_UPGRADES])]
const map: Catalog = {
  revision: 'fixture', gameVersion: '7.3.4', steamBuild: '25810322', startId: 'ultra',
  upgrades: ids.map((id) => node(id, nativeReset.questClaims.some((item) => item.upgradeId === id) || id === DIVINITY_ACTIVITY_UPGRADES[1] ? 'astral' : 'repeat', nativeReset.questClaims.some((item) => item.upgradeId === id) ? 'after-ultra-ascension' : 'immediate')),
  milestones: [], connections: [], grants: [], ultraAscension: always,
  verification: { coverage: true, purchaseRules: true, revealRules: true, resetRules: true, assets: true, evidence: [] },
}
function entity(system: CompanionSystem, id: string): CompanionEntity { return { system, id, title: 'Synthetic entry', description: '', category: 'Synthetic', reveal: always, provenance: [{ label: 'Synthetic fixture' }] } }
const companion: CompanionCatalog = { schemaVersion: 1, revision: 'fixture', gameVersion: '7.3.4', steamBuild: '25810322', entities: [
  ...nativeReset.quests.map((item) => ({ ...entity('quest', item.id), target: item.target })),
  ...nativeReset.achievementIds.map((id) => entity('achievement', id)),
  ...nativeReset.materialIds.map((id) => entity('material', id)),
  ...nativeReset.upgrades.map((item) => entity('village', item.id)),
  entity('divinity', 'divinity'), entity('craft', 'craft-item'), entity('enemy', 'enemy'),
], verification: { coverage: true, rules: true, assets: true, evidence: [] } }
function reset(progress: CompanionProgress) {
  const result = planCompanionUltraAscension(map, companion, progress)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  return result
}
function observe(progress: CompanionProgress, system: CompanionSystem, id: string, record: Parameters<typeof recordCompanionEntity>[3]) {
  return recordCompanionEntity(progress, system, id, record, '2026-10-16T12:00:00Z')
}

describe('native companion Ultra Ascension', () => {
  it('retains a complete sanitized coverage receipt and native source hashes', () => {
    expect(nativeReset.quests).toHaveLength(229)
    expect(nativeReset.quests.filter((item) => item.retain === 'always')).toHaveLength(15)
    expect(nativeReset.quests.filter((item) => item.retain === 'reward')).toHaveLength(8)
    expect(nativeReset.materialReward.upgrades).toHaveLength(11)
    expect(nativeReset.achievements.filter((item) => item.type === 27)).toHaveLength(7)
    expect(nativeReset.evidence.methods.every((item) => /^[a-f0-9]{64}$/.test(item.isilSha256))).toBe(true)
    expect(nativeReset.divinityActivityUpgrades).toEqual(['2cpr16u1ljpoixxyqwry', 'i5er9w7dwwr4hgua4wml'])
  })
  it('applies the tree reset while leaving every untracked module untracked', () => {
    const progress = emptyCompanionProgress('fixture')
    progress.ascension.purchases.repeat = { epoch: 0, active: true }
    const next = reset(progress).progress
    expect(next.ascension.epoch).toBe(1)
    expect(next.ascension.purchases.repeat).toBeUndefined()
    expect(next.modules).toEqual(progress.modules)
    expect(progress.ascension.purchases.repeat).toBeDefined()
  })
  it('refuses the maximum supported recorded epoch without losing the count-limit explanation', () => {
    const progress = emptyCompanionProgress('fixture')
    progress.ascension.epoch = Number.MAX_SAFE_INTEGER
    expect(planCompanionUltraAscension(map, companion, progress)).toEqual({ ok: false, error: 'This profile has reached the supported Ultra Ascension count limit. Export a backup before making further changes.' })
    expect(progress.ascension.epoch).toBe(Number.MAX_SAFE_INTEGER)
  })
  it('accepts the complete reviewed catalog and resets repeat quest packs independently of retained packs and quest counters', () => {
    const actual = actualCatalog as unknown as CompanionCatalog
    const packs = actual.entities.filter((item) => item.system === 'quest' && nativeReset.upgrades.some((rule) => rule.id === item.id))
    expect(packs).toHaveLength(31)
    const repeat = packs.find((item) => nativeReset.upgrades.some((rule) => rule.id === item.id && !rule.retain))!
    const retained = packs.find((item) => nativeReset.upgrades.some((rule) => rule.id === item.id && rule.retain))!
    let progress = observe(emptyCompanionProgress('fixture'), 'quest', repeat.id, { completed: true })
    progress = observe(progress, 'quest', retained.id, { completed: true })
    progress = observe(progress, 'quest', 'unknown-future-pack', { completed: true })
    const result = planCompanionUltraAscension(map, actual, progress)
    if (!result.ok) throw new Error(result.error)
    expect(getCompanionRecord(result.progress, 'quest', repeat.id)).toEqual({ completed: false })
    expect(getCompanionRecord(result.progress, 'quest', retained.id)).toEqual({ completed: true })
    expect(getCompanionRecord(result.progress, 'quest', 'unknown-future-pack')).toEqual({ completed: true })
    expect(result.progress.ascension.milestones[repeat.id]).toBeUndefined()
  })
  it('clears ordinary quests, keeps event quests and respects explicit permanent reward ownership', () => {
    const ordinary = nativeReset.quests.find((item) => item.retain === 'never')!
    const retained = nativeReset.quests.find((item) => item.retain === 'reward')!
    const event = nativeReset.quests.find((item) => item.retain === 'always')!
    if (!('rewardId' in retained) || !retained.rewardId) throw new Error('Expected conditional native fixture')
    let progress = emptyCompanionProgress('fixture')
    for (const rule of [ordinary, retained, event]) progress = observe(progress, 'quest', rule.id, { count: '9', claimed: true, completed: true })
    progress = observe(progress, 'village', retained.rewardId, { completed: true })
    const next = reset(progress).progress
    expect(getCompanionRecord(next, 'quest', ordinary.id)).toEqual({ count: '0', claimed: false, completed: false })
    expect(getCompanionRecord(next, 'quest', retained.id)).toEqual({ count: '9', claimed: true, completed: true })
    expect(getCompanionRecord(next, 'quest', event.id)).toEqual({ count: '9', claimed: true, completed: true })
    expect(next.modules.quest.source).toBe('reset')
    expect(next.modules.quest.observedAt).toBeUndefined()
  })
  it('uses unknown rather than guessing conditional quest retention when reward ownership is absent', () => {
    const rule = nativeReset.quests.find((item) => item.retain === 'reward')!
    const original = observe(emptyCompanionProgress('fixture'), 'quest', rule.id, { count: '20', claimed: true, completed: true })
    const next = reset(original)
    expect(getCompanionRecord(next.progress, 'quest', rule.id)).toEqual({})
    expect(next.warnings.join(' ')).not.toContain(rule.id)
    expect(next.warnings).toContain('Some quest outcomes depend on unrecorded reward ownership. Their progress needs a fresh save or manual observation.')
  })
  it('clears conditional quests when the permanent reward was explicitly recorded absent', () => {
    const rule = nativeReset.quests.find((item) => item.retain === 'reward')!
    if (!('rewardId' in rule) || !rule.rewardId) throw new Error('Expected conditional fixture')
    let progress = observe(emptyCompanionProgress('fixture'), 'quest', rule.id, { count: '20', claimed: true })
    progress = observe(progress, 'village', rule.rewardId, { completed: false })
    const next = reset(progress).progress
    expect(getCompanionRecord(next, 'quest', rule.id)).toEqual({ count: '0', claimed: false, completed: false })
  })
  it('clears only native repeat shop milestones and preserves unrelated craft and unknown records', () => {
    const repeat = nativeReset.upgrades.find((item) => !item.retain)!
    const permanent = nativeReset.upgrades.find((item) => item.retain)!
    let progress = emptyCompanionProgress('fixture')
    for (const item of [repeat, permanent]) progress = observe(progress, 'village', item.id, { completed: true })
    progress = observe(progress, 'craft', 'craft-item', { completed: true })
    progress = observe(progress, 'enemy', 'enemy', { count: '52', stage: '3' })
    progress = observe(progress, 'quest', 'future-quest', { count: '123', claimed: true })
    progress.ascension.milestones['future-item'] = true
    const next = reset(progress).progress
    expect(getCompanionRecord(next, 'village', repeat.id).completed).toBe(false)
    expect(getCompanionRecord(next, 'village', permanent.id).completed).toBe(true)
    expect(getCompanionRecord(next, 'craft', 'craft-item').completed).toBe(true)
    expect(next.modules.enemy).toEqual(progress.modules.enemy)
    expect(next.modules.quest.records['future-quest']).toEqual({ count: '123', claimed: true })
    expect(next.ascension.milestones['future-item']).toBe(true)
  })
  it('activates pending retained Astrals before applying their deterministic quest claims', () => {
    let progress = emptyCompanionProgress('fixture')
    progress.modules.quest.tracked = true
    progress.modules.village.tracked = true
    for (const rule of nativeReset.questClaims) progress.ascension.purchases[rule.upgradeId] = { epoch: 0, active: false }
    const next = reset(progress).progress
    for (const rule of nativeReset.questClaims) for (const quest of rule.quests) {
      expect(next.ascension.purchases[rule.upgradeId].active).toBe(true)
      expect(next.modules.quest.records[quest.id]).toEqual({ count: quest.target, completed: true, claimed: true })
      if (companion.entities.some((item) => item.system === 'village' && item.id === quest.rewardId)) expect(getCompanionRecord(next, 'village', quest.rewardId).completed).toBe(true)
    }
    expect(progress.modules.quest.records).toEqual({})
  })
  it('awards material from owned key upgrades before the tree clears them, once, without touching other materials', () => {
    const reward = nativeReset.materialReward
    let progress = observe(emptyCompanionProgress('fixture'), 'material', reward.id, { count: '7', discovered: true })
    progress = observe(progress, 'material', 'other-material', { count: '40' })
    for (const source of reward.upgrades.slice(0, 2)) progress.ascension.purchases[source.id] = { epoch: 0, active: false }
    const quantity = reward.upgrades.slice(0, 2).reduce((sum, item) => sum + BigInt(item.quantity), 0n)
    const next = reset(progress).progress
    expect(next.modules.material.records[reward.id]).toEqual({ count: (7n + quantity).toString(), discovered: true })
    expect(next.modules.material.records['other-material']).toEqual({ count: '40' })
    for (const source of reward.upgrades.slice(0, 2)) expect(next.ascension.purchases[source.id]).toBeUndefined()
  })
  it('withholds an unknown reward starting quantity and does not silently turn it into zero', () => {
    const reward = nativeReset.materialReward
    const progress = observe(emptyCompanionProgress('fixture'), 'material', reward.id, { discovered: false })
    progress.ascension.purchases[reward.upgrades[0].id] = { epoch: 0, active: true }
    const next = reset(progress)
    expect(next.progress.modules.material.records[reward.id]).toEqual({ discovered: true })
    expect(next.warnings).toContain('A material reward has an unrecorded starting quantity. Its resulting quantity needs a fresh save or manual observation.')
  })
  it('caps native rewards, preserves over-cap observations and awards only the verified strict-overflow achievement', () => {
    const reward = nativeReset.materialReward
    for (const [current, expected, unlocked] of [['999999998', '999999999', false], ['999999999', '999999999', true], ['1000000000', '1000000000', false]] as const) {
      const oneKey = reward.upgrades.find((item) => item.quantity === '1')!
      let progress = observe(emptyCompanionProgress('fixture'), 'material', reward.id, { count: current })
      progress = observe(progress, 'achievement', reward.overflowAchievementId, { completed: false })
      progress.ascension.purchases[oneKey.id] = { epoch: 0, active: true }
      const next = reset(progress).progress
      expect(next.modules.material.records[reward.id].count).toBe(expected)
      expect(next.modules.achievement.records[reward.overflowAchievementId].completed).toBe(unlocked)
    }
  })
  it('records the verified UA achievement counters and unlocks only reached targets, preserving earned achievements', () => {
    let progress = emptyCompanionProgress('fixture')
    progress.ascension.epoch = 3
    progress.modules.achievement.tracked = true
    const target = nativeReset.achievements.find((item) => item.type === 27 && item.target === '4')!
    progress = observe(progress, 'achievement', target.id, { completed: false })
    progress = observe(progress, 'achievement', 'future-achievement', { completed: true, count: '90071992547409930' })
    const next = reset(progress).progress
    expect(next.modules.achievement.records[target.id]).toEqual({ completed: true, count: '4' })
    const later = nativeReset.achievements.find((item) => item.type === 27 && item.target === '5')!
    expect(next.modules.achievement.records[later.id].completed).toBeUndefined()
    expect(next.modules.achievement.records[later.id].count).toBe('4')
    expect(next.modules.achievement.records['future-achievement']).toEqual({ completed: true, count: '90071992547409930' })
  })
  it('keeps stored Divinity selection but derives activity through the native global gate after reset', () => {
    let progress = observe(emptyCompanionProgress('fixture'), 'divinity', 'divinity', { selected: true, active: true })
    progress.ascension.purchases[DIVINITY_ACTIVITY_UPGRADES[0]] = { epoch: 0, active: true }
    expect(deriveCompanionDivinityActive(progress, map, 'divinity')).toBe(true)
    const next = reset(progress).progress
    expect(next.modules.divinity.records.divinity).toEqual({ selected: true })
    expect(deriveCompanionDivinityActive(next, map, 'divinity')).toBe(false)
    progress.ascension.purchases[DIVINITY_ACTIVITY_UPGRADES[1]] = { epoch: 0, active: true }
    expect(deriveCompanionDivinityActive(reset(progress).progress, map, 'divinity')).toBe(true)
  })
  it('preserves one whole reset as a single Undo operation', async () => {
    const progress = observe(emptyCompanionProgress('fixture'), 'quest', nativeReset.quests.find((item) => item.retain === 'never')!.id, { claimed: true, count: '5' })
    const session = createCompanionSession({ revision: 'fixture', storage: () => ({ getItem: () => null, setItem: () => undefined }), locks: () => undefined })
    session.initialize(); session.applyCompanion(progress)
    const next = reset(progress).progress
    expect(session.applyCompanion(next, false, 'ultra_ascension')).toBe(true)
    expect(session.getState().history).toHaveLength(2)
    expect(session.undo()).toBe(true)
    expect(session.getState().progress).toBe(progress)
    expect(session.redo()).toBe(true)
    expect(session.getState().progress).toBe(next)
  })
  it('rejects unsupported versions, catalog gaps and failed eligibility without mutations', () => {
    const progress = emptyCompanionProgress('fixture')
    expect(planCompanionUltraAscension({ ...map, gameVersion: '7.2.0' }, companion, progress).ok).toBe(false)
    expect(planCompanionUltraAscension(map, { ...companion, steamBuild: 'future' }, progress).ok).toBe(false)
    expect(planCompanionUltraAscension(map, { ...companion, entities: [...companion.entities, entity('quest', 'unreviewed-quest')] }, progress).ok).toBe(false)
    expect(planCompanionUltraAscension({ ...map, ultraAscension: { kind: 'owned', id: 'missing' } }, companion, progress).ok).toBe(false)
    expect(progress).toEqual(emptyCompanionProgress('fixture'))
  })
  it('distinguishes unknown selection from a disabled gate and absent catalog bindings', () => {
    const progress = emptyCompanionProgress('fixture')
    expect(deriveCompanionDivinityActive(progress, map, 'divinity')).toBe(false)
    progress.ascension.purchases[DIVINITY_ACTIVITY_UPGRADES[0]] = { epoch: 0, active: true }
    expect(deriveCompanionDivinityActive(progress, map, 'divinity')).toBeUndefined()
    expect(deriveCompanionDivinityActive(progress, { ...map, upgrades: [] }, 'divinity')).toBeUndefined()
  })
})
