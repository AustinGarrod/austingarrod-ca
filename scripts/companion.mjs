import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = resolve(root, 'apps/idle-slayer-companion');
const source = resolve(app, 'dist');
const destination = resolve(root, 'dist/utilities/idle-slayer-companion');
const yarn = resolve(app, '.yarn/releases/yarn-4.13.0.cjs');
const [command = 'build', ...args] = process.argv.slice(2);
function run(...arguments_) {
  const result = spawnSync(process.execPath, [yarn, ...arguments_], { cwd: app, stdio: 'inherit', env: { ...process.env, COMPANION_DEPLOY_TARGET: 'website' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function inventory(directory, parent = '') {
  const files = new Map();
  for (const entry of readdirSync(resolve(directory, parent), { withFileTypes: true })) {
    const name = parent + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Linked companion asset: ' + name);
    if (entry.isDirectory()) for (const [file, hash] of inventory(directory, name + '/')) files.set(file, hash);
    else if (entry.isFile()) files.set(name, createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex'));
  }
  return files;
}
function verify() {
  run('check:release');
  const expected = inventory(source), actual = inventory(destination);
  // Apache configuration is installed by the portfolio, outside the app's precache.
  actual.delete('.htaccess');
  if (actual.size !== expected.size || [...expected].some(([file, hash]) => actual.get(file) !== hash)) throw new Error('Assembled companion differs from its validated release.');
  console.log('Companion assembly verified byte-for-byte.');
}
function assemble() {
  const allowed = resolve(root, 'dist');
  if (!destination.startsWith(allowed + sep) || relative(allowed, destination) !== ['utilities', 'idle-slayer-companion'].join(sep)) throw new Error('Unsafe companion destination.');
  for (const directory of [allowed, resolve(allowed, 'utilities'), destination]) if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('Linked assembly destination.');
  if (existsSync(destination)) rmSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
  cpSync(resolve(root, 'public/utilities/idle-slayer-companion/.htaccess'), resolve(destination, '.htaccess'));
  verify();
}
switch (command) {
  case 'install': run('install', '--immutable'); break;
  case 'test': run('validate:catalog'); run('test', ...args); run('test:tools'); run('notices:check'); break;
  case 'build': run('build'); run('check:release'); assemble(); break;
  case 'assemble': assemble(); break;
  case 'restore-build': {
    if (source !== resolve(app, 'dist') || (existsSync(source) && lstatSync(source).isSymbolicLink())) throw new Error('Unsafe app output.');
    if (existsSync(source)) rmSync(source, { recursive: true });
    cpSync(destination, source, { recursive: true, filter: (file) => !file.endsWith('.htaccess') });
    verify();
    break;
  }
  case 'verify': verify(); break;
  case 'e2e': run('test:e2e', ...args); break;
  case 'migration': run('prepare:migration'); break;
  case 'reporting': {
    const result = spawnSync(process.execPath, ['scripts/upload-reporting.mjs'], { cwd: app, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  default: throw new Error('Unknown companion command: ' + command);
}
