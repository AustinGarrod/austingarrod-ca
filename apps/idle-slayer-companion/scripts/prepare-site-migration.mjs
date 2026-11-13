import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'
import { validateReleaseArtifact } from './release-artifact.ts'
import { validatePwaDistribution, COMPANION_SECTION_PATHS } from './pwa.ts'
import { LEGACY_DEPLOYMENT } from '../deployment.ts'

const root = process.cwd(), output = resolve(root, '.cache/site-migration'), cache = resolve(root, '.cache')
const legacyApp = resolve(cache, 'legacy-migration-app')
for (const directory of [output, legacyApp]) {
  if (!directory.startsWith(cache + sep) || relative(cache, directory).includes(sep) || (existsSync(directory) && lstatSync(directory).isSymbolicLink())) throw new Error('Unsafe migration output')
}
if (existsSync(cache) && (lstatSync(cache).isSymbolicLink() || !realpathSync(cache).startsWith(realpathSync(root) + sep))) throw new Error('Migration cache must stay within this workspace')

// Build the old origin explicitly. A website-base release must never be copied
// under a historical path; its absolute asset URLs and worker scope differ.
const receiptPath = resolve(cache, 'reporting/build.json')
const priorReceipt = existsSync(receiptPath) ? readFileSync(receiptPath) : undefined
try {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', '.cache/legacy-migration-app'], {
    cwd: root, env: { ...process.env, COMPANION_DEPLOY_TARGET: 'legacy-migration' }, stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Legacy migration build failed')
} finally {
  // The website symbol-upload receipt must keep describing its own build.
  if (priorReceipt) writeFileSync(receiptPath, priorReceipt)
  else if (existsSync(receiptPath)) rmSync(receiptPath)
}
validateReleaseArtifact(root, legacyApp, LEGACY_DEPLOYMENT)
validatePwaDistribution(root, legacyApp, LEGACY_DEPLOYMENT)
if (existsSync(output)) rmSync(output, { recursive: true })
mkdirSync(output, { recursive: true })
cpSync(legacyApp, resolve(output, 'idle-slayer-companion'), { recursive: true })
const legacy = resolve(output, 'idle-slayer-ascension-map')
mkdirSync(legacy)
await build({ configFile: false, logLevel: 'warn', build: { outDir: legacy, emptyOutDir: false, lib: { entry: resolve(root, 'migration/legacy-bridge.ts'), formats: ['iife'], name: 'CompanionLegacyBridge', fileName: () => 'bridge.js' } } })
cpSync(resolve(root, 'migration/legacy-index.html'), resolve(legacy, 'index.html'))
for (const section of COMPANION_SECTION_PATHS) {
  mkdirSync(resolve(legacy, section), { recursive: true })
  cpSync(resolve(root, 'migration/legacy-index.html'), resolve(legacy, section, 'index.html'))
}
for (const file of ['catalog.json', 'manifest.webmanifest', 'pwa', 'licenses', 'assets/upgrades']) cpSync(resolve(legacyApp, file), resolve(legacy, file), { recursive: true })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const assets = []
function walk(parent = '') { for (const entry of readdirSync(resolve(legacy, parent), { withFileTypes: true })) { const file = parent + entry.name; if (entry.isDirectory()) walk(file + '/'); else assets.push({ file, sha256: sha(readFileSync(resolve(legacy, file))) }) } }
walk(); assets.sort((a, b) => a.file.localeCompare(b.file))
const worker = readFileSync(resolve(root, 'scripts/pwa-worker.js'), 'utf8').replaceAll('idle-slayer-companion-public-', 'idle-slayer-legacy-bridge-public-')
const release = { version: sha(JSON.stringify(assets) + worker), assets }
writeFileSync(resolve(legacy, 'sw.js'), 'const RELEASE = ' + JSON.stringify(release) + ';\n' + worker)
writeFileSync(resolve(legacy, 'offline-assets.json'), JSON.stringify(release, null, 2) + '\n')
writeFileSync(resolve(output, '.nojekyll'), '')
writeFileSync(resolve(output, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>Idle Slayer Companion has moved</title><h1>Idle Slayer Companion has moved</h1><p>Keep your old browser data until you have exported and restored your backups.</p><a href="/idle-slayer-companion/">Open old Companion for backups</a> · <a href="https://austingarrod.ca/utilities/idle-slayer-companion/#analytics=off" rel="noreferrer">Open new utility</a></html>\n')
console.log('Prepared frozen legacy migration site at .cache/site-migration. No hosting or repository settings were changed.')
