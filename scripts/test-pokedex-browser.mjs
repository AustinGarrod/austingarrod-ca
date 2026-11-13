import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
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
assert.ok(existsSync(join(dist, 'utilities/pokedex-binder/index.html')), 'Run npm run build before the browser checks.');
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
const app = `${origin}/utilities/pokedex-binder/`;
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
  return page;
}
async function closeDialogs(page) {
  while (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
}
async function go(page, id) {
  await closeDialogs(page);
  await page.locator('#dex-search').fill(`#${String(id).padStart(4, '0')}`);
  await page.locator('#dex-filter').selectOption('all');
  await page.locator('#dex-generation').selectOption('all');
  await expect(page.locator('#results-list .dex-result')).toHaveCount(1);
  await page.locator('#results-list [data-goto]').click();
  await expect(page.locator(`#open-grid-${id}`)).toBeVisible();
  await page.locator('#dex-search').fill('');
}
async function sync(page) {
  await closeDialogs(page);
  await page.locator('#sync-open').click();
  await page.locator('#sync-now').click();
  await expect(page.locator('#dex-status')).toHaveText('Synced · Saved on this device', { timeout: 15000 });
  await closeDialogs(page);
}
async function connect(page, key) {
  await page.locator('#sync-open').click();
  await page.locator('#sync-key-input').fill(key);
  await page.locator('#connect-form button[type=submit]').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#sync-connected')).toBeVisible();
  await closeDialogs(page);
}
async function layout(page, values) {
  await closeDialogs(page);
  await page.locator('#layout-open').click();
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
  let key, backup;
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
    await page.locator('#dex-filter').selectOption('missing');
    await expect(page.locator('#page-heading')).toHaveText('Page 2');
    await expect(page.locator('#binder-grid .dex-pocket')).toHaveCount(16);
    await expect(page.locator('#open-grid-17').locator('..')).toHaveClass(/dimmed/);
    await page.locator('#dex-filter').selectOption('owned');
    await expect(page.locator('#open-grid-17')).toBeVisible();
    await expect(page.locator('#open-grid-18').locator('..')).toHaveClass(/dimmed/);
    await page.locator('#dex-filter').selectOption('all');
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
    await expect(page.locator('#checklist-list')).toContainText('Page 2 · Row 1, column 2');
    await page.locator('#checklist-list [data-goto]').click();
    await expect(page.locator('#view-binder')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#dex-search').fill('');
  });
  await scenario('backup restore exports and print contain collection without secrets', async () => {
    await page.locator('#sync-open').click();
    const exported = page.waitForEvent('download');
    await page.locator('#export-json').click();
    backup = JSON.parse(readFileSync(await (await exported).path(), 'utf8'));
    assert.deepEqual(backup.state.ownedDexIds, [17]);
    assert.ok(!JSON.stringify(backup).includes('pdx_'));
    await closeDialogs(page);
    await go(page, 1); await page.locator('#owned-grid-1').check();
    await expect(page.locator('#owned-count')).toHaveText('2');
    await page.locator('#sync-open').click();
    await page.locator('#import-json').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await expect(page.locator('#confirm-cancel')).toBeFocused();
    await page.locator('#confirm-accept').click();
    await expect(page.locator('#owned-count')).toHaveText('1');
    await closeDialogs(page);
    const csvDownload = page.waitForEvent('download'); await page.locator('#export-csv').click();
    const csv = readFileSync(await (await csvDownload).path(), 'utf8');
    assert.match(csv, /1,Bulbasaur,Missing,1,1,front,2,1,2/);
    assert.ok(!/^17,/m.test(csv));
    await page.locator('#print-missing').click();
    assert.equal(await page.evaluate(() => window.__pokedexPrintCalled), true);
    await expect(page.locator('#print-content tbody tr')).toHaveCount(1024);
  });
  await scenario('dialog keyboard focus stays inside and Escape returns focus', async () => {
    await page.locator('#layout-open').click();
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab');
      // Native dialog focus may enter browser chrome (document.activeElement=body),
      // but it must never land on an underlying page control.
      assert.equal(await page.evaluate(() => document.activeElement === document.body || document.querySelector('#layout-dialog').contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#layout-dialog')).not.toBeVisible();
    await expect(page.locator('#layout-open')).toBeFocused();
  });
  await scenario('private key creates copies and connects a second device', async () => {
    await page.locator('#sync-open').click(); await page.locator('#create-sync').click();
    await expect(page.locator('#dex-status')).toHaveText('Synced · Saved on this device', { timeout: 15000 });
    key = await page.locator('#sync-key-display').inputValue();
    assert.match(key, /^pdx_[A-Za-z0-9_-]{43}$/);
    await page.locator('#copy-key').click();
    assert.equal(await page.evaluate(() => window.__pokedexCopiedKey), key);
    assert.equal(new URL(page.url()).search, ''); assert.equal(new URL(page.url()).hash, '');
    await closeDialogs(page);
  });
  const second = await context(); const other = await open(second);
  await connect(other, key);
  await expect(other.locator('#owned-count')).toHaveText('1');
  await scenario('independent device edits merge after a transient network failure', async () => {
    controls.get(desktop).offlineApi = true;
    await go(page, 1); await page.locator('#owned-grid-1').check();
    await expect(page.locator('#owned-count')).toHaveText('2');
    await go(other, 2); await other.locator('#owned-grid-2').check(); await sync(other);
    controls.get(desktop).offlineApi = false;
    await sync(page); await sync(other);
    await expect(page.locator('#owned-count')).toHaveText('3');
    await expect(other.locator('#owned-count')).toHaveText('3');
  });
  const sibling = await open(desktop);
  await scenario('same device tabs serialize independent checkbox edits', async () => {
    await go(page, 3); await go(sibling, 4);
    await Promise.all([page.locator('#owned-grid-3').check(), sibling.locator('#owned-grid-4').check()]);
    await expect(page.locator('#owned-count')).toHaveText('5');
    await expect(sibling.locator('#owned-count')).toHaveText('5');
    await sync(page); await sync(other);
    await expect(other.locator('#owned-count')).toHaveText('5');
  });
  await scenario('offline edits survive a page reload and resume synchronization', async () => {
    controls.get(desktop).offlineApi = true;
    await go(page, 5); await page.locator('#owned-grid-5').check();
    await expect(page.locator('#owned-count')).toHaveText('6');
    await page.reload(); await expect(page.locator('#owned-count')).toHaveText('6');
    controls.get(desktop).offlineApi = false;
    await sync(page); await sync(other);
    await expect(other.locator('#owned-count')).toHaveText('6');
  });
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await scenario('mobile details and dense layouts avoid horizontal overflow', async () => {
    const mobile = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await open(mobile);
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
    await phone.locator('#sync-open').click();
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
      if (route === '/utilities/') await expect(smoke.locator('a[href="/utilities/pokedex-binder/"]').first()).toBeVisible();
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
  console.log(`Pokédex Binder passed ${completed.length} real PHP/MySQL browser scenarios. Screenshots: output/pokedex-browser/.`);
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
