import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// LOCAL ONLY. Real compiled app, production PHP, disposable MySQL, mailed OTP,
// and native Chrome IndexedDB. API responses are never mocked or intercepted.
const root = fileURLToPath(new URL('../', import.meta.url)), dist = join(root, 'dist');
assert.ok(process.env.ACCOUNTS_TEST_DSN, 'Set ACCOUNTS_TEST_DSN to an isolated localhost MySQL DSN.');
for (const file of ['account/index.html', 'api/v1/auth.php', 'utilities/idle-slayer-companion/index.html']) assert.ok(existsSync(join(dist, file)), `Build dist before running: missing ${file}`);
const databaseName = 'idle-slayer-companion.accounts.v1', storeName = 'records';
const guestKey = 'idle-slayer-companion.progress.v1', activeKey = 'idle-slayer-companion.accounts.active.v1';
const guestKeys = [guestKey, 'idle-slayer-companion.workspace.v1', 'idle-slayer-ascension-map.checkpoints.v1', 'idle-slayer-ascension-map.comparison.v1', 'idle-slayer-ascension-map.profile.v1', 'idle-slayer-ascension-map.goals.v1'];
const hash = value => createHash('sha256').update(value).digest('hex');

// Use the actual portable parser/exporter to prove the fixture fits the existing
// 4 MiB format, rather than silently widening the application's accepted data.
const compiled = await build({ stdin: { contents: "export { emptyCompanionProgress } from './apps/idle-slayer-companion/src/domain/companion-progress'; export { parseCompanionBackup, exportCompanionStored } from './apps/idle-slayer-companion/src/domain/companion-storage';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const codecs = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const fixture = codecs.emptyCompanionProgress('large-browser-fixture'), recordCount = 3650;
const exactCount = '9876543210'.repeat(103).slice(0, 1024);
for (let i = 0; i < recordCount; i++) fixture.modules.material.records[`unknown-large-${i}`] = { count: exactCount, discovered: false };
const checked = codecs.parseCompanionBackup(JSON.stringify(fixture)); assert.ok(checked.ok, 'Large progress must pass the existing portable parser.');
const portableBytes = Buffer.byteLength(JSON.stringify(checked.value, null, 2));
assert.ok(portableBytes > 3.5 * 1024 * 1024 && portableBytes <= 4 * 1024 * 1024);
const wrapped = codecs.exportCompanionStored({ progress: checked.value, legacyBaseline: null }); assert.ok(wrapped.ok);
const guestBytes = Buffer.byteLength(guestKey) + Buffer.byteLength(wrapped.value);
assert.ok(guestBytes < 5 * 1024 * 1024, 'The original guest document must fit its existing localStorage quota.');

const php = process.env.PHP_BINARY || 'php';
const phpDir = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const flags = process.platform === 'win32' ? ['-d', `extension_dir=${join(phpDir, 'ext')}`] : [];
const loaded = execFileSync(php, ['-r', 'echo implode(",",get_loaded_extensions());'], { encoding: 'utf8' }).split(',');
for (const extension of ['pdo_mysql', 'openssl', 'curl', 'mbstring']) if (!loaded.includes(extension)) flags.push('-d', `extension=${extension}`);
const database = `accounts_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
mkdirSync(join(root, 'tmp'), { recursive: true });
const temporary = mkdtempSync(join(root, 'tmp/accounts-large-browser-'));
const output = join(root, 'output/accounts-large-browser'); mkdirSync(output, { recursive: true });
const env = { ...process.env, ACCOUNTS_TEST_DATABASE: database, REPORTING_DSN: '' };
const databaseCommand = action => execFileSync(php, [...flags, join(root, 'tests/accounts/database.php'), action], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const messages = [];
const smtp = createServer(socket => {
  socket.setEncoding('utf8'); socket.write('220 localhost capacity SMTP\r\n');
  let buffer = '', inData = false, message = '';
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const boundary = buffer.indexOf('\r\n'), line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      if (inData) { if (line === '.') { messages.push(message); message = ''; inData = false; socket.write('250 queued\r\n'); } else message += line + '\n'; }
      else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 localhost\r\n');
      else if (/^DATA/i.test(line)) { inData = true; socket.write('354 send message\r\n'); }
      else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
const portSocket = createServer(); await new Promise(resolve => portSocket.listen(0, '127.0.0.1', resolve));
const port = portSocket.address().port; await new Promise(resolve => portSocket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const privateConfig = { enabled: true, migrationEnabled: true, dsn: process.env.ACCOUNTS_TEST_DSN.replace(/;?dbname=[^;]*/i, '') + `;dbname=${database}`, username: process.env.ACCOUNTS_TEST_USER || 'root', password: process.env.ACCOUNTS_TEST_PASSWORD || '', secret: randomBytes(32).toString('hex'), allowedOrigin: origin, smtp: { host: '127.0.0.1', port: smtp.address().port, encryption: '', username: '', password: '', from: 'accounts@example.test' }, google: { clientId: '', clientSecret: '' } };
env.ACCOUNTS_CONFIG = join(temporary, 'accounts.php');
writeFileSync(env.ACCOUNTS_CONFIG, `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(privateConfig)).toString('base64')}'), true, 512, JSON_THROW_ON_ERROR);\n`);

let browser, context, page, server, created = false, phpOutput = '', active = 'startup';
const completed = [], pageErrors = [];
const dialog = () => page.getByRole('dialog', { name: 'Account & sync', exact: true });
const spoilers = () => page.locator('.companion-page-controls input[type=checkbox]');
async function scenario(name, run) { active = name; await run(); completed.push(name); console.log(`Passed: ${name}`); }
async function openControls() { if (!await dialog().isVisible()) await page.getByRole('button', { name: /^Account & sync/ }).click(); await expect(dialog()).toBeVisible(); }
async function closeControls() { if (await dialog().isVisible()) await page.keyboard.press('Escape'); }
async function waitForAccountIdle(accountId) {
  await expect.poll(() => page.evaluate(async prefix => (await navigator.locks.query()).held.filter(lock => lock.name?.startsWith(prefix)).length, `idle-slayer-companion.accounts.v1.${encodeURIComponent(accountId)}.`), { timeout: 30_000 }).toBe(0);
}
async function readRecord(key) {
  return page.evaluate(async ({ databaseName, storeName, key }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  }, { databaseName, storeName, key });
}
async function bundleMetrics(accountId) {
  const text = await readRecord(`idle-slayer-companion.accounts.v1.${encodeURIComponent(accountId)}`);
  if (!text) return null;
  const bundle = JSON.parse(text), raw = JSON.parse(bundle.raw[guestKey]), pending = bundle.pending.progress;
  return { bundleBytes: Buffer.byteLength(text), rawSpoilers: raw.progress.ascension.showSpoilers, acknowledgedSequence: bundle.remote.progress?.acknowledgedSequence ?? 0, recordCount: Object.keys(raw.progress.modules.material.records).length, exactCount: raw.progress.modules.material.records['unknown-large-3649'].count, pending: pending ? { operationId: pending.operationId, mutationSequence: pending.mutationSequence, bytes: Buffer.byteLength(JSON.stringify(pending.state)), spoilers: pending.state.ascension.showSpoilers, stateHash: hash(JSON.stringify(pending.state)) } : null };
}
async function auth() { const response = await context.request.get(origin + '/api/v1/auth.php?action=session'); assert.equal(response.status(), 200); return response.json(); }
async function serverDocument(accountId, name) {
  const response = await context.request.get(`${origin}/api/v1/sync.php?${new URLSearchParams({ action: 'read', app: 'idle-slayer-companion', document: name, clientId: randomUUID() })}`, { headers: { 'X-Account-ID': accountId } });
  assert.equal(response.status(), 200); return (await response.json()).document;
}
async function failNextAccountWrite(accountId, kind) {
  await page.evaluate(({ key, kind }) => {
    const original = IDBObjectStore.prototype.put;
    window.__accountFault = { fired: false };
    IDBObjectStore.prototype.put = function(value, recordKey) {
      if (recordKey !== key || window.__accountFault.fired) return original.call(this, value, recordKey);
      window.__accountFault.fired = true; IDBObjectStore.prototype.put = original;
      if (kind === 'quota') throw new DOMException('Fixture quota exhausted', 'QuotaExceededError');
      const request = original.call(this, value, recordKey), transaction = this.transaction;
      request.addEventListener('success', () => {
        window.__accountFault.statusBeforeAbort = document.querySelector('.progress-save-status')?.textContent;
        transaction.abort();
      });
      return request;
    };
  }, { key: `idle-slayer-companion.accounts.v1.${encodeURIComponent(accountId)}`, kind });
}
async function retryVisitSave() {
  await page.getByRole('button', { name: 'Review recovery', exact: true }).first().click();
  await page.getByRole('button', { name: 'Retry recovery', exact: true }).click();
  await expect(page.locator('.progress-save-status')).toHaveText('Current progress is saved on this device.', { timeout: 30_000 });
  await page.keyboard.press('Escape');
}
try {
  databaseCommand('create'); created = true;
  server = spawn(php, [...flags, '-d', 'display_errors=0', '-d', 'log_errors=1', '-S', `127.0.0.1:${port}`, '-t', dist], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', chunk => { phpOutput += chunk.toString(); });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/account/')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === origin || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort(); });
  await context.addInitScript(({ origin, guestKey, raw }) => {
    if (location.origin !== origin || localStorage.getItem('accounts-large-fixture-ready')) return;
    localStorage.setItem(guestKey, raw);
    localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'); localStorage.setItem('umami.disabled', '1');
    localStorage.setItem('accounts-large-fixture-ready', '1');
  }, { origin, guestKey, raw: wrapped.value });
  page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  let accountId, originalRawHash, frozen, initialIDBBytes;
  await scenario('existing parser accepts a near-4MiB portable guest without widening limits', async () => {
    await page.goto(origin + '/utilities/idle-slayer-companion/');
    await expect(page.getByRole('button', { name: /^Account & sync/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.progress-save-status')).toHaveText('Current progress is saved on this device.');
    const raw = await page.evaluate(key => localStorage.getItem(key), guestKey); originalRawHash = hash(raw);
    assert.equal(originalRawHash, hash(wrapped.value));
    assert.equal(await page.evaluate(keys => keys.filter(key => localStorage.getItem(key) !== null).length, guestKeys), 1);
  });
  await scenario('real mailed OTP signs in and all four large documents migrate through the UI', async () => {
    await page.goto(origin + '/account/'); await expect(page.locator('#account-signed-out')).toBeVisible();
    const email = `large-${randomBytes(4).toString('hex')}@example.test`;
    await page.locator('#account-email').fill(email); await page.locator('#account-email-submit').click();
    await expect(page.locator('#account-code-form')).toBeVisible(); await expect.poll(() => messages.length).toBe(1);
    const code = messages[0].match(/code is:\s*(\d{6})/)[1]; await page.locator('#account-code').fill(code); await page.locator('#account-code-form button[type=submit]').click();
    await expect(page.locator('#account-signed-in')).toBeVisible(); accountId = (await auth()).user.id;
    await page.goto(origin + '/utilities/idle-slayer-companion/'); await expect(page.getByRole('button', { name: /^Account & sync/ })).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle'); await openControls();
    await dialog().getByRole('button', { name: 'Review and connect saved data', exact: true }).click();
    await expect(dialog().getByRole('region', { name: 'Review first account connection' })).toBeVisible({ timeout: 30_000 });
    for (const name of ['progress', 'intentions', 'checkpoints', 'comparison']) await dialog().locator(`input[name="connect-${name}"]`).first().check();
    await dialog().getByRole('button', { name: 'Connect and verify all saved data', exact: true }).click();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), activeKey), { timeout: 60_000 }).toBe(accountId);
    assert.equal(hash(await page.evaluate(key => localStorage.getItem(key), guestKey)), originalRawHash);
    for (const name of ['progress', 'intentions', 'checkpoints', 'comparison']) assert.ok(await serverDocument(accountId, name));
    const remote = await serverDocument(accountId, 'progress');
    assert.equal(Object.keys(remote.state.modules.material.records).length, recordCount); assert.equal(remote.state.modules.material.records['unknown-large-3649'].count, exactCount);
    const records = await page.evaluate(async ({ databaseName, storeName }) => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll(); request.onsuccess = () => resolve(request.result.map(value => ({ bytes: new TextEncoder().encode(value).length }))); request.onerror = () => reject(request.error); }); } finally { db.close(); }
    }, { databaseName, storeName });
    initialIDBBytes = records.reduce((total, record) => total + record.bytes, 0);
    assert.ok(initialIDBBytes > 15 * 1024 * 1024, 'Migration journal, recovery and account data must exceed localStorage capacity without duplication there.');
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('idle-slayer-companion.accounts.v1.'))), [], 'Large account/recovery data must not be copied into guest Web Storage.');
  });
  await scenario('native service worker reopens an account offline with a durable >1MiB frozen outbox', async () => {
    await closeControls();
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 90_000 }).toBe(true);
    await page.reload(); await expect(spoilers()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60_000 }).toBe(true);
    await openControls();
    await expect(dialog()).toContainText('Account changes synced.', { timeout: 30_000 });
    await closeControls();
    await waitForAccountIdle(accountId);
    await context.setOffline(true); await spoilers().check();
    await expect(page.locator('.progress-save-status')).toHaveText('Current progress is saved on this device.', { timeout: 30_000 });
    frozen = await bundleMetrics(accountId); assert.ok(frozen.pending?.bytes > 1024 * 1024); assert.equal(frozen.pending.spoilers, true);
    assert.equal(frozen.rawSpoilers, true); assert.equal(frozen.recordCount, recordCount); assert.equal(frozen.exactCount, exactCount);
    await page.reload(); await expect(spoilers()).toBeChecked({ timeout: 30_000 });
    assert.deepEqual((await bundleMetrics(accountId)).pending, frozen.pending, 'Offline reopening must preserve the exact frozen request.');
    await spoilers().uncheck(); await expect(page.locator('.progress-save-status')).toHaveText('Current progress is saved on this device.', { timeout: 30_000 });
    const tail = await bundleMetrics(accountId); assert.equal(tail.rawSpoilers, false); assert.deepEqual(tail.pending, frozen.pending);
  });
  for (const kind of ['abort', 'quota']) await scenario(`native IndexedDB ${kind} never reports an unsaved visit as saved`, async () => {
    const before = await bundleMetrics(accountId), desired = !before.rawSpoilers;
    await failNextAccountWrite(accountId, kind); await spoilers().setChecked(desired);
    await expect.poll(() => page.evaluate(() => window.__accountFault?.fired)).toBe(true);
    await expect(page.locator('.progress-save-status')).toContainText('not saved', { timeout: 30_000 });
    if (kind === 'abort') assert.match(await page.evaluate(() => window.__accountFault.statusBeforeAbort), /Saving current progress/, 'The visit must still be Saving before its transaction commits.');
    assert.equal((await bundleMetrics(accountId)).rawSpoilers, before.rawSpoilers, 'Aborted/quota transaction must leave the durable document unchanged.');
    assert.deepEqual((await bundleMetrics(accountId)).pending, frozen.pending);
    await openControls();
    const [download] = await Promise.all([page.waitForEvent('download'), dialog().getByRole('button', { name: /^Export .*device copy$/ }).click()]);
    const file = join(output, `${kind}-exportable-visit.json`); await download.saveAs(file);
    const exported = JSON.parse(readFileSync(file, 'utf8')); assert.equal(exported.visit.progress.ascension.showSpoilers, desired);
    await closeControls(); await retryVisitSave(); assert.equal((await bundleMetrics(accountId)).rawSpoilers, desired);
  });
  await scenario('reconnection replays the original mutation then its newer tail without losing guest data', async () => {
    await context.setOffline(false); await openControls(); await dialog().getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect.poll(async () => (await bundleMetrics(accountId))?.pending, { timeout: 60_000 }).toBe(null);
    const remote = await serverDocument(accountId, 'progress'), metrics = await bundleMetrics(accountId);
    assert.equal(remote.revision, 3, 'The original frozen mutation and its newer tail must both commit exactly once after adoption.');
    assert.equal(metrics.acknowledgedSequence, 2);
    assert.equal(remote.state.ascension.showSpoilers, metrics.rawSpoilers); assert.equal(remote.state.modules.material.records['unknown-large-3649'].count, exactCount);
    assert.equal(hash(await page.evaluate(key => localStorage.getItem(key), guestKey)), originalRawHash);
    await page.reload(); await expect(spoilers()).toBeVisible({ timeout: 30_000 });
    assert.equal((await bundleMetrics(accountId)).pending, null);
  });
  assert.deepEqual(pageErrors, [], 'Capacity scenarios must have no browser runtime errors.');
  assert.ok(!messages.some(message => phpOutput.includes(message.match(/code is:\s*(\d{6})/)[1])), 'OTP entered diagnostics.');
  writeFileSync(join(output, 'results.json'), JSON.stringify({ completed, portableBytes, guestBytes, initialIDBBytes, recordCount, frozenOutboxBytes: frozen.pending.bytes, runtimeErrors: pageErrors }, null, 2));
  console.log(`Large account browser acceptance passed (${portableBytes} portable bytes; ${frozen.pending.bytes} frozen outbox bytes).`);
} catch (error) {
  const accountStatus = page && await page.locator('.companion-account-panel').count() ? await page.locator('.companion-account-panel').innerText().catch(() => '') : '';
  writeFileSync(join(output, 'failure.json'), JSON.stringify({ active, completed, message: error.message, accountStatus, pageErrors }, null, 2));
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: false }).catch(() => {});
  throw error;
} finally {
  if (context) await context.close().catch(() => {}); if (browser) await browser.close();
  if (server) { server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
  await new Promise(resolve => smtp.close(resolve)); if (created) databaseCommand('drop');
}
