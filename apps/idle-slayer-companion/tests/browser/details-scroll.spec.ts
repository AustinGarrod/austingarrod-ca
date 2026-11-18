import { expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const start = catalog.upgrades.find((upgrade) => upgrade.id === catalog.startId)!
const neighbor = catalog.upgrades.find((upgrade) => upgrade.title === 'Soul Gatherer Bundle')!

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize(test.info().project.name === 'mobile' ? { width: 320, height: 568 } : { width: 1280, height: 800 })
})

async function selectUpgrade(page: Page, title: string) {
  await page.getByRole('searchbox').fill(title)
  await page.locator('.search-result').filter({ hasText: title }).first().click()
  await expect(page.locator('.details h2')).toHaveText(title)
}

async function expandDetails(page: Page) {
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  await expect(page.locator('.detail-content')).toBeVisible()
}

async function scrollDetails(details: Locator) {
  await expect.poll(() => details.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100)
  await details.evaluate((element) => { element.scrollTop = 220 })
  await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBeGreaterThan(100)
  return details.evaluate((element) => element.scrollTop)
}

for (const layout of ['Game Layout', 'Detailed Layout'] as const) {
  test(`${layout} resets details scrolling for a neighboring selection and keeps the same selection's position`, async ({ page }) => {
    await page.goto('./ascension/')
    await page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name: layout, exact: true }).click()
    await selectUpgrade(page, start.title)
    await expandDetails(page)
    const details = page.getByRole('complementary', { name: 'Upgrade details', exact: true })
    const previousScroll = await scrollDetails(details)

    // Selecting this stable ID again must retain useful reading position.
    await selectUpgrade(page, start.title)
    await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBe(previousScroll)

    await details.getByRole('region', { name: 'Leads to', exact: true }).getByRole('button', { name: neighbor.title }).click()
    await expect(details.getByRole('heading', { level: 2 })).toHaveText(neighbor.title)
    await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(details.getByRole('heading', { level: 2 })).toBeInViewport()
    expect(await details.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100)
  })
}

test('different stable IDs reset details scrolling even when their titles match', async ({ page }) => {
  if (test.info().project.name === 'desktop') await page.setViewportSize({ width: 1280, height: 600 })
  await page.addInitScript((revision) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify({
    version: 1, catalogRevision: revision, epoch: 0, purchases: {}, milestones: {}, showSpoilers: true,
  })), catalog.revision)
  const keys = catalog.upgrades.filter((upgrade) => upgrade.title === 'Astral Key')
  const first = keys[0], next = keys[keys.length - 1]
  expect(first.id).not.toBe(next.id)
  const selectKey = async (cost: string) => {
    await page.getByRole('searchbox').fill('Astral Key')
    await page.locator('.search-result').filter({ has: page.getByRole('math', { name: `${BigInt(cost).toLocaleString('en')} Slayer Points`, exact: true }) }).click()
    await expect(page.locator('.detail-cost').getByRole('math')).toHaveAccessibleName(`${BigInt(cost).toLocaleString('en')} Slayer Points`)
  }
  await page.goto('./ascension/')
  await selectKey(first.cost)
  await expandDetails(page)
  const details = page.getByRole('complementary', { name: 'Upgrade details', exact: true })
  await scrollDetails(details)
  await selectKey(next.cost)
  await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(details.getByRole('heading', { level: 2 })).toBeInViewport()
})
