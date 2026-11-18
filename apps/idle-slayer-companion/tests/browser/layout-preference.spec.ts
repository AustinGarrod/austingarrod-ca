import { chooseLayout, openProgress } from './helpers/app'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog, Profile } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const layoutKey = 'idle-slayer-ascension-map.layout.v1'
const profileKey = 'idle-slayer-ascension-map.profile.v1'
const analyticsKey = 'idle-slayer-ascension-map.analytics.v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'disabled'), analyticsKey)
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

async function expectLayout(page: Page, name: 'Game Layout' | 'Detailed Layout') {
  const group = page.getByRole('group', { name: 'Map layout', exact: true })
  await expect(group.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(group.getByRole('button', { name: name === 'Game Layout' ? 'Detailed Layout' : 'Game Layout', exact: true })).toHaveAttribute('aria-pressed', 'false')
  if (name === 'Game Layout') await expect(page.locator('.map-game')).toBeVisible()
  else await expect(page.locator('.map-game')).toHaveCount(0)
}

test('fresh visits put Game Layout first and remember each user choice on reload', async ({ page }) => {
  await page.goto('./ascension/')
  await expect(page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button')).toHaveText(['Game Layout', 'Detailed Layout'])
  await expectLayout(page, 'Game Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBeNull()
  await chooseLayout(page, 'Detailed Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), layoutKey)).toBe('web')
  await page.reload()
  await expectLayout(page, 'Detailed Layout')
  await chooseLayout(page, 'Game Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), layoutKey)).toBe('native')
  await page.reload()
  await expectLayout(page, 'Game Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBeNull()
})

for (const storedValue of ['native', 'web', 'unexpected-layout']) {
  test(`stored layout ${storedValue} opens the expected view without altering profile data`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: layoutKey, value: storedValue })
    await page.goto('./ascension/')
    await expectLayout(page, storedValue === 'web' ? 'Detailed Layout' : 'Game Layout')
    expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBeNull()
  })
}

test('inaccessible layout storage falls back to Game Layout while both views remain usable', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'web')
    const read = Storage.prototype.getItem
    const write = Storage.prototype.setItem
    Storage.prototype.getItem = function (name) {
      if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('Synthetic inaccessible view preference', 'SecurityError')
      return read.call(this, name)
    }
    Storage.prototype.setItem = function (name, value) {
      if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('Synthetic inaccessible view preference', 'SecurityError')
      return write.call(this, name, value)
    }
  }, layoutKey)
  await page.goto('./ascension/')
  await expectLayout(page, 'Game Layout')
  await chooseLayout(page, 'Detailed Layout')
  await expectLayout(page, 'Detailed Layout')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(catalog.upgrades.find((upgrade) => upgrade.id === catalog.startId)!.title)
  await chooseLayout(page, 'Game Layout')
  await expectLayout(page, 'Game Layout')
  await page.reload()
  await expectLayout(page, 'Game Layout')
})

test('failed layout writes keep the chosen view usable and leave the stored preference intact', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'native')
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('Synthetic full preference storage', 'QuotaExceededError')
      return write.call(this, name, value)
    }
  }, layoutKey)
  await page.goto('./ascension/')
  await chooseLayout(page, 'Detailed Layout')
  await expectLayout(page, 'Detailed Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), layoutKey)).toBe('native')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Upgrade details', exact: true })).toBeVisible()
  await page.reload()
  await expectLayout(page, 'Game Layout')
})

test('profile backup, restore, clearing progress and undo keep layout preferences independent', async ({ page }) => {
  const restored: Profile = { ...emptyProfile(catalog.revision), purchases: { [catalog.startId]: { epoch: 0, active: true } } }
  await page.goto('./ascension/')
  await chooseLayout(page, 'Detailed Layout')
  await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(restored)) })
  await expect(page.getByRole('dialog')).toContainText('Restore progress?')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expectLayout(page, 'Detailed Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), layoutKey)).toBe('web')
  await openProgress(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  const download = await downloadPromise
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8'))).toEqual(restored)
  await page.getByRole('button', { name: 'Clear all progress…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expectLayout(page, 'Detailed Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), layoutKey)).toBe('web')
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)).toEqual(emptyProfile(catalog.revision))
  await chooseLayout(page, 'Game Layout')
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await undo.click()
  await expectLayout(page, 'Game Layout')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), layoutKey)).toBe('native')
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), profileKey)).toEqual(restored)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), analyticsKey)).toBe('disabled')
  await page.reload()
  await expectLayout(page, 'Game Layout')
})
