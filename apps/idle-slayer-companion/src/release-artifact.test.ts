import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cpSync as copyPath, lstatSync, mkdirSync as createDirectory, mkdtempSync, readdirSync, readFileSync, rmSync as removePath, symlinkSync as createLink, unlinkSync, writeFileSync as writeBytes } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { validateReleaseArtifact } from '../scripts/release-artifact'

const root = process.cwd()
const base = '/utilities/idle-slayer-companion/'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as { upgrades: { icon: string }[] }
let fixtureDirectory: string | undefined
let distribution: string | undefined
const originalFiles = new Map<string, Buffer>()
const originalDirectories = new Set<string>()
const mutations = new Set<string>()
const html = '<!doctype html><html><head><script type="module" src="' + base + 'assets/index-fixture.js"></script>'
  + '<link rel="stylesheet" href="' + base + 'assets/index-fixture.css"></head><body><div id="root"></div></body></html>'
function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'idle-slayer-artifact-'))
  fixtureDirectory = directory
  const dist = join(directory, 'dist')
  mkdirSync(join(dist, 'licenses'), { recursive: true })
  cpSync('public/assets/upgrades', join(dist, 'assets/upgrades'), { recursive: true })
  cpSync('public/catalog.json', join(dist, 'catalog.json'))
  cpSync('public/companion-catalog.json', join(dist, 'companion-catalog.json'))
  cpSync('public/assets/companion', join(dist, 'assets/companion'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), html)
  writeFileSync(join(dist, 'assets/index-fixture.js'), 'export const fixture = true\n')
  writeFileSync(join(dist, 'assets/index-fixture.css'), '@import "./extra.css";@font-face{src:url("' + base + 'assets/font.woff2")}body{background-image:url("data:image/svg+xml,%3Csvg/%3E")}')
  writeFileSync(join(dist, 'assets/extra.css'), 'body{color:gold}')
  writeFileSync(join(dist, 'assets/font.woff2'), 'Synthetic bundled font bytes')
  writeFileSync(join(dist, 'licenses/bundle-notices.json'), JSON.stringify({ chunks: [{ file: 'assets/index-fixture.js' }] }))
  function remember(directory: string) {
    originalDirectories.add(directory)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) remember(path)
      else originalFiles.set(path, readFileSync(path))
    }
  }
  remember(dist)
  mutations.clear()
  return dist
}
function fixture() { if (!distribution) throw new Error('Artifact fixture was not initialized.'); return distribution }
function mutationPath(file: string) {
  const path = resolve(file)
  if (!fixtureDirectory || !path.startsWith(fixtureDirectory + sep)) throw new Error('Fixture mutation is outside the test directory.')
  mutations.add(path)
  return path
}
// Only fixture mutations are journaled. Production validation still walks and
// hashes every real distributed file on every call, including repeated calls.
function writeFileSync(file: string, bytes: string | Uint8Array) { writeBytes(mutationPath(file), bytes) }
function rmSync(file: string, options?: { recursive?: boolean; force?: boolean }) { removePath(mutationPath(file), options) }
function mkdirSync(file: string, options?: { recursive?: boolean }) { createDirectory(mutationPath(file), options) }
function cpSync(source: string, target: string, options?: { recursive?: boolean }) { copyPath(source, mutationPath(target), options) }
function symlinkSync(target: string, file: string, type?: 'dir' | 'file' | 'junction') {
  if (!fixtureDirectory || !resolve(target).startsWith(fixtureDirectory + sep)) throw new Error('Fixture link target is outside the test directory.')
  createLink(target, mutationPath(file), type)
}
function resetFixture() {
  // Removed directories include their descendant mutations. Restore those
  // subtrees once; ordinary icon/CSS cases restore only the changed file.
  const paths = [...mutations].filter((path) => ![...mutations].some((other) => path.startsWith(other + sep)))
  for (const path of paths) {
    if (!fixtureDirectory || !path.startsWith(fixtureDirectory + sep)) throw new Error('Unsafe fixture cleanup')
    // Windows rm(force) can leave a junction after its target was removed.
    // Inspect/unlink the link itself without following its target.
    try {
      if (lstatSync(path).isSymbolicLink()) unlinkSync(path)
      else removePath(path, { recursive: true, force: true })
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (originalDirectories.has(path)) {
      for (const directory of originalDirectories) if (directory === path || directory.startsWith(path + sep)) createDirectory(directory, { recursive: true })
      for (const [file, bytes] of originalFiles) if (file.startsWith(path + sep)) writeBytes(file, bytes)
    } else {
      const bytes = originalFiles.get(path)
      if (bytes) { createDirectory(dirname(path), { recursive: true }); writeBytes(path, bytes) }
    }
  }
  mutations.clear()
}

describe('actual deployment artifact release gate', { timeout: 15_000 }, () => {
  // This verifies byte integrity over 1,493 real sprites, not a latency contract.
  // Copy once and restore mutations, avoiding a full asset copy/delete cycle
  // per case while unrelated suites compete for Windows disk I/O.
  beforeAll(() => { distribution = createFixture() }, 20_000)
  afterEach(resetFixture, 15_000)
  afterAll(() => {
    if (!fixtureDirectory) return
    if (!resolve(fixtureDirectory).startsWith(resolve(tmpdir()) + sep + 'idle-slayer-artifact-')) throw new Error('Refusing cleanup outside artifact fixture directories.')
    try { if (distribution) validateReleaseArtifact(root, distribution) }
    finally { removePath(fixtureDirectory, { recursive: true, force: true }); fixtureDirectory = undefined; distribution = undefined }
  }, 15_000)
  it('accepts local built entries, CSS imports/fonts, and all 288 receipt-matched public icons', () => {
    expect(catalog.upgrades).toHaveLength(288)
    expect(() => validateReleaseArtifact(root, fixture())).not.toThrow()
  })
  it('rejects an empty artifact and remaining runtime files without application HTML, catalog or icons', () => {
    const dist = fixture()
    for (const file of ['index.html', 'catalog.json', 'assets/upgrades']) rmSync(join(dist, file), { recursive: true })
    expect(() => validateReleaseArtifact(root, dist)).toThrow()
    for (const file of ['licenses', 'assets']) rmSync(join(dist, file), { recursive: true })
    expect(() => validateReleaseArtifact(root, dist)).toThrow()
  })
  it.each(['index.html', 'catalog.json', 'assets/index-fixture.js', 'assets/index-fixture.css', 'assets/extra.css', 'assets/font.woff2', catalog.upgrades[0].icon])('rejects a missing required asset: %s', (file) => {
    const dist = fixture()
    rmSync(join(dist, file))
    expect(() => validateReleaseArtifact(root, dist)).toThrow()
  })
  it.each(['index.html', 'assets/index-fixture.js', 'assets/index-fixture.css', 'assets/font.woff2', catalog.upgrades[0].icon])('rejects an empty required asset: %s', (file) => {
    const dist = fixture()
    writeFileSync(join(dist, file), '')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('nonempty')
  })
  it('rejects stale distributed catalog and icon bytes against the reviewed receipt', () => {
    const dist = fixture()
    writeFileSync(join(dist, 'catalog.json'), readFileSync('public/catalog.json', 'utf8') + '\n')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('Distributed catalog')
    cpSync('public/catalog.json', join(dist, 'catalog.json'))
    writeFileSync(join(dist, catalog.upgrades.at(-1)!.icon), 'Synthetic changed icon bytes')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('Distributed icon')
  })
  it.each([
    { change: 'catalog bytes', error: 'Distributed companion catalog' },
    { change: 'icon bytes', error: 'Distributed companion icon' },
    { change: 'unreviewed sprites', error: 'companion sprite inventory' },
  ])('rejects companion $change against its reviewed receipt', ({ change, error }) => {
    const dist = fixture()
    if (change === 'catalog bytes') writeFileSync(join(dist, 'companion-catalog.json'), readFileSync('public/companion-catalog.json', 'utf8') + '\n')
    else if (change === 'icon bytes') {
      const companion = JSON.parse(readFileSync('public/companion-catalog.json', 'utf8')) as { entities: { icon?: string }[] }
      writeFileSync(join(dist, companion.entities.find((entity) => entity.icon)!.icon!), 'Synthetic changed companion icon')
    } else writeFileSync(join(dist, 'assets/companion/unreviewed.png'), 'Synthetic unreviewed sprite')
    expect(() => validateReleaseArtifact(root, dist)).toThrow(error)
    // This is a byte-integrity check over 1,493 real sprites, not a latency
    // assertion. Allow concurrent file-heavy suites to share Windows disk I/O.
  }, 15_000)
  it('rejects unreviewed extra sprites and receipt coverage that differs from the catalog', () => {
    const dist = fixture()
    writeFileSync(join(dist, 'assets/upgrades/unreviewed.png'), 'Synthetic unreviewed sprite')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('sprite inventory')
    rmSync(join(dist, 'assets/upgrades/unreviewed.png'))
    const source = join(dist, '..', 'source')
    mkdirSync(join(source, 'public'), { recursive: true })
    mkdirSync(join(source, 'data'))
    cpSync('public/catalog.json', join(source, 'public/catalog.json'))
    const receipt = JSON.parse(readFileSync('data/catalog-receipt.json', 'utf8'))
    writeFileSync(join(source, 'data/catalog-receipt.json'), JSON.stringify({ ...receipt, nativeEdgeCount: receipt.nativeEdgeCount - 1 }))
    expect(() => validateReleaseArtifact(source, dist)).toThrow('catalog coverage')
  })
  it('rejects a missing root, absent built entries, source TypeScript and an unreceipted module', () => {
    const dist = fixture()
    writeFileSync(join(dist, 'index.html'), html.replace('id="root"', 'id="other"'))
    expect(() => validateReleaseArtifact(root, dist)).toThrow('root mount')
    writeFileSync(join(dist, 'index.html'), '<div id="root"></div>')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('built module and stylesheet')
    writeFileSync(join(dist, 'assets/source.tsx'), 'export const source = true')
    writeFileSync(join(dist, 'index.html'), html.replace('index-fixture.js', 'source.tsx'))
    expect(() => validateReleaseArtifact(root, dist)).toThrow('built runtime receipt')
    writeFileSync(join(dist, 'assets/other.js'), 'export const unreceipted = true')
    writeFileSync(join(dist, 'index.html'), html.replace('index-fixture.js', 'other.js'))
    expect(() => validateReleaseArtifact(root, dist)).toThrow('built runtime receipt')
  })
  it.each(['../../outside.woff2', '/outside.woff2', base + 'assets/%2e%2e/outside.woff2', 'C:\\private\\font.woff2', 'https://example.invalid/font.woff2', '//example.invalid/font.woff2'])('rejects unsafe or external CSS asset reference: %s', (reference) => {
    const dist = fixture()
    writeFileSync(join(dist, 'assets/index-fixture.css'), '@font-face{src:url("' + reference + '")}')
    expect(() => validateReleaseArtifact(root, dist)).toThrow(/Unsafe deployment|outside the Pages base/)
  })
  it('checks url-form CSS imports as stylesheets rather than accepting another asset type', () => {
    const dist = fixture()
    writeFileSync(join(dist, 'assets/index-fixture.css'), '@import url("./extra.css");')
    expect(() => validateReleaseArtifact(root, dist)).not.toThrow()
    writeFileSync(join(dist, 'assets/index-fixture.css'), '@import url("./font.woff2");')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('built CSS')
  })
  it('rejects a wrong Pages base in HTML and private files or directories anywhere in the artifact', () => {
    const dist = fixture()
    writeFileSync(join(dist, 'index.html'), html.replaceAll(base, '/wrong-map/'))
    expect(() => validateReleaseArtifact(root, dist)).toThrow('Pages base')
    writeFileSync(join(dist, 'index.html'), html)
    writeFileSync(join(dist, 'assets/synthetic.sav'), 'Synthetic private input')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('Private input')
    rmSync(join(dist, 'assets/synthetic.sav'))
    mkdirSync(join(dist, '.local-game'))
    expect(() => validateReleaseArtifact(root, dist)).toThrow('Private source')
  })
  it('rejects linked directories instead of reading files outside the distributable', () => {
    const dist = fixture()
    const outside = join(dist, '..', 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'synthetic.sav'), 'Synthetic private input')
    symlinkSync(outside, join(dist, 'assets/linked-input'), 'junction')
    expect(() => validateReleaseArtifact(root, dist)).toThrow('Linked file or directory')
  })
})
