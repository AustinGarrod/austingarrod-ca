/** Reviewed FileBasedPrefs transport for Steam Idle Slayer 7.2.0 and 7.3.4. */
export const MAX_GAME_SAVE_BYTES = 4 * 1024 * 1024
const MAX_PREFERENCE_ENTRIES = 100_000
const MAX_KEY_LENGTH = 1024
const MAX_STRING_LENGTH = 1024 * 1024

// Native reversible obfuscation, not an account or cloud credential.
const SCRAMBLER_KEY = 'If you manage to get this string you are allowed to hack the game all you want'
const fields = ['StringData', 'IntData', 'FloatData', 'BoolData'] as const

export interface NativeSaveData {
  StringData: Map<string, string | null>
  IntData: Map<string, number>
  FloatData: Map<string, number>
  BoolData: Map<string, boolean>
}

export type GameSaveDecodeResult = { ok: true; data: NativeSaveData } | { ok: false; error: string }

function invalid(): GameSaveDecodeResult {
  // Never echo a preference, file content or parser exception into the UI.
  return { ok: false, error: 'This file is not a supported Idle Slayer game save. Choose savedata.sav or backup.sav from the reviewed Steam version. Map progress was not changed.' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

/** Decodes only user-selected bytes; no filesystem, network or game methods. */
export function decodeGameSave(bytes: Uint8Array): GameSaveDecodeResult {
  if (bytes.byteLength > MAX_GAME_SAVE_BYTES) return { ok: false, error: 'The game save exceeds the 4 MiB import limit. Map progress was not changed.' }
  if (!bytes.byteLength) return invalid()
  try {
    // ReadAllText consumes a UTF-8 BOM. Keep all other scrambled whitespace:
    // XOR positions are indexed by UTF-16 code units, exactly as C# char.
    const scrambled = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const chunks: string[] = []
    for (let start = 0; start < scrambled.length; start += 8192) {
      const chars: number[] = []
      for (let i = start; i < Math.min(start + 8192, scrambled.length); i++) chars.push(scrambled.charCodeAt(i) ^ SCRAMBLER_KEY.charCodeAt(i % SCRAMBLER_KEY.length))
      chunks.push(String.fromCharCode(...chars))
    }
    const model: unknown = JSON.parse(chunks.join(''))
    if (!isRecord(model) || !exactKeys(model, fields)) return invalid()
    const data: NativeSaveData = { StringData: new Map(), IntData: new Map(), FloatData: new Map(), BoolData: new Map() }
    let totalEntries = 0
    for (const field of fields) {
      const items = model[field]
      if (!Array.isArray(items)) return invalid()
      totalEntries += items.length
      if (totalEntries > MAX_PREFERENCE_ENTRIES) return invalid()
      const keys = new Set<string>()
      for (const item of items) {
        if (!isRecord(item) || !exactKeys(item, ['Key', 'Value']) || typeof item.Key !== 'string' || !item.Key.length || item.Key.length > MAX_KEY_LENGTH || keys.has(item.Key)) return invalid()
        keys.add(item.Key)
        const value = item.Value
        if (field === 'StringData') {
          if (value !== null && (typeof value !== 'string' || value.length > MAX_STRING_LENGTH)) return invalid()
          data.StringData.set(item.Key, value)
        } else if (field === 'IntData') {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) return invalid()
          data.IntData.set(item.Key, value)
        } else if (field === 'FloatData') {
          if (typeof value !== 'number' || !Number.isFinite(value)) return invalid()
          data.FloatData.set(item.Key, value)
        } else {
          if (typeof value !== 'boolean') return invalid()
          data.BoolData.set(item.Key, value)
        }
      }
    }
    return { ok: true, data }
  } catch { return invalid() }
}
