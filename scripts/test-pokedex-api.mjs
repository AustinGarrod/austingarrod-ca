import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
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
  databaseCommand('retire-fixture');
  const origin = await startServer();
  for (const method of ['GET','POST','PATCH','DELETE']) {
    const result = await request(origin,method,key(),['POST','PATCH'].includes(method)?{state:state([25])}:undefined);
    assert.equal(result.status,410);assert.equal(result.data.error.code,'key_sync_retired');
  }
  console.log('Key retirement preserves existing tombstones and archives, clears active payloads and blocks reads, writes and recreation.');
} finally {
  for (const server of servers) server.kill();
  await Promise.all(servers.map(server => new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))));
  if (databaseCreated) databaseCommand('drop');
  assert.ok(!phpOutput.includes('pdx_'), 'The PHP logs exposed a private key.');
}
