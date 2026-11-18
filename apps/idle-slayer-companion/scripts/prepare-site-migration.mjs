import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { validateRetirementArtifact } from './retirement-artifact.ts'
import { validateNoticeDistribution } from './runtime-notices.ts'
import { validatePwaDistribution } from './pwa.ts'
import { LEGACY_DEPLOYMENT, LEGACY_MAP_DEPLOYMENT } from '../deployment.ts'

const root = process.cwd(), cache = resolve(root, '.cache'), output = resolve(cache, 'site-migration')
const builds = [
  { directory: resolve(cache, 'legacy-migration-app'), deployment: LEGACY_DEPLOYMENT },
  { directory: resolve(cache, 'legacy-migration-map'), deployment: LEGACY_MAP_DEPLOYMENT },
]
for (const directory of [output, ...builds.map((build) => build.directory)]) {
  const stat = lstatSync(directory, { throwIfNoEntry: false })
  if (!directory.startsWith(cache + sep) || relative(cache, directory).includes(sep) || (stat && (stat.isSymbolicLink() || !stat.isDirectory()))) throw new Error('Unsafe migration output')
}
const cacheStat = lstatSync(cache, { throwIfNoEntry: false })
if (cacheStat && (cacheStat.isSymbolicLink() || !cacheStat.isDirectory() || !realpathSync(cache).startsWith(realpathSync(root) + sep))) throw new Error('Migration cache must stay within this workspace')
for (const filename of ['site-migration-SHA256SUMS', 'site-migration-release.json']) {
  const stat = lstatSync(resolve(cache, filename), { throwIfNoEntry: false })
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) throw new Error('Migration metadata must be regular workspace files')
}

// Build both complete historical releases before replacing the prepared site.
// Neither retirement build imports the app startup or changes its symbol receipt.
for (const { directory, deployment } of builds) {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', directory], {
    cwd: root, env: { ...process.env, COMPANION_DEPLOY_TARGET: 'legacy-migration', COMPANION_LEGACY_BASE: deployment.base }, stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Retirement build failed: ' + deployment.base)
  validateRetirementArtifact(root, directory, deployment)
  validateNoticeDistribution(root, directory, true)
  validatePwaDistribution(root, directory, deployment)
}
// Targets above were resolved and checked within this workspace before removal.
if (existsSync(output)) rmSync(output, { recursive: true })
mkdirSync(output, { recursive: true })
for (const { directory, deployment } of builds) cpSync(directory, resolve(output, deployment.base.slice(1, -1)), { recursive: true })
writeFileSync(resolve(output, '.nojekyll'), '')
writeFileSync(resolve(output, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>Idle Slayer Companion has moved</title><h1>Idle Slayer Companion has moved</h1><p>The former app is retired. Keep your old browser data until you have exported and restored your backups.</p><a href="/idle-slayer-companion/">Transfer saved data</a> · <a href="https://austingarrod.ca/utilities/idle-slayer-companion/?migration=1#analytics=off" rel="noreferrer">Open new app</a></html>\n')

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = []
function walk(parent = '') {
  for (const entry of readdirSync(resolve(output, parent), { withFileTypes: true })) {
    const file = parent + entry.name
    if (entry.isSymbolicLink()) throw new Error('Linked migration artifact')
    if (entry.isDirectory()) walk(file + '/')
    else { const bytes = readFileSync(resolve(output, file)); files.push({ file, sha256: sha(bytes), bytes: bytes.length }) }
  }
}
walk(); files.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
const manifest = files.map((file) => file.sha256 + '  site/' + file.file + '\n').join('')
writeFileSync(resolve(cache, 'site-migration-SHA256SUMS'), manifest)
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8' }).trim())
const releaseOf = (directory) => JSON.parse(readFileSync(resolve(directory, 'offline-assets.json'), 'utf8')).version
writeFileSync(resolve(cache, 'site-migration-release.json'), JSON.stringify({
  sourceRepository: 'AustinGarrod/austingarrod-ca', sourcePath: 'apps/idle-slayer-companion', sourceCommit, sourceDirty,
  destination: LEGACY_DEPLOYMENT.canonical, retired: true,
  companionBase: LEGACY_DEPLOYMENT.base, compatibilityBase: LEGACY_MAP_DEPLOYMENT.base,
  files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), sha256Manifest: sha(manifest),
  companionRelease: releaseOf(builds[0].directory), compatibilityRelease: releaseOf(builds[1].directory),
}, null, 2) + '\n')
console.log('Prepared transfer-only retirement site at .cache/site-migration, with site-migration-SHA256SUMS and site-migration-release.json beside it. No hosting or repository settings were changed.')
