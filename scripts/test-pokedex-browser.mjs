import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { binderAction, cardLists, chooseFilter, newSetBinder, openBinder } from './test-pokedex-helpers.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// LOCAL ONLY. Build first, then provide a localhost POKEDEX_TEST_DSN/admin user.
// Uses a random temporary database and private config, never the production API.
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
assert.ok(existsSync(join(dist, 'utilities/pokemon-binder/index.html')), 'Run npm run build before the browser checks.');
assert.ok(process.env.POKEDEX_TEST_DSN, 'Set POKEDEX_TEST_DSN to an isolated localhost MySQL/MariaDB DSN.');
const php = process.env.PHP_BINARY || 'php';
const phpDirectory = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const drivers = execFileSync(php, ['-r', 'echo implode(",",PDO::getAvailableDrivers());'], { encoding: 'utf8' });
const flags = drivers.split(',').includes('mysql') ? [] : process.platform === 'win32' ? ['-d', `extension_dir=${join(phpDirectory, 'ext')}`, '-d', 'extension=pdo_mysql'] : ['-d', 'extension=pdo_mysql'];
const databaseName = `pokedex_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const env = { ...process.env, POKEDEX_TEST_DATABASE: databaseName, REPORTING_DSN: '', REPORTING_ENVIRONMENT: 'pokedex-browser-test' };
const databaseCommand = action => execFileSync(php, [...flags, join(root, 'scripts/pokedex-test-database.php'), action], { env, stdio: ['ignore', 'pipe', 'pipe'] });
mkdirSync(join(root, 'tmp'), { recursive: true });
const temporary = mkdtempSync(join(root, 'tmp/pokedex-browser-'));
const output = join(root, 'output/pokedex-browser');
mkdirSync(output, { recursive: true });
const portSocket = createServer();
await new Promise((resolve, reject) => { portSocket.once('error', reject); portSocket.listen(0, '127.0.0.1', resolve); });
const port = portSocket.address().port;
await new Promise(resolve => portSocket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const app = `${origin}/utilities/pokemon-binder/`;
const config = { dsn: process.env.POKEDEX_TEST_DSN.replace(/;?dbname=[^;]*/i, '') + `;dbname=${databaseName}`, username: env.POKEDEX_TEST_USER || 'root', password: env.POKEDEX_TEST_PASSWORD || '', rateLimitDirectory: join(temporary, 'limits'), rateLimitSecret: randomBytes(32).toString('hex'), allowedOrigin: origin };
env.POKEDEX_CONFIG = join(temporary, 'config.php');
writeFileSync(env.POKEDEX_CONFIG, `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'), true, 512, JSON_THROW_ON_ERROR);`);
let server, browser, databaseCreated = false, phpOutput = '', activeScenario = 'startup';
const contexts = [], controls = new Map(), completed = [], errors = [];
const safeName = value => value.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
async function scenario(name, run) { activeScenario = name; await run(); completed.push(name); console.log(`Passed: ${name}`); }
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ...options });
  contexts.push(ctx);
  const control = { offlineApi: false };
  controls.set(ctx, control);
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (control.offlineApi && url.pathname.endsWith('/api/binder.php')) return route.abort('internetdisconnected');
      return route.continue();
    }
    if (url.hostname === 'assets.tcgdex.net') return route.abort('failed');
    // No telemetry or other third-party request leaves localhost.
    return route.fulfill({ status: 200, body: url.hostname === 'reports.garrod.house' ? '{}' : '', contentType: 'application/json' });
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__pokedexCopiedKey = value; } } });
    window.print = () => { window.__pokedexPrintCalled = true; };
  });
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return ctx;
}
async function open(ctx) {
  const page = await ctx.newPage();
  await page.goto(app);
  await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#dex-status')).not.toHaveText('Binder could not start');
  await expect(page.locator('#binder-onboarding:visible, #set-overview:visible, #national-workspace:visible')).toHaveCount(1);
  if (await page.locator('#first-dex').isVisible()) await page.locator('#first-dex').click();
  else if (await page.locator('#set-overview').isVisible()) await openBinder(page, 'National Pokédex');
  return page;
}
async function closeDialogs(page) {
  while (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
}
async function go(page, id) {
  await closeDialogs(page);
  await page.locator('#dex-search').fill(`#${String(id).padStart(4, '0')}`);
  await chooseFilter(page, '#dex-filter', 'all');
  await chooseFilter(page, '#dex-generation', 'all');
  await expect(page.locator('#results-list .dex-result')).toHaveCount(1);
  await page.locator('#results-list [data-goto]').click();
  await expect(page.locator(`#open-grid-${id}`)).toBeVisible();
  await page.locator('#dex-search').fill('');
}
async function layout(page, values) {
  await closeDialogs(page);
  await binderAction(page, '#layout-open');
  for (const field of ['columns', 'rows', 'leadingBlankPockets']) if (values[field] !== undefined) await page.locator(`#layout-form [name=${field}]`).fill(String(values[field]));
  if (values.useBackSides !== undefined) await page.locator('#layout-form [name=useBackSides]').selectOption(String(values.useBackSides));
  await page.locator('#layout-form button[type=submit]').click();
  await expect(page.locator('#layout-dialog')).not.toBeVisible();
}
try {
  databaseCommand('create'); databaseCreated = true;
  server = spawn(php, [...flags, '-d', 'display_errors=0', '-S', `127.0.0.1:${port}`, '-t', dist], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', data => { phpOutput += data.toString(); });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(app); await response.arrayBuffer(); if (response.ok) break; } catch { /* Wait for only this localhost process. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const desktop = await context();
  const page = await open(desktop);
  await page.screenshot({ path: join(output, 'initial-4x4.png'), fullPage: true });
  let backup;
  await scenario('4 by 4 boundaries and ownership survive reload', async () => {
    await expect(page.locator('#binder-grid .dex-pocket')).toHaveCount(16);
    await expect(page.locator('#open-grid-16')).toHaveAttribute('aria-label', /row 4, column 4/);
    await page.locator('#page-next').click();
    await expect(page.locator('#page-heading')).toHaveText('Page 2');
    await expect(page.locator('#sheet-label')).toHaveText('Sheet 1 · Back');
    await expect(page.locator('#open-grid-17')).toHaveAttribute('aria-label', /row 1, column 1/);
    await page.locator('#owned-grid-17').check();
    await expect(page.locator('#owned-count')).toHaveText('1');
    await page.reload();
    await expect(page.locator('#owned-count')).toHaveText('1');
    await go(page, 17);
    await expect(page.locator('#owned-grid-17')).toBeChecked();
    await expect(page.locator('#printing-list .dex-set-heading').first()).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: join(output, 'selected-pokemon.png') });
  });
  await scenario('filters keep physical pockets and name searches find locations', async () => {
    await chooseFilter(page, '#dex-filter', 'missing');
    await expect(page.locator('#page-heading')).toHaveText('Page 2');
    await expect(page.locator('#binder-grid .dex-pocket')).toHaveCount(16);
    await expect(page.locator('#open-grid-17').locator('..')).toHaveClass(/dimmed/);
    await chooseFilter(page, '#dex-filter', 'owned');
    await expect(page.locator('#open-grid-17')).toBeVisible();
    await expect(page.locator('#open-grid-18').locator('..')).toHaveClass(/dimmed/);
    await chooseFilter(page, '#dex-filter', 'all');
    await page.locator('#dex-search').fill('#0017');
    await expect(page.locator('#results-list')).toContainText('Page 2 · Row 1, column 1');
    await page.locator('#dex-search').fill('mr mime');
    await expect(page.locator('#results-list')).toContainText('Mr. Mime');
    await page.locator('#results-list [data-goto]').click();
    await expect(page.locator('#page-heading')).toHaveText('Page 8');
    await expect(page.locator('#pokemon-details h2')).toHaveText('Mr. Mime');
    await expect(page.locator('#printing-list .dex-set-heading').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#printing-list .dex-card-printing').first()).toContainText('Collector #');
    const remoteImage = page.locator('#printing-list img').first();
    if (await remoteImage.count()) await expect(remoteImage).toBeHidden();
  });
  await scenario('card reference scroll and search caret survive ownership and tab refreshes', async () => {
    await go(page, 25);
    await expect(page.locator('#pokemon-details h2')).toHaveText('Pikachu');
    await expect(page.locator('#printing-list .dex-card-printing').first()).toBeVisible({ timeout: 15000 });
    // Keep deliberately unavailable artwork from changing row heights while testing scroll restoration.
    const stableArtwork = await page.addStyleTag({ content: '#printing-list img { display:none !important; }' });
    await page.locator('#printing-list').evaluate(node => { node.scrollTop = 700; });
    await page.locator('#page-overview').evaluate(node => { node.scrollTop = 120; });
    assert.equal(await page.locator('#printing-list').evaluate(node => node.scrollTop), 700);
    await page.locator('#owned-grid-25').check();
    await expect(page.locator('#owned-count')).toHaveText('2');
    await expect.poll(() => page.locator('#printing-list').evaluate(node => node.scrollTop)).toBe(700);
    await expect.poll(() => page.locator('#page-overview').evaluate(node => node.scrollTop)).toBe(120);
    await page.locator('#owned-grid-25').uncheck();
    await expect(page.locator('#owned-count')).toHaveText('1');
    await page.locator('#printing-search').fill('Pikachu');
    await page.locator('#printing-search').evaluate(node => node.setSelectionRange(3, 5));
    await page.locator('#printing-list').evaluate(node => { node.scrollTop = 700; });
    const broadcastTab = await open(desktop);
    await broadcastTab.locator('#owned-grid-1').check();
    await expect(page.locator('#owned-count')).toHaveText('2');
    await expect.poll(() => page.locator('#printing-list').evaluate(node => node.scrollTop)).toBe(700);
    await expect.poll(() => page.locator('#page-overview').evaluate(node => node.scrollTop)).toBe(120);
    await expect(page.locator('#printing-search')).toHaveValue('Pikachu');
    assert.deepEqual(await page.locator('#printing-search').evaluate(node => [node.selectionStart, node.selectionEnd]), [3, 5]);
    await broadcastTab.locator('#owned-grid-1').uncheck();
    await expect(page.locator('#owned-count')).toHaveText('1');
    await broadcastTab.close();
    await stableArtwork.evaluate(node => node.remove());
  });
  await scenario('reserved pockets front sides and checklist preserve ownership', async () => {
    await layout(page, { leadingBlankPockets: 1, useBackSides: false });
    await go(page, 16);
    await expect(page.locator('#page-heading')).toHaveText('Page 2');
    await expect(page.locator('#sheet-label')).toHaveText('Sheet 2 · Front');
    await expect(page.locator('#open-grid-16')).toHaveAttribute('aria-label', /row 1, column 1/);
    await page.locator('#page-select').selectOption('1');
    await expect(page.locator('#binder-grid .dex-pocket-blank')).toHaveCount(1);
    await expect(page.locator('#open-grid-1')).toHaveAttribute('aria-label', /row 1, column 2/);
    await page.locator('#view-checklist').click();
    await expect(page.locator('#checklist-list .dex-checklist-row')).toHaveCount(100);
    await page.locator('#dex-search').fill('#0017');
    await expect(page.locator('#owned-list-17')).toBeChecked();
    await expect(page.locator('#checklist-list .dex-checklist-location')).toHaveAttribute('aria-label', 'Page 2 · Row 1, column 2');
    await page.locator('#checklist-list [data-goto]').click();
    await expect(page.locator('#view-binder')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#dex-search').fill('');
  });
  await scenario('backup restore exports and print contain collection without secrets', async () => {
    await binderAction(page, '#sync-open');
    const exported = page.waitForEvent('download');
    await page.locator('#export-json').click();
    backup = JSON.parse(readFileSync(await (await exported).path(), 'utf8'));
    assert.deepEqual(backup.state.ownedDexIds, [17]);
    assert.ok(!JSON.stringify(backup).includes('pdx_'));
    await closeDialogs(page);
    await go(page, 1); await page.locator('#owned-grid-1').check();
    await expect(page.locator('#owned-count')).toHaveText('2');
    await binderAction(page, '#sync-open');
    await page.locator('#import-json').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await expect(page.locator('#confirm-cancel')).toBeFocused();
    await page.locator('#confirm-accept').click();
    await expect(page.locator('#owned-count')).toHaveText('1');
    await closeDialogs(page);
    await cardLists(page);
    const csvDownload = page.waitForEvent('download'); await page.locator('#export-csv').click();
    const csv = readFileSync(await (await csvDownload).path(), 'utf8');
    assert.match(csv, /1,Bulbasaur,Missing,1,1,front,2,1,2/);
    assert.ok(!/^17,/m.test(csv));
    await page.locator('#print-missing').click();
    assert.equal(await page.evaluate(() => window.__pokedexPrintCalled), true);
    await expect(page.locator('#print-content tbody tr')).toHaveCount(1024);
  });
  await scenario('dialog keyboard focus stays inside and Escape returns focus', async () => {
    await closeDialogs(page);
    await binderAction(page, '#layout-open');
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab');
      // Native dialog focus may enter browser chrome (document.activeElement=body),
      // but it must never land on an underlying page control.
      assert.equal(await page.evaluate(() => document.activeElement === document.body || document.querySelector('#layout-dialog').contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#layout-dialog')).not.toBeVisible();
    // Binder settings opens from the app bar menu, so focus returns to the menu button.
    await expect(page.locator('#binder-menu > summary')).toBeFocused();
  });
  const sibling = await open(desktop);
  await scenario('same device tabs serialize independent checkbox edits', async () => {
    await go(page, 3); await go(sibling, 4);
    await Promise.all([page.locator('#owned-grid-3').check(), sibling.locator('#owned-grid-4').check()]);
    await expect(page.locator('#owned-count')).toHaveText('3');
    await expect(sibling.locator('#owned-count')).toHaveText('3');
    await sibling.reload(); await expect(sibling.locator('#owned-count')).toHaveText('3');
  });
  async function exerciseSets(page) {
    const save = async () => {
      await page.locator('#master-form button.dex-primary').click();
      await expect(page.locator('#master-editor')).not.toBeVisible();
    };
    const slot = key => page.locator(`[data-key="${key}"]`);
    for (const name of ['151 Master', '151 Trade']) {
      await newSetBinder(page);
      await page.locator('#master-set').fill('sv03.5');
      await page.locator('#master-name').fill(name);
      await save();
      await expect(page.locator('#master-title')).toContainText(name);
      if (name === '151 Master') await slot('001:reverse').check();
    }
    await expect(slot('001:reverse')).not.toBeChecked();
    await openBinder(page, '151 Master');
    await expect(slot('001:reverse')).toBeChecked();

    await binderAction(page, '#master-settings');
    await page.locator('#master-goal').selectOption('numbers');
    await save();
    await expect(slot('001:*')).toBeChecked();
    await slot('002:*').check();
    await binderAction(page, '#master-settings');
    await page.locator('#master-goal').selectOption('variants');
    await page.locator('#master-order').selectOption('sections');
    await page.locator('#master-fillers').check();
    await expect(page.locator('#master-filler-through')).toHaveValue('165');
    await page.locator('#master-specialty-section > summary').click();
    const specialty = page.locator('#master-specialties details').filter({
      has: page.locator('input[value="001:normal+stamp=set-logo"]'),
    });
    await specialty.locator('summary').click();
    await specialty.locator('input[value="001:normal+stamp=set-logo"]').check();
    await save();
    await expect(page.locator('.master-filler').first()).toContainText('Filler after #003');
    await expect(page.locator('.master-filler input')).toHaveCount(0);
    await page.locator('#master-workspace').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `master-set-${page.viewportSize().width}.png`) });
    await page.locator('#master-view-checklist').click();
    await page.locator('#master-workspace').getByLabel('Sort checklist').selectOption('collector');
    await expect(slot('001:reverse')).toBeChecked();
    await expect(slot('001:normal+stamp=set-logo')).not.toBeChecked();
    await expect(slot('004:normal+stamp=set-logo')).toHaveCount(0);
    await expect(slot('002:normal')).not.toBeChecked();

    await binderAction(page, '#master-add-extra');
    await page.locator('#master-extra-name').fill('Shop promo');
    await page.locator('#master-extra-form button').last().click();
    await expect(page.locator('#master-optional')).toHaveText('0 / 1');
    await binderAction(page, '#master-scan');
    await page.locator('#scan-recovery-search').click();
    await page.locator('#master-scan-search').fill('001');
    await page.locator('[data-finish="001:normal"]').click();
    await expect(slot('001:normal')).toBeChecked();
    await page.locator('#scan-close').click();
    await cardLists(page);
    await page.locator('#print-missing').click();
    await expect(page.locator('#print-content')).toContainText('Shop promo');
    const exported = page.waitForEvent('download');
    await page.locator('#export-csv').click();
    const csv = readFileSync(await (await exported).path(), 'utf8');
    assert.ok(csv.includes('Shop promo') && !csv.includes('"001","Bulbasaur","Regular"'));
    await expect(page.locator('#print-content tbody tr')).toHaveCount(csv.trimEnd().split('\r\n').length - 1);
    await page.locator('#export-scope').selectOption('all');
    const combined = page.waitForEvent('download');
    await page.locator('#export-csv').click();
    const file = await combined;
    assert.equal(file.suggestedFilename(), 'all-binders-missing.csv');
    const allCsv = readFileSync(await file.path(), 'utf8');
    assert.ok(allCsv.includes('"National Pokédex",""'));
    assert.ok(allCsv.includes('"151 Trade","151","001","Bulbasaur","Regular"'));
    assert.ok(!allCsv.includes('"151 Master","151","001","Bulbasaur","Regular"'));
    assert.ok(allCsv.includes('"Shop promo","Custom extra","Optional"'));
    assert.ok(!allCsv.includes('Filler after'));
    await page.locator('#print-missing').click();
    const printed = page.locator('#print-content');
    await expect(printed.locator('h1')).toContainText('All binders');
    // One printed section per binder: the National Pokédex and both set binders.
    await expect(printed.locator('section')).toHaveCount(3);
    await expect(printed.locator('tbody tr')).toHaveCount(allCsv.trimEnd().split('\r\n').length - 1);
    await expect(printed.locator('section').filter({hasText:'151 Master'})).toContainText('Shop promo');
    await page.emulateMedia({ media: 'print' });
    await expect(printed.locator('table').first()).toBeVisible();
    await expect(page.locator('#set-overview')).not.toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await cardLists(page);
    await page.locator('#export-scope').selectOption('current');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await binderAction(page, '#sync-open');
    const download = page.waitForEvent('download');
    await page.locator('#export-json').click();
    const saved = readFileSync(await (await download).path());
    await closeDialogs(page);
    await slot('001:reverse').uncheck();
    await expect(slot('001:reverse')).not.toBeChecked();
    await binderAction(page, '#sync-open');
    await page.locator('#import-json').setInputFiles({ name: 'binders.json', mimeType: 'application/json', buffer: saved });
    await page.locator('#confirm-accept').click();
    await closeDialogs(page);
    await openBinder(page, '151 Master');
    await page.locator('#master-view-checklist').click();
    await page.locator('#master-search').fill('#001');
    await expect(slot('001:reverse')).toBeChecked();
    await expect(page.locator('#master-optional')).toHaveText('0 / 1');
    await openBinder(page, 'National Pokédex');
    await page.locator('#view-binder').click();
  }
  async function checkPhysicalPages(page, code, ex, expectedGoal) {
    const ctrl = name => page.locator('#master-' + name);
    const grid = ctrl('binder-grid');
    await newSetBinder(page); await ctrl('set').fill(code); await ctrl('name').fill(code);
    await ctrl('fillers').check();
    await ctrl('form').locator('button.dex-primary').click();
    await expect(ctrl('editor')).not.toBeVisible();
    const firstPage = ctrl('page-overview').locator('[data-page="1"]');
    const before = await firstPage.getAttribute('aria-label');
    const match = before.match(/0 of (\d+)/);
    assert.ok(match);
    await expect(grid.locator('.master-filler').first()).toContainText('#' + ex);
    await expect(grid.locator('[data-set-open="'+ex+':holo"] img')).toHaveAttribute('src',/assets\.tcgdex\.net/);
    await grid.locator('[data-key="'+ex+':holo"]').check();
    await expect(firstPage).toHaveAttribute('aria-label','Page 1, 1 of '+match[1]+' collected');
    await expect(ctrl('progress')).toHaveText('1 / '+expectedGoal);
    const reviewedNumber = code === 'PBL' ? '035' : '013';
    await ctrl('search').fill(reviewedNumber);
    const results = ctrl('results');
    await expect(results.locator('[data-set-jump]')).toHaveCount(2);
    await expect(results.locator('[data-set-jump="'+reviewedNumber+':normal"]')).toHaveCount(0);
    await results.locator('[data-set-jump="'+reviewedNumber+':holo"]').click();
    await expect(grid.locator('[data-set-open="'+reviewedNumber+':reverse"]')).toBeVisible();
    await firstPage.click();
    await ctrl('search').fill(ex);
    // Search results replace the page grid while a search is active.
    await expect(ctrl('binder-view')).toBeHidden();
    await ctrl('results').locator('[data-set-jump="'+ex+':holo"]').click();
    await expect(ctrl('pokemon-details')).toContainText('Holo');
    await ctrl('search').fill('');
    await ctrl('page-next').click(); await expect(ctrl('page-heading')).toHaveText('Page 2');
    await firstPage.click(); await expect(ctrl('page-heading')).toHaveText('Page 1');
    await binderAction(page, '#master-settings'); await ctrl('columns').fill('1'); await ctrl('rows').fill('1'); await ctrl('blanks').fill('1');
    await ctrl('form').locator('button.dex-primary').click();
    await expect(grid).toContainText('Reserved');
    await expect(ctrl('page-progress')).toHaveText('0 of 0 collected on this page');
    await binderAction(page, '#master-add-extra'); await ctrl('extra-name').fill('Optional promo'); await ctrl('extra-form').locator('button').last().click();
    const last = ctrl('page-overview').locator('button').last();
    await last.click(); await expect(grid).toContainText('Optional promo');
    await expect(ctrl('page-progress')).toContainText('0 of 0 collected on this page · Optional extras 0/1');
    await grid.locator('input').check(); await expect(ctrl('page-progress')).toContainText('Optional extras 1/1');
    await expect(ctrl('progress')).toHaveText('1 / '+expectedGoal);
    await openBinder(page, 'National Pokédex');
  }
  await scenario('Pitch Black page progress and physical pockets',()=>checkPhysicalPages(page,'PBL','004',194));
  await scenario('independent named master sets, placement, scanner confirmation and exports',()=>exerciseSets(page));
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await scenario('mobile details and dense layouts avoid horizontal overflow', async () => {
    const mobile = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await open(mobile);
    await checkPhysicalPages(phone,"CRI","003",198);
    await exerciseSets(phone);
    await go(phone, 17);
    await phone.locator('#open-grid-17').click();
    await expect(phone.locator('#pokemon-details h2')).toHaveText('Pidgeotto');
    await expect(phone.locator('#pokemon-details')).toBeInViewport();
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await phone.evaluate(() => document.activeElement?.blur());
    await phone.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
    await layout(phone, { columns: 6, rows: 6 });
    await phone.setViewportSize({ width: 320, height: 750 });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await expect(phone.locator('#binder-grid .dex-pocket')).toHaveCount(36);
    await binderAction(phone, '#sync-open');
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await phone.keyboard.press('Escape');
  });
  await scenario('portfolio routes and mobile menu remain usable', async () => {
    const smokeContext = await context();
    const smoke = await smokeContext.newPage();
    for (const route of ['/', '/about/', '/projects/', '/utilities/', '/utilities/radius-map/', '/contact/', '/404.html']) {
      await smoke.goto(origin + route);
      await expect(smoke.locator('main')).toHaveCount(1);
      assert.equal(await smoke.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Desktop overflow at ${route}`);
      if (route === '/utilities/') await expect(smoke.locator('a[href="/utilities/pokemon-binder/"]').first()).toBeVisible();
    }
    await smoke.setViewportSize({ width: 390, height: 844 });
    await smoke.goto(origin + '/');
    await smoke.locator('.menu-toggle').click();
    await expect(smoke.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(smoke.locator('#mobile-nav')).toBeVisible();
    assert.equal(await smoke.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await smoke.keyboard.press('Escape');
    await expect(smoke.locator('#mobile-nav')).not.toBeVisible();
    await expect(smoke.locator('.menu-toggle')).toBeFocused();
  });
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  writeFileSync(join(output, 'results.json'), JSON.stringify({ passed: completed, externalRequests: 'blocked or mocked; card artwork deliberately unavailable', database: 'isolated localhost MariaDB/MySQL' }, null, 2));
  for (const ctx of contexts) await ctx.tracing.stop();
  console.log(`Pokémon Binder Tracker passed ${completed.length} real PHP/MySQL browser scenarios. Screenshots: output/pokedex-browser/.`);
} catch (error) {
  for (const [index, ctx] of contexts.entries()) {
    for (const [pageIndex, page] of ctx.pages().entries()) {
      // Avoid collecting visible private-key dialogs in test artifacts.
      await page.locator('#sync-key-display').evaluateAll(nodes => nodes.forEach(node => { node.value = ''; node.hidden = true; })).catch(() => undefined);
      await page.screenshot({ path: join(output, `failure-${safeName(activeScenario)}-${index}-${pageIndex}.png`), fullPage: true }).catch(() => undefined);
    }
    await ctx.tracing.stop({ path: join(output, `failure-${safeName(activeScenario)}-${index}.zip`) }).catch(() => undefined);
  }
  writeFileSync(join(output, 'failure.json'), JSON.stringify({ scenario: activeScenario, completed, message: error instanceof Error ? error.message : 'Browser check failed' }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server) { server.kill(); await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve)); }
  if (databaseCreated) databaseCommand('drop');
  assert.ok(!phpOutput.includes('pdx_'), 'The PHP access log exposed a private key.');
}
