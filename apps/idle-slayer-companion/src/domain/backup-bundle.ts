import { MAX_COMPANION_BYTES } from './companion-storage'
import { MAX_CHECKPOINT_BYTES } from './checkpoints'
import { MAX_COMPARISON_BYTES } from './saved-comparison'

/**
 * One file holding the four separately stored documents. Each part keeps its own existing format
 * and is restored through that document's own validated preview; the bundle adds no new rules.
 */
export const BACKUP_BUNDLE_FORMAT = 'idle-slayer-companion-backup'
export const MAX_INTENTIONS_BYTES = 65_536
export const MAX_BUNDLE_BYTES = MAX_COMPANION_BYTES + MAX_CHECKPOINT_BYTES + MAX_COMPARISON_BYTES + MAX_INTENTIONS_BYTES + 4096
export type BackupPart = 'progress' | 'intentions' | 'checkpoints' | 'comparison'
export const backupParts: readonly BackupPart[] = ['progress', 'intentions', 'checkpoints', 'comparison']
export type BackupKind = BackupPart | 'legacy-map'

export interface BackupBundle { format: typeof BACKUP_BUNDLE_FORMAT; version: 1; exportedAt: string; documents: Partial<Record<BackupPart, unknown>> }
export type DetectedBackup =
  | { kind: 'bundle'; exportedAt: string; parts: Partial<Record<BackupPart, string>> }
  | { kind: BackupKind; text: string }
  | { kind: 'unknown'; reason: 'invalid-json' | 'too-large' | 'unrecognized' }

const bytes = (text: string) => new TextEncoder().encode(text).byteLength
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Combine already exported document texts. A part that could not be exported is left out, never invented. */
export function createBackupBundle(parts: Partial<Record<BackupPart, string>>, exportedAt: Date): string {
  const documents: Partial<Record<BackupPart, unknown>> = {}
  for (const part of backupParts) { const text = parts[part]; if (text !== undefined) documents[part] = JSON.parse(text) }
  const bundle: BackupBundle = { format: BACKUP_BUNDLE_FORMAT, version: 1, exportedAt: exportedAt.toISOString(), documents }
  return JSON.stringify(bundle, null, 2)
}

/** The document a single JSON value is, by its own format or kind marker; the original map file by shape. */
function classify(value: unknown): BackupKind | null {
  if (!object(value)) return null
  if (value.format === 'idle-slayer-companion-progress') return 'progress'
  if (value.format === 'idle-slayer-companion-workspace') return 'intentions'
  if (value.kind === 'progress-checkpoints') return 'checkpoints'
  if (value.kind === 'upgrade-comparison') return 'comparison'
  // The original Ascension Map file has no format marker: a version 1 profile with purchases and milestones.
  if (!('format' in value) && !('kind' in value) && value.version === 1 && object(value.purchases) && object(value.milestones)) return 'legacy-map'
  return null
}

/**
 * Recognise any file the app writes. Detection only routes the text; each document's own parser
 * still validates it before any preview.
 */
export function detectBackup(text: string): DetectedBackup {
  if (bytes(text) > MAX_BUNDLE_BYTES) return { kind: 'unknown', reason: 'too-large' }
  let value: unknown
  try { value = JSON.parse(text) } catch { return { kind: 'unknown', reason: 'invalid-json' } }
  if (object(value) && value.format === BACKUP_BUNDLE_FORMAT) {
    if (value.version !== 1 || typeof value.exportedAt !== 'string' || !object(value.documents)) return { kind: 'unknown', reason: 'unrecognized' }
    const parts: Partial<Record<BackupPart, string>> = {}
    for (const [key, document] of Object.entries(value.documents)) {
      const part = backupParts.find((name) => name === key)
      // Each part must be the document its key names; anything else is rejected rather than guessed.
      if (!part || classify(document) !== part) return { kind: 'unknown', reason: 'unrecognized' }
      parts[part] = JSON.stringify(document)
    }
    if (!Object.keys(parts).length) return { kind: 'unknown', reason: 'unrecognized' }
    return { kind: 'bundle', exportedAt: value.exportedAt, parts }
  }
  const kind = classify(value)
  return kind ? { kind, text } : { kind: 'unknown', reason: 'unrecognized' }
}

export const backupPartLabels: Readonly<Record<BackupKind, string>> = {
  progress: 'Recorded progress', intentions: 'Goals and crafting plans', checkpoints: 'Ascension checkpoints', comparison: 'Saved upgrade comparison', 'legacy-map': 'Ascension map backup (original format)',
}

export function backupFilename(date: Date): string {
  return `idle-slayer-companion-backup-${date.toISOString().replace(/[:.]/g, '-')}.json`
}
