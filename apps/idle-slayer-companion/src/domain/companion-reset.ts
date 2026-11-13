import { getCompanionRecord } from './companion-progress'
import type { CompanionCatalog, CompanionProgress, CompanionRecord, CompanionSystem } from './companion-types'
import { MAX_PROFILE_EPOCH, type Catalog } from './types'
import { planUltraAscension } from './rules'
import { exportCompanionBackup } from './companion-storage'
import nativeReset from '../data/companion-reset-rules.json'

/** Reviewed AscensionSkills bindings in Steam 7.3.4; native IDs, never localized titles. */
export const DIVINITY_ACTIVITY_UPGRADES = nativeReset.divinityActivityUpgrades

/** Stored selection survives resets; PlayerInventory.CalculateValues checks this separate global effect gate. */
export function deriveCompanionDivinityActive(progress: CompanionProgress, mapCatalog: Catalog, id: string): boolean | undefined {
  const selected = getCompanionRecord(progress, 'divinity', id).selected
  if (selected === false) return false
  const states = DIVINITY_ACTIVITY_UPGRADES.map((upgradeId) => mapCatalog.upgrades.some((node) => node.id === upgradeId) ? progress.ascension.purchases[upgradeId]?.active === true : undefined)
  const gate = states.includes(true) ? true : states.includes(undefined) ? undefined : false
  return gate === false ? false : gate === undefined || selected === undefined ? undefined : selected
}

export type CompanionResetResult = { ok: true; progress: CompanionProgress; warnings: string[] } | { ok: false; error: string }

/** Current native reset, projected only onto observed systems. No ordinary edit calls this function. */
export function planCompanionUltraAscension(mapCatalog: Catalog, companionCatalog: CompanionCatalog, original: CompanionProgress): CompanionResetResult {
  const failure = (error: string): CompanionResetResult => ({ ok: false, error })
  if (mapCatalog.gameVersion !== nativeReset.gameVersion || mapCatalog.steamBuild !== nativeReset.steamBuild
    || companionCatalog.gameVersion !== nativeReset.gameVersion || companionCatalog.steamBuild !== nativeReset.steamBuild || !mapCatalog.verification.resetRules) return failure('This catalog does not have a reviewed Companion Ultra Ascension adapter. Progress was kept.')
  if (!exportCompanionBackup(original).ok) return failure('Current Companion progress cannot be safely reset. Progress was kept.')
  if (original.ascension.epoch >= MAX_PROFILE_EPOCH) return failure('This profile has reached the supported Ultra Ascension count limit. Export a backup before making further changes.')
  const tree = planUltraAscension(mapCatalog, original.ascension)
  if (!tree) return failure('The recorded Ascension progress does not meet the Ultra Ascension requirements. Progress was kept.')
  const known = new Map<CompanionSystem, Set<string>>()
  for (const system of ['achievement', 'craft', 'material', 'quest', 'village', 'enemy', 'divinity'] as const) known.set(system, new Set(companionCatalog.entities.filter((item) => item.system === system).map((item) => item.id)))
  // Quest packs are native shop Upgrade rows, distinct from counter-bearing
  // Quest rows. Both have reviewed reset policies in the same receipt.
  if ([...known.get('quest')!].some((id) => !nativeReset.quests.some((rule) => rule.id === id) && !nativeReset.upgrades.some((rule) => rule.id === id))) return failure('A quest reset policy needs a new native review. Progress was kept.')
  const progress = structuredClone(original)
  progress.ascension = tree.profile
  const warnings = new Set<string>(), changed = new Set<CompanionSystem>()
  function record(system: CompanionSystem, id: string, patch: CompanionRecord) {
    if (!progress.modules[system].tracked || !known.get(system)!.has(id)) return
    progress.modules[system].records[id] = { ...progress.modules[system].records[id], ...patch }
    changed.add(system)
  }
  function forget(system: CompanionSystem, id: string, fields: (keyof CompanionRecord)[]) {
    if (!progress.modules[system].tracked || !known.get(system)!.has(id)) return
    const current = progress.modules[system].records[id]
    if (!current) return
    for (const field of fields) delete current[field]
    changed.add(system)
  }
  function receipt(id: string, owned: boolean) {
    if (known.get('quest')!.has(id) && nativeReset.upgrades.some((rule) => rule.id === id)) { record('quest', id, { completed: owned }); return }
    if (owned) progress.ascension.milestones[id] = true
    else delete progress.ascension.milestones[id]
    record('village', id, { completed: false })
  }
  // Native shop upgrades are cleared before quests. Craftable-item receipts are retained.
  for (const rule of nativeReset.upgrades) if (!rule.retain && (known.get('village')!.has(rule.id) || known.get('quest')!.has(rule.id))) receipt(rule.id, false)
  let claimedByReset = false
  if (progress.modules.quest.tracked) {
    for (const rule of nativeReset.quests) {
      if (!known.get('quest')!.has(rule.id) || rule.retain === 'always') continue
      if (rule.retain === 'reward') {
        const reward = 'rewardId' in rule && rule.rewardId ? getCompanionRecord(progress, 'village', rule.rewardId).completed : undefined
        if (reward === true) continue
        if (reward === undefined) {
          forget('quest', rule.id, ['count', 'completed', 'claimed'])
          warnings.add('Some quest outcomes depend on unrecorded reward ownership. Their progress needs a fresh save or manual observation.')
          continue
        }
      }
      record('quest', rule.id, { count: '0', completed: false, claimed: false })
    }
  }
  // These native retained Astrals buy their specific reward upgrades and claim their quests after clearing.
  for (const rule of nativeReset.questClaims) {
    if (progress.ascension.purchases[rule.upgradeId]?.active !== true) continue
    for (const quest of rule.quests) {
      if (known.get('village')!.has(quest.rewardId) || known.get('quest')!.has(quest.rewardId)) receipt(quest.rewardId, true)
      record('quest', quest.id, { count: quest.target, completed: true, claimed: true })
      claimedByReset = true
    }
  }
  // The native reward is calculated from ownership before clearing/activation, with no RNG doubling or quest progress.
  const reward = nativeReset.materialReward
  const quantity = reward.upgrades.reduce((total, source) => total + (original.ascension.purchases[source.id] ? BigInt(source.quantity) : 0n), 0n)
  let materialAdded: boolean | undefined = false, overflow = false
  if (quantity > 0n && progress.modules.material.tracked && known.get('material')!.has(reward.id)) {
    const current = getCompanionRecord(original, 'material', reward.id)
    record('material', reward.id, { discovered: true })
    if (current.count === undefined) {
      forget('material', reward.id, ['count'])
      materialAdded = undefined
      warnings.add('A material reward has an unrecorded starting quantity. Its resulting quantity needs a fresh save or manual observation.')
    } else {
      const count = BigInt(current.count), maximum = BigInt(reward.maximum)
      const next = count > maximum ? count : count + quantity > maximum ? maximum : count + quantity
      record('material', reward.id, { count: next.toString() })
      materialAdded = next > count
      overflow = count <= maximum && count + quantity > maximum
    }
  } else if (quantity > 0n) materialAdded = undefined
  let awarded = false
  function award(id: string) {
    if (!progress.modules.achievement.tracked || !known.get('achievement')!.has(id)) return
    const before = getCompanionRecord(progress, 'achievement', id).completed
    record('achievement', id, { completed: true })
    if (before !== true) awarded = true
  }
  if (overflow) award(reward.overflowAchievementId)
  if (progress.modules.achievement.tracked) {
    for (const rule of nativeReset.achievements) {
      if (rule.type === 27) {
        record('achievement', rule.id, { count: String(progress.ascension.epoch) })
        if (BigInt(progress.ascension.epoch) >= BigInt(rule.target)) award(rule.id)
      } else if (rule.type === 10 && getCompanionRecord(progress, 'achievement', rule.id).count !== undefined) record('achievement', rule.id, { count: '0' })
      else if (rule.type === 3 || (rule.type === 16 && claimedByReset)) {
        const incomplete = getCompanionRecord(progress, 'achievement', rule.id).completed === false
        forget('achievement', rule.id, incomplete ? ['count', 'completed'] : ['count'])
        if (incomplete) warnings.add('Some achievement results depend on game state this companion does not record. Refresh those observations after the reset.')
      }
    }
    function observedTotal(system: 'quest' | 'material', ids: string[], field: 'claimed' | 'discovered'): bigint | undefined {
      if (!progress.modules[system].tracked) return undefined
      const values = ids.map((id) => getCompanionRecord(progress, system, id)[field])
      return values.some((value) => value === undefined) ? undefined : BigInt(values.filter(Boolean).length)
    }
    const questTotal = observedTotal('quest', nativeReset.quests.filter((rule) => rule.countsForAchievements).map((rule) => rule.id), 'claimed')
    const materialTotal = observedTotal('material', nativeReset.materialIds, 'discovered')
    for (const rule of nativeReset.achievements.filter((item) => item.type === 17 || item.type === 25)) {
      const value = rule.type === 17 ? questTotal : materialTotal
      const event = rule.type === 17 ? claimedByReset : materialAdded
      if (value !== undefined) {
        record('achievement', rule.id, { count: value.toString() })
        if (event === true && value >= BigInt(rule.target)) award(rule.id)
      } else {
        const incomplete = getCompanionRecord(progress, 'achievement', rule.id).completed === false
        forget('achievement', rule.id, event !== false && incomplete ? ['count', 'completed'] : ['count'])
        if (event !== false && incomplete) warnings.add('Some achievement results depend on unrecorded quest or material observations. Refresh those observations after the reset.')
      }
    }
    // Achievement.Unlock checks the full native achievement count, including newly unlocked meta achievements.
    if (awarded) {
      const values = nativeReset.achievementIds.map((id) => getCompanionRecord(progress, 'achievement', id).completed)
      const complete = !values.includes(undefined)
      if (complete) {
        let total = BigInt(values.filter(Boolean).length)
        for (let pass = 0; pass <= nativeReset.achievements.length; pass++) {
          const before = total
          for (const rule of nativeReset.achievements.filter((item) => item.type === 14)) {
            record('achievement', rule.id, { count: total.toString() })
            if (total >= BigInt(rule.target) && getCompanionRecord(progress, 'achievement', rule.id).completed !== true) { award(rule.id); total++ }
          }
          if (total === before) break
        }
      } else {
        for (const rule of nativeReset.achievements.filter((item) => item.type === 14)) {
          const incomplete = getCompanionRecord(progress, 'achievement', rule.id).completed === false
          forget('achievement', rule.id, incomplete ? ['count', 'completed'] : ['count'])
        }
        warnings.add('Achievement totals are incomplete. Dependent achievement observations need a fresh save or manual observation.')
      }
    }
  }
  // Activity is derived for every map edit, not stored as a second selection fact.
  if (progress.modules.divinity.tracked) for (const id of known.get('divinity')!) forget('divinity', id, ['active'])
  for (const system of changed) {
    progress.modules[system].source = 'reset'
    delete progress.modules[system].observedAt
  }
  if (!exportCompanionBackup(progress).ok) return failure('The reset exceeds the supported Companion progress format. Progress was kept.')
  return { ok: true, progress, warnings: [...warnings] }
}
