import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Real production PHP handlers, isolated localhost MySQL, and a loopback SMTP sink.
// Authentication always verifies an actual mailed code. No bypass exists in the API.
const root = fileURLToPath(new URL('../', import.meta.url));
const php = process.env.PHP_BINARY || 'php';
const phpDir = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const flags = process.platform === 'win32' ? ['-d', `extension_dir=${join(phpDir, 'ext')}`] : [];
const loaded = execFileSync(php, ['-r', 'echo implode(",",get_loaded_extensions());'], { encoding: 'utf8' }).split(',');
for (const extension of ['pdo_mysql', 'openssl', 'curl', 'mbstring']) if (!loaded.includes(extension)) flags.push('-d', `extension=${extension}`);
assert.ok(process.env.ACCOUNTS_TEST_DSN, 'Set ACCOUNTS_TEST_DSN to an isolated localhost MySQL admin DSN.');
const database = `accounts_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
mkdirSync(join(root, 'tmp'), { recursive: true });
const temporary = mkdtempSync(join(root, 'tmp/accounts-api-'));
const configFile = join(temporary, 'private-config.php');
const env = { ...process.env, ACCOUNTS_CONFIG: configFile, ACCOUNTS_TEST_DATABASE: database, REPORTING_DSN: '' };
if (!env.OPENSSL_CONF && process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/ssl/openssl.cnf')) env.OPENSSL_CONF = 'C:/Program Files/Git/usr/ssl/openssl.cnf';
const databaseCommand = (action, fixture = {}) => execFileSync(php, [...flags, join(root, 'tests/accounts/database.php'), action], { env: { ...env, ...fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
const messages = [];
const smtp = createServer(socket => {
  socket.setEncoding('utf8'); socket.write('220 localhost test SMTP\r\n');
  let buffer = '', data = false, message = '';
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const boundary = buffer.indexOf('\r\n'); const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      if (data) { if (line === '.') { messages.push(message); message = ''; data = false; socket.write('250 queued\r\n'); } else message += line + '\n'; continue; }
      if (/^(EHLO|HELO)/i.test(line)) socket.write('250 localhost\r\n');
      else if (/^DATA/i.test(line)) { data = true; socket.write('354 send message\r\n'); }
      else if (/^QUIT/i.test(line)) { socket.end('221 bye\r\n'); }
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
const smtpPort = smtp.address().port;
let config = {
  enabled: true, migrationEnabled: true,
  dsn: process.env.ACCOUNTS_TEST_DSN.replace(/;?dbname=[^;]*/i, '') + `;dbname=${database}`,
  username: process.env.ACCOUNTS_TEST_USER || 'root', password: process.env.ACCOUNTS_TEST_PASSWORD || '',
  secret: randomBytes(32).toString('hex'), allowedOrigin: 'http://127.0.0.1:1',
  smtp: { host: '127.0.0.1', port: smtpPort, encryption: '', username: '', password: '', from: 'accounts@example.test' },
  google: { clientId: 'local-fixture.apps.googleusercontent.com', clientSecret: 'local-fixture' },
};
const saveConfig = () => writeFileSync(configFile, `<?php\nreturn json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'), true, 512, JSON_THROW_ON_ERROR);\n`);
const processes = []; let created = false, phpOutput = '';
async function freePort() { const s = createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port; }
async function startServer() {
  const port = await freePort();
  const child = spawn(php, [...flags, '-d', 'display_errors=0', '-d', 'log_errors=1', '-S', `127.0.0.1:${port}`, '-t', join(root, 'public')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  processes.push(child); child.stderr.on('data', chunk => { phpOutput += chunk.toString(); });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { await fetch(origin + '/favicon.svg'); return origin; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  throw new Error('Local accounts PHP server did not start.');
}
let origin, parallel;
function browser() { return { cookie: '', cookies: new Map(), session: null }; }
function rememberCookies(client, headers) {
  for (const cookie of headers.getSetCookie()) {
    assert.match(cookie, /Secure/i); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /;\s*path=\//i); assert.ok(!/;\s*domain=/i.test(cookie));
    const pair = cookie.split(';')[0], at = pair.indexOf('='), name = pair.slice(0, at), value = pair.slice(at + 1);
    assert.ok(['__Host-ag-session', '__Host-ag-oauth'].includes(name), 'Unexpected authentication cookie');
    assert.match(cookie, name === '__Host-ag-session' ? /SameSite=Lax/i : /SameSite=None/i);
    if (/Max-Age=0/i.test(cookie)) client.cookies.delete(name); else client.cookies.set(name, value);
  }
  client.cookie = [...client.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}
async function request(client, file, action, body, query = {}, extra = {}, server = origin) {
  const headers = { Accept: 'application/json', ...(client.cookie ? { Cookie: client.cookie } : {}), ...extra };
  if (file === 'sync' && client.session?.user) headers['X-Account-ID'] ??= client.session.user.id;
  if (body !== undefined) { headers['Content-Type'] ??= 'application/json'; headers.Origin ??= origin; headers['X-CSRF-Token'] ??= client.session?.csrfToken || ''; }
  const response = await fetch(`${server}/api/v1/${file}.php?${new URLSearchParams({ action, ...query })}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  rememberCookies(client, response.headers);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  const data = await response.json(); if (file === 'auth' && response.ok && typeof data.csrfToken === 'string') client.session = data;
  return { status: response.status, data, headers: response.headers };
}
async function login(client, email) {
  assert.equal((await request(client, 'auth', 'session')).status, 200);
  const sent = await request(client, 'auth', 'email-start', { email }); assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const mail = messages.at(-1); assert.ok(mail?.includes(email)); const code = mail.match(/code is:\s*(\d{6})/)[1];
  const verified = await request(client, 'auth', 'email-verify', { challengeId: sent.data.challengeId, code }); assert.equal(verified.status, 200, JSON.stringify(verified.data));
  assert.equal(client.session.user.email, email); return { challengeId: sent.data.challengeId, code };
}
const binder = (ownedDexIds = []) => ({ schemaVersion: 1, settings: { columns: 3, rows: 3, useBackSides: true, leadingBlankPockets: 0 }, ownedDexIds });
const app = 'pokedex-binder', document = 'binder';
const write = (state, baseRevision, clientId, mutationSequence = 1) => ({ app, document, schemaVersion: 1, state, baseRevision, clientId, mutationSequence, operationId: randomUUID() });

async function testBinderSharing(other) {
  const owner = browser(), viewer = browser();
  const manage = (client, body, query, headers) => request(client, 'sync', 'binder-share', body, query, headers);
  const read = token => request(viewer, 'binder-share', '', undefined, {}, { 'X-Binder-Share-Token': token });
  await login(owner, 'sharing@example.test');
  const client = randomUUID();
  const national = { ...binder([1]), orderedDexIds: [2] };
  const publishNational = { binder: 'national', action: 'publish', version: 0, documentRevision: 1 };
  assert.equal((await manage(viewer, publishNational)).status, 401);
  assert.equal((await manage(owner, publishNational)).data.error.code, 'binder_not_synced');
  assert.equal((await request(owner, 'sync', 'write', write(national, 0, client))).status, 200);
  assert.equal((await manage(owner, publishNational, {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await manage(owner, publishNational, {}, { Origin: 'https://external.example.test' })).status, 403);
  const published = await manage(owner, publishNational);
  assert.equal(published.status, 200);
  assert.match(published.data.token, /^pbs_[a-f0-9]{64}$/);
  const nationalToken = published.data.token;
  assert.deepEqual((await manage(other, undefined, { binder: 'national' })).data, { version: 0, token: null });
  assert.equal((await manage(other, undefined, { binder: 'national' }, { 'X-Account-ID': owner.session.user.id })).status, 409);
  const shared = await read(nationalToken);
  assert.equal(shared.status, 200);
  assert.equal(shared.headers.get('set-cookie'), null);
  assert.equal(shared.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(shared.data, { kind: 'national', settings: national.settings, ownedDexIds: [1], orderedDexIds: [2] });
  assert.equal((await request(viewer, 'binder-share', '', {}, {}, { 'X-Binder-Share-Token': nationalToken })).status, 405);
  assert.equal((await read('missing')).status, 404);

  const updated = { ...national, ownedDexIds: [1, 3] };
  assert.equal((await request(owner, 'sync', 'write', write(updated, 1, client, 2))).status, 200);
  assert.deepEqual((await read(nationalToken)).data.ownedDexIds, [1, 3]);
  const revoke = { binder: 'national', action: 'revoke', version: published.data.version };
  assert.equal((await manage(owner, revoke)).status, 200);
  assert.equal((await read(nationalToken)).status, 404);
  assert.equal((await manage(owner, publishNational)).data.error.code, 'share_changed');
  assert.equal((await manage(owner, { ...publishNational, version: 2 })).data.error.code, 'binder_changed');
  const second = await manage(owner, { ...publishNational, version: 2, documentRevision: 2 });
  assert.equal(second.status, 200);
  assert.notEqual(second.data.token, nationalToken);
  assert.equal((await request(owner, 'sync', 'write', write({ ...updated, enabled: false }, 2, client, 3))).status, 200);
  assert.equal((await request(owner, 'sync', 'write', write({ ...updated, enabled: true }, 3, client, 4))).status, 200);
  assert.equal((await read(second.data.token)).status, 404);

  const extra = { id: randomUUID(), name: 'Binder <Friends> & Family', number: 'P01', required: false };
  const set = { id: randomUUID(), name: 'Shared 151', setId: 'sv03.5', goal: 'numbers', order: 'together',
    settings: national.settings, extras: [extra], owned: ['001:normal'], ordered: ['002:reverse', 'extra:' + extra.id], specialties: [] };
  const setWrite = (binders, revision) => ({
    ...write({ schemaVersion: 1, binders }, revision, client, revision + 1), document: 'master-sets',
  });
  const sibling = { ...set, id: randomUUID(), name: 'Private sibling' };
  assert.equal((await request(owner, 'sync', 'write', setWrite([set, sibling], 0))).status, 200);
  const publishSet = { ...publishNational, binder: set.id };
  assert.equal((await manage(other, publishSet)).data.error.code, 'binder_not_synced');
  const sharedSet = await manage(owner, publishSet);
  assert.equal(sharedSet.status, 200);
  const publicSet = await read(sharedSet.data.token);
  const { id: _omitted, ...publicFields } = set;
  assert.deepEqual(publicSet.data, { ...publicFields, kind: 'set', owned: ['001:*'], ordered: ['002:*', 'extra:1'],
    extras: [{ ...extra, id: '1' }] });
  assert.equal((await request(owner, 'sync', 'write', setWrite([sibling], 1))).status, 200);
  assert.equal((await read(sharedSet.data.token)).status, 404);
  const recovery = await request(owner, 'sync', 'recovery-list', undefined, { app });
  const snapshot = recovery.data.snapshots.find(item => item.document === 'master-sets');
  assert.ok(snapshot, 'The pre-deletion set binder should have a recovery copy.');
  assert.equal((await request(owner, 'sync', 'recovery-restore',
    { id: snapshot.id, baseRevision: 2, clientId: client, operationId: randomUUID() })).status, 200);
  assert.equal((await read(sharedSet.data.token)).status, 404);
  assert.deepEqual((await manage(owner, undefined, { binder: set.id })).data, { version: 2, token: null });
  console.log('Binder sharing: owner controls, cookie-free projection, live sync, revocation, and restoration passed.');
}

async function testBinderStockAlerts(other) {
  const subscriber = browser();
  const action = 'binder-stock-alerts';
  assert.equal((await request(subscriber, 'sync', action)).status, 401);
  await login(subscriber, 'alerts@example.test');
  const userId = subscriber.session.user.id;
  const initial = await request(subscriber, 'sync', action);
  assert.equal(initial.status, 200);
  assert.equal(initial.data.hasSyncedBinders, false);
  assert.deepEqual(initial.data.alerts, []);
  const settings = { revision: initial.data.revision, alerts: [{ store: '401 Games', minimum: 2 }] };
  assert.equal((await request(subscriber, 'sync', action, settings, {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await request(other, 'sync', action, undefined, {}, { 'X-Account-ID': userId })).status, 409);
  for (const alerts of [
    [{ store: 'Other store', minimum: 2 }], [{ store: '401 Games', minimum: 0 }],
    [{ store: '401 Games', minimum: 1.5 }], [...settings.alerts, ...settings.alerts],
  ]) assert.equal((await request(subscriber, 'sync', action, { ...settings, alerts })).status, 422);
  const saved = await request(subscriber, 'sync', action, settings);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.alerts, [{ ...settings.alerts[0], lastCheckedAt: null }]);
  assert.equal((await request(subscriber, 'sync', action, { ...settings, alerts: [] })).status, 409);
  assert.deepEqual((await request(other, 'sync', action)).data.alerts, []);

  const cards = JSON.parse(readFileSync(join(root, 'public/utilities/pokedex-binder/catalog/master-sets/sv03.5.json')));
  const setBinder = {
    id: randomUUID(), name: '151', setId: 'sv03.5', goal: 'numbers', order: 'together',
    settings: { columns: 3, rows: 3, useBackSides: true, leadingBlankPockets: 0 },
    owned: cards.slice(3).map(card => card.number + ':*'), ordered: ['003:*'], specialties: [], extras: [],
  };
  const collection = { schemaVersion: 1, binders: [setBinder, { ...setBinder, id: randomUUID(), name: 'Second binder' }] };
  const collectionWrite = { ...write(collection, 0, randomUUID()), document: 'master-sets' };
  assert.equal((await request(subscriber, 'sync', 'write', collectionWrite)).status, 200);
  assert.equal((await request(subscriber, 'sync', action)).data.hasSyncedBinders, true);

  const run = async phase => (await promisify(execFile)(php, [
    ...flags, join(root, 'tests/pokedex-binder/stock-alerts-fixture.php'), userId, phase,
  ], { env })).stdout.trim();
  const before = messages.length;
  assert.equal(await run('one-card'), 'checked');
  assert.equal(messages.length, before, 'Two finishes or two binders must not satisfy a two-card minimum for one wildcard slot.');
  assert.equal(await run('two-cards'), 'sent');
  assert.equal(messages.length, before + 1);
  assert.match(messages.at(-1), /To: alerts@example\.test/);
  assert.match(messages.at(-1), /Subject: 2 missing cards in stock at 401 Games/);
  assert.match(messages.at(-1), /\/pokemon-binder\/buy-cards\/\?alerts=1/);
  assert.ok((await request(subscriber, 'sync', action)).data.alerts[0].lastCheckedAt);
  assert.equal(await run('elapsed'), 'checked', 'The same stock must not resend after the daily cooldown.');
  assert.equal(await run('unavailable'), 'checked');
  assert.equal(await run('two-cards'), 'checked', 'A failed lookup must not look like a restock.');
  assert.equal(await run('sold-out'), 'checked');
  assert.equal(await run('binder-change'), 'binder-changed', 'A changed synced binder must invalidate the pending email.');
  assert.equal(await run('two-cards'), 'sent', 'A confirmed sold-out card can trigger a new email when it returns.');
  assert.equal(messages.length, before + 2);
  const paused = await request(subscriber, 'sync', action, { revision: saved.data.revision, alerts: [] });
  assert.equal(paused.status, 200);
  assert.equal(await run('two-cards'), 'idle');
  const resumed = await request(subscriber, 'sync', action, { revision: paused.data.revision, alerts: settings.alerts });
  assert.equal(resumed.status, 200);
  assert.equal(await run('sold-out'), 'checked');
  assert.equal(await run('two-cards'), 'checked', 'Re-enabling a store must preserve the daily email limit.');
  assert.equal(messages.length, before + 2);
  const cafe = await request(subscriber, 'sync', action, { revision: resumed.data.revision, alerts: [{ store: 'Swirl Café & Games', minimum: 3 }] });
  assert.equal(cafe.status, 200);
  assert.equal(cafe.data.alerts[0].store, 'Swirl Café & Games');
  console.log('Binder stock alerts: scoped settings, minimum, exact lookups, restocks, duplicate suppression and SMTP passed.');
  return userId;
}

try {
  execFileSync(process.execPath, [join(root, 'scripts/test-accounts-smtp-tls.mjs')], {
    env: { ...env, PHP_BINARY: php }, stdio: ['ignore', 'inherit', 'pipe'],
  });
  execFileSync(process.execPath, [join(root, 'scripts/test-accounts-config-cache-http.mjs')], {
    env: { ...env, PHP_BINARY: php }, stdio: ['ignore', 'inherit', 'pipe'],
  });
  databaseCommand('create'); created = true;
  saveConfig(); [origin, parallel] = await Promise.all([startServer(), startServer()]); config.allowedOrigin = origin; saveConfig();
  execFileSync(php, [...flags, join(root, 'server/accounts/migrate.php'), configFile], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(php, [...flags, join(root, 'tests/accounts/validators.test.php')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(php, [...flags, join(root, 'tests/accounts/preview.test.php')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const cacheFlags = [...flags, '-d', 'opcache.enable_cli=1', '-d', 'opcache.validate_timestamps=0', '-d', 'opcache.file_update_protection=0'];
  if (process.platform === 'win32' && !loaded.includes('Zend OPcache')) cacheFlags.push('-d', `zend_extension=${join(phpDir, 'ext/php_opcache.dll')}`);
  execFileSync(php, [...cacheFlags, join(root, 'tests/accounts/config-cache.test.php')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(php, [...cacheFlags, '-d', 'disable_functions=opcache_invalidate', join(root, 'tests/accounts/config-cache.test.php'), 'restricted'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(php, [...flags, join(root, 'tests/accounts/oauth-form.test.php')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(php, [...flags, join(root, 'tests/accounts/auth-race.test.php')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  // The production routes can be verified privately while the file's public
  // switches remain false. Forwarding headers never select an operator.
  config.enabled = false; config.migrationEnabled = false;
  config.preview = { enabled: true, migrationEnabled: false, addresses: ['127.0.0.2'] }; saveConfig();
  const publicClient = browser();
  let gated = await request(publicClient, 'auth', 'session', undefined, {}, { 'X-Forwarded-For': '127.0.0.2', 'X-Real-IP': '127.0.0.2', Forwarded: 'for=127.0.0.2' });
  assert.deepEqual(gated.data, { enabled: false, migrationEnabled: false, user: null, csrfToken: '' });
  assert.equal((await request(publicClient, 'auth', 'email-start', { email: 'blocked@example.test' })).status, 503);
  assert.equal((await request(publicClient, 'sync', 'read', undefined, { app, document, clientId: randomUUID() })).status, 503);
  assert.equal(messages.length, 0, 'Unlisted clients must not send mail');
  config.preview.addresses = ['127.0.0.1']; saveConfig();
  const operator = browser();
  gated = await request(operator, 'auth', 'session');
  assert.equal(gated.data.enabled, true); assert.equal(gated.data.migrationEnabled, false);
  assert.equal((await request(operator, 'sync', 'read', undefined, { app, document, clientId: randomUUID() })).status, 401, 'Preview must still require login');
  await login(operator, 'preview@example.test');
  const privateStage = { migrationId: randomUUID(), app, document, variant: 'selected', schemaVersion: 1, state: binder([1]), baseRevision: 0 };
  assert.equal((await request(operator, 'sync', 'migration-stage', privateStage)).status, 503, 'Preview migrations require their own switch');
  config.preview.migrationEnabled = true; saveConfig();
  assert.equal((await request(operator, 'sync', 'migration-stage', privateStage)).status, 200, 'Selected operator can verify real staging without public access');
  config.preview.enabled = false; saveConfig();
  assert.equal((await request(operator, 'auth', 'session')).data.enabled, false, 'Disabling preview also gates existing operator sessions');
  assert.equal((await request(operator, 'sync', 'migration-stage', privateStage)).status, 503);
  config.enabled = true; config.migrationEnabled = true; config.preview.addresses = []; saveConfig();
  const a = browser(), b = browser(), clientId = randomUUID(), client2 = randomUUID();
  const unauth = await request(a, 'sync', 'read', undefined, { app, document, clientId }); assert.equal(unauth.status, 401);
  await request(a, 'auth', 'session');
  assert.equal((await request(a, 'auth', 'email-start', { email: 'one@example.test' }, {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await request(a, 'auth', 'email-start', { email: 'one@example.test' }, {}, { Origin: 'https://external.example' })).status, 403);
  const retiredPreauth = { cookie: a.cookie, cookies: new Map(a.cookies), session: structuredClone(a.session) };
  const proof = await login(a, 'one@example.test');
  const currentCookie = a.cookies.get('__Host-ag-session'), currentUserId = a.session.user.id, sentBeforeRetiredRequests = messages.length;
  for (const [action, body] of [
    ['email-start', { email: 'retired-http@example.test' }],
    ['email-verify', proof], ['google-start', {}], ['logout', {}], ['logout-all', {}],
  ]) {
    const retired = await request(retiredPreauth, 'auth', action, body);
    assert.equal(retired.status, 409, `Retired ${action} must fail before response/session mutation`);
    assert.equal(retired.data.error.code, 'session_changed');
    assert.deepEqual(retired.headers.getSetCookie(), [], 'A retired auth POST must not replace the browser cookie');
  }
  const absentPost = await request(browser(), 'auth', 'email-start', { email: 'missing-session@example.test' });
  assert.equal(absentPost.status, 409); assert.equal(absentPost.data.error.code, 'session_changed');
  assert.deepEqual(absentPost.headers.getSetCookie(), [], 'An unauthenticated mutation must not create a replacement preauth cookie');
  assert.equal(messages.length, sentBeforeRetiredRequests, 'Retired/absent session requests must not send SMTP messages');
  const retiredGet = await request(retiredPreauth, 'auth', 'session');
  assert.deepEqual(retiredGet.headers.getSetCookie(), [], 'A retired-cookie discovery must never replace a newer browser cookie');
  assert.equal(retiredGet.data.requiresBootstrap, true); assert.equal(retiredGet.data.csrfToken, ''); assert.equal(retiredGet.data.user, null);
  const retiredCookie = retiredPreauth.cookies.get('__Host-ag-session');
  const bootstrapped = await request(retiredPreauth, 'auth', 'bootstrap', {});
  assert.equal(bootstrapped.status, 200); assert.equal(bootstrapped.data.user, null); assert.ok(bootstrapped.data.csrfToken);
  assert.notEqual(retiredPreauth.cookies.get('__Host-ag-session'), retiredCookie);
  assert.equal(bootstrapped.headers.getSetCookie().length, 1, 'An explicit retired-cookie bootstrap must create one fresh preauth cookie');
  const restartedCode = await request(retiredPreauth, 'auth', 'email-start', { email: 'bootstrap-restored@example.test' });
  assert.equal(restartedCode.status, 200, 'The fresh bootstrap CSRF token must support a deliberate emailed sign-in');
  const restartedProof = messages.at(-1).match(/code is:\s*(\d{6})/)[1];
  const restartedLogin = await request(retiredPreauth, 'auth', 'email-verify', { challengeId: restartedCode.data.challengeId, code: restartedProof });
  assert.equal(restartedLogin.status, 200); assert.equal(restartedLogin.data.user.email, 'bootstrap-restored@example.test');
  const unchangedBootstrap = await request(a, 'auth', 'bootstrap', {});
  assert.equal(unchangedBootstrap.status, 200); assert.equal(unchangedBootstrap.data.user.id, currentUserId);
  assert.deepEqual(unchangedBootstrap.headers.getSetCookie(), [], 'A valid current cookie must be returned unchanged by bootstrap');
  assert.equal((await request(browser(), 'auth', 'bootstrap', {}, {}, { Origin: 'https://attacker.example' })).status, 403, 'Cross-origin bootstrap must fail');
  assert.equal((await request(a, 'auth', 'session')).data.user.id, currentUserId);
  assert.equal(a.cookies.get('__Host-ag-session'), currentCookie, 'Rejected old POSTs must leave the current account cookie intact');
  assert.equal((await request(a, 'auth', 'email-verify', proof)).status, 401, 'OTP replay must fail after session rotation');
  await login(b, 'two@example.test');
  const stockAlertsUserId = await testBinderStockAlerts(b);
  await testBinderSharing(b);
  assert.equal((await request(a, 'sync', 'read', undefined, { app, document, clientId }, { 'X-Account-ID': b.session.user.id })).status, 409);
  assert.equal((await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document, null);
  const first = write(binder([1]), 0, clientId); let response = await request(a, 'sync', 'write', first); assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.document.revision, 1);
  assert.equal((await request(a, 'sync', 'write', first)).data.document.revision, 1);
  assert.equal((await request(a, 'sync', 'write', { ...first, state: binder([2]) })).status, 409);
  assert.equal((await request(b, 'sync', 'read', undefined, { app, document, clientId })).data.document, null);
  const retailerSetting = { schemaVersion: 1, mode: 'selected', stores: ['Pokemon Plug'] };
  const preferences = { ...write(retailerSetting, 0, randomUUID()), document: 'preferences' };
  for (const stores of [['unknown.example'], ['401 Games', '401 Games']]) {
    assert.equal((await request(a, 'sync', 'write', { ...preferences, state: { ...retailerSetting, stores } })).status, 422);
  }
  assert.equal((await request(a, 'sync', 'migration-stage', { migrationId: randomUUID(), app,
    document: 'preferences', variant: 'selected', schemaVersion: 1, state: retailerSetting, baseRevision: 0 })).status, 422);
  const savedPreferences = await request(a, 'sync', 'write', preferences);
  assert.equal(savedPreferences.status, 200, JSON.stringify(savedPreferences.data));
  assert.deepEqual(savedPreferences.data.document.state, retailerSetting);
  assert.equal((await request(b, 'sync', 'read', undefined, { app, document: 'preferences', clientId })).data.document, null);
  // Both processes contend for the same rate-limit bucket. None may deadlock
  // upgrading a shared insert lock before the document's revision lock.
  const sharedBucketReads = await Promise.all(Array.from({ length: 12 }, (_, index) => request(a, 'sync', 'read', undefined, { app, document, clientId }, {}, index % 2 ? parallel : origin)));
  assert.ok(sharedBucketReads.every(result => result.status === 200), 'Concurrent rate-limit access must not turn valid reads into 503s');
  response = await request(a, 'sync', 'write', write(binder([2]), 0, client2)); assert.equal(response.status, 409); assert.deepEqual(response.data.remote.state.ownedDexIds, [1]);
  const races = await Promise.all([request(a, 'sync', 'write', write(binder([1, 2]), 1, clientId, 2)), request(a, 'sync', 'write', write(binder([25]), 1, client2), {}, {}, parallel)]);
  assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
  const current = (await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document; assert.equal(current.revision, 2);
  assert.equal((await request(a, 'sync', 'write', first)).data.document.revision, 2, 'Lost response replay must read current state');
  const key = 'pdx_'+randomBytes(32).toString('base64url');
  const migrationId = randomUUID(), stage = { migrationId, app, document, schemaVersion: 1, baseRevision: current.revision };
  assert.equal((await request(a, 'sync', 'migration-stage', { ...stage, variant: 'selected', state: binder([1, 2, 25]) })).status, 200);
  assert.equal((await request(a, 'sync', 'migration-stage', { ...stage, variant: 'selected', state: binder([1]) })).status, 409);
  const commit = { migrationId, app, clientId, documents: [{ document, baseRevision: current.revision }] };
  const beforeMissingDevice = JSON.parse(databaseCommand('audit').toString());
  response = await request(a, 'sync', 'migration-commit', commit);
  assert.equal(response.status, 409); assert.equal(response.data.error.code, 'migration_incomplete');
  assert.deepEqual(JSON.parse(databaseCommand('audit').toString()), beforeMissingDevice, 'Missing device stage must not claim/revoke a key or create replacement recovery state');
  assert.deepEqual((await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document, current, 'Missing device stage must not replace the account binder');
  assert.equal((await request(a, 'sync', 'migration-stage', { ...stage, variant: 'device', state: binder([1, 2]) })).status, 200);
  assert.equal((await request(a, 'sync', 'migration-commit', { ...commit, legacy: { revision: 2 } }, {}, { 'X-Pokedex-Key': key })).status, 410);
  response = await request(a, 'sync', 'migration-commit', commit); assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.documents[0].revision, 3);
  assert.equal((await request(a, 'sync', 'migration-commit', commit)).status, 200);
  let snapshots = (await request(a, 'sync', 'recovery-list')).data.snapshots; assert.ok(snapshots.some(s => s.label === 'Device before migration')); assert.match(snapshots[0].createdAt, /Z$/);
  const saved = snapshots.find(s => s.label === 'Device before migration');
  assert.equal((await request(b, 'sync', 'recovery-read', undefined, { id: saved.id })).status, 404);
  assert.equal((await request(b, 'sync', 'recovery-restore', { id: saved.id, baseRevision: 0, clientId, operationId: randomUUID() })).status, 404);
  response = await request(a, 'sync', 'recovery-restore', { id: saved.id, baseRevision: 3, clientId, operationId: randomUUID() }); assert.equal(response.status, 200); assert.deepEqual(response.data.document.state.ownedDexIds, [1, 2]);
  assert.equal((await request(a, 'sync', 'recovery-delete', { id: saved.id })).status, 200); assert.equal((await request(a, 'sync', 'recovery-read', undefined, { id: saved.id })).status, 404);
  const binderRecovery = async () => (await request(a, 'sync', 'recovery-list', undefined, { app })).data.snapshots;
  const listBeforeRetention = await binderRecovery();
  const todaysCheckpoint = listBeforeRetention.find(copy => copy.label === 'Before sync');
  assert.ok(todaysCheckpoint);
  const beforeNoOp = (await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document;
  const noOp = write(beforeNoOp.state, beforeNoOp.revision, clientId, beforeNoOp.acknowledgedSequence + 1);
  const noOpResult = await request(a, 'sync', 'write', noOp);
  assert.equal(noOpResult.status, 200);
  assert.equal(noOpResult.data.document.revision, beforeNoOp.revision);
  assert.equal(noOpResult.data.document.acknowledgedSequence, noOp.mutationSequence);
  assert.deepEqual(await binderRecovery(), listBeforeRetention);
  const retainedDays = JSON.parse(databaseCommand('seed-daily-checkpoints', { ACCOUNTS_TEST_USER_ID: a.session.user.id }).toString());
  const routine = write(binder([4]), beforeNoOp.revision, clientId, noOp.mutationSequence + 1);
  response = await request(a, 'sync', 'write', routine);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const afterRoutine = await binderRecovery();
  assert.deepEqual(afterRoutine.filter(copy => copy.label === 'Before sync').map(copy => copy.id), [todaysCheckpoint.id, ...retainedDays]);
  assert.deepEqual(afterRoutine.filter(copy => copy.label !== 'Before sync'), listBeforeRetention.filter(copy => copy.label !== 'Before sync'));
  const replacement = { ...write(binder([7]), response.data.document.revision, clientId, routine.mutationSequence + 1), preservePrevious: true };
  assert.equal((await request(a, 'sync', 'write', replacement)).status, 200);
  assert.equal((await request(a, 'sync', 'write', replacement)).status, 200);
  const afterReplacement = await binderRecovery();
  const protectedCopies = afterReplacement.filter(copy => copy.label === 'Before replacement');
  assert.equal(protectedCopies.length, 1);
  assert.deepEqual((await request(a, 'sync', 'recovery-read', undefined, { id: protectedCopies[0].id })).data.snapshot.state, binder([4]));
  assert.deepEqual(afterReplacement.filter(copy => copy.label === 'Before sync'), afterRoutine.filter(copy => copy.label === 'Before sync'));
  // Every Slayer document is staged separately; all activate in one database transaction.
  const profile = { version: 1, catalogRevision: 'fixture', epoch: 0, purchases: {}, milestones: {}, showSpoilers: false };
  const modules = Object.fromEntries(['achievement', 'craft', 'material', 'quest', 'village', 'enemy', 'divinity'].map(s => [s, { tracked: false, records: {} }]));
  const slayer = {
    progress: { format: 'idle-slayer-companion-progress', version: 1, catalogRevision: 'fixture', ascension: profile, modules },
    intentions: { format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: {} },
    checkpoints: { kind: 'progress-checkpoints', version: 1, entries: [] }, comparison: { kind: 'upgrade-comparison', version: 1, ids: ['unknown-hidden'] },
  };
  const slayerMigration = randomUUID();
  for (const [name, state] of Object.entries(slayer)) { const staged = await request(a, 'sync', 'migration-stage', { migrationId: slayerMigration, app: 'idle-slayer-companion', document: name, variant: 'selected', schemaVersion: 1, state, baseRevision: 0 }); assert.equal(staged.status, 200, JSON.stringify(staged.data)); }
  const slayerCommit = { migrationId: slayerMigration, app: 'idle-slayer-companion', clientId, documents: Object.keys(slayer).map(name => ({ document: name, baseRevision: 0 })) };
  const beforeUnpaired = (await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document;
  response = await request(a, 'sync', 'migration-commit', slayerCommit);
  assert.equal(response.status, 409, 'First adoption must preserve every device copy');
  assert.equal(response.data.error.code, 'migration_incomplete');
  for (const name of Object.keys(slayer)) assert.equal((await request(a, 'sync', 'read', undefined, { app: 'idle-slayer-companion', document: name, clientId })).data.document, null, 'An incomplete migration must not activate any document');
  assert.deepEqual((await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document, beforeUnpaired, 'A rejected migration must not change another app');
  for (const [name, state] of Object.entries(slayer)) { const staged = await request(a, 'sync', 'migration-stage', { migrationId: slayerMigration, app: 'idle-slayer-companion', document: name, variant: 'device', schemaVersion: 1, state, baseRevision: 0 }); assert.equal(staged.status, 200, JSON.stringify(staged.data)); }
  response = await request(a, 'sync', 'migration-commit', slayerCommit); assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.documents.length, 4); assert.deepEqual(response.data.documents.find(d => d.document === 'comparison').state.ids, ['unknown-hidden']);
  // Later conflict resolution changes only a reviewed existing document and
  // cannot run until both the device copy and selected copy are durable.
  const conflictId = randomUUID();
  const conflictStage = { migrationId: conflictId, app: 'idle-slayer-companion', document: 'comparison', schemaVersion: 1, baseRevision: 1 };
  const comparisonSelected = { kind: 'upgrade-comparison', version: 1, ids: ['selected'] };
  await request(a, 'sync', 'migration-stage', { ...conflictStage, variant: 'selected', state: comparisonSelected });
  const conflictCommit = { migrationId: conflictId, app: 'idle-slayer-companion', clientId, purpose: 'conflict', documents: [{ document: 'comparison', baseRevision: 1 }] };
  assert.equal((await request(a, 'sync', 'migration-commit', conflictCommit)).status, 409);
  await request(a, 'sync', 'migration-stage', { ...conflictStage, variant: 'device', state: slayer.comparison });
  response = await request(a, 'sync', 'migration-commit', conflictCommit); assert.equal(response.status, 200); assert.deepEqual(response.data.documents[0].state.ids, ['selected']);
  assert.equal((await request(a, 'sync', 'migration-stage', { ...conflictStage, variant: 'selected', state: comparisonSelected })).status, 200, 'Exact stages replay after committed migration');
  assert.equal((await request(a, 'sync', 'migration-commit', conflictCommit)).status, 200);
  assert.equal((await request(a, 'sync', 'read', undefined, { app: 'idle-slayer-companion', document: 'progress', clientId })).data.document.revision, 1);
  const invalidPartial = { migrationId: randomUUID(), app: 'idle-slayer-companion', clientId, documents: [{ document: 'progress', baseRevision: 1 }] };
  assert.equal((await request(a, 'sync', 'migration-commit', invalidPartial)).status, 422);
  // A real >64KiB valid progress document proves shared storage does not inherit
  // Binder's old TEXT/body limit. Decimal strings and unknown IDs survive intact.
  const largeProgress = structuredClone(slayer.progress);
  for (let i = 0; i < 100; i++) largeProgress.modules.material.records[`unknown-${i}`] = { count: '9'.repeat(1024), discovered: false };
  response = await request(a, 'sync', 'write', { app: 'idle-slayer-companion', document: 'progress', schemaVersion: 1, state: largeProgress, baseRevision: 1, clientId, mutationSequence: 1, operationId: randomUUID() });
  assert.equal(response.status, 200); assert.equal(response.data.document.state.modules.material.records['unknown-99'].count.length, 1024);
  const radiusPair = { app: 'radius-map', document: 'measurements' };
  const radiusRead = { ...radiusPair, clientId };
  const timestamp = '2026-11-18T17:08:09.123Z';
  const measurement = {
    id: randomUUID(), name: 'Ridge 🏔', locationLabel: 'Radius test centre', center: { lat: 43.651073, lng: -79.347015 },
    value: 9.25, kind: 'diameter', unit: 'mi', visible: false, createdAt: timestamp, updatedAt: timestamp,
  };
  const radius = measurements => ({ version: 1, measurements });
  const radiusWrite = { ...radiusRead, schemaVersion: 1, baseRevision: 0, operationId: randomUUID(), mutationSequence: 1 };
  assert.equal((await request(a, 'sync', 'read', undefined, radiusRead)).data.document, null);
  for (const invalid of [
    radius([{ ...measurement, center: { lat: 91, lng: 0 } }]),
    radius([{ ...measurement, value: '9.25' }]),
    radius([{ ...measurement, value: 100_000 }]),
    radius([{ ...measurement, visible: 'false' }]),
    radius([{ ...measurement, createdAt: '2026-02-30T17:08:09.123Z' }]),
    radius([{ ...measurement, name: '🏔'.repeat(41) }]),
    radius([measurement, measurement]),
    radius([{ ...measurement, radiusMeters: 123 }]),
  ]) {
    const rejected = await request(a, 'sync', 'write', { ...radiusWrite, state: invalid });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.data.error.code, 'invalid_state');
  }
  const validWrite = { ...radiusWrite, state: radius([measurement]) };
  const radiusSaved = await request(a, 'sync', 'write', validWrite);
  assert.equal(radiusSaved.status, 200, JSON.stringify(radiusSaved.data));
  assert.deepEqual(radiusSaved.data.document.state, validWrite.state);
  assert.match(radiusSaved.headers.get('cache-control'), /no-store/);
  assert.equal((await request(a, 'sync', 'write', validWrite)).data.document.revision, 1);
  assert.equal((await request(b, 'sync', 'read', undefined, radiusRead)).data.document, null);
  assert.equal((await request(a, 'sync', 'read', undefined, { ...radiusRead, document: 'another' })).status, 422);
  const cleared = await request(a, 'sync', 'write', {
    ...radiusWrite, baseRevision: 1, mutationSequence: 2, operationId: randomUUID(), state: radius([]),
  });
  assert.deepEqual(cleared.data.document.state, radius([]));
  const radiusCopies = await request(a, 'sync', 'recovery-list', undefined, { app: radiusPair.app });
  assert.equal(radiusCopies.data.snapshots.length, 1);
  const copy = await request(a, 'sync', 'recovery-read', undefined, { id: radiusCopies.data.snapshots[0].id });
  assert.deepEqual(copy.data.snapshot.state, validWrite.state);

  {
    const allowlist = join(temporary, 'utility-admin.json');
    const auditPath = join(temporary, 'utility-admin-audit.jsonl');
    const operatorId = b.session.user.id, userId = a.session.user.id;
    const admin = (client, action, fields = {}, headers = {}) => request(client, 'admin', '', { action, ...fields }, {}, {
      'X-Account-ID': client.session?.user?.id || '', ...headers,
    });
    assert.equal((await admin(b, 'overview')).status, 503, 'Admin defaults to disabled');
    writeFileSync(allowlist, JSON.stringify({ operators: [operatorId] }), { mode: 0o600 });
    assert.equal((await admin(b, 'overview')).status, 503, 'Access requires a private audit file');
    writeFileSync(auditPath, '', { mode: 0o600 });
    assert.equal((await request(b, 'admin', 'overview')).status, 405);
    assert.equal((await admin(browser(), 'overview')).status, 401);
    assert.equal((await admin(a, 'account', { userId })).status, 403);
    assert.equal((await admin(b, 'overview', {}, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await admin(b, 'overview', {}, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await admin(b, 'overview', {}, { 'X-Account-ID': userId })).status, 409);
    assert.equal(readFileSync(auditPath, 'utf8'), '');
    const overview = await admin(b, 'overview');
    assert.equal(overview.status, 200, JSON.stringify(overview.data));
    assert.equal(overview.data.apps['radius-map'].accounts, 1);
    assert.equal(overview.data.apps['radius-map'].recentlySynced, 1);
    assert.equal(overview.headers.get('referrer-policy'), 'no-referrer');
    const directory = await admin(b, 'users', { app: 'radius-map' });
    assert.deepEqual(directory.data.users.map(user => user.id), [userId]);
    assert.deepEqual((await admin(b, 'users', { search: userId.toUpperCase() })).data.users.map(user => user.id), [userId]);
    assert.deepEqual((await admin(b, 'users', { search: '%' })).data.users, []);
    const account = await admin(b, 'account', { userId });
    assert.equal(account.data.account.id, userId);
    assert.deepEqual(account.data.stockAlerts, []);
    const saved = account.data.saves.find(save => save.app === 'radius-map');
    assert.equal(saved.revision, 2);
    assert.equal(Object.hasOwn(saved, 'json'), false);
    const historyIds = new Set();
    let cursor = {};
    for (;;) {
      const history = await admin(b, 'recovery', { userId, ...cursor });
      assert.equal(history.status, 200);
      assert.ok(history.data.snapshots.length <= 15);
      for (const { id } of history.data.snapshots) {
        assert.ok(!historyIds.has(id), 'Paged history must not repeat recovery copies');
        historyIds.add(id);
      }
      if (!history.data.more) break;
      const last = history.data.snapshots.at(-1);
      assert.ok(last, 'A page with additional history must have a cursor');
      cursor = { beforeId: last.id, beforeDate: last.date };
    }
    assert.ok(historyIds.has(copy.data.snapshot.id));
    assert.deepEqual(JSON.parse((await admin(b, 'save', { userId, id: saved.id })).data.json), radius([]));
    assert.deepEqual(JSON.parse((await admin(b, 'snapshot', { userId, id: copy.data.snapshot.id })).data.json), validWrite.state);
    assert.equal((await admin(b, 'save', { userId: operatorId, id: saved.id })).status, 404);
    assert.equal((await admin(b, 'snapshot', { userId: operatorId, id: copy.data.snapshot.id })).status, 404);
    assert.equal((await admin(b, 'restore', { userId, id: copy.data.snapshot.id })).status, 404);
    const { data: alertAccount } = await admin(b, 'account', { userId: stockAlertsUserId });
    assert.deepEqual(alertAccount.stockAlerts.map(({ store, enabled, minimum }) => ({ store, enabled, minimum })), [
      { store: 'Swirl Café & Games', enabled: true, minimum: 3 },
      { store: '401 Games', enabled: false, minimum: 2 },
    ]);
    assert.ok(alertAccount.stockAlerts[1].lastSendAttemptAt);
    assert.deepEqual(Object.keys(alertAccount.stockAlerts[1]).sort(), ['enabled', 'lastCheckedAt', 'lastSendAttemptAt', 'minimum', 'store']);
    const events = readFileSync(auditPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.slice(0, 5).map(event => event.action), ['overview', 'users', 'users', 'users', 'account']);
    assert.ok(events.slice(5, -3).every(event => event.action === 'recovery'));
    assert.deepEqual(events.slice(-3).map(event => event.action), ['save', 'snapshot', 'account']);
    assert.ok(events.every(event => event.operator === operatorId && !JSON.stringify(event).includes('@')));
    assert.equal(events.at(-2).record, copy.data.snapshot.id);
    writeFileSync(allowlist, '{"operators":[]}');
    assert.equal((await admin(b, 'overview')).status, 503, 'Removing the private allowlist takes effect on the next request');
  }

  async function startGoogle(client = a) {
    const main = client.cookies.get('__Host-ag-session');
    const oauth = await request(client, 'auth', 'google-start', { returnTo: '//external.example/' });
    assert.equal(oauth.status, 200, JSON.stringify(oauth.data));
    const url = new URL(oauth.data.url);
    assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_mode'), 'form_post'); assert.ok(url.searchParams.get('nonce'));
    const state = url.searchParams.get('state'), proof = client.cookies.get('__Host-ag-oauth');
    assert.match(proof, /^[a-f0-9]{64}$/); assert.equal(client.cookies.get('__Host-ag-session'), main, 'OAuth cookie must never replace the Lax account cookie');
    const cookie = oauth.headers.getSetCookie().find(value => value.startsWith('__Host-ag-oauth='));
    const expires = new Date(cookie.match(/expires=([^;]+)/i)[1]); assert.ok(expires.valueOf() - Date.now() <= 600_000);
    return { state, proof };
  }
  async function callback(client, flow, options = {}) {
    const main = client.cookies.get('__Host-ag-session');
    const headers = { Origin: 'https://accounts.google.com', 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'cross-site', ...options.headers };
    const proof = options.proof === undefined ? flow.proof : options.proof;
    if (proof) headers.Cookie = `__Host-ag-oauth=${proof}`;
    if (options.main) headers.Cookie = `${headers.Cookie || ''}; __Host-ag-session=${options.main}`;
    const method = options.method || 'POST';
    const body = options.body === undefined ? new URLSearchParams({ state: flow.state, error: 'access_denied' }).toString() : options.body;
    const response = await fetch(`${origin}/api/v1/auth.php?${options.query || 'action=google-callback'}`, { method, headers, ...(method === 'GET' ? {} : { body }), redirect: 'manual' });
    assert.equal(response.status, 303); assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal(await response.text(), '');
    assert.ok(response.headers.getSetCookie().some(value => value.startsWith('__Host-ag-oauth=') && /Max-Age=0/i.test(value)), 'Every callback outcome clears its temporary proof');
    assert.ok(response.headers.getSetCookie().every(value => !value.startsWith('__Host-ag-session=')), 'Cancellation/failure must not create or replace a main session');
    rememberCookies(client, response.headers); assert.equal(client.cookies.get('__Host-ag-session'), main);
    return response.headers.get('location');
  }
  let flow = await startGoogle();
  for (const options of [
    { method: 'GET', query: `action=google-callback&state=${flow.state}&code=invalid` },
    { method: 'PUT' },
    { proof: '' }, { proof: '0'.repeat(64) },
    { headers: { Origin: '' } }, { headers: { Origin: 'https://attacker.example' } },
    { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: flow.state, error: 'access_denied' }) },
    { query: 'action=google-callback&code=invalid' },
    { query: `action=google-callback&state=${flow.state}` },
    { body: `state=${'0'.repeat(64)}&error=access_denied` },
    { body: `state=${flow.state}&state=${flow.state}&error=access_denied` },
    { body: `state%5B%5D=${flow.state}&error=access_denied` },
    { body: 'x='.padEnd(16385, 'x') },
    { main: b.cookies.get('__Host-ag-session') },
  ]) assert.equal(await callback(a, flow, options), '/account/?google=failed');
  // This authentic provider-shaped POST deliberately omits the Lax main cookie.
  assert.equal(await callback(a, flow), '/account/?google=cancelled');
  assert.equal(await callback(a, flow), '/account/?google=failed', 'Consumed form-post state must not replay even with the old proof');
  const firstFlow = await startGoogle();
  flow = await startGoogle();
  assert.equal(await callback(a, flow, { proof: firstFlow.proof }), '/account/?google=failed', 'A proof from another valid OAuth flow must not bind this state');
  assert.equal(await callback(a, flow), '/account/?google=cancelled');
  flow = await startGoogle(); databaseCommand('expire-oauth');
  assert.equal(await callback(a, flow), '/account/?google=failed', 'Expired provider state must fail');
  const retired = browser(); await request(retired, 'auth', 'session');
  flow = await startGoogle(retired); await request(retired, 'auth', 'logout', {});
  assert.equal(await callback(retired, flow), '/account/?google=failed', 'A retired original session must not authorize its Google flow');
  const attempts = browser(); await request(attempts, 'auth', 'session');
  const startAttempts = await request(attempts, 'auth', 'email-start', { email: 'attempts@example.test' }); assert.equal(startAttempts.status, 200);
  const attemptCode = messages.at(-1).match(/code is:\s*(\d{6})/)[1]; const incorrect = attemptCode === '000000' ? '999999' : '000000';
  assert.equal((await request(attempts, 'auth', 'email-start', { email: 'attempts@example.test' })).status, 429);
  for (let i = 0; i < 5; i++) assert.equal((await request(attempts, 'auth', 'email-verify', { challengeId: startAttempts.data.challengeId, code: incorrect })).status, 401);
  assert.equal((await request(attempts, 'auth', 'email-verify', { challengeId: startAttempts.data.challengeId, code: attemptCode })).status, 401, 'Attempt cap persists despite failed requests');
  const expired = browser(); await request(expired, 'auth', 'session');
  const expiryStart = await request(expired, 'auth', 'email-start', { email: 'expiry@example.test' }); const expiryCode = messages.at(-1).match(/code is:\s*(\d{6})/)[1]; databaseCommand('expire-challenges');
  assert.equal((await request(expired, 'auth', 'email-verify', { challengeId: expiryStart.data.challengeId, code: expiryCode })).status, 401);
  const logout = await request(a, 'auth', 'logout-all', {}); assert.equal(logout.status, 200); assert.equal(logout.data.user, null); assert.equal((await request(a, 'sync', 'read', undefined, { app, document, clientId })).status, 401);
  const visibilityClient = randomUUID();
  const hiddenDex = write({ ...binder([25]), enabled: false }, 0, visibilityClient);
  const hiddenSave = await request(b, 'sync', 'write', hiddenDex);
  assert.equal(hiddenSave.status, 200, JSON.stringify(hiddenSave.data));
  const legacyEdit = write(binder([1, 25]), hiddenSave.data.document.revision, visibilityClient, 2);
  const legacySave = await request(b, 'sync', 'write', legacyEdit);
  assert.equal(legacySave.status, 200);
  assert.deepEqual(legacySave.data.document.state, { ...binder([1, 25]), enabled: false });
  assert.deepEqual((await request(b, 'sync', 'write', legacyEdit)).data, legacySave.data);
  const showDex = write({ ...binder([1, 25]), enabled: true }, legacySave.data.document.revision, visibilityClient, 3);
  assert.equal((await request(b, 'sync', 'write', showDex)).data.document.state.enabled, true);
  assert.equal((await request(b, 'sync', 'write', write({ ...binder([1]), enabled: "false" }, showDex.baseRevision + 1, visibilityClient, 4))).status, 422);
  const order = write({ ...binder([1, 25]), orderedDexIds: [4, 7] }, showDex.baseRevision + 1, visibilityClient, 4);
  const orderResult = await request(b, 'sync', 'write', order);
  assert.equal(orderResult.status, 200);
  const olderTab = write(binder([1, 4, 25]), orderResult.data.document.revision, visibilityClient, 5);
  const olderTabResult = await request(b, 'sync', 'write', olderTab);
  assert.deepEqual(olderTabResult.data.document.state.orderedDexIds, [7]);
  const clearOrder = write({ ...binder([1, 4, 25]), orderedDexIds: [] }, olderTabResult.data.document.revision, visibilityClient, 6);
  assert.deepEqual((await request(b, 'sync', 'write', clearOrder)).data.document.state.orderedDexIds, []);
  config.enabled = false; saveConfig(); assert.equal((await request(b, 'auth', 'session')).data.enabled, false); assert.equal((await request(b, 'sync', 'read', undefined, { app, document, clientId })).status, 503);
  assert.equal(await callback(a, flow), '/account/?google=failed', 'Disabled accounts must clear an OAuth proof and redirect without diagnostics');
  const unavailableConfig = configFile + '.temporarily-unavailable'; renameSync(configFile, unavailableConfig);
  try { assert.equal(await callback(a, flow), '/account/?google=failed', 'Missing private config must also clear an OAuth proof'); }
  finally { renameSync(unavailableConfig, configFile); }
  assert.ok(!phpOutput.includes(key), 'A key entered server diagnostics'); assert.ok(!phpOutput.includes(proof.code), 'An email code entered server diagnostics'); assert.ok(!phpOutput.includes('one@example.test'), 'Email entered server diagnostics');
  console.log('Accounts API: real email-code login, signed-token validation, CSRF, isolation, concurrent revisions, staged migration, retired-key rejection, recovery, and logout passed.');
} finally {
  for (const child of processes) child.kill();
  await Promise.all(processes.map(child => new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); })));
  await new Promise(resolve => smtp.close(resolve));
  if (created) databaseCommand('drop');
}
