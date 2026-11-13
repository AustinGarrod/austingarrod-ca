import { installProfileTestHelpers } from './fixtures'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const visible = visibility(catalog, initial)
const start = catalog.upgrades.find((node) => node.id === catalog.startId)!
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})
async function rendered(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; for (let frame = 0; frame < 8; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
}
const camera = (page: Page) => page.locator('.react-flow__viewport').evaluate((element) => {
  const matrix = new DOMMatrix(getComputedStyle(element).transform)
  return { x: matrix.e, y: matrix.f, zoom: matrix.a }
})
const positions = (page: Page) => page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-id'), (node as HTMLElement).style.transform]))
const stored = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)
async function options(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const desktop = page.getByRole('button', { name: 'Map view…', exact: true })
  if (await desktop.isVisible()) await desktop.click()
  else await page.getByRole('button', { name: 'Map options', exact: true }).click()
}
async function overview(page: Page) {
  await options(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('Visible map overview')
  await rendered(page)
}
async function fit(page: Page) {
  expect(await page.locator('.react-flow__node').evaluateAll((nodes) => {
    const map = document.querySelector('.map')!.getBoundingClientRect()
    const summary = document.querySelector('.map-summary')!.getBoundingClientRect()
    const controls = document.querySelector('.camera-controls')!.getBoundingClientRect()
    return nodes.every((node) => { const r = node.getBoundingClientRect(); return r.left >= map.left + 11 && r.right <= map.right - 11 && r.top >= summary.bottom + 11 && r.bottom <= controls.top - 11 })
  })).toBe(true)
}
async function selectStart(page: Page) {
  await page.getByRole('searchbox').fill(start.title)
  await page.getByRole('searchbox').press('Enter')
  await expect(page.locator('.details h2')).toHaveText(start.title)
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  await rendered(page)
}
async function prepare(page: Page, layout: string) {
  await page.goto('./ascension/')
  await page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name: layout, exact: true }).click()
  await rendered(page)
}
async function holdCameraFrames(page: Page) {
  await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window)
    const callbacks: FrameRequestCallback[] = []
    const win = window as Window & { holdOverviewFrames?: boolean; releaseOverviewFrames?: () => void; queuedOverviewFrames?: number }
    window.requestAnimationFrame = (callback) => {
      if (!win.holdOverviewFrames) return native(callback)
      callbacks.push(callback); win.queuedOverviewFrames = callbacks.length; return -callbacks.length
    }
    win.releaseOverviewFrames = () => { win.holdOverviewFrames = false; callbacks.splice(0).forEach((callback) => native(callback)) }
  })
}

for (const layout of ['Game Layout', 'Detailed Layout']) {
  test(`${layout} fits visible frames and returns the same selected upgrade to inspection without changing progress or positions`, async ({ page }) => {
    await prepare(page, layout); await selectStart(page)
    const detailClass = await page.locator('.details').getAttribute('class')
    const beforePositions = await positions(page), beforeProfile = await stored(page), beforeCamera = await camera(page)
    await overview(page); await fit(page)
    await expect(page.locator('.toast')).toHaveCount(0)
    await expect(page.locator('.details')).toHaveCount(0)
    await expect(page.locator(`.react-flow__node[data-id="${start.id}"]`)).toHaveAttribute('aria-current', 'true')
    expect(await positions(page)).toEqual(beforePositions)
    expect(await stored(page)).toBe(beforeProfile)
    expect((await camera(page)).zoom).toBeLessThan(beforeCamera.zoom)
    const back = page.getByRole('button', { name: 'Return to inspection', exact: true })
    await back.focus(); await page.keyboard.press('Enter'); await rendered(page)
    await expect(page.locator('.details h2')).toHaveText(start.title)
    await expect(page.locator('.details h2')).toBeFocused()
    await expect(page.locator('.details')).toHaveAttribute('class', detailClass!)
    expect((await camera(page)).zoom).toBeGreaterThan(0.4)
    expect(await page.locator(`.react-flow__node[data-id="${start.id}"]`).evaluate((node) => {
      const r = node.getBoundingClientRect(), map = node.closest('.map')!.getBoundingClientRect()
      return r.width >= 44 && r.height >= 44 && r.left >= map.left - 1 && r.right <= map.right + 1 && r.top >= map.top - 1 && r.bottom <= map.bottom + 1
    })).toBe(true)
    expect(await positions(page)).toEqual(beforePositions)
    expect(await stored(page)).toBe(beforeProfile)
    await expect(page.getByRole('button', { name: 'Return to start', exact: true })).toBeVisible()
  })

  test(`${layout} can refocus after manual exploration and return to a previous view when nothing is selected`, async ({ page }) => {
    await prepare(page, layout)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await rendered(page)
    const previous = await camera(page), profile = await stored(page)
    await options(page)
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Refocus selected upgrade', exact: true })).toBeDisabled()
    await page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click(); await rendered(page)
    await fit(page)
    await page.getByRole('button', { name: 'Return to previous view', exact: true }).click(); await rendered(page)
    expect(await camera(page)).toEqual(previous)
    await expect(page.locator('.details')).toHaveCount(0)
    await selectStart(page)
    await page.getByRole('button', { name: 'Map navigation', exact: true }).click()
    await page.getByRole('button', { name: 'Pan map right', exact: true }).click()
    await options(page)
    await page.getByRole('dialog').getByRole('button', { name: 'Refocus selected upgrade', exact: true }).click(); await rendered(page)
    await expect(page.locator('.details h2')).toHaveText(start.title)
    expect(await stored(page)).toBe(profile)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test(`${layout} overview ignores hidden positions, hidden identities and hidden topology`, async ({ page, browser, baseURL }) => {
    await prepare(page, layout); await overview(page); await fit(page)
    const expected = await camera(page)
    const changed = structuredClone(catalog)
    const hidden = changed.upgrades.filter((node) => !visible.ids.has(node.id))
    for (const [index, node] of hidden.entries()) { node.position = { x: 1e9 + index * 1e6, y: -1e9 }; node.title = `HIDDEN-OVERVIEW-MARKER-${index}` }
    changed.connections.push({ from: hidden[0].id, to: hidden[1].id })
    const context = await browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' })
    await installProfileTestHelpers(context)
    const other = await context.newPage()
    await other.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
    await other.route('https://analytics.garrod.house/**', (route) => route.abort())
    await other.route('**/catalog.json', (route) => route.fulfill({ json: changed }))
    await other.goto(new URL('ascension/', baseURL!).href)
    await other.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name: layout, exact: true }).click()
    await overview(other); await fit(other)
    expect(await camera(other)).toEqual(expected)
    await expect(other.locator('.react-flow__node')).toHaveCount(visible.total)
    await expect(other.locator('body')).not.toContainText('HIDDEN-OVERVIEW-MARKER')
    await context.close()
  })

  test(`${layout} keeps manual overview exploration when recorded progress leaves visible geometry unchanged`, async ({ page, context }) => {
    await prepare(page, layout); await overview(page)
    const beforePositions = await positions(page)
    await page.getByRole('button', { name: 'Map navigation', exact: true }).click()
    await page.getByRole('button', { name: 'Pan map right', exact: true }).click()
    await page.getByRole('button', { name: 'Map navigation', exact: true }).click(); await rendered(page)
    const before = await camera(page)
    const other = await context.newPage(); await other.goto(page.url())
    await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), {
      key: PROFILE_STORAGE_KEY, profile: { ...initial, purchases: { [start.id]: { epoch: 0, active: true } } },
    })
    await expect(page.locator(`.react-flow__node[data-id="${start.id}"]`)).toHaveAttribute('aria-label', /purchased/)
    await rendered(page)
    expect(await positions(page)).toEqual(beforePositions)
    expect(await camera(page)).toEqual(before)
    await expect(page.locator('.map-summary')).toContainText('Visible map overview')
  })
}

test('spoiler toggles preserve an overview camera, hide a selected identity and require a fresh fit to widen its bounds', async ({ page }) => {
  await prepare(page, 'Detailed Layout')
  await options(page); await page.getByRole('dialog').getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('searchbox').fill('Soul Reaper III'); await page.getByRole('searchbox').press('Enter')
  await overview(page); await fit(page)
  const previous = await camera(page)
  await options(page); await page.getByRole('dialog').getByRole('checkbox', { name: 'Show spoilers', exact: true }).uncheck()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click(); await rendered(page)
  expect(await camera(page)).toEqual(previous)
  await expect(page.locator('.react-flow__node[aria-current="true"]')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('Soul Reaper III')
  await expect(page.getByRole('button', { name: 'Return to previous view', exact: true })).toBeVisible()
  await overview(page); await fit(page)
  await expect(page.locator('.react-flow__node')).toHaveCount(visible.total)
})

test('layout, rotation and external recorded progress refit only the current visible overview', async ({ page, context }) => {
  await prepare(page, 'Game Layout'); await selectStart(page); await overview(page); await fit(page)
  await page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name: 'Detailed Layout', exact: true }).click(); await rendered(page); await fit(page)
  await page.setViewportSize({ width: 844, height: 390 }); await rendered(page); await fit(page)
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: { ...initial, epoch: 1 } })
  await expect(page.locator('.react-flow__node')).toHaveCount(visibility(catalog, { ...initial, epoch: 1 }).total)
  await rendered(page); await fit(page)
  await expect(page.locator(`.react-flow__node[data-id="${start.id}"]`)).toHaveAttribute('aria-current', 'true')
})

test('a spoiler change cancels every queued overview fit before it can move the camera', async ({ page }) => {
  await holdCameraFrames(page)
  await prepare(page, 'Game Layout')
  const before = await camera(page)
  await page.evaluate(() => { (window as Window & { holdOverviewFrames?: boolean }).holdOverviewFrames = true })
  await options(page); await page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click()
  expect(await page.evaluate(() => (window as Window & { queuedOverviewFrames?: number }).queuedOverviewFrames)).toBeGreaterThan(0)
  await options(page); await page.getByRole('dialog').getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.evaluate(() => (window as Window & { releaseOverviewFrames?: () => void }).releaseOverviewFrames?.())
  await rendered(page)
  expect(await camera(page)).toEqual(before)
  await expect(page.locator('.react-flow__node')).toHaveCount(catalog.upgrades.length)
})

test('recorded progress refreshes a pending fit even when visible geometry has not changed', async ({ page, context }) => {
  await holdCameraFrames(page)
  await prepare(page, 'Game Layout')
  const before = await camera(page)
  await page.evaluate(() => { (window as Window & { holdOverviewFrames?: boolean }).holdOverviewFrames = true })
  await options(page); await page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click()
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), {
    key: PROFILE_STORAGE_KEY, profile: { ...initial, purchases: { [start.id]: { epoch: 0, active: true } } },
  })
  await expect(page.locator(`.react-flow__node[data-id="${start.id}"]`)).toHaveAttribute('aria-label', /purchased/)
  await page.evaluate(() => (window as Window & { releaseOverviewFrames?: () => void }).releaseOverviewFrames?.())
  await rendered(page); await fit(page)
  expect((await camera(page)).zoom).toBeLessThan(before.zoom)
  await expect(page.locator('.react-flow__node')).toHaveCount(visible.total)
  await expect(page.locator('.details')).toHaveCount(0)
})

test('pointer exploration cancels a queued overview fit', async ({ page }) => {
  await holdCameraFrames(page)
  await prepare(page, 'Game Layout')
  const before = await camera(page)
  await page.evaluate(() => { (window as Window & { holdOverviewFrames?: boolean }).holdOverviewFrames = true })
  await options(page); await page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click()
  const map = await page.locator('.map').boundingBox()
  await page.mouse.move(map!.x + map!.width - 4, map!.y + map!.height / 2)
  await page.mouse.down(); await page.mouse.move(map!.x + map!.width - 54, map!.y + map!.height / 2, { steps: 3 }); await page.mouse.up()
  const explored = await camera(page)
  expect(explored).not.toEqual(before)
  await page.evaluate(() => (window as Window & { releaseOverviewFrames?: () => void }).releaseOverviewFrames?.())
  await rendered(page)
  expect(await camera(page)).toEqual(explored)
  await expect(page.locator('.map-summary')).toContainText('Visible map overview')
})

test('overview and refocus honor live reduced-motion changes', async ({ page }) => {
  type View = { x: number; y: number; zoom: number }
  type Proof = { before: View; frames: View[]; after: View }
  const same = (a: View, b: View) => Math.abs(a.x - b.x) < 0.00001 && Math.abs(a.y - b.y) < 0.00001 && Math.abs(a.zoom - b.zoom) < 0.00001
  const capture = async (action: () => Promise<unknown>): Promise<Proof> => {
    await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!
      const read = () => { const m = new DOMMatrix(viewport.style.transform); return { x: m.e, y: m.f, zoom: m.a } }
      const before = read(), frames: View[] = []
      const observer = new MutationObserver(() => frames.push(read()))
      observer.observe(viewport, { attributes: true, attributeFilter: ['style'] })
      Object.assign(window, { stopOverviewMotion: () => { observer.disconnect(); return { before, frames, after: read() } } })
    })
    await action(); await page.waitForTimeout(350)
    return page.evaluate(() => (window as unknown as { stopOverviewMotion: () => Proof }).stopOverviewMotion())
  }
  await prepare(page, 'Game Layout'); await selectStart(page)
  await options(page)
  const reduced = await capture(() => page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click())
  expect(reduced.frames.filter((frame) => !same(frame, reduced.before)).every((frame) => same(frame, reduced.after))).toBe(true)
  expect(same(reduced.before, reduced.after)).toBe(false)
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await rendered(page)
  const normal = await capture(() => page.getByRole('button', { name: 'Return to inspection', exact: true }).click())
  expect(normal.frames.some((frame) => !same(frame, normal.before) && !same(frame, normal.after))).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' }); await rendered(page)
  await options(page)
  const again = await capture(() => page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click())
  expect(again.frames.filter((frame) => !same(frame, again.before)).every((frame) => same(frame, again.after))).toBe(true)
})
