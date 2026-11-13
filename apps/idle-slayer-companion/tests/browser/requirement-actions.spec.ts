import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog, type Profile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { visibility } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const chest = catalog.upgrades.find((node) => node.title === 'Chest In a Chest')!
const astral = catalog.upgrades.find((node) => node.title === 'Astral Slayer')!
const armory = catalog.milestones.find((item) => item.title === 'Armory')!
const advanced = (): Profile => ({ ...emptyProfile(catalog.revision), epoch: 1,
  purchases: Object.fromEntries(catalog.upgrades.filter((node) => node.id !== chest.id).map((node) => [node.id, { epoch: 1, active: true }])),
  milestones: Object.fromEntries(catalog.milestones.filter((item) => item.id !== armory.id).map((item) => [item.id, true])) })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

async function load(page: Page, profile: Profile) {
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile })
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
}
async function select(page: Page, title: string) {
  await page.getByRole('searchbox').fill(title)
  await page.locator('.search-result').filter({ hasText: title }).first().click()
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  await expect(page.locator('.details h2')).toHaveText(title)
}
async function stored(page: Page) {
  return page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!) as Profile, PROFILE_STORAGE_KEY)
}
async function undo(page: Page) {
  const action = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await action.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await action.click()
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
}

test('Armory routes from details and a blocked purchase preserve explicit edits, return focus and fresh previews', async ({ page }) => {
  const profile = advanced()
  expect(visibility(catalog, profile).milestones.some((item) => item.id === armory.id)).toBe(true)
  await load(page, profile)
  await select(page, chest.title)
  const armoryRoute = page.locator('.details').getByRole('button', { name: 'Review Armory', exact: true })
  await expect(armoryRoute.locator('..')).toContainText('Missing')
  await expect(page.locator('.details .requirement-satisfied').first()).toContainText('Satisfied')
  await armoryRoute.focus()
  await page.keyboard.press('Enter')
  let dialog = page.getByRole('dialog', { name: 'Milestones', exact: true })
  const checkbox = dialog.getByRole('checkbox', { name: /^Armory/ })
  await expect(checkbox).toBeFocused()
  expect(await stored(page)).toEqual(profile)
  await page.keyboard.press('Escape')
  await expect(armoryRoute).toBeFocused()
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Explicit progress required', exact: true })
  await expect(dialog).toContainText('Missing')
  await dialog.getByRole('button', { name: 'Review Armory', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Milestones', exact: true })
  await expect(dialog.getByRole('checkbox', { name: /^Armory/ })).toBeFocused()
  expect(await stored(page)).toEqual(profile)
  await dialog.getByRole('checkbox', { name: /^Armory/ }).check()
  await expect.poll(async () => (await stored(page)).milestones[armory.id]).toBe(true)
  await dialog.getByRole('button', { name: `Return to ${chest.title}`, exact: true }).click()
  await expect(page.locator('.details h2')).toBeFocused()
  await expect(armoryRoute.locator('..')).toContainText('Satisfied')
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Record purchase?', exact: true })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await stored(page)).purchases[chest.id]).toBeUndefined()
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect.poll(async () => (await stored(page)).purchases[chest.id]?.active).toBe(true)
  await undo(page)
  expect((await stored(page)).purchases[chest.id]).toBeUndefined()
  expect((await stored(page)).milestones[armory.id]).toBe(true)
  await undo(page)
  expect(await stored(page)).toEqual(profile)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('visible OR paths show individual states; review and return do not choose a path', async ({ page }) => {
  const target = catalog.upgrades.find((node) => node.purchase.kind === 'any' && node.purchase.requirements.length > 1 && node.purchase.requirements.every((item) => item.kind === 'active'))!
  const profile = { ...emptyProfile(catalog.revision), showSpoilers: true }
  await load(page, profile)
  await select(page, target.title)
  const purchase = page.locator('.details dt').filter({ hasText: /^Purchase requirements$/ }).locator('+ dd')
  await expect(purchase).toContainText(' OR ')
  await expect(purchase.locator('.requirement-satisfied')).toHaveCount(0)
  await purchase.getByRole('button').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.details h2')).toBeFocused()
  await page.locator('.details').getByRole('button', { name: `Return to ${target.title}`, exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(target.title)
  await expect(page.locator('.details h2')).toBeFocused()
  expect(await stored(page)).toEqual(profile)
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose a prerequisite path', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await stored(page)).toEqual(profile)
})

test('a hidden milestone has no identity, state or route in requirement details and blockers', async ({ page }) => {
  const profile = advanced()
  if (chest.purchase.kind !== 'all' || chest.purchase.requirements[0].kind !== 'active') throw new Error('Expected reviewed chest prerequisite')
  delete profile.purchases[chest.purchase.requirements[0].id]
  expect(visibility(catalog, profile).ids.has(chest.id)).toBe(true)
  expect(visibility(catalog, profile).milestones.some((item) => item.id === armory.id)).toBe(false)
  await load(page, profile)
  await select(page, chest.title)
  const purchase = page.locator('.details dt').filter({ hasText: /^Purchase requirements$/ }).locator('+ dd')
  await expect(purchase).not.toContainText(armory.title)
  await expect(purchase.getByRole('button', { name: 'Review Armory', exact: true })).toHaveCount(0)
  expect(await purchase.innerHTML()).not.toContain(armory.id)
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Explicit progress required', exact: true })
  await expect(dialog).not.toContainText(armory.title)
  await expect(dialog.getByRole('button', { name: 'Review Armory', exact: true })).toHaveCount(0)
  expect(await stored(page)).toEqual(profile)
})

test('prior ascension route focuses history and retains its confirmation, cancel and undo contract', async ({ page }) => {
  const profile = { ...emptyProfile(catalog.revision), showSpoilers: true }
  if (astral.purchase.kind !== 'all') throw new Error('Expected reviewed Astral Slayer requirements')
  for (const requirement of astral.purchase.requirements) if (requirement.kind === 'active') profile.purchases[requirement.id] = { epoch: 0, active: true }
  await load(page, profile)
  await select(page, astral.title)
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  const blocked = page.getByRole('dialog', { name: 'Explicit progress required', exact: true })
  await blocked.getByRole('button', { name: 'Review At least one Ultra Ascension', exact: true }).click()
  let progress = page.getByRole('dialog', { name: 'Your progress', exact: true })
  const history = progress.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })
  await expect(history).toBeFocused()
  await history.fill('1')
  expect(await stored(page)).toEqual(profile)
  await progress.getByRole('button', { name: 'Review history…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await stored(page)).toEqual(profile)
  await page.locator('.details').getByRole('button', { name: `Return to ${astral.title}`, exact: true }).click()
  await page.locator('.details').getByRole('button', { name: 'Review At least one Ultra Ascension', exact: true }).last().click()
  progress = page.getByRole('dialog', { name: 'Your progress', exact: true })
  await progress.getByRole('spinbutton').fill('1')
  await progress.getByRole('button', { name: 'Review history…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Record history', exact: true }).click()
  await expect.poll(async () => (await stored(page)).epoch).toBe(1)
  await page.locator('.details').getByRole('button', { name: `Return to ${astral.title}`, exact: true }).click()
  await expect(page.locator('.details h2')).toBeFocused()
  expect((await stored(page)).purchases).toEqual(Object.fromEntries(Object.keys(profile.purchases).map((id) => [id, { epoch: 1, active: true }])))
  await undo(page)
  expect(await stored(page)).toEqual(profile)
})

test('blocked suggestions offer a contextual visible target without recommending a purchase', async ({ page }) => {
  const profile = advanced()
  await load(page, profile)
  await select(page, chest.title)
  await page.getByRole('button', { name: 'Next upgrade', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
  await expect(dialog.locator('.recommendation-card')).toHaveCount(0)
  await expect(dialog).toContainText('not a purchase suggestion')
  await dialog.getByRole('button', { name: `Review requirements for ${chest.title}`, exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(chest.title)
  await expect(page.locator('.details h2')).toBeFocused()
  await expect(page.locator('.details').getByRole('button', { name: 'Review Armory', exact: true })).toBeVisible()
  expect(await stored(page)).toEqual(profile)
})

test('pending activation review keeps the lock pending until its separate confirmation and supports undo', async ({ page }) => {
  const pending = new Set(catalog.upgrades.filter((node) => node.activation === 'after-ultra-ascension').map((node) => node.id))
  const target = catalog.upgrades.find((node) => node.purchase.kind === 'active' && pending.has(node.purchase.id))!
  if (target.purchase.kind !== 'active') throw new Error('Expected native pending prerequisite')
  const lock = catalog.upgrades.find((node) => node.id === (target.purchase as { id: string }).id)!
  const profile = advanced()
  profile.milestones[armory.id] = true
  delete profile.purchases[target.id]
  profile.purchases[lock.id].active = false
  await load(page, profile)
  await select(page, target.title)
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  const blocker = page.getByRole('dialog', { name: 'Explicit progress required', exact: true })
  await expect(blocker).toContainText('Missing')
  await blocker.getByRole('button', { name: `Review ${lock.title} · ${BigInt(lock.cost).toLocaleString('en')} SP`, exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(lock.title)
  await expect(page.locator('.details h2')).toBeFocused()
  await expect(page.locator('.details .state-label')).toContainText('awaiting activation')
  expect(await stored(page)).toEqual(profile)
  await page.getByRole('button', { name: 'Already activated…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await stored(page)).toEqual(profile)
  await page.getByRole('button', { name: 'Already activated…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(async () => (await stored(page)).purchases[lock.id].active).toBe(true)
  await page.locator('.details').getByRole('button', { name: `Return to ${target.title}`, exact: true }).click()
  await page.locator('.details').getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await undo(page)
  expect(await stored(page)).toEqual(profile)
})
