import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Refuses remote databases. Every run creates and drops its own random database.
const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.POKEDEX_TEST_DSN, 'Set POKEDEX_TEST_DSN to a localhost MySQL/MariaDB admin DSN.');
const databaseName = `pokedex_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const env = { ...process.env, POKEDEX_TEST_DATABASE: databaseName, REPORTING_DSN: '', REPORTING_ENVIRONMENT: 'pokedex-test' };
const php = process.env.PHP_BINARY || 'php';
const phpDirectory = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
let phpFlags = [];
const drivers = execFileSync(php, ['-r', 'echo implode(",",PDO::getAvailableDrivers());'], { encoding: 'utf8' });
if (!drivers.split(',').includes('mysql')) phpFlags = process.platform === 'win32' ? ['-d', `extension_dir=${join(phpDirectory, 'ext')}`, '-d', 'extension=pdo_mysql'] : ['-d', 'extension=pdo_mysql'];
const databaseCommand = (action) => execFileSync(php, [...phpFlags, join(root, 'scripts/pokedex-test-database.php'), action], { env, stdio: ['ignore', 'pipe', 'pipe'] });
mkdirSync(join(root, 'tmp'), { recursive: true });
const temporary = mkdtempSync(join(root, 'tmp/pokedex-api-'));
const webroot = join(temporary, 'webroot');
const apiPath = '/utilities/pokedex-binder/api/binder.php';
mkdirSync(join(webroot, 'utilities/pokedex-binder/catalog'), { recursive: true });
cpSync(join(root, 'public/utilities/pokedex-binder/api'), join(webroot, 'utilities/pokedex-binder/api'), { recursive: true });
mkdirSync(join(webroot, 'reporting'), { recursive: true });
// Integration tests use production API code with reporting disabled; telemetry redaction has its own tests.
writeFileSync(join(webroot, 'reporting/bootstrap.php'), '<?php\ndeclare(strict_types=1);\n');
writeFileSync(join(webroot, 'utilities/pokedex-binder/catalog/index.json'), JSON.stringify({ schemaVersion: 1, species: [1, 2, 25, 1025].map(id => ({ id })) }));
const dsn = process.env.POKEDEX_TEST_DSN.replace(/;?dbname=[^;]*/i, '') + `;dbname=${databaseName}`;
const config = { dsn, username: env.POKEDEX_TEST_USER || 'root', password: env.POKEDEX_TEST_PASSWORD || '', rateLimitDirectory: join(temporary, 'limits'), rateLimitSecret: randomBytes(32).toString('hex') };
const configFile = join(temporary, 'private-config.php');
const writeConfig = (value) => writeFileSync(configFile, `<?php\nreturn json_decode(base64_decode('${Buffer.from(JSON.stringify(value)).toString('base64')}'), true, 512, JSON_THROW_ON_ERROR);\n`);
writeConfig(config);
env.POKEDEX_CONFIG = configFile;
const servers = [];
let databaseCreated = false;
let phpOutput = '';
async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function startServer() {
  const port = await unusedPort();
  const child = spawn(php, [...phpFlags, '-d', 'display_errors=0', '-d', 'log_errors=1', '-S', `127.0.0.1:${port}`, '-t', webroot], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  servers.push(child);
  child.stderr.on('data', data => { phpOutput += data.toString(); });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(origin); await response.text(); return origin; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  throw new Error('Local PHP server did not start.');
}
const key = () => `pdx_${randomBytes(32).toString('base64url')}`;
const settings = { columns: 4, rows: 4, useBackSides: true, leadingBlankPockets: 0 };
const state = (ownedDexIds = [], changes = {}) => ({ schemaVersion: 1, settings: { ...settings, ...changes }, ownedDexIds });
let requests = 0;
async function request(origin, method, privateKey, body, headers = {}) {
  requests++;
  const response = await fetch(origin + apiPath, { method, headers: { ...(privateKey ? { 'X-Pokedex-Key': privateKey } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const result = await response.json();
  assert.ok(!JSON.stringify(result).includes(privateKey || 'impossible-empty-token'));
  return { status: response.status, data: result, headers: response.headers };
}
try {
  databaseCommand('create'); databaseCreated = true;
  // Administrative setup can run again without replacing collection data.
  execFileSync(php, [...phpFlags, join(root, 'server/pokedex-binder/migrate.php'), configFile], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const origins = await Promise.all([startServer(), startServer()]);
  const [origin, parallelOrigin] = origins;
  const secret = key(), otherSecret = key(), client = randomUUID(), secondClient = randomUUID();
  assert.equal((await request(origin, 'GET')).status, 401);
  assert.equal((await request(origin, 'GET', 'pdx_invalid')).status, 401);
  assert.equal((await request(origin, 'GET', secret)).status, 404);
  assert.equal((await request(origin, 'POST', secret, { state: state([25, 1]) }, { Origin: 'https://unrelated.example' })).status, 403);
  let response = await request(origin, 'POST', secret, { state: state([25, 1]) });
  assert.equal(response.status, 200); assert.equal(response.data.revision, 1); assert.deepEqual(response.data.state.ownedDexIds, [1, 25]);
  assert.equal((await request(origin, 'POST', secret, { state: state([2]) })).data.revision, 1);
  assert.deepEqual((await request(origin, 'GET', secret)).data.state.ownedDexIds, [1, 25]);
  assert.equal((await request(origin, 'GET', otherSecret)).status, 404);
  await request(origin, 'POST', otherSecret, { state: state([1025]) });
  assert.deepEqual((await request(origin, 'GET', otherSecret)).data.state.ownedDexIds, [1025]);
  const mutation = { clientId: client, mutationSequence: 1, baseRevision: 1, state: state([1, 2, 25]) };
  response = await request(origin, 'PATCH', secret, mutation);
  assert.equal(response.data.revision, 2); assert.equal(response.data.acknowledgedSequence, 1);
  assert.equal((await request(origin, 'PATCH', secret, mutation)).data.revision, 2);
  response = await request(origin, 'PATCH', secret, { ...mutation, mutationSequence: 3, baseRevision: 2 });
  assert.equal(response.status, 409); assert.equal(response.data.error.code, 'sequence_gap'); assert.equal(response.data.acknowledgedSequence, 1);
  response = await request(origin, 'PATCH', secret, { clientId: secondClient, mutationSequence: 1, baseRevision: 1, state: state([1]) });
  assert.equal(response.status, 409); assert.equal(response.data.error.code, 'revision_conflict'); assert.equal(response.data.acknowledgedSequence, 0);
  // Two separate PHP processes exercise the real InnoDB lock and revision precondition.
  const races = await Promise.all([
    request(origin, 'PATCH', secret, { clientId: client, mutationSequence: 2, baseRevision: 2, state: state([1]) }),
    request(parallelOrigin, 'PATCH', secret, { clientId: secondClient, mutationSequence: 1, baseRevision: 2, state: state([2]) }),
  ]);
  assert.deepEqual(races.map(item => item.status).sort(), [200, 409]);
  response = await request(origin, 'GET', secret, undefined, { 'X-Pokedex-Client': client });
  assert.equal(response.data.revision, 3); assert.ok([1, 2].includes(response.data.acknowledgedSequence));
  const latest = response.data;
  // A lost successful response replay cannot overwrite a later device's update.
  const replay = await request(origin, 'PATCH', secret, mutation);
  assert.equal(replay.status, 200); assert.equal(replay.data.revision, latest.revision); assert.deepEqual(replay.data.state, latest.state);
  for (const invalid of [state([0]), state([1000]), state([1026]), state([1, 1]), state([1.5]), state([], { rows: 0 }), state([], { columns: 7 }), state([], { leadingBlankPockets: 1001 }), state([], { useBackSides: 'true' }), { ...state(), extra: true }]) {
    const result = await request(origin, 'PATCH', secret, { clientId: randomUUID(), mutationSequence: 1, baseRevision: latest.revision, state: invalid });
    assert.equal(result.status, 422);
  }
  assert.equal((await request(origin, 'PATCH', secret, '{invalid-json')).status, 400);
  assert.equal((await request(origin, 'PATCH', secret, ' '.repeat(65537))).status, 413);
  assert.equal((await request(origin, 'PATCH', secret, '{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request(origin, 'GET', secret, undefined, { 'X-Pokedex-Client': 'bad' })).status, 422);
  assert.equal((await request(origin, 'PUT', secret)).status, 405);
  assert.equal((await request(origin, 'GET', secret)).data.revision, latest.revision);
  assert.equal((await request(origin, 'DELETE', secret)).data.deleted, true);
  assert.equal((await request(origin, 'GET', secret)).status, 404);
  assert.equal((await request(origin, 'DELETE', secret)).status, 404);
  // Simulate a lost initial create response followed by deletion on another device.
  // Retrying create must never reactivate the revoked private key.
  response = await request(origin, 'POST', secret, { state: state([1, 25]) });
  assert.equal(response.status, 410); assert.equal(response.data.error.code, 'binder_revoked');
  assert.equal((await request(origin, 'GET', secret)).status, 404);
  const audit = JSON.parse(databaseCommand('audit').toString());
  assert.equal(audit.tombstones, 1); assert.equal(audit.retainedDeletedStates, 0); assert.equal(audit.retainedDeletedClients, 0);
  assert.deepEqual((await request(origin, 'GET', otherSecret)).data.state.ownedDexIds, [1025]);
  // Broken configuration and private limiter failures preserve generic 503 responses.
  const originalConfig = readFileSync(configFile, 'utf8');
  writeFileSync(configFile, '<?php return [];');
  response = await request(origin, 'GET', otherSecret); assert.equal(response.status, 503); assert.equal(response.data.error.code, 'sync_unavailable');
  writeFileSync(configFile, originalConfig);
  writeConfig({ ...config, dsn: dsn.replace(/dbname=[^;]+/, 'dbname=pokedex_test_missing_database') });
  response = await request(origin, 'GET', otherSecret); assert.equal(response.status, 503); assert.equal(response.data.error.code, 'sync_unavailable');
  writeConfig({ ...config, rateLimitDirectory: join(webroot, 'forbidden-public-limits') });
  response = await request(origin, 'GET', otherSecret); assert.equal(response.status, 503);
  writeFileSync(configFile, originalConfig);
  for (let attempt = 0; attempt < 20; attempt++) response = await request(origin, 'POST', otherSecret, { state: state() });
  assert.equal(response.status, 429); assert.ok(response.headers.get('retry-after'));
  writeConfig({ ...config, rateLimitDirectory: join(temporary, 'invalid-attempt-limits') });
  const unknownKey = key();
  for (let attempt = 0; attempt < 60; attempt++) assert.equal((await request(origin, 'GET', unknownKey)).status, 404);
  assert.equal((await request(origin, 'GET', unknownKey)).status, 429);
  console.log(`Pokedex PHP/MySQL API passed ${requests} local requests, including InnoDB concurrency, isolation, conflict rollback, retry acknowledgment, validation, configuration failure and rate limits.`);
} finally {
  for (const server of servers) server.kill();
  await Promise.all(servers.map(server => new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))));
  if (databaseCreated) databaseCommand('drop');
  assert.ok(!phpOutput.includes('pdx_'), 'The PHP logs exposed a private key.');
}
