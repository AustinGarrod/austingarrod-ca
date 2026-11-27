import type { CompanionEntity, CompanionEntityRef, CompanionRecord } from './domain/companion-types'

export function companionRefKey(ref: CompanionEntityRef): string { return `${ref.system}:${ref.id}` }

export type RecordedStatus = 'unknown' | 'incomplete' | 'complete'

/** A missing observation remains unknown, even when the native target is zero. */
export function companionRecordedStatus(entity: CompanionEntity, record: CompanionRecord): RecordedStatus {
  let value: boolean | undefined
  switch (entity.system) {
    case 'achievement': case 'craft': value = record.completed; break
    case 'quest': value = entity.category === 'Quest packs' ? record.completed : record.claimed; break
    case 'village': value = record.built ?? record.completed; break
    case 'enemy': value = record.discovered; break
    case 'divinity': value = record.selected; break
    case 'material': return record.count === undefined ? 'unknown' : 'incomplete'
  }
  return value === undefined ? 'unknown' : value ? 'complete' : 'incomplete'
}

export function counterPercent(count?: string, target?: string): number | null {
  if (count === undefined || target === undefined || !/^\d+$/.test(count) || !/^\d+$/.test(target) || BigInt(target) === 0n) return null
  return Number(BigInt(count) * 100n / BigInt(target) > 100n ? 100n : BigInt(count) * 100n / BigInt(target))
}

export interface ShoppingLine { materialId: string; required: string; stock?: string; remaining?: string }
/** References and quantities only; the caller resolves names through the current visible catalog. */
export function companionShoppingList(visibleCrafts: readonly CompanionEntity[], plans: Readonly<Record<string, string>>, stock: Readonly<Record<string, string | undefined>>): ShoppingLine[] {
  const required = new Map<string, bigint>()
  for (const craft of visibleCrafts) {
    const quantity = plans[craft.id]
    if (!quantity || !/^\d+$/.test(quantity) || BigInt(quantity) === 0n) continue
    for (const ingredient of craft.recipe ?? []) {
      if (!/^\d+$/.test(ingredient.quantity)) continue
      required.set(ingredient.materialId, (required.get(ingredient.materialId) ?? 0n) + BigInt(ingredient.quantity) * BigInt(quantity))
    }
  }
  return [...required].map(([materialId, amount]) => {
    const known = stock[materialId]
    if (known === undefined || !/^\d+$/.test(known)) return { materialId, required: amount.toString() }
    const missing = amount > BigInt(known) ? amount - BigInt(known) : 0n
    return { materialId, required: amount.toString(), stock: known, remaining: missing.toString() }
  })
}

export function companionExactSum(values: readonly (string | undefined)[]): string | null {
  if (values.some((value) => value === undefined || !/^\d+$/.test(value))) return null
  return values.reduce<bigint>((sum, value) => sum + BigInt(value!), 0n).toString()
}

/** Currency charges are plan requirements only; no recorded balance is spent or inferred. */
export function companionPlannedCosts(visibleCrafts: readonly CompanionEntity[], plans: Readonly<Record<string, string>>): { unit: string; quantity: string }[] {
  const totals = new Map<string, bigint>()
  for (const craft of visibleCrafts) {
    const quantity = plans[craft.id]
    if (!quantity || !/^\d+$/.test(quantity) || BigInt(quantity) === 0n) continue
    const costs = [...(craft.cost && craft.costUnit ? [{ unit: craft.costUnit, quantity: craft.cost }] : []), ...(craft.otherCosts ?? [])]
    for (const cost of costs) if (/^\d+$/.test(cost.quantity) && BigInt(cost.quantity) > 0n) totals.set(cost.unit, (totals.get(cost.unit) ?? 0n) + BigInt(cost.quantity) * BigInt(quantity))
  }
  return [...totals].map(([unit, quantity]) => ({ unit, quantity: quantity.toString() }))
}

export function companionSearchMatches(entity: CompanionEntity, query: string): boolean {
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[’']/g, '')
  return normalize(`${entity.title} ${companionDisplayText(entity.description)} ${companionCategoryLabel(entity)}`).includes(normalize(query.trim()))
}

/**
 * Reviewed catalog text is hash-locked, so plain wording for its few internal phrases is applied
 * only when rendering. Every other catalog string is shown unchanged.
 */
const displayText: Readonly<Record<string, string>> = {
  'Native material. Recorded inventory is an observation; planning does not spend it.': 'Crafting material. Record how many you hold; plans never spend it.',
  'No native Bestiary description is defined for this enemy.': 'The game has no Bestiary description for this enemy.',
  'Excluded from native Bestiary': 'Not listed in the game’s Bestiary',
}
export function companionDisplayText(value: string): string { return Object.hasOwn(displayText, value) ? displayText[value] : value }

/** Section names for internal system keys, used wherever an entry's kind is shown to the player. */
export const companionSystemLabels: Readonly<Record<CompanionEntityRef['system'], string>> = {
  ascension: 'Ascension', achievement: 'Achievements', craft: 'Crafting', material: 'Materials', quest: 'Quests', village: 'Village', enemy: 'Bestiary', divinity: 'Divinities',
}

/** The words for an entry's two recorded states, complete first. */
export function companionStatusLabels(entity: Pick<CompanionEntity, 'system' | 'category'>): readonly [complete: string, incomplete: string] {
  if (entity.system === 'quest' && entity.category === 'Quest packs') return ['Owned', 'Not owned']
  return ({ achievement: ['Earned', 'Not earned'], craft: ['Owned', 'Not owned'], material: ['Recorded', 'Recorded'], quest: ['Claimed', 'Not claimed'], village: ['Complete', 'In progress'], enemy: ['Discovered', 'Not discovered'], divinity: ['Selected', 'Not selected'] } as const)[entity.system]
}
export function companionStatusText(entity: Pick<CompanionEntity, 'system' | 'category'>, status: RecordedStatus): string {
  if (status === 'unknown') return 'Not recorded'
  const [complete, incomplete] = companionStatusLabels(entity)
  return status === 'complete' ? complete : incomplete
}

/**
 * Some catalog categories are the game's internal identifiers ("PowerLevel", "CpsAmount"). Show them as
 * words; the stored category is unchanged, so filters and saved data keep using it.
 */
const categoryWords: Readonly<Record<string, string>> = { CpsAmount: 'Coins Per Second', Misc: 'Miscellaneous' }
export function companionCategoryLabel(entity: Pick<CompanionEntity, 'system' | 'category'>): string {
  const category = entity.category.trim()
  if (!category) return companionSystemLabels[entity.system]
  if (/\s/.test(category)) return companionDisplayText(category)
  if (Object.hasOwn(categoryWords, category)) return categoryWords[category]
  return category.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

/** One line under an entry's name in the dense list; the placeholder for a missing description is left out. */
export function companionRowSummary(entity: Pick<CompanionEntity, 'description'>): string {
  return entity.description === 'No native Bestiary description is defined for this enemy.' ? '' : companionDisplayText(entity.description)
}

export interface CompanionGroup {
  /** `system:category`, stable across filters, so a group's open state survives searching. */
  key: string
  system: CompanionEntity['system']
  label: string
  entities: CompanionEntity[]
  recorded: number
  complete: number
}
/** Entries grouped by system and category, in the order given (catalog order), with per-group counts. */
export function companionGroups(entities: readonly CompanionEntity[], statusOf: (entity: CompanionEntity) => RecordedStatus): CompanionGroup[] {
  const groups = new Map<string, CompanionGroup>()
  for (const entity of entities) {
    const key = `${entity.system}:${entity.category}`
    let group = groups.get(key)
    if (!group) groups.set(key, group = { key, system: entity.system, label: companionCategoryLabel(entity), entities: [], recorded: 0, complete: 0 })
    group.entities.push(entity)
    const status = statusOf(entity)
    if (status !== 'unknown') group.recorded++
    if (status === 'complete') group.complete++
  }
  return [...groups.values()]
}
/** "3 of 12 earned"; materials have no complete state, so they count what is recorded. */
export function companionGroupCount(group: Pick<CompanionGroup, 'system' | 'entities' | 'recorded' | 'complete'>): string {
  const total = group.entities.length.toLocaleString('en')
  if (group.system === 'material') return `${group.recorded.toLocaleString('en')} of ${total} recorded`
  const word = companionStatusLabels({ system: group.system, category: group.entities[0]?.category ?? '' })[0].toLocaleLowerCase('en')
  return `${group.complete.toLocaleString('en')} of ${total} ${word}`
}

/** "1 entry", "2 entries": counts in labels must agree with their noun. */
export function companionPlural(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en')} ${count === 1 ? singular : plural}`
}
