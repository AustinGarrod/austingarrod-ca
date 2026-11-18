import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const selectedNode = (page: Page) => page.locator(`.react-flow__node[data-id="${catalog.startId}"]`)
async function rendered(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    for (let frame = 0; frame < 8; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}
async function camera(page: Page) {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const m = new DOMMatrix(getComputedStyle(element).transform)
    return { x: m.e, y: m.f, zoom: m.a }
  })
}
async function position(page: Page) {
  return selectedNode(page).evaluate((element) => {
    const m = new DOMMatrix((element as HTMLElement).style.transform)
    return { x: m.e, y: m.f }
  })
}
async function usableSelection(page: Page) {
  await expect(selectedNode(page)).toBeInViewport()
  expect(await selectedNode(page).evaluate((element) => {
    const node = element.getBoundingClientRect(), map = element.closest('.map')!.getBoundingClientRect()
    return node.left >= map.left - 1 && node.right <= map.right + 1 && node.top >= map.top - 1 && node.bottom <= map.bottom + 1
  })).toBe(true)
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  await expect(selectedNode(page)).toHaveClass(/selected/)
}
async function openAction(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true })
  if (!await button.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await button.click()
}
async function history(page: Page, epoch: string) {
  await openAction(page, 'Progress')
  const counter = page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })
  await counter.fill(epoch)
  await page.getByRole('button', { name: 'Review history…', exact: true }).click()
  await page.getByRole('button', { name: 'Record history', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions ' + epoch)
  await rendered(page)
}
async function prepare(page: Page, layout: 'Game Layout' | 'Detailed Layout', select = true) {
  await page.goto('./ascension/')
  await page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name: layout, exact: true }).click()
  if (select) await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await rendered(page)
}
async function panAndZoom(page: Page) {
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Map navigation', exact: true }).click()
  await page.getByRole('button', { name: 'Pan map right', exact: true }).click()
  await page.getByRole('button', { name: 'Pan map down', exact: true }).click()
  await page.getByRole('button', { name: 'Map navigation', exact: true }).click()
  await rendered(page)
}
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

for (const layout of ['Game Layout', 'Detailed Layout'] as const) {
  test(`${layout} keeps the same selected upgrade usable after history reflow and Undo`, async ({ page }) => {
    await prepare(page, layout)
    await usableSelection(page)
    const before = await camera(page), originalPosition = await position(page)
    await history(page, '1')
    await expect(page.locator('.react-flow__node')).toHaveCount(161)
    if (layout === 'Detailed Layout') expect(await position(page)).not.toEqual(originalPosition)
    else expect(await position(page)).toEqual(originalPosition)
    await usableSelection(page)
    if (layout === 'Game Layout') expect(await camera(page)).toEqual(before)
    else if (test.info().project.name === 'desktop') expect((await camera(page)).zoom).toBe(before.zoom)
    await openAction(page, 'Undo')
    const options = page.getByRole('dialog', { name: 'Map options', exact: true })
    if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 0')
    await rendered(page)
    expect(await position(page)).toEqual(originalPosition)
    await usableSelection(page)
  })
  test(`${layout} preserves manual pan and zoom when progress leaves the selected position unchanged`, async ({ page }) => {
    await prepare(page, layout)
    await panAndZoom(page)
    const before = await camera(page), originalPosition = await position(page)
    await rendered(page)
    expect(await camera(page)).toEqual(before)
    await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
    await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
    await expect(page.locator('.map-summary')).toContainText('1 /')
    await rendered(page)
    expect(await position(page)).toEqual(originalPosition)
    expect(await camera(page)).toEqual(before)
    await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
    await expect(selectedNode(page)).toHaveClass(/selected/)
  })
  test(`${layout} keeps the viewport when Undo changes only spoiler browsing`, async ({ page }) => {
    await prepare(page, layout)
    await panAndZoom(page)
    const before = await camera(page)
    const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
    if (!await checkbox.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
    await checkbox.setChecked(true)
    const options = page.getByRole('dialog', { name: 'Map options', exact: true })
    if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await rendered(page)
    expect(await camera(page)).toEqual(before)
    await openAction(page, 'Undo')
    if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await rendered(page)
    await expect(page.locator('.react-flow__node')).toHaveCount(121)
    expect(await camera(page)).toEqual(before)
    await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  })
}

test('Detailed Layout progress does not recenter an unselected manually positioned viewport', async ({ page }) => {
  await prepare(page, 'Detailed Layout', false)
  await panAndZoom(page)
  const before = await camera(page)
  await history(page, '1')
  await expect(page.locator('.react-flow__node')).toHaveCount(161)
  await expect(page.locator('.details')).toHaveCount(0)
  expect(await camera(page)).toEqual(before)
})
