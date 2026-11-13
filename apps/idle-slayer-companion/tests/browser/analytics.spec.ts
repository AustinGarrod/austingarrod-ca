import { openAction, openProgress } from './helpers/app'
import { expect, test } from './fixtures'
import type { BrowserContext, Page, Request } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'
import { build as buildVite } from 'vite'
import react from '@vitejs/plugin-react'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'
import { encodeGameSaveFixture, nativeSaveFixture } from '../fixtures/game-save'
import { encodeProgressTransfer, progressTransferLink } from '../../src/domain/progress-transfer'
import { CHECKPOINT_STORAGE_KEY, emptyCheckpoints, exportCheckpoints } from '../../src/domain/checkpoints'

const fixtureRoot = 'tests/fixtures/umami-3.4.0'
const provenance = JSON.parse(readFileSync(`${fixtureRoot}/provenance.json`, 'utf8')) as { artifacts: Record<string, string> }
const officialScripts = Object.fromEntries(['script.js', 'recorder.js'].map((name) => {
  const bytes = readFileSync(`${fixtureRoot}/${name}`)
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.artifacts[name]) throw new Error(`Unreviewed Umami fixture: ${name}`)
  return [name, bytes.toString('utf8')]
}))
const websiteId = '11111111-2222-4333-8444-555555555555'
const preferenceKey = 'idle-slayer-ascension-map.analytics.v1'
const comparisonKey = 'idle-slayer-ascension-map.comparison.v1'
const profileKey = 'idle-slayer-ascension-map.profile.v1'
const fixturePath = '/__analytics-fixture/'
const appFixturePath = '/__analytics-app/'
const appMapPath = appFixturePath + 'ascension/'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const visible = visibility(catalog, initial)
const firstUpgrade = catalog.upgrades.find((upgrade) => upgrade.id === catalog.startId)!
const secrets = {
  query: 'SENTINEL-private-search-20498',
  url: 'SENTINEL-private-url-86572',
  file: 'SENTINEL-private-filename-31094.sav',
  native: 'SENTINEL-native-account-48027@example.invalid',
  unknown: 'SENTINEL-unknown-profile-id-58162',
  blocked: 'SENTINEL-blocked-widget-69317',
  error: 'SENTINEL-runtime-error-73421',
}
const publicMarker = 'PUBLIC-replay-proof-42816'
let harnessPromise: Promise<string> | undefined
let applicationPromise: Promise<Map<string, { body: Buffer | string; contentType: string }>> | undefined

test('every Companion tracking page stays blocked in real snapshots and navigation mutations', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  await page.goto(`${origin}${appFixturePath}achievements/`)
  const markers: string[] = []
  await expect(page.locator('.companion-page')).toBeVisible()
  await page.evaluate(() => {
    const button = document.createElement('button'); button.id = 'companion-public-replay-proof'; button.textContent = 'COMPANION_PUBLIC_SNAPSHOT'; document.body.appendChild(button)
  })
  const addPrivateMarker = async (name: string) => {
    const marker = `COMPANION_PRIVATE_${name}_67291384`; markers.push(marker)
    await page.locator('.companion-page').evaluate((element, value) => { const node = document.createElement('p'); node.textContent = value; element.appendChild(node) }, marker)
    const search = page.locator('.companion-page').getByRole('searchbox')
    if (await search.count()) await search.fill(marker)
  }
  await addPrivateMarker('achievement-records-and-counter')
  await waitForActive(page); releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes('COMPANION_PUBLIC_SNAPSHOT')))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('companion-page') && !node.childNodes?.length)).toBe(true)
  for (const [name, label] of [['crafting-plans-and-inventory', 'Crafting & materials'], ['quest-and-village-progress', 'Quests & Village'], ['bestiary-kills', 'Bestiary'], ['divinity-selections', 'Divinities'], ['overview-goals', 'Overview']] as const) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true })
    if (await menu.isVisible()) await menu.click()
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('.companion-page')).toBeVisible()
    await addPrivateMarker(name)
    await page.locator('#companion-public-replay-proof').evaluate((element, value) => { element.textContent = value }, `COMPANION_PUBLIC_${name}`)
    await page.locator('#companion-public-replay-proof').click()
  }
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 3 && JSON.stringify(event).includes('COMPANION_PUBLIC_overview-goals')))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const marker of markers) expect(evidence.includes(marker), 'Companion records or plans leaked into telemetry').toBe(false)
  expect(blockedReplayNodes(events).filter((node) => node.attributes.class.includes('companion-page')).every((node) => !node.childNodes?.length)).toBe(true)
  expect(capture.unexpected).toEqual([])
})

test('saved comparison contents stay blocked in real recorder snapshots and mutations without new event payloads', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  const privateQuery = 'PRIVATE_COMPARISON_QUERY_87654', privateSnapshot = 'PRIVATE_COMPARISON_SNAPSHOT_87654', privateMutation = 'PRIVATE_COMPARISON_MUTATION_87654'
  const unknown = 'PRIVATE_COMPARISON_UNAVAILABLE_87654', publicSnapshot = 'PUBLIC_COMPARISON_SNAPSHOT_87654', publicMutation = 'PUBLIC_COMPARISON_MUTATION_87654'
  await page.addInitScript(({ key, ids }) => localStorage.setItem(key, JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids })), { key: comparisonKey, ids: [catalog.startId, unknown] })
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  const mobile = page.getByRole('button', { name: 'Map options', exact: true })
  await (await mobile.isVisible() ? mobile : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('button', { name: 'Saved upgrade comparison…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Saved upgrade comparison', exact: true })
  await expect(dialog.locator('.saved-comparison')).toHaveClass(/telemetry-private rr-block/)
  await page.evaluate(({ publicSnapshot, privateSnapshot }) => {
    const node = document.createElement('p'); node.id = 'comparison-public-proof'; node.textContent = publicSnapshot
    document.querySelector('dialog[open]')!.appendChild(node)
    const privateNode = document.createElement('p'); privateNode.id = 'comparison-private-proof'; privateNode.textContent = privateSnapshot
    document.querySelector('.saved-comparison')!.appendChild(privateNode)
  }, { publicSnapshot, privateSnapshot })
  await waitForActive(page); releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(publicSnapshot)))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('saved-comparison') && !node.childNodes?.length)).toBe(true)
  await dialog.locator('.saved-comparison-picker summary').click()
  await dialog.getByRole('searchbox', { name: 'Find a visible upgrade', exact: true }).fill(privateQuery)
  await page.locator('#comparison-private-proof').evaluate((node, marker) => { node.textContent = marker }, privateMutation)
  await page.locator('#comparison-public-proof').evaluate((node, marker) => { node.textContent = marker }, publicMutation)
  await page.locator('#comparison-public-proof').click()
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 3 && JSON.stringify(event).includes(publicMutation)))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const marker of [privateQuery, privateSnapshot, privateMutation, unknown]) expect(evidence).not.toContain(marker)
  await dialog.locator(`article[data-upgrade-id="${catalog.startId}"]`).getByRole('button', { name: 'Show on map', exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(firstUpgrade.title)
  expect(capture.submissions.filter((submission) => submission.type === 'event' && submission.payload.name === 'upgrade_selected')).toHaveLength(0)
  expect(capture.submissions.filter((submission) => submission.type === 'event').some((submission) => /comparison/.test(JSON.stringify(submission.payload)))).toBe(false)
  expect(capture.unexpected).toEqual([])
})

function applicationAssets() {
  applicationPromise ??= (async () => {
    const adapter = resolve('tests/fixtures/analytics-app-adapter.ts')
    const actualAnalytics = resolve('src/analytics.ts')
    const result = await buildVite({
      configFile: false, base: appFixturePath, publicDir: false, logLevel: 'silent',
      plugins: [{
        name: 'isolated-test-analytics-imports', enforce: 'pre',
        resolveId(source, importer) {
          if (!importer || resolve(importer) === adapter || !source.startsWith('.')) return null
          const path = resolve(dirname(importer), source)
          return [actualAnalytics, actualAnalytics.slice(0, -3)].includes(path) ? adapter : null
        },
      }, react()],
      build: { write: false, minify: false },
    })
    const output = Array.isArray(result) ? result[0] : result
    if (!('output' in output)) throw new Error('Isolated application produced no bundle')
    return new Map(output.output.map((item) => [item.fileName, {
      body: item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source),
      contentType: item.fileName.endsWith('.html') ? 'text/html' : item.fileName.endsWith('.css') ? 'text/css' : item.fileName.endsWith('.js') ? 'application/javascript' : 'application/octet-stream',
    }]))
  })()
  return applicationPromise
}

async function serveIsolatedApplication(context: BrowserContext, origin: string) {
  const assets = await applicationAssets()
  const publicDirectory = resolve('public')
  await context.route(`${origin}${appFixturePath}**`, async (route) => {
    const requested = new URL(route.request().url()).pathname.slice(appFixturePath.length)
    const path = !requested || /^(?:ascension|achievements|crafting|quests|bestiary|divinities)\/(?:index\.html)?$/.test(requested) ? 'index.html' : requested
    const asset = assets.get(path)
    if (asset) { await route.fulfill(asset); return }
    const file = resolve(publicDirectory, path)
    if (!file.startsWith(`${publicDirectory}${sep}`) || !existsSync(file) || !/\.(?:json|png)$/.test(file)) throw new Error(`Unexpected isolated app asset: ${path}`)
    await route.fulfill({ body: readFileSync(file), contentType: file.endsWith('.json') ? 'application/json' : 'image/png' })
  })
}

function harnessSource() {
  harnessPromise ??= (async () => {
    const result = await buildVite({
      configFile: false,
      logLevel: 'silent',
      build: { write: false, minify: false, target: 'es2022', lib: { entry: resolve('tests/fixtures/analytics-harness.ts'), name: 'AnalyticsFixture', formats: ['iife'] } },
    })
    const output = Array.isArray(result) ? result[0] : result
    if (!('output' in output)) throw new Error('Analytics harness produced no browser bundle')
    const chunks = output.output.filter((item) => item.type === 'chunk')
    if (chunks.length !== 1) throw new Error('Analytics harness must remain one isolated browser bundle')
    return chunks[0].code
  })()
  return harnessPromise
}

type Submission = { type: string; payload: Record<string, unknown> }
type ReplayEvent = { type: number | string; timestamp?: number; data?: Record<string, unknown> }
type Capture = { submissions: Submission[]; scriptRequests: string[]; unexpected: string[] }

function parseSubmission(request: Request): Submission {
  let bytes = request.postDataBuffer()
  if (!bytes) throw new Error('Telemetry request did not contain an inspectable body')
  const encoding = request.headers()['content-encoding']
  if (encoding === 'gzip' || (bytes[0] === 0x1f && bytes[1] === 0x8b)) bytes = gunzipSync(bytes)
  else if (encoding === 'deflate') bytes = inflateSync(bytes)
  else if (encoding === 'br') bytes = brotliDecompressSync(bytes)
  else if (encoding && encoding !== 'identity') throw new Error(`Uninspected telemetry encoding: ${encoding}`)
  const value = JSON.parse(bytes.toString('utf8')) as Submission
  if (!value || typeof value.type !== 'string' || !value.payload || typeof value.payload !== 'object') throw new Error('Uninspected telemetry payload shape')
  return value
}

class IncompleteReplayError extends Error {}

function replayEvents(capture: Capture): ReplayEvent[] {
  const events: ReplayEvent[] = []
  const fragments = new Map<string, { total: number; parts: Map<number, string> }>()
  for (const submission of capture.submissions.filter((item) => item.type === 'record')) {
    if (!Array.isArray(submission.payload.events)) throw new Error('Uninspected recorder event encoding')
    for (const event of submission.payload.events as ReplayEvent[]) {
      if (event.type !== 'umami:rrweb-event-fragment') { events.push(event); continue }
      const fragment = event.data
      if (!fragment || typeof fragment.id !== 'string' || !Number.isInteger(fragment.index) || !Number.isInteger(fragment.total) || typeof fragment.value !== 'string') throw new Error('Uninspected recorder fragment')
      const group = fragments.get(fragment.id) ?? { total: fragment.total as number, parts: new Map<number, string>() }
      if (group.total !== fragment.total) throw new Error('Recorder fragment count changed')
      group.parts.set(fragment.index as number, fragment.value)
      fragments.set(fragment.id, group)
    }
  }
  for (const group of fragments.values()) {
    if (group.parts.size !== group.total) throw new IncompleteReplayError('Incomplete recorder event; privacy assertion would be inconclusive')
    const parts = Array.from({ length: group.total }, (_, index) => {
      const part = group.parts.get(index)
      if (part === undefined) throw new Error('Missing recorder event fragment')
      return part
    })
    events.push(JSON.parse(parts.join('')) as ReplayEvent)
  }
  return events
}

async function waitForReplayEvents(capture: Capture, ready: (events: ReplayEvent[]) => boolean): Promise<ReplayEvent[]> {
  let completed: ReplayEvent[] = []
  await expect.poll(() => {
    try {
      const events = replayEvents(capture)
      if (!ready(events)) return false
      completed = events
      return true
    } catch (error) {
      // One rrweb event can span sequential HTTP submissions. Await the rest
      // before reconstruction; malformed or inconsistent evidence still fails.
      if (error instanceof IncompleteReplayError) return false
      throw error
    }
  }, { timeout: 15_000, message: 'Recorder evidence must arrive with every fragment before privacy assertions' }).toBe(true)
  return completed
}

function blockedReplayNodes(value: unknown): { tagName: string; attributes: Record<string, string>; childNodes?: unknown[] }[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(blockedReplayNodes)
  const record = value as { tagName?: string; attributes?: Record<string, string>; childNodes?: unknown[] }
  const here = record.tagName && record.attributes?.class?.includes('telemetry-private') ? [record as { tagName: string; attributes: Record<string, string>; childNodes?: unknown[] }] : []
  return [...here, ...Object.values(value).flatMap(blockedReplayNodes)]
}

async function installLocalRoutes(context: BrowserContext, origin: string, options: { trackerFailure?: boolean; trackerBody?: string; recorderBody?: string; recorderReady?: Promise<void> } = {}): Promise<Capture> {
  const capture: Capture = { submissions: [], scriptRequests: [], unexpected: [] }
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) { capture.unexpected.push(request.url()); await route.abort(); return }
    if (url.pathname === '/script.js' || url.pathname === '/recorder.js') {
      capture.scriptRequests.push(url.pathname)
      if (url.pathname === '/script.js' && options.trackerFailure) { await route.abort(); return }
      await route.fulfill({ contentType: 'application/javascript', body: url.pathname === '/script.js' ? options.trackerBody ?? officialScripts['script.js'] : options.recorderBody ?? officialScripts['recorder.js'] })
      return
    }
    if (url.pathname === `/api/websites/${websiteId}/recorder`) {
      if (options.recorderReady) await options.recorderReady
      await route.fulfill({ json: { enabled: true, replayEnabled: true, heatmapEnabled: true, sampleRate: 1, heatmapSampleRate: 1, maskLevel: 'moderate', maxDuration: 1_200_000, blockSelector: '.telemetry-private' } })
      return
    }
    if (url.pathname === '/api/send' || url.pathname === '/api/record') {
      if (request.method() !== 'POST') { capture.unexpected.push(request.url()); await route.abort(); return }
      capture.submissions.push(parseSubmission(request))
      await route.fulfill({ json: { cache: 'synthetic-local-session-cache' } })
      return
    }
    if (url.pathname.startsWith('/api/')) { capture.unexpected.push(request.url()); await route.abort(); return }
    if (url.pathname === fixturePath || url.pathname === `${fixturePath}index.html`) {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Local analytics proof</title></head><body><button id="public-action">Local public action</button><input id="private-input" aria-label="Masked fixture input"><div class="telemetry-private rr-block">Private fixture region</div></body></html>' })
      return
    }
    await route.continue()
  })
  return capture
}

async function injectHarness(page: Page, options?: Record<string, unknown>) {
  if (options) await page.evaluate((value) => Object.assign(window, { analyticsTestOptions: value }), options)
  await page.addScriptTag({ content: await harnessSource() })
}

async function initializeHarness(page: Page) {
  await page.evaluate(({ version, revision, upgradeIds, milestoneIds }) => {
    const controller = (window as unknown as { analyticsHarness: {
      updateAnalyticsContext: (context: unknown) => void; initializeAnalytics: () => void; trackEvent: (name: string, data?: Record<string, unknown>) => void
    } }).analyticsHarness
    controller.updateAnalyticsContext({ catalog_version: version, catalog_revision: revision, layout: 'web', spoilers: false, visibleUpgradeIds: new Set(upgradeIds), visibleMilestoneIds: new Set(milestoneIds) })
    controller.initializeAnalytics()
    controller.initializeAnalytics()
    controller.trackEvent('app_ready')
  }, { version: catalog.gameVersion, revision: catalog.revision, upgradeIds: [...visible.ids], milestoneIds: visible.milestones.map((item) => item.id) })
}

async function waitForActive(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean } } }).analyticsHarness.getTrackingStatus().active)).toBe(true)
}

async function chooseCompanionSave(page: Page, options: Parameters<typeof nativeSaveFixture>[0] = {}) {
  await page.getByRole('button', { name: 'Import save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import game save', exact: true })
  await dialog.getByLabel('Choose game save', { exact: true }).setInputFiles({ name: secrets.file, mimeType: 'application/octet-stream', buffer: Buffer.from(encodeGameSaveFixture(nativeSaveFixture(options))) })
  await expect(dialog.getByRole('button', { name: 'Apply snapshot', exact: true })).toBeVisible()
  return dialog
}

test('local production preview stays untracked and has usable privacy controls', async ({ page, context, baseURL }) => {
  const capture = await installLocalRoutes(context, new URL(baseURL!).origin)
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await openAction(page, 'Privacy & tracking')
  await expect(page.getByRole('dialog', { name: 'Privacy & tracking', exact: true })).toBeVisible()
  expect(capture.scriptRequests).toEqual([])
  expect(capture.submissions).toEqual([])
  expect(capture.unexpected).toEqual([])
})

test('isolated loader loads each official script once and strips URL secrets before recording', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await page.goto(`${origin}${fixturePath}?private=${secrets.url}&utm_source=local-proof#${secrets.url}`)
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  await expect.poll(() => capture.submissions.some((item) => item.type === 'record')).toBe(true)
  expect(page.url()).toBe(`${origin}${fixturePath}`)
  expect(capture.scriptRequests.filter((path) => path === '/script.js')).toHaveLength(1)
  expect(capture.scriptRequests.filter((path) => path === '/recorder.js')).toHaveLength(1)
  const named = capture.submissions.filter((item) => item.type === 'event' && item.payload.name === 'app_ready')
  expect(named).toHaveLength(1)
  expect(named[0].payload.url).toBe(`${origin}${fixturePath}?utm_source=local-proof`)
  expect(capture.submissions.every((item) => item.payload.website === websiteId)).toBe(true)
  expect(JSON.stringify(capture.submissions)).not.toContain(secrets.url)
  expect(capture.unexpected).toEqual([])
})

for (const navigation of ['fragment', 'pushState', 'replaceState', 'history-traversal'] as const) {
  test(`session URL privacy covers ${navigation} with the real recorder and heatmaps`, async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const capture = await installLocalRoutes(context, origin)
    const marker = 'SESSION_URL_SECRET'
    await page.goto(`${origin}${fixturePath}`)
    if (navigation === 'history-traversal') await page.evaluate(({ marker, path }) => {
      history.replaceState({ visit: 'previous' }, '', `${path}?private=${marker}#${marker}`)
      history.pushState({ visit: 'current' }, '', path)
    }, { marker, path: fixturePath })
    await injectHarness(page)
    await initializeHarness(page)
    await waitForActive(page)
    await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
    await page.evaluate(async ({ navigation, marker, path }) => {
      if (navigation === 'fragment') location.hash = marker
      else if (navigation === 'history-traversal') {
        const traverse = (move: () => void) => new Promise<void>((resolve) => {
          addEventListener('popstate', () => resolve(), { once: true })
          move()
        })
        await traverse(() => history.back())
        if (history.state.visit !== 'previous') throw new Error('Back navigation lost history state')
        await traverse(() => history.forward())
        if (history.state.visit !== 'current') throw new Error('Forward navigation lost history state')
      } else history[navigation]({ preserve: navigation }, '', `${path}?private=${marker}#${marker}`)
    }, { navigation, marker, path: fixturePath })
    await page.locator('#public-action').click()
    const exposedLiveURL = navigation === 'fragment' || navigation === 'history-traversal'
    if (exposedLiveURL) await page.waitForTimeout(6000)
    const events = await waitForReplayEvents(capture, (events) => exposedLiveURL
      ? events.some((event) => event.type === 2)
      : events.some((event) => event.type === 3 && event.data?.source === 2)
        && capture.submissions.some((item) => item.type === 'heatmap' && Array.isArray(item.payload.events)
          && item.payload.events.some((event: { type: string }) => event.type === 'click')))
    expect(JSON.stringify({ submissions: capture.submissions, replay: events }).includes(marker), 'A same-document URL marker leaked into telemetry').toBe(false)
    expect(page.url()).toBe(`${origin}${fixturePath}`)
    if (navigation === 'pushState' || navigation === 'replaceState') expect(await page.evaluate(() => history.state)).toEqual({ preserve: navigation })
    expect(await page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean } } }).analyticsHarness.getTrackingStatus().active)).toBe(!exposedLiveURL)
    expect(capture.unexpected).toEqual([])
  })
}

test('dirty fragment changes during a trusted click never upload or resume their buffered recording', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  const marker = 'SYNCHRONOUS_URL_SECRET'
  await page.goto(`${origin}${fixturePath}`)
  await page.evaluate((marker) => {
    document.addEventListener('click', () => {
      location.hash = marker
      const win = window as Window & { umami?: { getSession?: () => { cache?: string } }; synchronousURLProof?: { cacheAvailable: boolean; dirtyAddress: boolean } }
      win.synchronousURLProof = { cacheAvailable: Boolean(win.umami?.getSession?.().cache), dirtyAddress: location.href.includes(marker) }
    }, { capture: true, once: true })
  }, marker)
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
  await page.locator('#public-action').click()
  expect(await page.evaluate(() => (window as Window & { synchronousURLProof?: { cacheAvailable: boolean; dirtyAddress: boolean } }).synchronousURLProof)).toEqual({ cacheAvailable: false, dirtyAddress: false })
  await page.waitForTimeout(6000)
  expect(JSON.stringify({ submissions: capture.submissions, replay: replayEvents(capture) }).includes(marker), 'A synchronous click URL leaked from the recorder buffer').toBe(false)
  const stoppedAt = capture.submissions.length
  await page.evaluate(async () => {
    const traverse = (move: () => void) => new Promise<void>((resolve) => {
      addEventListener('popstate', () => resolve(), { once: true })
      move()
    })
    await traverse(() => history.back())
    await traverse(() => history.forward())
  })
  await page.locator('#public-action').click()
  await page.waitForTimeout(6000)
  expect(capture.submissions).toHaveLength(stoppedAt)
  expect(await page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean; reason: string } } }).analyticsHarness.getTrackingStatus())).toMatchObject({ active: false, reason: 'reload-required' })
  expect(page.url()).toBe(`${origin}${fixturePath}`)
  await page.reload()
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  await waitForReplayEvents(capture, (events) => capture.submissions.length > stoppedAt && events.some((event) => event.type === 2))
  expect(JSON.stringify({ submissions: capture.submissions, replay: replayEvents(capture) }).includes(marker)).toBe(false)
  expect(capture.unexpected).toEqual([])
})

test('a later same-click history replacement cannot hide a dirty buffered URL', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  const marker = 'BUFFERED_CLICK_URL_SECRET'
  await page.goto(`${origin}${fixturePath}`)
  await page.evaluate(({ marker, path }) => {
    // The recorder's document capture listener runs between these handlers.
    // The bubble handler deliberately never calls getSession to intervene.
    document.addEventListener('click', () => { location.hash = marker }, { capture: true, once: true })
    document.addEventListener('click', () => { history.replaceState({ cleaned: true }, '', path) }, { once: true })
  }, { marker, path: fixturePath })
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
  await page.locator('#public-action').click()
  await page.waitForTimeout(6000)
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
  expect(JSON.stringify({ submissions: capture.submissions, replay: events }).includes(marker), 'A dirty URL hidden by a same-click history replacement leaked').toBe(false)
  expect(await page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean; reason: string } } }).analyticsHarness.getTrackingStatus())).toMatchObject({ active: false, reason: 'reload-required' })
  expect(page.url()).toBe(`${origin}${fixturePath}`)
  expect(await page.evaluate(() => history.state)).toEqual({ cleaned: true })
  expect(capture.unexpected).toEqual([])
})

test('session URL guards preserve native history failures, state and a later opt-out marker', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await page.goto(`${origin}${fixturePath}`)
  await page.evaluate(() => history.replaceState({ preserved: 'initial' }, '', location.href))
  const nativeMalformedURL = await page.evaluate(() => {
    try { history.pushState({}, '', 'http://['); return 'none' } catch (error) { return (error as Error).name }
  })
  expect(nativeMalformedURL).toBe('SecurityError')
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  const nativeFailures = await page.evaluate(() => {
    const length = history.length
    const failures = [
      () => history.pushState({}, '', 'https://other.invalid/private'),
      () => history.replaceState({ invalid: () => undefined }, '', location.href),
      () => Reflect.apply(history.pushState, history, []),
      () => history.pushState({}, '', 'http://['),
    ].map((operation) => {
      try { operation(); return 'none' } catch (error) { return (error as Error).name }
    })
    return { failures, lengthPreserved: history.length === length, state: history.state }
  })
  expect(nativeFailures).toEqual({ failures: ['SecurityError', 'DataCloneError', 'TypeError', nativeMalformedURL], lengthPreserved: true, state: { preserved: 'initial' } })
  await page.evaluate(() => { location.hash = 'analytics=off' })
  await expect.poll(() => page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean; reason: string } } }).analyticsHarness.getTrackingStatus())).toMatchObject({ active: false, reason: 'opt-out' })
  expect(page.url()).toBe(`${origin}${fixturePath}#analytics=off`)
  // Native fragment navigation creates a fresh history entry without state.
  expect(await page.evaluate(() => history.state)).toBeNull()
  await page.evaluate((path) => history.replaceState({ preserved: 'later' }, '', path), fixturePath)
  expect(await page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { enabled: boolean; active: boolean; reason: string } } }).analyticsHarness.getTrackingStatus())).toMatchObject({ enabled: false, active: false, reason: 'reload-required' })
  expect(await page.evaluate(() => history.state)).toEqual({ preserved: 'later' })
  expect(capture.unexpected).toEqual([])
})

test('initial opt-out, privacy signals, unreadable preference, and origin gates load no scripts', async ({ browser, baseURL }) => {
  const origin = new URL(baseURL!).origin
  for (const scenario of ['stored-off', 'url-off', 'storage-unavailable', 'dnt', 'gpc', 'development', 'wrong-host', 'wrong-path']) {
    const context = await browser.newContext()
    const capture = await installLocalRoutes(context, origin)
    const page = await context.newPage()
    await page.addInitScript(({ key, scenario }) => {
      if (scenario === 'stored-off') localStorage.setItem(key, 'disabled')
      if (scenario === 'storage-unavailable') Storage.prototype.getItem = () => { throw new Error('Synthetic inaccessible storage') }
      if (scenario === 'dnt') Object.defineProperty(navigator, 'doNotTrack', { value: '1' })
      if (scenario === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { value: true })
    }, { key: preferenceKey, scenario })
    await page.goto(`${origin}${fixturePath}${scenario === 'url-off' ? '#analytics=off' : ''}`)
    await injectHarness(page, scenario === 'development' ? { production: false } : scenario === 'wrong-host' ? { hostname: 'unsupported.invalid' } : scenario === 'wrong-path' ? { basePath: '/unsupported/' } : undefined)
    await initializeHarness(page)
    const status = await page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { enabled: boolean } } }).analyticsHarness.getTrackingStatus())
    expect(status.enabled, scenario).toBe(false)
    expect(capture.scriptRequests, scenario).toEqual([])
    expect(capture.submissions, scenario).toEqual([])
    expect(capture.unexpected, scenario).toEqual([])
    await context.close()
  }
})

test('iframe gate blocks loader in an actual embedded document', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await page.goto(`${origin}${fixturePath}`)
  await page.evaluate((src) => { const iframe = document.createElement('iframe'); iframe.src = src; document.body.appendChild(iframe) }, `${origin}${fixturePath}`)
  await expect.poll(() => page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url() === `${origin}${fixturePath}`)?.url()).toBe(`${origin}${fixturePath}`)
  const embedded = page.frames().find((candidate) => candidate !== page.mainFrame())!
  await embedded.addScriptTag({ content: await harnessSource() })
  const status = await embedded.evaluate(() => {
    const controller = (window as unknown as { analyticsHarness: { initializeAnalytics: () => void; getTrackingStatus: () => { reason: string } } }).analyticsHarness
    controller.initializeAnalytics()
    return controller.getTrackingStatus()
  })
  expect(status.reason).toBe('embedded')
  expect(capture.scriptRequests).toEqual([])
  expect(capture.submissions).toEqual([])
  expect(capture.unexpected).toEqual([])
})

test('opt-out stops recorder sends and reload never restarts scripts', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await page.addInitScript(() => Object.assign(window, { analyticsDocumentInstance: Math.random().toString() }))
  await page.goto(`${origin}${fixturePath}`)
  const initialDocument = await page.evaluate(() => (window as unknown as { analyticsDocumentInstance: string }).analyticsDocumentInstance)
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  await expect.poll(() => capture.submissions.some((item) => item.type === 'record')).toBe(true)
  const reloadURL = await page.evaluate(() => (window as unknown as { analyticsHarness: { setTrackingPreference: (enabled: boolean) => { reloadURL: string } } }).analyticsHarness.setTrackingPreference(false).reloadURL)
  await Promise.all([page.waitForEvent('load'), page.evaluate((url) => {
    history.replaceState(history.state, '', url)
    location.reload()
  }, reloadURL)])
  expect(await page.evaluate(() => (window as unknown as { analyticsDocumentInstance: string }).analyticsDocumentInstance)).not.toBe(initialDocument)
  capture.scriptRequests.length = 0
  const afterReload = capture.submissions.length
  await injectHarness(page)
  await initializeHarness(page)
  await page.locator('#public-action').click()
  expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe('disabled')
  expect(capture.scriptRequests).toEqual([])
  expect(capture.submissions).toHaveLength(afterReload)
  expect(capture.unexpected).toEqual([])
})

test('offline activity is never uploaded after reconnection and fresh online reload can resume tracking', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await page.goto(`${origin}${fixturePath}`); await injectHarness(page); await initializeHarness(page); await waitForActive(page)
  await expect.poll(() => capture.submissions.some((item) => item.type === 'record')).toBe(true)
  const preference = await page.evaluate((key) => localStorage.getItem(key), preferenceKey)
  const marker = 'SENTINEL-offline-period-replay-95623'
  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean; reason: string } } }).analyticsHarness.getTrackingStatus())).toMatchObject({ active: false, reason: 'reload-required' })
  await page.evaluate((marker) => {
    const node = document.createElement('p'); node.id = 'offline-proof'; node.textContent = marker; document.body.appendChild(node)
    ;(window as unknown as { analyticsHarness: { trackEvent: (name: string) => void } }).analyticsHarness.trackEvent('backup_download_requested')
  }, marker)
  await context.setOffline(false)
  await page.locator('#public-action').click()
  await page.waitForTimeout(6000)
  expect(JSON.stringify(replayEvents(capture))).not.toContain(marker)
  expect(capture.submissions.some((item) => item.type === 'event' && item.payload.name === 'backup_download_requested')).toBe(false)
  expect(await page.evaluate(() => (window as unknown as { umami: { getSession: () => { cache?: string } } }).umami.getSession().cache)).toBeUndefined()
  expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe(preference)
  const beforeReload = capture.submissions.length
  await page.reload(); await injectHarness(page); await initializeHarness(page); await waitForActive(page)
  await expect.poll(() => capture.submissions.slice(beforeReload).some((item) => item.type === 'record')).toBe(true)
  expect(JSON.stringify(replayEvents(capture))).not.toContain(marker)
  expect(capture.unexpected).toEqual([])
})

test('cross-tab opt-out never uploads disabled-period replay activity after another tab enables tracking', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await page.addInitScript(() => Object.assign(window, { analyticsDocumentInstance: Math.random().toString() }))
  await page.goto(`${origin}${fixturePath}`)
  const originalDocument = await page.evaluate(() => (window as unknown as { analyticsDocumentInstance: string }).analyticsDocumentInstance)
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  await expect.poll(() => capture.submissions.some((item) => item.type === 'record')).toBe(true)
  const otherTab = await context.newPage()
  await otherTab.goto(`${origin}${fixturePath}`)
  await otherTab.evaluate((key) => localStorage.setItem(key, 'disabled'), preferenceKey)
  const status = () => page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean; reason: string } } }).analyticsHarness.getTrackingStatus())
  await expect.poll(status).toMatchObject({ active: false, reason: 'opt-out' })
  const disabledMarker = 'SENTINEL-disabled-period-replay-51793'
  await page.evaluate((marker) => {
    const progress = document.createElement('p')
    progress.id = 'session-progress'
    progress.textContent = marker
    document.body.appendChild(progress)
  }, disabledMarker)
  await otherTab.evaluate((key) => localStorage.setItem(key, 'enabled'), preferenceKey)
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe('enabled')
  // A real rrweb upload after re-enabling used to contain the mutation above.
  // Wait through two recorder flush intervals and use a trusted click to also
  // exercise heatmap collection after the preference changed.
  await page.locator('#public-action').click()
  await page.waitForTimeout(6000)
  expect(JSON.stringify(replayEvents(capture))).not.toContain(disabledMarker)
  expect(await status()).toMatchObject({ active: false, reason: 'reload-required' })
  expect(await page.evaluate(() => (window as unknown as { analyticsDocumentInstance: string }).analyticsDocumentInstance)).toBe(originalDocument)
  await expect(page.locator('#session-progress')).toHaveText(disabledMarker)
  const beforeReload = capture.submissions.length
  await page.reload()
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  await expect.poll(() => capture.submissions.slice(beforeReload).some((item) => item.type === 'record')).toBe(true)
  expect(await page.evaluate(() => (window as unknown as { analyticsDocumentInstance: string }).analyticsDocumentInstance)).not.toBe(originalDocument)
  expect(JSON.stringify(replayEvents(capture))).not.toContain(disabledMarker)
  expect(capture.unexpected).toEqual([])
})

test('cross-tab opt-out also suspends a recorder whose configuration finishes loading later', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await page.goto(`${origin}${fixturePath}`)
  await injectHarness(page)
  await initializeHarness(page)
  await waitForActive(page)
  const otherTab = await context.newPage()
  await otherTab.goto(`${origin}${fixturePath}`)
  await otherTab.evaluate((key) => localStorage.setItem(key, 'disabled'), preferenceKey)
  await expect.poll(() => page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean } } }).analyticsHarness.getTrackingStatus().active)).toBe(false)
  releaseRecorder()
  const disabledMarker = 'SENTINEL-delayed-recorder-50826'
  await page.evaluate((marker) => { document.querySelector('#public-action')!.textContent = marker }, disabledMarker)
  await otherTab.evaluate((key) => localStorage.setItem(key, 'enabled'), preferenceKey)
  await page.waitForTimeout(6000)
  expect(JSON.stringify(replayEvents(capture))).not.toContain(disabledMarker)
  expect(await page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { active: boolean; reason: string } } }).analyticsHarness.getTrackingStatus())).toMatchObject({ active: false, reason: 'reload-required' })
  expect(capture.unexpected).toEqual([])
})

test('failed preference writes provide a disabled reload URL without claiming persistence', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await page.goto(`${origin}${fixturePath}`)
  await injectHarness(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Synthetic quota failure') } })
  const result = await page.evaluate(() => (window as unknown as { analyticsHarness: { setTrackingPreference: (enabled: boolean) => { persisted: boolean; reloadURL: string } } }).analyticsHarness.setTrackingPreference(false))
  expect(result.persisted).toBe(false)
  expect(result.reloadURL).toBe(`${origin}${fixturePath}#analytics=off`)
  await page.goto(result.reloadURL)
  await injectHarness(page)
  await initializeHarness(page)
  expect(capture.scriptRequests).toEqual([])
  expect(capture.submissions).toEqual([])
  expect(capture.unexpected).toEqual([])
})

test('unavailable tracker is optional and leaves the isolated page usable', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { trackerFailure: true, recorderBody: '' })
  await page.goto(`${origin}${fixturePath}`)
  await injectHarness(page)
  await initializeHarness(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { reason: string } } }).analyticsHarness.getTrackingStatus().reason)).toBe('script-unavailable')
  await page.locator('#private-input').fill('Usable local input')
  await expect(page.locator('#private-input')).toHaveValue('Usable local input')
  expect(capture.submissions).toEqual([])
  expect(capture.unexpected).toEqual([])
})

for (const startup of ['loading', 'network-error'] as const) {
  test(`startup privacy controls remain usable during ${startup}`, async ({ page, context, baseURL }, testInfo) => {
    if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
    const origin = new URL(baseURL!).origin
    const capture = await installLocalRoutes(context, origin)
    await serveIsolatedApplication(context, origin)
    let releaseCatalog!: () => void
    const catalogReady = new Promise<void>((resolve) => { releaseCatalog = resolve })
    await context.route(`${origin}${appFixturePath}catalog.json`, async (route) => {
      if (startup === 'loading') await catalogReady
      await route.fulfill({ status: 503, body: 'Synthetic catalog outage' })
    })
    await page.goto(`${origin}${fixturePath}`)
    const storedProfile = JSON.stringify(initial)
    await page.evaluate(({ key, profile }) => localStorage.setItem(key, profile), { key: profileKey, profile: storedProfile })
    await page.goto(`${origin}${appMapPath}`)
    await waitForActive(page)
    if (startup === 'loading') await expect(page.getByRole('status')).toHaveText('Opening your companion…')
    else await expect(page.getByRole('button', { name: 'Retry catalog', exact: true })).toBeVisible()
    const openPrivacy = async () => {
      if (startup === 'loading') {
        await expect(page.locator('.startup-disclosure')).toContainText('self-hosted Umami')
        const details = page.locator('.startup-privacy')
        await details.locator('summary').focus(); await page.keyboard.press('Enter')
        return details
      }
      const menu = page.getByRole('button', { name: 'Menu', exact: true })
      if (await menu.isVisible()) await menu.click()
      await page.getByRole('button', { name: 'Privacy & tracking', exact: true }).click()
      return page.getByRole('dialog', { name: 'Privacy & tracking', exact: true })
    }
    const privacy = await openPrivacy()
    await expect(privacy).toContainText('self-hosted Umami')
    const disable = privacy.getByRole('button', { name: 'Disable tracking and reload', exact: true })
    await expect(disable).toBeVisible()
    await disable.scrollIntoViewIfNeeded()
    await expect(disable).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Startup disclosure overflows horizontally').toBe(true)
    const firstScriptRequests = capture.scriptRequests.length
    await Promise.all([page.waitForEvent('load'), disable.click()])
    expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe('disabled')
    expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBe(storedProfile)
    expect(capture.scriptRequests).toHaveLength(firstScriptRequests)
    expect(await page.evaluate(() => (window as unknown as { analyticsHarness: { getTrackingStatus: () => { enabled: boolean; active: boolean } } }).analyticsHarness.getTrackingStatus())).toMatchObject({ enabled: false, active: false })
    const reloadedPrivacy = await openPrivacy()
    await expect(reloadedPrivacy.getByRole('button', { name: 'Enable tracking and reload', exact: true })).toBeVisible()
    releaseCatalog()
    if (startup === 'network-error') await reloadedPrivacy.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry catalog', exact: true })).toBeVisible()
    expect(capture.unexpected).toEqual([])
  })
}

test('startup privacy disclosure refreshes cross-tab tracking status while the catalog is pending', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await serveIsolatedApplication(context, origin)
  let releaseCatalog!: () => void
  const catalogReady = new Promise<void>((resolve) => { releaseCatalog = resolve })
  await context.route(`${origin}${appFixturePath}catalog.json`, async (route) => {
    await catalogReady
    await route.fulfill({ status: 503, body: 'Synthetic catalog outage' })
  })
  await page.goto(`${origin}${appMapPath}`)
  await waitForActive(page)
  const privacy = page.locator('details')
  await privacy.locator('summary').click()
  await expect(privacy.getByRole('status')).toHaveText('Usage analytics and recording are enabled for this visit.')
  const otherTab = await context.newPage()
  await otherTab.goto(`${origin}${fixturePath}`)
  await otherTab.evaluate((key) => localStorage.setItem(key, 'disabled'), preferenceKey)
  await expect(privacy.getByRole('status')).toHaveText('Usage analytics and recording are disabled.')
  await privacy.locator('summary').click()
  await otherTab.evaluate((key) => localStorage.setItem(key, 'enabled'), preferenceKey)
  await privacy.locator('summary').click()
  await expect(privacy.getByRole('status')).toContainText('Tracking remains off in this tab')
  await expect(privacy.getByRole('button', { name: 'Enable tracking and reload', exact: true })).toBeVisible()
  releaseCatalog()
  expect(capture.unexpected).toEqual([])
})

test('catalog parsing errors show only fixed public wording in the actual recorded application', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await serveIsolatedApplication(context, origin)
  const marker = 'CATALOG_SECRET'
  const safeError = 'The reviewed tree could not be loaded. Other companion sections remain available.'
  let releaseCatalog!: () => void
  const catalogReady = new Promise<void>((resolve) => { releaseCatalog = resolve })
  await context.route(`${origin}${appFixturePath}catalog.json`, async (route) => {
    await catalogReady
    await route.fulfill({ contentType: 'application/json', body: marker })
  })
  await page.goto(`${origin}${appMapPath}`)
  await waitForActive(page)
  await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
  releaseCatalog()
  await expect(page.getByRole('button', { name: 'Retry catalog', exact: true })).toBeVisible()
  const publicError = page.getByText(safeError, { exact: true })
  const displayedError = (await publicError.textContent())!
  const encodedError = JSON.stringify(displayedError).slice(1, -1)
  const events = await waitForReplayEvents(capture, (events) => JSON.stringify(events).includes(encodedError))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  expect(evidence.includes(marker), 'Raw catalog parser detail leaked into telemetry').toBe(false)
  await expect(publicError).toHaveText(safeError)
  expect(JSON.stringify(events).includes(safeError), 'The fixed public error was absent from the real recording').toBe(true)
  await expect(page.locator('body')).not.toContainText(marker)
  const failures = capture.submissions.filter((item) => item.payload.name === 'catalog_error')
  expect(failures).toHaveLength(1)
  expect(failures[0].payload.data).toMatchObject({ reason: 'validation' })
  expect(capture.unexpected).toEqual([])
})

test('prerequisite route targets, queries and intentions remain blocked in real recorder snapshots and mutations', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  const snapshotProof = 'ROUTE_PUBLIC_SNAPSHOT_PROOF', mutationProof = 'ROUTE_PUBLIC_MUTATION_PROOF'
  const marker = 'ROUTE_PRIVATE_QUERY_82749'
  const belt = catalog.upgrades.find((upgrade) => upgrade.title === 'Legendary Belt')!
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  const compact = page.getByRole('button', { name: 'Map options', exact: true })
  await (await compact.isVisible() ? compact : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Compare prerequisite routes…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Prerequisite routes', exact: true })
  const input = dialog.getByRole('searchbox', { name: 'Find a route target', exact: true })
  await input.fill(belt.title)
  await dialog.locator(`[data-route-choice="${belt.id}"]`).click()
  await dialog.getByRole('radio').first().check()
  await page.evaluate((proof) => {
    const node = document.createElement('p'); node.id = 'route-public-proof'; node.textContent = proof
    document.querySelector('dialog[open]')!.appendChild(node)
  }, snapshotProof)
  await waitForActive(page)
  releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(snapshotProof)))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('prerequisite-routes') && !(node.childNodes?.length))).toBe(true)
  await dialog.locator('.route-picker summary').click()
  await input.fill(marker)
  await page.locator('#route-public-proof').evaluate((element, proof) => { element.textContent = proof }, mutationProof)
  await page.locator('#route-public-proof').click()
  const events = await waitForReplayEvents(capture, (items) => items.some((event) => event.type === 3 && JSON.stringify(event).includes(mutationProof)))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const privateValue of [marker, 'Exact combined catalog cost', 'Mark route 1 as intended', 'Chosen OR alternatives']) expect(evidence).not.toContain(privateValue)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBeNull()
  expect(capture.unexpected).toEqual([])
})

test('single-event hypothetical controls and results stay blocked in real replay and emit no purchase events', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  await page.locator(`.react-flow__node[data-id="${catalog.startId}"]`).click()
  const toggle = page.getByRole('button', { name: 'Show details', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  const before = await page.evaluate((key) => window.__readMapProfileText(key), profileKey)
  await page.getByRole('button', { name: 'Analyze forward impact…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Forward impact', exact: true })
  await expect(dialog.locator('.forward-impact')).toBeVisible()
  const privateSnapshot = 'PRIVATE_FORWARD_EVENT_SNAPSHOT'
  const privateMutation = 'PRIVATE_FORWARD_EVENT_MUTATION'
  const publicSnapshot = 'PUBLIC_FORWARD_SNAPSHOT'
  const publicMutation = 'PUBLIC_FORWARD_MUTATION'
  await page.evaluate(({ privateSnapshot, publicSnapshot }) => {
    const privateNode = document.createElement('p'); privateNode.id = 'forward-private-proof'; privateNode.textContent = privateSnapshot
    document.querySelector('.forward-impact')!.appendChild(privateNode)
    const publicNode = document.createElement('p'); publicNode.id = 'forward-public-proof'; publicNode.textContent = publicSnapshot
    document.querySelector('dialog[open]')!.appendChild(publicNode)
  }, { privateSnapshot, publicSnapshot })
  releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(publicSnapshot)))
  expect(blockedReplayNodes(snapshot).some((entry) => entry.attributes.class.includes('forward-impact') && !entry.childNodes?.length)).toBe(true)
  await dialog.locator('summary').first().click()
  await page.locator('#forward-private-proof').evaluate((node, text) => { node.textContent = text }, privateMutation)
  await page.locator('#forward-public-proof').evaluate((node, text) => { node.textContent = text }, publicMutation)
  await page.locator('#forward-public-proof').click()
  const events = await waitForReplayEvents(capture, (items) => items.some((event) => event.type === 3 && JSON.stringify(event).includes(publicMutation)))
  const proof = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const marker of [privateSnapshot, privateMutation]) expect(proof).not.toContain(marker)
  for (const name of ['purchase_started', 'purchase_previewed', 'purchase_applied', 'milestone_changed', 'progress_undo']) expect(capture.submissions.filter((item) => item.payload.name === name)).toHaveLength(0)
  expect(capture.submissions.some((item) => item.payload.name === 'panel_opened' && (item.payload.data as Record<string, unknown>)?.panel === 'forward-impact')).toBe(false)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBe(before)
  expect(capture.unexpected).toEqual([])
})

test('active dialog feedback remains private in actual recorder snapshots and mutations', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  const fileMarker = 'MODAL_BACKUP_PRIVATE_CONTENT'
  const readMarker = 'MODAL_PRIVATE_READ_DETAIL'
  const snapshotProof = 'DIALOG_FEEDBACK_PUBLIC_SNAPSHOT'
  const mutationProof = 'DIALOG_FEEDBACK_PUBLIC_MUTATION'
  const invalidError = 'The backup is not valid JSON. Progress was not replaced.'
  const readError = 'The backup could not be read. Progress was not replaced.'
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic-invalid.json', mimeType: 'application/json', buffer: Buffer.from(fileMarker) })
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).toContainText(invalidError)
  await page.evaluate((proof) => {
    const node = document.createElement('p'); node.id = 'dialog-feedback-public-proof'; node.textContent = proof
    document.querySelector('dialog[open]')!.appendChild(node)
  }, snapshotProof)
  await waitForActive(page)
  releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(snapshotProof)))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('dialog-feedback') && !(node.childNodes?.length))).toBe(true)
  await page.evaluate((marker) => {
    File.prototype.text = async function () { throw new Error(marker) }
  }, readMarker)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic-unreadable.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).toContainText(readError)
  await page.locator('#dialog-feedback-public-proof').evaluate((node, proof) => { node.textContent = proof }, mutationProof)
  await page.locator('#dialog-feedback-public-proof').click()
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 3 && JSON.stringify(event).includes(mutationProof)))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const privateText of [fileMarker, readMarker, invalidError, readError]) expect(evidence).not.toContain(privateText)
  await expect(page.locator('body')).not.toContainText(fileMarker)
  await expect(page.locator('body')).not.toContainText(readMarker)
  await expect.poll(() => capture.submissions.some((item) => item.payload.name === 'backup_error' && (item.payload.data as Record<string, unknown> | undefined)?.reason === 'read')).toBe(true)
  expect(capture.unexpected).toEqual([])
})

test('named checkpoint snapshots and edits stay excluded from actual recorder snapshots, mutations and event data', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  const names = ['CHECKPOINT_PRIVATE_STORED_NAME', 'CHECKPOINT_PRIVATE_CAPTURE_NAME', 'CHECKPOINT_PRIVATE_RENAME_NAME']
  const snapshotProof = 'CHECKPOINT_PUBLIC_SNAPSHOT_PROOF', mutationProof = 'CHECKPOINT_PUBLIC_MUTATION_PROOF'
  const unknown = 'CHECKPOINT_PRIVATE_UNKNOWN_RECORD', fileMarker = 'CHECKPOINT_PRIVATE_BACKUP_CONTENT'
  await page.addInitScript(({ key, text }) => localStorage.setItem(key, text), {
    key: CHECKPOINT_STORAGE_KEY,
    text: exportCheckpoints({ ...emptyCheckpoints(), entries: [{ id: 'stored', name: names[0], capturedRevision: catalog.revision, profile: { ...initial, purchases: { [unknown]: { epoch: 0, active: false } } } }] }, catalog.revision)!,
  })
  await page.goto(`${origin}${appMapPath}`)
  await (await openProgress(page)).getByRole('button', { name: 'Progress checkpoints…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Progress checkpoints', exact: true })
  await expect(dialog.locator('.checkpoint-list')).toContainText(names[0])
  await page.evaluate((proof) => {
    const node = document.createElement('p'); node.id = 'checkpoint-public-proof'; node.textContent = proof
    document.querySelector('dialog[open]')!.appendChild(node)
  }, snapshotProof)
  await waitForActive(page)
  releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(snapshotProof)))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('checkpoint-panel') && !(node.childNodes?.length))).toBe(true)
  await dialog.getByLabel('Name current checkpoint', { exact: true }).fill(names[1])
  await dialog.getByRole('button', { name: 'Capture current progress', exact: true }).click()
  await expect(dialog.getByRole('status', { name: 'Checkpoint storage and actions' })).toContainText('saved on this device')
  await dialog.getByRole('button', { name: 'Rename checkpoint 2…', exact: true }).click()
  await dialog.getByLabel('New checkpoint name', { exact: true }).fill(names[2])
  await dialog.getByRole('button', { name: 'Save checkpoint name', exact: true }).click()
  await expect(dialog.locator('.checkpoint-list')).toContainText(names[2])
  await dialog.getByLabel('Progress checkpoints JSON backup', { exact: true }).setInputFiles({ name: 'private-checkpoints.json', mimeType: 'application/json', buffer: Buffer.from(fileMarker) })
  await expect(dialog).toContainText('not a supported checkpoint collection')
  await page.locator('#checkpoint-public-proof').evaluate((node, proof) => { node.textContent = proof }, mutationProof)
  await page.locator('#checkpoint-public-proof').click()
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 3 && JSON.stringify(event).includes(mutationProof)))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const marker of [...names, unknown, fileMarker, 'private-checkpoints.json']) expect(evidence.includes(marker), 'Checkpoint private content leaked into telemetry').toBe(false)
  expect(capture.submissions.some((item) => /checkpoint/i.test(String(item.payload.name ?? '')))).toBe(false)
  expect(capture.unexpected).toEqual([])
})

test('real recorder proves moderate input masking, blocking and safe application save import', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  const hidden = catalog.upgrades.find((upgrade) => !visible.ids.has(upgrade.id) && upgrade.activation === 'after-ultra-ascension')!
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), {
    key: profileKey, profile: { ...initial, purchases: { [secrets.unknown]: { epoch: 0, active: false } } },
  })
  await page.goto(`${origin}${appMapPath}?private=${secrets.url}#${secrets.url}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.evaluate(({ publicMarker, blocked }) => {
    const fixture = document.createElement('aside')
    fixture.style.cssText = 'position:fixed;top:120px;right:4px;z-index:100;background:#231e19;padding:4px'
    fixture.innerHTML = '<label>Masked replay proof<input id="replay-mask-proof" type="text"></label><p id="replay-public-proof"></p><p class="telemetry-private rr-block"></p>'
    fixture.querySelector('#replay-public-proof')!.textContent = publicMarker
    fixture.querySelector('.telemetry-private')!.textContent = blocked
    document.body.appendChild(fixture)
  }, { publicMarker, blocked: secrets.blocked })
  await waitForActive(page)
  releaseRecorder()
  await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
  await page.locator('#replay-mask-proof').fill(secrets.query)
  await page.locator('#replay-public-proof').click()
  await page.getByRole('searchbox').fill(secrets.query)
  await page.getByRole('searchbox').fill('')
  await page.keyboard.press('Escape')
  const preview = await chooseCompanionSave(page, { epoch: '1', integers: { [catalog.startId]: 1, [hidden.id]: 1 }, strings: { 'Fixture account preference': secrets.native } })
  await expect(preview).not.toContainText(hidden.title)
  await preview.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await page.evaluate(({ secrets, visibleId }) => {
    const controller = (window as unknown as { analyticsHarness: { trackEvent: (name: string, data: Record<string, unknown>) => void } }).analyticsHarness
    controller.trackEvent('search_performed', { query_length: '31+', results: '0', query: secrets.query, file: secrets.file, native: secrets.native })
    controller.trackEvent('upgrade_selected', { upgrade_id: visibleId, source: 'map', unknown: secrets.unknown })
    controller.trackEvent('upgrade_selected', { upgrade_id: secrets.unknown, source: 'map' })
    controller.trackEvent('runtime_error', { reason: 'runtime', message: secrets.error })
  }, { secrets, visibleId: catalog.startId })
  const events = await waitForReplayEvents(capture, (events) =>
    events.some((event) => event.type === 3 && event.data?.source === 5)
    && capture.submissions.some((item) => item.type === 'heatmap' && Array.isArray(item.payload.events)
      && item.payload.events.some((event: { type: string }) => event.type === 'click')))
  expect(events.some((event) => event.type === 2 && JSON.stringify(event).includes(publicMarker))).toBe(true)
  expect(events.some((event) => event.type === 2 && JSON.stringify(event).includes(firstUpgrade.title))).toBe(true)
  expect(events.some((event) => event.type === 3 && event.data?.source === 5 && typeof event.data.text === 'string' && /^\*+$/.test(event.data.text))).toBe(true)
  const blocked = blockedReplayNodes(events)
  expect(blocked.some((node) => node.tagName === 'div' && node.attributes.class.includes('companion-operation') && !node.childNodes?.length)).toBe(true)
  expect(blocked.length).toBeGreaterThan(0)
  expect(blocked.every((node) => node.childNodes?.length === 0)).toBe(true)
  const decoded = JSON.stringify({ submissions: capture.submissions, replay: events })
  // Report a bounded boolean on failure, not megabytes of replay data.
  for (const sentinel of Object.values(secrets)) expect(decoded.includes(sentinel), `Leaked synthetic marker: ${sentinel}`).toBe(false)
  const initialSnapshot = events.find((event) => event.type === 2)!
  expect(JSON.stringify(initialSnapshot).includes(hidden.id), 'Initially hidden upgrade appeared in the initial recording').toBe(false)
  // Owned imports can legitimately reveal a previously hidden upgrade. The
  // preview must exclude it; after applying, the ordinary map visibility wins.
  const imported = await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)
  expect(visibility(catalog, imported).ids.has(hidden.id)).toBe(true)
  expect(decoded.includes('Fixture account preference')).toBe(false)
  expect(capture.submissions.every((item) => item.payload.website === websiteId)).toBe(true)
  for (const submission of capture.submissions.filter((item) => item.type === 'heatmap')) {
    expect(Array.isArray(submission.payload.events)).toBe(true)
    for (const event of submission.payload.events as Record<string, unknown>[]) {
      expect(new URL(event.url as string).search).toBe('')
      expect(new URL(event.url as string).hash).toBe('')
      expect(Object.keys(event).every((key) => ['type', 'url', 'timestamp', 'x', 'y', 'pageX', 'pageY', 'pageW', 'pageH', 'viewportW', 'viewportH', 'scrollPct'].includes(key))).toBe(true)
    }
  }
  expect(capture.unexpected).toEqual([])
})

test('actual application handlers count confirmed purchase and recommendation once and exclude cancellations', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { recorderBody: '' })
  await serveIsolatedApplication(context, origin)
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  const count = (name: string) => capture.submissions.filter((submission) => submission.type === 'event' && submission.payload.name === name).length
  await expect.poll(() => count('app_ready')).toBe(1)
  await page.locator(`.react-flow__node[data-id="${catalog.startId}"]`).click()
  await expect.poll(() => count('upgrade_selected')).toBe(1)
  const other = visible.upgrades.find((upgrade) => upgrade.id !== catalog.startId)!
  for (const [position, upgrade] of [other, firstUpgrade].entries()) {
    await page.getByRole('searchbox').fill(upgrade.title)
    if (position === 1) await page.getByRole('searchbox').press('Enter')
    else await page.locator('.search-result').filter({ hasText: upgrade.title }).first().click()
    await expect(page.locator('.details h2')).toHaveText(upgrade.title)
  }
  await expect.poll(() => count('upgrade_selected')).toBe(3)
  expect(capture.submissions.filter((submission) => submission.payload.name === 'upgrade_selected').slice(1).every((submission) => (submission.payload.data as Record<string, unknown>).source === 'search')).toBe(true)
  await page.locator(`.react-flow__node[data-id="${catalog.startId}"]`).click()
  expect(count('upgrade_selected')).toBe(3)
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  const purchase = page.getByRole('dialog', { name: 'Record purchase?', exact: true })
  await expect(purchase).toBeVisible()
  await purchase.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => count('purchase_cancelled')).toBe(1)
  expect(count('purchase_applied')).toBe(0)
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await purchase.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect.poll(() => count('purchase_applied')).toBe(1)
  expect(count('purchase_started')).toBe(2)
  expect(count('purchase_previewed')).toBe(2)
  await page.getByRole('button', { name: 'Next upgrade', exact: true }).click()
  const recommendations = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
  await expect(recommendations.locator('.recommendation-main')).toBeVisible()
  await recommendations.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await purchase.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect.poll(() => count('recommendation_purchase_applied')).toBe(1)
  expect(count('recommendation_purchase_started')).toBe(1)
  expect(count('recommendations_viewed')).toBe(1)
  expect(count('purchase_applied')).toBe(2)
  const current = await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)
  const currentVisible = visibility(catalog, current)
  const hidden = catalog.upgrades.find((upgrade) => !currentVisible.ids.has(upgrade.id)
    && catalog.upgrades.every((other) => other.id === upgrade.id || !other.title.toLowerCase().includes(upgrade.title.toLowerCase())))!
  expect(hidden).toBeDefined()
  const hiddenSelections = () => capture.submissions.filter((submission) => submission.payload.name === 'upgrade_selected'
    && (submission.payload.data as Record<string, unknown>).upgrade_id === hidden.id).length
  const showSpoilers = async (enabled: boolean) => {
    const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
    if (!await checkbox.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
    await checkbox.setChecked(enabled)
    const options = page.getByRole('dialog', { name: 'Map options', exact: true })
    if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
  }
  for (const expectedSelections of [1, 2]) {
    await showSpoilers(true)
    await page.getByRole('searchbox').fill(hidden.title)
    await page.locator('.search-result').filter({ hasText: hidden.title }).first().click()
    await expect(page.locator('.details h2')).toHaveText(hidden.title)
    await expect.poll(hiddenSelections).toBe(expectedSelections)
    if (expectedSelections === 1) {
      await showSpoilers(false)
      await expect(page.locator('.details')).toHaveCount(0)
      await expect(page.locator(`.react-flow__node[data-id="${hidden.id}"]`)).toHaveCount(0)
    }
  }
  expect(capture.unexpected).toEqual([])
})

test('search events count input edits without counting purchase or undo result recomputation', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { recorderBody: '' })
  await serveIsolatedApplication(context, origin)
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  const searches = () => capture.submissions.filter((submission) => submission.type === 'event' && submission.payload.name === 'search_performed')
  const input = page.getByRole('searchbox')
  await input.fill(firstUpgrade.title)
  await expect.poll(() => searches().length).toBe(1)
  const observed = [searches().length]
  await page.locator('.search-result').filter({ hasText: firstUpgrade.title }).first().click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await page.waitForTimeout(750)
  observed.push(searches().length)
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await undo.click()
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('0 /')
  await page.waitForTimeout(750)
  observed.push(searches().length)
  expect(observed).toEqual([1, 1, 1])
  await input.focus()
  await page.waitForTimeout(750)
  expect(searches()).toHaveLength(1)
  await input.fill('   ')
  await page.waitForTimeout(750)
  expect(searches()).toHaveLength(1)
  for (const text of ['Perm', 'Permanent', firstUpgrade.title]) await input.fill(text)
  await expect.poll(() => searches().length).toBe(2)
  await page.waitForTimeout(750)
  expect(searches()).toHaveLength(2)
  const marker = 'SEARCH_EVENT_PRIVATE_MARKER_DO_NOT_UPLOAD'
  await input.fill(marker)
  await expect.poll(() => searches().length).toBe(3)
  expect(searches().map((event) => event.payload.data)).toEqual([
    expect.objectContaining({ query_length: '11-30', results: '1-5' }),
    expect.objectContaining({ query_length: '11-30', results: '1-5' }),
    expect.objectContaining({ query_length: '31+', results: '0' }),
  ])
  const fields = ['app_version', 'catalog_version', 'catalog_revision', 'screen_layout', 'layout', 'spoilers', 'query_length', 'results']
  for (const event of searches()) expect(Object.keys(event.payload.data as object).sort()).toEqual([...fields].sort())
  expect(JSON.stringify(capture.submissions)).not.toContain(marker)
  expect(capture.unexpected).toEqual([])
})

test('a pending search uses current visible results and context without restarting its debounce', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { recorderBody: '' })
  await serveIsolatedApplication(context, origin)
  await page.clock.install()
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  const other = await context.newPage()
  await other.goto(`${origin}${fixturePath}`)
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000)
  const searches = () => capture.submissions.filter((submission) => submission.type === 'event' && submission.payload.name === 'search_performed')
  await page.getByRole('searchbox').fill('Astral')
  await expect(page.locator('.results-heading')).toContainText('0 visible results')
  await page.clock.runFor(300)
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: profileKey, profile: { ...initial, showSpoilers: true } })
  await expect(page.locator('.results-heading')).toContainText('17 visible results')
  await page.clock.runFor(200)
  await expect.poll(() => searches().length).toBe(1)
  expect(searches()[0].payload.data).toMatchObject({ query_length: '4-10', results: '6-20', spoilers: true })
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: profileKey, profile: initial })
  await expect(page.locator('.results-heading')).toContainText('0 visible results')
  await page.clock.runFor(1000)
  expect(searches()).toHaveLength(1)
  expect(capture.unexpected).toEqual([])
})

test('renamed layout controls retain bounded game and web analytics values', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { recorderBody: '' })
  await serveIsolatedApplication(context, origin)
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  const events = (name: string) => capture.submissions.filter((submission) => submission.type === 'event' && submission.payload.name === name)
  await expect.poll(() => events('app_ready').length).toBe(1)
  expect((events('app_ready')[0].payload.data as Record<string, unknown>).layout).toBe('game')
  const layout = page.getByRole('group', { name: 'Map layout', exact: true })
  await expect(layout.getByRole('button')).toHaveText(['Game Layout', 'Detailed Layout'])
  await layout.getByRole('button', { name: 'Detailed Layout', exact: true }).click()
  await expect.poll(() => events('map_layout_changed').map((event) => (event.payload.data as Record<string, unknown>).layout)).toEqual(['web'])
  await layout.getByRole('button', { name: 'Game Layout', exact: true }).click()
  await expect.poll(() => events('map_layout_changed').map((event) => (event.payload.data as Record<string, unknown>).layout)).toEqual(['web', 'game'])
  await layout.getByRole('button', { name: 'Game Layout', exact: true }).click()
  expect(events('map_layout_changed')).toHaveLength(2)
  expect(await page.evaluate(() => localStorage.getItem('idle-slayer-ascension-map.layout.v1'))).toBe('native')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBeNull()
  expect(capture.unexpected).toEqual([])
})

test('actual import cancellation never applies and confirmation emits one applied event', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { recorderBody: '' })
  await serveIsolatedApplication(context, origin)
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  const count = (name: string) => capture.submissions.filter((submission) => submission.type === 'event' && submission.payload.name === name).length
  const choose = () => chooseCompanionSave(page, { integers: { [catalog.startId]: 1 }, strings: { 'Unrelated fixture preference': secrets.native } })
  const cancelled = await choose()
  await cancelled.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect.poll(() => count('game_import_cancelled')).toBe(1)
  expect(count('game_import_applied')).toBe(0)
  const confirmed = await choose()
  await confirmed.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect.poll(() => count('game_import_applied')).toBe(1)
  expect(count('game_import_started')).toBe(2)
  expect(count('game_import_previewed')).toBe(2)
  expect(JSON.stringify(capture.submissions)).not.toContain(secrets.file)
  expect(JSON.stringify(capture.submissions)).not.toContain(secrets.native)
  expect(capture.unexpected).toEqual([])
})

test('unsaved progress and intentions opt-out preserves cancellation and exports both current documents before reload', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { recorderBody: '' })
  await serveIsolatedApplication(context, origin)
  const workspaceKey = 'idle-slayer-companion.workspace.v1'
  const privatePlan = 'SENTINEL-private-recipe-plan-25149'
  const intentions = { format: 'idle-slayer-companion-workspace', version: 1, goals: [{ ref: { system: 'ascension', id: catalog.startId }, mode: 'acquire' }], recipePlans: { [privatePlan]: '3' } }
  await page.addInitScript(({ key, original }) => {
    localStorage.setItem(key, JSON.stringify(original))
    const originalSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if ([key, 'idle-slayer-companion.progress.v1', 'idle-slayer-companion.workspace.v1'].includes(name)) throw new Error('Synthetic progress and intentions write failure')
      return originalSet.call(this, name, value)
    }
  }, { key: profileKey, original: initial })
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  await page.locator(`.react-flow__node[data-id="${catalog.startId}"]`).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Record purchase?', exact: true }).getByRole('button', { name: 'Apply purchases', exact: true }).click()
  const purchased = page.locator(`.react-flow__node[data-id="${catalog.startId}"] .upgrade-node.purchased`)
  await expect(purchased).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved')
  await expect.poll(() => capture.submissions.some((submission) => submission.payload.name === 'storage_error')).toBe(true)
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)).toEqual(initial)
  await page.locator('.companion-global-actions').getByRole('button', { name: /Backup/ }).click()
  const backups = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  await backups.getByLabel('Restore intentions', { exact: true }).setInputFiles({ name: 'intentions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(intentions)) })
  await backups.getByRole('button', { name: 'Replace intentions', exact: true }).click()
  await expect(backups.getByRole('status').filter({ hasText: 'Intentions could not be saved' })).toBeVisible()
  await backups.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.companion-session-status').getByRole('status').filter({ hasText: 'Intentions could not be saved' })).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBeNull()
  await openAction(page, 'Privacy & tracking')
  const privacy = page.getByRole('dialog', { name: 'Privacy & tracking', exact: true })
  await privacy.getByRole('button', { name: 'Disable tracking and reload', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Privacy & tracking', exact: true })
  const warning = settings.getByRole('region', { name: 'Reload with unsaved progress', exact: true })
  await expect(warning).toContainText('Companion progress and intentions')
  await warning.getByRole('button', { name: 'Cancel reload', exact: true }).click()
  await expect(settings).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBeNull()
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)).toEqual(initial)
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(purchased).toBeVisible()
  await openAction(page, 'Privacy & tracking')
  await privacy.getByRole('button', { name: 'Disable tracking and reload', exact: true }).click()
  await expect(warning).toBeVisible()
  capture.scriptRequests.length = 0
  const downloads: import('@playwright/test').Download[] = []
  page.on('download', (download) => downloads.push(download))
  await Promise.all([
    page.waitForEvent('load'),
    warning.getByRole('button', { name: 'Export backups and reload', exact: true }).click(),
  ])
  await expect.poll(() => downloads.length).toBe(2)
  const documents = await Promise.all(downloads.map(async (download) => { const path = await download.path(); expect(path).not.toBeNull(); return JSON.parse(readFileSync(path!, 'utf8')) }))
  const backup = documents.find((document) => document.format === 'idle-slayer-companion-progress')
  expect(documents.find((document) => document.format === 'idle-slayer-companion-workspace')).toEqual(intentions)
  expect(backup.format).toBe('idle-slayer-companion-progress')
  expect(backup.ascension.purchases[catalog.startId]).toEqual({ epoch: 0, active: true })
  expect(Object.keys(backup.modules).sort()).toEqual(['achievement', 'craft', 'divinity', 'enemy', 'material', 'quest', 'village'])
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe('disabled')
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)).toEqual(initial)
  expect(await page.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBeNull()
  expect(JSON.stringify(capture.submissions)).not.toContain(privatePlan)
  expect(capture.scriptRequests).toEqual([])
  expect(capture.unexpected).toEqual([])
})


test('real recorder excludes transfer URL payloads, QR contents, links and replacement previews', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const marker = 'SENTINEL-private-transfer-progress-27591'
  const outgoing = { ...initial, purchases: { [marker]: { epoch: 0, active: false } } }
  const incoming = { ...initial, epoch: 314159, purchases: { [marker]: { epoch: 2, active: false }, [catalog.startId]: { epoch: 314159, active: true } } }
  const encoded = await encodeProgressTransfer(catalog, incoming, 'web')
  if (!encoded.ok) throw new Error(encoded.error)
  const link = progressTransferLink(encoded.token, origin, appFixturePath)
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  await page.addInitScript(({ key, outgoing }) => localStorage.setItem(key, JSON.stringify(outgoing)), { key: profileKey, outgoing })
  await page.goto(link)
  await waitForActive(page)
  const dialog = page.getByRole('dialog', { name: 'Transfer map progress', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Review transfer', exact: true })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  await expect(dialog).not.toContainText(marker)
  const snapshotProof = 'TRANSFER-public-snapshot-proof-42816'
  await dialog.evaluate((element, proof) => {
    const publicNode = document.createElement('p'); publicNode.textContent = proof; element.appendChild(publicNode)
  }, snapshotProof)
  releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(snapshotProof)))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('progress-transfer') && !(node.childNodes?.length))).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openProgress(page)
  await page.getByRole('button', { name: 'Transfer to another device…', exact: true }).click()
  await page.getByRole('button', { name: 'Create transfer snapshot', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Progress transfer QR code', exact: true })).toBeVisible()
  const generatedLink = await page.getByRole('textbox', { name: 'Private transfer link', exact: true }).inputValue()
  await page.evaluate((proof) => {
    const button = document.createElement('button'); button.id = 'transfer-public-replay-proof'; button.textContent = proof
    document.querySelector('dialog')!.appendChild(button)
  }, publicMarker)
  await page.locator('#transfer-public-replay-proof').click()
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 3 && JSON.stringify(event).includes(publicMarker)))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const privateValue of [marker, encoded.token, generatedLink, '314159']) expect(evidence).not.toContain(privateValue)
  expect(capture.unexpected).toEqual([])
})

test('transfer URL cleanup failure prevents tracker and recorder startup', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const encoded = await encodeProgressTransfer(catalog, initial, 'native')
  if (!encoded.ok) throw new Error(encoded.error)
  const capture = await installLocalRoutes(context, origin)
  await serveIsolatedApplication(context, origin)
  await page.addInitScript(() => { history.replaceState = () => { throw new DOMException('Synthetic blocked transfer URL cleanup', 'SecurityError') } })
  await page.goto(progressTransferLink(encoded.token, origin, appFixturePath))
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).toContainText('Tracking was kept off')
  expect(capture.scriptRequests).toEqual([])
  expect(capture.submissions).toEqual([])
  expect(capture.unexpected).toEqual([])
})

for (const tracking of ['enabled', 'disabled'] as const) {
  for (const outcome of ['valid', 'malformed', 'navigate away'] as const) {
    test(`deferred catalog receives only the latest transfer ${outcome} with tracking ${tracking}`, async ({ page, context, baseURL }) => {
      const origin = new URL(baseURL!).origin
      const marker = 'SENTINEL-delayed-transfer-profile-61928'
      const destination = { ...initial, epoch: 2, purchases: { [catalog.startId]: { epoch: 2, active: true } } }
      const incoming = { ...initial, epoch: 7, purchases: { [catalog.startId]: { epoch: 7, active: true }, [marker]: { epoch: 3, active: false } } }
      const older = await encodeProgressTransfer(catalog, { ...incoming, epoch: 8 }, 'native')
      const latest = await encodeProgressTransfer(catalog, incoming, 'web')
      if (!older.ok || !latest.ok) throw new Error('Synthetic delayed-transfer fixture failed')
      const capture = await installLocalRoutes(context, origin)
      await serveIsolatedApplication(context, origin)
      let releaseCatalog!: () => void
      const catalogReady = new Promise<void>((resolve) => { releaseCatalog = resolve })
      await context.route(`${origin}${appFixturePath}catalog.json`, async (route) => {
        await catalogReady
        await route.fulfill({ json: catalog })
      })
      await page.addInitScript(({ preferenceKey, profileKey, tracking, destination }) => {
        localStorage.setItem(preferenceKey, tracking); localStorage.setItem(profileKey, JSON.stringify(destination))
      }, { preferenceKey, profileKey, tracking, destination })
      const requests: { url: string; referrer: string | undefined }[] = []
      page.on('request', (request) => requests.push({ url: request.url(), referrer: request.headers().referer }))
      await page.goto(outcome === 'valid' ? `${origin}${appMapPath}` : progressTransferLink(older.token, origin, appFixturePath))
      await expect(page.getByRole('status')).toHaveText('Opening your companion…')
      expect(new URL(page.url()).hash).toBe('')
      if (tracking === 'enabled') {
        await waitForActive(page)
        await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
      }
      // Exercise supersession before either the catalog or Atlas exists. The
      // early listener must run ahead of the production URL sanitizer.
      for (const hash of ['#transfer=v1.invalid', `#transfer=${latest.token}`]) {
        await page.evaluate((value) => { location.hash = value }, hash)
        await expect.poll(() => new URL(page.url()).hash).toBe('')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      if (outcome === 'malformed') {
        await page.evaluate(() => { location.hash = '#transfer=v1.invalid' })
        await expect.poll(() => new URL(page.url()).hash).toBe('')
      } else if (outcome === 'navigate away') {
        await page.evaluate(() => { location.hash = '#elsewhere' })
        // Public-reference startup now cleans arbitrary addresses regardless
        // of tracking preference; cancellation must survive that cleanup.
        await expect.poll(() => new URL(page.url()).hash).toBe('')
      }
      releaseCatalog()
      await expect(page.locator('.toolbar')).toBeVisible()
      const receiver = page.getByRole('dialog', { name: 'Transfer map progress', exact: true })
      if (outcome === 'navigate away') {
        await expect(page.getByRole('dialog')).toHaveCount(0)
      } else {
        await expect(receiver).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(1)
        if (outcome === 'valid') {
          await expect(receiver.getByRole('heading', { name: 'Review transfer', exact: true })).toBeFocused()
          await expect(receiver.getByRole('row', { name: 'Ultra Ascensions 2 7', exact: true })).toBeVisible()
        } else {
          await expect(receiver.locator('.dialog-feedback')).toContainText('incomplete, corrupt or unsupported')
          await expect(receiver.getByRole('button', { name: 'Apply transfer', exact: true })).toHaveCount(0)
        }
        await receiver.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)).toEqual(destination)
      expect(await page.evaluate((key) => localStorage.getItem(key), preferenceKey)).toBe(tracking)
      const evidence = JSON.stringify({ submissions: capture.submissions, replay: replayEvents(capture), requests })
      for (const secret of [marker, older.token, latest.token, 'transfer=']) expect(evidence).not.toContain(secret)
      if (tracking === 'disabled') { expect(capture.scriptRequests).toEqual([]); expect(capture.submissions).toEqual([]) }
      expect(capture.unexpected).toEqual([])
    })
  }
}
test('continuing the final eligible suggestion reports the fresh all-owned reason once', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin, { recorderBody: '' })
  await serveIsolatedApplication(context, origin)
  const profile = { ...initial, purchases: Object.fromEntries(catalog.upgrades.filter((upgrade) => upgrade.id !== catalog.startId).map((upgrade) => [upgrade.id, { epoch: 0, active: true }])) }
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: profileKey, profile })
  await page.goto(`${origin}${appMapPath}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await waitForActive(page)
  const reasons = () => capture.submissions.filter((submission) => submission.type === 'event' && submission.payload.name === 'recommendations_viewed').map((submission) => (submission.payload.data as Record<string, unknown>).reason)
  await page.getByRole('button', { name: 'Next upgrade', exact: true }).click()
  const suggestions = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
  await expect(suggestions.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', catalog.startId)
  await expect.poll(reasons).toEqual(['wiki'])
  await suggestions.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Record purchase?', exact: true }).getByRole('button', { name: 'Apply and continue suggestions', exact: true }).click()
  await expect(suggestions).toContainText('Every visible upgrade is already recorded as owned')
  await expect.poll(reasons).toEqual(['wiki', 'all-owned'])
  expect(capture.submissions.filter((submission) => submission.payload.name === 'recommendation_purchase_applied')).toHaveLength(1)
  expect(capture.unexpected).toEqual([])
})


test('exact upgrade references keep native recorder URLs and referrers clean and suspend dirty live navigation', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const capture = await installLocalRoutes(context, origin)
  await serveIsolatedApplication(context, origin)
  const hidden = catalog.upgrades.find((upgrade) => !visible.ids.has(upgrade.id))!
  await page.goto(`${origin}${appMapPath}?private=${secrets.url}#upgrade=${hidden.id}&catalog=${catalog.revision}`)
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.toast')).toContainText('unavailable under your current spoiler setting')
  await waitForActive(page)
  expect(page.url()).toBe(`${origin}${appMapPath}`)
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2))
  const decoded = JSON.stringify({ submissions: capture.submissions, replay: events })
  expect(decoded).not.toContain(hidden.id)
  expect(decoded).not.toContain(secrets.url)
  expect(capture.submissions.filter((item) => ['record', 'heatmap', 'event'].includes(item.type)).every((item) => !String(item.payload.url).includes('upgrade=') && !String(item.payload.url).includes('#'))).toBe(true)
  const before = capture.submissions.filter((item) => ['record', 'heatmap'].includes(item.type)).length
  await page.evaluate(({ id, revision }) => { location.hash = `upgrade=${id}&catalog=${revision}` }, { id: catalog.startId, revision: catalog.revision })
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  await expect.poll(() => page.url()).toBe(`${origin}${appMapPath}`)
  const submitted = capture.submissions.filter((item) => ['record', 'heatmap'].includes(item.type)).length
  expect(submitted).toBe(before)
  await page.evaluate(() => { document.body.appendChild(Object.assign(document.createElement('p'), { textContent: 'SENTINEL-after-reference-suspension' })) })
  // The real recorder rereads the guarded session cache on flush. Existing
  // URL privacy tests cover the longer buffering window; this directly
  // verifies its final public accessor cannot resume this document.
  expect(await page.evaluate(() => (window as Window & { umami?: { getSession?: () => { cache?: string } } }).umami?.getSession?.().cache)).toBeUndefined()

})

test('reference sheet selections and full outgoing document stay blocked in actual recorder evidence', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  await page.goto(`${origin}${appMapPath}`); await expect(page.locator('.toolbar')).toBeVisible()
  await page.locator(`.react-flow__node[data-id="${catalog.startId}"]`).click()
  const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
  await page.getByRole('button', { name: 'Add to reference sheet', exact: true }).click()
  const menu = page.getByRole('button', { name: 'Map options', exact: true })
  if (await menu.isVisible()) await menu.click(); else await page.getByRole('button', { name: 'Map view…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Reference sheet', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Upgrade reference sheet', exact: true })
  await dialog.getByRole('button', { name: 'Review outgoing sheet', exact: true }).click()
  const marker = 'REFERENCE_SHEET_PRIVATE_SNAPSHOT'
  const snapshotProof = 'REFERENCE_SHEET_PUBLIC_SNAPSHOT'
  const mutationProof = 'REFERENCE_SHEET_PUBLIC_MUTATION'
  await dialog.locator('.reference-sheet-panel').evaluate((panel, marker) => { const node = document.createElement('p'); node.textContent = marker; panel.appendChild(node) }, marker)
  await dialog.evaluate((element, proof) => { const node = document.createElement('p'); node.id = 'reference-sheet-proof'; node.textContent = proof; element.appendChild(node) }, snapshotProof)
  await waitForActive(page); releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(snapshotProof)))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('reference-sheet-panel') && !(node.childNodes?.length))).toBe(true)
  await page.locator('#reference-sheet-proof').evaluate((node, proof) => { node.textContent = proof }, mutationProof)
  await page.locator('#reference-sheet-proof').click()
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 3 && JSON.stringify(event).includes(mutationProof)))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  expect(evidence).not.toContain(marker); expect(evidence).not.toContain('srcdoc'); expect(evidence).not.toContain('This bounded sheet contains')
  expect(capture.submissions.some((submission) => String(submission.payload.name).includes('reference'))).toBe(false)
  expect(capture.unexpected).toEqual([])
})

test('hypothetical UA names, stage choices and results stay blocked in real recorder snapshots and mutations', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let releaseRecorder!: () => void
  const recorderReady = new Promise<void>((resolve) => { releaseRecorder = resolve })
  const capture = await installLocalRoutes(context, origin, { recorderReady })
  await serveIsolatedApplication(context, origin)
  const name = 'ROADMAP_PRIVATE_NAME_74621', query = 'ROADMAP_PRIVATE_QUERY_63928', snapshotProof = 'ROADMAP_PUBLIC_SNAPSHOT', mutationProof = 'ROADMAP_PUBLIC_MUTATION'
  await page.goto(`${origin}${appMapPath}`); await expect(page.locator('.toolbar')).toBeVisible()
  const compact = page.getByRole('button', { name: 'Map options', exact: true })
  await (await compact.isVisible() ? compact : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Plan hypothetical UAs…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Hypothetical UA roadmap', exact: true })
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill(name)
  const picker = dialog.locator('.roadmap-picker'); await picker.locator('summary').click(); const input = picker.getByRole('searchbox')
  await input.fill('Legendary Belt'); await picker.locator(`[data-roadmap-choice="${catalog.upgrades.find((node) => node.title === 'Legendary Belt')!.id}"]`).click(); await dialog.getByRole('radio').first().check()
  await dialog.evaluate((element, proof) => { const node = document.createElement('p'); node.id = 'roadmap-replay-proof'; node.textContent = proof; element.appendChild(node) }, snapshotProof)
  await waitForActive(page); releaseRecorder()
  const snapshot = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 2 && JSON.stringify(event).includes(snapshotProof)))
  expect(blockedReplayNodes(snapshot).some((node) => node.attributes.class.includes('ua-roadmap') && !node.childNodes?.length)).toBe(true)
  await picker.locator('summary').click(); await input.fill(query)
  await page.locator('#roadmap-replay-proof').evaluate((node, proof) => { node.textContent = proof }, mutationProof); await page.locator('#roadmap-replay-proof').click()
  const events = await waitForReplayEvents(capture, (events) => events.some((event) => event.type === 3 && JSON.stringify(event).includes(mutationProof)))
  const evidence = JSON.stringify({ submissions: capture.submissions, replay: events })
  for (const privateText of [name, query, 'Exact purchase sum across stages', 'Explicit OR choices', 'Intend route 1 for this stage']) expect(evidence).not.toContain(privateText)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBeNull()
  expect(capture.submissions.some((entry) => /roadmap|purchase|milestone/.test(String(entry.payload.name)))).toBe(false)
  expect(capture.unexpected).toEqual([])
})
