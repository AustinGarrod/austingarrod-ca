import { test, expect } from './fixtures'
import { openAction, openData, purchaseStart, toolAction } from './helpers/app'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
})

test('embedded map keeps one set of app-wide controls and one visible history group', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.atlas footer')).toHaveCount(0)
  await expect(page.locator('.companion-session-status').getByRole('group', { name: 'Session history' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Session history' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  for (const name of ['Privacy & tracking', 'About & sources', 'Install & offline']) {
    const action = page.locator('.companion-sidebar').getByRole('button', { name, exact: true })
    await expect(action).toHaveCount(1)
    await expect(action).toBeVisible()
  }
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click()
  // View, Plan and Record hold map actions only; the app-wide utilities stay in the shell.
  const expected = { View: ['Map help…', 'Recent upgrades…'], Plan: ['Progress checkpoints…', 'Reference sheet…', 'Goals…'], Record: ['Milestones…', 'Previous Ultra Ascensions…'] }
  for (const [tool, actions] of Object.entries(expected)) {
    await page.locator('.toolbar').getByRole('button', { name: tool, exact: true }).click()
    const popup = page.locator('.toolbar .menu-popup')
    for (const name of ['Privacy & tracking', 'About & sources', 'Install & offline']) await expect(popup.getByRole('button', { name, exact: true })).toHaveCount(0)
    for (const name of actions) await expect(popup.getByRole('button', { name, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
  }
})

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) test(`View, Plan and Record open into their first control and Escape returns to the tool at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport)
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  for (const tool of ['View', 'Plan', 'Record']) {
    const toggle = page.locator('.toolbar').getByRole('button', { name: tool, exact: true })
    await toggle.click()
    const popup = page.locator('.toolbar .menu-popup')
    await expect(popup).toBeVisible()
    expect(await popup.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await expect(toggle).toBeFocused()
  }
})

test('short phone maps retain working Undo and Redo in the Record tools', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.companion-session-status')).toBeHidden()
  await purchaseStart(page)
  await expect(page.locator('.upgrade-node.purchased')).toHaveCount(1)
  const record = page.locator('.toolbar').getByRole('button', { name: 'Record', exact: true })
  for (const direction of ['Undo', 'Redo'] as const) {
    await record.click()
    const action = toolAction(page, direction)
    await expect(action).toBeEnabled()
    await action.scrollIntoViewIfNeeded()
    await expect(action).toBeInViewport()
    expect(await action.evaluate((button) => {
      const box = button.getBoundingClientRect()
      return box.width >= 44 && box.height >= 44 && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)
    await action.click()
    await expect(page.locator('.toolbar .menu-popup')).toHaveCount(0)
    await expect(record).toBeFocused()
    await expect(page.locator('.upgrade-node.purchased')).toHaveCount(direction === 'Undo' ? 0 : 1)
  }
})

test('Data & backup opens each Ascension collection from any section without changing progress', async ({ page }) => {
  await page.goto('./achievements/')
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
  for (const action of [
    { button: 'Checkpoints: export or restore…', title: 'Progress checkpoints' },
    { button: 'Saved comparison: export or restore…', title: 'Saved upgrade comparison' },
    { button: 'Goals…', title: 'Goals' },
  ]) {
    await (await openData(page)).getByRole('button', { name: action.button, exact: true }).click()
    const collection = page.getByRole('dialog', { name: action.title, exact: true })
    await expect(collection).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.locator('#companion-content')).toHaveAttribute('aria-label', 'Ascension')
    if (action.button === 'Goals…') {
      const heading = collection.getByRole('heading', { name: 'Saved goals', exact: true, level: 3 })
      await expect(heading).toBeFocused()
      await expect(heading).toBeInViewport()
    }
    await collection.getByRole('button', { name: 'Close dialog', exact: true }).click()
  }
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(before)
})

test('About opens map help once and its actions replace the dialog', async ({ page }) => {
  await page.goto('./crafting/')
  await openAction(page, 'About & sources')
  const about = page.getByRole('dialog', { name: 'About & sources', exact: true })
  await expect(about.getByRole('button', { name: 'Map help…', exact: true })).toHaveCount(1)
  await about.getByRole('button', { name: 'Map help…', exact: true }).click()
  const help = page.getByRole('dialog', { name: 'Map help', exact: true })
  await expect(help).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await help.getByRole('button', { name: 'Previous Ultra Ascensions…', exact: true }).click()
  const prior = page.getByRole('dialog', { name: 'Previous Ultra Ascensions', exact: true })
  await expect(prior).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(prior.getByRole('button', { name: 'Map help…', exact: true })).toHaveCount(0)
})
