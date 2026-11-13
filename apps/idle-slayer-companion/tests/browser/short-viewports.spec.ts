import { expect, test } from './fixtures'
import type { Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  await expect.poll(() => control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth
      && rect.top >= 0 && rect.bottom <= innerHeight && Boolean(hit && element.contains(hit))
  })).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const viewport of [{ width: 568, height: 320 }, { width: 375, height: 350 }, { width: 320, height: 568 }]) {
  for (const layout of ['Game Layout', 'Detailed Layout'] as const) {
    test(`${layout} keeps map and details usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('./ascension/')
      await page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name: layout, exact: true }).click()
      await page.getByRole('button', { name: 'Return to start', exact: true }).click()
      const details = page.getByRole('complementary', { name: 'Upgrade details', exact: true })
      await expect(details.getByRole('heading', { level: 2 })).toHaveText('Permanent Slayer')
      await reachable(details.getByRole('button', { name: 'Close upgrade details', exact: true }))
      const expand = details.getByRole('button', { name: 'Show details', exact: true })
      await reachable(expand)
      await expand.click()
      await expect(details.locator('.detail-content')).toBeVisible()
      await expect.poll(() => details.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
      await details.evaluate((element) => { element.scrollTop = element.scrollHeight })
      const purchase = details.getByRole('button', { name: 'Record purchase…', exact: true })
      await reachable(purchase)
      await purchase.click()
      await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      const close = details.getByRole('button', { name: 'Close upgrade details', exact: true })
      await reachable(close)

      const selected = page.locator(`.react-flow__node[data-id="${catalog.startId}"]`)
      await expect.poll(() => selected.evaluate((element) => {
        const rect = element.getBoundingClientRect(), canvas = element.closest('.map')!.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        const covered = [...document.querySelectorAll('.camera-controls, .pan-controls, .react-flow__attribution')].some((control) => {
          const box = control.getBoundingClientRect()
          return box.width > 0 && box.height > 0 && rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top
        })
        return rect.width >= 44 && rect.height >= 44 && rect.left >= canvas.left && rect.right <= canvas.right
          && rect.top >= canvas.top && rect.bottom <= canvas.bottom && !covered && Boolean(hit?.closest('.react-flow__node') === element)
      })).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
      if (viewport.height === 568) expect(await page.locator('.map').evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(230)
      await close.click()
      await expect(details).toHaveCount(0)
    })
  }
}

test('toolbar and available workspace measurements follow a selected view through rotation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 350 })
  await page.goto('./ascension/')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  for (const viewport of [{ width: 375, height: 350 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => page.locator('.atlas').evaluate((element) => {
      const style = getComputedStyle(element)
      return Math.abs(parseFloat(style.getPropertyValue('--toolbar-height')) - element.querySelector('.toolbar')!.getBoundingClientRect().height) < 1
        && Math.abs(parseFloat(style.getPropertyValue('--workspace-height')) - element.querySelector('.workspace')!.getBoundingClientRect().height) < 1
    })).toBe(true)
    await reachable(page.getByRole('button', { name: 'Close upgrade details', exact: true }))
  }
})
