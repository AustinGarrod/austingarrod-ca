import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog, type Profile, type Upgrade } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { denyProfileWrites } from './helpers/profile'
import { showSpoilers } from './helpers/app'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const visible = visibility(catalog, initial)
const start = catalog.upgrades.find((node) => node.id === catalog.startId)!
const neighbor = catalog.upgrades.find((node) => visible.connections.some((edge) => edge.from === start.id && edge.to === node.id))!
const other = visible.upgrades.find((node) => node.id !== start.id && node.id !== neighbor.id)!
const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key')

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})
async function seed(page: Page, profile: Profile) {
  await page.addInitScript(({ key, profile }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(profile))
  }, { key: PROFILE_STORAGE_KEY, profile })
}
async function select(page: Page, node: Upgrade) {
  await page.getByRole('searchbox').fill(node.title)
  await page.locator(`.search-result[data-upgrade-id="${node.id}"]`).click()
  await expect(page.locator('.details h2')).toHaveText(node.title)
}
async function options(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const wide = page.getByRole('button', { name: 'Map view…', exact: true })
  if (await wide.isVisible()) await wide.click()
  else await page.getByRole('button', { name: 'Map options', exact: true }).click()
}
async function recent(page: Page) {
  await options(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Recent upgrades…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Recent upgrades', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
const ids = (page: Page) => page.getByRole('dialog', { name: 'Recent upgrades', exact: true }).locator('[data-upgrade-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-upgrade-id')))
const stored = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)

for (const layout of ['Game Layout', 'Detailed Layout']) test(`${layout} returns through search and connected inspections without progress history or overview changes`, async ({ page }) => {
  await page.goto('./ascension/')
  await page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name: layout, exact: true }).click()
  await select(page, start)
  const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
  await page.getByRole('region', { name: 'Leads to', exact: true }).getByRole('button', { name: neighbor.title, exact: false }).click()
  await select(page, other)
  await page.locator('.details').getByRole('button', { name: 'Recent upgrades…', exact: true }).click()
  expect(await ids(page)).toEqual([other.id, neighbor.id, start.id])
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Recently inspected upgrades', exact: true })).toHaveClass(/telemetry-private rr-block/)
  const back = page.getByRole('dialog').locator(`[data-upgrade-id="${start.id}"]`)
  await back.focus(); await page.keyboard.press('Enter')
  await expect(page.locator('.details h2')).toHaveText(start.title); await expect(page.locator('.details h2')).toBeFocused()
  await expect(page.locator(`.react-flow__node[data-id="${start.id}"]`)).toHaveAttribute('aria-current', 'true')
  await options(page); await expect(page.getByRole('dialog').getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.getByRole('dialog').getByRole('button', { name: 'Overview visible map', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('Visible map overview')
  await recent(page); expect(await ids(page)).toEqual([start.id, other.id, neighbor.id])
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Return to inspection', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Return to inspection', exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(start.title)
  expect(await stored(page)).toBeNull()
  await page.getByRole('button', { name: 'Close upgrade details', exact: true }).click()
  await recent(page); expect(await ids(page)).toEqual([start.id, other.id, neighbor.id])
  await page.reload(); await recent(page); expect(await ids(page)).toEqual([])
  await expect(page.getByRole('dialog')).toContainText('No recently inspected visible upgrades')
})

test('bounds distinct visits and returning moves a stable ID to the newest position', async ({ page }) => {
  await page.goto('./ascension/')
  const visits = visible.upgrades.slice(0, 23)
  for (const node of visits) await select(page, node)
  let dialog = await recent(page)
  expect(await ids(page)).toEqual(visits.slice(3).reverse().map((node) => node.id))
  await dialog.locator(`[data-upgrade-id="${visits[7].id}"]`).click()
  dialog = await recent(page)
  expect(await ids(page)).toEqual([visits[7].id, ...visits.slice(3).reverse().filter((node) => node.id !== visits[7].id).map((node) => node.id)])
  await dialog.getByRole('button', { name: 'Clear recent upgrades', exact: true }).click()
  expect(await ids(page)).toEqual([]); expect(await stored(page)).toBeNull()
})

test('same-title recent rows keep exact cost and stable identity while visibility pruning cannot revive hidden visits', async ({ page }) => {
  const profile = { ...initial, showSpoilers: true }
  await seed(page, profile); await page.goto('./ascension/'); await select(page, start); await select(page, keys[0]); await select(page, keys[1])
  let dialog = await recent(page)
  expect(await ids(page)).toEqual([keys[1].id, keys[0].id, start.id])
  for (const node of keys.slice(0, 2)) {
    const row = dialog.locator(`[data-upgrade-id="${node.id}"]`)
    await expect(row).toContainText(`ID: ${node.id}`); await expect(row).toContainText(`${BigInt(node.cost).toLocaleString('en')} SP`)
  }
  await dialog.locator(`[data-upgrade-id="${keys[0].id}"]`).click()
  await expect(page.locator(`.react-flow__node[data-id="${keys[0].id}"]`)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.detail-cost')).toHaveText(`${BigInt(keys[0].cost).toLocaleString('en')} SP`)
  await options(page); await page.getByRole('dialog').getByRole('checkbox', { name: 'Show spoilers', exact: true }).uncheck()
  await page.getByRole('dialog').getByRole('button', { name: 'Recent upgrades…', exact: true }).click()
  expect(await ids(page)).toEqual([start.id]); await expect(page.getByRole('dialog')).not.toContainText('Astral Key')
  for (const node of keys) expect(await page.getByRole('dialog').innerHTML()).not.toContain(node.id)
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await options(page); await page.getByRole('dialog').getByRole('button', { name: 'Undo', exact: true }).click()
  await options(page); await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Show spoilers', exact: true })).toBeChecked()
  await page.getByRole('dialog').getByRole('button', { name: 'Recent upgrades…', exact: true }).click()
  expect(await ids(page)).toEqual([start.id])
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await options(page); await page.getByRole('dialog').getByRole('button', { name: 'Redo', exact: true }).click()
  await recent(page)
  expect(await ids(page)).toEqual([start.id])
})

test('external visibility change reconciles the open trail and retaining navigation never restores a profile', async ({ page, context }) => {
  const profile = { ...initial, showSpoilers: true }
  await seed(page, profile); await page.goto('./ascension/'); await select(page, start); await select(page, keys[0]); await recent(page)
  const otherPage = await context.newPage(); await otherPage.goto(page.url())
  await otherPage.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: initial })
  await expect(page.getByRole('dialog', { name: 'Recent upgrades', exact: true })).toHaveCount(0)
  await expect(page.locator('.details')).toHaveCount(0)
  const dialog = await recent(page); expect(await ids(page)).toEqual([start.id])
  await dialog.locator(`[data-upgrade-id="${start.id}"]`).click()
  expect(JSON.parse((await stored(page))!)).toEqual(initial)
})

test('returning preserves the requirement target and does not choose an OR purchase path', async ({ page }) => {
  const target = catalog.upgrades.find((node) => node.purchase.kind === 'any' && node.purchase.requirements.length > 1 && node.purchase.requirements.every((item) => item.kind === 'active'))!
  const profile = { ...initial, showSpoilers: true }
  await seed(page, profile); await page.goto('./ascension/'); await select(page, target)
  const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
  await page.locator('.details dt').filter({ hasText: /^Purchase requirements$/ }).locator('+ dd').getByRole('button').first().click()
  await expect(page.locator('.details h2')).toBeFocused()
  await recent(page); await page.getByRole('dialog').locator(`[data-upgrade-id="${target.id}"]`).click()
  await expect(page.locator('.details').getByRole('button', { name: `Return to ${target.title}`, exact: true })).toBeVisible()
  await page.locator('.details').getByRole('button', { name: `Return to ${target.title}`, exact: true }).click()
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose a prerequisite path', exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); expect(JSON.parse((await stored(page))!)).toEqual(profile)
})

test('recent inspection actions remain reachable in short landscape and narrow windows', async ({ page }, info) => {
  for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }, { width: 375, height: 350 }]) {
    await page.setViewportSize(viewport); await page.goto('./ascension/'); await select(page, start); await select(page, neighbor)
    const dialog = await recent(page)
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const back = dialog.locator(`[data-upgrade-id="${start.id}"]`)
    await back.scrollIntoViewIfNeeded(); await expect(back).toBeInViewport()
    expect(await back.evaluate((element) => { const r = element.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 })).toBe(true)
    await page.screenshot({ path: info.outputPath(`recent-upgrades-${viewport.width}x${viewport.height}.png`) })
    await back.focus(); await page.keyboard.press('Enter')
    await expect(page.locator('.details h2')).toHaveText(start.title)
    await expect(page.locator('.details h2')).toBeFocused()
    await expect(page.getByRole('button', { name: 'Close upgrade details', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await stored(page)).toBeNull()
  }
})

test('clearing navigation keeps purchase Undo available and opening from details clears earlier feedback', async ({ page }) => {
  await page.goto('./ascension/'); await select(page, start)
  const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect.poll(async () => JSON.parse((await stored(page))!).purchases[start.id]?.active).toBe(true)
  await page.locator('.details').getByRole('button', { name: 'Recent upgrades…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Recent upgrades', exact: true })
  await expect(dialog.locator('.dialog-feedback')).toHaveText('')
  await dialog.getByRole('button', { name: 'Clear recent upgrades', exact: true }).click()
  expect(await ids(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.locator('.details').getByRole('button', { name: 'Recent upgrades…', exact: true })).toBeFocused()
  await options(page); const undo = page.getByRole('dialog').getByRole('button', { name: 'Undo', exact: true })
  await expect(undo).toBeEnabled(); await undo.click()
  await expect.poll(async () => JSON.parse((await stored(page))!).purchases[start.id]).toBeUndefined()
  await recent(page); expect(await ids(page)).toEqual([])
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await options(page); const redo = page.getByRole('dialog').getByRole('button', { name: 'Redo', exact: true })
  await expect(redo).toBeEnabled(); await redo.click()
  await expect.poll(async () => JSON.parse((await stored(page))!).purchases[start.id]?.active).toBe(true)
  await recent(page); expect(await ids(page)).toEqual([])
})

test('conflict review replaces Recent with one correctly named dialog and retains its inspection trail', async ({ page, context }, info) => {
  await denyProfileWrites(page, 'failProfileWrites')
  await page.goto('./ascension/')
  await select(page, neighbor)
  await select(page, start)
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  const other = await context.newPage()
  await other.goto(page.url())
  await showSpoilers(other)
  await expect(page.getByRole('button', { name: 'Review progress conflict', exact: true })).toBeVisible()
  const saved = await stored(page)
  const reopened = await recent(page)
  expect(await ids(page)).toEqual([start.id, neighbor.id])
  await reopened.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  const review = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  await expect(review).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Recent upgrades', exact: true })).toHaveCount(0)
  expect(await stored(page)).toBe(saved)
  await page.screenshot({ path: info.outputPath('recent-conflict-review.png') })
  await review.getByRole('button', { name: 'Use checked saved progress', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  const replace = page.getByRole('region', { name: 'Review progress replacement', exact: true })
  await expect(replace).toBeVisible()
  await replace.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await recent(page)
  expect(await ids(page)).toEqual([start.id, neighbor.id])
  expect(await stored(page)).toBe(saved)
  await page.keyboard.press('Escape')
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await other.close()
})
