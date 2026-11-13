import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { COMPANION_SECTION_PATHS, offlineRelease, PWA_BASE, PWA_IDENTITY, renderWorker, validatePwaDistribution, writeSectionEntries } from '../scripts/pwa'

let fixtureDirectory: string | undefined
const mutations = new Map<string, Buffer | null>()
function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'ascension-pwa-release-'))
  fixtureDirectory = directory
  cpSync('public', directory, { recursive: true })
  writeFileSync(resolve(directory, 'index.html'), `<link rel="manifest" href="${PWA_BASE}manifest.webmanifest"><link rel="apple-touch-icon" href="${PWA_BASE}pwa/apple-touch-icon.png">`)
  writeSectionEntries(directory)
  const release = offlineRelease(process.cwd(), directory)
  writeFileSync(resolve(directory, 'offline-assets.json'), JSON.stringify(release))
  writeFileSync(resolve(directory, 'sw.js'), renderWorker(process.cwd(), release))
  return directory
}
function fixture() { if (!fixtureDirectory) throw new Error('Offline fixture was not initialized.'); return fixtureDirectory }
function mutateFixture(file: string, bytes: string | Uint8Array) {
  const path = resolve(fixture(), file)
  if (!path.startsWith(fixture() + sep)) throw new Error('Fixture mutation is outside the test directory.')
  if (!mutations.has(path)) mutations.set(path, existsSync(path) ? readFileSync(path) : null)
  writeFileSync(path, bytes)
}
describe('offline release verification', () => {
  // The suite inspects every real public file. Copy once rather than repeatedly
  // copying 1,493 sprites while unrelated test files compete for Windows I/O.
  // Each case still rehashes actual bytes and restores every mutation afterward.
  beforeAll(() => { createFixture() }, 20_000)
  afterEach(() => {
    for (const [path, original] of mutations) {
      if (!path.startsWith(fixture() + sep)) throw new Error('Unsafe fixture cleanup')
      if (original === null) rmSync(path, { force: true })
      else writeFileSync(path, original)
    }
    mutations.clear()
  })
  afterAll(() => {
    if (!fixtureDirectory) return
    if (!fixtureDirectory.startsWith(resolve(tmpdir()) + sep + 'ascension-pwa-release-')) throw new Error('Unsafe cleanup')
    rmSync(fixtureDirectory, { recursive: true, force: true })
    fixtureDirectory = undefined
  })
  it('covers every public catalog/icon/license and the reviewed normal/maskable install assets', () => {
    const directory = fixture()
    expect(() => validatePwaDistribution(process.cwd(), directory)).not.toThrow()
    const release = offlineRelease(process.cwd(), directory)
    expect(release.assets.filter((asset) => asset.file.startsWith('assets/upgrades/'))).toHaveLength(288)
    expect(release.assets.some((asset) => asset.file === 'licenses/index.html')).toBe(true)
    expect(release.assets.some((asset) => asset.file === 'pwa/maskable-512.png')).toBe(true)
    expect(release.assets.some((asset) => asset.file === 'companion-catalog.json')).toBe(true)
    for (const section of COMPANION_SECTION_PATHS) expect(release.assets.some((asset) => asset.file === section + '/index.html')).toBe(true)
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.webmanifest'), 'utf8'))
    expect(manifest.id).toBe(PWA_IDENTITY)
    expect(manifest.start_url).toBe(PWA_BASE)
    expect(manifest.scope).toBe(PWA_BASE)
  })
  it('rejects stale cached catalog bytes, worker code, scope and icon assets', () => {
    const directory = fixture()
    for (const file of ['catalog.json', 'sw.js', 'manifest.webmanifest', 'pwa/icon-192.png']) {
      const original = readFileSync(resolve(directory, file))
      mutateFixture(file, Buffer.concat([original, Buffer.from('\n')]))
      expect(() => validatePwaDistribution(process.cwd(), directory)).toThrow()
      writeFileSync(resolve(directory, file), original)
    }
  })
  it.each(['backup.json', 'assets/private.json', 'native.sav', 'licenses/transfer.bin', 'licenses/backup.json'])('refuses unreviewed cache input %s', (file) => {
    const directory = fixture(); mutateFixture(file, 'synthetic private input')
    expect(() => offlineRelease(process.cwd(), directory)).toThrow('Unreviewed offline asset')
  })
  it('rejects a section entry that is missing or differs from the app entry', () => {
    const directory = fixture()
    mutateFixture('achievements/index.html', 'Synthetic stale section HTML')
    expect(() => validatePwaDistribution(process.cwd(), directory)).toThrow()
  })
})

function workerFixture(fail = false) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>()
  const entries = new Map<string, Response>()
  const deleted = vi.fn(async () => true)
  const skipWaiting = vi.fn(async () => {})
  const clients = [{ id: 'current', url: 'https://app.test' + PWA_BASE }]
  const matchAll = vi.fn(async () => [...clients])
  const assets = ['index.html', 'catalog.json', 'achievements/index.html'].map((file) => ({ file, sha256: createHash('sha256').update(file).digest('hex') }))
  const caches = { open: async () => ({ put: async (url: string, response: Response) => { entries.set(url, response) }, match: async (url: string) => entries.get(url), keys: async () => [...entries.keys()].map((url) => ({ url })) }), delete: deleted, keys: async () => ['ascension-map-public-old', 'idle-slayer-companion-public-old'] }
  runInNewContext('const RELEASE=' + JSON.stringify({ version: 'test', assets }) + ';' + readFileSync('scripts/pwa-worker.js', 'utf8'), {
    self: { addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler), location: new URL('https://app.test' + PWA_BASE + 'sw.js'), registration: { scope: 'https://app.test' + PWA_BASE }, clients: { matchAll }, skipWaiting },
    caches, crypto: webcrypto, URL, Uint8Array, Response,
    fetch: async (url: string) => new Response(fail && url.endsWith('catalog.json') ? 'unverified newer bytes' : new URL(url).pathname.slice(PWA_BASE.length)),
  })
  const dispatch = async (name: string, event: Record<string, unknown>) => {
    let task: Promise<unknown> | undefined
    handlers.get(name)!({ ...event, waitUntil: (promise: Promise<unknown>) => { task = promise } })
    await task
  }
  return { dispatch, entries, deleted, skipWaiting, clients, matchAll }
}
describe('strict service-worker boundary', () => {
  it('verifies the complete release before installation and deletes a partial cache on mismatch', async () => {
    const good = workerFixture(); await good.dispatch('install', {}); expect(good.entries.size).toBe(3)
    const failed = workerFixture(true); await expect(failed.dispatch('install', {})).rejects.toThrow('Incomplete release'); expect(failed.deleted).toHaveBeenCalledWith('idle-slayer-companion-public-test')
  })
  it('handles root navigation without caching its query, and ignores analytics/private/POST requests', async () => {
    const worker = workerFixture(); await worker.dispatch('install', {})
    const respondWith = vi.fn()
    for (const request of [
      { method: 'GET', mode: 'cors', url: 'https://analytics.test/api/send' },
      { method: 'GET', mode: 'cors', url: 'https://app.test' + PWA_BASE + 'catalog.json?transfer=synthetic' },
      { method: 'GET', mode: 'navigate', url: 'https://app.test' + PWA_BASE + 'backup.json' },
      { method: 'POST', mode: 'cors', url: 'https://app.test' + PWA_BASE + 'catalog.json' },
    ]) await worker.dispatch('fetch', { request, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
    await worker.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://app.test' + PWA_BASE + '?transfer=synthetic' }, respondWith })
    expect(await (await respondWith.mock.calls[0][0]).text()).toBe('index.html')
    expect([...worker.entries.keys()].every((url) => !url.includes('?'))).toBe(true)
  })
  it('reopens reviewed sections offline and never intercepts arbitrary paths', async () => {
    const worker = workerFixture(); await worker.dispatch('install', {})
    const respondWith = vi.fn()
    await worker.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://app.test' + PWA_BASE + 'achievements/?private=synthetic' }, respondWith })
    expect(await (await respondWith.mock.calls[0][0]).text()).toBe('achievements/index.html')
    expect([...worker.entries.keys()].every((url) => !url.includes('?'))).toBe(true)
    respondWith.mockClear()
    await worker.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://app.test' + PWA_BASE + 'not-a-section/' }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  })
  it('rejects repair with another open app window and permits its check for the sole requesting client', async () => {
    const worker = workerFixture(); const postMessage = vi.fn()
    worker.clients.push({ id: 'other', url: 'https://app.test' + PWA_BASE })
    await worker.dispatch('message', { data: { type: 'CHECK_WINDOWS' }, source: { id: 'current' }, ports: [{ postMessage }] })
    expect(postMessage).toHaveBeenLastCalledWith({ accepted: false }); expect(worker.skipWaiting).not.toHaveBeenCalled()
    worker.clients.pop()
    await worker.dispatch('message', { data: { type: 'CHECK_WINDOWS' }, source: { id: 'current' }, ports: [{ postMessage }] })
    expect(postMessage).toHaveBeenLastCalledWith({ accepted: true }); expect(worker.skipWaiting).not.toHaveBeenCalled()
  })
  it('never activates or removes old assets from a window snapshot when another window joins late', async () => {
    const worker = workerFixture(); const postMessage = vi.fn()
    worker.matchAll.mockImplementationOnce(async () => {
      const snapshot = [...worker.clients]
      queueMicrotask(() => worker.clients.push({ id: 'joined-after-snapshot', url: 'https://app.test' + PWA_BASE }))
      return snapshot
    })
    await worker.dispatch('message', { data: { type: 'CHECK_WINDOWS' }, source: { id: 'current' }, ports: [{ postMessage }] })
    expect(postMessage).toHaveBeenCalledWith({ accepted: true })
    expect(worker.clients).toHaveLength(2)
    // Even a stale client asking for the former update protocol cannot force it.
    await worker.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' }, source: { id: 'current' }, ports: [{ postMessage }] })
    expect(worker.skipWaiting).not.toHaveBeenCalled(); expect(worker.deleted).not.toHaveBeenCalled()
    // Cache cleanup is reserved for the browser's eventual lifecycle activation.
    await worker.dispatch('activate', {})
    expect(worker.deleted).toHaveBeenCalledWith('idle-slayer-companion-public-old')
    expect(worker.deleted).not.toHaveBeenCalledWith('ascension-map-public-old')
  })
})
