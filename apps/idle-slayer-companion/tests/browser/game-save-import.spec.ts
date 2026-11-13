import { openProgress } from './helpers/app'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'
import { encodeGameSaveFixture, nativeSaveFixture } from '../fixtures/game-save'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const storageKey = 'idle-slayer-ascension-map.profile.v1'
const start = catalog.startId
const gatherer = '5ew02t2oprzthi4hmyk6'
const quests = '6d44qruuppdrshhefq8b'
const initial = emptyProfile(catalog.revision)

async function chooseSave(page: Page, bytes: Uint8Array, _retry = false) {
  const dialog = page.getByRole('dialog', { name: 'Import game save', exact: true })
  if (!await dialog.isVisible()) {
    const trigger = page.getByRole('button', { name: 'Import game save…', exact: true })
    if (await trigger.isVisible()) await trigger.click()
    else await page.getByRole('button', { name: 'Import save', exact: true }).click()
  }
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Choose game save', { exact: true }).setInputFiles({ name: 'savedata.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  return dialog
}

async function stored(page: Page) { return page.evaluate((key) => window.__readMapProfileText(key), storageKey) }

test('game save preview is atomic, replaces known state, updates suggestions and supports undo', async ({ page }) => {
  const original = { ...initial, purchases: { [quests]: { epoch: 0, active: true }, 'legacy-test-id': { epoch: 0, active: false } }, milestones: { 'legacy-item-test': true as const } }
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: storageKey, profile: original })
  await page.goto('./ascension/')
  await page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: 'Game Layout', exact: true }).click()
  const before = await stored(page)
  await openProgress(page)
  const bytes = encodeGameSaveFixture(nativeSaveFixture({ integers: { [start]: 1, [gatherer]: 1 }, strings: { 'Unrelated fixture preference': 'fixture-private-marker@example.invalid' } }))
  let dialog = await chooseSave(page, bytes)
  await expect(dialog.getByRole('button', { name: 'Apply snapshot', exact: true })).toBeVisible()
  expect(await stored(page)).toBe(before)
  await expect(dialog).not.toContainText('fixture-private-marker')
  await dialog.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await stored(page)).toBe(before)
  await expect(dialog.getByLabel('Choose game save', { exact: true })).toBeVisible()
  dialog = await chooseSave(page, bytes)
  await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect.poll(async () => JSON.parse((await stored(page))!)).toEqual({ ...original,
    purchases: { [start]: { epoch: 0, active: true }, [gatherer]: { epoch: 0, active: true }, 'legacy-test-id': { epoch: 0, active: false } },
  })
  const imported = JSON.parse((await stored(page))!)
  expect(imported.purchases).toEqual({ [start]: { epoch: 0, active: true }, [gatherer]: { epoch: 0, active: true }, 'legacy-test-id': { epoch: 0, active: false } })
  expect(imported.milestones).toEqual({ 'legacy-item-test': true })
  expect(imported.showSpoilers).toBe(false)
  expect(JSON.stringify(imported)).not.toContain('fixture-private-marker')
  await expect(page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: 'Game Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Next upgrade', exact: true }).click()
  await expect(page.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', quests)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await undo.click()
  await expect.poll(async () => JSON.parse((await stored(page))!)).toEqual(original)
})

test('invalid, unsupported and oversized saves keep progress intact and can be retried', async ({ page }) => {
  await page.goto('./ascension/')
  await openProgress(page)
  const before = await stored(page)
  const cases = [
    { bytes: new TextEncoder().encode('fixture-sensitive-garbage'), message: 'not a supported Idle Slayer game save' },
    { bytes: encodeGameSaveFixture(nativeSaveFixture({ version: '99.0.0' })), message: '7.2.0' },
    { bytes: new Uint8Array(4 * 1024 * 1024 + 1), message: '4 MiB' },
  ]
  for (const [i, item] of cases.entries()) {
    const dialog = await chooseSave(page, item.bytes, i > 0)
    await expect(dialog.getByRole('status')).toContainText(item.message)
    await expect(dialog.getByRole('button', { name: 'Apply snapshot', exact: true })).toHaveCount(0)
    await expect(dialog).not.toContainText('fixture-sensitive-garbage')
    expect(await stored(page)).toBe(before)
  }
  const dialog = await chooseSave(page, encodeGameSaveFixture(nativeSaveFixture()), true)
  await expect(dialog.getByRole('button', { name: 'Apply snapshot', exact: true })).toBeVisible()
  expect(await stored(page)).toBe(before)
})

test('preview keeps hidden names and native account preferences out of the UI, storage and network', async ({ page }) => {
  const hidden = catalog.upgrades.find((node) => !visibility(catalog, initial).ids.has(node.id) && node.activation === 'after-ultra-ascension')!
  await page.goto('./ascension/')
  const submissions: string[] = []
  const origin = new URL(page.url()).origin
  page.on('request', (request) => { const url = new URL(request.url()); if (request.method() !== 'GET' || url.origin !== origin || url.search) submissions.push(request.url()) })
  await openProgress(page)
  const dialog = await chooseSave(page, encodeGameSaveFixture(nativeSaveFixture({ epoch: '1', integers: { [hidden.id]: 1 }, strings: { 'Fixture account preference': 'fixture-account@example.invalid' } })))
  await expect(dialog).not.toContainText(hidden.title)
  await expect(dialog).not.toContainText('fixture-account')
  await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect.poll(async () => JSON.parse((await stored(page))!)).toEqual({ ...initial, epoch: 1, purchases: { [hidden.id]: { epoch: 1, active: false } } })
  expect(submissions).toEqual([])
  const imported = JSON.parse((await stored(page))!)
  expect(imported.epoch).toBe(1)
  expect(imported.purchases[hidden.id]).toEqual({ epoch: 1, active: false })
  expect(JSON.stringify(imported)).not.toContain('Fixture account preference')
  const ids = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')))
  expect(ids.every((id) => id !== null && visibility(catalog, imported).ids.has(id))).toBe(true)
})

test('phone and landscape previews remain usable and Escape cancels with focus restored', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    await openProgress(page)
    const dialog = await chooseSave(page, encodeGameSaveFixture(nativeSaveFixture({ integers: { [start]: 1 } })))
    await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole('button', { name: 'Apply snapshot', exact: true })).toBeInViewport()
    await dialog.getByRole('button', { name: 'Cancel preview', exact: true }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole('button', { name: 'Cancel preview', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Import save', exact: true })).toBeFocused()
    expect(await stored(page)).toBeNull()
    await expect(page.locator('.toolbar')).toBeVisible()
  }
})

test('cancelled asynchronous reads cannot reopen or apply a stale preview', async ({ page }) => {
  await page.addInitScript(() => {
    const originalRead = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      // Hold the read until the native cancellation click, rather than racing
      // a 300ms clock with unrelated browser/CPU work.
      await new Promise<void>((resolve) => { (window as unknown as { releaseFixtureRead: () => void }).releaseFixtureRead = resolve })
      ;(window as unknown as { fixtureReadComplete: boolean }).fixtureReadComplete = true
      return originalRead.call(this)
    }
  })
  await page.goto('./ascension/')
  await openProgress(page)
  const dialog = await chooseSave(page, encodeGameSaveFixture(nativeSaveFixture()))
  const readingStatus = dialog.getByRole('status').filter({ hasText: /^Reading and validating locally…$/ })
  await expect(readingStatus).toBeVisible()
  await expect(readingStatus).toHaveText('Reading and validating locally…')
  await expect(dialog.getByRole('button', { name: 'Apply snapshot', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.evaluate(() => (window as unknown as { releaseFixtureRead: () => void }).releaseFixtureRead())
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureReadComplete: boolean }).fixtureReadComplete)).toBe(true)
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.toolbar')).toBeVisible()
  expect(await stored(page)).toBeNull()
})

test('explicit import recovers corrupt storage and failed writes retain usable progress and export', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, '{fixture-corrupt-profile')
    const originalSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if ((window as unknown as { fixtureBlockStorage: boolean }).fixtureBlockStorage) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return originalSet.call(this, name, value)
    }
  }, storageKey)
  await page.goto('./ascension/')
  await openProgress(page)
  const bytes = encodeGameSaveFixture(nativeSaveFixture({ integers: { [start]: 1 } }))
  let dialog = await chooseSave(page, bytes)
  expect(await stored(page)).toBe('{fixture-corrupt-profile')
  await dialog.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await stored(page)).toBe('{fixture-corrupt-profile')
  dialog = await chooseSave(page, bytes)
  await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect.poll(async () => JSON.parse((await stored(page))!)).toEqual({ ...initial, purchases: { [start]: { epoch: 0, active: true } } })

  await page.evaluate(() => { (window as unknown as { fixtureBlockStorage: boolean }).fixtureBlockStorage = true })
  await openProgress(page)
  dialog = await chooseSave(page, encodeGameSaveFixture(nativeSaveFixture({ integers: { [start]: 1, [gatherer]: 1 } })))
  await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Current progress remains available')
  expect(JSON.parse((await stored(page))!).purchases[gatherer]).toBeUndefined()
  await openProgress(page)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  const download = await downloadEvent
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(backup.purchases[gatherer]).toEqual({ epoch: 0, active: true })
  expect(Object.keys(backup).sort()).toEqual(Object.keys(initial).sort())
})
