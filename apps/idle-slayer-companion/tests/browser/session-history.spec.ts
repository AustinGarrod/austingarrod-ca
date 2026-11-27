import { chooseLayout, closeMapOptions, exportMapBackup, exposeMapAction, mapAction, openData, openPriorAscensions, toolAction } from './helpers/app'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { PROFILE_WRITE_LOCK } from '../../src/domain/profile-session'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const start = catalog.upgrades.find((node) => node.id === catalog.startId)!
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})
async function purchase(page: Page) {
  await page.goto('./ascension/')
  await page.getByRole('searchbox').fill(start.title)
  await page.locator('.search-result').filter({ hasText: start.title }).first().click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'false')
}
async function open(page: Page, name: string) {
  await expect(page.locator('.toolbar')).toBeVisible()
  await mapAction(page, name)
}
/** Undo or Redo in the status row (the Record tools on short phones), checking the change it names. */
async function history(page: Page, direction: 'Undo' | 'Redo', label: string) {
  const row = page.locator('.companion-session-status').getByRole('button', { name: direction, exact: true })
  const inRow = await row.isVisible()
  const action = inRow ? row : toolAction(page, direction)
  await exposeMapAction(page, action)
  await expect(action).toContainText(label)
  if (inRow) await expect(action).toHaveAccessibleDescription(new RegExp(`${direction}: ${label}`))
  await action.click()
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'false')
}
const stored = (page: Page) => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)
const sessionHistory = (page: Page) => page.locator('.companion-session-status').getByRole('group', { name: 'Session history', exact: true })
async function expectHistory(page: Page, state: { undo: 'enabled' | 'disabled'; redo: 'enabled' | 'disabled' }) {
  for (const direction of ['Undo', 'Redo'] as const) {
    const action = toolAction(page, direction)
    await exposeMapAction(page, action)
    if (state[direction === 'Undo' ? 'undo' : 'redo'] === 'enabled') await expect(action).toBeEnabled()
    else await expect(action).toBeDisabled()
    await closeMapOptions(page)
  }
}
const expectHistoryDisabled = (page: Page) => expectHistory(page, { undo: 'disabled', redo: 'disabled' })

test('purchase and spoiler actions are labeled, accidental Undo can be redone, and reload clears visit history', async ({ page }) => {
  await purchase(page)
  // Map help explains where Undo lives and how long its history lasts.
  await open(page, 'Map help…')
  const help = page.getByRole('dialog', { name: 'Map help', exact: true })
  await expect(help).toContainText('Undo and Redo are in the status row above the map')
  await expect(help).toContainText('Undo is for this visit; changes from another tab can clear its history.')
  await help.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const toggle = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  await exposeMapAction(page, toggle)
  await toggle.check()
  await closeMapOptions(page)
  await history(page, 'Undo', 'Spoiler setting')
  expect(await stored(page)).toMatchObject({ showSpoilers: false, purchases: { [start.id]: { active: true } } })
  await expect(page.locator('.toast')).toContainText('Undid spoiler setting')
  await history(page, 'Redo', 'Spoiler setting')
  expect((await stored(page)).showSpoilers).toBe(true)
  await history(page, 'Undo', 'Spoiler setting')
  await history(page, 'Undo', 'Purchase recording')
  expect((await stored(page)).purchases).toEqual({})
  await history(page, 'Redo', 'Purchase recording')
  expect((await stored(page)).purchases[start.id]?.active).toBe(true)
  await page.reload()
  await expectHistoryDisabled(page)
  expect((await stored(page)).purchases[start.id]?.active).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('restore Undo and Redo retain hidden and unknown records without exposing their identities in history', async ({ page }) => {
  await purchase(page)
  const hidden = catalog.upgrades.find((node) => node.title === 'Soul Reaper III')!
  const incoming = { ...initial, epoch: 2, purchases: { [hidden.id]: { epoch: 1, active: false }, 'unknown-private-id': { epoch: 1, active: true } } }
  const data = await openData(page, { advanced: false })
  const chooser = page.waitForEvent('filechooser')
  await data.getByLabel('Restore from a backup file', { exact: true }).click()
  await (await chooser).setFiles({ name: 'private-history-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) })
  await page.getByRole('dialog', { name: 'Restore progress?', exact: true }).getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(() => stored(page)).toEqual(incoming)
  await history(page, 'Undo', 'JSON restore')
  expect((await stored(page)).purchases[start.id]?.active).toBe(true)
  const controls = sessionHistory(page)
  await expect(controls).not.toContainText(hidden.title)
  expect(await controls.innerHTML()).not.toMatch(/unknown-private-id|private-history-fixture/)
  await controls.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(() => stored(page)).toEqual(incoming)
  expect(Object.keys(await stored(page)).sort()).toEqual(Object.keys(initial).sort())
})

test('a new edit clears Redo and external progress clears both history directions', async ({ page, context }) => {
  await purchase(page)
  await history(page, 'Undo', 'Purchase recording')
  await expectHistory(page, { undo: 'disabled', redo: 'enabled' })
  const progress = await openPriorAscensions(page)
  await progress.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true }).fill('1')
  await progress.getByRole('button', { name: 'Review history…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Record history', exact: true }).click()
  await expect.poll(async () => (await stored(page)).epoch).toBe(1)
  await expectHistory(page, { undo: 'enabled', redo: 'disabled' })
  await history(page, 'Undo', 'Previous ascension history')
  await expect.poll(async () => (await stored(page)).epoch).toBe(0)
  // An open map dialog closes when another tab changes progress.
  await openPriorAscensions(page)
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: { ...initial, showSpoilers: true } })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectHistoryDisabled(page)
})

test('failed coordination retains exportable history and Undo/Redo without claiming a save', async ({ page }) => {
  await page.addInitScript((name) => {
    const native = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = ((requested: string, options: LockOptions, callback: (lock: unknown) => unknown) => requested === name ? Promise.resolve(callback(null)) : native(requested, options, callback)) as typeof native
  }, PROFILE_WRITE_LOCK)
  await purchase(page)
  await history(page, 'Undo', 'Purchase recording')
  await history(page, 'Redo', 'Purchase recording')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)).toBeNull()
  await expect(page.getByText(/Another tab is saving/).first()).toBeVisible()
  const download = page.waitForEvent('download')
  await exportMapBackup(page)
  const path = await (await download).path()
  expect(JSON.parse(readFileSync(path!, 'utf8')).purchases[start.id].active).toBe(true)
})

test('Undo after leaving an outstanding JSON read cannot let its late result create a stale restore', async ({ page }) => {
  await page.addInitScript(() => {
    const native = File.prototype.text
    File.prototype.text = function () { const file = this; return new Promise<string>((resolve) => { Object.assign(window, { releaseHistoryRead: () => { void native.call(file).then((text) => { resolve(text); Object.assign(window, { historyReadFinished: true }) }) } }) }) }
  })
  await purchase(page)
  // Undo sits outside the modal Data & backup dialog, so the read is left by closing it first.
  const data = await openData(page, { advanced: false })
  const chooser = page.waitForEvent('filechooser')
  await data.getByLabel('Restore from a backup file', { exact: true }).click()
  await (await chooser).setFiles({ name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...initial, epoch: 8 })) })
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseHistoryRead?: () => void }).releaseHistoryRead)).toBe('function')
  await data.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await history(page, 'Undo', 'Purchase recording')
  await expect.poll(async () => (await stored(page)).purchases).toEqual({})
  await page.evaluate(() => (window as Window & { releaseHistoryRead?: () => void }).releaseHistoryRead?.())
  await expect.poll(() => page.evaluate(() => (window as Window & { historyReadFinished?: boolean }).historyReadFinished)).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toHaveCount(0)
  expect((await stored(page)).epoch).toBe(0)
})

test('a pending Redo write disables both history directions until coordinated saving finishes', async ({ page }) => {
  await page.addInitScript((name) => {
    const win = window as Window & { holdHistoryWrite?: boolean; releaseHistoryWrite?: () => void }
    const native = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = ((requested: string, options: LockOptions, callback: (lock: unknown) => unknown) => requested === name
      ? win.holdHistoryWrite ? new Promise<unknown>((resolve) => { win.releaseHistoryWrite = () => resolve(callback({})) }) : Promise.resolve(callback({}))
      : native(requested, options, callback)) as typeof native
  }, PROFILE_WRITE_LOCK)
  await purchase(page)
  await history(page, 'Undo', 'Purchase recording')
  await page.evaluate(() => { (window as Window & { holdHistoryWrite?: boolean }).holdHistoryWrite = true })
  const redo = toolAction(page, 'Redo')
  await exposeMapAction(page, redo)
  await redo.click()
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'true')
  expect((await stored(page)).purchases).toEqual({})
  await expectHistoryDisabled(page)
  await page.evaluate(() => (window as Window & { releaseHistoryWrite?: () => void }).releaseHistoryWrite?.())
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'false')
  await expectHistory(page, { undo: 'enabled', redo: 'disabled' })
  expect((await stored(page)).purchases[start.id].active).toBe(true)
})

for (const layout of ['Game Layout', 'Detailed Layout']) test(`${layout} preserves the viewport when Undo hides a selected spoiler and Redo reveals it`, async ({ page }) => {
  const frames = () => page.evaluate(async () => { await document.fonts.ready; for (let count = 0; count < 8; count++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
  const camera = () => page.locator('.react-flow__viewport').evaluate((element) => { const matrix = new DOMMatrix(getComputedStyle(element).transform); return [matrix.e, matrix.f, matrix.a] })
  await page.goto('./ascension/')
  await chooseLayout(page, layout)
  const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  await exposeMapAction(page, checkbox)
  await checkbox.check()
  await closeMapOptions(page)
  await page.getByRole('searchbox').fill('Soul Reaper III')
  await page.locator('.search-result').filter({ hasText: 'Soul Reaper III' }).first().click()
  await frames()
  const before = await camera()
  await history(page, 'Undo', 'Spoiler setting')
  await expect(page.locator('.details')).toHaveCount(0)
  await frames()
  expect(await camera()).toEqual(before)
  await history(page, 'Redo', 'Spoiler setting')
  await frames()
  expect(await camera()).toEqual(before)
})


for (const width of [1101, 1280, 1440, 1920]) test(`${width}px action captions retain status and map geometry through history, Undo and Redo`, async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'These geometry cases cover desktop widths; compact history has separate phone coverage.')
    // The map's available width excludes the companion navigation rail.
    await page.setViewportSize({ width: width + 236, height: 900 })
    await page.goto('./ascension/')
    await expect(page.locator('.react-flow__node')).not.toHaveCount(0)
    await expect(page.locator('.companion-session-status')).toBeVisible()
    await page.evaluate(async () => { await document.fonts.ready; for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    const geometry = () => page.evaluate(() => {
      const footer = document.querySelector('.companion-session-status')!.getBoundingClientRect(), map = document.querySelector('.map')!.getBoundingClientRect()
      return { footerHeight: footer.height, mapHeight: map.height }
    })
    const before = await geometry()
    const progress = await openPriorAscensions(page)
    await progress.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true }).fill('1')
    await progress.getByRole('button', { name: 'Review history…', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Record history', exact: true }).click()
    await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 1')
    await expect.poll(geometry).toEqual(before)
    await history(page, 'Undo', 'Previous ascension history')
    await expect.poll(geometry).toEqual(before)
    await history(page, 'Redo', 'Previous ascension history')
    await expect.poll(geometry).toEqual(before)
    expect(await page.locator('.companion-session-status').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const button of await page.locator('.companion-session-status .session-history-controls button').all()) {
      expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const bounds = await button.boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
    }
})
