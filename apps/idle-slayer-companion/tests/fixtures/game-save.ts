// Synthetic test data only. Never populate fixtures from a player's save.
export function nativeSaveFixture({ version = '7.2.0', epoch = '0', integers = {}, strings = {}, floats = {}, booleans = {} }: {
  version?: string; epoch?: string; integers?: Record<string, number>; strings?: Record<string, string>; floats?: Record<string, number>; booleans?: Record<string, boolean>
} = {}) {
  return {
    StringData: Object.entries({ 'Last Played Version': version, 'Ultra Ascensions': epoch, ...strings }).map(([Key, Value]) => ({ Key, Value })),
    IntData: Object.entries(integers).map(([Key, Value]) => ({ Key, Value })),
    FloatData: Object.entries(floats).map(([Key, Value]) => ({ Key, Value })),
    BoolData: Object.entries(booleans).map(([Key, Value]) => ({ Key, Value })),
  }
}

/** Test-only native-format writer; the application is a reader. */
export function encodeGameSaveFixture(model: unknown): Uint8Array {
  const key = 'If you manage to get this string you are allowed to hack the game all you want'
  const json = JSON.stringify(model)
  return new TextEncoder().encode(json.split('').map((char, i) => String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join(''))
}
