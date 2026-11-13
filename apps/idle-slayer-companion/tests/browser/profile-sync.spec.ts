import { denyProfileWrites } from './helpers/profile'
import { showSpoilers, openAction, purchaseStart } from './helpers/app'
import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { PROFILE_WRITE_LOCK } from '../../src/domain/profile-session'
import { emptyProfile } from '../../src/domain/types'
import { encodeGameSaveFixture, nativeSaveFixture } from '../fixtures/game-save'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const key = 'idle-slayer-ascension-map.profile.v1'

test('a stale tab cannot erase a purchase from another tab when toggling spoilers', async ({ page, context }) => {
  await page.goto('./ascension/')
  const other = await context.newPage()
  await other.goto(page.url())
  await expect(other.locator('.map-summary')).toContainText('0 /')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect.poll(() => page.evaluate(({ key, id }) => JSON.parse(window.__readMapProfileText(key)!).purchases[id], { key, id: catalog.startId })).toEqual({ epoch: 0, active: true })
  await showSpoilers(other)
  await expect.poll(() => other.evaluate(({ key, id }) => JSON.parse(window.__readMapProfileText(key)!).purchases[id], { key, id: catalog.startId })).toEqual({ epoch: 0, active: true })
  await expect(other.locator('.map-summary')).toContainText('1 /')
  await page.reload()
  await expect(page.locator('.map-summary')).toContainText('1 /')
})

test('clean external updates invalidate a removal preview and prior undo', async ({ page, context }) => {
  await page.goto('./ascension/')
  const other = await context.newPage(); await other.goto(page.url())
  await purchaseStart(page)
  await expect(other.locator('.map-summary')).toContainText('1 /')
  await page.getByRole('button', { name: 'Remove purchase…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Remove purchase?', exact: true })).toBeVisible()
  await showSpoilers(other)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await openAction(page, 'Progress')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await expect(undo).toBeDisabled()
  expect(await page.evaluate(({ key, id }) => JSON.parse(window.__readMapProfileText(key)!).purchases[id], { key, id: catalog.startId })).toEqual({ epoch: 0, active: true })
})

test('dirty conflict recovery preserves export and supports reviewed saved/local choices', async ({ page, context }) => {
  await denyProfileWrites(page, 'failProfileWrites')
  await page.goto('./ascension/')
  const other = await context.newPage(); await other.goto(page.url())
  await purchaseStart(page)
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved')
  await showSpoilers(other)
  await expect(page.getByRole('button', { name: 'Review progress conflict', exact: true })).toBeVisible()
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  const download = page.waitForEvent('download')
  await review.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8')).ascension.purchases[catalog.startId]).toEqual({ epoch: 0, active: true })
  await review.getByRole('button', { name: 'Use checked saved progress', exact: true }).click()
  await page.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('0 /')
  await openAction(page, 'Undo')
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await showSpoilers(other, false)
  await expect(page.getByRole('button', { name: 'Review progress conflict', exact: true })).toBeVisible()
  await page.evaluate(() => { (window as Window & { failProfileWrites?: boolean }).failProfileWrites = false })
  await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await page.getByRole('button', { name: 'Replace checked saved progress', exact: true }).click()
  await page.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(other.locator('.map-summary')).toContainText('1 /')
  expect(await page.evaluate(({ key, id }) => JSON.parse(window.__readMapProfileText(key)!).purchases[id], { key, id: catalog.startId })).toEqual({ epoch: 0, active: true })
})

test('another external change cancels a conflict replacement confirmation', async ({ page, context }) => {
  await denyProfileWrites(page, 'failProfileWrites'); await page.goto('./ascension/')
  const other = await context.newPage(); await other.goto(page.url())
  await purchaseStart(page); await showSpoilers(other)
  await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await page.getByRole('button', { name: 'Replace checked saved progress', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Review progress replacement', exact: true })).toBeVisible()
  await showSpoilers(other, false)
  await expect(page.getByRole('region', { name: 'Review progress replacement', exact: true })).toHaveCount(0)
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!).purchases, key)).toEqual({})
  await expect(page.locator('.map-summary')).toContainText('1 /')
})

test('deleted and corrupt external storage cannot silently recreate or replace progress', async ({ page, context }) => {
  await page.goto('./ascension/'); await purchaseStart(page)
  await expect.poll(() => page.evaluate((key) => window.__readMapProfileText(key), key)).not.toBeNull()
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate((key) => window.__removeMapProfileStorage(key), key)
  await expect(page.locator('.map-summary')).toContainText('0 /')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), key)).toBeNull()
  await other.evaluate((key) => window.__writeExternalMapProfileText(key, '{corrupt}'), key)
  await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Use checked saved progress', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await showSpoilers(page)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), key)).toBe('{corrupt}')
})

test('missing Web Locks keeps purchases in memory and export usable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }))
  await page.goto('./ascension/'); await purchaseStart(page)
  await expect(page.getByRole('alert')).toContainText('Safe saving is unavailable')
  await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), key)).toBeNull()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8')).purchases[catalog.startId]).toBeDefined()
})

test('a held write lock permits prompt privacy export/reload and never writes after release', async ({ page, context }) => {
  await page.goto('./ascension/')
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate((name) => {
    const win = window as Window & { profileLockHeld?: boolean; releaseProfileLock?: () => void }
    void navigator.locks.request(name, async () => { win.profileLockHeld = true; await new Promise<void>((resolve) => { win.releaseProfileLock = resolve }) })
  }, PROFILE_WRITE_LOCK)
  await expect.poll(() => other.evaluate(() => (window as Window & { profileLockHeld?: boolean }).profileLockHeld)).toBe(true)
  await purchaseStart(page)
  await expect(page.getByRole('alert')).toContainText('Another tab is saving')
  await openAction(page, 'Privacy & tracking')
  await page.getByRole('button', { name: 'Disable tracking and reload', exact: true }).click()
  const warning = page.getByRole('region', { name: 'Reload with unsaved progress', exact: true })
  await expect(warning).toBeVisible({ timeout: 2000 })
  const download = page.waitForEvent('download')
  await Promise.all([page.waitForEvent('load'), warning.getByRole('button', { name: 'Export backups and reload', exact: true }).click()])
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8')).ascension.purchases[catalog.startId]).toBeDefined()
  await other.evaluate(() => (window as Window & { releaseProfileLock?: () => void }).releaseProfileLock?.())
  expect(await page.evaluate((key) => window.__readMapProfileText(key), key)).toBeNull()
  expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.analytics.v1'))).toBe('disabled')
})

test('cancelling a privacy reload allows the original authorized save to finish', async ({ page }) => {
  await page.addInitScript((name) => {
    const win = window as Window & { releaseDeferredProfileWrite?: () => void }
    const native = navigator.locks.request.bind(navigator.locks)
    const delayed = (requested: string, options: LockOptions, callback: (lock: unknown) => unknown): Promise<unknown> => requested === name
      ? new Promise<unknown>((resolve) => { win.releaseDeferredProfileWrite = () => resolve(callback({})) })
      : native(requested, options, callback)
    navigator.locks.request = delayed as typeof native
  }, PROFILE_WRITE_LOCK)
  await page.goto('./ascension/'); await purchaseStart(page)
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'true')
  await openAction(page, 'Privacy & tracking')
  await page.getByRole('button', { name: 'Disable tracking and reload', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Reload with unsaved progress', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel reload', exact: true }).click()
  await page.evaluate(() => (window as Window & { releaseDeferredProfileWrite?: () => void }).releaseDeferredProfileWrite?.())
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'false')
  expect(JSON.parse((await page.evaluate((key) => window.__readMapProfileText(key), key))!).purchases[catalog.startId]).toEqual({ epoch: 0, active: true })
  expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.analytics.v1'))).toBeNull()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('1 /')
})

for (const kind of ['backup', 'game-save'] as const) {
  test(`external progress invalidates a pending ${kind} read`, async ({ page, context }) => {
    await page.addInitScript((kind) => {
      const win = window as Window & { releaseProfileRead?: () => void; profileReadFinished?: boolean }
      const wait = () => new Promise<void>((resolve) => { win.releaseProfileRead = resolve })
      if (kind === 'backup') {
        const native = File.prototype.text
        File.prototype.text = async function () { await wait(); const result = await native.call(this); win.profileReadFinished = true; return result }
      } else {
        const native = File.prototype.arrayBuffer
        File.prototype.arrayBuffer = async function () { await wait(); const result = await native.call(this); win.profileReadFinished = true; return result }
      }
    }, kind)
    await page.goto('./ascension/')
    const other = await context.newPage(); await other.goto(page.url())
    await openAction(page, 'Progress')
    if (kind === 'backup') {
      const backup = { ...emptyProfile(catalog.revision), epoch: 9 }
      await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
    } else {
      await page.getByRole('button', { name: 'Import game save…', exact: true }).click()
      await page.getByRole('dialog', { name: 'Import game save', exact: true }).getByLabel('Choose game save', { exact: true }).setInputFiles({ name: 'synthetic.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeGameSaveFixture(nativeSaveFixture({ epoch: '9' }))) })
    }
    await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseProfileRead?: () => void }).releaseProfileRead)).toBe('function')
    await showSpoilers(other)
    if (kind === 'backup') await expect(page.getByRole('dialog')).toHaveCount(0)
    else await expect(page.getByRole('dialog').getByRole('button', { name: 'Apply snapshot', exact: true })).toHaveCount(0)
    await page.evaluate(() => (window as Window & { releaseProfileRead?: () => void }).releaseProfileRead?.())
    await expect.poll(() => page.evaluate(() => (window as Window & { profileReadFinished?: boolean }).profileReadFinished)).toBe(true)
    if (kind === 'backup') await expect(page.getByRole('dialog')).toHaveCount(0)
    else {
      await expect(page.getByRole('dialog', { name: 'Import game save', exact: true })).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Apply snapshot', exact: true })).toHaveCount(0)
      await expect(page.getByRole('dialog').getByText('Reading and validating locally…', { exact: true })).toHaveCount(0)
    }
    expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!).epoch, key)).toBe(0)
  })
}

test('external progress cancels an awaiting privacy reload without reopening its stale warning', async ({ page, context }) => {
  await page.addInitScript((name) => {
    const win = window as Window & { deferProfileWrite?: boolean; releaseDeferredProfileWrite?: () => void }
    const native = navigator.locks.request.bind(navigator.locks)
    const delayed = (requested: string, options: LockOptions, callback: (lock: unknown) => unknown): Promise<unknown> => requested === name
      ? win.deferProfileWrite ? new Promise<unknown>((resolve) => { win.releaseDeferredProfileWrite = () => resolve(callback({})) }) : Promise.resolve(callback(null))
      : native(requested, options, callback)
    navigator.locks.request = delayed as typeof native
  }, PROFILE_WRITE_LOCK)
  await page.goto('./ascension/'); await purchaseStart(page)
  await expect(page.getByRole('alert')).toContainText('Another tab is saving')
  await page.evaluate(() => { (window as Window & { deferProfileWrite?: boolean }).deferProfileWrite = true })
  await openAction(page, 'Privacy & tracking')
  await page.getByRole('button', { name: 'Disable tracking and reload', exact: true }).click()
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'true')
  const other = await context.newPage(); await other.goto(page.url()); await showSpoilers(other)
  await expect(page.getByRole('region', { name: 'Reload with unsaved progress', exact: true })).toHaveCount(0)
  await page.evaluate(() => (window as Window & { releaseDeferredProfileWrite?: () => void }).releaseDeferredProfileWrite?.())
  await expect(page.locator('.atlas')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('region', { name: 'Reload with unsaved progress', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.analytics.v1'))).toBeNull()
  await expect(page.locator('.map-summary')).toContainText('1 /')
})
