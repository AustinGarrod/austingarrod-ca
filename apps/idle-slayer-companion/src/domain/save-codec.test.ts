import { describe, expect, it } from 'vitest'
import { decodeGameSave, MAX_GAME_SAVE_BYTES } from './save-codec'
import { encodeGameSaveFixture, nativeSaveFixture } from '../../tests/fixtures/game-save'

describe('reviewed Steam game-save decoder', () => {
  it('decodes an independent UTF-16 XOR/UTF-8 golden fixture, including Unicode and all preference types', () => {
    // Generated independently with Python UTF-16LE code units, not our writer.
    const golden = 'MkRzDR0cTgolDxUGRxovFAIsAA0CTkolElMHVCIFDx5FHU8jRRMBDE8PTkBNIQQIVRFNGkpWTVkOREoYDBxDJgBZQ1ZORhAXAVUFBExYazBBFRoQAldD8KS5oQQERsKdTV06SVZpGhwtElQSVkgyFUVrHBZXGkMHFUcTDQgKVUlGdhUDVQ1DWVpdKURHZgsODBFkABgNAkM0DgI8BBdWc0RGCw4WVAQOAENLR3YVA1UCR04RWl0ULgxRNh0GAiNBDQ5XGjoJR2sEFU5VVRYBVAAGTg9DT0l2FQQQRUVbGRdVBBExXQ=='
    const result = decodeGameSave(Buffer.from(golden, 'base64'))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Golden fixture failed')
    expect(result.data.StringData.get('Last Played Version')).toBe('7.2.0')
    expect(result.data.StringData.get('fixture')).toBe('😀café')
    expect(result.data.IntData.get('upgrade')).toBe(1)
    expect(result.data.FloatData.get('fraction')).toBe(1.5)
    expect(result.data.BoolData.get('setting')).toBe(true)
  })

  it('consumes a UTF-8 BOM without trimming meaningful scrambled whitespace or modifying bytes', () => {
    const bytes = encodeGameSaveFixture(nativeSaveFixture())
    const before = bytes.slice()
    expect(decodeGameSave(bytes).ok).toBe(true)
    expect(bytes).toEqual(before)
    expect(decodeGameSave(new Uint8Array([239, 187, 191, ...bytes])).ok).toBe(true)
    expect(decodeGameSave(new Uint8Array([...bytes, 32])).ok).toBe(false)
  })

  it('allows native cross-type keys, while rejecting ambiguous duplicates within a typed array', () => {
    const model = nativeSaveFixture({ strings: { shared: 'text' }, integers: { shared: 1 }, booleans: { shared: true }, floats: { shared: 1.5 } })
    const result = decodeGameSave(encodeGameSaveFixture(model))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Cross-type fixture failed')
    expect(result.data.IntData.get('shared')).toBe(1)
    expect(result.data.StringData.get('shared')).toBe('text')
    model.IntData.push({ Key: 'shared', Value: 0 })
    expect(decodeGameSave(encodeGameSaveFixture(model)).ok).toBe(false)
  })

  it.each([
    {}, { StringData: [], IntData: [], FloatData: [], BoolData: [], extra: [] },
    { StringData: null, IntData: [], FloatData: [], BoolData: [] },
    { ...nativeSaveFixture(), IntData: [{ Key: 'sample', Value: 1.5 }] },
    { ...nativeSaveFixture(), IntData: [{ Key: 'sample', Value: 2147483648 }] },
    { ...nativeSaveFixture(), BoolData: [{ Key: 'sample', Value: 1 }] },
    { ...nativeSaveFixture(), FloatData: [{ Key: 'sample', Value: '1.5' }] },
    { ...nativeSaveFixture(), IntData: [{ Key: '', Value: 0 }] },
    { ...nativeSaveFixture(), IntData: [{ Key: 'x'.repeat(1025), Value: 0 }] },
    { ...nativeSaveFixture(), IntData: [{ Key: 'sample', Value: 0, extra: true }] },
  ])('rejects malformed or unreviewed model shapes without returning any preferences', (model) => {
    const result = decodeGameSave(encodeGameSaveFixture(model))
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('data')
  })

  it('retains a native nullable string as null so required-field validation cannot silently coerce it', () => {
    const result = decodeGameSave(encodeGameSaveFixture({ ...nativeSaveFixture(), StringData: [{ Key: 'sample', Value: null }] }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Nullable native string failed')
    expect(result.data.StringData.get('sample')).toBeNull()
  })

  it('bounds file and entry sizes, rejects invalid UTF-8 and unrelated files, and keeps parser errors generic', () => {
    expect(decodeGameSave(new Uint8Array(MAX_GAME_SAVE_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringContaining('4 MiB') })
    for (const bytes of [new Uint8Array(), new Uint8Array([255]), new TextEncoder().encode('fixture-private-content@example.invalid'), new TextEncoder().encode(JSON.stringify(nativeSaveFixture()))]) {
      const result = decodeGameSave(bytes)
      expect(result).toMatchObject({ ok: false })
      expect(JSON.stringify(result)).not.toContain('fixture-private-content')
    }
    const model = nativeSaveFixture()
    model.BoolData = Array.from({ length: 100_001 }, (_, i) => ({ Key: String(i), Value: true }))
    expect(decodeGameSave(encodeGameSaveFixture(model)).ok).toBe(false)
  })
})
