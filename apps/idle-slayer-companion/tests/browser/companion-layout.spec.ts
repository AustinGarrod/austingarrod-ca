import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { purchaseStart } from './helpers/app'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'
import { CHECKPOINT_STORAGE_KEY } from '../../src/domain/checkpoints'

const utilities = ['Privacy & tracking', 'About & sources', 'Install & offline'] as const
const privacyDialog = (page: Page) => page.getByRole('dialog', { name: 'Privacy & tracking', exact: true })
const recordedProgress = (page: Page) => page.evaluate((key) => localStorage.getItem(key), COMPANION_STORAGE_KEY)

async function openNavigation(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Companion sections', exact: true })
  if (!await navigation.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await expect(navigation).toBeVisible()
  return page.locator('.companion-sidebar')
}

async function openUtility(page: Page, name: typeof utilities[number]) {
  const sidebar = await openNavigation(page)
  await sidebar.getByRole('button', { name, exact: true }).click()
}

async function expectSingleDialog(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Your companion', exact: true })).toHaveCount(0)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

test('a long module scrolls independently while desktop navigation stays reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./achievements/')
  const content = page.getByRole('main', { name: 'Achievements', exact: true })
  await content.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await expect(content.locator('.companion-entity-card').first()).toBeVisible()
  await expect.poll(() => content.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(900)
  const sidebar = page.locator('.companion-sidebar')
  const before = await sidebar.boundingBox()
  for (const name of utilities) await expect(sidebar.getByRole('button', { name, exact: true })).toBeInViewport()
  await content.hover({ position: { x: 30, y: 150 } })
  await page.mouse.wheel(0, 1500)
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await sidebar.boundingBox()).toEqual(before)
  for (const name of utilities) await expect(sidebar.getByRole('button', { name, exact: true })).toBeInViewport()
  await sidebar.getByRole('button', { name: 'Privacy & tracking', exact: true }).click()
  await expectSingleDialog(page, privacyDialog(page))
  await page.keyboard.press('Escape')
  await expect(sidebar.getByRole('button', { name: 'Privacy & tracking', exact: true })).toBeFocused()
})

test('changing long sections starts at the new heading instead of retaining the previous scroll position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./achievements/')
  await page.getByRole('main', { name: 'Achievements', exact: true }).getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  const content = page.locator('#companion-content')
  const navigation = page.getByRole('navigation', { name: 'Companion sections', exact: true })
  for (const name of ['Bestiary', 'Crafting & materials'] as const) {
    await expect.poll(() => content.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(900)
    await content.evaluate((element) => { element.scrollTop = 1500 })
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(900)
    await navigation.getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('main', { name, exact: true })).toBeVisible()
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(content.getByRole('heading', { name, exact: true })).toBeInViewport()
  }
  await content.evaluate((element) => { element.scrollTop = 1500 })
  await page.goBack()
  await expect(page.getByRole('main', { name: 'Bestiary', exact: true })).toBeVisible()
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(content.getByRole('heading', { name: 'Bestiary', exact: true })).toBeInViewport()
})

test('Ascension uses one compact global Undo and Redo group with working actions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  const history = page.locator('.companion-session-status').getByRole('group', { name: 'Session history', exact: true })
  await expect(history).toBeVisible()
  await expect(page.getByRole('group', { name: 'Session history', exact: true })).toHaveCount(1)
  const undo = history.getByRole('button', { name: 'Undo', exact: true })
  const redo = history.getByRole('button', { name: 'Redo', exact: true })
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  const dimensions = async () => Promise.all([undo, redo].map(async (button) => {
    const bounds = await button.boundingBox()
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeLessThanOrEqual(48)
    return { width: bounds!.width, height: bounds!.height }
  }))
  const before = await dimensions()
  await purchaseStart(page)
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()
  const purchased = await recordedProgress(page)
  await expect.poll(dimensions).toEqual(before)
  await undo.click()
  await expect(redo).toBeEnabled()
  await expect(page.locator('.upgrade-node.purchased')).toHaveCount(0)
  await redo.click()
  await expect.poll(() => recordedProgress(page)).toBe(purchased)
  await expect.poll(dimensions).toEqual(before)
})

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`canonical utilities and child destinations work at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    await expect(page.locator('.toolbar')).toBeVisible()
    const before = await recordedProgress(page)
    const sidebar = await openNavigation(page)
    for (const name of utilities) await expect(sidebar.getByRole('button', { name, exact: true })).toHaveCount(1)
    await sidebar.getByRole('button', { name: 'Privacy & tracking', exact: true }).click()
    const privacy = privacyDialog(page)
    await expectSingleDialog(page, privacy)
    await expect(privacy.getByText(/^Companion progress is stored in this browser when saving succeeds\./)).toHaveCount(1)
    const close = privacy.getByRole('button', { name: 'Close dialog', exact: true })
    const icon = close.locator('svg')
    await expect(icon).toHaveCount(1)
    const centered = await icon.evaluate((element) => {
      const icon = element.getBoundingClientRect(), button = element.closest('button')!.getBoundingClientRect()
      return { x: Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2), y: Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2) }
    })
    expect(centered.x).toBeLessThanOrEqual(1)
    expect(centered.y).toBeLessThanOrEqual(1)
    await privacy.getByRole('button', { name: 'Review Ascension references', exact: true }).click()
    const references = page.getByRole('dialog', { name: 'Ascension references', exact: true })
    await expectSingleDialog(page, references)
    for (const [action, destination] of [
      ['Progress checkpoints…', 'Progress checkpoints'],
      ['Saved upgrade comparison…', 'Saved upgrade comparison'],
      ['Progression goals…', 'Your progress'],
      ['Map data tools…', 'Your progress'],
    ] as const) {
      await references.getByRole('button', { name: action, exact: true }).click()
      const child = page.getByRole('dialog', { name: destination, exact: true })
      await expectSingleDialog(page, child)
      await page.keyboard.press('Escape')
      await openUtility(page, 'Privacy & tracking')
      await privacy.getByRole('button', { name: 'Review Ascension references', exact: true }).click()
      await expectSingleDialog(page, references)
    }
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
    const backup = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
    await backup.getByRole('button', { name: 'Open Ascension data tools', exact: true }).click()
    await expectSingleDialog(page, page.getByRole('dialog', { name: 'Your progress', exact: true }))
    await page.keyboard.press('Escape')
    await openUtility(page, 'About & sources')
    const about = page.getByRole('dialog', { name: 'About & sources', exact: true })
    await expectSingleDialog(page, about)
    await expect(about.getByRole('link', { name: 'Source and extraction documentation', exact: true })).toHaveAttribute('href', 'https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion')
    await expect(about.getByRole('link', { name: 'Bundled software licenses', exact: true })).toHaveAttribute('href', /\/licenses\/index\.html$/)
    for (const name of utilities) await expect(about.getByRole('button', { name, exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await openUtility(page, 'Install & offline')
    const install = page.getByRole('dialog', { name: 'Install & offline', exact: true })
    await expectSingleDialog(page, install)
    await install.getByRole('button', { name: 'Check update / retry download', exact: true }).click()
    await expect(install).toContainText('Connect to the internet to check for an update or retry the offline download.')
    await page.keyboard.press('Escape')
    const optionsButton = page.getByRole('button', { name: 'Map options', exact: true })
    await (await optionsButton.isVisible() ? optionsButton : page.getByRole('button', { name: 'Map view…', exact: true })).click()
    const options = page.getByRole('dialog', { name: 'Map options', exact: true })
    for (const name of utilities) await expect(options.getByRole('button', { name, exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await recordedProgress(page)).toBe(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('Privacy routes a blocked reload to checkpoint recovery without replacing saved bytes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const saved = 'SYNTHETIC-corrupt-checkpoint-reference'
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, saved), { key: CHECKPOINT_STORAGE_KEY, saved })
  await page.goto('./')
  await expect(page.getByRole('main', { name: 'Overview', exact: true })).toBeVisible()
  const before = await recordedProgress(page)
  await openUtility(page, 'Privacy & tracking')
  const privacy = privacyDialog(page)
  await privacy.getByRole('button', { name: /^(Enable|Disable) tracking and reload$/ }).click()
  await expect(privacy).toContainText('Checkpoints or saved comparison need recovery. Review them in Ascension before reloading.')
  await privacy.getByRole('button', { name: 'Review Ascension references', exact: true }).click()
  const references = page.getByRole('dialog', { name: 'Ascension references', exact: true })
  await expectSingleDialog(page, references)
  await expect(references).toContainText('Some local references need recovery before closing or reloading.')
  await references.getByRole('button', { name: 'Progress checkpoints…', exact: true }).click()
  const checkpoints = page.getByRole('dialog', { name: 'Progress checkpoints', exact: true })
  await expectSingleDialog(page, checkpoints)
  await expect(checkpoints.getByRole('button', { name: 'Replace saved checkpoints…', exact: true })).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), CHECKPOINT_STORAGE_KEY)).toBe(saved)
  expect(await recordedProgress(page)).toBe(before)
})
