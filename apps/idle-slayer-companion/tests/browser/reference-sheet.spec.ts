import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { visibility } from '../../src/domain/rules'
import { createReferenceSheet } from '../../src/domain/reference-sheet'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})
async function add(page: Page, id: string) {
  const upgrade = catalog.upgrades.find((node) => node.id === id)!
  await page.getByRole('searchbox').fill(upgrade.title)
  await page.locator(`.search-result[data-upgrade-id="${id}"]`).click()
  const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
  await page.getByRole('button', { name: 'Add to reference sheet', exact: true }).click()
}
async function open(page: Page) {
  const menu = page.getByRole('button', { name: 'Map options', exact: true })
  if (await menu.isVisible()) await menu.click(); else await page.getByRole('button', { name: 'Map view…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Reference sheet', exact: true }).click()
  return page.getByRole('dialog', { name: 'Upgrade reference sheet', exact: true })
}
test('explicit preview matches every downloaded byte and print tab while keeping progress unchanged', async ({ page, context }, info) => {
  const viewer = { ...initial, epoch: 3, showSpoilers: true, purchases: { 'private-sheet-record': { epoch: 1, active: true } } }
  await page.addInitScript(({ key, viewer }) => { if (window === window.top) localStorage.setItem(key, JSON.stringify(viewer)) }, { key: PROFILE_STORAGE_KEY, viewer })
  await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible()
  const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key')
  const selected = [keys[0].id, keys.at(-1)!.id]
  for (const id of selected) await add(page, id)
  const dialog = await open(page)
  await expect(dialog.getByRole('button', { name: 'Save reviewed HTML', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Review outgoing sheet', exact: true }).click()
  const frame = dialog.locator('iframe')
  const expected = createReferenceSheet(catalog, viewer, selected).html
  expect(await frame.getAttribute('srcdoc')).toBe(expected)
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Astral Key', exact: true })).toHaveCount(2)
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save reviewed HTML', exact: true }).click()
  const download = await downloadPromise; const path = info.outputPath('reference-sheet.html'); await download.saveAs(path)
  expect(readFileSync(path, 'utf8')).toBe(expected)
  const requests: string[] = []; const watch = (request: import('@playwright/test').Request) => requests.push(request.url())
  context.on('request', watch)
  const popupPromise = page.waitForEvent('popup')
  await dialog.getByRole('button', { name: 'Open reviewed sheet for printing', exact: true }).click()
  const popup = await popupPromise
  try {
    await expect(popup.getByRole('heading', { name: 'Astral Key', exact: true })).toHaveCount(2)
    expect(await popup.evaluate(() => window.opener)).toBeNull()
    expect(await popup.locator('body').innerHTML()).not.toContain('private-sheet-record')
    expect(requests).toEqual([])
  } finally { context.off('request', watch); await popup.close() }
  expect(await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)).toBe(JSON.stringify(viewer))
})
test('four-entry bound, explicit removal, empty selection and reload remain honest without profile edits', async ({ page }) => {
  await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible()
  const ids = visibility(catalog, initial).upgrades.slice(0, 5).map((node) => node.id)
  for (const id of ids) await add(page, id)
  await expect(page.locator('.sheet-add')).toContainText('four-upgrade sheet is full')
  const dialog = await open(page); await expect(dialog.locator('li')).toHaveCount(4)
  await dialog.getByRole('button', { name: `Remove sheet upgrade ${ids[0]}`, exact: true }).click()
  await expect(dialog.locator('li')).toHaveCount(3)
  await dialog.getByRole('button', { name: 'Clear reference selection', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Review outgoing sheet', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape'); await page.reload(); await expect(page.locator('.toolbar')).toBeVisible()
  await expect((await open(page)).locator('li')).toHaveCount(0)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)).toBeNull()
})
test('a selected spoiler is pruned from counts and output after hiding and never restored by Undo', async ({ page }) => {
  await page.addInitScript(({ key, viewer }) => { if (window === window.top) localStorage.setItem(key, JSON.stringify(viewer)) }, { key: PROFILE_STORAGE_KEY, viewer: { ...initial, showSpoilers: true } })
  await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible()
  const hidden = catalog.upgrades.find((node) => !visibility(catalog, initial).ids.has(node.id))!
  await add(page, hidden.id); await add(page, catalog.startId)
  const dialog = await open(page); await dialog.getByRole('button', { name: 'Review outgoing sheet', exact: true }).click()
  await page.keyboard.press('Escape')
  const menu = page.getByRole('button', { name: 'Map options', exact: true })
  if (await menu.isVisible()) await menu.click(); else await page.getByRole('button', { name: 'Map view…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('checkbox', { name: 'Show spoilers', exact: true }).uncheck()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Reference sheet', exact: true }).click()
  await expect(dialog.locator('li')).toHaveCount(1)
  await expect(dialog.locator('iframe')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Review outgoing sheet', exact: true }).click()
  const html = await dialog.locator('iframe').getAttribute('srcdoc')
  expect(html).not.toContain(hidden.id); expect(html).not.toContain(hidden.title)
  await page.keyboard.press('Escape')
  let undo = page.locator('.companion-session-status').getByRole('button', { name: 'Undo', exact: true })
  if (!await undo.isVisible()) {
    if (await menu.isVisible()) await menu.click(); else await page.getByRole('button', { name: 'Map view…', exact: true }).click()
    undo = page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Undo', exact: true })
  }
  await expect(undo).toContainText('Spoiler setting'); await undo.click()
  await expect(page.locator('.toast')).toContainText('Spoilers shown')
  await expect((await open(page)).locator('li')).toHaveCount(1)
})

test('external progress cancels the preview and blocked print tabs retain the save fallback', async ({ page, context }) => {
  await page.addInitScript(() => { window.open = () => null })
  await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible()
  await add(page, catalog.startId)
  const dialog = await open(page); await dialog.getByRole('button', { name: 'Review outgoing sheet', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open reviewed sheet for printing', exact: true }).click()
  await expect(dialog).toContainText('Save the reviewed HTML file')
  await expect(dialog.getByRole('button', { name: 'Save reviewed HTML', exact: true })).toBeEnabled()
  const other = await context.newPage(); await other.goto('./ascension/'); await expect(other.locator('.toolbar')).toBeVisible()
  await other.evaluate(({ key, viewer }) => window.__writeExternalMapProfileText(key, JSON.stringify(viewer)), { key: PROFILE_STORAGE_KEY, viewer: { ...initial, epoch: 1 } })
  await expect(dialog).toHaveCount(0)
  const fresh = await open(page)
  await expect(fresh.locator('li')).toHaveCount(1)
  await expect(fresh.locator('iframe')).toHaveCount(0)
  await other.close()
})

for (const change of ['remove', 'clear', 'close'] as const) {
  for (const output of ['save', 'print'] as const) {
    test(`queued ${change} invalidates the old ${output} action before React commits`, async ({ page }) => {
      await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible()
      const ids = visibility(catalog, initial).upgrades.slice(0, 2).map((node) => node.id)
      for (const id of ids) await add(page, id)
      const dialog = await open(page)
      await dialog.getByRole('button', { name: 'Review outgoing sheet', exact: true }).click()
      const result = await dialog.evaluate((element, { change, output, id }) => {
        const outputs: string[] = []
        const originalURL = URL.createObjectURL
        const originalOpen = window.open
        URL.createObjectURL = (blob) => { outputs.push('download'); return originalURL(blob) }
        window.open = () => { outputs.push('print'); return null }
        try {
          const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')]
          const first = change === 'remove'
            ? buttons.find((button) => button.getAttribute('aria-label') === `Remove sheet upgrade ${id}`)
            : change === 'close'
              ? buttons.find((button) => button.getAttribute('aria-label') === 'Close dialog')
              : buttons.find((button) => button.textContent === 'Clear reference selection')
          const second = buttons.find((button) => button.textContent === (output === 'save' ? 'Save reviewed HTML' : 'Open reviewed sheet for printing'))
          if (!first || !second) throw new Error('Expected live native change and output controls')
          first.click()
          const stillConnected = second.isConnected
          second.click()
          return { stillConnected, outputs }
        } finally { URL.createObjectURL = originalURL; window.open = originalOpen }
      }, { change, output, id: ids[0] })
      expect(result.stillConnected).toBe(true)
      expect(result.outputs).toEqual([])
      if (change === 'close') await expect(dialog).toHaveCount(0)
      else {
        await expect(dialog.locator('li')).toHaveCount(change === 'remove' ? 1 : 0)
        await expect(dialog.locator('iframe')).toHaveCount(0)
      }
      expect(await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)).toBeNull()
    })
  }
}
