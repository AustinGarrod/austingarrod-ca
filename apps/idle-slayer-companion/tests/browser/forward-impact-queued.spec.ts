import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { openProgress } from './helpers/app'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
type QueuedWindow = Window & { releaseForecastBackup?: () => void; forecastBackupFinished?: boolean }

for (const failure of [false, true]) test(`a queued backup ${failure ? 'failure' : 'success'} cannot replace or add feedback to a newer forecast`, async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.addInitScript((failure) => {
    if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled')
    const win = window as QueuedWindow
    const native = File.prototype.text
    File.prototype.text = async function () {
      await new Promise<void>((resolve) => { win.releaseForecastBackup = resolve })
      try {
        if (failure) throw new Error('Synthetic queued read failure')
        return await native.call(this)
      } finally { win.forecastBackupFinished = true }
    }
  }, failure)
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.goto('./ascension/')
  const progress = await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic-queued.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...emptyProfile(catalog.revision), epoch: 9 })) })
  await expect.poll(() => page.evaluate(() => typeof (window as QueuedWindow).releaseForecastBackup)).toBe('function')
  await progress.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('searchbox').fill('Permanent Slayer')
  await page.getByRole('searchbox').press('Enter')
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  const stored = await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)
  await page.getByRole('button', { name: 'Analyze forward impact…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Forward impact', exact: true })
  await expect(dialog).toBeVisible()
  await page.evaluate(() => (window as QueuedWindow).releaseForecastBackup?.())
  await expect.poll(() => page.evaluate(() => (window as QueuedWindow).forecastBackupFinished)).toBe(true)
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toHaveCount(0)
  await expect(dialog).not.toContainText('could not be read')
  await expect(dialog).not.toContainText('epoch 9')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)).toBe(stored)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 0')
})
