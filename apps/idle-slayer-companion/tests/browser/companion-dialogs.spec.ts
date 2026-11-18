import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'
import { COMPANION_WORKSPACE_KEY } from '../../src/domain/companion-workspace'
import type { CompanionProgress } from '../../src/domain/companion-types'

const progress = (page: Page): Promise<CompanionProgress | null> => page.evaluate((key) => {
  const text = localStorage.getItem(key)
  return text === null ? null : JSON.parse(text).progress
}, COMPANION_STORAGE_KEY)

async function expectFileFieldSpacing(input: Locator) {
  await input.scrollIntoViewIfNeeded()
  await expect(input).toBeInViewport()
  const bounds = await input.evaluate((element) => {
    const input = element.getBoundingClientRect()
    const label = element.closest('label')!.querySelector('span')!.getBoundingClientRect()
    return { gap: input.top - label.bottom, left: input.left - label.left, height: input.height, right: input.right, viewport: innerWidth }
  })
  expect(bounds.gap).toBeGreaterThanOrEqual(6)
  expect(bounds.gap).toBeLessThanOrEqual(12)
  expect(Math.abs(bounds.left)).toBeLessThanOrEqual(1)
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
}

test('import explains where to find the save and keeps its file field readable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  const trigger = page.getByRole('button', { name: 'Import save', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Import game save', exact: true })
  const location = dialog.getByRole('region', { name: 'Find your Windows save', exact: true })
  await expect(location).toContainText('Close Idle Slayer first.')
  await expect(location).toContainText('%USERPROFILE%\\AppData\\LocalLow\\Pablo Leban\\Idle Slayer\\')
  await expect(location).toContainText('savedata.sav')
  await expect(location).toContainText('backup.sav')
  await expect(location).toContainText('only the file you select')
  const input = dialog.getByLabel('Choose game save', { exact: true })
  await expectFileFieldSpacing(input)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(input).toHaveAccessibleDescription('7.3.4: full companion snapshot. Legacy 7.2.0: Ascension progress only.')
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('backup groups keep exports and file labels separate, and intentions restore leaves progress alone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  const actual = dialog.getByRole('region', { name: 'Companion progress', exact: true })
  const intentions = dialog.getByRole('region', { name: 'Intentions and plans', exact: true })
  for (const [region, label] of [[actual, 'Restore Companion progress'], [intentions, 'Restore intentions']] as const) {
    const input = region.getByLabel(label, { exact: true })
    await expectFileFieldSpacing(input)
    const space = await region.evaluate((element) => {
      const action = element.querySelector('button')!.getBoundingClientRect()
      const label = element.querySelector('label')!.getBoundingClientRect()
      return label.top - action.bottom
    })
    expect(space).toBeGreaterThanOrEqual(10)
  }
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const before = await progress(page)
  let downloaded = page.waitForEvent('download')
  await actual.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  const backup = JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8')) as CompanionProgress
  expect(backup.format).toBe('idle-slayer-companion-progress')
  downloaded = page.waitForEvent('download')
  await intentions.getByRole('button', { name: 'Export intentions', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toBe('companion-intentions.json')
  const workspace = { format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: { 'synthetic-recipe': '2' } }
  await intentions.getByLabel('Restore intentions', { exact: true }).setInputFiles({ name: 'intentions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workspace)) })
  const review = dialog.getByRole('region', { name: 'Review intentions restore', exact: true })
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: 'Cancel intentions restore', exact: true }).click()
  await expect(review).not.toBeVisible()
  expect(await progress(page)).toEqual(before)
  await intentions.getByLabel('Restore intentions', { exact: true }).setInputFiles({ name: 'intentions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workspace)) })
  await review.getByRole('button', { name: 'Replace intentions', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).workspace, COMPANION_WORKSPACE_KEY)).toEqual(workspace)
  expect(await progress(page)).toEqual(before)
  await dialog.getByRole('button', { name: 'Open Ascension data tools', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your progress', exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
})

test('Companion backup restore previews changes, supports cancellation and applies with Undo', async ({ page }) => {
  await page.goto('./')
  const open = () => page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  await open()
  const dialog = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  const candidate = JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8')) as CompanionProgress
  const before = await progress(page)
  candidate.ascension.epoch = 2
  const choose = () => dialog.getByLabel('Restore Companion progress', { exact: true }).setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(candidate)) })
  await choose()
  await expect(dialog.getByRole('heading', { name: 'Apply this snapshot?', exact: true })).toBeVisible()
  expect(await progress(page)).toEqual(before)
  await dialog.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Apply this snapshot?', exact: true })).toHaveCount(0)
  await choose()
  await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(async () => (await progress(page))?.ascension.epoch).toBe(2)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.epoch).toBe(0)
})

test('a queued shell Install action keeps a Companion restore preview available to cancel or apply', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  const candidate = JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8')) as CompanionProgress
  candidate.ascension.epoch = 2
  const before = await progress(page)
  const choose = () => dialog.getByLabel('Restore Companion progress', { exact: true }).setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(candidate)) })
  const preview = dialog.getByRole('region', { name: 'Review progress replacement', exact: true })
  const queuedInstall = () => page.locator('.companion-sidebar button[aria-label="Install & offline"]').evaluate((button: HTMLButtonElement) => button.click())
  for (const action of ['Cancel preview', 'Apply snapshot']) {
    await choose()
    await expect(preview.getByRole('heading', { name: 'Apply this snapshot?', exact: true })).toBeVisible()
    // Simulate an already queued action behind the modal, including the hidden mobile rail.
    await queuedInstall()
    await expect(dialog).toBeVisible()
    await expect(preview).toBeVisible()
    await expect(dialog).toContainText('Finish or cancel the current dialog before opening Install & offline.')
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    await expect(page.getByRole('dialog', { name: 'Install & offline', exact: true })).toHaveCount(0)
    expect(await progress(page)).toEqual(before)
    await preview.getByRole('button', { name: action, exact: true }).click()
    if (action === 'Cancel preview') {
      await expect(preview).not.toBeVisible()
      expect(await progress(page)).toEqual(before)
    }
  }
  await expect(dialog).not.toBeVisible()
  await expect.poll(async () => (await progress(page))?.ascension.epoch).toBe(2)
})
