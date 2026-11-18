import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { offlineRelease, renderWorker } from '../../scripts/pwa'
import { emptyProfile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY as LEGACY_PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { COMPANION_STORAGE_KEY as PROFILE_STORAGE_KEY } from '../../src/domain/companion-storage'
import { emptyCompanionProgress } from '../../src/domain/companion-progress'
import type { Profile } from '../../src/domain/types'
import { ANALYTICS_PREFERENCE_KEY } from '../../src/analytics'
import { LAYOUT_PREFERENCE_KEY } from '../../src/domain/layout-preference'
import { encodeProgressTransfer, progressTransferLink } from '../../src/domain/progress-transfer'
import { upgradeReferenceURL } from '../../src/domain/upgrade-reference'
import { CHECKPOINT_STORAGE_KEY } from '../../src/domain/checkpoints'
import { COMPARISON_STORAGE_KEY } from '../../src/domain/saved-comparison'
import { COMPANION_WORKSPACE_KEY as GOALS_STORAGE_KEY } from '../../src/useCompanionWorkspace'
import { openAction, openProgress } from './helpers/app'

test.use({ serviceWorkers: 'allow', appServiceWorkers: true })
const base = '/utilities/idle-slayer-companion/'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8'))
async function replaceMapProgress(page: Page, profile: Profile) {
  const progress = emptyCompanionProgress(catalog.revision); progress.ascension = profile
  await page.evaluate(({ key, legacyKey, progress }) => {
    const previous = localStorage.getItem(key)
    const stored = previous ? JSON.parse(previous) : { format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: localStorage.getItem(legacyKey), progress }
    stored.progress.ascension = progress.ascension
    localStorage.setItem(key, JSON.stringify(stored))
  }, { key: PROFILE_STORAGE_KEY, legacyKey: LEGACY_PROFILE_STORAGE_KEY, progress })
}
async function openInstall(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  await openAction(page, 'Install & offline')
}
async function offlineReady(page: Page) {
  await openInstall(page)
  await expect(page.locator('.offline-status')).toContainText('saved for offline reopening', { timeout: 45000 })
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}
async function purchase(page: Page) {
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect.poll(() => page.evaluate(({ key, id }) => Boolean(JSON.parse(localStorage.getItem(key) ?? '{}').progress?.ascension.purchases?.[id]), { key: PROFILE_STORAGE_KEY, id: catalog.startId })).toBe(true)
}

async function deferRepair(page: Page, phase: 'checking' | 'committed') {
  await page.evaluate((phase) => {
    const state = window as Window & { releasePwaRepair?: () => Promise<void>; pwaUnregisters?: number }
    state.pwaUnregisters = 0
    const unregister = ServiceWorkerRegistration.prototype.unregister
    ServiceWorkerRegistration.prototype.unregister = function () {
      state.pwaUnregisters!++
      if (phase === 'committed') return new Promise<boolean>((resolve) => { state.releasePwaRepair = async () => resolve(await unregister.call(this)) })
      return unregister.call(this)
    }
    if (phase === 'checking') {
      const post = ServiceWorker.prototype.postMessage
      ServiceWorker.prototype.postMessage = function (message, transfer) {
        if (message?.type !== 'CHECK_WINDOWS') { post.call(this, message, Array.isArray(transfer) ? { transfer } : transfer); return }
        state.releasePwaRepair = () => new Promise<void>((resolve) => {
          const bridge = new MessageChannel()
          bridge.port1.onmessage = (event) => {
            const ports = Array.isArray(transfer) ? transfer : transfer?.transfer ?? []
            ;(ports[0] as MessagePort).postMessage(event.data)
            bridge.port1.close(); resolve()
          }
          post.call(this, message, { transfer: [bridge.port2] })
        })
      }
    }
  }, phase)
}

test('a queued installation opener cannot replace a purchase or transfer preview', async ({ page }) => {
  await page.goto('./ascension/'); await offlineReady(page)
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.locator('.companion-sidebar-bottom').getByRole('button', { name: 'Install & offline', exact: true, includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openProgress(page); await page.getByRole('button', { name: 'Receive transfer…', exact: true }).click()
  await page.locator('.companion-sidebar-bottom').getByRole('button', { name: 'Install & offline', exact: true, includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole('dialog', { name: 'Transfer map progress', exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
})

for (const phase of ['checking', 'committed'] as const) {
  test(`a queued purchase opener respects the ${phase} repair guard`, async ({ page }) => {
    await page.goto('./ascension/'); await offlineReady(page)
    await page.getByRole('button', { name: 'Return to start', exact: true }).click()
    await deferRepair(page, phase); await openInstall(page)
    await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
    await page.getByRole('button', { name: 'Reload with saved progress', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toContainText(phase === 'checking' ? 'Checking other map windows' : 'Repair started')
    await page.locator('.details button.primary.full').evaluate((button: HTMLButtonElement) => button.click())
    if (phase === 'committed') {
      await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toHaveCount(0)
    } else {
      await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toBeVisible()
      await page.evaluate(async () => await (window as Window & { releasePwaRepair?: () => Promise<void> }).releasePwaRepair!())
      await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toBeVisible()
      expect(await page.evaluate(() => (window as Window & { pwaUnregisters?: number }).pwaUnregisters)).toBe(0)
    }
    await expect(page.locator('dialog[open]')).toHaveCount(1)
  })
}

for (const phase of ['checking', 'committed'] as const) {
  for (const arrival of ['transfer', 'reference'] as const) {
    test(`an incoming ${arrival} cancels ${phase} repair before a late reply can reload its review`, async ({ page }) => {
      await page.goto('./ascension/'); await offlineReady(page); await deferRepair(page, phase)
      const original = await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)
      await openInstall(page)
      await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
      await page.getByRole('button', { name: 'Reload with saved progress', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toContainText(phase === 'checking' ? 'Checking other map windows' : 'Repair started')
      const incoming = emptyProfile(catalog.revision); incoming.epoch = 4
      const encoded = await encodeProgressTransfer(catalog, incoming, 'web')
      if (!encoded.ok) throw new Error(encoded.error)
      const link = arrival === 'transfer' ? progressTransferLink(encoded.token, new URL(page.url()).origin, base)
        : upgradeReferenceURL(page.url(), catalog.startId, catalog.revision)
      await page.evaluate((fragment) => { location.hash = fragment }, new URL(link).hash)
      if (arrival === 'transfer') await expect(page.getByRole('button', { name: 'Apply transfer', exact: true })).toBeEnabled()
      else await expect(page.locator('.details h2')).toHaveText(catalog.upgrades.find((node: { id: string }) => node.id === catalog.startId).title)
      await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toHaveCount(0)
      await expect.poll(() => new URL(page.url()).hash).toBe('')
      await page.evaluate(async () => await (window as Window & { releasePwaRepair?: () => Promise<void> }).releasePwaRepair!())
      if (arrival === 'transfer') await expect(page.getByRole('dialog', { name: 'Transfer map progress', exact: true })).toBeVisible()
      else await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)).toBe(original)
      expect(await page.evaluate(() => (window as Window & { pwaUnregisters?: number }).pwaUnregisters)).toBe(phase === 'checking' ? 0 : 1)
    })
  }
}

test('a private incoming transfer can be reviewed and applied offline without entering the public cache', async ({ page, context }) => {
  await page.goto('./ascension/'); await offlineReady(page)
  const incoming = emptyProfile(catalog.revision); incoming.epoch = 4
  incoming.purchases['offline-private-unknown'] = { epoch: 2, active: false }
  const encoded = await encodeProgressTransfer(catalog, incoming, 'web')
  if (!encoded.ok) throw new Error(encoded.error)
  await context.setOffline(true)
  await page.evaluate((fragment) => { location.hash = fragment }, new URL(progressTransferLink(encoded.token, new URL(page.url()).origin, base)).hash)
  const dialog = page.getByRole('dialog', { name: 'Transfer map progress', exact: true })
  await expect(dialog.getByRole('button', { name: 'Apply transfer', exact: true })).toBeEnabled()
  await expect(dialog).not.toContainText('offline-private-unknown')
  await dialog.getByRole('button', { name: 'Apply transfer', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').progress?.ascension.epoch, PROFILE_STORAGE_KEY)).toBe(4)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).progress.ascension.purchases['offline-private-unknown'], PROFILE_STORAGE_KEY)).toEqual({ epoch: 2, active: false })
  expect(await page.evaluate((key) => localStorage.getItem(key), LAYOUT_PREFERENCE_KEY)).toBe('web')
  const cachedURLs = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat())
  expect(cachedURLs.every((url) => !url.includes('?') && !url.includes('#') && !url.includes('private'))).toBe(true)
  const progress = await openProgress(page)
  await progress.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').progress?.ascension.epoch, PROFILE_STORAGE_KEY)).toBe(0)
})

for (const outcome of ['read error', 'new registration', 'URI change'] as const) {
  test(`a retry absence read keeps ${outcome} safe without a stale reload`, async ({ page }) => {
    await page.goto('./ascension/'); await offlineReady(page)
    await page.evaluate(() => { (window as Window & { nativePwaUnregister?: typeof ServiceWorkerRegistration.prototype.unregister }).nativePwaUnregister = ServiceWorkerRegistration.prototype.unregister })
    await deferRepair(page, 'committed'); await openInstall(page)
    await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
    await page.getByRole('button', { name: 'Reload with saved progress', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toContainText('Repair started')
    await page.evaluate(() => { location.hash = 'transfer=v1.invalid' })
    await expect(page.getByRole('dialog', { name: 'Transfer map progress', exact: true })).toBeVisible()
    await page.evaluate(async () => await (window as Window & { releasePwaRepair?: () => Promise<void> }).releasePwaRepair!())
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    const original = await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)
    await page.evaluate(() => {
      document.body.dataset.pwaVisit = 'original-retry-document'
      ServiceWorkerRegistration.prototype.unregister = (window as Window & { nativePwaUnregister?: typeof ServiceWorkerRegistration.prototype.unregister }).nativePwaUnregister!
      navigator.serviceWorker.getRegistration = () => new Promise<ServiceWorkerRegistration | undefined>((resolve, reject) => {
        Object.assign(window, { resolvePwaAbsence: resolve, rejectPwaAbsence: reject })
      })
    })
    await openInstall(page)
    await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
    await page.getByRole('button', { name: 'Reload with saved progress', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { resolvePwaAbsence?: unknown }).resolvePwaAbsence))).toBe(true)
    await page.evaluate(async ({ outcome, id, revision, base }) => {
      const win = window as Window & { resolvePwaAbsence?: (value: ServiceWorkerRegistration | undefined) => void; rejectPwaAbsence?: (reason: Error) => void }
      if (outcome === 'read error') win.rejectPwaAbsence!(new DOMException('Synthetic lookup refusal', 'SecurityError'))
      else if (outcome === 'new registration') win.resolvePwaAbsence!(await navigator.serviceWorker.register(base + 'sw.js', { scope: base }))
      else {
        // Resolve in the same task as URI mutation, before queued hash listeners.
        location.hash = new URLSearchParams({ upgrade: id, catalog: revision }).toString()
        win.resolvePwaAbsence!(undefined)
      }
    }, { outcome, id: catalog.startId, revision: catalog.revision, base })
    if (outcome === 'URI change') await expect(page.getByRole('dialog')).toHaveCount(0)
    else await expect(page.getByRole('dialog', { name: 'Install & offline', exact: true })).toContainText('Offline repair could not start')
    expect(await page.locator('body').getAttribute('data-pwa-visit')).toBe('original-retry-document')
    expect(await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)).toBe(original)
  })
}

test('an incoming private transfer aborts startup repair while catalog files are unavailable', async ({ page }) => {
  await page.goto('./ascension/'); await offlineReady(page); await purchase(page)
  const original = await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)
  await page.evaluate(async () => {
    for (const name of await caches.keys()) await (await caches.open(name)).delete(new URL('/utilities/idle-slayer-companion/catalog.json', location.href).href)
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ascension catalog unavailable', exact: true })).toBeVisible()
  await deferRepair(page, 'checking')
  await openAction(page, 'Install & offline')
  await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { releasePwaRepair?: () => Promise<void> }).releasePwaRepair))).toBe(true)
  const incoming = emptyProfile(catalog.revision); incoming.purchases['startup-private-unknown'] = { epoch: 0, active: true }
  const encoded = await encodeProgressTransfer(catalog, incoming, 'web')
  if (!encoded.ok) throw new Error(encoded.error)
  await page.evaluate((fragment) => { location.hash = fragment }, new URL(progressTransferLink(encoded.token, new URL(page.url()).origin, base)).hash)
  await expect.poll(() => new URL(page.url()).hash).toBe('')
  await page.evaluate(async () => await (window as Window & { releasePwaRepair?: () => Promise<void> }).releasePwaRepair!())
  expect(await page.evaluate(() => (window as Window & { pwaUnregisters?: number }).pwaUnregisters)).toBe(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)).toBe(original)
  await expect(page.locator('body')).not.toContainText(encoded.token)
  await expect(page.locator('body')).not.toContainText('startup-private-unknown')
  await expect(page.getByRole('heading', { name: 'Ascension catalog unavailable', exact: true })).toBeVisible()
})

for (const kind of ['checkpoint', 'comparison', 'goal'] as const) {
  test(`unsaved ${kind} state requires separate recovery before app repair and remains usable`, async ({ page }) => {
    await page.goto('./ascension/'); await offlineReady(page)
    const original = await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)
    const key = kind === 'checkpoint' ? CHECKPOINT_STORAGE_KEY : kind === 'comparison' ? COMPARISON_STORAGE_KEY : GOALS_STORAGE_KEY
    await page.evaluate((key) => {
      const native = Storage.prototype.setItem
      ;(window as Window & { denyPwaReferenceWrites?: boolean }).denyPwaReferenceWrites = true
      Storage.prototype.setItem = function (name, value) {
        if (name === key && (window as Window & { denyPwaReferenceWrites?: boolean }).denyPwaReferenceWrites) throw new DOMException('Synthetic refusal', 'QuotaExceededError')
        native.call(this, name, value)
      }
    }, key)
    if (kind === 'checkpoint') {
      await openProgress(page); await page.getByRole('button', { name: 'Progress checkpoints…', exact: true }).click()
      await page.getByLabel('Name current checkpoint', { exact: true }).fill('private unsaved reference')
      await page.getByRole('button', { name: 'Capture current progress', exact: true }).click()
      await expect(page.getByRole('status', { name: 'Checkpoint storage and actions' })).toContainText('Saving failed')
    } else {
      await page.getByRole('button', { name: 'Return to start', exact: true }).click()
      const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
      await page.getByRole('button', { name: kind === 'goal' ? 'Set progression goal…' : 'Compare this upgrade…', exact: true }).click()
      if (kind === 'goal') { await page.getByRole('button', { name: 'Save goal', exact: true }).click(); await expect(page.locator('.goals-panel')).toContainText('Intentions could not be saved') }
      else {
        const picker = page.locator('.saved-comparison-picker')
        if (await picker.getAttribute('open') === null) await picker.locator('summary').click()
        await picker.locator(`button[data-upgrade-id="${catalog.startId}"]`).click()
        await expect(page.getByRole('status', { name: 'Comparison storage and actions' })).toContainText('Saving failed')
      }
    }
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await openInstall(page)
    await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Install & offline', exact: true })).toContainText('A progress backup does not include')
    await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: `Review ${kind} recovery`, exact: true }).click()
    await page.evaluate(() => { (window as Window & { denyPwaReferenceWrites?: boolean }).denyPwaReferenceWrites = false })
    if (kind === 'goal') {
      await expect(page.locator('.goal-list li')).toHaveCount(1)
      await page.getByRole('button', { name: "Save this visit's goals…", exact: true }).click()
      const recovery = page.getByRole('region', { name: 'Review intentions recovery', exact: true })
      await expect(recovery).toBeVisible()
      await recovery.getByRole('button', { name: 'Replace checked saved intentions with this visit', exact: true }).click()
      await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').workspace?.goals?.length, key)).toBe(1)
    } else await page.getByRole('button', { name: kind === 'checkpoint' ? 'Retry checkpoint saving' : 'Retry saving comparison', exact: true }).click()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull()
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await openInstall(page)
    await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.evaluate((key) => localStorage.getItem(key), PROFILE_STORAGE_KEY)).toBe(original)
  })
}

test('complete manifest, offline reopen and new-window purchases persist without caching private requests', async ({ page, context }) => {
  await page.goto('./ascension/')
  await offlineReady(page)
  const manifest = await page.evaluate(async () => await (await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href)).json())
  expect(manifest).toMatchObject({ id: '/utilities/idle-slayer-companion/', start_url: base, scope: base, display: 'standalone' })
  expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toEqual(['any', 'any', 'maskable'])
  await page.evaluate(async () => {
    await fetch('catalog.json?transfer=synthetic-private-marker').catch(() => {})
    await fetch('synthetic-private-backup.json').catch(() => {})
    await fetch('https://analytics.invalid/api/send', { method: 'POST', body: 'synthetic-private-marker' }).catch(() => {})
  })
  const keys = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat())
  const inventory = JSON.parse(readFileSync('dist/offline-assets.json', 'utf8'))
  expect(keys).toHaveLength(inventory.assets.length)
  expect(keys.every((url) => url.startsWith(new URL(base, page.url()).href) && !url.includes('?') && !url.includes('#') && !url.includes('synthetic'))).toBe(true)
  expect(keys.filter((url) => url.includes('/assets/upgrades/'))).toHaveLength(288)
  expect(keys.some((url) => url.endsWith('.woff2'))).toBe(true)
  expect(keys.some((url) => url.endsWith('/licenses/index.html'))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.toolbar')).toBeVisible()
  await purchase(page)
  const offlineWindow = await context.newPage()
  await offlineWindow.goto(page.url())
  await expect(offlineWindow.locator('.toolbar')).toBeVisible()
  await expect(offlineWindow.locator('.map-summary')).toContainText('1 /')
  expect(await offlineWindow.locator('.upgrade-icon').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  await offlineWindow.goto(new URL(base + 'licenses/index.html', page.url()).href)
  await expect(offlineWindow.getByRole('heading', { name: 'Bundled software licenses', exact: true })).toBeVisible()
})

test('every companion section reopens offline while the legacy cache remains independent', async ({ page, context }) => {
  // A public file establishes the local origin without starting the app worker.
  await page.goto(base + 'manifest.webmanifest')
  await page.evaluate(async () => {
    const cache = await caches.open('ascension-map-public-synthetic-compatibility')
    await cache.put(new URL('/idle-slayer-ascension-map/index.html', location.origin), new Response('Synthetic legacy compatibility release'))
  })
  await page.goto(base + 'ascension/'); await offlineReady(page)
  expect(await page.evaluate(async () => caches.keys())).toContain('ascension-map-public-synthetic-compatibility')
  await context.setOffline(true)
  for (const [section, title] of [['overview', 'Overview'], ['achievements', 'Achievements'], ['crafting', 'Crafting & materials'], ['quests', 'Quests & Village'], ['bestiary', 'Bestiary'], ['divinities', 'Divinities']] as const) {
    await page.goto(base + (section === 'overview' ? '' : section + '/') + '?private=synthetic-offline-marker')
    await expect(page.getByRole('main', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('main', { name: title, exact: true }).getByRole('heading', { level: 1 })).toBeVisible()
  }
  const currentKeys = await page.evaluate(async () => {
    const name = (await caches.keys()).find((key) => key.startsWith('austingarrod-idle-slayer-companion-public-'))!
    return (await (await caches.open(name)).keys()).map((request) => request.url)
  })
  expect(currentKeys.some((url) => url.endsWith('/companion-catalog.json'))).toBe(true)
  expect(currentKeys.some((url) => url.includes('/assets/companion/'))).toBe(true)
  expect(currentKeys.every((url) => !url.includes('?') && !url.includes('#') && !url.includes('synthetic'))).toBe(true)
  expect(await page.evaluate(async () => caches.keys())).toContain('ascension-map-public-synthetic-compatibility')
})

test('unsupported prompts, supported prompt and standalone guidance stay truthful', async ({ page }) => {
  await page.goto('./ascension/'); await openInstall(page)
  await expect(page.getByRole('button', { name: 'Install Idle Slayer Companion', exact: true })).toHaveCount(0)
  await expect(page.locator('.install-guidance')).toContainText('iPhone / iPad')
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt')
    Object.assign(event, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) })
    window.dispatchEvent(event)
  })
  await page.getByRole('button', { name: 'Install Idle Slayer Companion', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Installation dismissed')
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(page.getByRole('dialog')).toContainText('Installed in this browser')
  await expect(page.locator('.install-guidance')).toHaveCount(0)
})

test('install guidance and recovery actions fit narrow portrait and short landscape windows', async ({ page }, testInfo) => {
  await page.goto('./ascension/')
  for (const [width, height] of [[320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height }); await openInstall(page)
    const dialog = page.getByRole('dialog', { name: 'Install & offline', exact: true })
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const repair = page.getByRole('button', { name: 'Repair offline files and reload…', exact: true })
    await repair.scrollIntoViewIfNeeded(); await expect(repair).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`install-${width}x${height}.png`) })
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  }
})

test('denied offline availability explains retry and keeps the online map usable', async ({ page }) => {
  await page.addInitScript(() => {
    const native = navigator.serviceWorker.register.bind(navigator.serviceWorker)
    navigator.serviceWorker.register = (...args) => native(...args).then(() => { throw new DOMException('Synthetic refusal', 'SecurityError') })
  })
  await page.goto('./ascension/'); await openInstall(page)
  await expect(page.locator('.offline-status')).toContainText('not ready')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await purchase(page)
})

test('evicted app files explain offline recovery and repairing keeps saved progress', async ({ page, context }) => {
  await page.goto('./ascension/'); await offlineReady(page); await purchase(page)
  await page.evaluate(async () => { for (const name of await caches.keys()) await (await caches.open(name)).delete(new URL('index.html', location.href).href) })
  await context.setOffline(true); await page.reload()
  await expect(page.getByRole('heading', { name: 'Reconnect to reopen your companion', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Repair app files and reload', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Connect to the internet')
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Repair app files and reload', exact: true }).click()
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await openInstall(page)
  await expect(page.locator('.offline-status')).toContainText('saved for offline reopening', { timeout: 45000 })
})

for (const dismissal of ['Cancel', 'Close dialog', 'Escape', 'external progress'] as const) {
  test(`a delayed repair reply cannot reload a new preview after ${dismissal}`, async ({ page, context }) => {
    await page.goto('./ascension/'); await offlineReady(page)
    await page.evaluate(() => {
      const native = ServiceWorker.prototype.postMessage
      const unregister = ServiceWorkerRegistration.prototype.unregister
      const state = window as Window & { releaseRepair?: () => Promise<void>; repairUnregisters?: number }
      state.repairUnregisters = 0
      ServiceWorkerRegistration.prototype.unregister = function () { state.repairUnregisters!++; return unregister.call(this) }
      ServiceWorker.prototype.postMessage = function (message, transfer) {
        if (message?.type === 'CHECK_WINDOWS') {
          const worker = this
          state.releaseRepair = () => new Promise<void>((resolve) => {
            const bridge = new MessageChannel()
            bridge.port1.onmessage = (event) => {
              // Forward the real worker reply after cancellation, reproducing
              // its delayed delivery without changing the app's repair logic.
              const ports = Array.isArray(transfer) ? transfer : transfer?.transfer ?? []
              ;(ports[0] as MessagePort).postMessage(event.data)
              bridge.port1.close(); resolve()
            }
            native.call(worker, message, { transfer: [bridge.port2] })
          })
          return
        }
        native.call(this, message, Array.isArray(transfer) ? { transfer } : transfer)
      }
    })
    await openInstall(page)
    await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
    await page.getByRole('button', { name: 'Reload with saved progress', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toContainText('Checking other map windows')
    await expect(page.getByRole('button', { name: 'Reload with saved progress', exact: true })).toBeDisabled()
    if (dismissal === 'external progress') {
      const other = await context.newPage(); await other.goto(page.url())
      const changed = emptyProfile(catalog.revision); changed.epoch = 1
      await replaceMapProgress(other, changed)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await other.close()
    } else {
      if (dismissal === 'Escape') await page.keyboard.press('Escape')
      else await page.getByRole('button', { name: dismissal, exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Install & offline', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Return to start', exact: true }).click()
    await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Record purchase?', exact: true })
    await expect(preview).toBeVisible()
    await page.evaluate(async () => await (window as Window & { releaseRepair?: () => Promise<void> }).releaseRepair!())
    await expect(preview).toBeVisible()
    expect(await page.evaluate(() => (window as Window & { repairUnregisters?: number }).repairUnregisters)).toBe(0)
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active))).toBe(true)
  })
}

test('committed repair blocks dismissal and duplicate actions, and external invalidation cancels its later reload', async ({ page, context }) => {
  await page.goto('./ascension/'); await offlineReady(page)
  await page.evaluate(() => {
    const native = ServiceWorkerRegistration.prototype.unregister
    ServiceWorkerRegistration.prototype.unregister = function () {
      const registration = this
      return new Promise<boolean>((resolve) => {
        (window as Window & { finishUnregister?: () => Promise<void> }).finishUnregister = async () => resolve(await native.call(registration))
      })
    }
  })
  await openInstall(page)
  await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
  await page.getByRole('button', { name: 'Reload with saved progress', exact: true }).click()
  const repair = page.getByRole('dialog', { name: 'Reload the app?', exact: true })
  await expect(repair).toContainText('Repair started')
  for (const name of ['Close dialog', 'Cancel', 'Export backup and reload', 'Reload with saved progress']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  }
  await page.keyboard.press('Escape'); await expect(repair).toBeVisible()
  const other = await context.newPage(); await other.goto(page.url())
  const changed = emptyProfile(catalog.revision); changed.epoch = 1
  await replaceMapProgress(other, changed)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await other.close()
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Record purchase?', exact: true })
  await expect(preview).toBeVisible()
  await page.evaluate(async () => await (window as Window & { finishUnregister?: () => Promise<void> }).finishUnregister!())
  await expect(preview).toBeVisible()
  expect(await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(false)
  // The document retains the old activated object after unregister. A second
  // explicit repair must accept an already absent scope and remain usable.
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openInstall(page)
  await page.getByRole('button', { name: 'Repair offline files and reload…', exact: true }).click()
  await page.getByRole('button', { name: 'Reload with saved progress', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Reload the app?', exact: true })).toContainText('Repair started')
  const reloaded = page.waitForEvent('domcontentloaded')
  await page.evaluate(() => { void (window as Window & { finishUnregister?: () => Promise<void> }).finishUnregister!() })
  await reloaded
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).progress.ascension.epoch, PROFILE_STORAGE_KEY)).toBe(1)
})

test('updates stay waiting for late windows, then naturally activate after all close with profile/preferences and backup recovery', async ({ browser }, testInfo) => {
  // Verify two complete releases containing both catalogs and all reviewed sprites.
  test.setTimeout(120_000)
  const scratch = mkdtempSync(resolve(tmpdir(), 'ascension-pwa-update-'))
  const previous = resolve(scratch, 'previous'), next = resolve(scratch, 'next')
  cpSync('dist', previous, { recursive: true }); cpSync('dist', next, { recursive: true })
  const updatedCatalog = { ...catalog, revision: catalog.revision + '-update-fixture' }
  writeFileSync(resolve(next, 'catalog.json'), JSON.stringify(updatedCatalog))
  const release = offlineRelease(process.cwd(), next)
  writeFileSync(resolve(next, 'offline-assets.json'), JSON.stringify(release))
  writeFileSync(resolve(next, 'sw.js'), renderWorker(process.cwd(), release))
  let directory = previous
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname
    const file = resolve(directory, path === base ? 'index.html' : path.slice(base.length) + (path.endsWith('/') ? 'index.html' : ''))
    if (!path.startsWith(base) || !file.startsWith(directory + sep)) { response.writeHead(404).end(); return }
    try {
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webmanifest') ? 'application/manifest+json' : file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'text/plain'
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(readFileSync(file))
    } catch { response.writeHead(404).end() }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const context = await browser.newContext({ ...testInfo.project.use, serviceWorkers: 'allow' })
  const browserErrors: string[] = []
  context.on('page', (window) => window.on('pageerror', (error) => browserErrors.push(error.message)))
  try {
    const profile = emptyProfile(catalog.revision)
    profile.epoch = 3; profile.purchases['future-unknown'] = { epoch: 2, active: false }
    const astral = catalog.upgrades.find((upgrade: { activation: string }) => upgrade.activation === 'after-ultra-ascension')
    profile.purchases[astral.id] = { epoch: 3, active: false }
    profile.milestones['future-milestone'] = true
    const page = await context.newPage()
    await page.addInitScript(({ profile, profileKey, legacyProfileKey, trackingKey, layoutKey }) => {
      if (!localStorage.getItem(profileKey)) {
        localStorage.setItem(legacyProfileKey, JSON.stringify(profile)); localStorage.setItem(trackingKey, 'disabled'); localStorage.setItem(layoutKey, 'web')
      }
      const native = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) { if ((window as Window & { denyWrites?: boolean }).denyWrites && key === profileKey) throw new DOMException('Synthetic quota refusal', 'QuotaExceededError'); native.call(this, key, value) }
    }, { profile, profileKey: PROFILE_STORAGE_KEY, legacyProfileKey: LEGACY_PROFILE_STORAGE_KEY, trackingKey: ANALYTICS_PREFERENCE_KEY, layoutKey: LAYOUT_PREFERENCE_KEY })
    await page.goto(`http://127.0.0.1:${address.port}${base}ascension/#analytics=off`); await offlineReady(page)
    await page.getByRole('button', { name: 'Return to start', exact: true }).click()
    await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
    directory = next
    await page.evaluate(async () => await (await navigator.serviceWorker.getRegistration())!.update())
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())!.waiting)), { timeout: 45000 }).toBe(true)
    await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
    await expect.poll(() => page.evaluate(({ key, id }) => Boolean(JSON.parse(localStorage.getItem(key)!).progress.ascension.purchases[id]), { key: PROFILE_STORAGE_KEY, id: catalog.startId })).toBe(true)
    const other = await context.newPage(); await other.goto(page.url())
    await expect(other.locator('.toolbar')).toBeVisible()
    const previousRelease = JSON.parse(readFileSync(resolve(previous, 'offline-assets.json'), 'utf8'))
    await openInstall(page); await page.getByRole('button', { name: 'Prepare app update…', exact: true }).click()
    await page.getByRole('button', { name: 'Prepare with saved progress', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Close every Idle Slayer Companion browser tab')
    // A window joining after preparation remains on the old complete release.
    const lateTransfer = await encodeProgressTransfer(catalog, profile, 'web')
    if (!lateTransfer.ok) throw new Error(lateTransfer.error)
    const late = await context.newPage(); await late.goto(progressTransferLink(lateTransfer.token, new URL(page.url()).origin, base))
    await expect(late.locator('.toolbar')).toBeVisible()
    await expect(late.getByRole('dialog', { name: 'Transfer map progress', exact: true })).toBeVisible()
    await expect.poll(() => new URL(late.url()).hash).toBe('')
    expect(await late.evaluate(async () => (await (await fetch('/utilities/idle-slayer-companion/catalog.json')).json()).revision)).toBe(catalog.revision)
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true)
    expect(await late.evaluate(async () => caches.keys())).toContain('austingarrod-idle-slayer-companion-public-' + previousRelease.version)
    await other.close(); await page.getByRole('button', { name: 'Keep this session open', exact: true }).click()
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    // Produce unsaved progress, then exercise cancel and backup before update.
    await page.evaluate(() => { (window as Window & { denyWrites?: boolean }).denyWrites = true })
    const spoilers = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
    if (!await spoilers.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
    await spoilers.check()
    if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await openInstall(page); await page.getByRole('button', { name: 'Prepare app update…', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Prepare app update?', exact: true })).toContainText('unsaved progress')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Install & offline', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Prepare app update…', exact: true }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export backup and prepare update', exact: true }).click()
    const backup = JSON.parse(readFileSync((await (await download).path())!, 'utf8'))
    expect(backup.format).toBe('idle-slayer-companion-progress')
    expect(backup.ascension.showSpoilers).toBe(true)
    await expect(page.getByRole('dialog', { name: 'Close all companion windows to update', exact: true })).toBeVisible()
    const reopenURL = page.url()
    await page.close()
    // Closing just the consenting window cannot update a late joining window.
    expect(await late.evaluate(async () => (await (await fetch('/utilities/idle-slayer-companion/catalog.json')).json()).revision)).toBe(catalog.revision)
    expect(await late.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true)
    expect(await late.evaluate(async () => caches.keys())).toContain('austingarrod-idle-slayer-companion-public-' + previousRelease.version)
    await late.close()
    // Wait using the worker object, without creating another controlled window.
    await expect.poll(async () => {
      const worker = context.serviceWorkers().at(-1)
      if (!worker) return false
      try { return await worker.evaluate(async (version) => !(await caches.keys()).includes('austingarrod-idle-slayer-companion-public-' + version), previousRelease.version) }
      catch { return false }
    }, { timeout: 45000 }).toBe(true)
    const reopened = await context.newPage(); await reopened.goto(reopenURL)
    await expect(reopened.locator('.toolbar')).toBeVisible()
    await expect.poll(() => reopened.evaluate(async () => await caches.keys())).toEqual(['austingarrod-idle-slayer-companion-public-' + release.version])
    await openAction(reopened, 'About & sources')
    await expect(reopened.getByRole('dialog')).toContainText(updatedCatalog.revision)
    const saved = await reopened.evaluate((key) => JSON.parse(localStorage.getItem(key)!).progress.ascension, PROFILE_STORAGE_KEY)
    expect(saved.purchases['future-unknown']).toEqual({ epoch: 2, active: false })
    expect(saved.purchases[astral.id]).toEqual({ epoch: 3, active: false })
    expect(saved.milestones['future-milestone']).toBe(true)
    expect(saved.showSpoilers).toBe(false)
    expect(await reopened.evaluate((key) => localStorage.getItem(key), ANALYTICS_PREFERENCE_KEY)).toBe('disabled')
    expect(await reopened.evaluate((key) => localStorage.getItem(key), LAYOUT_PREFERENCE_KEY)).toBe('web')
    expect(new URL(reopened.url()).hash).toBe('#analytics=off')
  } finally {
    await context.close(); await new Promise<void>((resolve) => server.close(() => resolve()))
    if (!scratch.startsWith(resolve(tmpdir()) + sep + 'ascension-pwa-update-')) throw new Error('Unsafe test cleanup')
    rmSync(scratch, { recursive: true, force: true })
    expect(browserErrors, 'Unhandled browser errors in the two-release PWA context').toEqual([])
  }
})
