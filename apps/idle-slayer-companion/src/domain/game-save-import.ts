import { decodeGameSave, type NativeSaveData } from './save-codec'
import { conditionallyRetainedPurchases } from './rules'
import { exportProfileBackup } from './storage'
import type { Catalog, Profile } from './types'

const SUPPORTED_GAME_VERSIONS = new Set(['7.2.0', '7.3.4'])
const MAX_IMPORTED_EPOCH = 1_000_000
const forbiddenIds = new Set(['__proto__', 'constructor', 'prototype'])

export interface GameSaveImportPreview {
  ok: true
  profile: Profile
  /** Internal snapshot totals; UI counts must use the shared visibility result. */
  summary: {
    ownedUpgrades: number
    activeAstralLocks: number
    pendingAstralLocks: number
    recordedMilestones: number
    preservedUnknownPurchases: number
    preservedUnknownMilestones: number
    adjustedUnknownPurchaseEpochs: number
  }
  warnings: string[]
  sourceVersion: string
}

export type GameSaveImportResult = GameSaveImportPreview | { ok: false; error: string }

/** Accept exact integral invariant decimal/exponent forms, never grouping. */
function parseEpoch(value: string | null | undefined): number | null {
  if (value === undefined || value === '') return 0 // Native LoadPrefs default.
  if (value === null) return null
  const text = value.trim()
  if (text.length > 64) return null
  const match = text.match(/^\+?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/)
  if (!match) return null
  const fraction = match[2] ?? ''
  const exponent = Number(match[3] ?? '0') - fraction.length
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 64) return null
  let epoch = BigInt(match[1] + fraction)
  if (exponent >= 0) epoch *= 10n ** BigInt(exponent)
  else {
    const divisor = 10n ** BigInt(-exponent)
    if (epoch % divisor !== 0n) return null
    epoch /= divisor
  }
  return epoch <= BigInt(MAX_IMPORTED_EPOCH) ? Number(epoch) : null
}

const failure = (error: string): GameSaveImportResult => ({ ok: false, error })
const safeId = (id: string) => id.trim().length > 0 && id.length <= 1024 && !forbiddenIds.has(id)

/**
 * Build a replacement preview from user-selected bytes without side effects.
 * Read only verified catalog IDs and two global native StringData fields.
 * Earlier epochs below are a retained-ownership baseline, not recovered dates.
 */
export function importGameSave(catalog: Catalog, currentProfile: Profile, bytes: Uint8Array): GameSaveImportResult {
  const decoded = decodeGameSave(bytes)
  return decoded.ok ? importDecodedGameSave(catalog, currentProfile, decoded.data) : decoded
}

/** Pure reviewed adapter; the Companion decoder shares one bounded transport read. */
export function importDecodedGameSave(catalog: Catalog, currentProfile: Profile, data: NativeSaveData): GameSaveImportResult {
  if (!SUPPORTED_GAME_VERSIONS.has(catalog.gameVersion)) return failure('This catalog does not support the reviewed Steam save version. Map progress was not changed.')
  const catalogIds = [...catalog.upgrades.map((node) => node.id), ...catalog.milestones.map((item) => item.id)]
  if (catalogIds.some((id) => !safeId(id)) || new Set(catalogIds).size !== catalogIds.length) return failure('The catalog has unsafe or duplicate native identities. Map progress was not changed.')
  if (!exportProfileBackup(currentProfile).ok) return failure('Current map progress is not valid for a safe replacement. Map progress was not changed.')
  const sourceVersion = data.StringData.get('Last Played Version')
  if (typeof sourceVersion !== 'string' || !SUPPORTED_GAME_VERSIONS.has(sourceVersion)) return failure('Only reviewed Idle Slayer 7.2.0 or 7.3.4 Steam saves can be imported. Map progress was not changed.')
  const epoch = parseEpoch(data.StringData.get('Ultra Ascensions'))
  if (epoch === null) return failure('The save has an unsupported Ultra Ascension counter. Map progress was not changed.')

  const knownUpgrades = new Set(catalog.upgrades.map((node) => node.id))
  const knownMilestones = new Set(catalog.milestones.map((item) => item.id))
  const profile: Profile = {
    version: 1, catalogRevision: catalog.revision, epoch, purchases: {}, milestones: {},
    showSpoilers: currentProfile.showSpoilers,
  }
  const summary: GameSaveImportPreview['summary'] = {
    ownedUpgrades: 0, activeAstralLocks: 0, pendingAstralLocks: 0, recordedMilestones: 0,
    preservedUnknownPurchases: 0, preservedUnknownMilestones: 0, adjustedUnknownPurchaseEpochs: 0,
  }
  for (const [id, purchase] of Object.entries(currentProfile.purchases)) {
    if (knownUpgrades.has(id)) continue
    profile.purchases[id] = { epoch: Math.min(purchase.epoch, epoch), active: purchase.active }
    summary.preservedUnknownPurchases++
    if (purchase.epoch > epoch) summary.adjustedUnknownPurchaseEpochs++
  }
  for (const id of Object.keys(currentProfile.milestones)) {
    if (knownMilestones.has(id)) continue
    profile.milestones[id] = true
    summary.preservedUnknownMilestones++
  }
  for (const node of catalog.upgrades) {
    const state = data.IntData.get(node.id) ?? 0
    if (state < 0 || state > 2) return failure('The save has an unsupported Ascension ownership state. Map progress was not changed.')
    if (state === 0) continue
    const locked = node.activation === 'after-ultra-ascension'
    const active = !locked || state === 2
    if (locked && active && epoch === 0) return failure('The save records Astral activation without an Ultra Ascension. Map progress was not changed.')
    profile.purchases[node.id] = { epoch, active }
    summary.ownedUpgrades++
    if (locked) {
      if (active) summary.activeAstralLocks++
      else summary.pendingAstralLocks++
    }
  }
  for (const item of catalog.milestones) {
    const state = data.IntData.get(item.id) ?? 0
    if (state !== 0 && state !== 1) return failure('The save has an unsupported milestone ownership state. Map progress was not changed.')
    if (state === 1) { profile.milestones[item.id] = true; summary.recordedMilestones++ }
  }
  if (epoch > 0) {
    const retained = conditionallyRetainedPurchases(catalog, profile)
    for (const node of catalog.upgrades) {
      const purchase = profile.purchases[node.id]
      if (purchase?.active && (node.retention !== 'repeat' || retained.has(node.id))) purchase.epoch = epoch - 1
    }
  }
  const validation = exportProfileBackup(profile)
  if (!validation.ok) return failure('The imported map profile exceeds the supported profile limits. Map progress was not changed.')
  const warnings = [epoch > 0
    ? 'The save records current ownership, not purchase history. Active permanent and retained upgrades use an earlier-ascension baseline for map edits.'
    : 'The save records current ownership, not purchase history.']
  if (summary.adjustedUnknownPurchaseEpochs) warnings.push('Existing unknown map purchases were preserved, with their epochs adjusted to fit the imported Ultra Ascension count.')
  return { ok: true, profile, summary, warnings, sourceVersion }
}
