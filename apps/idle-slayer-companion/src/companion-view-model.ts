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
  return normalize(`${entity.title} ${entity.description} ${entity.category}`).includes(normalize(query.trim()))
}
