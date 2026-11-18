import { expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const revealed = visibility(catalog, initial)
const start = catalog.upgrades.find((upgrade) => upgrade.id === catalog.startId)!
const hidden = catalog.upgrades.find((upgrade) => !revealed.ids.has(upgrade.id)
  && catalog.upgrades.every((other) => other.id === upgrade.id || other.title !== upgrade.title))!
type Camera = { x: number; y: number; zoom: number }
type CameraObservation = { observer: MutationObserver; samples: Camera[] }

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

async function camera(page: Page): Promise<Camera> {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e, y: matrix.f, zoom: matrix.a }
  })
}

async function finishRenderCycles(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    // Include later grid-size/ResizeObserver callbacks, which previously moved
    // the camera after the first frame already looked correct on phones.
    for (let frame = 0; frame < 8; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

async function observeCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const element = document.querySelector('.react-flow__viewport')!
    const read = () => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform)
      return { x: matrix.e, y: matrix.f, zoom: matrix.a }
    }
    const samples = [read()]
    const observer = new MutationObserver(() => samples.push(read()))
    observer.observe(element, { attributes: true, attributeFilter: ['style'] })
    Object.assign(window, { spoilerCameraObservation: { observer, samples } })
    return samples[0]
  })
}

async function expectCameraUnchanged(page: Page, expected: Camera) {
  await finishRenderCycles(page)
  const samples = await page.evaluate(() => {
    const observation = (window as unknown as { spoilerCameraObservation: CameraObservation }).spoilerCameraObservation
    observation.observer.disconnect()
    return observation.samples
  })
  expect(samples.filter((sample) => sample.x !== expected.x || sample.y !== expected.y || sample.zoom !== expected.zoom)).toEqual([])
  expect(await camera(page)).toEqual(expected)
}

async function spoilerCheckbox(page: Page): Promise<Locator> {
  await expect(page.locator('.toolbar')).toBeVisible()
  const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  if (!await checkbox.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  return page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
}

async function showSpoilers(page: Page, shown: boolean) {
  const checkbox = await spoilerCheckbox(page)
  await checkbox.setChecked(shown)
  await expect(checkbox).toBeChecked({ checked: shown })
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
}

async function chooseLayout(page: Page, name: 'Game Layout' | 'Detailed Layout') {
  const button = page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await finishRenderCycles(page)
}

async function selectUpgrade(page: Page, title: string) {
  await page.getByRole('searchbox').fill(title)
  await page.locator('.search-result').filter({ hasText: title }).first().click()
  await expect(page.locator('.details h2')).toHaveText(title)
  await finishRenderCycles(page)
}

async function panAndZoom(page: Page): Promise<Camera> {
  const original = await camera(page)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(original.zoom)
  const zoomed = await camera(page)
  const navigation = page.getByRole('button', { name: 'Map navigation', exact: true })
  await navigation.click()
  await page.getByRole('button', { name: 'Pan map right', exact: true }).click()
  await expect.poll(async () => (await camera(page)).x).not.toBe(zoomed.x)
  const horizontal = await camera(page)
  await page.getByRole('button', { name: 'Pan map down', exact: true }).click()
  await expect.poll(async () => (await camera(page)).y).not.toBe(horizontal.y)
  await navigation.click()
  await finishRenderCycles(page)
  return camera(page)
}

async function expectRevealedGraph(page: Page, spoilers: boolean) {
  await expect(page.locator('.react-flow__node')).toHaveCount(spoilers ? catalog.upgrades.length : revealed.upgrades.length)
  await expect(page.locator('.react-flow__edge')).toHaveCount(spoilers ? catalog.connections.length : revealed.connections.length)
  await expect(page.locator(`.react-flow__node[data-id="${hidden.id}"]`)).toHaveCount(spoilers ? 1 : 0)
  await page.getByRole('searchbox').fill(hidden.title)
  await expect(page.locator('.search-result').filter({ hasText: hidden.title })).toHaveCount(spoilers ? 1 : 0)
  await page.getByRole('searchbox').press('Escape')
  await page.getByRole('searchbox').fill('')
  await page.getByRole('searchbox').press('Escape')
}

for (const layout of ['Game Layout', 'Detailed Layout'] as const) {
  for (const selection of ['none', 'visible'] as const) {
    test(`${layout} preserves a manually panned and zoomed camera with ${selection} selection when spoilers change`, async ({ page }) => {
      await page.goto('./ascension/')
      await chooseLayout(page, layout)
      if (selection === 'visible') await selectUpgrade(page, start.title)
      await panAndZoom(page)
      const baseline = await observeCamera(page)
      await showSpoilers(page, true)
      await expectRevealedGraph(page, true)
      if (selection === 'visible') await expect(page.locator('.details h2')).toHaveText(start.title)
      await showSpoilers(page, false)
      await expectRevealedGraph(page, false)
      if (selection === 'visible') await expect(page.locator('.details h2')).toHaveText(start.title)
      await expectCameraUnchanged(page, baseline)
      const profile = await page.evaluate(() => JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!))
      expect(profile).toEqual(initial)
    })
  }

  test(`${layout} hides a spoiler-only selection without moving the camera as its inspector closes`, async ({ page }) => {
    await page.goto('./ascension/')
    await chooseLayout(page, layout)
    await showSpoilers(page, true)
    await selectUpgrade(page, hidden.title)
    await panAndZoom(page)
    const canvasHeight = await page.locator('.map').evaluate((element) => element.getBoundingClientRect().height)
    const baseline = await observeCamera(page)
    await showSpoilers(page, false)
    await expect(page.getByRole('complementary', { name: 'Upgrade details', exact: true })).toHaveCount(0)
    await expectRevealedGraph(page, false)
    await expectCameraUnchanged(page, baseline)
    if (test.info().project.name === 'mobile') {
      expect(await page.locator('.map').evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(canvasHeight)
    }
  })
}

test('Show spoilers uses a real keyboard checkbox with a themed hit area and forced-color fallback', async ({ page }) => {
  await page.goto('./ascension/')
  const checkbox = await spoilerCheckbox(page)
  const label = checkbox.locator('..')
  await expect(checkbox).toHaveCSS('appearance', 'none')
  const area = (await label.boundingBox())!
  expect(area.width).toBeGreaterThanOrEqual(44)
  expect(area.height).toBeGreaterThanOrEqual(44)
  await page.keyboard.press('Tab')
  await checkbox.focus()
  await expect(label).toHaveCSS('outline-style', 'solid')
  expect(await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2)
  await checkbox.press('Space')
  await expect(checkbox).toBeChecked()
  expect(await checkbox.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await label.evaluate((element) => getComputedStyle(element).borderTopColor))
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(checkbox).toHaveCSS('appearance', 'auto')
  await checkbox.press('Space')
  await expect(checkbox).not.toBeChecked()
})

test('changing spoilers interrupts an active camera tween without a later reset', async ({ page }) => {
  // A wide viewport keeps the checkbox reachable during the active zoom;
  // portrait resize behavior is exercised by the selected-node tests above.
  // Preserve a 1280px map workspace beside the Companion navigation rail.
  await page.setViewportSize({ width: 1280 + 236, height: 720 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await finishRenderCycles(page)
  const before = await camera(page)
  await page.evaluate(() => {
    const checkbox = document.querySelector<HTMLInputElement>('.toolbar .spoiler-control input')!
    const element = document.querySelector('.react-flow__viewport')!
    const read = () => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform)
      return { x: matrix.e, y: matrix.f, zoom: matrix.a }
    }
    const initialZoom = read().zoom
    checkbox.addEventListener('change', () => {
      const samples = [read()]
      const observer = new MutationObserver(() => samples.push(read()))
      observer.observe(element, { attributes: true, attributeFilter: ['style'] })
      Object.assign(window, { spoilerCameraObservation: { observer, samples } })
    }, { capture: true, once: true })
    // Observe the intermediate rendered frame in the browser itself so a slow
    // Playwright actionability round trip cannot finish the tween first.
    const outcome = new Promise<Camera>((resolve, reject) => {
      const tweenObserver = new MutationObserver(() => {
        const current = read()
        if (current.zoom > initialZoom && current.zoom < initialZoom * 1.2) {
          tweenObserver.disconnect()
          window.clearTimeout(deadline)
          checkbox.click()
          resolve(current)
        }
      })
      const deadline = window.setTimeout(() => {
        tweenObserver.disconnect()
        reject(new Error('No intermediate zoom frame was rendered before the tween finished'))
      }, 3000)
      tweenObserver.observe(element, { attributes: true, attributeFilter: ['style'] })
    })
    Object.assign(window, { spoilerTweenOutcome: outcome })
  })
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const captured = await page.evaluate(() => (window as unknown as { spoilerTweenOutcome: Promise<Camera> }).spoilerTweenOutcome)
  expect(captured.zoom).toBeGreaterThan(before.zoom)
  expect(captured.zoom).toBeLessThan(before.zoom * 1.2)
  await expect(page.getByRole('checkbox', { name: 'Show spoilers', exact: true })).toBeChecked()
  await expectRevealedGraph(page, true)
  await expectCameraUnchanged(page, captured)
})
