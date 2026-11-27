// Shared navigation for the Pokémon Binder browser checks. Not a test on its own.
// The Binders tab opens on a list of binders; a binder is opened from its card and left with "All binders".
// Inside the app bar, a menu holds Scan cards, Binder settings, Add an extra card, Import and export,
// and Sync and backup. Import and export is one dialog that leads to import, export and card lists.
import { expect } from '@playwright/test';

/** The binder cards on the home list (National Pokédex and set binders). */
export const homeCards = page => page.locator('#set-overview-list article');

/** A binder's card on the home list, by its exact name. */
export const homeCard = (page, name) => homeCards(page).filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Waits until the Binders tab shows first run, the home list or an open binder. */
async function settled(page) {
  await expect(page.locator('#first-set:visible, #set-overview:visible, #binder-back:visible').first()).toBeVisible();
}

async function closeDialogs(page) {
  while (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
}

/** Returns to the home list of binders. */
export async function goHome(page) {
  await settled(page);
  const back = page.locator('#binder-back');
  if (await back.isVisible()) await back.click();
  await expect(page.locator('#set-overview')).toBeVisible();
}

/** Opens a binder from the home list by name ("National Pokédex" for the Pokédex). */
export async function openBinder(page, name) {
  await goHome(page);
  await homeCard(page, name).locator('[data-overview-binder]').click();
  await expect(page.locator('#binder-back')).toBeVisible();
}

/** Starts a new set binder from first run or from the home list. */
export async function newSetBinder(page) {
  await settled(page);
  const first = page.locator('#first-set');
  // First run can give way to a binder that is still opening; fall back to the home list then.
  if (await first.isVisible() && await first.click({ timeout: 3000 }).then(() => true, () => false)) return;
  await goHome(page);
  await page.locator('#master-new').click();
}

/** Opens the app bar menu. */
export async function openMenu(page) {
  const menu = page.locator('#binder-menu');
  if (!(await menu.evaluate(details => details.open))) await menu.locator('summary').click();
  await expect(menu.locator('.dex-menu-list')).toBeVisible();
}

/** Clicks an action of the open binder; actions in the app bar menu open the menu first. */
export async function binderAction(page, selector) {
  const target = page.locator(selector);
  if (!(await target.isVisible())) {
    await closeDialogs(page);
    if (await page.locator('#binder-menu .dex-menu-list').locator(selector).count()) await openMenu(page);
  }
  await target.click();
}

/** Clicks a collection-wide import or export action (#import-cards, #export-cards) in Import and export. */
export async function transferAction(page, selector) {
  if (!(await page.locator(selector).isVisible())) await binderAction(page, '#transfer-open');
  await page.locator(selector).click();
}

/** Shows the missing and ordered card list controls of the open binder, in Import and export. */
export async function cardLists(page) {
  if (!(await page.locator('#position-list').isVisible())) await binderAction(page, '#transfer-open');
  await expect(page.locator('#position-list')).toBeVisible();
}

/** Chooses a value in a binder's Show or Generation filter; on phones they sit behind the Filter button. */
export async function chooseFilter(page, selector, value) {
  const field = page.locator(selector);
  if (!(await field.isVisible())) {
    await page.locator('.dex-toolbar', { has: field }).locator('.dex-filter-toggle').click();
  }
  await field.selectOption(value);
}
