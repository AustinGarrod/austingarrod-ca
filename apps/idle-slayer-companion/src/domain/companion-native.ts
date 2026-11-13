import nativeRules from '../../data/companion-native-rules.json'
import { decodeGameSave, type NativeSaveData } from './save-codec'
import { importDecodedGameSave } from './game-save-import'
import { COMPANION_SYSTEMS, type CompanionCatalog, type CompanionProgress, type CompanionRecord, type CompanionSystem } from './companion-types'
import { recordCompanionEntity, replaceAscensionProfile } from './companion-progress'
import { exportCompanionBackup } from './companion-storage'
import type { Catalog } from './types'

export type CompanionImportResult = { ok: true; progress: CompanionProgress; warnings: string[] } | { ok: false; error: string }
interface ImportRule { system: CompanionSystem; id: string; key?: string; counterKey?: string; kind: 'achievement' | 'permanentCraft' | 'temporaryCraft' | 'material' | 'quest' | 'upgrade' | 'enemy' | 'divinity' | 'building' | 'npc' }

/** Exact nonnegative integral native decimal/exponent values, without Number coercion. */
export function nativeUnsignedDecimal(input: string): string | null {
  if (input.length > 256) return null
  const match = input.trim().match(/^\+?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/)
  if (!match) return null
  const exponent = Number(match[3] ?? '0') - (match[2]?.length ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null
  let value = BigInt(match[1] + (match[2] ?? ''))
  if (exponent >= 0) value *= 10n ** BigInt(exponent)
  else { const divisor = 10n ** BigInt(-exponent); if (value % divisor !== 0n) return null; value /= divisor }
  const result = value.toString()
  return result.length <= 100 ? result : null
}
function integerFlag(data: NativeSaveData, key: string) {
  const value = data.IntData.get(key) ?? 0
  if (value !== 0 && value !== 1) throw new Error('Unsupported flag')
  return value === 1
}
function observation(rule: ImportRule, data: NativeSaveData, catalog: CompanionCatalog): CompanionRecord | null {
  const key = rule.key ?? rule.id
  if (rule.kind === 'temporaryCraft') return null
  if (rule.kind === 'achievement' || rule.kind === 'permanentCraft' || rule.kind === 'upgrade') {
    const result: CompanionRecord = { completed: integerFlag(data, key) }
    if (rule.counterKey) { const raw = data.StringData.get(rule.counterKey); const count = raw === undefined || raw === '' ? '0' : typeof raw === 'string' ? nativeUnsignedDecimal(raw) : null; if (count === null) throw new Error('Unsupported achievement counter'); result.count = count }
    return result
  }
  if (rule.kind === 'quest') {
    const value = data.IntData.get(key) ?? 0
    const entity = catalog.entities.find((item) => item.system === 'quest' && item.id === rule.id)
    if (!entity?.target) throw new Error('Missing quest target')
    return { count: value < 0 ? entity.target : String(value), claimed: value < 0, completed: value < 0 || BigInt(value) >= BigInt(entity.target) }
  }
  const raw = data.StringData.get(key)
  if (rule.kind === 'material') {
    if (raw === undefined || raw === '') return { discovered: false, count: '0' }
    if (raw === null) throw new Error('Unsupported null material state')
    const count = nativeUnsignedDecimal(raw)
    if (count === null) throw new Error('Unsupported material')
    return { discovered: true, count }
  }
  if (rule.kind === 'enemy') {
    const count = raw === undefined || raw === '' ? '0' : typeof raw === 'string' ? nativeUnsignedDecimal(raw) : null
    if (count === null) throw new Error('Unsupported enemy counter')
    return { discovered: BigInt(count) > 0n, count }
  }
  if (rule.kind === 'divinity') {
    if (raw === undefined || raw === '') return { selected: false }
    if (typeof raw !== 'string' || !/^[01]#[01]$/.test(raw)) throw new Error('Unsupported divinity selection')
    return { selected: raw.split('#')[1] === '1' }
  }
  if (rule.kind === 'building') {
    if (raw === undefined || raw === '') return { built: false }
    if (typeof raw !== 'string') throw new Error('Unsupported building state')
    const parts = raw.split('#')
    // Native writes int32 deposit amounts after the built flag. Although the
    // companion does not retain them, malformed amounts cannot authorize built.
    if (!['0', '1'].includes(parts[0]) || parts.length > 32 || parts.slice(1).some((part) => part !== part.trim() || !/^(0|[1-9]\d{0,9})$/.test(part) || BigInt(part) > 2_147_483_647n)) throw new Error('Unsupported building state')
    return { built: parts[0] === '1' }
  }
  // NPC dialogue encodings require their own reviewed decoder; never guess a stage.
  throw new Error('Unsupported native mapping')
}

/** Decode once; persist only allowlisted normalized observations, never native preferences. */
export function importCompanionGameSave(map: Catalog, catalog: CompanionCatalog, current: CompanionProgress, bytes: Uint8Array, observedAt = new Date().toISOString()): CompanionImportResult {
  const decoded = decodeGameSave(bytes)
  if (!decoded.ok) return decoded
  const version = decoded.data.StringData.get('Last Played Version')
  const imported = importDecodedGameSave(map, current.ascension, decoded.data)
  if (!imported.ok) return imported
  let progress = replaceAscensionProfile(structuredClone(current), imported.profile, map.milestones.map((item) => item.id))
  if (version === '7.2.0') return { ok: true, progress, warnings: ['Legacy 7.2.0 import replaces Ascension progress only. Other companion snapshots were kept.', ...imported.warnings] }
  if (version !== nativeRules.gameVersion || map.gameVersion !== nativeRules.gameVersion || map.steamBuild !== nativeRules.steamBuild || catalog.gameVersion !== nativeRules.gameVersion || catalog.steamBuild !== nativeRules.steamBuild) return { ok: false, error: 'This save version does not have a reviewed full Companion adapter. Progress was kept.' }
  try {
    const imports = nativeRules.imports as ImportRule[]
    const known = new Map(COMPANION_SYSTEMS.map((system) => [system, new Set(catalog.entities.filter((entity) => entity.system === system).map((entity) => entity.id))]))
    for (const system of COMPANION_SYSTEMS) {
      const previous = progress.modules[system]
      progress.modules[system] = { tracked: true, source: 'save', observedAt, records: Object.fromEntries(Object.entries(previous.records).filter(([id]) => !known.get(system)!.has(id))) }
    }
    for (const rule of imports) {
      if (!known.get(rule.system)?.has(rule.id)) throw new Error('Unreviewed identity')
      const patch = observation(rule, decoded.data, catalog)
      if (patch) progress = recordCompanionEntity(progress, rule.system, rule.id, patch, observedAt)
    }
    for (const system of COMPANION_SYSTEMS) progress.modules[system] = { ...progress.modules[system], source: 'save', observedAt }
    if (!exportCompanionBackup(progress).ok) throw new Error('Invalid normalized snapshot')
    return { ok: true, progress, warnings: [...imported.warnings, 'This records the selected save snapshot. It does not establish achievement dates or keep the game synchronized. Manual observations without reviewed save mappings become unrecorded; their currently visible changes appear in this preview.'] }
  } catch { return { ok: false, error: 'The save contains an unsupported state in a tracked system. No Companion progress was replaced.' } }
}
