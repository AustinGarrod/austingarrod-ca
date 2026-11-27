import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'
import type { CompanionCatalog } from '../../src/domain/companion-types'

const catalog = JSON.parse(readFileSync('public/companion-catalog.json', 'utf8')) as CompanionCatalog
const progress = (page: Page) => page.evaluate((key) => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw).progress : null }, COMPANION_STORAGE_KEY)
const entry = (page: Page, system: string, id: string) => page.locator(`[id="companion-entity-${system}-${id}"]`)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

test('a long tracker starts as category groups with counts, and a search opens the matching rows', async ({ page }) => {
  const achievements = catalog.entities.filter((entity) => entity.system === 'achievement')
  const target = achievements.find((entity) => entity.category === 'PowerLevel')!
  await page.goto('./achievements/')
  const main = page.getByRole('main', { name: 'Achievements', exact: true })
  await main.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  // One heading per category, closed, each with its own count; no paging control.
  const headings = main.locator('.companion-group-heading button')
  await expect(headings.first()).toHaveAttribute('aria-expanded', 'false')
  expect(await headings.count()).toBe(new Set(achievements.map((entity) => entity.category)).size)
  await expect(main.locator('.companion-group-heading').filter({ hasText: 'Power Level' })).toContainText(/0 of \d+ earned/)
  await expect(main.getByRole('button', { name: /Show more/ })).toHaveCount(0)
  await expect(main.locator('.companion-entity')).toHaveCount(0)
  // Searching opens the groups that match; the row records its fact in place.
  await main.getByRole('searchbox', { name: 'Search visible achievements' }).fill(target.title)
  const row = entry(page, 'achievement', target.id)
  await expect(row).toBeVisible()
  await row.getByRole('group', { name: 'Achievement', exact: true }).getByRole('button', { name: 'Earned', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.modules.achievement.records[target.id]?.completed).toBe(true)
  await expect(row.getByRole('group', { name: 'Achievement', exact: true }).getByRole('button', { name: 'Earned', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // The row expands in place into the full entry; its controls are not repeated in the row.
  const open = row.getByRole('button', { name: target.title, exact: true })
  await open.click()
  await expect(open).toHaveAttribute('aria-expanded', 'true')
  const details = row.getByRole('region', { name: `${target.title} details`, exact: true })
  await expect(details.getByText('Source & identity', { exact: true })).toBeVisible()
  await expect(row.getByRole('group', { name: 'Achievement', exact: true })).toHaveCount(1)
  // Clearing the search keeps the category list closed again, with the new count.
  await main.getByRole('searchbox', { name: 'Search visible achievements' }).fill('')
  await expect(main.locator('.companion-group-heading').filter({ hasText: 'Power Level' })).toContainText(/1 of \d+ earned/)
  await main.getByRole('button', { name: 'Open all groups', exact: true }).click()
  await expect(headings.last()).toHaveAttribute('aria-expanded', 'true')
  await main.getByRole('button', { name: 'Close all groups', exact: true }).click()
  await expect(headings.first()).toHaveAttribute('aria-expanded', 'false')
})

test('a link to an entry opens its group, expands it and focuses it', async ({ page }) => {
  const enemy = catalog.entities.find((entity) => entity.system === 'enemy' && entity.category === 'Ground enemies')!
  await page.goto('./')
  await page.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await page.getByRole('searchbox', { name: 'Search visible companion entries' }).fill(enemy.title)
  await page.getByRole('region', { name: 'Search results', exact: true }).getByRole('button').filter({ hasText: enemy.title }).first().click()
  const row = entry(page, 'enemy', enemy.id)
  await expect(row).toBeFocused()
  await expect(row.getByRole('button', { name: enemy.title, exact: true })).toHaveAttribute('aria-expanded', 'true')
  // Kills are recorded in the expanded entry on every screen size.
  const kills = row.getByRole('textbox', { name: 'Kills', exact: true })
  await kills.fill('42')
  await kills.press('Enter')
  await expect.poll(async () => (await progress(page))?.modules.enemy.records[enemy.id]?.count).toBe('42')
})

test('on a phone the first group starts above the fold and rows stay compact', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Phone layout only')
  await page.goto('./bestiary/')
  const main = page.getByRole('main', { name: 'Bestiary', exact: true })
  await main.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  const first = main.locator('.companion-group').first()
  const viewport = page.viewportSize()!
  const box = (await first.boundingBox())!
  expect(box.y).toBeLessThan(viewport.height)
  const row = main.locator('.companion-entity').first()
  const height = (await row.boundingBox())!.height
  expect(height).toBeLessThanOrEqual(120)
  // The count is recorded in the expanded entry; the collapsed row offers only the one fact.
  await expect(row.getByRole('textbox', { name: 'Kills', exact: true })).toBeHidden()
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', viewport.width)
})
