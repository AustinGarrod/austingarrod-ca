// Shared navigation for the Pokémon Binder browser checks. Not a test on its own.
// The Binders tab opens on a list of binders; a binder is opened from its card and left with "All binders".
import { expect } from '@playwright/test';

/** The binder cards on the home list (National Pokédex and set binders). */
export const homeCards = page => page.locator('#set-overview-list article');

/** A binder's card on the home list, by its exact name. */
export const homeCard = (page, name) => homeCards(page).filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Waits until the Binders tab shows first run, the home list or an open binder. */
async function settled(page) {
  await expect(page.locator('#first-set:visible, #set-overview:visible, #binder-back:visible').first()).toBeVisible();
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
  if (await first.isVisible()) return first.click();
  await goHome(page);
  await page.locator('#master-new').click();
}

/** Clicks an action of the open binder, such as Scan cards, Binder settings or Sync and backup. */
export async function binderAction(page, selector) {
  await page.locator(selector).click();
}

/** Clicks a collection-wide import or export action (#import-cards, #export-cards). */
export async function transferAction(page, selector) {
  if (!(await page.locator(selector).isVisible())) await goHome(page);
  await page.locator(selector).click();
}

/** Shows the missing and ordered card list controls of the open binder. */
export async function cardLists(page) {
  await expect(page.locator('#position-list')).toBeVisible();
}
