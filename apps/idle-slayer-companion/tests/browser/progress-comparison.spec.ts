import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import type { Page, BrowserContext } from '@playwright/test'
import { emptyProfile, type Catalog, type Profile } from '../../src/domain/types'
import { planPurchase, visibility } from '../../src/domain/rules'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { encodeGameSaveFixture, nativeSaveFixture } from '../fixtures/game-save'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const id = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!.id
function purchased(profile: Profile, title: string) {
  const plan = planPurchase(catalog, profile, id(title))
  if (plan.kind !== 'ready') throw new Error(`Fixture purchase is not ready: ${title}`)
  return plan.profile
}
const baseline = purchased(purchased(emptyProfile(catalog.revision), 'Permanent Slayer'), 'Soul Gatherer Bundle')
const current = purchased(baseline, 'Permanent Quests')
const incoming = purchased(baseline, 'Soul Reaper')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})
async function seed(page: Page, profile: Profile) {
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile })
}
async function openProgress(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const progress = page.getByRole('button', { name: 'Progress', exact: true })
  if (!await progress.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await progress.click()
}
async function restore(page: Page, profile: Profile) {
  await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic-snapshot.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) })
  return page.getByRole('dialog', { name: 'Restore progress?', exact: true })
}
const stored = (page: Page) => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)

test('same-count replacement identifies the exchange before cancel, apply and undo', async ({ page }) => {
  await seed(page, current); await page.goto('./ascension/')
  expect(visibility(catalog, current).owned).toBe(visibility(catalog, incoming).owned)
  let dialog = await restore(page, incoming)
  const comparison = dialog.getByRole('region', { name: 'Progress differences' })
  await expect(comparison).toContainText('synthetic-snapshot.json')
  const removed = comparison.locator('li').filter({ hasText: 'Permanent Quests' })
  const added = comparison.locator('li').filter({ hasText: 'Soul Reaper' })
  await expect(removed).toContainText('Owned and active → Not owned')
  await expect(added).toContainText('Not owned → Owned and active')
  await expect(removed).toContainText(id('Permanent Quests'))
  await expect(comparison).toHaveClass(/telemetry-private rr-block/)
  expect(await stored(page)).toEqual(current)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await stored(page)).toEqual(current)
  dialog = await restore(page, incoming)
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(() => stored(page)).toEqual(incoming)
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await undo.click(); await expect.poll(() => stored(page)).toEqual(current)
})

test('incoming spoilers and unknown IDs do not expand replacement identities', async ({ page }) => {
  const initial = emptyProfile(catalog.revision), next = emptyProfile(catalog.revision)
  next.showSpoilers = true
  for (const upgrade of catalog.upgrades) next.purchases[upgrade.id] = { epoch: 0, active: true }
  next.purchases['private-unknown-marker'] = { epoch: 0, active: false }
  next.milestones['private-unknown-milestone'] = true
  const visible = visibility(catalog, initial)
  const hidden = catalog.upgrades.find((upgrade) => !visible.ids.has(upgrade.id))!
  await seed(page, initial); await page.goto('./ascension/')
  const dialog = await restore(page, next), comparison = dialog.getByRole('region', { name: 'Progress differences' })
  await expect(comparison).not.toContainText(hidden.title)
  await expect(comparison).not.toContainText(hidden.id)
  await expect(comparison).not.toContainText('private-unknown')
  await expect(comparison.locator('.comparison-settings > div').filter({ hasText: 'Spoiler setting' }).locator('dd b')).toHaveText(['Hidden', 'Shown'])
  await expect(comparison.locator('li')).toHaveCount(10)
  while (await comparison.getByRole('button', { name: /Show next/ }).count()) await comparison.getByRole('button', { name: /Show next/ }).click()
  await expect(comparison.locator('li')).toHaveCount(visible.total)
  await expect(comparison).not.toContainText(hidden.title)
  expect(await stored(page)).toEqual(initial)
})

test('replacement details wrap on a short phone with bounded initial rows', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const profile = { ...emptyProfile(catalog.revision), showSpoilers: true }
  const next = structuredClone(profile)
  for (const upgrade of catalog.upgrades) next.purchases[upgrade.id] = { epoch: 0, active: true }
  await seed(page, profile); await page.goto('./ascension/')
  const dialog = await restore(page, next)
  await expect(dialog.locator('.comparison-changes li')).toHaveCount(10)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await stored(page)).toEqual(profile)
  await restore(page, next)
  await page.screenshot({ path: info.outputPath('replacement-320.png') })
})

test('native import reuses visible difference rows without exposing unrelated fields', async ({ page }) => {
  await seed(page, current); await page.goto('./ascension/'); await openProgress(page)
  const bytes = encodeGameSaveFixture(nativeSaveFixture({ integers: Object.fromEntries(Object.keys(incoming.purchases).map((id) => [id, 1])), strings: { 'Unrelated fixture preference': 'private-native-marker' } }))
  await page.getByLabel('Idle Slayer game save', { exact: true }).setInputFiles({ name: 'savedata.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  const dialog = page.getByRole('dialog', { name: 'Import game progress', exact: true })
  await expect(dialog.getByRole('region', { name: 'Progress differences' })).toContainText('Soul Reaper')
  await expect(dialog).not.toContainText('private-native-marker')
  expect(await stored(page)).toEqual(current)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('export includes UTC and UA context while keeping version-one JSON compatible', async ({ page }) => {
  await seed(page, current); await page.goto('./ascension/'); await openProgress(page)
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  const download = await event
  expect(download.suggestedFilename()).toMatch(/^idle-slayer-progress-\d{8}T\d{6}Z-ua0\.json$/)
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8'))).toEqual(current)
})

test('activation, milestone and ownership baseline changes stay distinct from UA history', async ({ page }) => {
  const lock = catalog.upgrades.find((upgrade) => upgrade.activation === 'after-ultra-ascension')!
  const item = catalog.milestones[0]
  const before = { ...emptyProfile(catalog.revision), epoch: 1, showSpoilers: true }
  before.purchases[lock.id] = { epoch: 0, active: false }
  const after = structuredClone(before); after.epoch = 2; after.purchases[lock.id] = { epoch: 1, active: true }; after.milestones[item.id] = true
  await seed(page, before); await page.goto('./ascension/')
  const dialog = await restore(page, after), comparison = dialog.getByRole('region', { name: 'Progress differences' })
  await expect(comparison.locator('.comparison-settings > div').filter({ hasText: 'Ultra Ascensions' }).locator('dd b')).toHaveText(['1', '2'])
  const upgrade = comparison.locator('li').filter({ hasText: lock.id })
  await expect(upgrade).toContainText('Owned · awaiting activation → Owned and active')
  await expect(upgrade).toContainText('Ownership baseline: UA 0 → UA 1')
  await expect(comparison.locator('li').filter({ hasText: item.id })).toContainText('Not recorded → Recorded')
  expect(await stored(page)).toEqual(before)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

async function createConflict(page: Page, context: BrowserContext) {
  await seed(page, current)
  await page.addInitScript((key) => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name) && (window as Window & { failProfileWrites?: boolean }).failProfileWrites) throw new DOMException('Synthetic failure', 'QuotaExceededError')
      native.call(this, name, value)
    }
  }, PROFILE_STORAGE_KEY)
  await page.goto('./ascension/')
  const other = await context.newPage(); await other.goto(page.url()); await expect(other.locator('.toolbar')).toBeVisible()
  await page.evaluate(() => { (window as Window & { failProfileWrites?: boolean }).failProfileWrites = true })
  await page.getByRole('searchbox').fill('Soul Reaper'); await page.getByRole('searchbox').press('Enter')
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Companion progress could not be saved')
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: incoming })
}

test('conflict review explains both replacement directions and preserves cancellation', async ({ page, context }) => {
  await createConflict(page, context)
  await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  let review = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  await review.getByRole('button', { name: 'Replace checked saved progress', exact: true }).click()
  const local = page.getByRole('region', { name: 'Review progress replacement', exact: true })
  await expect(local).toContainText('Checked saved snapshot → After replacement')
  await expect(local.locator('li').filter({ hasText: 'Permanent Quests' })).toContainText('Not owned → Owned and active')
  await local.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await stored(page)).toEqual(incoming)
  review = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  await review.getByRole('button', { name: 'Use checked saved progress', exact: true }).click()
  const saved = page.getByRole('region', { name: 'Review progress replacement', exact: true })
  await expect(saved).toContainText('Current session → After replacement')
  await expect(saved.locator('li').filter({ hasText: 'Permanent Quests' })).toContainText('Owned and active → Not owned')
  await saved.getByRole('button', { name: 'Cancel preview', exact: true }).click()
})

for (const direction of ['local', 'saved'] as const) {
  test(`conflict ${direction} apply gives accurate operation-specific Undo guidance`, async ({ page, context }) => {
    await createConflict(page, context)
    await page.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
    await review.getByRole('button', { name: direction === 'local' ? 'Replace checked saved progress' : 'Use checked saved progress', exact: true }).click()
    const dialog = page.getByRole('region', { name: 'Review progress replacement', exact: true })
    if (direction === 'local') {
      await expect(dialog).toContainText('Undo does not recover overwritten saved bytes')
      await expect(dialog).toContainText('export both copies before applying')
      await expect(dialog).not.toContainText('Undo is available after replacement')
    } else await expect(dialog).toContainText('One operation with Undo for this visit.')
    await page.evaluate(() => { (window as Window & { failProfileWrites?: boolean }).failProfileWrites = false })
    await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
    if (direction === 'local') {
      await expect(undo).toBeDisabled()
      expect(Object.keys((await stored(page)).purchases)).toHaveLength(4)
    } else {
      expect(await stored(page)).toEqual(incoming)
      await expect(undo).toBeEnabled()
      await undo.click()
      expect(Object.keys((await stored(page)).purchases)).toHaveLength(4)
    }
  })
}
