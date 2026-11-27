import { expect, type Locator, type Page } from '@playwright/test'

export async function expectMapReady(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
}

/** The map's tool disclosures, in the order they are searched: an upgrade's Plan and Share, then View, Plan and Record. */
function toolDisclosures(page: Page) {
  return [
    page.locator('.details').getByRole('button', { name: 'Plan with this upgrade', exact: true }),
    page.locator('.details').getByRole('button', { name: 'Share this upgrade', exact: true }),
    page.locator('.toolbar').getByRole('button', { name: 'View', exact: true }),
    page.locator('.toolbar').getByRole('button', { name: 'Plan', exact: true }),
    page.locator('.toolbar').getByRole('button', { name: 'Record', exact: true }),
  ]
}

/** Reveal a map control that sits behind the View, Plan or Record tools, or an upgrade's Plan and Share. */
export async function exposeMapAction(page: Page, action: Locator) {
  await expectMapReady(page)
  if (await action.isVisible()) return
  for (const toggle of toolDisclosures(page)) {
    if (!await toggle.isVisible()) continue
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    if (await action.isVisible()) return
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
  }
}

/** Click a map control wherever it lives in the map tools. */
export async function mapAction(page: Page, name: string) {
  const action = page.getByRole('button', { name, exact: true })
  await exposeMapAction(page, action)
  await action.click()
}

export async function openAction(page: Page, name: string) {
  if (name === 'Undo' || name === 'Redo') { await historyAction(page, name); return }
  if (name === 'Milestones') name = 'Milestones…'
  if (name === 'Map help…') {
    await openAction(page, 'About & sources')
    await page.getByRole('dialog', { name: 'About & sources', exact: true }).getByRole('button', { name, exact: true }).click()
    return
  }
  if (['About & sources', 'Privacy & tracking', 'Install & offline'].includes(name)) {
    // React may attach its shell after the document load event. Wait before
    // deciding whether the action is hidden behind the mobile navigation.
    await expect(page.locator('.companion-sidebar')).toBeAttached()
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

/** Open Data & backup; by default also expand its Advanced single-file section. */
export async function openData(page: Page, { advanced = true }: { advanced?: boolean } = {}) {
  await expect(page.locator('.companion-shell')).toBeAttached()
  const current = page.locator('dialog[open]')
  if (await current.count() && !await page.getByRole('dialog', { name: 'Data & backup', exact: true }).count()) await current.last().getByRole('button', { name: 'Close dialog', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Data & backup', exact: true })
  if (!await dialog.count()) await page.getByRole('button', { name: /^(Data & backup|Data)$/ }).click()
  await expect(dialog).toBeVisible()
  const more = dialog.locator('details.companion-data-advanced')
  if (advanced && await more.count() && !await more.evaluate((element) => (element as HTMLDetailsElement).open)) await more.locator('summary').click()
  return dialog
}

/** Import save lives in Data & backup; this opens its dialog. */
export async function openImport(page: Page) {
  const data = await openData(page, { advanced: false })
  await data.getByRole('button', { name: 'Import save…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import save', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Account & sync lives in Data & backup; this opens its dialog. */
export async function openAccount(page: Page) {
  const data = await openData(page, { advanced: false })
  await data.getByRole('button', { name: /^Account & sync/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Account & sync', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Undo or Redo: the status row, or the Record tools where short phones keep them. */
export async function historyAction(page: Page, direction: 'Undo' | 'Redo') {
  const row = page.locator('.companion-session-status').getByRole('button', { name: direction, exact: true })
  if (await row.isVisible()) { await row.click(); return }
  await mapAction(page, direction)
}

/** Previous Ultra Ascensions, the Record tool that replaced the Progress dialog's history form. */
export async function openPriorAscensions(page: Page) {
  await mapAction(page, 'Previous Ultra Ascensions…')
  const dialog = page.getByRole('dialog', { name: 'Previous Ultra Ascensions', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Plan → Goals, the saved goals list that used to sit at the bottom of the Progress dialog. */
export async function openGoals(page: Page) {
  await mapAction(page, 'Goals…')
  const dialog = page.getByRole('dialog', { name: 'Goals', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Restore a file through Data & backup's single restore control, which routes it to its own preview. */
export async function restoreFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const data = await openData(page, { advanced: false })
  await data.getByLabel('Restore from a backup file', { exact: true }).setInputFiles(file)
}

/** Close any open View, Plan or Record tools. */
export async function closeMapOptions(page: Page) {
  for (const toggle of toolDisclosures(page)) if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
}

export async function showSpoilers(page: Page, shown = true) {
  const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  await exposeMapAction(page, checkbox)
  await checkbox.setChecked(shown)
  await closeMapOptions(page)
}

/** Browse every visible upgrade: focus alone no longer opens results, so use the search disclosure. */
export async function openSearchResults(page: Page) {
  await expectMapReady(page)
  const toggle = page.getByRole('button', { name: 'Toggle search results', exact: true })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(page.getByRole('region', { name: 'Visible upgrade results', exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox')).toBeFocused()
}

export async function selectUpgrade(page: Page, title: string) {
  await expectMapReady(page)
  await page.getByRole('searchbox').fill(title)
  // Refilling the same title does not count as typing, so open the results explicitly.
  await openSearchResults(page)
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
