import { MAX_PROFILE_EPOCH, type Profile } from './types'

export const PROFILE_STORAGE_KEY = 'idle-slayer-ascension-map.profile.v1'
export const MAX_PROFILE_BYTES = 4 * 1024 * 1024

export type ProfileErrorKind =
  | 'invalid-json'
  | 'invalid-profile'
  | 'too-large'
  | 'storage-read'
  | 'storage-write'

export interface ProfileError {
  kind: ProfileErrorKind
  message: string
}

interface Failure {
  ok: false
  error: ProfileError
}

export type ParseProfileResult = { ok: true; profile: Profile } | Failure
export type ExportProfileResult = { ok: true; text: string } | Failure
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype'])
const profileKeys = ['version', 'catalogRevision', 'epoch', 'purchases', 'milestones', 'showSpoilers']

function failure(kind: ProfileErrorKind, message: string): Failure {
  return { ok: false, error: { kind, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasSafeKeys(value: Record<string, unknown>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && !forbiddenKeys.has(key))
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return hasSafeKeys(value)
    && Reflect.ownKeys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key))
}

function isId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 1024 && !forbiddenKeys.has(value)
}

function isEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PROFILE_EPOCH
}

function validateProfile(value: unknown): ParseProfileResult {
  const invalid = () => failure('invalid-profile', 'The backup does not match the supported profile format. Progress was not replaced.')
  if (!isRecord(value) || !hasExactKeys(value, profileKeys)) return invalid()
  if (value.version !== 1
    || typeof value.catalogRevision !== 'string'
    || !isId(value.catalogRevision)
    || !isEpoch(value.epoch)
    || typeof value.showSpoilers !== 'boolean'
    || !isRecord(value.purchases)
    || !isRecord(value.milestones)
    || !hasSafeKeys(value.purchases)
    || !hasSafeKeys(value.milestones)) return invalid()

  const purchases: Profile['purchases'] = {}
  for (const [id, purchase] of Object.entries(value.purchases)) {
    if (!isId(id)
      || !isRecord(purchase)
      || !hasExactKeys(purchase, ['epoch', 'active'])
      || !isEpoch(purchase.epoch)
      || purchase.epoch > value.epoch
      || typeof purchase.active !== 'boolean') return invalid()
    purchases[id] = { epoch: purchase.epoch, active: purchase.active }
  }

  const milestones: Profile['milestones'] = {}
  for (const [id, received] of Object.entries(value.milestones)) {
    if (!isId(id) || received !== true) return invalid()
    milestones[id] = true
  }

  return {
    ok: true,
    profile: {
      version: 1,
      catalogRevision: value.catalogRevision,
      epoch: value.epoch,
      purchases,
      milestones,
      showSpoilers: value.showSpoilers,
    },
  }
}

/** Parse and validate before replacing the in-memory profile. Unknown IDs remain intact. */
export function parseProfileBackup(text: string, catalogRevision?: string): ParseProfileResult {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) {
    return failure('too-large', 'The backup exceeds the 4 MiB limit. Progress was not replaced.')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return failure('invalid-json', 'The backup is not valid JSON. Progress was not replaced.')
  }
  const validation = validateProfile(value)
  if (!validation.ok) return validation
  const profile = catalogRevision === undefined
    ? validation.profile
    : migrateProfile(validation.profile, catalogRevision)
  const portable = exportProfileBackup(profile)
  if (!portable.ok) {
    return portable.error.kind === 'too-large'
      ? failure('too-large', 'The backup exceeds the 4 MiB save and export limit after validation. Progress was not replaced.')
      : portable
  }
  return { ok: true, profile }
}

/** Produce a portable backup with the same validation applied to imported files. */
export function exportProfileBackup(profile: Profile): ExportProfileResult {
  try {
    const validation = validateProfile(profile)
    if (!validation.ok) return validation
    const text = JSON.stringify(validation.profile, null, 2)
    if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) {
      return failure('too-large', 'The profile exceeds the 4 MiB backup limit. Current progress remains available in this session.')
    }
    return { ok: true, text }
  } catch {
    return failure('invalid-profile', 'The profile could not be exported. Current progress remains available in this session.')
  }
}

/** A catalog refresh must preserve records for IDs removed from, or unknown to, this catalog. */
export function migrateProfile(profile: Profile, catalogRevision: string): Profile {
  return {
    ...profile,
    catalogRevision,
    purchases: Object.fromEntries(Object.entries(profile.purchases).map(([id, purchase]) => [id, { ...purchase }])),
    milestones: { ...profile.milestones },
  }
}
