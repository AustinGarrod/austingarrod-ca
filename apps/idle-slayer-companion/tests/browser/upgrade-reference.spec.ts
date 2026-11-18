import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { visibility } from '../../src/domain/rules'
import { upgradeReferenceURL } from '../../src/domain/upgrade-reference'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const reference = (base: string, id: string, revision = catalog.revision) => upgradeReferenceURL(base, id, revision)
const saved = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)
async function expand(page: Page) { await expect(page.locator('.details h2')).toBeVisible(); const button = page.getByRole('button', { name: 'Show details', exact: true }); if (await button.isVisible()) await button.click() }
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

test('copyable exact-ID link uses recipient progress, clears incoming URL data and preserves a bookmark', async ({ page, context, baseURL }) => {
  const target = catalog.upgrades.find((upgrade) => upgrade.title === 'Astral Key' && upgrade.cost === '1000000000000000000')!
  const own = { ...initial, showSpoilers: true, purchases: { [catalog.startId]: { epoch: 0, active: true } } }
  await page.addInitScript(({ key, own }) => localStorage.setItem(key, JSON.stringify(own)), { key: PROFILE_STORAGE_KEY, own })
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { Object.assign(window, { copiedUpgradeReference: value }) } } }))
  const link = reference(baseURL!, target.id)
  const incoming = new URL(link); incoming.search = '?senderSpoilers=false&private=private-reference-marker'
  await page.goto(incoming.toString())
  await expect(page.locator('.details h2')).toHaveText(target.title)
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', target.id)
  await expect.poll(() => page.locator('.react-flow__node.selected').evaluate((element) => {
    const r = element.getBoundingClientRect(), map = element.closest('.map')!.getBoundingClientRect()
    return r.width >= 44 && r.height >= 44 && r.left >= map.left && r.right <= map.right && r.top >= map.top && r.bottom <= map.bottom
  })).toBe(true)
  expect(page.url()).toBe(new URL('ascension/', baseURL).toString())
  expect(await saved(page)).toBe(JSON.stringify(own))
  expect(await page.title()).toBe('Idle Slayer Companion · Ascension')
  await expand(page)
  await page.getByRole('button', { name: 'Copy upgrade reference', exact: true }).click()
  await expect(page.locator('.reference-copy-feedback')).toHaveText('Upgrade reference copied.')
  expect(await page.evaluate(() => (window as Window & { copiedUpgradeReference?: string }).copiedUpgradeReference)).toBe(link)
  const navigationHeaders: string[] = []
  const watchNavigation = (request: import('@playwright/test').Request) => { if (request.isNavigationRequest()) navigationHeaders.push(request.headers()['referer'] ?? '') }
  context.on('request', watchNavigation)
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Open reference in a new tab', exact: true }).click()
  const recipient = await popupPromise
  try {
    await expect(recipient.locator('.react-flow__node.selected')).toHaveAttribute('data-id', target.id)
    expect(recipient.url()).toBe(new URL('ascension/', baseURL).toString())
    expect(navigationHeaders.length).toBeGreaterThan(0)
    expect(navigationHeaders.every((value) => value === '')).toBe(true)
    expect(await saved(recipient)).toBe(JSON.stringify(own))
  } finally { context.off('request', watchNavigation); await recipient.close() }
  await page.goto(link)
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', target.id)
  expect(await saved(page)).toBe(JSON.stringify(own))
})

test('hidden and missing identities have the same nonrevealing response and never change spoilers', async ({ page, baseURL }) => {
  const hidden = catalog.upgrades.find((upgrade) => !visibility(catalog, initial).ids.has(upgrade.id))!
  let message = ''
  for (const id of [hidden.id, 'obsolete-reference-id']) {
    await page.goto(reference(baseURL!, id))
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(page.locator('.toast')).toContainText('unavailable under your current spoiler setting, or is missing from this catalog')
    const text = await page.locator('.toast').innerText()
    if (message) expect(text).toBe(message); else message = text
    await expect(page.locator('.details')).toHaveCount(0)
    expect(await page.locator('body').innerHTML()).not.toContain(hidden.id)
    await expect(page.locator('body')).not.toContainText(hidden.title)
    expect(await page.title()).toBe('Idle Slayer Companion · Ascension')
    expect(page.url()).toBe(new URL('ascension/', baseURL).toString())
    expect(await saved(page)).toBeNull()
  }
})

test('different catalog context and malformed references keep normal navigation usable', async ({ page, baseURL }) => {
  await page.goto(reference(baseURL!, catalog.startId, 'old-reviewed-catalog'))
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  await expect(page.locator('.toast')).toContainText('different catalog revision')
  await page.goto(`${baseURL}#upgrade=${catalog.startId}&catalog=${catalog.revision}&private=private-malformed-marker`)
  await expect(page.locator('.toast')).toContainText('reference is invalid')
  expect(await page.locator('body').innerHTML()).not.toContain('private-malformed-marker')
  await page.getByRole('searchbox').fill('Minions')
  const minions = catalog.upgrades.find((upgrade) => upgrade.title === 'Minions')!
  await page.locator(`.search-result[data-upgrade-id="${minions.id}"]`).click()
  await expect(page.locator('.details h2')).toHaveText('Minions')
  expect(await saved(page)).toBeNull()
})

test('live fragments resolve once, sanitize immediately and do not resurrect a hidden target later', async ({ page, baseURL }) => {
  await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible()
  await page.evaluate((hash) => { location.hash = hash }, new URL(reference(baseURL!, catalog.startId)).hash)
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  await expect.poll(() => page.url()).toBe(new URL('ascension/', baseURL).toString())
  const hidden = catalog.upgrades.find((upgrade) => !visibility(catalog, initial).ids.has(upgrade.id))!
  await page.evaluate((hash) => { location.hash = hash }, new URL(reference(baseURL!, hidden.id)).hash)
  await expect(page.locator('.toast')).toContainText('unavailable under your current spoiler setting')
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  const spoilerControl = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  if (!await spoilerControl.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await spoilerControl.check()
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
})

test('clipboard fallback is selectable, replay-blocked and clears with a different selection', async ({ page, baseURL }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Synthetic clipboard refusal') } } }))
  await page.goto(reference(baseURL!, catalog.startId)); await expand(page)
  await page.getByRole('button', { name: 'Copy upgrade reference', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'Upgrade reference link', exact: true })
  await expect(field).toHaveValue(reference(baseURL!, catalog.startId))
  await expect(page.getByRole('region', { name: 'Share upgrade reference', exact: true })).toHaveClass(/telemetry-private rr-block/)
  await page.getByRole('button', { name: 'Select reference link', exact: true }).click()
  expect(await field.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([0, reference(baseURL!, catalog.startId).length])
  expect(await saved(page)).toBeNull()
  await page.getByRole('searchbox').fill('Minions')
  await page.locator('.search-result').filter({ has: page.locator('.discovery-title', { hasText: /^Minions$/ }) }).click()
  await expect(page.getByRole('textbox', { name: 'Upgrade reference link', exact: true })).toHaveCount(0)
  await expect(page.locator('.reference-copy-feedback')).toBeEmpty()
})
