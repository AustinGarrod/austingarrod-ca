import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog, type Profile } from '../../src/domain/types'
import { planPurchase } from '../../src/domain/rules'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { denyProfileWrites, seedProfile } from './helpers/profile'
import { openAction, showSpoilers } from './helpers/app'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!
function buy(title: string, profile = emptyProfile(catalog.revision)): Profile {
  const choices: Record<string, number> = {}
  for (let i = 0; i < 100; i++) {
    const plan = planPurchase(catalog, profile, node(title).id, choices)
    if (plan.kind === 'ready') return plan.profile
    if (plan.kind === 'blocked') throw new Error(plan.reason)
    choices[plan.key] = 0
  }
  throw new Error('Unresolved synthetic profile')
}
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})
const stored = (page: Page) => page.evaluate(() => Object.keys(localStorage).sort().map((key) => [key, window.__readMapProfileText(key)]))
async function inspect(page: Page, title: string) {
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.getByRole('searchbox').fill(title)
  await page.locator(`.search-result[data-upgrade-id="${node(title).id}"]`).click()
  const toggle = page.getByRole('button', { name: 'Show details', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await expect(page.locator('.details h2')).toHaveText(title)
}
async function analyze(page: Page, title: string) {
  await inspect(page, title)
  await page.getByRole('button', { name: 'Analyze forward impact…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Forward impact', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  return dialog
}

for (const stocks of [false, true]) test(`one Portals event respects the independent Stocks Buyer AND gate (${stocks})`, async ({ page }) => {
  const profile = stocks ? buy('Stocks Buyer', buy('Soul Gatherer Bundle')) : buy('Soul Gatherer Bundle')
  await seedProfile(page, profile)
  await page.goto('./ascension/')
  const before = await stored(page)
  const dialog = await analyze(page, 'Portals')
  const eligible = dialog.getByRole('region', { name: 'Newly eligible to purchase', exact: true })
  await expect(eligible.locator('[data-impact-id]')).toHaveCount(stocks ? 2 : 1)
  await expect(eligible.locator(`[data-impact-id="${node('Portal Traveler').id}"]`)).toContainText('Missing → Satisfied')
  const map = dialog.locator(`[data-impact-id="${node('Map').id}"]`)
  await expect(stocks ? eligible : dialog.getByRole('region', { name: 'Still blocked', exact: true })).toContainText('Map')
  await map.locator('summary').click()
  await expect(map).toContainText('Stocks Buyer (active)')
  await expect(map).toContainText(' AND ')
  if (!stocks) await expect(map).toContainText('Purchase gates: Missing → Missing')
  await expect(dialog.locator('.forward-impact')).toHaveClass(/telemetry-private.*rr-block/)
  await expect(dialog.locator('[data-impact-reveals]')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /Apply|Record purchase/ })).toHaveCount(0)
  expect(await stored(page)).toEqual(before)
  await page.screenshot({ path: test.info().outputPath(`portals-stocks-${stocks}.png`) })
  await dialog.getByRole('button', { name: 'Return to details', exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText('Portals')
  await expect(page.getByRole('button', { name: 'Analyze forward impact…', exact: true })).toBeFocused()
  expect(await stored(page)).toEqual(before)
})

test('invalid proposal reports both native gates without prerequisite filling or activation correction', async ({ page }) => {
  await page.goto('./ascension/')
  const before = await stored(page)
  const dialog = await analyze(page, 'Portals')
  await expect(dialog).toContainText('This purchase cannot occur')
  await expect(dialog).toContainText('Soul Gatherer Bundle (active)')
  await expect(dialog.getByRole('region', { name: 'Newly eligible to purchase', exact: true })).toHaveCount(0)
  expect(await stored(page)).toEqual(before)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Armory receipt finds its no-edge consumer and returns to the unchanged milestone control', async ({ page }) => {
  const profile = buy('Bonus Stage 3', buy('Astral Slayer', { ...emptyProfile(catalog.revision), epoch: 1 }))
  const armory = catalog.milestones.find((item) => item.title === 'Armory')!
  await seedProfile(page, profile)
  await page.goto('./ascension/')
  const before = await stored(page)
  await openAction(page, 'Milestones')
  const checkbox = page.locator(`[data-requirement-milestone="${armory.id}"]`)
  await expect(checkbox).not.toBeChecked()
  await page.getByRole('button', { name: 'Analyze receipt of Armory', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Forward impact', exact: true })
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(dialog.getByRole('region', { name: 'Newly eligible to purchase', exact: true })).toContainText('Chest In a Chest')
  await expect(dialog).toContainText('actually been received, crafted or purchased')
  expect(await stored(page)).toEqual(before)
  await dialog.getByRole('button', { name: 'Back to Milestones', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Milestones', exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(checkbox).not.toBeChecked()
  expect(await stored(page)).toEqual(before)
})

for (const spoilers of [false, true]) test(`Astral Keys reveals retain eleven stable IDs only with explicit spoilers (${spoilers})`, async ({ page }) => {
  const keys = node('Astral Keys'), targets = catalog.upgrades.filter((upgrade) => upgrade.title === 'Astral Key')
  const excluded = new Set([keys.id, ...targets.map((upgrade) => upgrade.id)])
  const profile: Profile = { ...emptyProfile(catalog.revision), epoch: 1, showSpoilers: spoilers,
    purchases: Object.fromEntries(catalog.upgrades.filter((upgrade) => !excluded.has(upgrade.id)).map((upgrade) => [upgrade.id, { epoch: upgrade.retention === 'repeat' ? 1 : 0, active: true }])),
    milestones: Object.fromEntries(catalog.milestones.map((item) => [item.id, true as const])),
  }
  await seedProfile(page, profile)
  await page.goto('./ascension/')
  const before = await stored(page)
  const dialog = await analyze(page, 'Astral Keys')
  if (spoilers) {
    await expect(dialog.locator('[data-impact-reveals]')).toContainText('11 affected upgrades')
    await expect(dialog.locator('[data-impact-id]')).toHaveCount(10)
    await dialog.getByRole('button', { name: 'Show more affected upgrades', exact: true }).click()
    expect(await dialog.locator('[data-impact-id]').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.impactId))).toEqual(targets.map((upgrade) => upgrade.id))
    const last = dialog.locator(`[data-impact-id="${targets.at(-1)!.id}"]`)
    await expect(last.locator('.sp-cost')).toHaveAttribute('data-exact-cost', targets.at(-1)!.cost)
    await expect(last.getByRole('math', { name: `${BigInt(targets.at(-1)!.cost).toLocaleString('en')} Slayer Points`, exact: true })).toHaveCount(1)
  } else {
    await expect(dialog.locator('[data-impact-reveals]')).toHaveCount(0)
    await expect(dialog.locator('[data-impact-id]')).toHaveCount(0)
    for (const target of targets) expect(await dialog.textContent()).not.toContain(target.id)
    await expect(dialog).not.toContainText('11')
  }
  expect(await stored(page)).toEqual(before)
  await page.keyboard.press('Escape')
})

test('external progress invalidates analysis and generic dirty recovery replaces it with exactly one named dialog', async ({ page, context }) => {
  await denyProfileWrites(page, 'failProfileWrites')
  await page.goto('./ascension/')
  await inspect(page, 'Permanent Slayer')
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved on this device.')
  const dialog = await analyze(page, 'Soul Gatherer Bundle')
  const other = await context.newPage()
  await other.goto('./ascension/')
  await showSpoilers(other)
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review progress conflict', exact: true })).toBeVisible()
  const again = await analyze(page, 'Soul Gatherer Bundle')
  await again.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  const recovery = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  await expect(recovery).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Forward impact', exact: true })).toHaveCount(0)
  await recovery.getByRole('button', { name: 'Use checked saved progress', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Review progress replacement', exact: true })).toBeVisible()
  const before = await stored(page)
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await stored(page)).toEqual(before)
  await other.close()
  expect(JSON.parse((await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY))!).purchases).toEqual({})
})

test('compact analysis does not displace the native Purchase Tab path and keeps forecast controls usable in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('./ascension/')
  await page.getByRole('searchbox').fill('Permanent Slayer')
  await page.getByRole('searchbox').press('Enter')
  await expect(page.locator('.details h2')).toBeFocused()
  await expect(page.getByRole('button', { name: 'Analyze forward impact…', exact: true })).not.toBeVisible()
  let reached = false
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); if (await page.getByRole('button', { name: 'Record purchase…', exact: true }).evaluate((button) => document.activeElement === button)) { reached = true; break } }
  expect(reached).toBe(true)
  const toggle = page.getByRole('button', { name: 'Show details', exact: true })
  await toggle.click()
  const before = await stored(page)
  await page.getByRole('button', { name: 'Analyze forward impact…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Forward impact', exact: true })
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  const close = dialog.getByRole('button', { name: 'Return to details', exact: true })
  await close.scrollIntoViewIfNeeded()
  await expect(close).toBeInViewport()
  await close.click()
  expect(await stored(page)).toEqual(before)
})

test('analysis preserves the exact session Undo and Redo action without storing a plan or goal', async ({ page }) => {
  await page.goto('./ascension/')
  await inspect(page, 'Permanent Slayer')
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await openAction(page, 'Progress')
  const progress = page.getByRole('dialog', { name: 'Your progress', exact: true })
  await expect(progress.getByRole('button', { name: 'Undo', exact: true })).toContainText('Purchase')
  await progress.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(progress).toBeVisible()
  await expect(progress.getByRole('button', { name: 'Redo', exact: true })).toContainText('Purchase')
  await expect(progress.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await progress.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const before = await stored(page)
  const dialog = await analyze(page, 'Permanent Slayer')
  await dialog.getByRole('button', { name: 'Return to details', exact: true }).click()
  expect(await stored(page)).toEqual(before)
  await openAction(page, 'Progress')
  await expect(progress.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(progress.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await expect(progress.getByRole('button', { name: 'Redo', exact: true })).toContainText('Purchase')
  await progress.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('1 /')
})
