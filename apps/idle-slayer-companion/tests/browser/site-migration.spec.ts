import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from './fixtures'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { emptyCompanionProgress } from '../../src/domain/companion-progress'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'
import { ANALYTICS_PREFERENCE_KEY } from '../../src/analytics'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { GOALS_STORAGE_KEY } from '../../src/domain/goals'
import { encodeProgressTransfer } from '../../src/domain/progress-transfer'
import { COMPANION_WORKSPACE_KEY, emptyCompanionWorkspace } from '../../src/domain/companion-workspace'
import { CHECKPOINT_STORAGE_KEY, emptyCheckpoints } from '../../src/domain/checkpoints'
import { COMPARISON_STORAGE_KEY, emptyComparison } from '../../src/domain/saved-comparison'
import { visibility } from '../../src/domain/rules'
import { COMPANION_SECTION_PATHS } from '../../scripts/pwa'
import { openProgress } from './helpers/app'
import type { Locator, Page } from '@playwright/test'

test.use({ serviceWorkers: 'allow', appServiceWorkers: false })
const root = resolve('.cache/site-migration'), legacy = '/idle-slayer-ascension-map/', companion = '/idle-slayer-companion/'
const destination = 'https://austingarrod.ca/utilities/idle-slayer-companion/'
const plainDestination = destination + '?migration=1#analytics=off'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const exportLabels = ['Export Companion progress', 'Export intentions', 'Export checkpoints', 'Export comparison']
const oldCache = 'idle-slayer-companion-public-synthetic-before-retirement'
let oldWorkerBase: string | null = null
const oldHTML = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Previous cached release</title><h1>Previous cached release</h1><p>This synthetic old window must close naturally.</p></html>'
const oldWorker = `const oldCache = ${JSON.stringify(oldCache)};
self.addEventListener('install', event => event.waitUntil(caches.open(oldCache).then(cache => cache.put(new URL('index.html', self.registration.scope), new Response(${JSON.stringify(oldHTML)}, {headers:{'Content-Type':'text/html'}})))));
self.addEventListener('fetch', event => {
 if(event.request.mode==='navigate' && event.request.url.startsWith(self.registration.scope)) event.respondWith(caches.open(oldCache).then(cache => cache.match(new URL('index.html',self.registration.scope))));
});`
const server = createServer((request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname)
    if (oldWorkerBase && path === oldWorkerBase + 'sw.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(oldWorker); return
    }
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path))
    if (!file.startsWith(root + sep) || !statSync(file).isFile()) throw new Error()
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') || file.endsWith('.webmanifest') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(readFileSync(file))
  } catch { response.writeHead(404); response.end() }
})
let origin: string
test.beforeAll(async () => {
  for (const base of [legacy, companion]) readFileSync(resolve(root, base.slice(1), 'index.html'))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(async () => { await new Promise<void>((done) => server.close(() => done())) })

async function seedReadOnlyStorage(page: Page, documents: Record<string, string>) {
  await page.addInitScript(({ oldOrigin, documents }) => {
    if (location.origin !== oldOrigin) return
    for (const [key, value] of Object.entries(documents)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
    const writes: string[] = []
    ;(window as Window & { retirementWrites?: string[] }).retirementWrites = writes
    for (const operation of ['setItem', 'removeItem', 'clear'] as const) {
      const original = Storage.prototype[operation]
      Object.defineProperty(Storage.prototype, operation, { configurable: true, value: function (...args: string[]) {
        if (this === localStorage) writes.push(operation)
        return Reflect.apply(original, this, args)
      } })
    }
  }, { oldOrigin: origin, documents })
}
const storedProgress = (progress: ReturnType<typeof emptyCompanionProgress>, legacyBaseline: string | null = null) => JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline, progress })
const readStorage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
async function expectNoStorageWrites(page: Page) {
  expect(await page.evaluate(() => (window as Window & { retirementWrites?: string[] }).retirementWrites ?? [])).toEqual([])
}
async function expectRetired(page: Page) {
  await expect(page.getByRole('heading', { name: 'Idle Slayer Companion has moved', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open new app', exact: true })).toBeVisible()
  await expect(page.locator('.toolbar, .react-flow, .companion-sidebar, nav, dialog, input, textarea, select')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Undo|Redo|Record purchase.*|Apply purchases|Reset.*|Import.*|Restore.*|Install.*|Continue.*|Dismiss.*)$/ })).toHaveCount(0)
}
async function exportedFile(page: Page, action: Locator) {
  const pending = page.waitForEvent('download')
  await action.click()
  const file = await (await pending).path()
  return readFileSync(file!)
}
async function openComparison(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const mobile = page.getByRole('button', { name: 'Map options', exact: true })
  await (await mobile.isVisible() ? mobile : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Saved upgrade comparison…', exact: true }).click()
  return page.getByRole('dialog', { name: 'Saved upgrade comparison', exact: true })
}

test('both historical addresses and all section bookmarks show only the transfer page', async ({ page }) => {
  test.setTimeout(90000)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await seedReadOnlyStorage(page, {})
  for (const base of [legacy, companion]) for (const suffix of ['', 'index.html', ...COMPANION_SECTION_PATHS.flatMap((section) => [section + '/', section + '/index.html'])]) {
    await page.goto(origin + base + suffix + '?private=synthetic-secret#arbitrary=private')
    await expectRetired(page)
    await expect(page).toHaveURL(origin + base + suffix)
    await expect(page.getByRole('link', { name: 'Open new app', exact: true })).toHaveAttribute('href', plainDestination)
    expect(await readStorage(page)).toEqual({})
    await expectNoStorageWrites(page)
  }
  expect(requests.some((url) => /analytics\.garrod\.house|reports\.garrod\.house|austingarrod\.ca/.test(url))).toBe(false)
})

test('reviewed public references remain only in the explicit new-app link', async ({ page }) => {
  await seedReadOnlyStorage(page, {})
  const reference = new URLSearchParams({ upgrade: catalog.startId, catalog: catalog.revision }).toString()
  await page.goto(origin + legacy + 'ascension/?private=synthetic-secret#' + reference)
  await expectRetired(page)
  await expect(page).toHaveURL(origin + legacy + 'ascension/')
  await expect(page.getByRole('link', { name: 'Open new app', exact: true })).toHaveAttribute('href', destination + '?migration=1#' + reference)
  expect(await readStorage(page)).toEqual({})
  await expectNoStorageWrites(page)
})

test('incoming map transfers are validated and never applied on the retired origin', async ({ page }) => {
  const encoded = await encodeProgressTransfer(catalog, { ...emptyProfile(catalog.revision), epoch: 3 }, 'native')
  if (!encoded.ok) throw new Error(encoded.error)
  await seedReadOnlyStorage(page, {})
  await page.goto(origin + companion + '?private=synthetic#transfer=' + encoded.token)
  await expectRetired(page)
  await expect(page).toHaveURL(origin + companion)
  await expect(page.getByRole('link', { name: 'Open new app', exact: true })).toHaveAttribute('href', destination + '?migration=1#transfer=' + encoded.token)
  expect(await readStorage(page)).toEqual({})
  await expectNoStorageWrites(page)
  await page.goto(origin + legacy + '#transfer=v1.corrupt')
  await expectRetired(page)
  await expect(page.getByRole('link', { name: 'Open new app', exact: true })).toHaveAttribute('href', plainDestination)
  expect(await readStorage(page)).toEqual({})
})

test('incoming private transfers keep the destination link disabled until asynchronous validation finishes', async ({ page }) => {
  const encoded = await encodeProgressTransfer(catalog, { ...emptyProfile(catalog.revision), epoch: 5 }, 'native')
  if (!encoded.ok) throw new Error(encoded.error)
  await seedReadOnlyStorage(page, {})
  await page.addInitScript(() => {
    const NativeDecompressionStream = DecompressionStream
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    ;(window as Window & { releaseRetirementValidation?: () => void }).releaseRetirementValidation = release
    Object.defineProperty(window, 'DecompressionStream', { configurable: true, value: class {
      readable: ReadableStream<Uint8Array>
      writable: WritableStream<BufferSource>
      constructor(format: CompressionFormat) {
        const stream = new NativeDecompressionStream(format)
        this.writable = stream.writable
        this.readable = stream.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) { await ready; controller.enqueue(chunk) },
        }))
      }
    } })
  })
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(origin + companion + '?private=synthetic#transfer=' + encoded.token)
  const link = page.getByRole('link', { name: 'Open new app', exact: true })
  await expect(link).toHaveAttribute('aria-disabled', 'true')
  await expect(link).not.toHaveAttribute('href')
  await expect(page.getByText('Checking the incoming link locally before continuing…', { exact: true })).toBeVisible()
  await link.dispatchEvent('click')
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(origin + companion)
  await expect(link).not.toHaveAttribute('href')
  expect(requests.some((url) => new URL(url).origin !== origin)).toBe(false)
  await page.evaluate(() => (window as Window & { releaseRetirementValidation?: () => void }).releaseRetirementValidation!())
  await expect(link).toHaveAttribute('href', destination + '?migration=1#transfer=' + encoded.token)
  await expect(link).not.toHaveAttribute('aria-disabled')
  expect(await readStorage(page)).toEqual({})
  await expectNoStorageWrites(page)
})

test('same-document fragment navigation preserves transfers across paired browser events and clears them on plain history navigation', async ({ page }) => {
  const encoded = await encodeProgressTransfer(catalog, { ...emptyProfile(catalog.revision), epoch: 6 }, 'native')
  if (!encoded.ok) throw new Error(encoded.error)
  await seedReadOnlyStorage(page, {})
  for (const method of ['hash-assignment', 'same-document-link']) {
    await page.goto(origin + companion)
    const link = page.getByRole('link', { name: 'Open new app', exact: true })
    await expect(link).toHaveAttribute('href', plainDestination)
    await page.evaluate(({ token, method }) => {
      if (method === 'hash-assignment') location.hash = 'transfer=' + token
      else {
        const anchor = document.createElement('a')
        anchor.href = '#transfer=' + token
        document.body.append(anchor); anchor.click(); anchor.remove()
      }
    }, { token: encoded.token, method })
    await expect(page).toHaveURL(origin + companion)
    await expect(link).toHaveAttribute('href', destination + '?migration=1#transfer=' + encoded.token)
    await page.evaluate(() => { history.pushState({ retirementCheck: 'plain-navigation' }, '', location.pathname); history.back() })
    await expect(link).toHaveAttribute('href', plainDestination)
    expect(await readStorage(page)).toEqual({})
    await expectNoStorageWrites(page)
  }
})

test('missing documents disable exports without creating empty substitute files', async ({ page }) => {
  await seedReadOnlyStorage(page, {})
  await page.goto(origin + companion)
  await expectRetired(page)
  for (const name of exportLabels) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  await expect(page.getByText(/no saved/i).first()).toBeVisible()
  expect(await readStorage(page)).toEqual({})
  await expectNoStorageWrites(page)
})

test('legacy-only users export existing map JSON and normalized intentions without migration writes', async ({ page }) => {
  const profile = { ...emptyProfile(catalog.revision), epoch: 2 }
  profile.purchases[catalog.startId] = { epoch: 1, active: true }
  const documents = { [PROFILE_STORAGE_KEY]: JSON.stringify(profile), [GOALS_STORAGE_KEY]: JSON.stringify({ version: 1, targets: [{ id: catalog.startId, mode: 'rebuild' }] }) }
  await seedReadOnlyStorage(page, documents)
  await page.goto(origin + legacy)
  await expectRetired(page)
  const map = await exportedFile(page, page.getByRole('button', { name: 'Export Ascension map progress', exact: true }))
  const intentions = await exportedFile(page, page.getByRole('button', { name: 'Export intentions', exact: true }))
  expect(JSON.parse(map.toString())).toEqual(profile)
  expect(JSON.parse(intentions.toString())).toEqual({ ...emptyCompanionWorkspace(), goals: [{ ref: { system: 'ascension', id: catalog.startId }, mode: 'rebuild' }] })
  expect(await readStorage(page)).toEqual(documents)
  await expectNoStorageWrites(page)
})

test('invalid canonical progress blocks progress and comparison but preserves independent exports', async ({ page }) => {
  const checkpoints = { ...emptyCheckpoints(), entries: [{ id: 'separate-copy', name: 'Kept checkpoint', capturedRevision: catalog.revision, profile: emptyProfile(catalog.revision) }] }
  const intentions = { ...emptyCompanionWorkspace(), recipePlans: { 'future-recipe': '2' } }
  const documents = {
    [COMPANION_STORAGE_KEY]: 'invalid synthetic companion', [PROFILE_STORAGE_KEY]: JSON.stringify(emptyProfile(catalog.revision)),
    [COMPANION_WORKSPACE_KEY]: JSON.stringify(intentions), [CHECKPOINT_STORAGE_KEY]: JSON.stringify(checkpoints),
    [COMPARISON_STORAGE_KEY]: JSON.stringify({ ...emptyComparison(), ids: [catalog.startId] }),
  }
  await seedReadOnlyStorage(page, documents)
  await page.goto(origin + companion)
  await expect(page.getByRole('button', { name: 'Export Companion progress', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Export comparison', exact: true })).toBeDisabled()
  expect(JSON.parse((await exportedFile(page, page.getByRole('button', { name: 'Export intentions', exact: true }))).toString())).toEqual(intentions)
  expect(JSON.parse((await exportedFile(page, page.getByRole('button', { name: 'Export checkpoints', exact: true }))).toString())).toEqual(checkpoints)
  expect(await readStorage(page)).toEqual(documents)
  await expectNoStorageWrites(page)
})

test('conflicting legacy copies stay separate behind the recovery disclosure', async ({ page }) => {
  const progress = emptyCompanionProgress(catalog.revision)
  progress.ascension.epoch = 2
  const olderMap = { ...emptyProfile(catalog.revision), epoch: 4 }
  const intentions = { ...emptyCompanionWorkspace(), recipePlans: { 'future-recipe': '7' } }
  const goals = { version: 1, targets: [{ id: catalog.startId, mode: 'rebuild' }] }
  const documents = {
    [COMPANION_STORAGE_KEY]: storedProgress(progress),
    [PROFILE_STORAGE_KEY]: JSON.stringify(olderMap),
    [COMPANION_WORKSPACE_KEY]: JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, legacyBaseline: null, workspace: intentions }),
    [GOALS_STORAGE_KEY]: JSON.stringify(goals),
  }
  await seedReadOnlyStorage(page, documents)
  await page.goto(origin + companion)
  const recovery = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Other saved copies' }) })
  await expect(recovery).not.toHaveAttribute('open', '')
  await expect(page.getByRole('button', { name: 'Export legacy map copy', exact: true })).not.toBeVisible()
  expect(JSON.parse((await exportedFile(page, page.getByRole('button', { name: 'Export Companion progress', exact: true }))).toString())).toEqual(progress)
  expect(JSON.parse((await exportedFile(page, page.getByRole('button', { name: 'Export intentions', exact: true }))).toString())).toEqual(intentions)
  await recovery.locator('summary').click()
  const map = await exportedFile(page, recovery.getByRole('button', { name: 'Export legacy map copy', exact: true }))
  const alternateIntentions = await exportedFile(page, recovery.getByRole('button', { name: 'Export legacy intentions copy', exact: true }))
  expect(JSON.parse(map.toString())).toEqual(olderMap)
  expect(JSON.parse(alternateIntentions.toString())).toEqual({ ...emptyCompanionWorkspace(), goals: [{ ref: { system: 'ascension', id: catalog.startId }, mode: 'rebuild' }] })
  await expect(recovery.getByText(/including crafting plans/i)).toBeVisible()
  expect(await readStorage(page)).toEqual(documents)
  await expectNoStorageWrites(page)
})

test('blocked storage keeps the page and destination link usable', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException('Synthetic unavailable storage', 'SecurityError') } })
  await page.goto(origin + legacy)
  await expectRetired(page)
  for (const name of exportLabels) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  await expect(page.getByText(/could not|unavailable|cannot|blocked/i).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open new app', exact: true })).toHaveAttribute('href', plainDestination)
})

test('external changes refresh exports without reviving a removed canonical document', async ({ page, context }) => {
  const progress = emptyCompanionProgress(catalog.revision)
  await seedReadOnlyStorage(page, { [COMPANION_STORAGE_KEY]: storedProgress(progress), [PROFILE_STORAGE_KEY]: JSON.stringify({ ...emptyProfile(catalog.revision), epoch: 99 }) })
  await page.goto(origin + companion)
  await expect(page.getByRole('button', { name: 'Export Companion progress', exact: true })).toBeEnabled()
  const other = await context.newPage()
  await other.goto(origin + legacy)
  const next = { ...progress, ascension: { ...progress.ascension, epoch: 4 } }
  await other.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: COMPANION_STORAGE_KEY, text: storedProgress(next) })
  expect(JSON.parse((await exportedFile(page, page.getByRole('button', { name: 'Export Companion progress', exact: true }))).toString())).toEqual(next)
  await other.evaluate((key) => localStorage.removeItem(key), COMPANION_STORAGE_KEY)
  await expect(page.getByRole('button', { name: 'Export Companion progress', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Export Ascension map progress', exact: true })).toHaveCount(0)
  await expectNoStorageWrites(page)
  await other.close()
})

test('failed downloads retain saved bytes and transfer controls', async ({ page }) => {
  const documents = { [COMPANION_STORAGE_KEY]: storedProgress(emptyCompanionProgress(catalog.revision)) }
  await seedReadOnlyStorage(page, documents)
  await page.goto(origin + companion)
  await expect(page.getByRole('button', { name: 'Export Companion progress', exact: true })).toBeEnabled()
  await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('Synthetic blocked download') } })
  await page.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /download|export/i }).first()).toBeVisible()
  expect(await readStorage(page)).toEqual(documents)
  await expectNoStorageWrites(page)
  await expect(page.getByRole('link', { name: 'Open new app', exact: true })).toBeVisible()
})

test('narrow layouts with enlarged text retain keyboard export access', async ({ page }) => {
  await seedReadOnlyStorage(page, { [COMPANION_STORAGE_KEY]: storedProgress(emptyCompanionProgress(catalog.revision)) })
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto(origin + legacy)
  await expectRetired(page)
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const link = page.getByRole('link', { name: 'Open new app', exact: true }), action = page.getByRole('button', { name: 'Export Companion progress', exact: true })
  await link.focus()
  await expect(link).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(action).toBeFocused()
  const pending = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  await pending
  await expectNoStorageWrites(page)
})

test.describe('retirement offline releases', () => {
  test.use({ appServiceWorkers: true })

  test('both workers coexist and retain the transfer page and exports offline', async ({ page, context }) => {
    test.setTimeout(90000)
    const progress = emptyCompanionProgress(catalog.revision)
    progress.modules.material = { tracked: true, records: { 'future-material': { count: '12345678901234567890' } } }
    const documents = { [COMPANION_STORAGE_KEY]: storedProgress(progress) }
    await seedReadOnlyStorage(page, documents)
    for (const base of [companion, legacy]) {
      await page.goto(origin + base)
      await expectRetired(page)
      await expect.poll(() => page.evaluate(async (base) => Boolean((await navigator.serviceWorker.getRegistration(base))?.active), base), { timeout: 60000 }).toBe(true)
    }
    const cachesBefore = await page.evaluate(() => caches.keys())
    expect(cachesBefore.some((name) => name.startsWith('idle-slayer-companion-public-'))).toBe(true)
    expect(cachesBefore.some((name) => name.startsWith('idle-slayer-legacy-bridge-public-'))).toBe(true)
    await context.setOffline(true)
    for (const base of [legacy, companion]) {
      await page.goto(origin + base + 'ascension/index.html')
      await expectRetired(page)
      expect(JSON.parse((await exportedFile(page, page.getByRole('button', { name: 'Export Companion progress', exact: true }))).toString())).toEqual(progress)
      expect(await readStorage(page)).toEqual(documents)
      await expectNoStorageWrites(page)
    }
    expect((await page.evaluate(() => caches.keys())).sort()).toEqual(cachesBefore.sort())
  })

  test('an older controlled release delays activation until all old windows close', async ({ page, context }) => {
    test.setTimeout(120000)
    oldWorkerBase = companion
    try {
      await page.goto(origin + companion)
      await expect.poll(() => page.evaluate(async (base) => Boolean((await navigator.serviceWorker.getRegistration(base))?.active), companion), { timeout: 60000 }).toBe(true)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Previous cached release', exact: true })).toBeVisible()
      const secondOld = await context.newPage()
      await secondOld.goto(origin + companion + 'ascension/')
      await expect(secondOld.getByRole('heading', { name: 'Previous cached release', exact: true })).toBeVisible()
      const observer = await context.newPage()
      await observer.goto(origin + '/')
      await observer.evaluate(() => caches.open('unrelated-retirement-fixture'))
      oldWorkerBase = null
      await page.evaluate(async (base) => { await (await navigator.serviceWorker.getRegistration(base))!.update() }, companion)
      await expect.poll(() => observer.evaluate(async (base) => (await navigator.serviceWorker.getRegistration(base))?.waiting?.state, companion), { timeout: 60000 }).toBe('installed')
      await expect(page.getByRole('heading', { name: 'Previous cached release', exact: true })).toBeVisible()
      await page.close()
      await expect.poll(() => observer.evaluate(async (base) => (await navigator.serviceWorker.getRegistration(base))?.waiting?.state, companion)).toBe('installed')
      await expect(secondOld.getByRole('heading', { name: 'Previous cached release', exact: true })).toBeVisible()
      await secondOld.close()
      await expect.poll(() => observer.evaluate(async (base) => { const registration = await navigator.serviceWorker.getRegistration(base); return registration?.active?.state === 'activated' && registration.waiting === null }, companion), { timeout: 60000 }).toBe(true)
      expect(await observer.evaluate(() => caches.keys())).not.toContain(oldCache)
      expect(await observer.evaluate(() => caches.keys())).toContain('unrelated-retirement-fixture')
      const reopened = await context.newPage()
      await reopened.goto(origin + companion)
      await expectRetired(reopened)
      await context.setOffline(true)
      await reopened.goto(origin + companion + 'quests/')
      await expectRetired(reopened)
    } finally { oldWorkerBase = null }
  })
})

test('four retirement-page backups restore across origins through existing previews, cancellation and Undo', async ({ page, baseURL }) => {
  test.setTimeout(120000)
  if (!baseURL) throw new Error('A local website preview is required')
  expect(new URL(baseURL).origin).not.toBe(origin)
  const progress = emptyCompanionProgress(catalog.revision)
  progress.ascension.purchases[catalog.startId] = { epoch: 0, active: true }
  progress.modules.material = { tracked: true, records: { 'future-material': { count: '12345678901234567890' } } }
  const hidden = catalog.upgrades.find((node) => !visibility(catalog, progress.ascension).ids.has(node.id))!
  const intentions = { ...emptyCompanionWorkspace(), goals: [{ ref: { system: 'ascension' as const, id: catalog.startId }, mode: 'rebuild' as const }], recipePlans: { 'future-recipe': '3' } }
  const checkpoints = { ...emptyCheckpoints(), entries: [{ id: 'migration-checkpoint', name: 'Before move', capturedRevision: catalog.revision, profile: progress.ascension }] }
  const comparison = { ...emptyComparison(), ids: [catalog.startId, hidden.id, 'future-upgrade'] }
  const documents = { [COMPANION_STORAGE_KEY]: storedProgress(progress), [COMPANION_WORKSPACE_KEY]: JSON.stringify(intentions), [CHECKPOINT_STORAGE_KEY]: JSON.stringify(checkpoints), [COMPARISON_STORAGE_KEY]: JSON.stringify(comparison) }
  await seedReadOnlyStorage(page, documents)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(origin + companion)
  await expectRetired(page)
  const progressFile = await exportedFile(page, page.getByRole('button', { name: 'Export Companion progress', exact: true }))
  const intentionsFile = await exportedFile(page, page.getByRole('button', { name: 'Export intentions', exact: true }))
  const checkpointFile = await exportedFile(page, page.getByRole('button', { name: 'Export checkpoints', exact: true }))
  const comparisonFile = await exportedFile(page, page.getByRole('button', { name: 'Export comparison', exact: true }))
  expect(JSON.parse(progressFile.toString())).toEqual(progress)
  expect(JSON.parse(intentionsFile.toString())).toEqual(intentions)
  expect(JSON.parse(checkpointFile.toString())).toEqual(checkpoints)
  expect(JSON.parse(comparisonFile.toString()).ids).toEqual([catalog.startId, 'future-upgrade'])
  expect(await readStorage(page)).toEqual(documents)
  await expectNoStorageWrites(page)
  expect(requests.some((url) => /analytics\.garrod\.house|reports\.garrod\.house/.test(url))).toBe(false)

  const existing = emptyCompanionProgress(catalog.revision)
  existing.modules.material = { tracked: true, records: { 'existing-destination': { count: '9' } } }
  await page.addInitScript(({ targetOrigin, key, existing }) => { if (location.origin === targetOrigin && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: existing })) }, { targetOrigin: new URL(baseURL).origin, key: COMPANION_STORAGE_KEY, existing })
  await page.goto(baseURL + '?migration=1#analytics=off')
  const readProgress = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).progress, COMPANION_STORAGE_KEY)
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  await page.getByLabel('Restore Companion progress', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') })
  await expect(page.getByRole('region', { name: 'Review progress replacement', exact: true })).toHaveCount(0)
  expect(await readProgress()).toEqual(existing)
  await page.getByLabel('Restore Companion progress', { exact: true }).setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: progressFile })
  await expect(page.getByRole('region', { name: 'Review progress replacement', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await readProgress()).toEqual(existing)
  await page.getByLabel('Restore Companion progress', { exact: true }).setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: progressFile })
  await page.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect.poll(readProgress).toEqual(progress)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(readProgress).toEqual(existing)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(readProgress).toEqual(progress)
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  await page.getByLabel('Restore intentions', { exact: true }).setInputFiles({ name: 'intentions.json', mimeType: 'application/json', buffer: intentionsFile })
  await page.getByRole('button', { name: 'Replace intentions', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => { const raw = JSON.parse(localStorage.getItem(key)!); return raw.workspace ?? raw }, COMPANION_WORKSPACE_KEY)).toEqual(intentions)
  await page.goto(baseURL + 'ascension/')
  await (await openProgress(page)).getByRole('button', { name: 'Progress checkpoints…', exact: true }).click()
  await page.getByLabel('Progress checkpoints JSON backup', { exact: true }).setInputFiles({ name: 'checkpoints.json', mimeType: 'application/json', buffer: checkpointFile })
  await page.getByRole('button', { name: 'Replace checkpoint collection', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), CHECKPOINT_STORAGE_KEY)).toEqual(checkpoints)
  await page.goto(baseURL + 'ascension/')
  const restoredComparison = await openComparison(page)
  await restoredComparison.getByLabel('Upgrade comparison JSON backup', { exact: true }).setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: comparisonFile })
  await restoredComparison.getByRole('button', { name: 'Replace comparison', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).ids, COMPARISON_STORAGE_KEY)).toEqual([catalog.startId, 'future-upgrade'])
  await page.reload()
  await expect.poll(readProgress).toEqual(progress)
  expect((await readProgress()).ascension.showSpoilers).toBe(false)
  await page.goto(baseURL)
  await expect(page.getByRole('main', { name: 'Overview', exact: true })).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), ANALYTICS_PREFERENCE_KEY)).toBe('disabled')
  await expect(page.locator('#ascension-map-tracker, #ascension-map-recorder')).toHaveCount(0)
  await page.goto(origin + companion)
  expect(await readStorage(page)).toEqual(documents)
  await expectNoStorageWrites(page)
})
