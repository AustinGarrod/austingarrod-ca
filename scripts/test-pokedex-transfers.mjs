import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { binderAction, cardLists, chooseFilter, goHome, homeCard, homeCards, newSetBinder, openBinder, transferAction } from './test-pokedex-helpers.mjs';

const origin = process.env.POKEDEX_TRANSFER_ORIGIN || 'http://127.0.0.1:4321';
const app = origin + '/utilities/pokemon-binder/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const errors = [];
const incoming = 'Set,Collector number,Name,Finish,Quantity\n151,001,Bulbasaur,Reverse Holo,4\nBase Set,4,Charizard,Normal Holo,1\n151,002,Ivysaur,,1\nMissing Set,001,Unknown,,1\n';
const collectr = await readFile(new URL('../tests/pokedex-binder/fixtures/collectr.csv', import.meta.url));

async function context(width, user = () => null, saved = () => null) {
  const result = await browser.newContext({ viewport: { width, height: 860 }, acceptDownloads: true });
  await result.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/v1/auth.php') return route.fulfill({ json: { enabled: true, migrationEnabled: true, user: user(), csrfToken: 'fixture' } });
    if (url.pathname === '/api/v1/sync.php') {
      assert.equal(route.request().method(), 'GET', 'Opening or previewing a binder must not write to the account.');
      return route.fulfill({ json: { document: saved(url.searchParams.get('document')) } });
    }
    return route.continue();
  });
  result.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return result;
}

async function open(page) {
  await page.goto(app);
  await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#dex-status')).not.toHaveText('Binder could not start');
}

async function preview(page, trigger, text, target = 'sets') {
  if (trigger === '#import-cards') await transferAction(page, trigger);
  else await page.locator(trigger).click();
  await page.locator('#card-import-target').selectOption(target);
  await page.locator('#card-import-file').setInputFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await page.locator('#card-import-preview').click();
  await expect(page.locator('#card-import-review')).toBeVisible();
}

async function checkCollectr(width) {
  const ctx = await context(width);
  const page = await ctx.newPage();
  const shot = stage => page.screenshot({ path: `output/pokedex-transfers/collectr-${stage}-${width}.png` });
  try {
    await open(page);
    await shot('entry');
    await page.locator('#first-import-collectr').click();
    const dialog = page.getByRole('dialog', { name: 'Import from Collectr' });
    const choose = dialog.locator('#card-import-file');
    const format = dialog.locator('#card-import-format');
    const portfolios = dialog.getByRole('group', { name: 'Collectr portfolios' });
    const binder = portfolios.getByRole('checkbox', { name: '151 binder' });
    const trade = portfolios.getByRole('checkbox', { name: 'Trade binder' });
    const previewButton = dialog.getByRole('button', { name: 'Preview import' });
    const review = dialog.locator('#card-import-review');
    const summary = review.locator('#card-review-summary');
    const rows = review.locator('#card-review-rows');
    await expect(dialog.getByText(/export your collection as a csv/i)).toBeVisible();
    await expect(format).toHaveValue('collectr');
    await shot('empty');
    await choose.setInputFiles({ name: 'collectr-export.csv', mimeType: 'text/csv', buffer: Buffer.concat([collectr, Buffer.from('\nTrade binder,Pokémon,151\n')]) });
    await expect(binder).toBeChecked();
    await expect(trade).toBeChecked();
    await expect(portfolios).toContainText('2 of 2 portfolios selected');
    await shot('portfolios');
    await binder.uncheck();
    await trade.uncheck();
    await expect(previewButton).toBeDisabled();
    await binder.check();
    await previewButton.click();
    await expect(summary).toContainText('2 to add · 0 already owned · 5 skipped or need review');
    await expect(summary).toContainText('Skipped 1 row in the file because the columns differ from the header.');
    await expect(rows).toContainText('Portfolio: 151 binder');
    await expect(rows).not.toContainText('Trade binder');
    await expect(rows).toContainText('Watchlist entry');
    await expect(rows).toContainText('Quantity must be a positive whole number');
    await expect(rows).toContainText('Card was not found in that set');
    await expect(review.getByLabel('Match row 4')).toBeVisible();
    assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'Collectr import dialog overflow');
    await expect(review.getByRole('heading', { name: 'Review matches' })).toBeFocused();
    await expect(review.getByRole('button', { name: 'Add cards', exact: true })).toBeInViewport();
    await trade.check();
    await expect(review).toBeHidden();
    await previewButton.click();
    await expect(summary).toContainText('3 to add · 0 already owned · 7 skipped or need review');
    await trade.uncheck();
    await previewButton.click();
    await review.getByLabel('Match row 4').selectOption({ label: '151 #004 · Charmander · Regular' });
    await expect(summary).toContainText('3 to add');
    await shot('review');
    await review.getByRole('button', { name: 'Add cards', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(homeCards(page)).toHaveCount(1);
    await expect(homeCard(page, '151')).toBeVisible();
    await expect(page.locator('#transfer-message')).toHaveText('Saved 3 distinct printings across 1 set binder.');
    await expect(page.locator('#transfer-message')).toBeInViewport();
    await shot('result');

    await binderAction(page, '#transfer-open');
    await expect(page.locator('#transfer-dialog')).toBeVisible();
    await shot('transfer');
    await page.locator('#import-collectr').click();
    await expect(format).toHaveValue('collectr');
    await choose.setInputFiles({ name: 'collectr-export.csv', mimeType: 'text/csv', buffer: collectr });
    await trade.uncheck();
    await previewButton.click();
    await expect(summary).toContainText('0 to add · 2 already owned');
    await review.getByRole('button', { name: 'Cancel' }).click();
    await expect(homeCards(page)).toHaveCount(1);
    await expect(homeCard(page, 'National Pokédex')).toHaveCount(0);

    await preview(page, '#import-cards', collectr);
    await expect(format).toHaveValue('auto');
    await expect(portfolios).toBeVisible();
    await dialog.locator('#card-import-target').selectOption('dex');
    await expect(review).toBeHidden();
    await trade.uncheck();
    await previewButton.click();
    await expect(summary).toContainText('3 to add');
    await review.getByRole('button', { name: 'Add Pokémon' }).click();
    await expect(dialog).toBeHidden();
    await goHome(page);
    await expect(homeCard(page, 'National Pokédex')).toBeVisible();
    await page.reload();
    await expect(homeCards(page)).toHaveCount(2);
    await expect(homeCard(page, 'National Pokédex').locator('[data-owned-count]')).toHaveText('3');
  } finally {
    await ctx.close();
  }
}

try {
  await mkdir('output/pokedex-transfers', { recursive: true });
  for (const width of [390, 1440]) {
    await checkCollectr(width);
    const ctx = await context(width), page = await ctx.newPage();
    await open(page);
    await expect(page.locator('#binder-onboarding')).toBeVisible();
    await expect(page.locator('#national-workspace')).toBeHidden();
    await preview(page, '#first-import', incoming);
    await expect(page.locator('#card-review-summary')).toContainText('2 to add · 0 already owned · 2 skipped or need review');
    await expect(page.locator('#card-review-summary')).toContainText('extra copies');
    await page.getByLabel('Match row 4').selectOption({ label: '151 #002 · Ivysaur · Regular' });
    await expect(page.locator('#card-review-summary')).toContainText('3 to add');
    await expect(page.locator('#card-import-destinations')).toContainText('Create set binder');
    assert.equal(await page.locator('#card-import-dialog').evaluate(dialog => dialog.scrollWidth > dialog.clientWidth + 1), false, 'Import dialog overflow');
    await page.locator('#card-import-apply').click();
    await expect(page.locator('#card-import-dialog')).toBeHidden();
    await expect(homeCards(page)).toHaveCount(2);
    await expect(page.locator('#national-workspace')).toBeHidden();
    await expect(page.locator('#binder-onboarding')).toBeHidden();

    await preview(page, '#import-cards', incoming);
    await expect(page.locator('#card-review-summary')).toContainText('0 to add · 2 already owned');
    await page.locator('#card-import-apply').click();
    await expect(page.locator('#card-import-dialog')).toBeHidden();
    await expect(homeCards(page)).toHaveCount(2);

    await transferAction(page, '#export-cards');
    await page.locator('#card-export-scope').selectOption('');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#card-export-download').click();
    const download = await downloadPromise;
    const csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /sv03\.5,MEW,151,001,Bulbasaur,reverse/);
    assert.match(csv, /base1,BS,Base Set,4,Charizard,holo\+subtype=unlimited/);
    assert.equal(csv.trim().split('\n').length, 4);
    await expect(page.locator('#card-export-status')).toHaveText('3 distinct printings · 0 entries omitted.');
    await page.locator('#card-export-format').selectOption('binderloot');
    await expect(page.locator('#card-export-binderloot-help')).toBeVisible();
    const binderLootPromise = page.waitForEvent('download');
    await page.locator('#card-export-download').click();
    const binderLoot = await readFile(await (await binderLootPromise).path(), 'utf8');
    assert.match(binderLoot, /International,Charizard,4\/102,,Base Set,,Normal Holo,English,Unspecified,1/);
    await page.locator('#card-export-format').selectOption('tcgplayer');
    await expect(page.locator('#card-export-tcgplayer-options')).toBeVisible();
    await expect(page.locator('#card-export-tcgplayer-condition')).toHaveValue('');
    await page.locator('#card-export-tcgplayer-condition').selectOption('Lightly Played');
    const tcgplayerPromise = page.waitForEvent('download');
    await page.locator('#card-export-download').click();
    const tcgplayer = await tcgplayerPromise;
    assert.equal(tcgplayer.suggestedFilename(), 'tcgplayer-mobile-collection.csv');
    const mobileCsv = await readFile(await tcgplayer.path(), 'utf8');
    assert.match(mobileCsv, /^Collection Name,Created At,ProductID,Condition,Language,Variant,Quantity\r\n/);
    assert.match(mobileCsv, /,42382,Lightly Played,English,Holofoil,1/);
    assert.match(mobileCsv, /,502552,Lightly Played,English,Reverse Holofoil,1/);
    await page.locator('#card-export-list').selectOption('missing');
    await expect(page.locator('#card-export-missing-help')).toBeVisible();
    await page.locator('#card-export-scope').selectOption({ label: '151' });
    const missingMobilePromise = page.waitForEvent('download');
    await page.locator('#card-export-download').click();
    const missingMobile = await missingMobilePromise;
    assert.equal(missingMobile.suggestedFilename(), 'missing-cards-tcgplayer.csv');
    const missingMobileCsv = await readFile(await missingMobile.path(), 'utf8');
    assert.match(missingMobileCsv, /Pokémon Binder Tracker - Missing Cards,[^,]+,502552,Lightly Played,English,Normal,1/);
    assert.doesNotMatch(missingMobileCsv, /,502552,Lightly Played,English,Reverse Holofoil,1|,42382,/);
    await expect(page.locator('#card-export-status')).toContainText('missing entries exported');
    await page.locator('#card-export-format').selectOption('portable');
    const missingPortablePromise = page.waitForEvent('download');
    await page.locator('#card-export-download').click();
    const missingPortable = await missingPortablePromise;
    assert.equal(missingPortable.suggestedFilename(), 'missing-cards-portable.csv');
    const missingPortableCsv = await readFile(await missingPortable.path(), 'utf8');
    assert.match(missingPortableCsv, /sv03\.5,MEW,151,001,Bulbasaur,normal/);
    assert.doesNotMatch(missingPortableCsv, /sv03\.5,MEW,151,001,Bulbasaur,reverse|base1,/);
    assert.equal(await page.locator('#card-export-dialog').evaluate(dialog => dialog.scrollWidth > dialog.clientWidth + 1), false, 'Export dialog overflow');
    await page.keyboard.press('Escape');

    await openBinder(page, '151');
    await page.locator('#master-view-checklist').click();
    const regular = page.locator('[data-checklist-row="001:normal"]');
    await page.getByRole('radiogroup', { name: 'Status of #001 · Bulbasaur · Regular' }).getByRole('radio', { name: 'Ordered' }).check();
    await expect(page.locator('#master-ordered')).toHaveText('1');
    await chooseFilter(page, '#master-status', 'missing');
    await expect(regular).toHaveCount(0);
    await chooseFilter(page, '#master-status', 'ordered');
    await expect(regular.getByRole('radio', { name: 'Ordered' })).toBeChecked();
    assert.equal(await page.locator('#master-checklist').evaluate(section => section.scrollWidth > section.clientWidth + 1), false, 'Checklist overflow');
    await transferAction(page, '#export-cards');
    await page.locator('#card-export-list').selectOption('ordered');
    const orderedPromise = page.waitForEvent('download');
    await page.locator('#card-export-download').click();
    const ordered = await orderedPromise;
    assert.equal(ordered.suggestedFilename(), 'ordered-cards-portable.csv');
    const orderedCsv = await readFile(await ordered.path(), 'utf8');
    assert.match(orderedCsv, /001,Bulbasaur,normal/);
    assert.doesNotMatch(orderedCsv, /001,Bulbasaur,reverse/);
    await page.keyboard.press('Escape');
    await openBinder(page, '151');
    await regular.getByRole('radio', { name: 'Have it' }).click(); // The ordered filter hides the row once it is collected.
    await expect(page.locator('#master-ordered')).toHaveText('0');
    await chooseFilter(page, '#master-status', 'owned');
    await expect(regular.getByRole('radio', { name: 'Have it' })).toBeChecked();

    await preview(page, '#import-cards', incoming, 'dex');
    await expect(page.locator('#card-review-summary')).toContainText('3 to add');
    await expect(page.locator('#card-import-destinations')).toContainText('will add the National Pokédex');
    await page.locator('#card-import-apply').click();
    await expect(page.locator('#national-workspace')).toBeVisible();
    await expect(page.locator('#owned-count')).toHaveText('3');
    await page.locator('#view-checklist').click();
    const squirtle = page.locator('#checklist-list [data-checklist-row="7"]');
    await squirtle.getByRole('radiogroup', { name: 'Status of Squirtle' }).getByRole('radio', { name: 'Ordered' }).check();
    await chooseFilter(page, '#dex-filter', 'ordered');
    await expect(page.locator('#ordered-count')).toHaveText('1');
    await expect(squirtle.getByRole('radio', { name: 'Ordered' })).toBeChecked();
    await cardLists(page);
    await page.locator('#position-list').selectOption('ordered');
    const positionPromise = page.waitForEvent('download');
    await page.locator('#export-csv').click();
    const positionCsv = await readFile(await (await positionPromise).path(), 'utf8');
    assert.match(positionCsv, /7,Squirtle,Ordered/);
    await binderAction(page, '#layout-open');
    await page.locator('#national-hide').click();
    await expect(page.locator('#national-workspace')).toBeHidden();
    await page.goto(origin + '/utilities/pokedex-binder/');
    await expect(page).toHaveURL(app);
    await expect(homeCards(page)).toHaveCount(2);
    await page.locator('#national-add').click();
    await expect(page.locator('#national-workspace')).toBeVisible();
    await expect(page.locator('#owned-count')).toHaveText('3');
    await expect(page.locator('#ordered-count')).toHaveText('1');
    await ctx.close();
    console.log(`Passed ${width}px onboarding, preview, repeat import, export, and Pokédex hide and re-enable.`);
  }

  const retryContext = await context(390), retryPage = await retryContext.newPage();
  await open(retryPage);
  for (const name of ['Original 151', 'Second 151']) {
    await newSetBinder(retryPage);
    await retryPage.locator('#master-set').fill('sv03.5');
    await retryPage.locator('#master-name').fill(name);
    await retryPage.getByRole('button', { name: 'Save binder', exact: true }).click();
    await expect(retryPage.locator('#master-editor')).toBeHidden();
  }
  await expect(retryPage.locator('#national-workspace')).toBeHidden();
  await preview(retryPage, '#import-cards', collectr);
  await expect(retryPage.locator('#card-import-apply')).toBeDisabled();
  await retryPage.locator('#card-import-destinations select').selectOption({ label: 'Second 151' });
  await retryPage.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'sets:guest') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Simulated failed save', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await retryPage.locator('#card-import-apply').click();
  const saveError = retryPage.locator('#card-import-save-error');
  await expect(saveError).toContainText('Simulated failed save');
  await expect(saveError).toBeInViewport();
  await expect(homeCards(retryPage)).toHaveCount(2);
  await retryPage.locator('#card-import-apply').click();
  await expect(retryPage.locator('#card-import-dialog')).toBeHidden();
  await goHome(retryPage);
  await expect(homeCard(retryPage, 'Original 151').locator('[data-owned-count]')).toHaveText('0');
  await expect(homeCard(retryPage, 'Second 151').locator('[data-owned-count]')).toHaveText('2');
  await expect(homeCards(retryPage)).toHaveCount(3);
  await retryContext.close();
  console.log('Passed explicit binder routing and atomic retry after an interrupted save.');

  const fixture = { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', email: 'fixture@example.test' };
  let session = null;
  const ctx = await context(1440, () => session, document => document === 'binder' ? {
    app: 'pokedex-binder', document, resourceId: fixture.id, schemaVersion: 1, revision: 1, acknowledgedSequence: 0,
    state: { schemaVersion: 1, enabled: false, settings: { rows: 4, columns: 4, leadingBlankPockets: 0, useBackSides: true }, ownedDexIds: [25] },
  } : null);
  const page = await ctx.newPage();
  await open(page);
  await preview(page, '#first-import-collectr', collectr);
  await page.getByRole('checkbox', { name: 'Trade binder' }).uncheck();
  await page.locator('#card-import-preview').click();
  await expect(page.locator('#card-review-summary')).toContainText('2 to add');
  session = fixture;
  const second = await ctx.newPage();
  await open(second);
  await second.evaluate(() => {
    const channel = new BroadcastChannel('austingarrod.accounts.session.v1');
    channel.postMessage('changed');
    channel.close();
  });
  await expect(page.locator('#card-import-dialog')).toBeHidden();
  await expect(page.locator('#card-import-file')).toHaveValue('');
  await expect(page.locator('#card-import-portfolio-options input')).toHaveCount(0);
  await expect(page.locator('#card-review-rows li')).toHaveCount(0);
  await expect(page.locator('#binder-account-onboarding')).toBeVisible();
  await expect(page.locator('#binder-onboarding')).toBeHidden();
  await page.locator('#first-connect').click();
  await expect(page.locator('#binder-migration-dialog')).toBeVisible();
  await expect(page.locator('#binder-migration-summary')).toContainText('Account: Pokédex hidden (1 collected)');
  await ctx.close();
  console.log('Passed stale-preview cancellation and existing-account onboarding without writes.');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
