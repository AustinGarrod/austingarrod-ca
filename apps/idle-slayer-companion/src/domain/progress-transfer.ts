import dictionaries from '../data/transfer-dictionaries.json' with { type: 'json' }
import type { Catalog, Profile } from './types'
import type { MapLayoutMode } from './map-layout'
import { exportProfileBackup, MAX_PROFILE_BYTES, parseProfileBackup } from './storage'

export const TRANSFER_FRAGMENT = '#transfer='
export const MAX_TRANSFER_TOKEN_CHARS = Math.ceil(MAX_PROFILE_BYTES * 4 / 3) + 4
export const MAX_TRANSFER_INPUT_CHARS = MAX_TRANSFER_TOKEN_CHARS + 4096
type Failure = { ok: false; error: string }
export type TransferResult = { ok: true; profile: Profile; layout: MapLayoutMode } | Failure
export type TransferCapture = { token?: string; error?: string; cleaned: boolean } | null
type Dictionary = typeof dictionaries.dictionaries[number]
type CompactProfile = { r: string; e: number; s: boolean; p: string; h: [number, string][]; u: [string, number, boolean][]; m: string; n: string[] }
type Wire = { format: 'ISAM'; version: 1; layout: MapLayoutMode } & ({ encoding: 'compact'; dictionary: string; profile: CompactProfile } | { encoding: 'profile'; profile: Profile })
const invalid = (): Failure => ({ ok: false, error: 'This transfer is incomplete, corrupt or unsupported. Progress was not changed. Use a fresh transfer or a JSON backup.' })
const tooLarge = (): Failure => ({ ok: false, error: 'This transfer exceeds the 4 MiB profile limit. Progress was not changed. Use a supported JSON backup.' })
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key))
const epoch = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function bytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error('invalid')
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const result = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (base64(result) !== value) throw new Error('invalid')
  return result
}
async function bounded(stream: ReadableStream<Uint8Array>, limit = MAX_PROFILE_BYTES): Promise<Uint8Array> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      length += item.value.length
      if (length > limit) throw new Error('size')
      chunks.push(item.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
function pack(values: number[], bits: 1 | 2): string {
  const packed = new Uint8Array(Math.ceil(values.length * bits / 8))
  values.forEach((value, index) => { packed[Math.floor(index * bits / 8)] |= value << (index * bits % 8) })
  return base64(packed)
}
function unpack(value: string, count: number, bits: 1 | 2): number[] {
  const packed = bytes(value)
  if (packed.length !== Math.ceil(count * bits / 8)) throw new Error('invalid')
  const values = Array.from({ length: count }, (_, index) => (packed[Math.floor(index * bits / 8)] >> (index * bits % 8)) & ((1 << bits) - 1))
  if (pack(values, bits) !== value) throw new Error('invalid')
  return values
}
function compact(profile: Profile, dictionary: Dictionary): CompactProfile {
  const known = new Set(dictionary.upgrades), milestones = new Set(dictionary.milestones)
  const history = new Map<number, number[]>()
  dictionary.upgrades.forEach((id, index) => {
    const purchase = profile.purchases[id]
    if (!purchase || purchase.epoch === profile.epoch) return
    if (!history.has(purchase.epoch)) history.set(purchase.epoch, new Array(dictionary.upgrades.length).fill(0))
    history.get(purchase.epoch)![index] = 1
  })
  return {
    r: profile.catalogRevision, e: profile.epoch, s: profile.showSpoilers,
    p: pack(dictionary.upgrades.map((id) => profile.purchases[id] ? profile.purchases[id].active ? 1 : 2 : 0), 2),
    h: [...history].sort(([a], [b]) => a - b).map(([epoch, members]) => [epoch, pack(members, 1)]),
    u: Object.entries(profile.purchases).filter(([id]) => !known.has(id)).map(([id, purchase]) => [id, purchase.epoch, purchase.active]),
    m: pack(dictionary.milestones.map((id) => profile.milestones[id] ? 1 : 0), 1),
    n: Object.keys(profile.milestones).filter((id) => !milestones.has(id)),
  }
}
function expand(value: unknown, dictionary: Dictionary): Profile {
  if (!record(value) || !keys(value, ['r', 'e', 's', 'p', 'h', 'u', 'm', 'n']) || typeof value.r !== 'string' || !epoch(value.e)
    || typeof value.s !== 'boolean' || typeof value.p !== 'string' || typeof value.m !== 'string'
    || !Array.isArray(value.h) || !Array.isArray(value.u) || !Array.isArray(value.n)) throw new Error('invalid')
  const states = unpack(value.p, dictionary.upgrades.length, 2), milestoneStates = unpack(value.m, dictionary.milestones.length, 1)
  const purchases: Profile['purchases'] = Object.create(null), milestones: Profile['milestones'] = Object.create(null)
  states.forEach((state, index) => {
    if (state === 3) throw new Error('invalid')
    if (state) purchases[dictionary.upgrades[index]] = { epoch: value.e as number, active: state === 1 }
  })
  const history = new Set<number>(), historyEpochs = new Set<number>()
  for (const item of value.h) {
    if (!Array.isArray(item) || item.length !== 2 || !epoch(item[0]) || item[0] >= value.e || historyEpochs.has(item[0]) || typeof item[1] !== 'string') throw new Error('invalid')
    historyEpochs.add(item[0])
    const members = unpack(item[1], states.length, 1)
    if (!members.some(Boolean)) throw new Error('invalid')
    members.forEach((member, index) => {
      if (!member) return
      if (!states[index] || history.has(index)) throw new Error('invalid')
      history.add(index); purchases[dictionary.upgrades[index]].epoch = item[0]
    })
  }
  const knownUpgrades = new Set(dictionary.upgrades), knownMilestones = new Set(dictionary.milestones)
  for (const item of value.u) {
    if (!Array.isArray(item) || item.length !== 3 || typeof item[0] !== 'string' || knownUpgrades.has(item[0]) || Object.hasOwn(purchases, item[0]) || !epoch(item[1]) || typeof item[2] !== 'boolean') throw new Error('invalid')
    purchases[item[0]] = { epoch: item[1], active: item[2] }
  }
  milestoneStates.forEach((state, index) => { if (state) milestones[dictionary.milestones[index]] = true })
  for (const id of value.n) {
    if (typeof id !== 'string' || knownMilestones.has(id) || Object.hasOwn(milestones, id)) throw new Error('invalid')
    milestones[id] = true
  }
  return { version: 1, catalogRevision: value.r, epoch: value.e, purchases, milestones, showSpoilers: value.s }
}

export async function encodeProgressTransfer(catalog: Catalog, profile: Profile, layout: MapLayoutMode): Promise<{ ok: true; token: string } | Failure> {
  const validation = exportProfileBackup(profile)
  if (!validation.ok) return validation.error.kind === 'too-large' ? tooLarge() : invalid()
  if (!['native', 'web'].includes(layout)) return invalid()
  const dictionary = dictionaries.dictionaries.find((item) => item.revision === catalog.revision
    && JSON.stringify(item.upgrades) === JSON.stringify(catalog.upgrades.map((upgrade) => upgrade.id))
    && JSON.stringify(item.milestones) === JSON.stringify(catalog.milestones.map((milestone) => milestone.id)))
  const wire: Wire = dictionary ? { format: 'ISAM', version: 1, layout, encoding: 'compact', dictionary: dictionary.revision, profile: compact(profile, dictionary) }
    : { format: 'ISAM', version: 1, layout, encoding: 'profile', profile }
  try {
    const plain = new TextEncoder().encode(JSON.stringify(wire))
    if (plain.length > MAX_PROFILE_BYTES) return tooLarge()
    const compressed = await bounded(new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip')))
    return { ok: true, token: `v1.${base64(compressed)}` }
  } catch { return { ok: false, error: 'This browser cannot create a progress transfer. Use Export JSON backup instead.' } }
}

export function transferToken(input: string): string | null {
  if (input.length > MAX_TRANSFER_INPUT_CHARS) return null
  const value = input.trim()
  if (value.startsWith('v1.')) return value
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.hash.startsWith(TRANSFER_FRAGMENT) ? url.hash.slice(TRANSFER_FRAGMENT.length) : null
  } catch { return null }
}
export async function decodeProgressTransfer(input: string, catalogRevision: string): Promise<TransferResult> {
  if (input.length > MAX_TRANSFER_INPUT_CHARS) return tooLarge()
  const token = transferToken(input)
  if (!token) return invalid()
  if (token.length > MAX_TRANSFER_TOKEN_CHARS) return tooLarge()
  if (!/^v1\.[A-Za-z0-9_-]+$/.test(token)) return invalid()
  try {
    const compressed = bytes(token.slice(3))
    if (compressed.length > MAX_PROFILE_BYTES) return tooLarge()
    const plain = await bounded(new Blob([new Uint8Array(compressed)]).stream().pipeThrough(new DecompressionStream('gzip')))
    const wire: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain))
    if (!record(wire) || wire.format !== 'ISAM' || wire.version !== 1 || (wire.layout !== 'native' && wire.layout !== 'web')) return invalid()
    let profile: Profile | unknown
    if (wire.encoding === 'compact') {
      if (!keys(wire, ['format', 'version', 'layout', 'encoding', 'dictionary', 'profile'])) return invalid()
      const dictionary = dictionaries.dictionaries.find((item) => item.revision === wire.dictionary)
      if (!dictionary) return invalid()
      profile = expand(wire.profile, dictionary)
    } else if (wire.encoding === 'profile' && keys(wire, ['format', 'version', 'layout', 'encoding', 'profile'])) profile = wire.profile
    else return invalid()
    const validation = parseProfileBackup(JSON.stringify(profile), catalogRevision)
    return validation.ok ? { ok: true, profile: validation.profile, layout: wire.layout } : validation.error.kind === 'too-large' ? tooLarge() : invalid()
  } catch (error) { return error instanceof Error && error.message === 'size' ? tooLarge() : invalid() }
}

/** Capture and remove the fragment before analytics initialization or any preview. */
export function captureProgressTransfer(win: Pick<Window, 'location' | 'history'>): TransferCapture {
  if (!win.location.hash.startsWith(TRANSFER_FRAGMENT)) return null
  const token = win.location.hash.slice(TRANSFER_FRAGMENT.length)
  try {
    win.history.replaceState(win.history.state, '', win.location.pathname)
  } catch { return { cleaned: false, error: 'The transfer link could not be removed from this address. Tracking was kept off; open the map directly and paste the transfer link to continue.' } }
  return token.length <= MAX_TRANSFER_TOKEN_CHARS ? { cleaned: true, token } : { cleaned: true, error: tooLarge().error }
}
export function progressTransferLink(token: string, origin: string, basePath: string): string {
  const url = new URL(basePath, origin)
  url.search = ''; url.hash = `${TRANSFER_FRAGMENT.slice(1)}${token}`
  return url.toString()
}
