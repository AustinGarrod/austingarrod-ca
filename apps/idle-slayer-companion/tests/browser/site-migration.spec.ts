import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from './fixtures'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { emptyCompanionProgress } from '../../src/domain/companion-progress'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { encodeProgressTransfer } from '../../src/domain/progress-transfer'
import { COMPANION_WORKSPACE_KEY, emptyCompanionWorkspace } from '../../src/domain/companion-workspace'
import { CHECKPOINT_STORAGE_KEY, emptyCheckpoints } from '../../src/domain/checkpoints'
import { COMPARISON_STORAGE_KEY, emptyComparison } from '../../src/domain/saved-comparison'
import { visibility } from '../../src/domain/rules'
import { openProgress } from './helpers/app'
import type { Locator, Page } from '@playwright/test'

test.use({ serviceWorkers: 'allow', appServiceWorkers: true })
const root = resolve('.cache/site-migration'), legacy = '/idle-slayer-ascension-map/', companion = '/idle-slayer-companion/'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const server = createServer((request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname)
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path))
    if (!file.startsWith(root + sep) || !statSync(file).isFile()) throw new Error()
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') || file.endsWith('.webmanifest') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(readFileSync(file))
  } catch { response.writeHead(404); response.end() }
})
let origin: string
test.beforeAll(async () => {
  readFileSync(resolve(root, legacy.slice(1), 'bridge.js')) // Generate with yarn prepare:migration first.
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(async () => { await new Promise<void>((done) => server.close(() => done())) })

test('old address forwards only reviewed public references and cleans arbitrary URL data', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(origin + legacy + '?private=synthetic-secret#upgrade=' + catalog.startId + '&catalog=' + catalog.revision)
  await expect(page).toHaveURL(origin + companion + 'ascension/')
  await expect(page.locator('.details h2')).toHaveText(catalog.upgrades.find((node) => node.id === catalog.startId)!.title)
  expect(requests.filter((url) => new URL(url).pathname.startsWith(companion)).every((url) => !url.includes('synthetic-secret'))).toBe(true)
  expect(requests.some((url) => url.includes('analytics.garrod.house'))).toBe(false)
})

test('old private map transfer reaches the existing confirmation flow without applying', async ({ page }) => {
  const profile = { ...emptyProfile(catalog.revision), epoch: 3 }
  const encoded = await encodeProgressTransfer(catalog, profile, 'native')
  if (!encoded.ok) throw new Error(encoded.error)
  await page.goto(origin + legacy + '#transfer=' + encoded.token)
  await expect(page.getByRole('dialog', { name: 'Transfer map progress', exact: true })).toBeVisible()
  await expect(page).toHaveURL(origin + companion + 'ascension/')
  expect(await page.evaluate((key) => localStorage.getItem(key), COMPANION_STORAGE_KEY)).toBeNull()
})

test('legacy and companion workers coexist; offline bridge reads and exports without writing', async ({ page, context }) => {
  test.setTimeout(90000)
  const progress = emptyCompanionProgress(catalog.revision)
  progress.ascension.purchases[catalog.startId] = { epoch: 0, active: true }
  progress.modules.material = { tracked: true, records: { 'future-material': { count: '12345678901234567890' } } }
  const stored = JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress })
  await page.addInitScript(({ key, stored }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, stored) }, { key: COMPANION_STORAGE_KEY, stored })
  await page.goto(origin + companion)
  await expect(page.getByRole('main', { name: 'Overview', exact: true })).toBeVisible()
  await page.goto(origin + legacy)
  await expect(page).toHaveURL(origin + companion)
  await expect.poll(() => page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const scopes = registrations.filter((registration) => registration.active).map((registration) => new URL(registration.scope).pathname)
    return scopes.sort()
  }), { timeout: 60000 }).toEqual([legacy, companion].sort())
  const cachesBefore = await page.evaluate(() => caches.keys())
  expect(cachesBefore.some((name) => name.startsWith('idle-slayer-companion-public-'))).toBe(true)
  expect(cachesBefore.some((name) => name.startsWith('idle-slayer-legacy-bridge-public-'))).toBe(true)
  await context.setOffline(true)
  await page.goto(origin + legacy)
  await expect(page.locator('#status')).toHaveText('You are offline. Your saved map and export remain available here.')
  await expect(page.locator('#map svg [role=button]').first()).toBeVisible()
  expect(await page.evaluate(({ key, old }) => [localStorage.getItem(key), localStorage.getItem(old)], { key: COMPANION_STORAGE_KEY, old: PROFILE_STORAGE_KEY })).toEqual([stored, null])
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export saved progress', exact: true }).click()
  const file = await (await pending).path()
  expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual(progress)
  expect((await page.evaluate(() => caches.keys())).sort()).toEqual(cachesBefore.sort())
})

test('invalid new storage never resurrects an old profile in the read-only bridge', async ({ page }) => {
  await page.addInitScript(({ key, old, profile }) => { Object.defineProperty(navigator, 'onLine', { get: () => false }); localStorage.setItem(key, 'invalid synthetic companion'); localStorage.setItem(old, JSON.stringify(profile)) }, { key: COMPANION_STORAGE_KEY, old: PROFILE_STORAGE_KEY, profile: emptyProfile(catalog.revision) })
  await page.goto(origin + legacy)
  await expect(page.locator('#status')).toContainText('Saved progress could not be safely read')
  await expect(page.getByRole('button', { name: 'Export saved progress', exact: true })).toBeDisabled()
  expect(await page.evaluate((key) => localStorage.getItem(key), COMPANION_STORAGE_KEY)).toBe('invalid synthetic companion')
})

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

test.describe('website progress migration', () => {
  test.use({ appServiceWorkers: false })

test('four guided JSON backups restore across origins without silently replacing destination state', async ({ page, baseURL }) => {
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
  const documents = {
    [COMPANION_STORAGE_KEY]: JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress }),
    [COMPANION_WORKSPACE_KEY]: JSON.stringify(intentions),
    [CHECKPOINT_STORAGE_KEY]: JSON.stringify(checkpoints),
    [COMPARISON_STORAGE_KEY]: JSON.stringify(comparison),
  }
  await page.addInitScript(({ oldOrigin, documents }) => { if (location.origin === oldOrigin) for (const [key, value] of Object.entries(documents)) if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, { oldOrigin: origin, documents })
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(origin + companion)
  const guide = page.getByRole('region', { name: 'Move Companion progress', exact: true })
  await expect(guide.getByRole('heading', { name: 'Idle Slayer Companion has moved', exact: true })).toBeVisible()
  await expect(guide.getByRole('link', { name: 'Open new utility', exact: true })).toHaveAttribute('href', 'https://austingarrod.ca/utilities/idle-slayer-companion/#analytics=off')
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  const progressFile = await exportedFile(page, page.getByRole('button', { name: 'Export Companion progress', exact: true }))
  const intentionsFile = await exportedFile(page, page.getByRole('button', { name: 'Export intentions', exact: true }))
  await page.goto(origin + companion + 'ascension/')
  await (await openProgress(page)).getByRole('button', { name: 'Progress checkpoints…', exact: true }).click()
  const checkpointFile = await exportedFile(page, page.getByRole('button', { name: 'Export checkpoints', exact: true }))
  await page.goto(origin + companion + 'ascension/')
  const comparisonFile = await exportedFile(page, (await openComparison(page)).getByRole('button', { name: 'Export comparison', exact: true }))
  expect(JSON.parse(progressFile.toString())).toEqual(progress)
  expect(JSON.parse(intentionsFile.toString())).toEqual(intentions)
  expect(JSON.parse(checkpointFile.toString())).toEqual(checkpoints)
  expect(JSON.parse(comparisonFile.toString()).ids).toEqual([catalog.startId, 'future-upgrade'])
  expect(requests.some((url) => /analytics\.garrod\.house|reports\.garrod\.house/.test(url))).toBe(false)

  const existing = emptyCompanionProgress(catalog.revision)
  existing.modules.material = { tracked: true, records: { 'existing-destination': { count: '9' } } }
  await page.addInitScript(({ targetOrigin, key, existing }) => { if (location.origin === targetOrigin && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: existing })) }, { targetOrigin: new URL(baseURL).origin, key: COMPANION_STORAGE_KEY, existing })
  await page.goto(baseURL + '#analytics=off')
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
  await page.goto(origin + companion)
  expect(await readProgress()).toEqual(progress)
})

test('old section bookmarks retain guidance and forwarding discards unknown fields', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(origin + legacy + 'crafting/?secret=synthetic#arbitrary=private')
  await expect(page).toHaveURL(origin + companion + 'crafting/')
  await expect(page.getByRole('heading', { name: 'Idle Slayer Companion has moved', exact: true })).toBeVisible()
  await expect(page.getByRole('main', { name: 'Crafting & materials', exact: true })).toBeVisible()
  expect(requests.filter((url) => new URL(url).pathname.startsWith(companion)).every((url) => !url.includes('synthetic') && !url.includes('private'))).toBe(true)
  expect(requests.some((url) => /analytics\.garrod\.house|reports\.garrod\.house/.test(url))).toBe(false)
})

})
