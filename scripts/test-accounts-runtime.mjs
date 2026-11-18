import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The public entrypoints must fail safely even before HostPapa's PHP upgrade.
const root = fileURLToPath(new URL('../', import.meta.url));
const php = process.env.PHP_BINARY || 'php';
for (const endpoint of ['auth', 'sync']) {
  const path = join(root, 'public/api/v1', `${endpoint}.php`);
  const code = `$_GET=['action'=>'session']; $_SERVER['REQUEST_METHOD']='GET'; putenv('ACCOUNTS_CONFIG=' . $argv[2]); include $argv[1];`;
  const output = execFileSync(php, ['-r', code, path, join(root, 'tmp/nonexistent-accounts-runtime-config.php')], { encoding: 'utf8' });
  const result = JSON.parse(output);
  if (endpoint === 'auth') assert.equal(result.enabled, false);
  else assert.match(result.error.code, /disabled|runtime_unavailable/);
}
console.log('Account entrypoints safely retain guest use without configuration or a supported runtime.');
