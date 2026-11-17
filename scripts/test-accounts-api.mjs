import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const databaseCommand = action => execFileSync(php, [...flags, join(root, 'tests/accounts/database.php'), action], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
function browser() { return { cookie: '', session: null }; }
async function request(client, file, action, body, query = {}, extra = {}, server = origin) {
  const headers = { Accept: 'application/json', ...(client.cookie ? { Cookie: client.cookie } : {}), ...extra };
  if (file === 'sync' && client.session?.user) headers['X-Account-ID'] ??= client.session.user.id;
  if (body !== undefined) { headers['Content-Type'] ??= 'application/json'; headers.Origin ??= origin; headers['X-CSRF-Token'] ??= client.session?.csrfToken || ''; }
  const response = await fetch(`${server}/api/v1/${file}.php?${new URLSearchParams({ action, ...query })}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) { assert.match(setCookie, /Secure/i); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i); assert.ok(!/;\s*domain=/i.test(setCookie)); client.cookie = setCookie.split(';')[0]; }
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
try {
  databaseCommand('create'); created = true;
  saveConfig(); [origin, parallel] = await Promise.all([startServer(), startServer()]); config.allowedOrigin = origin; saveConfig();
  execFileSync(php, [...flags, join(root, 'server/accounts/migrate.php'), configFile], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(php, [...flags, join(root, 'tests/accounts/validators.test.php')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const a = browser(), b = browser(), clientId = randomUUID(), client2 = randomUUID();
  const unauth = await request(a, 'sync', 'read', undefined, { app, document, clientId }); assert.equal(unauth.status, 401);
  await request(a, 'auth', 'session');
  assert.equal((await request(a, 'auth', 'email-start', { email: 'one@example.test' }, {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await request(a, 'auth', 'email-start', { email: 'one@example.test' }, {}, { Origin: 'https://external.example' })).status, 403);
  const proof = await login(a, 'one@example.test');
  assert.equal((await request(a, 'auth', 'email-verify', proof)).status, 401, 'OTP replay must fail after session rotation');
  await login(b, 'two@example.test');
  assert.equal((await request(a, 'sync', 'read', undefined, { app, document, clientId }, { 'X-Account-ID': b.session.user.id })).status, 409);
  assert.equal((await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document, null);
  const first = write(binder([1]), 0, clientId); let response = await request(a, 'sync', 'write', first); assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.document.revision, 1);
  assert.equal((await request(a, 'sync', 'write', first)).data.document.revision, 1);
  assert.equal((await request(a, 'sync', 'write', { ...first, state: binder([2]) })).status, 409);
  assert.equal((await request(b, 'sync', 'read', undefined, { app, document, clientId })).data.document, null);
  // Both processes contend for the same rate-limit bucket. None may deadlock
  // upgrading a shared insert lock before the document's revision lock.
  const sharedBucketReads = await Promise.all(Array.from({ length: 12 }, (_, index) => request(a, 'sync', 'read', undefined, { app, document, clientId }, {}, index % 2 ? parallel : origin)));
  assert.ok(sharedBucketReads.every(result => result.status === 200), 'Concurrent rate-limit access must not turn valid reads into 503s');
  response = await request(a, 'sync', 'write', write(binder([2]), 0, client2)); assert.equal(response.status, 409); assert.deepEqual(response.data.remote.state.ownedDexIds, [1]);
  const races = await Promise.all([request(a, 'sync', 'write', write(binder([1, 2]), 1, clientId, 2)), request(a, 'sync', 'write', write(binder([25]), 1, client2), {}, {}, parallel)]);
  assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
  const current = (await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document; assert.equal(current.revision, 2);
  assert.equal((await request(a, 'sync', 'write', first)).data.document.revision, 2, 'Lost response replay must read current state');
  // Actual legacy key creation, then atomic account conversion and permanent revocation.
  const key = `pdx_${randomBytes(32).toString('base64url')}`;
  const legacyConfig = join(temporary, 'pokedex-config.php');
  writeFileSync(legacyConfig, `<?php\nreturn json_decode(base64_decode('${Buffer.from(JSON.stringify({ ...config, rateLimitDirectory: join(temporary, 'limits'), rateLimitSecret: config.secret })).toString('base64')}'), true);\n`);
  // A small CLI fixture creates an ordinary legacy row without bypassing any account auth.
  const fixture = join(temporary, 'legacy-fixture.php');
  writeFileSync(fixture, `<?php\n$c=require $argv[1]; $db=new PDO($c['dsn'],$c['username'],$c['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]); $q=$db->prepare('INSERT INTO pokedex_binders(key_hash,revision,state_json) VALUES(?,1,?)');$q->execute([hash('sha256',$argv[2],true),$argv[3]]);\n`);
  execFileSync(php, [...flags, fixture, configFile, key, JSON.stringify(binder([25]))], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const migrationId = randomUUID(), stage = { migrationId, app, document, schemaVersion: 1, baseRevision: current.revision };
  assert.equal((await request(a, 'sync', 'migration-stage', { ...stage, variant: 'selected', state: binder([1, 2, 25]) })).status, 200);
  assert.equal((await request(a, 'sync', 'migration-stage', { ...stage, variant: 'selected', state: binder([1]) })).status, 409);
  const commit = { migrationId, app, clientId, documents: [{ document, baseRevision: current.revision }], legacy: { revision: 1 } };
  const beforeMissingDevice = JSON.parse(databaseCommand('audit').toString());
  response = await request(a, 'sync', 'migration-commit', commit, {}, { 'X-Pokedex-Key': key });
  assert.equal(response.status, 409); assert.equal(response.data.error.code, 'migration_incomplete');
  assert.deepEqual(JSON.parse(databaseCommand('audit').toString()), beforeMissingDevice, 'Missing device stage must not claim/revoke a key or create replacement recovery state');
  assert.deepEqual((await request(a, 'sync', 'read', undefined, { app, document, clientId })).data.document, current, 'Missing device stage must not replace the account binder');
  assert.equal((await request(a, 'sync', 'migration-stage', { ...stage, variant: 'device', state: binder([1, 2]) })).status, 200);
  assert.equal((await request(a, 'sync', 'migration-commit', { ...commit, legacy: { revision: 2 } }, {}, { 'X-Pokedex-Key': key })).status, 409);
  response = await request(a, 'sync', 'migration-commit', commit, {}, { 'X-Pokedex-Key': key }); assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.documents[0].revision, 3);
  assert.equal((await request(a, 'sync', 'migration-commit', commit, {}, { 'X-Pokedex-Key': key })).status, 200);
  const legacyReadFixture = join(temporary, 'legacy-read-fixture.php');
  writeFileSync(legacyReadFixture, `<?php\nrequire $argv[1]; $c=require $argv[2]; $db=pokedex_database($c); try { pokedex_handle($db,'GET',hash('sha256',$argv[3],true),null,null,[1=>true,2=>true,25=>true]); echo json_encode(['status'=>200]); } catch (PokedexApiError $e) { echo json_encode(['status'=>$e->status,'code'=>$e->errorCode]); }\n`);
  const legacyRead = JSON.parse(execFileSync(php, [...flags, legacyReadFixture, join(root, 'public/utilities/pokedex-binder/api/_library.php'), legacyConfig, key], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual(legacyRead, { status: 410, code: 'binder_revoked' }, 'An old client must recognize migrated-key revocation without exposing retained state');
  const claimant = { ...commit, migrationId: randomUUID(), documents: [{ document, baseRevision: 0 }] };
  await request(b, 'sync', 'migration-stage', { ...stage, migrationId: claimant.migrationId, baseRevision: 0, variant: 'device', state: binder([25]) });
  await request(b, 'sync', 'migration-stage', { ...stage, migrationId: claimant.migrationId, baseRevision: 0, variant: 'selected', state: binder([25]) });
  assert.equal((await request(b, 'sync', 'migration-commit', claimant, {}, { 'X-Pokedex-Key': key })).status, 410);
  const audit = JSON.parse(databaseCommand('audit').toString()); assert.equal(audit.claims, 1); assert.equal(audit.retainedLegacy, 1);
  let snapshots = (await request(a, 'sync', 'recovery-list')).data.snapshots; assert.ok(snapshots.some(s => s.label === 'Legacy key collection')); assert.ok(snapshots.some(s => s.label === 'Device before migration')); assert.match(snapshots[0].createdAt, /Z$/);
  const saved = snapshots.find(s => s.label === 'Legacy key collection');
  assert.equal((await request(b, 'sync', 'recovery-read', undefined, { id: saved.id })).status, 404);
  assert.equal((await request(b, 'sync', 'recovery-restore', { id: saved.id, baseRevision: 0, clientId, operationId: randomUUID() })).status, 404);
  response = await request(a, 'sync', 'recovery-restore', { id: saved.id, baseRevision: 3, clientId, operationId: randomUUID() }); assert.equal(response.status, 200); assert.deepEqual(response.data.document.state.ownedDexIds, [25]);
  assert.equal((await request(a, 'sync', 'recovery-delete', { id: saved.id })).status, 200); assert.equal((await request(a, 'sync', 'recovery-read', undefined, { id: saved.id })).status, 404);
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
  assert.equal((await request(a, 'sync', 'read', undefined, { app: 'radius-map', document: 'measurements', clientId })).status, 422);
  const oauth = await request(a, 'auth', 'google-start', { returnTo: '//external.example/' }); assert.equal(oauth.status, 200, JSON.stringify(oauth.data)); const oauthUrl = new URL(oauth.data.url); assert.equal(oauthUrl.origin, 'https://accounts.google.com'); assert.equal(oauthUrl.searchParams.get('code_challenge_method'), 'S256'); assert.ok(oauthUrl.searchParams.get('nonce')); assert.ok(oauthUrl.searchParams.get('state'));
  const badCallback = await fetch(`${origin}/api/v1/auth.php?action=google-callback&state=${'0'.repeat(64)}&code=invalid`, { headers: { Cookie: a.cookie }, redirect: 'manual' });
  assert.equal(badCallback.status, 303); assert.equal(badCallback.headers.get('location'), '/account/?google=failed');
  // Consume a real callback state through cancellation; no Google network request occurs.
  const cancelled = await fetch(`${origin}/api/v1/auth.php?${new URLSearchParams({ action: 'google-callback', state: oauthUrl.searchParams.get('state'), error: 'access_denied' })}`, { headers: { Cookie: a.cookie, 'Sec-Fetch-Site': 'cross-site' }, redirect: 'manual' }); assert.equal(cancelled.status, 303); assert.equal(cancelled.headers.get('location'), '/account/?google=cancelled');
  const cancelledReplay = await fetch(`${origin}/api/v1/auth.php?${new URLSearchParams({ action: 'google-callback', state: oauthUrl.searchParams.get('state'), error: 'access_denied' })}`, { headers: { Cookie: a.cookie }, redirect: 'manual' }); assert.equal(cancelledReplay.headers.get('location'), '/account/?google=failed');
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
  config.enabled = false; saveConfig(); assert.equal((await request(b, 'auth', 'session')).data.enabled, false); assert.equal((await request(b, 'sync', 'read', undefined, { app, document, clientId })).status, 503);
  assert.ok(!phpOutput.includes(key), 'A key entered server diagnostics'); assert.ok(!phpOutput.includes(proof.code), 'An email code entered server diagnostics'); assert.ok(!phpOutput.includes('one@example.test'), 'Email entered server diagnostics');
  console.log('Accounts API: real email-code login, signed-token validation, CSRF, isolation, concurrent revisions, staged migration/revocation, recovery, and logout passed.');
} finally {
  for (const child of processes) child.kill();
  await Promise.all(processes.map(child => new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); })));
  await new Promise(resolve => smtp.close(resolve));
  if (created) databaseCommand('drop');
}
