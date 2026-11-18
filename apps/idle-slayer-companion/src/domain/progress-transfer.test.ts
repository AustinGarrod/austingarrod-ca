import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { emptyProfile, MAX_PROFILE_EPOCH, type Catalog } from './types'
import { captureProgressTransfer, decodeProgressTransfer, encodeProgressTransfer, MAX_TRANSFER_INPUT_CHARS, MAX_TRANSFER_TOKEN_CHARS, progressTransferLink } from './progress-transfer'
import { createTransferQr } from './transfer-qr'
import { MAX_PROFILE_BYTES } from './storage'
import dictionaries from '../data/transfer-dictionaries.json' with { type: 'json' }

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const wireToken = (wire: unknown) => 'v1.' + gzipSync(JSON.stringify(wire)).toString('base64url')
const profile = { ...emptyProfile('older-profile-revision'), epoch: MAX_PROFILE_EPOCH, showSpoilers: true, purchases: {
  [catalog.startId]: { epoch: MAX_PROFILE_EPOCH, active: true },
  [catalog.upgrades[0].id]: { epoch: 1, active: false }, unknown: { epoch: 3, active: false },
}, milestones: { [catalog.milestones[0].id]: true as const, unknown: true as const } }

describe('local versioned progress transfer', () => {
  it('losslessly round trips normalized progress, unknown IDs and layout with catalog migration', async () => {
    const original = structuredClone(profile)
    const encoded = await encodeProgressTransfer(catalog, profile, 'web')
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) throw new Error('fixture')
    expect(await decodeProgressTransfer(encoded.token, catalog.revision)).toEqual({ ok: true, profile: { ...profile, catalogRevision: catalog.revision }, layout: 'web' })
    const link = progressTransferLink(encoded.token, 'https://example.test', '/idle-slayer-ascension-map/')
    expect(await decodeProgressTransfer(link, 'future-catalog-revision')).toEqual({ ok: true, profile: { ...profile, catalogRevision: 'future-catalog-revision' }, layout: 'web' })
    expect(profile).toEqual(original)
  })
  it('retains an immutable current ID dictionary for decoding historical catalogs', () => {
    const dictionary = dictionaries.dictionaries.find((item) => item.revision === catalog.revision)!
    expect(dictionary.upgrades).toEqual(catalog.upgrades.map((upgrade) => upgrade.id))
    expect(dictionary.milestones).toEqual(catalog.milestones.map((milestone) => milestone.id))
    expect(new Set(dictionary.upgrades).size).toBe(dictionary.upgrades.length)
  })
  it('fits a representative complete native catalog with history and activation in a readable QR', async () => {
    const complete = { ...emptyProfile(catalog.revision), epoch: 8,
      purchases: Object.fromEntries(catalog.upgrades.map((upgrade, index) => [upgrade.id, { epoch: upgrade.retention === 'repeat' ? 8 : 5, active: upgrade.activation === 'immediate' || index % 2 === 0 }])),
      milestones: Object.fromEntries(catalog.milestones.map((milestone) => [milestone.id, true as const])),
    }
    const encoded = await encodeProgressTransfer(catalog, complete, 'native')
    if (!encoded.ok) throw new Error(encoded.error)
    const link = progressTransferLink(encoded.token, 'https://austingarrod.github.io', '/idle-slayer-ascension-map/')
    const qr = createTransferQr(link)
    expect(qr.status).toBe('ready')
    if (qr.status === 'ready') {
      expect(qr.version).toBeLessThanOrEqual(20)
      console.info('Synthetic complete-catalog QR:', { bytes: new TextEncoder().encode(link).length, version: qr.version, modules: qr.moduleCount, upgrades: catalog.upgrades.length, milestones: catalog.milestones.length })
    }
    expect(await decodeProgressTransfer(link, catalog.revision)).toEqual({ ok: true, profile: complete, layout: 'native' })
  })
  it('uses a full envelope when the catalog dictionary is unavailable and still migrates safely', async () => {
    const encoded = await encodeProgressTransfer({ ...catalog, revision: 'synthetic-other-dictionary' }, profile, 'native')
    if (!encoded.ok) throw new Error('fixture')
    expect(await decodeProgressTransfer(encoded.token, catalog.revision)).toEqual({ ok: true, profile: { ...profile, catalogRevision: catalog.revision }, layout: 'native' })
  })
  it.each(['', 'v2.unknown', 'v1.@@@@', 'v1.A', 'https://example.test/#wrong=v1.test', 'https://user:password@example.test/#transfer=v1.AAAA'])('rejects corrupt or unsupported input without a partial profile: %j', async (input) => {
    expect(await decodeProgressTransfer(input, catalog.revision)).toMatchObject({ ok: false })
  })
  it('rejects unsupported envelope fields, malformed records and incomplete compact data', async () => {
    for (const wire of [
      { format: 'ISAM', version: 2, layout: 'native', encoding: 'profile', profile },
      { format: 'ISAM', version: 1, layout: 'invalid', encoding: 'profile', profile },
      { format: 'ISAM', version: 1, layout: 'web', encoding: 'profile', profile, tracking: 'enabled' },
      { format: 'ISAM', version: 1, layout: 'web', encoding: 'profile', profile: { ...profile, purchases: { unknown: { epoch: -1, active: true } } } },
      { format: 'ISAM', version: 1, layout: 'web', encoding: 'compact', dictionary: catalog.revision, profile: {} },
    ]) expect(await decodeProgressTransfer(wireToken(wire), catalog.revision)).toMatchObject({ ok: false })
  })
  it.each(['compact', 'profile'])('rejects non-string layouts in an otherwise valid %s envelope', async (encoding) => {
    const sourceCatalog = encoding === 'compact' ? catalog : { ...catalog, revision: 'synthetic-other-dictionary' }
    const encoded = await encodeProgressTransfer(sourceCatalog, profile, 'native')
    if (!encoded.ok) throw new Error(encoded.error)
    const wire = JSON.parse(gunzipSync(Buffer.from(encoded.token.slice(3), 'base64url')).toString('utf8'))
    expect(wire.encoding).toBe(encoding)
    expect((await decodeProgressTransfer(encoded.token, catalog.revision)).ok).toBe(true)
    for (const layout of [['native'], ['web'], [], null, true, 1, { value: 'native' }]) {
      expect(await decodeProgressTransfer(wireToken({ ...wire, layout }), catalog.revision)).toMatchObject({ ok: false })
    }
  })
  it('caps both encoded input and decompressed bytes, refusing compression bombs and oversized profiles', async () => {
    expect(await decodeProgressTransfer('x'.repeat(MAX_TRANSFER_INPUT_CHARS + 1), catalog.revision)).toMatchObject({ ok: false, error: expect.stringContaining('4 MiB') })
    expect(await decodeProgressTransfer('v1.' + 'A'.repeat(MAX_TRANSFER_TOKEN_CHARS), catalog.revision)).toMatchObject({ ok: false, error: expect.stringContaining('4 MiB') })
    const bomb = 'v1.' + gzipSync(Buffer.alloc(MAX_PROFILE_BYTES + 1, 32)).toString('base64url')
    expect(await decodeProgressTransfer(bomb, catalog.revision)).toMatchObject({ ok: false, error: expect.stringContaining('4 MiB') })
    const huge = { ...emptyProfile(catalog.revision), milestones: Object.fromEntries(Array.from({ length: 4500 }, (_, index) => [`${index}-${'x'.repeat(1000)}`, true as const])) }
    expect(await encodeProgressTransfer(catalog, huge, 'native')).toMatchObject({ ok: false, error: expect.stringContaining('4 MiB') })
  })
})

describe('transfer URL startup privacy', () => {
  it('captures a fragment and removes all URL data before analytics can run', () => {
    const calls: unknown[][] = []
    const win = { location: { hash: '#transfer=v1.AAAA', pathname: '/idle-slayer-ascension-map/' }, history: { state: { kept: true }, replaceState: (...arguments_: unknown[]) => calls.push(arguments_) } } as unknown as Window
    expect(captureProgressTransfer(win)).toEqual({ cleaned: true, token: 'v1.AAAA' })
    expect(calls).toEqual([[{ kept: true }, '', '/idle-slayer-ascension-map/']])
  })
  it('keeps tracking initialization disabled if URL cleanup fails and preserves ordinary opt-out visits', () => {
    const win = { location: { hash: '#transfer=v1.PRIVATE', pathname: '/' }, history: { replaceState: () => { throw new Error('PRIVATE') } } } as unknown as Window
    expect(captureProgressTransfer(win)).toMatchObject({ cleaned: false, error: expect.stringContaining('Tracking was kept off') })
    expect(JSON.stringify(captureProgressTransfer(win))).not.toContain('PRIVATE')
    expect(captureProgressTransfer({ ...win, location: { ...win.location, hash: '#analytics=off' } } as Window)).toBeNull()
  })
})
