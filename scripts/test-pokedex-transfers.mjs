import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.POKEDEX_TRANSFER_ORIGIN || 'http://127.0.0.1:4321';
const app = origin + '/utilities/pokedex-binder/';
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const errors = [];
const incoming = 'Set,Collector number,Name,Finish,Quantity\n151,001,Bulbasaur,Reverse Holo,4\nBase Set,4,Charizard,Normal Holo,1\n151,002,Ivysaur,,1\nMissing Set,001,Unknown,,1\n';

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
  await page.locator(trigger).click();
  await page.locator('#card-import-target').selectOption(target);
  await page.locator('#card-import-file').setInputFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await page.locator('#card-import-preview').click();
  await expect(page.locator('#card-import-review')).toBeVisible();
}

try {
  for (const width of [390, 1440]) {
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
    await expect(page.locator('#master-switch option')).toHaveCount(2);
    await expect(page.locator('#national-workspace')).toBeHidden();
    await expect(page.locator('#binder-onboarding')).toBeHidden();

    await preview(page, '#import-cards', incoming);
    await expect(page.locator('#card-review-summary')).toContainText('0 to add · 2 already owned');
    await page.locator('#card-import-apply').click();
    await expect(page.locator('#card-import-dialog')).toBeHidden();
    await expect(page.locator('#master-switch option')).toHaveCount(2);

    await page.locator('#export-cards').click();
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
    await page.keyboard.press('Escape');

    await preview(page, '#import-cards', incoming, 'dex');
    await expect(page.locator('#card-review-summary')).toContainText('3 to add');
    await expect(page.locator('#card-import-destinations')).toContainText('will add the National Pokédex');
    await page.locator('#card-import-apply').click();
    await expect(page.locator('#national-workspace')).toBeVisible();
    await expect(page.locator('#owned-count')).toHaveText('3');
    await page.locator('#layout-open').click();
    await page.locator('#national-hide').click();
    await expect(page.locator('#national-workspace')).toBeHidden();
    await page.reload();
    await expect(page.locator('#master-switch option')).toHaveCount(2);
    await page.locator('#national-add').click();
    await expect(page.locator('#national-workspace')).toBeVisible();
    await expect(page.locator('#owned-count')).toHaveText('3');
    await ctx.close();
    console.log(`Passed ${width}px onboarding, preview, repeat import, export, and Pokédex hide and re-enable.`);
  }

  const retryContext = await context(1440), retryPage = await retryContext.newPage();
  await open(retryPage);
  for (const [index, name] of ['Original 151', 'Second 151'].entries()) {
    await retryPage.locator(index ? '#master-new' : '#first-set').click();
    await retryPage.locator('#master-set').fill('sv03.5');
    await retryPage.locator('#master-name').fill(name);
    await retryPage.getByRole('button', { name: 'Save binder', exact: true }).click();
    await expect(retryPage.locator('#master-editor')).toBeHidden();
  }
  await expect(retryPage.locator('#national-workspace')).toBeHidden();
  await preview(retryPage, '#import-cards', 'Set,Number,Card,Finish\n151,001,Bulbasaur,Reverse Holo\nBase Set,4,Charizard,Normal Holo\n');
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
  await expect(retryPage.locator('#card-import-error')).toContainText('Simulated failed save');
  await expect(retryPage.locator('#master-switch option')).toHaveCount(2);
  await retryPage.locator('#card-import-apply').click();
  await expect(retryPage.locator('#card-import-dialog')).toBeHidden();
  await expect(retryPage.locator('#master-switch option').filter({ hasText: 'Original 151' })).toContainText('0/');
  await expect(retryPage.locator('#master-switch option').filter({ hasText: 'Second 151' })).toContainText('1/');
  await expect(retryPage.locator('#master-switch option')).toHaveCount(3);
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
  await preview(page, '#first-import', incoming);
  session = fixture;
  const second = await ctx.newPage();
  await open(second);
  await second.evaluate(() => {
    const channel = new BroadcastChannel('austingarrod.accounts.session.v1');
    channel.postMessage('changed');
    channel.close();
  });
  await expect(page.locator('#card-import-dialog')).toBeHidden();
  await expect(page.locator('#binder-account-onboarding')).toBeVisible();
  await expect(page.locator('#binder-onboarding')).toBeHidden();
  await page.locator('#first-connect').click();
  await expect(page.locator('#binder-migration-dialog')).toBeVisible();
  await expect(page.locator('#binder-migration-summary')).toContainText('Account: Pokédex hidden (1 collected)');
  await ctx.close();
  console.log('Passed stale-preview cancellation and existing-account onboarding without writes.');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
