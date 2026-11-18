import { openProgress } from './helpers/app'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { visibility } from '../../src/domain/rules'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { emptyProfile, type Catalog, type Profile } from '../../src/domain/types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog

async function chooseBackup(page: Page, profile: Profile) {
  await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({
    name: 'synthetic-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)),
  })
  const dialog = page.getByRole('dialog', { name: 'Restore progress?', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function stored(page: Page) {
  return page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)
}

for (const currentSpoilerPolicy of [false, true]) {
  for (const backupSpoilerPolicy of [false, true]) {
    for (const records of ['purchases', 'milestones'] as const) {
      test(`JSON restore ${records} counts use current spoilers ${currentSpoilerPolicy} with backup spoilers ${backupSpoilerPolicy}, and preserve map replacement/undo`, async ({ page }) => {
        const current = emptyProfile(catalog.revision)
        current.showSpoilers = currentSpoilerPolicy
        current.purchases = { [catalog.startId]: { epoch: 0, active: true }, 'future-current-upgrade': { epoch: 0, active: false } }
        current.milestones = { 'future-current-item': true }
        await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: current })
        await page.goto('./ascension/')

        // Synthetic profiles only: no player save or native preferences.
        const incoming = emptyProfile('synthetic-previous-revision')
        incoming.showSpoilers = backupSpoilerPolicy
        if (records === 'purchases') {
          for (const upgrade of catalog.upgrades) incoming.purchases[upgrade.id] = { epoch: 0, active: upgrade.activation === 'immediate' }
        } else {
          for (const milestone of catalog.milestones) incoming.milestones[milestone.id] = true
        }
        incoming.purchases['future-backup-upgrade'] = { epoch: 0, active: false }
        incoming.milestones['future-backup-item'] = true
        const expectedVisibility = visibility(catalog, { ...incoming, showSpoilers: currentSpoilerPolicy })
        const expectedMilestones = expectedVisibility.milestones.filter((item) => incoming.milestones[item.id] === true).length
        if (!currentSpoilerPolicy) {
          if (records === 'purchases') expect(expectedVisibility.owned).toBeGreaterThan(0)
          else expect(expectedMilestones).toBeLessThan(catalog.milestones.length)
        }

        let dialog = await chooseBackup(page, incoming)
        await expect(dialog).toContainText(`${expectedVisibility.owned} visible recorded purchases and ${expectedMilestones} visible milestones`)
        await expect(dialog).toContainText("Counts follow the map's current spoiler setting and the backup's progress.")
        await expect(dialog).toContainText('This replaces Ascension purchases, its recorded count and reviewed map milestones.')
        await expect(dialog).toContainText("The backup's spoiler setting is restored when applied.")
        await expect(dialog).not.toContainText('future-backup')
        await expect(dialog.locator('p.telemetry-private.rr-block').filter({ hasText: 'The backup has' })).toBeVisible()
        expect(await stored(page)).toEqual(current)
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
        expect(await stored(page)).toEqual(current)

        dialog = await chooseBackup(page, incoming)
        await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()
        const restored = { ...incoming, catalogRevision: catalog.revision, milestones: { 'future-current-item': true as const, ...incoming.milestones } }
        await expect.poll(() => stored(page)).toEqual(restored)
        const restoredVisibility = visibility(catalog, restored)
        await expect(page.locator('.map-summary')).toContainText(`${restoredVisibility.owned} / ${restoredVisibility.total} visible upgrades owned`)

        const undo = page.getByRole('button', { name: 'Undo', exact: true })
        if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
        await undo.click()
        await expect.poll(() => stored(page)).toEqual(current)
      })
    }
  }
}

test('invalid JSON backup keeps the current profile without displaying a restore count', async ({ page }) => {
  const current = emptyProfile(catalog.revision)
  current.purchases['future-current-upgrade'] = { epoch: 0, active: false }
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: current })
  await page.goto('./ascension/')
  await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({
    name: 'invalid-synthetic-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...current, showSpoilers: 'true' })),
  })
  await expect(page.getByRole('status', { name: 'Map action feedback', exact: true })).toContainText('does not match the supported profile format')
  await expect(page.getByRole('dialog', { name: 'Restore progress?', exact: true })).toHaveCount(0)
  expect(await stored(page)).toEqual(current)
})
