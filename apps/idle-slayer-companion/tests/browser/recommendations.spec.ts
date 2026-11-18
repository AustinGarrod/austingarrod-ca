import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const start = catalog.upgrades.find((upgrade) => upgrade.id === catalog.startId)!
const gatherer = catalog.upgrades.find((upgrade) => upgrade.title === 'Soul Gatherer Bundle')!
const quests = catalog.upgrades.find((upgrade) => upgrade.title === 'Permanent Quests')!
const visible = visibility(catalog, initial)

async function openSuggestions(page: Page) {
  await page.getByRole('button', { name: 'Next upgrade', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function undo(page: Page) {
  const button = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await button.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await button.click()
}

test('wiki suggestion follows recorded purchases and undo without changing layout', async ({ page }) => {
  await page.goto('./ascension/')
  await page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: 'Game Layout', exact: true }).click()
  let dialog = await openSuggestions(page)
  await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', start.id)
  await expect(dialog.locator('.recommendation-main')).toContainText('2 SP')
  await dialog.locator('.recommendation-main').getByRole('button', { name: 'Show on map', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.details h2')).toHaveText(start.title)
  await expect(page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: 'Game Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.profile.v1'))).toBeNull()

  dialog = await openSuggestions(page)
  await dialog.locator('.recommendation-main').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Record purchase?')
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  dialog = await openSuggestions(page)
  // Quests stay excluded until their native Gatherer prerequisite is owned.
  await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', gatherer.id)
  await expect(dialog.locator('.recommendation-main')).toContainText('4 SP')
  await expect(dialog.locator(`.recommendation-card[data-upgrade-id="${quests.id}"]`)).toHaveCount(0)
  await dialog.locator('.recommendation-main').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  dialog = await openSuggestions(page)
  await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', quests.id)
  await expect(dialog.locator('.recommendation-main')).toContainText('3 SP')
  await expect(dialog.locator('.recommendation-alternatives .recommendation-card')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await undo(page)
  dialog = await openSuggestions(page)
  await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', gatherer.id)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await undo(page)
  dialog = await openSuggestions(page)
  await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', start.id)
})

test('recommendation dialog filters spoilers and owned pending locks with source attribution', async ({ page }) => {
  const pending = catalog.upgrades.find((upgrade) => upgrade.activation === 'after-ultra-ascension')!
  const profile = { ...initial, purchases: { [pending.id]: { epoch: 0, active: false } } }
  await page.addInitScript((value) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify(value)), profile)
  await page.goto('./ascension/')
  const dialog = await openSuggestions(page)
  const ids = await dialog.locator('.recommendation-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-upgrade-id')))
  expect(ids).not.toContain(pending.id)
  expect(ids.every((id) => id !== null && visibility(catalog, profile).ids.has(id))).toBe(true)
  const links = await dialog.getByRole('link').evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href))
  expect(links.some((url) => url.startsWith('https://idleslayer.fandom.com/wiki/Ascension_Tree_Tier_List'))).toBe(true)
  await expect(dialog).toContainText('7.0.0')
  await expect(dialog).toContainText(catalog.gameVersion)
  await expect(dialog).not.toContainText('affordable')
  for (const card of await dialog.locator('.recommendation-card').all()) {
    const id = (await card.getAttribute('data-upgrade-id'))!
    const upgrade = catalog.upgrades.find((node) => node.id === id)!
    await expect(card.getByRole('math')).toHaveAccessibleName(`${BigInt(upgrade.cost).toLocaleString('en')} Slayer Points`)
  }
})

test('restored purchases determine suggestions and all-owned profile has an honest empty state', async ({ page }) => {
  const profile = { ...initial, purchases: Object.fromEntries(catalog.upgrades.map((upgrade) => [upgrade.id, { epoch: 0, active: true }])) }
  await page.addInitScript((value) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify(value)), profile)
  await page.goto('./ascension/')
  const dialog = await openSuggestions(page)
  await expect(dialog.locator('.recommendation-card')).toHaveCount(0)
  await expect(dialog).toContainText('owned')
  await expect(dialog.getByRole('button', { name: 'Record purchase…', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!).purchases)).toEqual(profile.purchases)
})

test('keyboard dismissal returns focus and suggestion actions stay usable on compact screens', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    const trigger = page.getByRole('button', { name: 'Next upgrade', exact: true })
    await expect(trigger).toBeInViewport()
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.recommendation-main').getByRole('button', { name: 'Show on map', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dialog.locator('.recommendation-main').getByRole('button', { name: 'Show on map', exact: true }).click()
    await expect(page.locator('.details h2')).toHaveText(start.title)
    await expect(page.locator(`.react-flow__node[data-id="${start.id}"]`)).toBeInViewport()
    const ids = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')))
    expect(ids.every((id) => id !== null && visible.ids.has(id))).toBe(true)
  }
})

test('successive suggestions and an alternative each require a separate confirmation', async ({ page }) => {
  await page.goto('./ascension/')
  let dialog = await openSuggestions(page)
  for (const upgrade of [start, gatherer]) {
    await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', upgrade.id)
    await dialog.locator('.recommendation-main').getByRole('button', { name: 'Record purchase…', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Record purchase?', exact: true })
    const before = await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.profile.v1'))
    await expect(preview).toContainText(upgrade.title)
    expect(before === null || !JSON.parse(before).purchases[upgrade.id]).toBe(true)
    await preview.getByRole('button', { name: 'Apply and continue suggestions', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator(`[data-upgrade-id="${upgrade.id}"]`)).toHaveCount(0)
    expect(await page.evaluate((id) => !!JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!).purchases[id], upgrade.id)).toBe(true)
  }
  await expect(dialog.locator('.recommendation-card')).toHaveCount(3)
  for (const card of await dialog.locator('.recommendation-card').all()) {
    const cardId = await card.getAttribute('data-upgrade-id')
    const upgrade = catalog.upgrades.find((upgrade) => upgrade.id === cardId)!
    await expect(card.locator('.recommendation-effect')).toContainText(upgrade.description)
    await expect(card).toContainText(`${BigInt(upgrade.cost).toLocaleString('en')} SP`)
    await expect(card.getByRole('button', { name: /Record .*purchase/ })).toBeEnabled()
  }
  const reaper = catalog.upgrades.find((upgrade) => upgrade.title === 'Soul Reaper')!
  const alternative = dialog.locator(`.recommendation-card[data-upgrade-id="${reaper.id}"]`)
  await expect(alternative).not.toHaveClass(/recommendation-main/)
  await alternative.getByRole('button', { name: `Record ${reaper.title} purchase…`, exact: true }).click()
  await page.getByRole('dialog', { name: 'Record purchase?', exact: true }).getByRole('button', { name: 'Back to suggestions', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
  expect(await page.evaluate((id) => !!JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!).purchases[id], reaper.id)).toBe(false)
  await dialog.locator(`.recommendation-card[data-upgrade-id="${reaper.id}"]`).getByRole('button', { name: `Record ${reaper.title} purchase…`, exact: true }).click()
  await page.getByRole('button', { name: 'Apply and continue suggestions', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
  await expect(dialog.locator(`[data-upgrade-id="${reaper.id}"]`)).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!).purchases))).toHaveLength(3)
  await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', quests.id)
  await dialog.locator('.recommendation-main').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!).purchases))).toHaveLength(4)
  await undo(page)
  dialog = await openSuggestions(page)
  await expect(dialog.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', quests.id)
  expect(await page.evaluate(() => Object.keys(JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!).purchases))).toHaveLength(3)
})

test('suggestion purchase choices wrap and remain actionable on compact screens', async ({ page }, info) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    const dialog = await openSuggestions(page)
    await dialog.locator('.recommendation-main').getByRole('button', { name: 'Record purchase…', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Record purchase?', exact: true })
    expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    for (const name of ['Apply and continue suggestions', 'Apply purchases', 'Back to suggestions', 'Cancel']) {
      const button = preview.getByRole('button', { name, exact: true })
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeInViewport()
      const size = await button.boundingBox()
      expect(size!.height).toBeGreaterThanOrEqual(44)
      expect(size!.width).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: info.outputPath(`purchase-choices-${viewport.width}.png`) })
    await preview.getByRole('button', { name: 'Back to suggestions', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.profile.v1'))).toBeNull()
  }
})
