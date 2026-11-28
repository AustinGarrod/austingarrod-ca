import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { binderAction as pokedexAction, chooseFilter, homeCard, homeCards, newSetBinder, openBinder as openPokedexBinder, openMenu, openSettings, returnToBinders, transferAction } from './test-pokedex-helpers.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// LOCAL ONLY: compiled applications, production PHP handlers, actual email-code
// verification through a loopback SMTP sink, and a disposable MySQL database.
// The Radius Map retry scenario drops a response after the real server commits it.
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
for (const path of ['account/index.html', 'api/v1/auth.php', 'utilities/pokedex-binder/index.html', 'utilities/idle-slayer-companion/index.html', 'utilities/radius-map/sw.js']) {
  assert.ok(existsSync(join(dist, path)), `Build the complete distribution first: missing ${path}`);
}
assert.ok(process.env.ACCOUNTS_TEST_DSN, 'Set ACCOUNTS_TEST_DSN to an isolated localhost MySQL DSN.');
const php = process.env.PHP_BINARY || 'php';
const phpDir = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const flags = process.platform === 'win32' ? ['-d', `extension_dir=${join(phpDir, 'ext')}`] : [];
const extensions = execFileSync(php, ['-r', 'echo implode(",",get_loaded_extensions());'], { encoding: 'utf8' }).split(',');
for (const name of ['pdo_mysql', 'openssl', 'curl', 'mbstring']) if (!extensions.includes(name)) flags.push('-d', `extension=${name}`);
const database = `accounts_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
mkdirSync(join(root, 'tmp'), { recursive: true });
const temporary = mkdtempSync(join(root, 'tmp/accounts-browser-'));
const output = join(root, 'output/accounts-browser');
mkdirSync(output, { recursive: true });
const env = { ...process.env, ACCOUNTS_TEST_DATABASE: database, REPORTING_DSN: '', REPORTING_ENVIRONMENT: 'accounts-browser-test' };
const databaseCommand = (action, fixture = {}) => execFileSync(php, [...flags, join(root, 'tests/accounts/database.php'), action], { env: { ...env, ...fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
const messages = [];
const smtp = createServer(socket => {
  socket.setEncoding('utf8'); socket.write('220 localhost browser SMTP\r\n');
  let buffer = '', inData = false, message = '';
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const boundary = buffer.indexOf('\r\n'), line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      if (inData) {
        if (line === '.') { messages.push({ text: message, receivedAt: Date.now() }); message = ''; inData = false; socket.write('250 queued\r\n'); }
        else message += line + '\n';
      } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 localhost\r\n');
      else if (/^DATA/i.test(line)) { inData = true; socket.write('354 send message\r\n'); }
      else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const privateConfig = {
  enabled: true, migrationEnabled: true,
  dsn: process.env.ACCOUNTS_TEST_DSN.replace(/;?dbname=[^;]*/i, '') + `;dbname=${database}`,
  username: process.env.ACCOUNTS_TEST_USER || 'root', password: process.env.ACCOUNTS_TEST_PASSWORD || '',
  secret: randomBytes(32).toString('hex'), allowedOrigin: origin,
  smtp: { host: '127.0.0.1', port: smtp.address().port, encryption: '', username: '', password: '', from: 'accounts@example.test' },
  google: { clientId: '', clientSecret: '' },
};
env.ACCOUNTS_CONFIG = join(temporary, 'accounts.php');
writeFileSync(env.ACCOUNTS_CONFIG, `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(privateConfig)).toString('base64')}'), true, 512, JSON_THROW_ON_ERROR);\n`);
env.POKEDEX_CONFIG = join(temporary, 'binder.php');
writeFileSync(env.POKEDEX_CONFIG, `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify({ ...privateConfig, rateLimitDirectory: join(temporary, 'limits'), rateLimitSecret: privateConfig.secret })).toString('base64')}'), true);\n`);
const slayerKeys = ['idle-slayer-companion.progress.v1', 'idle-slayer-companion.workspace.v1', 'idle-slayer-ascension-map.checkpoints.v1', 'idle-slayer-ascension-map.comparison.v1', 'idle-slayer-ascension-map.profile.v1', 'idle-slayer-ascension-map.goals.v1'];
function guestSeed(tag) {
  const profile = { version: 1, catalogRevision: 'browser-fixture', epoch: 2, purchases: { [`unknown-${tag}`]: { epoch: 2, active: true } }, milestones: {}, showSpoilers: false };
  const modules = Object.fromEntries(['achievement', 'craft', 'material', 'quest', 'village', 'enemy', 'divinity'].map(name => [name, { tracked: false, records: {} }]));
  modules.material.records[`unknown-${tag}`] = { count: tag === 'desktop' ? '12345678901234567890' : '98765432109876543210', discovered: false };
  return {
    [slayerKeys[0]]: JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: { format: 'idle-slayer-companion-progress', version: 1, catalogRevision: 'browser-fixture', ascension: profile, modules } }),
    [slayerKeys[1]]: JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, legacyBaseline: null, workspace: { format: 'idle-slayer-companion-workspace', version: 1, goals: [{ ref: { system: 'material', id: `unknown-${tag}` }, mode: 'complete' }], recipePlans: { [`unknown-${tag}`]: '3' } } }),
    [slayerKeys[2]]: JSON.stringify({ kind: 'progress-checkpoints', version: 1, entries: [{ id: `fixture-${tag}`, name: `${tag} checkpoint`, capturedRevision: 'browser-fixture', profile }] }),
    [slayerKeys[3]]: JSON.stringify({ kind: 'upgrade-comparison', version: 1, ids: [`unknown-${tag}`] }),
  };
}
let browser, server, created = false, phpOutput = '', active = 'startup';
const contexts = [], completed = [], pageErrors = [], remoteRequests = [];
async function scenario(name, run) { active = name; await run(); completed.push(name); console.log(`Passed: ${name}`); }
async function makeContext(tag, viewport, serviceWorkers = 'block') {
  const context = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers }); contexts.push(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    let pageUrl = ''; try { pageUrl = route.request().frame().url(); } catch { /* No uncontrolled workers are permitted. */ }
    remoteRequests.push({ page: pageUrl, origin: url.origin, path: url.pathname });
    return route.abort();
  });
  await context.addInitScript(({ seed, origin }) => {
    if (location.origin !== origin || localStorage.getItem('accounts-browser-fixture-initialized')) return;
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled');
    localStorage.setItem('umami.disabled', '1');
    localStorage.setItem('accounts-browser-fixture-initialized', '1');
  }, { seed: guestSeed(tag), origin });
  context.on('page', page => page.on('pageerror', error => pageErrors.push({ scenario: active, message: error.message })));
  return context;
}
async function session(context) { const response = await context.request.get(origin + '/api/v1/auth.php?action=session'); assert.equal(response.status(), 200); return response.json(); }
async function remote(context, app, document) {
  const auth = await session(context); assert.ok(auth.user);
  const response = await context.request.get(`${origin}/api/v1/sync.php?${new URLSearchParams({ action: 'read', app, document, clientId: randomUUID() })}`, { headers: { 'X-Account-ID': auth.user.id } });
  assert.equal(response.status(), 200); return (await response.json()).document;
}
async function login(page, email, waitForCooldown = false) {
  if (waitForCooldown) {
    const previous = [...messages].reverse().find(item => item.text.includes(email));
    while (previous && Date.now() < previous.receivedAt + 61_000) {
      const delay = Math.min(10_000, previous.receivedAt + 61_000 - Date.now());
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  await page.goto(origin + '/account/');
  await expect(page.locator('#account-signed-out')).toBeVisible();
  await expect(page.locator('#account-status')).toHaveText('Choose how to sign in.');
  await page.locator('#account-email').fill(email);
  const before = messages.length;
  await page.locator('#account-email-submit').click();
  await expect(page.locator('#account-code-form')).toBeVisible();
  await expect.poll(() => messages.length).toBeGreaterThan(before);
  const message = messages.at(-1); assert.ok(message.text.includes(email));
  const code = message.text.match(/code is:\s*(\d{6})/)[1];
  await page.locator('#account-code').fill(code);
  await page.locator('#account-code-form button[type=submit]').click();
  await expect(page.locator('#account-signed-in')).toBeVisible();
  await expect(page.locator('#account-identity')).toHaveText(email);
  assert.equal(await page.locator('#account-code').inputValue(), '');
  const cookies = await page.context().cookies(origin);
  const cookie = cookies.find(item => item.name === '__Host-ag-session');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax'); assert.equal(cookie.path, '/'); assert.equal(cookie.domain, '127.0.0.1');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Account page horizontal overflow');
}
async function openBinder(page) {
  await page.goto(origin + '/utilities/pokemon-binder/');
  await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
}
async function adoptBinder(page, chooseAccount) {
  await openSettings(page);
  await expect(page.locator('#binder-account-review')).toBeVisible();
  await page.locator('#binder-account-review').click();
  await expect(page.locator('#binder-migration-dialog')).toBeVisible();
  await page.locator('#binder-migration-layout').selectOption(chooseAccount ? 'account' : 'device');
  if (chooseAccount) await page.locator('#binder-migration-collection').selectOption('account');
  await page.locator('#binder-migration-form button[type=submit]').click();
  await expect(page.locator('#binder-migration-dialog')).not.toBeVisible();
  await returnToBinders(page);
  await expect(page.locator('#dex-status')).toContainText('Synced', { timeout: 15_000 });
}
async function openSlayer(page) {
  await page.goto(origin + '/utilities/idle-slayer-companion/');
  await expect(page.getByRole('button', { name: 'Data', exact: true })).toBeVisible({ timeout: 20_000 });
  // Session discovery can replace the cached offline account workspace. Wait
  // for that initial reconciliation before interacting with its new controls.
  await page.waitForLoadState('networkidle');
  await openSlayerAccountControls(page);
}
async function openSlayerAccountControls(page) {
  const data = page.getByRole('dialog', { name: 'Data & backup', exact: true });
  if (!await data.isVisible()) await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: /^Account & sync/ }).click();
  await expect(page.getByRole('dialog', { name: 'Account & sync', exact: true })).toBeVisible();
}
async function adoptSlayer(page, useAccount) {
  const dialog = page.getByRole('dialog', { name: 'Account & sync', exact: true });
  await expect(dialog.getByRole('button', { name: 'Review and connect saved data', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Review and connect saved data', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Review first account connection' })).toBeVisible();
  for (const name of ['progress', 'intentions', 'checkpoints', 'comparison']) {
    const options = dialog.locator(`input[name="connect-${name}"]`);
    await options.nth(useAccount ? 1 : 0).check();
  }
  await dialog.getByRole('button', { name: 'Connect and verify all saved data', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('idle-slayer-companion.accounts.active.v1'))).not.toBe(null);
  // Activating the account remounts the workspace; reopen its controls if that
  // remount closed the previous native dialog.
  if (!await dialog.isVisible()) await openSlayerAccountControls(page);
  await expect(dialog.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText(/Connected and verified|Account changes synced/);
}
async function originals(page) { return page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), slayerKeys); }

const radiusPath = '/utilities/radius-map/';
const retiredRadiusKey = 'austingarrod.utilities.radius-map.v1';
const retiredRadiusSave = JSON.stringify({
  version: 1, measurements: [{
    id: 'retired', name: 'Retired local measurement', locationLabel: 'Old centre', center: { lat: 43.65, lng: -79.38 },
    value: 10, kind: 'radius', unit: 'km', visible: true, radiusMeters: 10000,
    createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z',
  }],
});
const readRetiredRadiusSave = page => page.evaluate(key => localStorage.getItem(key), retiredRadiusKey);
const radiusRows = page => page.locator('#saved-list .saved-item');
const radiusRow = (page, name) => radiusRows(page).filter({ has: page.getByText(name, { exact: true }) });
// Below 600px the panel is a bottom sheet that rests at a peek without tabs.
async function expandRadius(page) {
  const toggle = page.locator('#panel-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function openRadius(page) {
  await page.goto(origin + radiusPath);
  await expandRadius(page);
  await page.locator('#saved-tab').click();
}
// Once a centre is chosen the search collapses to one row; Change reopens it.
async function searchRadius(page, query) {
  await expandRadius(page);
  if (await page.locator('#location-change').isVisible()) await page.locator('#location-change').click();
  await page.locator('#location-search').fill(query);
  await page.locator('#search-button').click();
}
async function saveRadius(page, name, centre) {
  await expandRadius(page);
  await page.locator('#create-tab').click();
  await searchRadius(page, centre);
  await expandRadius(page);
  await page.locator('#save-measurement-button').click();
  await page.locator('#measurement-name').fill(name);
  await page.locator('#save-dialog-submit').click();
  await expect(page.locator('#save-dialog')).toBeHidden();
  await expandRadius(page);
  await page.locator('#saved-tab').click();
  await expect(radiusRow(page, name)).toBeVisible();
}
async function radiusRowAction(page, name, action) {
  await radiusRow(page, name).getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await radiusRow(page, name).getByRole('button', { name: action, exact: true }).click();
}
async function renameRadius(page, original, next) {
  await radiusRowAction(page, original, 'Rename');
  await page.locator('#measurement-name').fill(next);
  await page.locator('#save-dialog-submit').click();
  await expect(page.locator('#save-dialog')).toBeHidden();
  await expect(radiusRow(page, next)).toBeVisible();
}
async function deleteRadius(page, name) {
  await radiusRowAction(page, name, 'Delete');
  await page.locator('#delete-dialog-submit').click();
  await expect(page.locator('#delete-dialog')).toBeHidden();
  await expect(radiusRow(page, name)).toHaveCount(0);
  await expect(page.locator('#app-status')).toHaveText(`Deleted ${name}.`);
}
try {
  databaseCommand('create'); created = true;
  server = spawn(php, [...flags, '-d', 'display_errors=0', '-d', 'log_errors=1', '-S', `127.0.0.1:${port}`, '-t', dist], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', chunk => { phpOutput += chunk.toString(); });
  for (let i = 0; i < 100; i++) { try { const response = await fetch(origin + '/account/', { method: 'HEAD' }); if (response.ok) break; } catch { /* This loopback process only. */ } await new Promise(resolve => setTimeout(resolve, 50)); }
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const desktop = await makeContext('desktop', { width: 1440, height: 1000 });
  const page = await desktop.newPage(); const email = `browser-${randomBytes(4).toString('hex')}@example.test`;
  let desktopOriginals, accountId;
  await scenario('guest datasets exist before signup', async () => {
    await openRadius(page);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: retiredRadiusKey, value: retiredRadiusSave });
    await openRadius(page);
    await expect(page.locator('#radius-sign-in')).toBeVisible();
    await expect(radiusRows(page)).toHaveCount(0);
    await page.locator('#create-tab').click();
    await searchRadius(page, '43.65, -79.38');
    await expect(page.locator('#app-status')).toContainText('entered coordinates');
    await expect(page.locator('#radius-sign-in-to-save')).toHaveAttribute('href', '/account/?returnTo=%2Futilities%2Fradius-map%2F');
    await page.locator('#save-measurement-button').click();
    await expect(page.locator('#sign-in-dialog')).toContainText('Your circle will be kept');
    await expect(page.locator('#radius-sign-in-to-save')).toBeVisible();
    await page.locator('#sign-in-dialog-cancel').click();
    await openBinder(page); await page.locator('#first-dex').click(); await page.locator('#owned-grid-1').check(); await expect(page.locator('#owned-count')).toHaveText('1');
    await page.locator('#binder-share-open').click();
    await expect(page.locator('#binder-share-sign-in')).toBeVisible();
    await expect(page.locator('#binder-share-publish')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#binder-share-open')).toBeFocused();
    await newSetBinder(page);
    await page.locator('#master-set').fill('sv03.5');
    await page.locator('#master-name').fill('My 151');
    await page.locator('#master-fillers').check();
    await expect(page.locator('#master-filler-through')).toHaveValue('165');
    await page.locator('#master-form button.dex-primary').click();
    await page.locator('[data-key="001:reverse"]').check();
    await expect(page.locator('#master-progress')).toHaveText('1 / 360');
    await openPokedexBinder(page, 'National Pokédex');
    await openSlayer(page); await expect(page.getByRole('dialog', { name: 'Account & sync', exact: true })).toContainText('Sign in'); desktopOriginals = await originals(page);
  });
  await scenario('desktop account page verifies a real emailed code', async () => {
    await login(page, email); accountId = (await session(desktop)).user.id;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(output, 'desktop-account.png'), fullPage: true });
  });
  await scenario('Binder reuses the session and preserves guest data during adoption', async () => {
    await openBinder(page); await expect(page.locator('#owned-count')).toHaveText('1');
    const savedBinder = homeCard(page, 'My 151');
    await expect(savedBinder.locator('[data-owned-count]')).toHaveText('1');
    await expect(savedBinder.locator('[data-required-count]')).toHaveText('360');
    await openSettings(page); await expect(page.locator('#binder-account-status')).toContainText(email); await returnToBinders(page);
    await adoptBinder(page, false); await openPokedexBinder(page, 'National Pokédex'); await page.locator('#owned-grid-2').check();
    await expect.poll(async () => (await remote(desktop, 'pokedex-binder', 'binder')).state.ownedDexIds.join(',')).toBe('1,2');
    const oldKey = await desktop.request.get(origin + '/utilities/pokedex-binder/api/binder.php', { headers: { 'X-Pokedex-Key': 'retired' } });
    assert.equal(oldKey.status(), 410, 'The migrated private key must be permanently revoked');
    assert.equal((await oldKey.json()).error.code, 'key_sync_retired');
    assert.deepEqual((await remote(desktop,'pokedex-binder','master-sets')).state.binders[0].owned,['001:reverse']);
    await page.screenshot({ path: join(output, 'desktop-binder-synced.png'), fullPage: false });
  });
  await scenario('Idle Slayer shares login and adopts all four real documents', async () => {
    await openSlayer(page); const dialog = page.getByRole('dialog', { name: 'Account & sync', exact: true }); await expect(dialog.getByRole('link', { name: 'Manage account', exact: true })).toBeVisible();
    await adoptSlayer(page, false); assert.deepEqual(await originals(page), desktopOriginals);
    const progress = await remote(desktop, 'idle-slayer-companion', 'progress'); assert.equal(progress.state.modules.material.records['unknown-desktop'].count, '12345678901234567890');
    assert.deepEqual((await remote(desktop, 'idle-slayer-companion', 'comparison')).state.ids, ['unknown-desktop']);
    assert.equal((await remote(desktop, 'idle-slayer-companion', 'checkpoints')).state.entries[0].name, 'desktop checkpoint');
    assert.equal((await remote(desktop, 'idle-slayer-companion', 'intentions')).state.recipePlans['unknown-desktop'], '3');
    await page.screenshot({ path: join(output, 'desktop-slayer-connected.png'), fullPage: false });
  });
  const mobile = await makeContext('mobile', { width: 390, height: 844 }); const phone = await mobile.newPage(); let mobileOriginals;
  await scenario('separate mobile browser logs into the same account', async () => {
    await openBinder(phone); await phone.locator('#first-dex').click(); await phone.locator('#owned-grid-3').check();
    // The fixture must be durably saved before leaving the page, just as the
    // desktop seed above waits for the post-transaction collection count.
    await expect(phone.locator('#owned-count')).toHaveText('1');
    await openSlayer(phone); mobileOriginals = await originals(phone);
    await login(phone, email, true); assert.equal((await session(mobile)).user.id, accountId);
    await phone.evaluate(() => window.scrollTo(0, 0));
    await phone.screenshot({ path: join(output, 'mobile-account.png'), fullPage: true });
  });
  await scenario('mobile browser retrieves both utilities without another sign-in', async () => {
    await openBinder(phone); await adoptBinder(phone, true); await expect(phone.locator('#owned-count')).toHaveText('2');
    await expect(homeCard(phone, 'My 151')).toHaveCount(1); await openPokedexBinder(phone, 'My 151');
    await expect(phone.locator('[data-key="001:reverse"]')).toBeChecked();
    await expect(phone.locator('.master-filler').first()).toContainText('Filler after #003');
    await phone.locator('[data-key="001:normal"]').check();
    await expect.poll(async()=>(await remote(mobile,'pokedex-binder','master-sets')).state.binders[0].owned).toContain('001:normal');
    await openSlayer(phone); await adoptSlayer(phone, true); assert.deepEqual(await originals(phone), mobileOriginals);
    await expect(phone.getByRole('dialog', { name: 'Account & sync', exact: true }).getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile utility horizontal overflow');
    await phone.screenshot({ path: join(output, 'mobile-slayer-connected.png'), fullPage: false });
  });
  await scenario('Pokédex visibility syncs independently from set binders and ownership', async () => {
    await openBinder(page); await openBinder(phone);
    await openPokedexBinder(page, 'National Pokédex'); await pokedexAction(page, '#layout-open'); await page.locator('#national-hide').click();
    await expect.poll(async () => (await remote(desktop, 'pokedex-binder', 'binder')).state.enabled).toBe(false);
    await openSettings(phone); await phone.locator('#binder-account-sync').click(); await returnToBinders(phone);
    await expect(phone.locator('#national-workspace')).toBeHidden();
    await expect(homeCards(phone)).toHaveCount(1);
    await phone.locator('#national-add').click(); await expect(phone.locator('#owned-count')).toHaveText('2');
    await expect.poll(async () => (await remote(mobile, 'pokedex-binder', 'binder')).state.enabled).toBe(true);
    await openSettings(page); await page.locator('#binder-account-sync').click(); await returnToBinders(page);
    await openPokedexBinder(page, 'National Pokédex');
    await expect(page.locator('#owned-count')).toHaveText('2');
  });
  await scenario('Pokémon retailer settings sync across devices and retain an offline conflict draft', async () => {
    await openSettings(page);
    await openSettings(phone);
    async function chooseStore(target, selected) {
      await target.locator('[name="retailer-mode"][value="selected"]').check();
      for (const shop of await target.locator('[name="retailer"]').all()) {
        await shop.setChecked(await shop.getAttribute('value') === selected);
      }
      await target.locator('#retailer-settings-save').click();
    }
    const activeStores = target => target.locator('[name="retailer"]:checked').evaluateAll(shops => shops.map(shop => shop.value));
    const remoteStores = async () => (await remote(desktop, 'pokedex-binder', 'preferences'))?.state.stores;
    await chooseStore(page, '401 Games');
    await expect.poll(remoteStores).toEqual(['401 Games']);
    const refreshed = phone.waitForResponse(response => response.ok() && response.url().includes('document=preferences'));
    await phone.locator('#binder-account-sync').click();
    await refreshed;
    await expect.poll(() => activeStores(phone)).toEqual(['401 Games']);
    await mobile.setOffline(true);
    try {
      await chooseStore(phone, 'Deck Out Gaming');
      await expect.poll(() => activeStores(phone)).toEqual(['Deck Out Gaming']);
      await expect.poll(remoteStores).toEqual(['401 Games']);
      await chooseStore(page, 'Pokemon Plug');
      await expect.poll(remoteStores).toEqual(['Pokemon Plug']);
    } finally {
      await mobile.setOffline(false);
    }
    await expect(phone.locator('#retailer-settings-status')).toContainText('changed on another device');
    await expect.poll(() => activeStores(phone)).toEqual(['Deck Out Gaming']);
    await phone.locator('#retailer-settings-save').click();
    await expect.poll(remoteStores).toEqual(['Deck Out Gaming']);
    await expect(phone.locator('#retailer-settings-keep')).toBeHidden();
    await expect(phone.locator('#binder-account-link')).toHaveAttribute('href', '/account/?returnTo=%2Futilities%2Fpokemon-binder%2Fsettings%2F');
    await returnToBinders(page);
    await returnToBinders(phone);
  });
  await scenario('a confirmed CSV import syncs set ownership to the other browser', async () => {
    await transferAction(phone, '#import-cards');
    await phone.locator('#card-import-file').setInputFiles({ name: 'fixture.csv', mimeType: 'text/csv',
      buffer: Buffer.from('Set,Number,Card,Finish\n151,002,Ivysaur,Reverse Holo\n') });
    await phone.locator('#card-import-preview').click();
    await expect(phone.locator('#card-review-summary')).toContainText('1 to add');
    await phone.locator('#card-import-apply').click();
    await expect(phone.locator('#card-import-dialog')).toBeHidden();
    await expect.poll(async () => (await remote(mobile, 'pokedex-binder', 'master-sets')).state.binders[0].owned).toContain('002:reverse');
    await openSettings(page); await page.locator('#binder-account-sync').click(); await returnToBinders(page);
    await openPokedexBinder(page, 'My 151');
    await expect(page.locator('[data-key="002:reverse"]')).toBeChecked();
  });
  await scenario('a signed-in owner shares both binders with signed-out desktop and mobile viewers', async () => {
    const path = '/utilities/pokemon-binder/shared/';
    const guestDesktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const guestPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    contexts.push(guestDesktop, guestPhone);
    const guestRequests = [];
    const capture = (target, name, owner = false) => target.screenshot({
      path: join(output, 'share-' + name + '.png'), fullPage: false,
      ...(owner ? { mask: [target.locator('#binder-share-link')], maskColor: '#e5eeff' } : {}),
    });
    for (const guest of [guestDesktop, guestPhone]) {
      await guest.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        guestRequests.push(url);
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/v1/binder-share.php') {
          const headers = await request.allHeaders();
          assert.equal(headers.cookie, undefined);
          assert.equal(headers.referer, undefined);
          assert.equal(url.search, '');
        }
        await route.continue();
      });
      guest.on('page', target => target.on('pageerror', error => pageErrors.push({ scenario: active, message: error.message })));
    }
    const large = await guestDesktop.newPage(), small = await guestPhone.newPage();
    await openPokedexBinder(page, 'National Pokédex');
    await capture(page, 'owner-desktop-entry');
    await page.locator('#binder-share-open').click();
    await expect(page.locator('#binder-share-publish')).toBeVisible();
    await capture(page, 'owner-desktop-private');
    await page.locator('#binder-share-publish').click();
    await expect(page.locator('#binder-share-link')).toHaveValue(/\/shared\/#pbs_[a-f0-9]{64}$/);
    await capture(page, 'owner-desktop-link', true);
    const nationalLink = await page.locator('#binder-share-link').inputValue();
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true, value: () => Promise.reject(new Error('Clipboard disabled for this test')),
    }));
    await page.locator('#binder-share-copy').click();
    await expect(page.locator('#binder-share-link')).toBeFocused();
    await expect(page.locator('#binder-share-message')).toContainText('Link selected');

    await openPokedexBinder(phone, 'My 151');
    await openMenu(phone);
    await capture(phone, 'owner-mobile-entry');
    await phone.locator('#binder-share-menu').click();
    await phone.locator('#binder-share-publish').click();
    await expect(phone.locator('#binder-share-link')).toHaveValue(/\/shared\/#pbs_[a-f0-9]{64}$/);
    await capture(phone, 'owner-mobile-link', true);
    const setLink = await phone.locator('#binder-share-link').inputValue();
    for (const [url, name, slug, count, prefix] of [
      [nationalLink, 'National Pokédex', 'national', '2', ''],
      [setLink, 'My 151', 'set', '3', 'master-'],
    ]) {
      for (const [target, size] of [[large, 'desktop'], [small, 'mobile']]) {
        await target.goto(url);
        await expect(target.getByRole('heading', { level: 1, name })).toBeVisible();
        await expect(target.locator('#shared-owned')).toHaveText(count);
        await expect(target.getByText('Read only', { exact: true })).toBeVisible();
        await expect(target.locator('input[type=checkbox], input[type=radio], #binder-menu, #buy-cards-open, #sync-open, #master-select-page, #binder-share-open')).toHaveCount(0);
        assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Shared binder horizontal overflow');
        await capture(target, `${slug}-${size}-pages`);
        await target.locator('#' + prefix + 'view-checklist').click();
        await expect(target.locator('.dex-shared-checklist:visible .dex-read-status').first()).toHaveText('Collected');
        await capture(target, `${slug}-${size}-checklist`);
        if (slug === 'national') {
          await target.getByRole('link', { name: 'Skip to content' }).focus();
          await target.keyboard.press('Enter');
          await expect(target.locator('#main')).toBeFocused();
          assert.equal(target.url(), url);
          await target.locator('#dex-search').fill('1');
          await expect(target.locator('#checklist-list .dex-checklist-row')).toHaveCount(1);
          await expect(target.locator('#checklist-list .dex-checklist-name')).toHaveText('Bulbasaur');
        }
      }
    }
    await small.locator('#master-search').fill('Ivysaur');
    await chooseFilter(small, '#master-status', 'owned');
    await expect(small.locator('#master-list .dex-checklist-row')).toHaveCount(1);
    await small.locator('#master-list .dex-checklist-jump').click();
    await expect(small.locator('#master-pokemon-details')).toContainText('Ivysaur');
    await capture(small, 'set-mobile-details');
    await small.keyboard.press('Escape');
    await expect(small.locator('#master-pokemon-details')).toBeHidden();
    assert.match(await small.locator(':focus').getAttribute('id'), /^set-open-grid-/);
    await small.setViewportSize({ width: 320, height: 844 });
    await expect(small.locator('#master-search')).toHaveAttribute('placeholder', 'Find a card');
    assert.equal(await small.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Narrow filtered binder horizontal overflow');
    await capture(small, 'set-narrow-filtered');
    await small.locator('#master-page-next').click();
    await expect(small.locator('#master-page-heading')).toHaveText('Page 2');
    assert.deepEqual(await guestDesktop.cookies(), []);
    assert.deepEqual(await guestPhone.cookies(), []);
    assert.ok(guestRequests.some(url => url.pathname === '/api/v1/binder-share.php'));
    assert.ok(guestRequests.every(url => !url.hash && !/analytics|reports/.test(url.hostname)));
    assert.ok(guestRequests.filter(url => url.pathname === path).every(url => !url.search));

    await page.locator('#binder-share-stop').click();
    await expect(page.locator('#binder-share-message')).toContainText('Sharing stopped');
    await large.goto(nationalLink);
    await expect(large.locator('#shared-message')).toContainText('This shared binder is unavailable');
    await capture(large, 'unavailable-desktop');
    const manage = url => url.pathname === '/api/v1/sync.php' && url.searchParams.get('action') === 'binder-share';
    let started = false, release;
    const held = new Promise(resolve => { release = resolve; });
    const holdPublish = async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'publish') {
        started = true;
        await held;
      }
      await route.continue();
    };
    await page.route(manage, holdPublish);
    try {
      await page.locator('#binder-share-publish').click();
      await expect.poll(() => started).toBe(true);
      await page.keyboard.press('Escape');
      await page.locator('#binder-share-open').click();
      await expect(page.locator('#binder-share-message')).toHaveText('Checking sharing…');
      release();
      await expect(page.locator('#binder-share-link')).toBeVisible();
    } finally {
      release();
      await page.unroute(manage, holdPublish);
    }
    assert.notEqual(await page.locator('#binder-share-link').inputValue(), nationalLink);
    await page.locator('#binder-share-stop').click();
    await phone.locator('#binder-share-stop').click();
    await expect(phone.locator('#binder-share-message')).toContainText('Sharing stopped');
    await phone.keyboard.press('Escape');
    await expect(phone.locator('#binder-menu summary')).toBeFocused();
    await page.keyboard.press('Escape');
    const discover = url => url.pathname === '/api/v1/auth.php' && url.searchParams.get('action') === 'session';
    const dropDiscovery = route => route.abort();
    await page.route(discover, dropDiscovery);
    try {
      await openBinder(page);
      await openPokedexBinder(page, 'National Pokédex');
      await page.locator('#binder-share-open').click();
      await expect(page.locator('#binder-share-message')).toContainText('Reconnect to the internet');
    } finally {
      await page.unroute(discover, dropDiscovery);
    }
    await page.locator('#binder-share-retry').click();
    await expect(page.locator('#binder-share-publish')).toBeVisible();
    await page.keyboard.press('Escape');
    await guestDesktop.close();
    await guestPhone.close();
  });
  let mapMobile, mapPhone;
  await scenario('Radius Map opens the shared account and merges separate first saves', async () => {
    await openRadius(page);
    await expect(page.locator('#radius-sync-status')).toHaveText('Account library synced.');
    await expect(radiusRows(page)).toHaveCount(0);
    await expect(page.locator('#radius-review')).toBeHidden();
    assert.equal(await readRetiredRadiusSave(page), retiredRadiusSave);
    assert.equal(await remote(desktop, 'radius-map', 'measurements'), null, 'Opening a new account library must not create a document');

    mapMobile = await makeContext('mobile', { width: 390, height: 844 }, 'allow');
    await mapMobile.addCookies(await mobile.cookies(origin));
    mapPhone = await mapMobile.newPage();
    await openRadius(mapPhone);
    await expect.poll(() => mapPhone.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(mapPhone.locator('#radius-sync-status')).toHaveText('Account library synced.');
    await mapMobile.setOffline(true);
    await saveRadius(mapPhone, 'Bay', '43.67, -79.36');
    await expect(mapPhone.locator('#radius-sync-status')).toContainText('Waiting to sync');

    await page.locator('#create-tab').click();
    const geocoder = '**/utilities/radius-map/api/geocode.php?*';
    await desktop.route(geocoder, route => route.fulfill({ json: { results: [{ id: 'fixture', label: 'Test park', lat: 43.65, lng: -79.38 }] } }));
    try {
      await searchRadius(page, 'Test park');
      await page.locator('#search-results').getByRole('button', { name: 'Test park' }).click();
      await expect(page.locator('#summary-centre')).toHaveText('Test park');
    } finally {
      await desktop.unroute(geocoder);
    }
    await desktop.grantPermissions(['geolocation'], { origin });
    await desktop.setGeolocation({ latitude: 43.67, longitude: -79.36 });
    await page.locator('#location-change').click();
    await page.locator('#locate-button').click();
    await expect(page.locator('#app-status')).toContainText('centred on your current location');
    await page.locator('#map').click({ position: { x: 850, y: 430 } });
    await expect(page.locator('#app-status')).toContainText('centred on the dropped pin');
    await page.locator('label[for=kind-diameter]').click();
    await expect(page.locator('#summary-value')).toHaveText('10 km diameter');
    await page.locator('label[for=unit-mi]').click();
    await expect(page.locator('#summary-value')).toContainText('mi diameter');
    await page.locator('label[for=unit-km]').click();
    await page.locator('label[for=kind-radius]').click();
    await saveRadius(page, 'Ridge', '43.65, -79.38');
    await saveRadius(page, 'Shared', '43.69, -79.35');
    await saveRadius(page, 'Trail', '43.63, -79.33');
    await page.locator('#bestfit-tab').click();
    await expect(page.locator('#triangulation-inputs li')).toHaveCount(3);
    await page.locator('#triangulate-button').click();
    await expect(page.locator('#triangulation-result')).toBeVisible();
    await expect(page.locator('#triangulation-result')).toBeFocused();
    await expect(page.locator('#radius-sync-status')).toHaveText('Account library synced.');
    await mapMobile.setOffline(false);
    await expect(radiusRows(mapPhone)).toHaveCount(4);
    await expect(mapPhone.locator('#radius-sync-status')).toHaveText('Account library synced.');
    await page.locator('#saved-tab').click();
    await page.locator('#radius-sync-now').click();
    await expect(radiusRows(page)).toHaveCount(4);
    assert.equal(await mapPhone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Radius Map horizontal overflow');

    const beforeOpen = await remote(mobile, 'radius-map', 'measurements');
    await openRadius(phone);
    await expect(radiusRows(phone)).toHaveCount(4);
    await expect(phone.locator('#radius-review')).toBeHidden();
    assert.equal((await remote(mobile, 'radius-map', 'measurements')).revision, beforeOpen.revision);
  });
  await scenario('Radius Map reloads offline and merges edits to different measurements', async () => {
    await mapMobile.setOffline(true);
    await renameRadius(mapPhone, 'Bay', 'Offline Bay');
    await openRadius(mapPhone);
    await expect(radiusRow(mapPhone, 'Offline Bay')).toBeVisible();
    await expect(mapPhone.locator('#radius-sync-status')).toContainText('Waiting to sync');
    await renameRadius(page, 'Ridge', 'Desktop Ridge');
    await expect.poll(async () => (await remote(desktop, 'radius-map', 'measurements')).state.measurements.some(item => item.name === 'Desktop Ridge')).toBe(true);
    await mapMobile.setOffline(false);
    await expect(radiusRow(mapPhone, 'Desktop Ridge')).toBeVisible();
    await expect(radiusRow(mapPhone, 'Offline Bay')).toBeVisible();
    await expect(mapPhone.locator('#radius-sync-status')).toHaveText('Account library synced.');
    await page.locator('#radius-sync-now').click();
    await expect(radiusRow(page, 'Offline Bay')).toBeVisible();
  });
  await scenario('Radius Map retries an accepted write after losing its acknowledgement', async () => {
    const writeAction = url => url.pathname === '/api/v1/sync.php' && url.searchParams.get('action') === 'write';
    const attempts = [];
    await mapMobile.route(writeAction, async route => {
      if (route.request().postDataJSON()?.app !== 'radius-map') return route.continue();
      attempts.push(route.request().postData());
      if (attempts.length !== 1) return route.continue();
      const accepted = await route.fetch();
      assert.equal(accepted.status(), 200);
      await route.abort();
    });
    try {
      await radiusRow(mapPhone, 'Offline Bay').getByRole('checkbox', { name: 'Hide Offline Bay' }).press('Space');
      await expect(mapPhone.locator('#radius-sync-status')).toContainText('could not be reached');
      await expect(radiusRow(mapPhone, 'Offline Bay').getByRole('checkbox', { name: 'Show Offline Bay' })).not.toBeChecked();
      await mapPhone.locator('#radius-sync-now').click();
      await expect(mapPhone.locator('#radius-sync-status')).toHaveText('Account library synced.');
      assert.deepEqual(attempts, [attempts[0], attempts[0]], 'The retried body must be byte-identical');
      const state = (await remote(desktop, 'radius-map', 'measurements')).state;
      assert.equal(state.measurements.find(item => item.name === 'Offline Bay').visible, false);
    } finally {
      await mapMobile.unroute(writeAction);
    }
  });
  await scenario('Radius Map reviews a competing edit and deletion, with recovery', async () => {
    await mapMobile.setOffline(true);
    await deleteRadius(mapPhone, 'Shared');
    await renameRadius(page, 'Shared', 'Desktop Shared');
    await expect.poll(async () => (await remote(desktop, 'radius-map', 'measurements')).state.measurements.some(item => item.name === 'Desktop Shared')).toBe(true);
    await mapMobile.setOffline(false);
    await expect(mapPhone.locator('#radius-review')).toHaveText('Review sync changes');
    await mapPhone.locator('#radius-review').click();
    const review = mapPhone.locator('#radius-review-dialog');
    await expect(review).toContainText('This browser · Deleted');
    await expect(review).toContainText('Account · Desktop Shared');
    await mapPhone.screenshot({ path: join(output, 'mobile-radius-conflict.png') });
    await review.getByRole('radio', { name: 'This browser · Deleted' }).check();
    const commitAction = url => url.pathname === '/api/v1/sync.php' && url.searchParams.get('action') === 'migration-commit';
    const commits = [];
    await mapMobile.route(commitAction, async route => {
      if (route.request().postDataJSON()?.app !== 'radius-map') return route.continue();
      commits.push(route.request().postData());
      if (commits.length !== 1) return route.continue();
      assert.equal((await route.fetch()).status(), 200);
      await route.abort();
    });
    try {
      await mapPhone.locator('#radius-review-apply').click();
      await expect(mapPhone.locator('#radius-sync-status')).toContainText('could not be reached');
      await expect(review).toBeHidden();
      assert.equal(commits.length, 1);
      await openRadius(mapPhone);
      await mapPhone.getByRole('button', { name: 'Finish saved review' }).click();
      await expect(mapPhone.locator('#radius-sync-status')).toHaveText('Account library synced.');
      assert.deepEqual(commits, [commits[0], commits[0]], 'Conflict review must resume with the original commit');
    } finally {
      await mapMobile.unroute(commitAction);
    }
    await page.locator('#radius-sync-now').click();
    await expect(radiusRow(page, 'Desktop Shared')).toHaveCount(0);

    await page.goto(origin + '/account/');
    const recovery = page.locator('#account-recovery-list li').filter({ hasText: 'Radius Map · measurements' });
    const original = recovery.filter({ has: page.getByText(/^Before migration ·/) });
    await expect(original).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await original.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.locator('#account-status')).toContainText('Recovery copy restored');
    await openRadius(page);
    await expect(radiusRow(page, 'Desktop Shared')).toBeVisible();
    assert.equal(await readRetiredRadiusSave(page), retiredRadiusSave);
  });
  await scenario('installed Radius Map caches only public assets and clears account data on sign-out', async () => {
    const cached = await mapPhone.evaluate(async () => {
      const names = (await caches.keys()).filter(name => name.startsWith('austingarrod-radius-map-'));
      return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
    });
    assert.ok(cached.includes(origin + radiusPath), 'Cached Radius Map shell must be installed');
    assert.ok(cached.every(url => new URL(url).origin === origin && !new URL(url).pathname.includes('/api/')));
    const manage = await mapMobile.newPage();
    await manage.goto(origin + '/account/');
    await manage.locator('#account-logout').click();
    await expect(manage.locator('#account-signed-out')).toBeVisible();
    await expect(mapPhone.locator('#radius-library-location')).toHaveText('Sign in');
    await expect(radiusRows(mapPhone)).toHaveCount(0);
    await mapMobile.setOffline(true);
    await openRadius(mapPhone);
    await expect(radiusRows(mapPhone)).toHaveCount(0);
    await mapMobile.setOffline(false);
  });
  await scenario('the account shows recovery copies beside a browsable sync history', async () => {
    const listRequest = '**/api/v1/sync.php?action=recovery-list';
    await page.route(listRequest, async route => {
      const response = await route.fetch();
      const { snapshots } = await response.json();
      const routine = snapshots.filter(snapshot => snapshot.label === 'Before sync');
      const copies = snapshots.filter(snapshot => snapshot.label !== 'Before sync');
      assert.ok(routine.length > 0);
      const older = Array.from({ length: 270 - routine.length }, (_, index) => ({
        ...routine[0], id: randomUUID(), revision: 270 - routine.length - index, createdAt: '2026-01-01T00:00:00Z',
      }));
      await route.fulfill({ response, json: { snapshots: [...copies, ...routine, ...older] } });
    });
    try {
      await page.goto(origin + '/account/');
      const copies = page.locator('#account-recovery-list > li');
      await expect(copies.filter({ hasText: 'Device before migration' }).first()).toBeVisible();
      await expect(copies.filter({ hasText: 'Daily checkpoint' })).toHaveCount(0);
      const history = page.locator('#account-sync-history');
      const versions = history.locator('li');
      const summary = history.locator('summary');
      const more = history.getByRole('button', { name: 'Show older versions' });
      await expect(summary).toHaveText('Sync checkpoints · 270');
      await expect(versions.first()).toBeHidden();
      await summary.click();
      await expect(versions.first()).toBeVisible();
      await expect(versions).toHaveCount(20);
      for (let shown = 20; shown < 270; shown += 20) await more.click();
      await expect(versions).toHaveCount(270);
      await expect(more).toBeHidden();
    } finally {
      await page.unroute(listRequest);
    }
  });
  await scenario('account recovery downloads and restores through the real UI', async () => {
    await page.goto(origin + '/account/'); await expect(page.locator('#account-recovery-list li')).not.toHaveCount(0);
    const row = page.locator('#account-recovery-list li').filter({ hasText: 'Pokémon Binder Tracker · binder' }).filter({ hasText: 'Device before migration' }).first();
    await expect(row).toBeVisible(); const pendingDownload = page.waitForEvent('download'); await row.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await pendingDownload; const downloadedPath = join(output, 'recovery-copy.json'); await download.saveAs(downloadedPath); const downloaded = JSON.parse(readFileSync(downloadedPath, 'utf8')); assert.equal(downloaded.app, 'pokedex-binder');
    page.once('dialog', dialog => dialog.accept()); await row.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.locator('#account-status')).toContainText('Recovery copy restored');
    assert.deepEqual((await remote(desktop, 'pokedex-binder', 'binder')).state, downloaded.state);
  });
  await scenario('signed-in Google linking completes mailbox proof without changing saved data', async () => {
    const before = await session(desktop);
    const resources = [['pokedex-binder', 'binder'], ['pokedex-binder','master-sets'], ...['progress', 'intentions', 'checkpoints', 'comparison'].map(name => ['idle-slayer-companion', name])];
    const beforeDocuments = await Promise.all(resources.map(([app, name]) => remote(desktop, app, name)));
    const cookie = (await desktop.cookies()).find(item => item.name === '__Host-ag-session');
    assert.ok(cookie);
    const subject = `browser-fixture-${randomUUID()}`;
    const fixture = { ACCOUNTS_TEST_SESSION_TOKEN: cookie.value, ACCOUNTS_TEST_GOOGLE_SUBJECT: subject };
    const seeded = JSON.parse(databaseCommand('seed-pending-google', fixture).toString());
    assert.equal(seeded.userId, before.user.id);
    await page.goto(origin + '/account/?google=verify-email');
    await expect(page.locator('#account-signed-in')).toBeVisible();
    await expect(page.locator('#account-signed-out')).toBeVisible();
    await expect(page.locator('#account-sign-in-heading')).toHaveText('Verify your email to connect Google');
    await expect(page.locator('#account-email')).toHaveValue(email);
    await expect(page.locator('#account-email')).toHaveJSProperty('readOnly', true);
    await expect(page.locator('#account-google')).toBeHidden();
    await expect(page.locator('#account-link-google')).toBeHidden();
    const beforeMail = messages.length;
    await page.locator('#account-email-submit').click();
    await expect(page.locator('#account-code-form')).toBeVisible();
    await expect.poll(() => messages.length).toBeGreaterThan(beforeMail);
    const mailedCode = messages.at(-1).text.match(/code is:\s*(\d{6})/)[1];
    await page.locator('#account-code').fill(mailedCode);
    await page.locator('#account-code-submit').click();
    await expect(page.locator('#account-status')).toHaveText('Google is connected to your account.');
    await expect(page.locator('#account-signed-out')).toBeHidden();
    await expect(page.locator('#account-signed-in')).toBeVisible();
    await expect(page.locator('#account-email')).toHaveJSProperty('readOnly', false);
    await expect(page.locator('#account-code')).toHaveValue('');
    const after = await session(desktop);
    assert.equal(after.user.id, before.user.id);
    assert.equal(after.pendingGoogleEmail, undefined);
    assert.equal(JSON.parse(databaseCommand('read-google-identity', fixture).toString()).userId, before.user.id);
    assert.deepEqual(await Promise.all(resources.map(([app, name]) => remote(desktop, app, name))), beforeDocuments);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(output, 'google-link-verified.png'), fullPage: false });
  });
  await scenario('utility admin inspects cross-utility saves and recovery on desktop and mobile', async () => {
    const customer = await session(desktop);
    const alertsUrl = origin + '/api/v1/sync.php?action=binder-stock-alerts';
    const customerHeaders = { 'X-Account-ID': customer.user.id };
    const existingAlerts = await desktop.request.get(alertsUrl, { headers: customerHeaders });
    assert.equal(existingAlerts.status(), 200);
    const { revision } = await existingAlerts.json();
    const updatedAlerts = await desktop.request.post(alertsUrl, {
      headers: { ...customerHeaders, Origin: origin, 'X-CSRF-Token': customer.csrfToken },
      data: { revision, alerts: [{ store: '401 Games', minimum: 2 }] },
    });
    assert.equal(updatedAlerts.status(), 200);

    const operatorContext = await makeContext('desktop', { width: 1440, height: 1000 });
    const operatorPage = await operatorContext.newPage();
    await login(operatorPage, 'support-operator@example.test');
    const operator = (await session(operatorContext)).user.id;
    writeFileSync(join(temporary, 'utility-admin.json'), JSON.stringify({ operators: [operator] }), { mode: 0o600 });
    writeFileSync(join(temporary, 'utility-admin-audit.jsonl'), '', { mode: 0o600 });

    const adminUrl = origin + '/account/admin/';
    await page.goto(adminUrl);
    await expect(page.locator('#admin-gate-status')).toContainText('does not have utility admin access');
    await operatorPage.goto(adminUrl);
    const overview = operatorPage.getByRole('heading', { name: 'Utility overview' });
    const openUser = operatorPage.getByRole('button', { name: `Open ${email}` });
    await expect(overview).toBeVisible();
    await expect(openUser).toBeVisible();
    await operatorPage.screenshot({ path: join(output, 'admin-desktop-overview.png'), fullPage: true });
    const emailSearch = operatorPage.getByRole('searchbox', { name: 'Email or account ID' });
    await emailSearch.fill(email);
    await operatorPage.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(operatorPage.locator('#admin-users li')).toHaveCount(1);
    await openUser.click();
    for (const name of ['Pokémon Binder Tracker', 'Idle Slayer Companion', 'Radius Map']) {
      await expect(operatorPage.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    const stockAlerts = operatorPage.getByRole('region', { name: 'Binder stock alerts' });
    await expect(stockAlerts).toContainText('401 Games');
    await expect(stockAlerts).toContainText('Minimum 2 cards');
    const viewSave = operatorPage.getByRole('button', { name: 'View Measurements save', exact: true });
    const viewCopy = operatorPage.getByRole('button', { name: /recovery copy, revision/ }).first();
    await expect(viewCopy).toBeVisible();
    await operatorPage.screenshot({ path: join(output, 'admin-desktop-account.png'), fullPage: true });
    await viewSave.click();
    const savedJson = operatorPage.locator('#admin-inspector-json');
    await expect(savedJson).toContainText('measurements');
    await expect(operatorPage.locator('#admin-inspector-context')).toHaveText('Radius Map · Current save');
    const downloadEvent = operatorPage.waitForEvent('download');
    await operatorPage.getByRole('button', { name: 'Download JSON' }).click();
    const downloaded = await downloadEvent;
    assert.deepEqual(JSON.parse(readFileSync(await downloaded.path(), 'utf8')),
      (await remote(desktop, 'radius-map', 'measurements')).state);
    await operatorPage.screenshot({ path: join(output, 'admin-desktop-save.png') });
    await operatorPage.keyboard.press('Escape');
    await expect(savedJson).toBeEmpty();
    await expect(viewSave).toBeFocused();

    await operatorPage.setViewportSize({ width: 390, height: 844 });
    const mobileActions = await operatorPage.locator('#admin-detail .button:visible').evaluateAll(buttons => buttons.map(button => ({
      width: button.clientWidth, height: button.getBoundingClientRect().height, content: button.scrollWidth,
    })));
    assert.ok(mobileActions.every(({ width, height, content }) => height >= 44 && width >= content), 'Mobile action labels must fit inside their tap targets');
    await viewCopy.click();
    await expect(savedJson).not.toBeEmpty();
    await expect(operatorPage.locator('#admin-inspector-context')).not.toContainText('Current save');
    await operatorPage.screenshot({ path: join(output, 'admin-mobile-save.png') });
    await operatorPage.getByRole('button', { name: 'Close saved data' }).click();
    await operatorPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await operatorPage.screenshot({ path: join(output, 'admin-mobile-account.png'), fullPage: true });
    await operatorPage.getByRole('button', { name: 'Back to accounts' }).click();
    await expect(openUser).toBeFocused();
    await expect(emailSearch).toHaveValue(email);
    await operatorPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await operatorPage.screenshot({ path: join(output, 'admin-mobile-overview.png'), fullPage: true });
    assert.equal(await operatorPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    const signOutPage = await operatorContext.newPage();
    await signOutPage.goto(origin + '/account/');
    await signOutPage.locator('#account-logout').click();
    await expect(operatorPage.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(operatorPage.locator('#admin-users')).toBeEmpty();
    await expect(operatorPage.locator('#admin-user-email')).toBeEmpty();
    await operatorPage.screenshot({ path: join(output, 'admin-mobile-sign-in.png') });
  });
  await scenario('signing out restores each browser guest view and retains originals', async () => {
    for (const [currentPage, context, expectedRaw, count] of [[page, desktop, desktopOriginals, '1'], [phone, mobile, mobileOriginals, '1']]) {
      await currentPage.goto(origin + '/account/');
      // The installed-map context used the same mobile session and signed it out.
      if (context === desktop) {
        await currentPage.goto(origin + '/utilities/pokemon-binder/settings/');
        await currentPage.locator('#binder-account-sign-out').click();
        await expect(currentPage.locator('#binder-account-link')).toHaveText('Sign in with email or Google');
        await expect(currentPage.locator('[name="retailer-mode"][value="all"]')).toBeChecked();
        await currentPage.goto(origin + '/account/');
      }
      await expect(currentPage.locator('#account-signed-out')).toBeVisible();
      assert.equal((await session(context)).user, null);
      await openBinder(currentPage); await expect(currentPage.locator('#owned-count')).toHaveText(count); await openSlayer(currentPage); assert.deepEqual(await originals(currentPage), expectedRaw);
    }
  });
  assert.deepEqual(pageErrors, [], 'Browser runtime errors');
  assert.deepEqual(remoteRequests.filter(item => new URL(item.page || origin).pathname.startsWith('/account/')), [], 'Account pages attempted external requests');
  assert.ok(!phpOutput.includes(email), 'Email entered PHP diagnostics');
  writeFileSync(join(output, 'results.json'), JSON.stringify({ completed, accountPagesExternalRequests: 0, externalRequestsBlocked: remoteRequests.length, runtimeErrors: pageErrors }, null, 2));
  console.log(`Accounts real-browser acceptance passed (${completed.length} scenarios, desktop/mobile).`);
} catch (error) {
  writeFileSync(join(output, 'failure.json'), JSON.stringify({ active, completed, message: error.message, runtimeErrors: pageErrors, remoteRequests }, null, 2));
  for (const [index, context] of contexts.entries()) for (const [pageIndex, page] of context.pages().entries()) await page.screenshot({ path: join(output, `failure-${index}-${pageIndex}.png`), fullPage: false }).catch(() => {});
  throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close();
  if (server) { server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
  await new Promise(resolve => smtp.close(resolve));
  if (created) databaseCommand('drop');
}
