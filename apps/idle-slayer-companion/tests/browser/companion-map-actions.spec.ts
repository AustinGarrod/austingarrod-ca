import { test, expect } from './fixtures'
import { openAction, purchaseStart } from './helpers/app'

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
  await page.getByRole('button', { name: 'Map options', exact: true }).click()
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  for (const name of ['Privacy & tracking', 'About & sources', 'Install & offline', 'Map help…']) {
    await expect(options.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(options.getByRole('button', { name: 'Progress', exact: true })).toBeVisible()
  await expect(options.getByRole('button', { name: 'Reference sheet', exact: true })).toBeVisible()
})

test('short phone maps retain working Undo and Redo in Map options', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.companion-session-status')).toBeHidden()
  await purchaseStart(page)
  await expect(page.locator('.upgrade-node.purchased')).toHaveCount(1)
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  for (const direction of ['Undo', 'Redo'] as const) {
    await page.getByRole('button', { name: 'Map options', exact: true }).click()
    const action = options.getByRole('button', { name: direction, exact: true })
    await expect(action).toBeEnabled()
    await action.scrollIntoViewIfNeeded()
    await expect(action).toBeInViewport()
    expect(await action.evaluate((button) => {
      const box = button.getBoundingClientRect()
      return box.width >= 44 && box.height >= 44 && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)
    await action.click()
    await expect(options).toHaveCount(0)
    await expect(page.locator('.upgrade-node.purchased')).toHaveCount(direction === 'Undo' ? 0 : 1)
  }
})

test('reviewing Ascension references opens each real collection without changing progress', async ({ page }) => {
  await page.goto('./achievements/')
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
  for (const action of [
    { button: 'Progress checkpoints…', title: 'Progress checkpoints' },
    { button: 'Saved upgrade comparison…', title: 'Saved upgrade comparison' },
    { button: 'Progression goals…', title: 'Your progress' },
    { button: 'Map data tools…', title: 'Your progress' },
  ]) {
    await openAction(page, 'Privacy & tracking')
    await page.getByRole('dialog', { name: 'Privacy & tracking', exact: true }).getByRole('button', { name: 'Review Ascension references', exact: true }).click()
    const references = page.getByRole('dialog', { name: 'Ascension references', exact: true })
    await expect(references).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.locator('#companion-content')).toHaveAttribute('aria-label', 'Ascension')
    await references.getByRole('button', { name: action.button, exact: true }).click()
    const collection = page.getByRole('dialog', { name: action.title, exact: true })
    await expect(collection).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    if (action.button === 'Progression goals…') {
      const heading = collection.getByRole('heading', { name: 'Goals and rebuild checklist', exact: true })
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
  await help.getByRole('button', { name: 'Open Progress', exact: true }).click()
  const progress = page.getByRole('dialog', { name: 'Your progress', exact: true })
  await expect(progress).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(progress.getByRole('button', { name: 'Map help…', exact: true })).toHaveCount(0)
})
