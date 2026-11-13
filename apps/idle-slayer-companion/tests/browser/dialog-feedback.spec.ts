import { expect, test } from './fixtures'
import { openAction as openSharedAction } from './helpers/app'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { MAX_PROFILE_BYTES, PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog

async function openAction(page: Page, name: string) {
  await expect(page.locator('.toolbar')).toBeVisible()
  await openSharedAction(page, name)
}
async function assertLocalFeedback(page: Page, text: string) {
  const dialog = page.getByRole('dialog')
  const status = dialog.locator('.dialog-feedback[role="status"]')
  await expect(status).toHaveCount(1)
  await expect(status).toContainText(text)
  await expect(status).toBeInViewport()
  await expect(page.locator('.atlas > .sr-only[role="status"]')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0)
  expect(await status.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const modal = element.closest('dialog')!.getBoundingClientRect()
    return box.top >= modal.top && box.bottom <= Math.min(modal.bottom, window.innerHeight)
  })).toBe(true)
}

test('blocked Ultra Ascension explains the result in its shared dialog at phone width without stale feedback', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./ascension/'); await openAction(page, 'Progress')
  const action = page.getByRole('button', { name: 'Ultra Ascend…', exact: true })
  await action.click()
  const reset = page.getByRole('dialog', { name: 'Review companion Ultra Ascension', exact: true })
  const feedback = reset.getByRole('status')
  await expect(feedback).toContainText('does not meet the Ultra Ascension requirements')
  await expect(feedback).toBeInViewport()
  await expect(reset.getByRole('button', { name: 'Record companion Ultra Ascension', exact: true })).toHaveCount(0)
  expect(await feedback.evaluate((element) => element.closest('.rr-block') !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.atlas > .sr-only[role="status"]')).toHaveText('')
  await openAction(page, 'Progress')
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).toHaveText('')
})

test('invalid restore and successful export replace feedback inside Progress and keep the profile intact', async ({ page }) => {
  const profile = { ...emptyProfile(catalog.revision), purchases: { 'unknown-fixture': { epoch: 0, active: false } } }
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./ascension/'); await openAction(page, 'Progress')
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic-invalid.json', mimeType: 'application/json', buffer: Buffer.from('BACKUP_PRIVATE_MARKER') })
  await assertLocalFeedback(page, 'The backup is not valid JSON. Progress was not replaced.')
  await expect(page.getByRole('dialog')).not.toContainText('BACKUP_PRIVATE_MARKER')
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'second-synthetic-invalid.json', mimeType: 'application/json', buffer: Buffer.from('ANOTHER_PRIVATE_MARKER') })
  await assertLocalFeedback(page, 'The backup is not valid JSON. Progress was not replaced.')
  await expect(page.getByRole('dialog').locator('.dialog-feedback p')).toHaveCount(1)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8'))).toEqual(profile)
  await assertLocalFeedback(page, 'Progress backup exported.')
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).not.toContainText('not valid JSON')
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(profile)
})

test('failed milestone saving exposes fixed feedback, export and retry inside its active dialog', async ({ page }) => {
  const profile = { ...emptyProfile(catalog.revision), showSpoilers: true }
  await page.addInitScript(({ key, profile }) => {
    localStorage.setItem(key, JSON.stringify(profile))
    const win = window as Window & { denyProfileWrites?: boolean }
    win.denyProfileWrites = true
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (target, value) {
      if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(target) && win.denyProfileWrites) throw new DOMException('Synthetic private write detail', 'QuotaExceededError')
      native.call(this, target, value)
    }
  }, { key: PROFILE_STORAGE_KEY, profile })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./ascension/'); await openAction(page, 'Milestones')
  const milestone = catalog.milestones[0]
  await page.getByRole('checkbox', { name: new RegExp(milestone.title) }).check()
  await assertLocalFeedback(page, 'Companion progress could not be saved on this device.')
  const dialog = page.getByRole('dialog', { name: 'Milestones', exact: true })
  await expect(dialog).not.toContainText('Synthetic private write detail')
  await expect(dialog.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8')).milestones[milestone.id]).toBe(true)
  await assertLocalFeedback(page, 'Progress backup exported.')
  await page.evaluate(() => { (window as Window & { denyProfileWrites?: boolean }).denyProfileWrites = false })
  await dialog.getByRole('button', { name: 'Retry saving', exact: true }).click()
  await expect(dialog.locator('.dialog-feedback')).toHaveText('')
  expect(await page.evaluate(({ key, id }) => JSON.parse(window.__readMapProfileText(key)!).milestones[id], { key: PROFILE_STORAGE_KEY, id: milestone.id })).toBe(true)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true)
})

test('Companion size refusal keeps the migrated map exportable and exposes recovery without downloading an invalid envelope', async ({ page }) => {
  const profile = emptyProfile(catalog.revision)
  const bytes = () => Buffer.byteLength(JSON.stringify(profile, null, 2))
  for (let index = 0; index < 4_000; index++) profile.milestones[`future-${index}-${'x'.repeat(1_000)}`] = true
  let index = 0
  while (MAX_PROFILE_BYTES - bytes() > 48) {
    const prefix = `padding-${index++}-`
    const length = Math.min(1_024, MAX_PROFILE_BYTES - bytes() - 32)
    profile.milestones[prefix + 'x'.repeat(length - prefix.length)] = true
  }
  expect(bytes()).toBeLessThanOrEqual(MAX_PROFILE_BYTES)
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile })
  await page.goto('./ascension/')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await assertLocalFeedback(page, '4 MiB save and export limit')
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(profile)
  await page.getByRole('dialog', { name: 'Record purchase?', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 568 })
  await page.locator('.companion-global-actions').getByRole('button', { name: /Backup/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  const downloads: unknown[] = []
  page.on('download', (download) => downloads.push(download))
  await dialog.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Companion progress exceeds its supported size limit')
  await expect(dialog.getByRole('button', { name: 'Retry recovery', exact: true })).toBeVisible()
  expect(await dialog.getByRole('status').evaluate((element) => element.closest('.rr-block') !== null)).toBe(true)
  expect(downloads).toHaveLength(0)
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(profile)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await openAction(page, 'Progress')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8'))).toEqual(profile)
  await assertLocalFeedback(page, 'Progress backup exported.')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'Export backup', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('4 MiB save and export limit')
})

test('shared conflict and reload dialogs keep export feedback and move review into one active dialog', async ({ page, context }) => {
  await page.addInitScript((key) => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (target, value) {
      if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(target)) throw new DOMException('Synthetic write refusal', 'QuotaExceededError')
      native.call(this, target, value)
    }
  }, PROFILE_STORAGE_KEY)
  await page.goto('./ascension/')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  const other = await context.newPage(); await other.goto(page.url())
  await expect(other.locator('.toolbar')).toBeVisible()
  const spoilers = other.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  if (!await spoilers.isVisible()) await other.getByRole('button', { name: 'Map options', exact: true }).click()
  await spoilers.check()
  await page.setViewportSize({ width: 320, height: 568 })
  await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  const backups = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  let download = page.waitForEvent('download')
  await backups.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8')).ascension.purchases[catalog.startId]).toBeDefined()
  const feedback = backups.getByRole('status').filter({ hasText: 'Companion progress backup exported.' })
  await expect(feedback).toBeVisible()
  await expect(feedback).toBeInViewport()
  await backups.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await openAction(page, 'Privacy & tracking')
  await page.getByRole('button', { name: 'Disable tracking and reload', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Privacy & tracking', exact: true })
  const reload = settings.getByRole('region', { name: 'Reload with unsaved progress', exact: true })
  await expect(reload).toBeVisible()
  await expect(reload.getByRole('button', { name: 'Export backups and reload', exact: true })).toBeVisible()
  await reload.getByRole('button', { name: 'Cancel reload', exact: true }).click()
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.locator('.companion-global-actions').getByRole('button', { name: /Backup/ }).click()
  download = page.waitForEvent('download')
  await backups.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8')).ascension.purchases[catalog.startId]).toBeDefined()
  await expect(feedback).toBeVisible()
  await expect(feedback).toBeInViewport()
  expect(await feedback.evaluate((element) => element.closest('.rr-block') !== null)).toBe(true)
  await backups.getByRole('button', { name: 'Open Ascension data tools', exact: true }).click()
  await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(backups).toBeVisible()
  await expect(backups.getByRole('button', { name: 'Use checked saved progress', exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(feedback).toHaveCount(0)
  expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.analytics.v1'))).toBeNull()
})

test('global export success stays visible and announced beside a persistent storage warning', async ({ page }) => {
  await page.addInitScript((key) => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (target, value) {
      if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(target)) throw new DOMException('Synthetic write refusal', 'QuotaExceededError')
      native.call(this, target, value)
    }
  }, PROFILE_STORAGE_KEY)
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved on this device.')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8')).purchases[catalog.startId]).toBeDefined()
  await expect(page.locator('.atlas > .sr-only[role="status"]')).toHaveText('Progress backup exported.')
  await expect(page.locator('.toast')).toBeVisible()
  await expect(page.locator('.toast')).toContainText('Progress backup exported.')
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved on this device.')
})


test('empty named dialog feedback preserves zero space until real feedback exists', async ({ page }) => {
  await page.goto('./ascension/')
  await openAction(page, 'Progress')
  const feedback = page.getByRole('dialog').getByRole('status', { name: 'Map action feedback', exact: true })
  await expect(feedback).toBeEmpty()
  expect(await feedback.evaluate((element) => ({ height: element.getBoundingClientRect().height, margin: getComputedStyle(element).marginBottom, content: element.childElementCount }))).toEqual({ height: 0, margin: '0px', content: 0 })
  const field = page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })
  await field.fill('')
  await page.getByRole('button', { name: 'Review history…', exact: true }).click()
  await expect(feedback).toContainText('Enter the number')
  await expect(field).toHaveAccessibleDescription(/Enter the number/)
  expect(await feedback.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0)
  await field.fill('1')
  await expect(feedback).toBeEmpty()
  expect(await feedback.evaluate((element) => element.childElementCount)).toBe(0)
})
