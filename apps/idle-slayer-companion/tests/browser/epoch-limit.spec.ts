import { seedProfile } from './helpers/profile'
import { openProgress } from './helpers/app'
import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import { emptyProfile, MAX_PROFILE_EPOCH, type Catalog } from '../../src/domain/types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const ua = catalog.upgrades.find((node) => node.title === 'Ultra Ascension')!
const astral = catalog.upgrades.find((node) => node.title === 'Land Lord')!
const key = 'idle-slayer-ascension-map.profile.v1'

test('maximum accepted epoch refuses Ultra Ascension and remains exportable without mutation', async ({ page }) => {
  const profile = { ...emptyProfile(catalog.revision), epoch: MAX_PROFILE_EPOCH, purchases: {
    [ua.id]: { epoch: MAX_PROFILE_EPOCH, active: true },
    [astral.id]: { epoch: MAX_PROFILE_EPOCH, active: false },
    'unknown-future': { epoch: 1, active: false },
  }, milestones: { 'unknown-milestone': true as const } }
  await seedProfile(page, profile)
  await page.goto('./ascension/'); await openProgress(page)
  await page.getByRole('button', { name: 'Ultra Ascend…', exact: true }).click()
  const reset = page.getByRole('dialog', { name: 'Review companion Ultra Ascension', exact: true })
  await expect(reset.getByRole('button', { name: 'Record companion Ultra Ascension', exact: true })).toHaveCount(0)
  await expect(reset.getByRole('status')).toContainText('supported Ultra Ascension count limit')
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), key)).toEqual(profile)
  await reset.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await openProgress(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8'))).toEqual(profile)
})

test('last safe Ultra Ascension saves, reloads and exports its reset without losing unknown progress', async ({ page }) => {
  const profile = { ...emptyProfile(catalog.revision), epoch: MAX_PROFILE_EPOCH - 1, purchases: {
    [ua.id]: { epoch: MAX_PROFILE_EPOCH - 1, active: true },
    [catalog.startId]: { epoch: MAX_PROFILE_EPOCH - 1, active: true },
    [astral.id]: { epoch: MAX_PROFILE_EPOCH - 1, active: false },
    'unknown-future': { epoch: 1, active: false },
  }, milestones: { 'unknown-milestone': true as const } }
  await seedProfile(page, profile, true)
  await page.goto('./ascension/'); await openProgress(page)
  await page.getByRole('button', { name: 'Ultra Ascend…', exact: true }).click()
  const reset = page.getByRole('dialog', { name: 'Review companion Ultra Ascension', exact: true })
  await expect(reset).toContainText(`Recorded Ultra Ascensions: ${MAX_PROFILE_EPOCH - 1} → ${MAX_PROFILE_EPOCH}`)
  await reset.getByRole('button', { name: 'Record companion Ultra Ascension', exact: true }).click()
  const expected = { ...profile, epoch: MAX_PROFILE_EPOCH, purchases: {
    [astral.id]: { epoch: MAX_PROFILE_EPOCH - 1, active: true },
    'unknown-future': { epoch: 1, active: false },
  } }
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), key)).toEqual(expected)
  await page.reload(); await openProgress(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8'))).toEqual(expected)
})
