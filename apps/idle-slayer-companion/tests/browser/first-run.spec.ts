import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'

const progress = (page: Page) => page.evaluate((key) => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw).progress : null }, COMPANION_STORAGE_KEY)
async function openNavigation(page: Page) {
  await expect(page.locator('.companion-shell')).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'Companion sections', exact: true })
  if (!await navigation.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click()
  return page.locator('.companion-sidebar')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

test('a first visit starts with two clear paths and no migration notice', async ({ page }) => {
  await page.goto('./')
  const start = page.getByRole('region', { name: 'Start here', exact: true })
  await expect(start.getByRole('button', { name: 'Import a Windows Steam save', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Move Companion progress', exact: true })).toHaveCount(0)
  await start.getByRole('button', { name: 'Track by hand', exact: true }).click()
  await expect(page.locator('#companion-content')).toHaveAttribute('aria-label', 'Ascension')
})

test('the migration notice appears only for a guided arrival from the old copy', async ({ page }) => {
  await page.goto('./?migration=1#analytics=off')
  await expect(page.getByRole('region', { name: 'Move Companion progress', exact: true })).toBeVisible()
})

test('an empty section offers to show all entries through the shared spoiler setting, or an import', async ({ page }) => {
  await page.goto('./achievements/')
  const main = page.getByRole('main', { name: 'Achievements', exact: true })
  await expect(main.getByRole('heading', { name: 'Nothing revealed here yet', exact: true })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Start tracking', exact: true })).toHaveCount(0)
  await expect(main.getByRole('button', { name: 'Import a save', exact: true })).toBeVisible()
  await main.getByRole('button', { name: 'Show all entries', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.showSpoilers).toBe(true)
  // A long section starts as its list of category groups; opening one shows its entries.
  const group = main.locator('.companion-group-heading button').first()
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await group.click()
  await expect(main.locator('[id^="companion-entity-achievement-"]').first()).toBeVisible()
  await expect(main.getByRole('checkbox', { name: 'Show spoilers', exact: true })).toBeChecked()
})

test('after recording, Overview reports visible progress as X of Y', async ({ page }) => {
  await page.goto('./quests/')
  await page.getByRole('main', { name: 'Quests & Village', exact: true }).getByRole('button', { name: /^(Start tracking|Track quests)$/ }).first().click()
  await page.goto('./')
  await expect(page.getByRole('region', { name: 'Start here', exact: true })).toHaveCount(0)
  await expect(page.locator('.companion-journey-card').filter({ hasText: 'Quests & Village' })).toContainText(/\d+ of \d+ claimed or complete/)
  await expect(page.locator('.companion-journey-card').filter({ hasText: 'Upgrade map' })).toContainText(/\d+ of \d+ visible upgrades owned · 0 Ultra Ascensions/)
  await expect(page.getByRole('region', { name: 'Next suggested upgrade', exact: true })).toContainText('Idle Slayer Wiki')
})

test('Install & offline opens over the current section and returns there on close', async ({ page }) => {
  await page.goto('./crafting/')
  const sidebar = await openNavigation(page)
  await sidebar.getByRole('button', { name: 'Install & offline', exact: true }).click()
  const install = page.getByRole('dialog', { name: 'Install & offline', exact: true })
  await expect(install).toBeVisible()
  await install.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('#companion-content')).toHaveAttribute('aria-label', 'Crafting & materials')
  await expect(page).toHaveURL(/\/crafting\/$/)
})
