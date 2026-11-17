import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Built-in HTTP SAPI OPcache is independent of opcache.enable_cli. Exercise the
// actual server with timestamp validation disabled; no mock cache or database.
const root = fileURLToPath(new URL('../', import.meta.url)), php = process.env.PHP_BINARY || 'php';
const phpDir = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const flags = ['-d', 'opcache.enable=1', '-d', 'opcache.enable_cli=0', '-d', 'opcache.validate_timestamps=0', '-d', 'opcache.file_update_protection=0', '-d', 'display_errors=0', '-d', 'log_errors=0'];
if (process.platform === 'win32') {
  const modules = execFileSync(php, ['-m'], { encoding: 'utf8' });
  if (!modules.includes('Zend OPcache')) flags.push('-d', `zend_extension=${join(phpDir, 'ext/php_opcache.dll')}`);
}
mkdirSync(join(root, 'tmp'), { recursive: true });
const temporary = mkdtempSync(join(root, 'tmp/accounts-cache-http-'));
const webroot = join(temporary, 'public'); mkdirSync(webroot);
const mtime = new Date((Math.floor(Date.now() / 1000) - 120) * 1000);
const base = { enabled: true, migrationEnabled: true, dsn: 'mysql:host=127.0.0.1;dbname=unused', username: 'local-fixture', password: '', secret: 'a'.repeat(64), allowedOrigin: 'https://example.test' };
function write(path, config) {
  writeFileSync(path, `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'), true, 512, JSON_THROW_ON_ERROR);\n`);
  utimesSync(path, mtime, mtime);
}
async function freePort() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function run(restricted) {
  const path = join(temporary, restricted ? 'restricted.php' : 'normal.php'); write(path, base);
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const child = spawn(php, [...flags, ...(restricted ? ['-d', 'disable_functions=opcache_invalidate'] : []), '-S', `127.0.0.1:${port}`, '-t', webroot, join(root, 'tests/accounts/config-cache-http.php')], {
    env: { ...process.env, ACCOUNTS_CACHE_HTTP_CONFIG: path, ACCOUNTS_CACHE_HTTP_WEBROOT: webroot }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', () => undefined);
  const stopped = new Promise(resolve => child.once('exit', resolve));
  const timeout = setTimeout(() => child.kill(), 20_000);
  async function request(action) {
    const response = await fetch(`${origin}/probe?action=${action}`, { redirect: 'manual', signal: AbortSignal.timeout(3_000) });
    assert.equal(response.status, 200); return response.json();
  }
  try {
    let health;
    for (let i = 0; i < 80; i++) {
      try { const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(500) }); health = await response.json(); break; }
      catch { if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 25)); }
    }
    assert.ok(health, 'Local OPcache HTTP server must start');
    assert.deepEqual(health, { sapi: 'cli-server', cacheActive: true, enableCli: false, validateTimestamps: false }, 'The real HTTP SAPI must cache with enable_cli disabled');
    let result = await request('control'); assert.equal(result.enabled, true); assert.equal(result.cached, true);
    write(path, { ...base, enabled: false, migrationEnabled: false });
    result = await request('control'); assert.equal(result.enabled, true, 'Raw require control must reproduce stale public enabled flag');
    assert.equal(result.migrationEnabled, true); assert.equal(statSync(path).mtimeMs, mtime.valueOf());
    result = await request('production');
    if (restricted) {
      assert.equal(result.closed, true, 'Unavailable invalidation must fail closed under the actual HTTP SAPI'); return;
    }
    assert.equal(result.closed, false); assert.equal(result.enabled, false, 'Production loader must immediately disable public accounts');
    assert.equal(result.migrationEnabled, false, 'Production loader must immediately disable public migrations');
    const preview = { ...base, enabled: false, migrationEnabled: false, preview: { enabled: true, migrationEnabled: true, addresses: ['127.0.0.1'] } };
    write(path, preview);
    // First load deliberately refreshes the prior disabled cache, enabling the
    // operator before the next control proves stale preview compilation.
    result = await request('production'); assert.equal(result.enabled, true); assert.equal(result.migrationEnabled, true); assert.equal(result.previewActive, true);
    result = await request('control'); assert.equal(result.previewEnabled, true); assert.equal(result.cached, true);
    write(path, { ...preview, preview: { ...preview.preview, enabled: false, migrationEnabled: false } });
    result = await request('control'); assert.equal(result.previewEnabled, true, 'Raw require control must reproduce stale operator preview flag');
    result = await request('production'); assert.equal(result.closed, false); assert.equal(result.enabled, false, 'Production loader must immediately disable preview accounts');
    assert.equal(result.migrationEnabled, false); assert.equal(result.previewActive, false); assert.equal(statSync(path).mtimeMs, mtime.valueOf());
    assert.equal(result.cached, true, 'The config must still have an actual cached script before deletion');
    unlinkSync(path);
    result = await request('production'); assert.equal(result.closed, false); assert.equal(result.missing, true, 'A missing private file must never reuse cached flags');
  } finally {
    clearTimeout(timeout); child.kill();
    await stopped;
  }
}
await run(false); await run(true);
console.log('Accounts HTTP OPcache: stale raw controls reproduced; public/preview disable and missing configuration are immediate with enable_cli=0; restricted invalidation fails closed.');
