import type { Profile } from './types'
import { parseProfileBackup } from './storage'

export const CHECKPOINT_STORAGE_KEY = 'idle-slayer-ascension-map.checkpoints.v1'
export const MAX_CHECKPOINTS = 4
export const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024
export const MAX_CHECKPOINT_NAME = 64
export interface Checkpoint { id: string; name: string; capturedRevision: string; profile: Profile }
export interface CheckpointVault { kind: 'progress-checkpoints'; version: 1; entries: Checkpoint[] }
export const emptyCheckpoints = (): CheckpointVault => ({ kind: 'progress-checkpoints', version: 1, entries: [] })

export function checkpointName(value: string): string | null {
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ')
  return name.length > 0 && name.length <= MAX_CHECKPOINT_NAME && !/[\u0000-\u001f\u007f]/.test(value) ? name : null
}
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
const bytes = (value: string) => new TextEncoder().encode(value).byteLength

/** Portable facts only: exact fields deliberately reject dates, operation claims and native-save metadata. */
export function parseCheckpoints(text: string, revision: string): CheckpointVault | null {
  if (bytes(text) > MAX_CHECKPOINT_BYTES) return null
  try {
    const value: unknown = JSON.parse(text)
    if (!exact(value, ['kind', 'version', 'entries']) || value.kind !== 'progress-checkpoints' || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_CHECKPOINTS) return null
    const entries: Checkpoint[] = []
    for (const entry of value.entries) {
      if (!exact(entry, ['id', 'name', 'capturedRevision', 'profile']) || !safeId(entry.id) || typeof entry.name !== 'string' || !checkpointName(entry.name)
        || typeof entry.capturedRevision !== 'string' || !entry.capturedRevision.trim() || entry.capturedRevision.length > 1024) return null
      const parsed = parseProfileBackup(JSON.stringify(entry.profile), revision)
      if (!parsed.ok) return null
      entries.push({ id: entry.id, name: checkpointName(entry.name)!, capturedRevision: entry.capturedRevision, profile: parsed.profile })
    }
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return null
    const vault: CheckpointVault = { kind: 'progress-checkpoints', version: 1, entries }
    return bytes(JSON.stringify(vault, null, 2)) <= MAX_CHECKPOINT_BYTES ? vault : null
  } catch { return null }
}

export function exportCheckpoints(vault: CheckpointVault, revision: string): string | null {
  try {
    const parsed = parseCheckpoints(JSON.stringify(vault), revision)
    return parsed ? JSON.stringify(parsed, null, 2) : null
  } catch { return null }
}

/** Native-state equality ignores only the catalog revision normalized during migration. */
export function sameRecordedProfile(first: Profile, second: Profile): boolean {
  if (first.epoch !== second.epoch || first.showSpoilers !== second.showSpoilers) return false
  const purchases = Object.keys(first.purchases), milestones = Object.keys(first.milestones)
  return purchases.length === Object.keys(second.purchases).length && milestones.length === Object.keys(second.milestones).length
    && purchases.every((id) => Object.hasOwn(second.purchases, id) && first.purchases[id].active === second.purchases[id].active && first.purchases[id].epoch === second.purchases[id].epoch)
    && milestones.every((id) => Object.hasOwn(second.milestones, id))
}
