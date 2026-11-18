import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// LOCAL ONLY: compiled applications, production PHP handlers, actual email-code
// verification through a loopback SMTP sink, and a disposable MySQL database.
// No authentication or sync response is intercepted or replaced.
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
for (const path of ['account/index.html', 'api/v1/auth.php', 'utilities/pokedex-binder/index.html', 'utilities/idle-slayer-companion/index.html']) {
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
async function makeContext(tag, viewport) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers: 'block' }); contexts.push(context);
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
  await page.goto(origin + '/utilities/pokedex-binder/');
  await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
}
async function adoptBinder(page, chooseAccount) {
  await page.locator('#sync-open').click();
  await expect(page.locator('#binder-account-review')).toBeVisible();
  await page.locator('#binder-account-review').click();
  await expect(page.locator('#binder-migration-dialog')).toBeVisible();
  await page.locator('#binder-migration-layout').selectOption(chooseAccount ? 'account' : 'device');
  if (chooseAccount) await page.locator('#binder-migration-collection').selectOption('account');
  await page.locator('#binder-migration-form button[type=submit]').click();
  await expect(page.locator('#binder-migration-dialog')).not.toBeVisible();
  await expect(page.locator('#dex-status')).toContainText('Synced', { timeout: 15_000 });
}
async function openSlayer(page) {
  await page.goto(origin + '/utilities/idle-slayer-companion/');
  await expect(page.getByRole('button', { name: /^Account & sync/ })).toBeVisible({ timeout: 20_000 });
  // Session discovery can replace the cached offline account workspace. Wait
  // for that initial reconciliation before interacting with its new controls.
  await page.waitForLoadState('networkidle');
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
  if (!await dialog.isVisible()) await page.getByRole('button', { name: /^Account & sync/ }).click();
  await expect(dialog.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText(/Connected and verified|Account changes synced/);
}
async function originals(page) { return page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), slayerKeys); }
try {
  databaseCommand('create'); created = true;
  server = spawn(php, [...flags, '-d', 'display_errors=0', '-d', 'log_errors=1', '-S', `127.0.0.1:${port}`, '-t', dist], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', chunk => { phpOutput += chunk.toString(); });
  for (let i = 0; i < 100; i++) { try { const response = await fetch(origin + '/account/'); if (response.ok) break; } catch { /* This loopback process only. */ } await new Promise(resolve => setTimeout(resolve, 50)); }
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const desktop = await makeContext('desktop', { width: 1440, height: 1000 });
  const page = await desktop.newPage(); const email = `browser-${randomBytes(4).toString('hex')}@example.test`;
  let desktopOriginals, accountId;
  await scenario('guest datasets exist before signup', async () => {
    await openBinder(page); await page.locator('#owned-grid-1').check(); await expect(page.locator('#owned-count')).toHaveText('1');
    await page.locator('#master-new').click();
    await page.locator('#master-set').fill('sv03.5');
    await page.locator('#master-name').fill('My 151');
    await page.locator('#master-form button.dex-primary').click();
    await page.locator('[data-key="001:reverse"]').check();
    await page.locator('#master-switch').selectOption('');
    await openSlayer(page); await expect(page.getByRole('dialog', { name: 'Account & sync', exact: true })).toContainText('Sign in'); desktopOriginals = await originals(page);
  });
  await scenario('desktop account page verifies a real emailed code', async () => {
    await login(page, email); accountId = (await session(desktop)).user.id;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(output, 'desktop-account.png'), fullPage: true });
  });
  await scenario('Binder reuses the session and preserves guest data during adoption', async () => {
    await openBinder(page); await expect(page.locator('#owned-count')).toHaveText('1');
    await page.locator('#sync-open').click(); await expect(page.locator('#binder-account-status')).toContainText(email); await page.keyboard.press('Escape');
    await adoptBinder(page, false); await page.locator('#owned-grid-2').check();
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
    await openBinder(phone); await phone.locator('#owned-grid-3').check();
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
    const setOption=phone.locator('#master-switch option').filter({hasText:'My 151'});
    await expect(setOption).toHaveCount(1);await phone.locator('#master-switch').selectOption(await setOption.getAttribute('value'));
    await expect(phone.locator('[data-key="001:reverse"]')).toBeChecked();
    await phone.locator('[data-key="001:normal"]').check();
    await expect.poll(async()=>(await remote(mobile,'pokedex-binder','master-sets')).state.binders[0].owned).toContain('001:normal');
    await openSlayer(phone); await adoptSlayer(phone, true); assert.deepEqual(await originals(phone), mobileOriginals);
    await expect(phone.getByRole('dialog', { name: 'Account & sync', exact: true }).getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile utility horizontal overflow');
    await phone.screenshot({ path: join(output, 'mobile-slayer-connected.png'), fullPage: false });
  });
  await scenario('account recovery downloads and restores through the real UI', async () => {
    await page.goto(origin + '/account/'); await expect(page.locator('#account-recovery-list li')).not.toHaveCount(0);
    const row = page.locator('#account-recovery-list li').filter({ hasText: 'Pokédex Binder · binder' }).filter({ hasText: 'Device before migration' }).first();
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
  await scenario('signing out restores each browser guest view and retains originals', async () => {
    for (const [currentPage, context, expectedRaw, count] of [[page, desktop, desktopOriginals, '1'], [phone, mobile, mobileOriginals, '1']]) {
      await currentPage.goto(origin + '/account/'); await currentPage.locator('#account-logout').click(); await expect(currentPage.locator('#account-signed-out')).toBeVisible(); assert.equal((await session(context)).user, null);
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
