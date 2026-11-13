import { expect, type Locator, type Page } from '@playwright/test'

export async function expectMapReady(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
}

export async function exposeMapAction(page: Page, action: Locator) {
  await expectMapReady(page)
  if (!await action.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
}

export async function openAction(page: Page, name: string) {
  if (name === 'Map help…') {
    await openAction(page, 'About & sources')
    await page.getByRole('dialog', { name: 'About & sources', exact: true }).getByRole('button', { name, exact: true }).click()
    return
  }
  if (['About & sources', 'Privacy & tracking', 'Install & offline'].includes(name)) {
    const current = page.locator('dialog[open]')
    if (await current.count()) await current.getByRole('button', { name: 'Close dialog', exact: true }).click()
    const action = page.getByRole('button', { name, exact: true })
    if (!await action.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await action.click()
    return
  }
  const action = page.getByRole('button', { name, exact: true })
  await exposeMapAction(page, action)
  await action.click()
}

export async function openProgress(page: Page) {
  await openAction(page, 'Progress')
  const dialog = page.getByRole('dialog', { name: 'Your progress', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

export async function closeMapOptions(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
}

export async function showSpoilers(page: Page, shown = true) {
  const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  await exposeMapAction(page, checkbox)
  await checkbox.setChecked(shown)
  await closeMapOptions(page)
}

export async function selectUpgrade(page: Page, title: string) {
  await expectMapReady(page)
  await page.getByRole('searchbox').fill(title)
  await page.locator('.search-result').filter({ hasText: title }).first().click()
  await expect(page.locator('.details h2')).toHaveText(title)
}

export async function chooseLayout(page: Page, name: 'Detailed Layout' | 'Game Layout') {
  await expectMapReady(page)
  const action = page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name, exact: true })
  await action.click()
  await expect(action).toHaveAttribute('aria-pressed', 'true')
}

export async function undoProgress(page: Page) {
  await openAction(page, 'Undo')
  await closeMapOptions(page)
}

export async function purchaseStart(page: Page) {
  await expectMapReady(page)
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
}
