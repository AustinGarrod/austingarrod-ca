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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A map control by its visible label. Menu actions that carry a note (why Record Ultra Ascension is not
 * available yet, what Undo or Redo would change) currently include the note in their accessible name,
 * so they are also matched by their label span.
 */
export function toolAction(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true })
    .or(page.locator('.menu-popup > button').filter({ has: page.locator(':scope > span', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) }))
}

/** Click a map control wherever it lives in the map tools. */
export async function mapAction(page: Page, name: string) {
  const action = toolAction(page, name)
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
  await mapAction(page, name)
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

/** The QR transfer moved to Data & backup; it opens the map's 'Transfer map progress' dialog. */
export async function openTransfer(page: Page, mode: 'send' | 'receive') {
  const data = await openData(page, { advanced: false })
  await data.getByRole('button', { name: mode === 'send' ? 'Send map progress by QR…' : 'Receive a transfer…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Transfer map progress', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The original Ascension-only map file, now under Data & backup's Advanced single files. Returns the Data dialog. */
export async function exportMapBackup(page: Page) {
  const data = await openData(page)
  await data.getByRole('button', { name: 'Export Ascension map backup', exact: true }).click()
  return data
}

/** Close any open View, Plan or Record tools. */
export async function closeMapOptions(page: Page) {
  for (const toggle of toolDisclosures(page)) if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
}

/**
 * Set Show spoilers under View and read the result back. Hiding a selected spoiler closes its details and
 * can move focus out of View (closing it), so the check reopens View when needed. Leaves View open.
 */
export async function setSpoilers(page: Page, shown: boolean) {
  const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  await exposeMapAction(page, checkbox)
  if (await checkbox.isChecked() !== shown) await checkbox.click()
  await exposeMapAction(page, checkbox)
  await expect(checkbox).toBeChecked({ checked: shown })
}

export async function showSpoilers(page: Page, shown = true) {
  await setSpoilers(page, shown)
  await closeMapOptions(page)
}

/** Browse every visible upgrade: focus alone no longer opens results, so use the search disclosure. */
export async function openSearchResults(page: Page) {
  await expectMapReady(page)
  const toggle = page.getByRole('button', { name: 'Toggle search results', exact: true })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  else await page.getByRole('searchbox').focus()
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

/** The layout switch: in the toolbar on wide maps, under View on narrow ones. */
export function layoutButton(page: Page, name: string) {
  return page.getByRole('group', { name: 'Map layout', exact: true }).getByRole('button', { name, exact: true })
}

export async function chooseLayout(page: Page, name: string) {
  await expectMapReady(page)
  const action = layoutButton(page, name)
  await exposeMapAction(page, action)
  await action.click()
  await expect(action).toHaveAttribute('aria-pressed', 'true')
  await closeMapOptions(page)
}

/** Assert which layout is chosen, wherever the switch currently lives. */
export async function expectLayout(page: Page, name: string) {
  const action = layoutButton(page, name)
  await exposeMapAction(page, action)
  await expect(action).toHaveAttribute('aria-pressed', 'true')
  await closeMapOptions(page)
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
