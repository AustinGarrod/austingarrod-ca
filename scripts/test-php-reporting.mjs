import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

// Local-only behavioral checks. Never sends mail or calls a production endpoint.
const root = fileURLToPath(new URL('../', import.meta.url));
const php = process.env.PHP_BINARY || 'php';
function execute(args, options = {}) {
  const result = spawnSync(php, args, { encoding: 'utf8', timeout: 20000, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `PHP command failed: ${result.stderr}`);
  return result.stdout;
}
const actualPHP = execute(['-r', 'echo PHP_BINARY;']).trim();
const extensions = process.platform === 'win32' ? ['-d', `extension_dir=${join(dirname(actualPHP), 'ext')}`, '-d', 'extension=openssl', '-d', 'extension=curl', '-d', 'extension=mbstring'] : [];
const info = JSON.parse(execute([...extensions, '-r', 'echo json_encode(["version" => PHP_VERSION_ID, "curl" => extension_loaded("curl"), "mbstring" => extension_loaded("mbstring")]);']));
const sdkSupported = info.version >= 80100 && info.curl && info.mbstring;
const temporary = mkdtempSync(join(tmpdir(), 'portfolio-php-compat-'));
const quote = value => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
let checks = 0;
function fixture(name, autoload, metadata = "<?php return ['release' => 'compat-test', 'environment' => 'test'];") {
  const directory = join(temporary, name);
  mkdirSync(join(directory, 'reporting/vendor'), { recursive: true });
  mkdirSync(join(directory, 'utilities/radius-map/api'), { recursive: true });
  mkdirSync(join(directory, 'temp'), { recursive: true });
  copyFileSync(join(root, 'public/reporting/bootstrap.php'), join(directory, 'reporting/bootstrap.php'));
  copyFileSync(join(root, 'public/contact.php'), join(directory, 'contact.php'));
  copyFileSync(join(root, 'public/utilities/radius-map/api/geocode.php'), join(directory, 'utilities/radius-map/api/geocode.php'));
  if (autoload !== undefined) writeFileSync(join(directory, 'reporting/vendor/autoload.php'), autoload);
  if (metadata !== undefined && metadata !== null) writeFileSync(join(directory, 'reporting/build.php'), metadata);
  return directory;
}
const disabledCode = String.raw`
http_response_code(202);
$level = ob_get_level();
require __DIR__ . '/reporting/bootstrap.php';
report_failure('test.failure', ['synthetic' => true], new RuntimeException('original cause'));
$span = reporting_span('test.span');
reporting_finish_span($span, ['accepted' => false]);
reporting_log('Test result', ['accepted' => false]);
printf('%d|%d|%d|%d', http_response_code(), !empty($GLOBALS['portfolioReportingReady']), $span !== null, ob_get_level() === $level);
`;
function checkDisabled(directory, args = extensions) {
  writeFileSync(join(directory, 'runner.php'), '<?php\n' + disabledCode);
  const output = execute([...args, join(directory, 'runner.php')], { env: { ...process.env, REPORTING_DSN: '', REPORTING_ENVIRONMENT: 'test' } });
  assert.equal(output, '202|0|0|1');
  checks++;
}
async function port() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const number = server.address().port;
  await new Promise(done => server.close(done));
  return number;
}
async function handlers(directory) {
  const number = await port(), origin = `http://127.0.0.1:${number}`;
  const process_ = spawn(php, [...extensions, '-d', 'disable_functions=mail', '-d', 'display_errors=0', '-d', `sys_temp_dir=${join(directory, 'temp')}`, '-S', `127.0.0.1:${number}`, '-t', directory], { env: { ...process.env, REPORTING_DSN: '', REPORTING_ENVIRONMENT: 'test' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  process_.stderr.on('data', chunk => { stderr += chunk; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (process_.exitCode !== null) throw new Error('Local PHP server exited: ' + stderr);
      try { await fetch(origin + '/missing-startup-file', { signal: AbortSignal.timeout(500) }); ready = true; break; } catch {}
      await new Promise(done => setTimeout(done, 50));
    }
    assert.ok(ready, 'Local PHP server did not start: ' + stderr);
    const data = new URLSearchParams({ name: 'Synthetic local verification', email: 'verification@example.invalid', subject: 'Mail disabled locally', message: 'This local behavioral test disables the PHP mail function.' });
    const response = await fetch(origin + '/contact.php', { method: 'POST', body: data, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 303, stderr);
    assert.equal(response.headers.get('location'), '/contact/?status=error');
    assert.equal(await response.text(), '', 'Reporting must not corrupt the contact redirect body');
    checks++;
    const invalid = await fetch(origin + '/contact.php', { method: 'POST', body: new URLSearchParams(), redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(invalid.status, 303, stderr);
    assert.equal(invalid.headers.get('location'), '/contact/?status=invalid');
    assert.equal(await invalid.text(), '');
    checks++;
    const geocode = await fetch(origin + '/utilities/radius-map/api/geocode.php', { signal: AbortSignal.timeout(5000) });
    assert.equal(geocode.status, 400, stderr);
    assert.match(geocode.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await geocode.json(), { error: 'Enter at least 2 characters.' });
    checks++;
  } finally {
    process_.kill();
    if (process_.exitCode === null) await new Promise(done => process_.once('exit', done));
  }
}
try {
  for (const file of ['contact.php', 'reporting/bootstrap.php', 'utilities/radius-map/api/geocode.php']) {
    execute(['-l', join(root, 'public', file)]);
    checks++;
  }
  const missing = fixture('missing-bundle');
  checkDisabled(missing);
  checkDisabled(fixture('missing-metadata', '<?php', null));
  const missingExtensions = fixture('missing-extensions', '<?php echo "AUTOLOAD MUST NOT RUN"; throw new RuntimeException("wrong branch");');
  checkDisabled(missingExtensions, ['-n']);
  const throwing = fixture('throwing-autoload', '<?php http_response_code(500); echo "not endpoint output"; throw new RuntimeException("synthetic dependency failure");');
  checkDisabled(throwing);
  checkDisabled(fixture('parse-autoload', '<?php this is invalid PHP;'));
  checkDisabled(fixture('invalid-metadata', '<?php', '<?php return false;'));
  checkDisabled(fixture('throwing-init', '<?php namespace Sentry; function init(array $options): void { http_response_code(500); echo "not endpoint output"; throw new \\RuntimeException("synthetic init failure"); }'));
  await handlers(missing);
  await handlers(throwing);
  if (sdkSupported) {
    const real = fixture('real-sdk', '<?php require ' + quote(resolve(root, 'public/reporting/vendor/autoload.php')) + ';');
    writeFileSync(join(real, 'runner.php'), '<?php\n' + disabledCode);
    const result = execute([...extensions, join(real, 'runner.php')], { env: { ...process.env, REPORTING_DSN: '', REPORTING_ENVIRONMENT: 'test' } });
    assert.equal(result, '202|1|1|1');
    writeFileSync(join(real, 'span-failure.php'), '<?php require __DIR__ . \'/reporting/bootstrap.php\'; $span = new class { public function setData(array $data): void { throw new RuntimeException(\'synthetic span data failure\'); } public function finish(): void { throw new RuntimeException(\'synthetic span finish failure\'); } }; reporting_finish_span($span, [\'accepted\' => false]); reporting_finish_span($span); echo \'endpoint continued\';');
    assert.equal(execute([...extensions, join(real, 'span-failure.php')], { env: { ...process.env, REPORTING_DSN: '' } }), 'endpoint continued');
    checks++;
    checks++;
    await handlers(real);
  } else {
    console.log('SDK initialization intentionally skipped on this unsupported PHP runtime; endpoint behavior was checked.');
  }
  console.log(`PHP compatibility passed: ${checks} behavior checks on PHP ${info.version}; external delivery disabled.`);
} finally {
  if (!temporary.startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unsafe test fixture cleanup');
  rmSync(temporary, { recursive: true, force: true });
}
