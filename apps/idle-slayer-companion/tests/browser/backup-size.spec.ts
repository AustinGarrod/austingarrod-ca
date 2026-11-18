import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { MAX_PROFILE_BYTES, PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog

test('oversized canonical backup is refused before preview and preserves saved progress and export', async ({ page }) => {
  const current = emptyProfile(catalog.revision)
  current.purchases[catalog.startId] = { epoch: 0, active: true }
  current.purchases['future-existing'] = { epoch: 0, active: false }
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: current })
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  const progress = page.getByRole('button', { name: 'Progress', exact: true })
  if (!await progress.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await progress.click()
  const incoming = emptyProfile(catalog.revision)
  for (let index = 0; index < 65_000; index++) incoming.purchases[`future-${index}`] = { epoch: 0, active: false }
  const compact = JSON.stringify(incoming)
  expect(Buffer.byteLength(compact)).toBeLessThan(MAX_PROFILE_BYTES)
  expect(Buffer.byteLength(JSON.stringify(incoming, null, 2))).toBeGreaterThan(MAX_PROFILE_BYTES)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'large-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(compact) })
  await expect(page.getByRole('status', { name: 'Map action feedback', exact: true })).toContainText('4 MiB save and export limit')
  await expect(page.getByRole('dialog')).not.toContainText('Restore progress?')
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(current)
  await expect(page.locator('.map-summary')).toContainText('1 /')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  const download = await downloadPromise
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8'))).toEqual(current)
})
