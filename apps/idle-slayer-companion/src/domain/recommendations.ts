import { satisfies, visibility } from './rules'
import type { Catalog, Profile, Upgrade } from './types'

export interface WikiPrioritySource {
  label: string
  url: string
  revision: number
  revisionTimestamp: string
  gameVersion: string
}

export interface WikiPriorityRow {
  id: string
  /** Ascending first-appearance order in the reviewed wiki guide. */
  priority: number
  tier: string
  url: string
  note: string
}

export interface WikiPriorityData {
  schemaVersion: number
  source: WikiPrioritySource
  rows: readonly WikiPriorityRow[]
}

interface RecommendationDetails {
  upgrade: Upgrade
  /** The original decimal string; no SP balance or affordability is inferred. */
  cost: string
  reason: string
  activationNote?: string
}

export type UpgradeRecommendation = RecommendationDetails & (
  | { basis: 'wiki'; priority: number; tier: string; source: WikiPrioritySource }
  | { basis: 'fallback'; priority?: never; tier?: never; source?: never }
)

export interface UpgradeRecommendations {
  status: 'wiki' | 'fallback' | 'all-owned' | 'blocked'
  suggestions: UpgradeRecommendation[]
  visibleUnownedCount: number
  readyCount: number
  wikiReadyCount: number
  unrankedReadyCount: number
  caveat: string
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareCost(left: Upgrade, right: Upgrade): number {
  const a = BigInt(left.cost), b = BigInt(right.cost)
  return a < b ? -1 : a > b ? 1 : compareIds(left.id, right.id)
}

/**
 * Suggest purchases that are actionable from the recorded profile right now.
 * This never fills prerequisites, chooses an OR path or changes progress.
 * Wiki stages are ordering guidance; only native reveal/purchase predicates
 * decide eligibility, including while the user browses with spoilers shown.
 */
export function recommendUpgrades(catalog: Catalog, profile: Profile, priorities: WikiPriorityData, { limit = 3 }: { limit?: number } = {}): UpgradeRecommendations {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Recommendation limit must be a positive integer')
  const visible = visibility(catalog, profile)
  const remaining = visible.upgrades.filter((upgrade) => !Object.hasOwn(profile.purchases, upgrade.id))
  const ready = remaining.filter((upgrade) => satisfies(upgrade.reveal, profile) && satisfies(upgrade.purchase, profile))
  const rows = new Map<string, WikiPriorityRow>()
  for (const row of priorities.rows) {
    if (!Number.isFinite(row.priority) || row.priority < 0) continue
    const previous = rows.get(row.id)
    if (!previous || row.priority < previous.priority) rows.set(row.id, row)
  }
  const ranked = ready.filter((upgrade) => rows.has(upgrade.id))
    .sort((left, right) => rows.get(left.id)!.priority - rows.get(right.id)!.priority || compareCost(left, right))
  const status = ranked.length ? 'wiki' : ready.length ? 'fallback' : remaining.length || !visible.upgrades.length ? 'blocked' : 'all-owned'
  const pool = ranked.length ? ranked : [...ready].sort(compareCost)
  const suggestions: UpgradeRecommendation[] = pool.slice(0, limit).map((upgrade, index) => {
    const details: RecommendationDetails = {
      upgrade,
      cost: upgrade.cost,
      reason: ranked.length
        ? `${index === 0 ? 'First' : 'Another'} remaining upgrade in the wiki order whose requirements are met.`
        : `Catalog fallback: ${index === 0 ? 'lowest native cost among visible upgrades' : 'another visible upgrade, ordered by native cost'} whose requirements are met.`,
      ...(upgrade.activation === 'after-ultra-ascension' ? { activationNote: 'Astral Lock: this purchase activates after your next Ultra Ascension.' } : {}),
    }
    const row = rows.get(upgrade.id)
    if (ranked.length && row) return { ...details, basis: 'wiki', priority: row.priority, tier: row.tier, source: { ...priorities.source, url: row.url || priorities.source.url } }
    return { ...details, basis: 'fallback' }
  })
  return {
    status,
    suggestions,
    visibleUnownedCount: remaining.length,
    readyCount: ready.length,
    wikiReadyCount: ranked.length,
    unrankedReadyCount: ready.length - ranked.length,
    caveat: `General guide order, not an optimal build. The wiki guide covers game ${priorities.source.gameVersion}; native gates and costs use game ${catalog.gameVersion}. SP balance, USP, Stone allocation, Divinity Points and playstyle are not modeled.`,
  }
}
