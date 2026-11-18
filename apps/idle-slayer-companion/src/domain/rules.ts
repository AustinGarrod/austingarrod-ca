import type { Catalog, Profile, Requirement, Upgrade } from './types'
import { MAX_PROFILE_EPOCH } from './types'

export function satisfies(requirement: Requirement, profile: Profile): boolean {
  switch (requirement.kind) {
    case 'always': return true
    case 'ultra-ascended': return profile.epoch > 0
    case 'all': return requirement.requirements.every((item) => satisfies(item, profile))
    case 'any': return requirement.requirements.some((item) => satisfies(item, profile))
    case 'owned': return Object.hasOwn(profile.purchases, requirement.id)
    case 'active': return profile.purchases[requirement.id]?.active === true
    case 'milestone': return profile.milestones[requirement.id] === true
  }
}

/** Native conditional retention includes only existing purchases with an active source. */
export function conditionallyRetainedPurchases(catalog: Catalog, profile: Profile): Set<string> {
  const result = new Set<string>()
  for (const rule of catalog.grants) {
    if (!satisfies(rule.when, profile)) continue
    for (const id of rule.ids) {
      if (Object.hasOwn(profile.purchases, id)) result.add(id)
    }
  }
  return result
}

export function visibility(catalog: Catalog, profile: Profile) {
  const upgrades = catalog.upgrades.filter((node) => profile.showSpoilers || satisfies(node.reveal, profile))
  const ids = new Set(upgrades.map((node) => node.id))
  const milestones = catalog.milestones.filter((item) => profile.showSpoilers || satisfies(item.reveal, profile))
  const connections = catalog.connections.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
  const owned = upgrades.filter((node) => satisfies({ kind: 'owned', id: node.id }, profile)).length
  return { upgrades, ids, milestones, connections, owned, total: upgrades.length }
}

export function normalizeTitle(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f'’‘ʼ]/g, '').toLocaleLowerCase('en').trim()
}

/** Titles keep priority over effect-only matches, preserving ordinary Enter selection. */
export function searchUpgrades(upgrades: Upgrade[], query: string): Upgrade[] {
  const term = normalizeTitle(query)
  const titles = upgrades.filter((node) => normalizeTitle(node.title).includes(term))
  const effects = upgrades.filter((node) => !normalizeTitle(node.title).includes(term) && normalizeTitle(node.description).includes(term))
  return [...titles, ...effects]
}

export function searchVisible(catalog: Catalog, profile: Profile, query: string): Upgrade[] {
  return searchUpgrades(visibility(catalog, profile).upgrades, query)
}

export type PurchasePlan =
  | { kind: 'ready'; profile: Profile; added: string[] }
  | { kind: 'choice'; key: string; options: Requirement[] }
  | { kind: 'blocked'; requirement: Requirement; reason: string }

class PlanningStop {
  result: Exclude<PurchasePlan, { kind: 'ready' }>
  constructor(result: Exclude<PurchasePlan, { kind: 'ready' }>) { this.result = result }
}

/** Produces a preview only. All OR decisions and external gates precede mutation. */
export function planPurchase(catalog: Catalog, original: Profile, id: string, choices: Record<string, number> = {}): PurchasePlan {
  const profile = structuredClone(original)
  const nodes = new Map(catalog.upgrades.map((node) => [node.id, node]))
  const visiting = new Set<string>()
  const added: string[] = []
  function requirement(item: Requirement, path: string) {
    if (satisfies(item, profile)) return
    switch (item.kind) {
      case 'always': return
      case 'ultra-ascended': throw new PlanningStop({ kind: 'blocked', requirement: item, reason: 'Record an Ultra Ascension before continuing.' })
      case 'all': item.requirements.forEach((entry, index) => requirement(entry, `${path}/${index}`)); return
      case 'any': {
        const choice = choices[path]
        if (!Number.isInteger(choice) || choice < 0 || choice >= item.requirements.length) {
          throw new PlanningStop({ kind: 'choice', key: path, options: item.requirements })
        }
        requirement(item.requirements[choice], `${path}/${choice}`)
        return
      }
      case 'owned': purchase(item.id); return
      case 'active': {
        purchase(item.id)
        if (!satisfies(item, profile)) throw new PlanningStop({ kind: 'blocked', requirement: item, reason: 'Record this upgrade’s activation explicitly before continuing.' })
        return
      }
      case 'milestone': throw new PlanningStop({ kind: 'blocked', requirement: item, reason: 'Record the required item received or purchased in Milestones before continuing.' })
    }
  }
  function purchase(target: string) {
    if (satisfies({ kind: 'owned', id: target }, profile)) return
    const node = nodes.get(target)
    if (!node || visiting.has(target)) throw new PlanningStop({ kind: 'blocked', requirement: { kind: 'owned', id: target }, reason: 'The catalog has an unresolved prerequisite.' })
    visiting.add(target)
    requirement(node.purchase, `${target}/purchase`)
    if (!satisfies(node.reveal, profile)) throw new PlanningStop({ kind: 'blocked', requirement: node.reveal, reason: 'This upgrade has an unresolved reveal gate. Record its required item or activation explicitly before continuing.' })
    profile.purchases[target] = { epoch: profile.epoch, active: node.activation === 'immediate' }
    added.push(target)
    visiting.delete(target)
  }
  try { purchase(id); return { kind: 'ready', profile, added } }
  catch (error) { if (error instanceof PlanningStop) return error.result; throw error }
}

export type AstralActivationPlan =
  | { kind: 'ready'; profile: Profile }
  | { kind: 'blocked'; reason: string }

/** Manual confirmation records this Astral's retained history, never its targets' history. */
export function planAstralActivation(catalog: Catalog, original: Profile, id: string): AstralActivationPlan {
  const node = catalog.upgrades.find((upgrade) => upgrade.id === id)
  const purchase = original.purchases[id]
  if (!node || !purchase || node.activation !== 'after-ultra-ascension' || node.retention === 'repeat' || purchase.active) {
    return { kind: 'blocked', reason: 'Only an owned Astral lock awaiting activation can be confirmed.' }
  }
  if (original.epoch === 0) {
    return { kind: 'blocked', reason: 'Record at least one previous Ultra Ascension in Progress before recording an already activated Astral.' }
  }
  const profile = structuredClone(original)
  profile.purchases[id] = { epoch: Math.min(purchase.epoch, original.epoch - 1), active: true }
  return { kind: 'ready', profile }
}

export function planRemoval(catalog: Catalog, original: Profile, id: string, milestone = false) {
  const profile = structuredClone(original)
  const retentionTargets = new Set(catalog.grants.flatMap((rule) => rule.ids))
  if (milestone) delete profile.milestones[id]
  else delete profile.purchases[id]
  let changed = true
  while (changed) {
    changed = false
    for (const node of catalog.upgrades) {
      const purchase = profile.purchases[node.id]
      if (!purchase) continue
      // Previously retained ownership is independent of this epoch’s repeat purchases.
      if (purchase.epoch < profile.epoch && (node.retention !== 'repeat' || retentionTargets.has(node.id))) continue
      if (!satisfies(node.purchase, profile)) {
        delete profile.purchases[node.id]
        changed = true
      }
    }
  }
  const removed = Object.keys(original.purchases).filter((key) => !Object.hasOwn(profile.purchases, key))
  return { profile, removed }
}

function activateAstralLocks(catalog: Catalog, profile: Profile): string[] {
  const activated: string[] = []
  for (const node of catalog.upgrades) {
    const purchase = profile.purchases[node.id]
    if (!purchase) continue
    if (node.retention !== 'repeat' && node.activation === 'after-ultra-ascension' && !purchase.active) {
      purchase.active = true
      activated.push(node.id)
    }
  }
  return activated
}

/** Describe existing targets retained after the reset's native activation phase. */
export function retainedPurchasesOnReset(catalog: Catalog, original: Profile): Set<string> {
  const profile = structuredClone(original)
  activateAstralLocks(catalog, profile)
  return conditionallyRetainedPurchases(catalog, profile)
}

export function planUltraAscension(catalog: Catalog, original: Profile) {
  if (original.epoch >= MAX_PROFILE_EPOCH || !satisfies(catalog.ultraAscension, original)) return null
  const profile = structuredClone(original)
  const cleared: string[] = []
  const activated = activateAstralLocks(catalog, profile)
  const retained = conditionallyRetainedPurchases(catalog, profile)
  for (const node of catalog.upgrades) {
    if (profile.purchases[node.id] && node.retention === 'repeat' && !retained.has(node.id)) {
      delete profile.purchases[node.id]; cleared.push(node.id)
    }
  }
  profile.epoch += 1
  return { profile, cleared, activated, conditionallyRetained: [...conditionallyRetainedPurchases(catalog, profile)] }
}
