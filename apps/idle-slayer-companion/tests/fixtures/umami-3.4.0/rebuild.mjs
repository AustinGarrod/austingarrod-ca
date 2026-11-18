import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const repository = resolve(fixtureDirectory, '../../..')
const provenance = JSON.parse(await readFile(join(fixtureDirectory, 'provenance.json'), 'utf8'))
const buildDirectory = await mkdtemp(join(tmpdir(), 'idle-slayer-umami-fixture-'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
for (const [path, expected] of Object.entries(provenance.sourceSha256)) {
  const response = await fetch(`https://raw.githubusercontent.com/umami-software/umami/${provenance.commit}/${path}`)
  if (!response.ok) throw new Error(`Official fixture source unavailable: ${path}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (hash(bytes) !== expected) throw new Error(`Official fixture source hash changed: ${path}`)
  const destination = join(buildDirectory, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
}
await writeFile(join(buildDirectory, 'package.json'), JSON.stringify(provenance.buildPackage, null, 2))
await writeFile(join(buildDirectory, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
await mkdir(join(buildDirectory, 'public'), { recursive: true })
execFileSync(process.execPath, [join(repository, '.yarn/releases/yarn-4.13.0.cjs'), 'install'], { cwd: buildDirectory, stdio: 'inherit' })
for (const target of ['tracker', 'recorder']) {
  execFileSync(process.execPath, ['node_modules/rollup/dist/bin/rollup', '-c', `rollup.${target}.config.js`], {
    cwd: buildDirectory, stdio: 'inherit',
    env: { ...process.env, COLLECT_API_HOST: '', COLLECT_API_ENDPOINT: '/api/send' },
  })
}
for (const [path, expected] of Object.entries(provenance.artifacts)) {
  if (hash(await readFile(join(buildDirectory, 'public', path))) !== expected) throw new Error(`Built fixture hash changed: ${path}`)
}
console.log(`Official fixture hashes verified. Build retained at ${buildDirectory}`)
