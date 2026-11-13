import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import type { Download } from '@playwright/test'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { emptyProfile } from '../../src/domain/types'
import { denyProfileWrites, seedProfile } from './helpers/profile'
import { purchaseStart } from './helpers/app'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog

test('invalid source records fail recoverably before upgrade details can render', async ({ page }) => {
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  const invalid = structuredClone(catalog)
  Object.assign(invalid.upgrades.find((node) => node.id === catalog.startId)!, { sources: [null] })
  await page.route('**/catalog.json', (route) => route.fulfill({ json: invalid }))
  await page.goto('./ascension/')
  await expect(page.getByRole('heading', { name: 'Ascension catalog unavailable', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry catalog', exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Achievements', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Achievements', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('invalid companion data leaves the reviewed Ascension map usable', async ({ page }) => {
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  await page.route('**/companion-catalog.json', (route) => route.fulfill({ json: { schemaVersion: 1, entities: [null] } }))
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.getByRole('searchbox')).toBeVisible()
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Achievements', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Companion data unavailable', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry catalogs', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('catalog retry keeps unsaved progress until cancellation or both recovery exports', async ({ page }) => {
  const initial = emptyProfile(catalog.revision)
  await seedProfile(page, initial, true)
  await denyProfileWrites(page)
  await page.route('**/companion-catalog.json', (route) => route.fulfill({ json: { schemaVersion: 1, entities: [null] } }))
  await page.goto('./ascension/')
  await purchaseStart(page)
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved')
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Achievements', exact: true }).click()
  await page.getByRole('button', { name: 'Retry catalogs', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Privacy & tracking', exact: true })
  const warning = settings.getByRole('region', { name: 'Reload with unsaved progress', exact: true })
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Cancel reload', exact: true }).click()
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Companion data unavailable', exact: true })).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(initial)
  await page.getByRole('button', { name: 'Retry catalogs', exact: true }).click()
  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await Promise.all([page.waitForEvent('load'), warning.getByRole('button', { name: 'Export backups and reload', exact: true }).click()])
  await expect.poll(() => downloads.length).toBe(2)
  const documents = await Promise.all(downloads.map(async (download) => JSON.parse(readFileSync((await download.path())!, 'utf8'))))
  expect(documents.find((document) => document.format === 'idle-slayer-companion-progress').ascension.purchases[catalog.startId]).toEqual({ epoch: 0, active: true })
  expect(documents.find((document) => document.format === 'idle-slayer-companion-workspace')).toMatchObject({ goals: [], recipePlans: {} })
  await expect(page.getByRole('heading', { name: 'Companion data unavailable', exact: true })).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(initial)
})
