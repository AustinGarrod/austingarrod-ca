import { openData } from './helpers/app'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { encodeGameSaveFixture, nativeSaveFixture } from '../fixtures/game-save'

// Map backups are restored through Data & backup's single restore control, which reads the file,
// recognises the original map format and hands it to Ascension's own 'Restore progress?' preview.
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = { ...emptyProfile(catalog.revision), purchases: { 'unknown-existing': { epoch: 0, active: true } } }
type ReadWindow = Window & { releaseBackup?: Record<string, () => void>; finishedBackups?: string[] }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, profile }) => {
    localStorage.setItem(key, JSON.stringify(profile))
    const win = window as ReadWindow
    win.releaseBackup = {}; win.finishedBackups = []
    const native = File.prototype.text
    File.prototype.text = async function () {
      if (!this.name.startsWith('deferred-')) return native.call(this)
      await new Promise<void>((resolve) => { win.releaseBackup![this.name] = resolve })
      try {
        if (this.name.includes('reject')) throw new Error('Synthetic read refusal')
        return await native.call(this)
      } finally { win.finishedBackups!.push(this.name) }
    }
  }, { key: PROFILE_STORAGE_KEY, profile: initial })
  await page.goto('./ascension/')
  await openData(page, { advanced: false })
})

const data = (page: Page) => page.getByRole('dialog', { name: 'Data & backup', exact: true })
async function selectBackup(page: Page, name: string, epoch: number) {
  await data(page).getByLabel('Restore from a backup file', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...emptyProfile(catalog.revision), epoch })) })
  if (name.startsWith('deferred-')) await expect.poll(() => page.evaluate((name) => typeof (window as ReadWindow).releaseBackup?.[name], name)).toBe('function')
}
async function finishRead(page: Page, name: string) {
  await page.evaluate((name) => (window as ReadWindow).releaseBackup?.[name]?.(), name)
  await expect.poll(() => page.evaluate(() => (window as ReadWindow).finishedBackups)).toContain(name)
}
async function unchanged(page: Page) {
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(initial)
}

for (const close of ['button', 'escape'] as const) {
  test(`closing Data & backup by ${close} cancels a pending backup even after reopening`, async ({ page }) => {
    await selectBackup(page, 'deferred-older.json', 1)
    if (close === 'button') await data(page).getByRole('button', { name: 'Close dialog', exact: true }).click()
    else await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openData(page, { advanced: false })
    await finishRead(page, 'deferred-older.json')
    await expect(data(page)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toHaveCount(0)
    await unchanged(page)
  })
}

test('a newer backup owns the preview and a late older success cannot replace it', async ({ page }) => {
  await selectBackup(page, 'deferred-older.json', 1)
  await selectBackup(page, 'newer.json', 2)
  await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toContainText('epoch 2')
  await finishRead(page, 'deferred-older.json')
  await expect(page.getByRole('dialog')).toContainText('epoch 2')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!).epoch, PROFILE_STORAGE_KEY)).toBe(2)
})

test('a cancelled newer preview ignores a late older read failure', async ({ page }) => {
  await selectBackup(page, 'deferred-reject.json', 1)
  await selectBackup(page, 'newer.json', 2)
  await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await finishRead(page, 'deferred-reject.json')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'Map action feedback', exact: true })).not.toContainText('could not be read')
  await expect(page.locator('.companion-feedback')).toHaveCount(0)
  await unchanged(page)
})

test('a newer failed read supersedes an older success without restoring either backup', async ({ page }) => {
  await selectBackup(page, 'deferred-older.json', 1)
  await selectBackup(page, 'deferred-reject.json', 2)
  await finishRead(page, 'deferred-reject.json')
  await expect(data(page).getByRole('status').filter({ hasText: 'could not be read' })).toBeVisible()
  await finishRead(page, 'deferred-older.json')
  await expect(data(page)).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toHaveCount(0)
  await unchanged(page)
})

test('closing Data & backup removes the restore control, so no later file can start a preview', async ({ page }) => {
  await data(page).getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByLabel('Restore from a backup file', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await unchanged(page)
})

test('switching to game import cancels the pending JSON restore without replacing its dialog', async ({ page }) => {
  await selectBackup(page, 'deferred-older.json', 1)
  await data(page).getByRole('button', { name: 'Import save…', exact: true }).click()
  const gameImport = page.getByRole('dialog', { name: 'Import save', exact: true })
  await gameImport.getByLabel('Choose game save', { exact: true }).setInputFiles({ name: 'synthetic.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeGameSaveFixture(nativeSaveFixture({ epoch: '3' }))) })
  await expect(gameImport.getByRole('button', { name: 'Apply snapshot', exact: true })).toBeVisible()
  await finishRead(page, 'deferred-older.json')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(gameImport).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toHaveCount(0)
  await gameImport.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await unchanged(page)
})
