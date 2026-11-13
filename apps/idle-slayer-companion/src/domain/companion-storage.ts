import { COMPANION_SYSTEMS, type CompanionProgress, type CompanionRecord } from './companion-types'
import { migrateCompanionProgress } from './companion-progress'
import { exportProfileBackup, MAX_PROFILE_BYTES, parseProfileBackup, type ProfileError } from './storage'

export const COMPANION_STORAGE_KEY = 'idle-slayer-companion.progress.v1'
export const MAX_COMPANION_BYTES = MAX_PROFILE_BYTES
// A retained exact legacy baseline can add escaped bytes; quota failures still preserve session progress.
export const MAX_COMPANION_STORAGE_BYTES = MAX_COMPANION_BYTES * 3 + 1024
export type CompanionResult<T> = { ok: true; value: T } | { ok: false; error: ProfileError }
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const booleanFields = ['completed', 'active', 'discovered', 'claimed', 'selected', 'built'] as const
const recordFields = [...booleanFields, 'count', 'stage']
const safeId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024 && !forbidden.has(value)
const decimal = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,1023})$/.test(value)
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) }
function keys(value: Record<string, unknown>, allowed: readonly string[], required = allowed): boolean {
  return Object.keys(value).every((key) => allowed.includes(key) && !forbidden.has(key)) && required.every((key) => Object.hasOwn(value, key))
}
function failure(message = 'The file does not match the supported Companion progress format. Progress was not replaced.'): CompanionResult<never> { return { ok: false, error: { kind: 'invalid-profile', message } } }
const tooLarge = (): CompanionResult<never> => ({ ok: false, error: { kind: 'too-large', message: 'Companion progress exceeds its supported size limit. Current progress remains available in this session.' } })
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength

function validate(value: unknown): CompanionResult<CompanionProgress> {
  if (!object(value) || !keys(value, ['format', 'version', 'catalogRevision', 'ascension', 'modules'])
    || value.format !== 'idle-slayer-companion-progress' || value.version !== 1 || !safeId(value.catalogRevision)
    || !object(value.modules) || !keys(value.modules, COMPANION_SYSTEMS)) return failure()
  const map = parseProfileBackup(JSON.stringify(value.ascension))
  if (!map.ok) return map
  const modules = {} as CompanionProgress['modules']
  for (const system of COMPANION_SYSTEMS) {
    const module = value.modules[system]
    if (!object(module) || !keys(module, ['tracked', 'records', 'observedAt', 'source'], ['tracked', 'records'])
      || typeof module.tracked !== 'boolean' || !object(module.records)
      || (module.source !== undefined && !['manual', 'save', 'legacy', 'reset'].includes(String(module.source)))
      || (module.observedAt !== undefined && (typeof module.observedAt !== 'string' || module.observedAt.length > 64 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(module.observedAt) || !Number.isFinite(Date.parse(module.observedAt))))) return failure()
    const records: Record<string, CompanionRecord> = {}
    for (const [id, record] of Object.entries(module.records)) {
      if (!safeId(id) || !object(record) || !keys(record, recordFields, [])
        || booleanFields.some((field) => record[field] !== undefined && typeof record[field] !== 'boolean')
        || (record.count !== undefined && !decimal(record.count)) || (record.stage !== undefined && !decimal(record.stage))) return failure()
      records[id] = { ...record }
      if ((system === 'craft' || system === 'village') && record.completed === true) {
        map.profile.milestones[id] = true
        records[id].completed = false
      }
    }
    modules[system] = {
      tracked: module.tracked, records,
      ...(module.observedAt === undefined ? {} : { observedAt: module.observedAt as string }),
      ...(module.source === undefined ? {} : { source: module.source as 'manual' | 'save' | 'legacy' | 'reset' }),
    }
  }
  return { ok: true, value: { format: 'idle-slayer-companion-progress', version: 1, catalogRevision: value.catalogRevision, ascension: map.profile, modules } }
}

export function exportCompanionBackup(progress: CompanionProgress): CompanionResult<string> {
  try {
    const checked = validate(progress)
    if (!checked.ok) return checked
    const text = JSON.stringify(checked.value, null, 2)
    return byteLength(text) > MAX_COMPANION_BYTES ? tooLarge() : { ok: true, value: text }
  } catch { return failure() }
}

export function parseCompanionBackup(text: string, revision?: string): CompanionResult<CompanionProgress> {
  if (byteLength(text) > MAX_COMPANION_BYTES) return tooLarge()
  let value: unknown
  try { value = JSON.parse(text) } catch { return { ok: false, error: { kind: 'invalid-json', message: 'The Companion backup is not valid JSON. Progress was not replaced.' } } }
  const checked = validate(value)
  if (!checked.ok) return checked
  const progress = revision === undefined ? checked.value : migrateCompanionProgress(checked.value, revision)
  const portable = exportCompanionBackup(progress)
  return portable.ok ? { ok: true, value: progress } : portable
}

/** Device-only migration metadata is excluded from portable progress backups. */
export interface CompanionStoredDocument { progress: CompanionProgress; legacyBaseline: string | null }
export function exportCompanionStored(document: CompanionStoredDocument): CompanionResult<string> {
  const portable = exportCompanionBackup(document.progress)
  if (!portable.ok) return portable
  // A malformed but readable old key can be explicitly recovered without overwriting it.
  // Keep its exact device-only baseline private and bounded; it is never a progress import.
  if (document.legacyBaseline !== null && (typeof document.legacyBaseline !== 'string' || byteLength(document.legacyBaseline) > MAX_PROFILE_BYTES)) return failure('The saved legacy map baseline exceeds the supported limit. Saved progress was not replaced.')
  const text = JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: document.legacyBaseline, progress: JSON.parse(portable.value) })
  return byteLength(text) > MAX_COMPANION_STORAGE_BYTES ? tooLarge() : { ok: true, value: text }
}
export function parseCompanionStored(text: string, revision: string): CompanionResult<CompanionStoredDocument> {
  if (byteLength(text) > MAX_COMPANION_STORAGE_BYTES) return tooLarge()
  try {
    const value: unknown = JSON.parse(text)
    if (!object(value) || !keys(value, ['format', 'version', 'legacyBaseline', 'progress']) || value.format !== 'idle-slayer-companion-storage' || value.version !== 1
      || (value.legacyBaseline !== null && (typeof value.legacyBaseline !== 'string' || byteLength(value.legacyBaseline) > MAX_PROFILE_BYTES))) return failure()
    const progress = parseCompanionBackup(JSON.stringify(value.progress), revision)
    if (!progress.ok) return progress
    return { ok: true, value: { progress: progress.value, legacyBaseline: value.legacyBaseline as string | null } }
  } catch { return { ok: false, error: { kind: 'invalid-json', message: 'Saved Companion progress is invalid. Review recovery before replacing it.' } } }
}

/** Legacy profile-v1 and ISAM callers keep their existing codec and map-only meaning. */
export function exportCompanionAscension(progress: CompanionProgress) { return exportProfileBackup(progress.ascension) }
