import { installProfileTestHelpers } from './fixtures'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { encodeProgressTransfer, progressTransferLink } from '../../src/domain/progress-transfer'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { ANALYTICS_PREFERENCE_KEY } from '../../src/analytics'
import { LAYOUT_PREFERENCE_KEY } from '../../src/domain/layout-preference'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const source = { ...emptyProfile(catalog.revision), epoch: 8, showSpoilers: true,
  purchases: Object.fromEntries([...catalog.upgrades.map((upgrade, index) => [upgrade.id, { epoch: upgrade.retention === 'repeat' ? 8 : 5, active: upgrade.activation === 'immediate' || index % 2 === 0 }]), ['synthetic-source-unknown', { epoch: 2, active: false }]]),
  milestones: { ...Object.fromEntries(catalog.milestones.map((milestone) => [milestone.id, true as const])), 'synthetic-source-milestone': true as const },
}
const destination = { ...emptyProfile(catalog.revision), epoch: 1, purchases: { [catalog.startId]: { epoch: 1, active: true }, 'synthetic-destination-unknown': { epoch: 0, active: false } } }
async function openAction(page: Page, name: string) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const action = page.getByRole('button', { name, exact: true })
  if (!await action.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await action.click()
}
async function openTransfer(page: Page, mode: 'send' | 'receive') {
  await openAction(page, 'Progress')
  await page.getByRole('button', { name: mode === 'send' ? 'Transfer to another device…' : 'Receive transfer…', exact: true }).click()
}
async function saved(page: Page) { return page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY) }
async function sourceLink(baseURL: string) {
  const encoded = await encodeProgressTransfer(catalog, source, 'web')
  if (!encoded.ok) throw new Error(encoded.error)
  const base = new URL(baseURL)
  return progressTransferLink(encoded.token, base.origin, base.pathname)
}

test('desktop snapshot opens a mobile preview, cancels safely, then applies and undoes complete progress and layout', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(({ key, layout, tracking, source }) => {
    localStorage.setItem(key, JSON.stringify(source)); localStorage.setItem(layout, 'web'); localStorage.setItem(tracking, 'disabled')
  }, { key: PROFILE_STORAGE_KEY, layout: LAYOUT_PREFERENCE_KEY, tracking: ANALYTICS_PREFERENCE_KEY, source })
  await page.goto('./ascension/'); await expect(page.locator('.companion-session-status')).not.toContainText('Checking saved progress'); await openTransfer(page, 'send')
  await page.getByRole('button', { name: 'Create transfer snapshot', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Progress transfer QR code', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Transfer snapshot ready', exact: true })).toBeFocused()
  const link = await page.getByRole('textbox', { name: 'Private transfer link', exact: true }).inputValue()
  expect(link).toContain('#transfer=v1.')
  await page.locator('.transfer-qr').screenshot({ path: test.info().outputPath('transfer-qr.png') })
  writeFileSync(test.info().outputPath('transfer-link.txt'), link)
  const mobileContext = await browser.newContext({ viewport: { width: 320, height: 568 } })
    await installProfileTestHelpers(mobileContext)
  const receiverErrors: string[] = []
  mobileContext.on('page', (receiver) => receiver.on('pageerror', (error) => receiverErrors.push(error.message)))
  try {
    await mobileContext.addInitScript(({ key, layout, tracking, destination, appOrigin }) => {
      if (location.origin !== appOrigin) return
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(destination))
      localStorage.setItem(layout, 'native'); localStorage.setItem(tracking, 'enabled')
    }, { key: PROFILE_STORAGE_KEY, layout: LAYOUT_PREFERENCE_KEY, tracking: ANALYTICS_PREFERENCE_KEY, destination, appOrigin: new URL(link).origin })
    const mobile = await mobileContext.newPage(), requests: string[] = []
    mobile.on('request', (request) => requests.push(request.url()))
    await mobile.goto(link)
    const dialog = mobile.getByRole('dialog', { name: 'Transfer map progress', exact: true })
    await expect(dialog.getByRole('heading', { name: 'Review transfer', exact: true })).toBeFocused()
    expect(new URL(mobile.url()).hash).toBe('')
    expect(await saved(mobile)).toEqual(destination)
    expect(await mobile.evaluate((key) => window.__readMapProfileText(key), LAYOUT_PREFERENCE_KEY)).toBe('native')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await saved(mobile)).toEqual(destination)
    await openTransfer(mobile, 'receive')
    await mobile.getByRole('textbox', { name: 'Transfer link or code', exact: true }).fill(link)
    await mobile.getByRole('button', { name: 'Review transfer', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Review transfer', exact: true })).toBeFocused()
    await mobile.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Apply transfer', exact: true })).toBeFocused()
    await mobile.keyboard.press('Enter')
    await expect.poll(() => saved(mobile)).toEqual(source)
    await expect(mobile.getByRole('button', { name: 'Detailed Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await mobile.evaluate((key) => window.__readMapProfileText(key), ANALYTICS_PREFERENCE_KEY)).toBe('enabled')
    await openAction(mobile, 'Undo')
    await expect.poll(() => saved(mobile)).toEqual(destination)
    await expect(mobile.getByRole('button', { name: 'Game Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await openAction(mobile, 'Redo')
    await expect.poll(() => saved(mobile)).toEqual(source)
    await expect(mobile.getByRole('button', { name: 'Detailed Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(requests.some((url) => url.includes('transfer=') || url.includes('v1.'))).toBe(false)
    expect(await saved(page)).toEqual(source)
  } finally {
    await mobileContext.close()
    expect(receiverErrors, 'Unhandled browser errors in the receiving context').toEqual([])
  }
})

test('non-string layouts fail before preview or replacement in both transfer encodings', async ({ page, baseURL }) => {
  await page.addInitScript(({ key, layoutKey, destination }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(destination))
    localStorage.setItem(layoutKey, 'native')
  }, { key: PROFILE_STORAGE_KEY, layoutKey: LAYOUT_PREFERENCE_KEY, destination })
  await page.goto('./ascension/'); await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 1'); await openTransfer(page, 'receive')
  for (const encoding of ['compact', 'profile']) {
    const encoded = await encodeProgressTransfer(encoding === 'compact' ? catalog : { ...catalog, revision: 'synthetic-other-dictionary' }, source, 'native')
    if (!encoded.ok) throw new Error(encoded.error)
    const wire = JSON.parse(gunzipSync(Buffer.from(encoded.token.slice(3), 'base64url')).toString('utf8'))
    expect(wire.encoding).toBe(encoding)
    for (const layout of [['native'], ['web']]) {
      const token = 'v1.' + gzipSync(JSON.stringify({ ...wire, layout })).toString('base64url')
      const base = new URL(baseURL!)
      await page.getByRole('textbox', { name: 'Transfer link or code', exact: true }).fill(progressTransferLink(token, base.origin, base.pathname))
      await page.getByRole('button', { name: 'Review transfer', exact: true }).click()
      await expect(page.getByRole('dialog').locator('.dialog-feedback')).toContainText('incomplete, corrupt or unsupported')
      await expect(page.getByRole('button', { name: 'Apply transfer', exact: true })).toHaveCount(0)
      expect(await saved(page)).toEqual(destination)
      expect(await page.evaluate((key) => window.__readMapProfileText(key), LAYOUT_PREFERENCE_KEY)).toBe('native')
    }
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Game Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('malformed and unsupported links fail locally, while oversized snapshots keep an explicit backup fallback', async ({ page, baseURL }) => {
  await page.addInitScript(({ key, destination }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(destination)) }, { key: PROFILE_STORAGE_KEY, destination })
  await page.goto('./ascension/'); await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 1'); await openTransfer(page, 'receive')
  await page.getByRole('textbox', { name: 'Transfer link or code', exact: true }).fill(new URL('#transfer=v2.unsupported', baseURL!).toString())
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).toContainText('incomplete, corrupt or unsupported')
  expect(await saved(page)).toEqual(destination)
  await expect(page.getByRole('button', { name: 'Apply transfer', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const large = { ...destination, purchases: { ...destination.purchases, ...Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`synthetic-unranked-${index}-${index.toString(36)}-${(index * 77761).toString(36)}`, { epoch: index % 2, active: index % 3 === 0 }])) } }
  await page.evaluate(({ key, large }) => window.__writeExternalMapProfileText(key, JSON.stringify(large)), { key: PROFILE_STORAGE_KEY, large })
  await page.reload(); await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 1'); await openTransfer(page, 'send')
  await page.getByRole('button', { name: 'Create transfer snapshot', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('too large for a readable single QR')
  await expect(page.getByRole('button', { name: 'Export JSON backup', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Private transfer link', exact: true })).not.toHaveValue('')
})

test('a cancelled pending decode cannot reopen or replace progress after it finishes', async ({ page, baseURL }) => {
  await page.addInitScript(({ key, destination }) => {
    localStorage.setItem(key, JSON.stringify(destination))
    const native = window.DecompressionStream
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    ;(window as Window & { releaseTransfer?: () => void }).releaseTransfer = release
    window.DecompressionStream = class {
      readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource>
      constructor(format: CompressionFormat) {
        const delayed = new TransformStream<BufferSource, BufferSource>({ async transform(chunk, controller) { await gate; controller.enqueue(chunk) } })
        this.writable = delayed.writable; this.readable = delayed.readable.pipeThrough(new native(format))
      }
    } as unknown as typeof DecompressionStream
  }, { key: PROFILE_STORAGE_KEY, destination })
  await page.goto('./ascension/'); await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 1'); await openTransfer(page, 'receive')
  await page.getByRole('textbox', { name: 'Transfer link or code', exact: true }).fill(await sourceLink(baseURL!))
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Reading transfer locally')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => (window as Window & { releaseTransfer?: () => void }).releaseTransfer?.())
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await saved(page)).toEqual(destination)
  await openTransfer(page, 'receive')
  await page.getByRole('textbox', { name: 'Transfer link or code', exact: true }).fill('v1.invalid')
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).toContainText('corrupt or unsupported')
  await expect(page.getByRole('button', { name: 'Apply transfer', exact: true })).toHaveCount(0)
})

test('storage failures keep the transferred session and layout usable with recovery and Undo', async ({ page, baseURL }) => {
  await page.addInitScript(({ key, layout, tracking, destination }) => {
    localStorage.setItem(key, JSON.stringify(destination)); localStorage.setItem(layout, 'native'); localStorage.setItem(tracking, 'disabled')
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name) || name === layout) throw new DOMException('Synthetic transfer quota failure', 'QuotaExceededError'); native.call(this, name, value) }
  }, { key: PROFILE_STORAGE_KEY, layout: LAYOUT_PREFERENCE_KEY, tracking: ANALYTICS_PREFERENCE_KEY, destination })
  await page.goto(await sourceLink(baseURL!))
  await page.getByRole('button', { name: 'Apply transfer', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Detailed Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 8')
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved')
  expect(await saved(page)).toEqual(destination)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), ANALYTICS_PREFERENCE_KEY)).toBe('disabled')
  await openAction(page, 'Undo')
  await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 1')
  await expect(page.getByRole('button', { name: 'Game Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('an incoming transfer respects current spoiler preview boundaries and removes its URL payload', async ({ page, baseURL }) => {
  const hidden = catalog.upgrades.find((upgrade) => upgrade.reveal.kind === 'milestone')!
  const hiddenOnly = { ...emptyProfile(catalog.revision), purchases: { [hidden.id]: { epoch: 0, active: true }, 'SYNTHETIC_PRIVATE_TRANSFER': { epoch: 0, active: false } } }
  const encoded = await encodeProgressTransfer(catalog, hiddenOnly, 'web')
  if (!encoded.ok) throw new Error(encoded.error)
  const base = new URL(baseURL!)
  await page.goto(progressTransferLink(encoded.token, base.origin, base.pathname))
  const dialog = page.getByRole('dialog', { name: 'Transfer map progress', exact: true })
  await expect(dialog).not.toContainText(hidden.title)
  await expect(dialog).not.toContainText('SYNTHETIC_PRIVATE_TRANSFER')
  await expect(dialog.getByRole('row', { name: 'Owned upgrades 0 0', exact: true })).toBeVisible()
  await expect(dialog.locator('.progress-transfer')).toHaveClass(/telemetry-private rr-block/)
  expect(new URL(page.url()).hash).toBe('')
})

test('clipboard refusal selects a private manual-copy fallback without changing progress', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new DOMException('Synthetic clipboard refusal', 'NotAllowedError') } } }))
  await page.goto('./ascension/'); await expect(page.locator('.companion-session-status')).not.toContainText('Checking saved progress'); await openTransfer(page, 'send')
  await page.getByRole('button', { name: 'Create transfer snapshot', exact: true }).click()
  await page.getByRole('button', { name: 'Copy transfer link', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'Private transfer link', exact: true })
  await expect(field).toBeFocused()
  expect(await field.evaluate((element) => {
    const text = element as HTMLTextAreaElement
    return text.selectionStart === 0 && text.selectionEnd === text.value.length
  })).toBe(true)
  await expect(page.getByRole('dialog')).toContainText('Copy the selected link')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)).toBeNull()
})

test('a same-document transfer fragment is captured before ordinary URL sanitation and remains a preview', async ({ page, baseURL }) => {
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  const link = await sourceLink(baseURL!)
  await page.evaluate((link) => { location.hash = new URL(link).hash }, link)
  await expect(page.getByRole('heading', { name: 'Review transfer', exact: true })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)).toBeNull()
})

test('a later explicit layout choice stays independent when transferred progress is undone', async ({ page, baseURL }) => {
  await page.addInitScript(({ key, destination }) => localStorage.setItem(key, JSON.stringify(destination)), { key: PROFILE_STORAGE_KEY, destination })
  await page.goto(await sourceLink(baseURL!))
  await page.getByRole('button', { name: 'Apply transfer', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(source)
  await page.getByRole('button', { name: 'Game Layout', exact: true }).click()
  await page.getByRole('button', { name: 'Detailed Layout', exact: true }).click()
  await openAction(page, 'Undo')
  await expect.poll(() => saved(page)).toEqual(destination)
  await expect(page.getByRole('button', { name: 'Detailed Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const arrival of ['startup', 'loaded', 'loading'] as const) {
  test(`an empty transfer token at ${arrival} reports corrupt input without changing progress`, async ({ page }) => {
    await page.addInitScript(({ key, destination }) => localStorage.setItem(key, JSON.stringify(destination)), { key: PROFILE_STORAGE_KEY, destination })
    let releaseCatalog = () => {}
    if (arrival === 'loading') {
      const held = new Promise<void>((resolve) => { releaseCatalog = resolve })
      await page.route('**/catalog.json', async (route) => { await held; await route.continue() })
    }
    try {
      await page.goto(arrival === 'startup' ? './#transfer=' : arrival === 'loaded' ? './ascension/' : './', { waitUntil: 'domcontentloaded' })
      if (arrival === 'loaded') await expect(page.locator('.toolbar')).toBeVisible()
      if (arrival !== 'startup') await page.evaluate(() => { location.hash = '#transfer=' })
    } finally { releaseCatalog() }
    const dialog = page.getByRole('dialog', { name: 'Transfer map progress', exact: true })
    await expect(dialog.locator('.dialog-feedback')).toContainText('incomplete, corrupt or unsupported')
    await expect(dialog.getByRole('button', { name: 'Apply transfer', exact: true })).toHaveCount(0)
    expect(new URL(page.url()).hash).toBe('')
    expect(await saved(page)).toEqual(destination)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await saved(page)).toEqual(destination)
  })
}
