import type { Catalog } from './types'
import { satisfies } from './rules'
import { COMPANION_SYSTEMS, type CompanionCatalog, type CompanionEntity, type CompanionRequirement, type CompanionProgress } from './companion-types'
import { getCompanionRecord } from './companion-progress'

const systems = new Set<string>(COMPANION_SYSTEMS)
const safeId = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const quantity = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^(0|[1-9]\d{0,99})$/.test(value)
const label = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
function validProvenance(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every((source) => {
    if (!object(source) || !label(source.label) || (source.evidence !== undefined && typeof source.evidence !== 'string')) return false
    if (source.url === undefined) return true
    if (typeof source.url !== 'string') return false
    try { const url = new URL(source.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
  })
}
export const entityKey = (entity: { system: string; id: string }) => `${entity.system}:${entity.id}`
export function companionCatalogErrors(input: unknown): string[] {
  if (!object(input)) return ['Companion catalog is missing.']
  const value = input as unknown as CompanionCatalog
  if (value.schemaVersion !== 1 || !label(value.revision) || !label(value.gameVersion) || !label(value.steamBuild) || !Array.isArray(value.entities) || value.entities.length > 20_000) return ['Unsupported companion catalog.']
  const errors: string[] = [], identities = new Set<string>()
  const reference = (ref: unknown): ref is { system: string; id: string } => object(ref) && typeof ref.system === 'string' && (systems.has(ref.system) || ref.system === 'ascension') && safeId(ref.id)
  const mapRequirement = (rule: unknown, depth = 0): boolean => {
    if (!object(rule) || depth > 20) return false
    if (rule.kind === 'always' || rule.kind === 'ultra-ascended') return true
    if (rule.kind === 'active' || rule.kind === 'owned' || rule.kind === 'milestone') return safeId(rule.id)
    return (rule.kind === 'all' || rule.kind === 'any') && Array.isArray(rule.requirements) && rule.requirements.length <= 100 && (rule.kind !== 'any' || rule.requirements.length > 0) && rule.requirements.every((child) => mapRequirement(child, depth + 1))
  }
  const requirement = (rule: unknown, depth = 0): boolean => {
    if (!object(rule) || depth > 20) return false
    if (rule.kind === 'always' || rule.kind === 'unknown') return true
    if (rule.kind === 'all' || rule.kind === 'any') return Array.isArray(rule.requirements) && rule.requirements.length <= 100 && (rule.kind !== 'any' || rule.requirements.length > 0) && rule.requirements.every((child) => requirement(child, depth + 1))
    if (rule.kind === 'entity') {
      if (!reference(rule.ref) || typeof rule.field !== 'string' || !['completed', 'active', 'discovered', 'count', 'claimed', 'stage', 'selected', 'built'].includes(rule.field)) return false
      return ['count', 'stage'].includes(rule.field) ? quantity(rule.value) : rule.value === undefined || typeof rule.value === 'boolean'
    }
    if (rule.kind === 'ascension') return mapRequirement(rule.requirement)
    return false
  }
  for (const entity of value.entities) {
    if (!object(entity) || typeof entity.system !== 'string' || !systems.has(entity.system) || !safeId(entity.id) || identities.has(entityKey(entity))) { errors.push('Unsafe or repeated companion identity.'); continue }
    identities.add(entityKey(entity))
    if (typeof entity.title !== 'string' || !entity.title.trim() || typeof entity.description !== 'string' || typeof entity.category !== 'string') errors.push('Missing companion text.')
    if (!requirement(entity.reveal) || (entity.purchase && !requirement(entity.purchase))) errors.push('Unsupported companion requirement.')
    if (entity.icon !== undefined && (typeof entity.icon !== 'string' || !/^assets\/companion\/[a-zA-Z0-9._-]+\.png$/.test(entity.icon))) errors.push('Unsafe companion icon.')
    for (const number of [entity.target, entity.cost]) if (number !== undefined && !quantity(number)) errors.push('Invalid companion quantity.')
    if (entity.tiers !== undefined && (!Array.isArray(entity.tiers) || entity.tiers.length === 0 || entity.tiers.length > 10 || entity.tiers.some((tier, index, tiers) => !quantity(tier) || BigInt(tier) === 0n || (index > 0 && quantity(tiers[index - 1]) && BigInt(tier) <= BigInt(tiers[index - 1]))))) errors.push('Invalid mastery thresholds.')
    if (entity.masteryCountIds !== undefined && (!Array.isArray(entity.masteryCountIds) || entity.masteryCountIds.length === 0 || entity.masteryCountIds.length > 100 || !entity.masteryCountIds.every(safeId) || new Set(entity.masteryCountIds).size !== entity.masteryCountIds.length)) errors.push('Invalid mastery kill sources.')
    if (entity.recipe !== undefined && (!Array.isArray(entity.recipe) || entity.recipe.length > 100 || entity.recipe.some((item) => !object(item) || !safeId(item.materialId) || !quantity(item.quantity) || item.quantity === '0'))) errors.push('Invalid companion recipe.')
    if (entity.otherCosts !== undefined && (!Array.isArray(entity.otherCosts) || entity.otherCosts.length > 20 || entity.otherCosts.some((item) => !object(item) || !label(item.unit) || !quantity(item.quantity) || item.quantity === '0'))) errors.push('Invalid additional crafting costs.')
    if (entity.costUnit !== undefined && !label(entity.costUnit)) errors.push('Invalid companion cost unit.')
    for (const field of ['counterSupported', 'permanent', 'secret', 'steam'] as const) if (entity[field] !== undefined && typeof entity[field] !== 'boolean') errors.push('Invalid companion flag.')
    if (entity.familyId !== undefined && !safeId(entity.familyId)) errors.push('Invalid mastery family.')
    if (entity.platforms !== undefined && (!Array.isArray(entity.platforms) || entity.platforms.length > 20 || !entity.platforms.every(label))) errors.push('Invalid companion platforms.')
    for (const refs of [entity.related, entity.sources]) if (refs !== undefined && (!Array.isArray(refs) || refs.length > 100 || !refs.every(reference))) errors.push('Invalid companion link.')
    if (!validProvenance(entity.provenance)) errors.push('Missing or invalid companion provenance.')
  }
  const requireKnown = (ref: { system: string; id: string }) => ref.system === 'ascension' || identities.has(entityKey(ref))
  const knownRequirements = (rule: CompanionRequirement): boolean => rule.kind === 'entity' ? requireKnown(rule.ref) : rule.kind === 'all' || rule.kind === 'any' ? rule.requirements.every(knownRequirements) : true
  for (const entity of value.entities) {
    if (!object(entity) || !systems.has(entity.system) || !safeId(entity.id)) continue
    if ((requirement(entity.reveal) && !knownRequirements(entity.reveal)) || (requirement(entity.purchase) && !knownRequirements(entity.purchase!))) errors.push('Unresolved companion requirement.')
    for (const refs of [entity.related, entity.sources]) if (Array.isArray(refs) && refs.some((ref) => reference(ref) && !requireKnown(ref))) errors.push('Unresolved companion link.')
    if (Array.isArray(entity.recipe) && entity.recipe.some((item) => object(item) && safeId(item.materialId) && !identities.has(`material:${item.materialId}`))) errors.push('Unresolved crafting material.')
    if (Array.isArray(entity.masteryCountIds) && entity.masteryCountIds.some((id) => safeId(id) && !identities.has(`enemy:${id}`))) errors.push('Unresolved mastery kill source.')
  }
  if (!object(value.verification) || !Array.isArray(value.verification.evidence) || !value.verification.evidence.every((entry) => typeof entry === 'string') || ['coverage', 'rules', 'assets'].some((field) => typeof (value.verification as unknown as Record<string, unknown>)[field] !== 'boolean')) errors.push('Missing companion verification.')
  return [...new Set(errors)]
}

/** Three-state evaluation prevents an unobserved counter from becoming an assertion. */
export function companionRequirementState(rule: CompanionRequirement, progress: CompanionProgress, map: Catalog | null): boolean | undefined {
  if (rule.kind === 'always') return true
  if (rule.kind === 'unknown') return undefined
  if (rule.kind === 'ascension') return satisfies(rule.requirement, progress.ascension)
  if (rule.kind === 'all' || rule.kind === 'any') {
    const children = rule.requirements.map((item) => companionRequirementState(item, progress, map))
    if (rule.kind === 'all') return children.includes(false) ? false : children.includes(undefined) ? undefined : true
    return children.includes(true) ? true : children.includes(undefined) ? undefined : false
  }
  if (rule.kind !== 'entity') return undefined
  if (rule.ref.system === 'ascension') {
    const purchase = progress.ascension.purchases[rule.ref.id]
    const result = rule.field === 'active' ? purchase?.active === true : !!purchase || progress.ascension.milestones[rule.ref.id] === true
    return typeof rule.value === 'boolean' ? result === rule.value : result
  }
  const record = getCompanionRecord(progress, rule.ref.system, rule.ref.id)
  const actual = record?.[rule.field]
  if (actual === undefined) return undefined
  if (typeof rule.value === 'string') return typeof actual === 'string' && /^\d+$/.test(actual) && BigInt(actual) >= BigInt(rule.value)
  return actual === (rule.value ?? true)
}
export function visibleCompanionEntities(catalog: CompanionCatalog, progress: CompanionProgress, map: Catalog | null): CompanionEntity[] {
  return catalog.entities.filter((entity) => progress.ascension.showSpoilers || companionRequirementState(entity.reveal, progress, map) === true)
}
export function companionEntityState(entity: CompanionEntity, progress: CompanionProgress): 'untracked' | 'complete' | 'incomplete' {
  const record = getCompanionRecord(progress, entity.system, entity.id)
  if (!record || !Object.keys(record).length) return 'untracked'
  const mastery = entity.system === 'enemy' ? deriveBestiaryMastery(entity, progress) : undefined
  const done = entity.system === 'quest' ? record.claimed === true || record.completed === true ? true : record.count !== undefined && entity.target !== undefined ? BigInt(record.count) >= BigInt(entity.target) : record.completed ?? record.claimed
    : entity.system === 'enemy' ? (mastery === undefined ? undefined : mastery.tier === entity.tiers?.length)
    : entity.system === 'divinity' ? record.selected ?? record.active ?? record.completed
    : entity.system === 'material' ? record.discovered : entity.system === 'village' ? record.built ?? record.completed : record.completed
  return done === undefined ? 'untracked' : done ? 'complete' : 'incomplete'
}

/** Native base/evolution kill sources are explicit; missing observations never become zero. */
export function deriveBestiaryMastery(entity: CompanionEntity, progress: CompanionProgress): { tier: number; kills: string } | undefined {
  if (entity.system !== 'enemy' || !entity.masteryCountIds?.length || !entity.tiers?.length) return undefined
  const counts = [...new Set(entity.masteryCountIds)].map((id) => getCompanionRecord(progress, 'enemy', id).count)
  if (counts.some((count) => count === undefined)) return undefined
  const kills = counts.reduce<bigint>((total, count) => total + BigInt(count!), 0n)
  return { tier: entity.tiers.filter((threshold) => kills >= BigInt(threshold)).length, kills: kills.toString() }
}

export function craftingShoppingList(entities: CompanionEntity[], progress: CompanionProgress, plans: Readonly<Record<string, string>>) {
  const totals = new Map<string, bigint>()
  for (const entity of entities) {
    const amount = plans[entity.id]
    if (entity.system !== 'craft' || !amount || !/^[1-9]\d{0,99}$/.test(amount)) continue
    for (const ingredient of entity.recipe ?? []) totals.set(ingredient.materialId, (totals.get(ingredient.materialId) ?? 0n) + BigInt(ingredient.quantity) * BigInt(amount))
  }
  return [...totals].flatMap(([id, needed]) => {
    const material = entities.find((entity) => entity.system === 'material' && entity.id === id)
    if (!material) return []
    const amount = getCompanionRecord(progress, 'material', id)?.count
    const owned = amount === undefined ? undefined : BigInt(amount)
    return [{ material, needed: needed.toString(), owned: owned?.toString(), missing: owned === undefined ? undefined : (needed > owned ? needed - owned : 0n).toString() }]
  })
}
