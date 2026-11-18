import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { LEGACY_DEPLOYMENT } from '../deployment'
import { validateRetirementArtifact, validateRetirementModules } from '../scripts/retirement-artifact'

const directories: string[] = []
const hash = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex')
const base = LEGACY_DEPLOYMENT.base
const html = '<!doctype html><html><head><meta name="robots" content="noindex"><link rel="canonical" href="' + LEGACY_DEPLOYMENT.canonical + '"><link rel="manifest" href="' + base + 'manifest.webmanifest"><script type="module" src="' + base + 'assets/retirement.js"></script><link rel="stylesheet" href="' + base + 'assets/retirement.css"></head><body><div id="root"></div></body></html>'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'companion-retirement-test-'))
  directories.push(directory)
  const root = join(directory, 'source'), dist = join(directory, 'dist')
  for (const path of ['source/public/licenses', 'source/data', 'dist/assets', 'dist/licenses']) mkdirSync(join(directory, path), { recursive: true })
  copyFileSync(resolve('public/catalog.json'), join(root, 'public/catalog.json'))
  copyFileSync(resolve('data/catalog-receipt.json'), join(root, 'data/catalog-receipt.json'))
  copyFileSync(resolve('public/catalog.json'), join(dist, 'catalog.json'))
  writeFileSync(join(root, 'public/licenses/notices.json'), JSON.stringify({ packages: [] }))
  const script = 'document.getElementById("root").textContent="Idle Slayer Companion has moved";'
  const receipt = { version: 1, entry: 'migration/retirement.tsx', modules: ['migration/retirement.tsx', 'migration/RetirementPage.tsx', 'migration/retirement-exports.ts', 'src/domain/companion-workspace.ts'], chunks: [{ file: 'assets/retirement.js', sha256: hash(script) }] }
  writeFileSync(join(dist, 'retirement-entry.json'), JSON.stringify(receipt))
  const packages = ['react', 'react-dom', 'scheduler', 'vite', 'rolldown'].map((name) => ({ name }))
  writeFileSync(join(dist, 'licenses/bundle-notices.json'), JSON.stringify({ packages, chunks: receipt.chunks }))
  writeFileSync(join(dist, 'assets/retirement.js'), script)
  writeFileSync(join(dist, 'assets/retirement.css'), 'body{color:#000}')
  writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify({ id: LEGACY_DEPLOYMENT.identity, scope: base, start_url: base }))
  writeFileSync(join(dist, 'index.html'), html)
  for (const section of ['overview', 'ascension', 'achievements', 'crafting', 'quests', 'bestiary', 'divinities']) {
    mkdirSync(join(dist, section))
    writeFileSync(join(dist, section, 'index.html'), html)
  }
  return { root, dist, receipt, packages, check: () => validateRetirementArtifact(root, dist, LEGACY_DEPLOYMENT) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'companion-retirement-test-')) throw new Error('Unsafe test cleanup')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('dedicated retirement artifact', () => {
  it('accepts a minimal transfer page without full companion data, icons or application runtime', () => {
    expect(fixture().check).not.toThrow()
  })
  it.each(['src/App.tsx', 'src/MapApp.tsx', 'src/analytics.ts', 'src/reporting.ts', 'src/pwa.ts', 'src/domain/companion-session.ts', 'src/domain/profile-session.ts', 'src/components/MigrationGuide.tsx', 'C:/private/source.ts', '../outside.ts'])('rejects application, writable or unsafe module %s', (module) => {
    expect(() => validateRetirementModules(['migration/retirement.tsx', module])).toThrow('Unreviewed retirement runtime module')
  })
  it('requires a unique dedicated entry and rejects receipts for full-app chunks', () => {
    const f = fixture()
    for (const modules of [[], ['src/domain/types.ts'], ['migration/retirement.tsx', 'migration/retirement.tsx']]) expect(() => validateRetirementModules(modules)).toThrow('dedicated entry')
    f.receipt.entry = 'src/main.tsx'
    writeFileSync(join(f.dist, 'retirement-entry.json'), JSON.stringify(f.receipt))
    expect(f.check).toThrow('Invalid retirement entry')
  })
  it('binds the exact script inventory to both build receipts and the delivered bytes', () => {
    const f = fixture()
    writeFileSync(join(f.dist, 'assets/retirement.js'), 'console.log("changed")')
    expect(f.check).toThrow('chunk differs')
    const original = 'document.getElementById("root").textContent="Idle Slayer Companion has moved";'
    writeFileSync(join(f.dist, 'assets/retirement.js'), original)
    writeFileSync(join(f.dist, 'assets/old-app.js'), 'console.log("old app")')
    expect(f.check).toThrow('Unreceipted JavaScript')
    rmSync(join(f.dist, 'assets/old-app.js'))
    writeFileSync(join(f.dist, 'licenses/bundle-notices.json'), JSON.stringify({ packages: f.packages, chunks: [] }))
    expect(f.check).toThrow('runtime notices')
  })
  it.each(['@xyflow/react', '@sentry/react'])('rejects accidental direct application dependency %s even when its notice is reviewed', (name) => {
    const f = fixture()
    writeFileSync(join(f.dist, 'licenses/bundle-notices.json'), JSON.stringify({ packages: [...f.packages, { name }], chunks: f.receipt.chunks }))
    expect(f.check).toThrow('unreviewed package')
  })
  it.each(['backup.json', 'assets/old-app.js.map', 'companion-catalog.json', 'assets/native.sav', '.env', 'assets/upgrades/icon.png'])('rejects unreviewed deployed file %s', (file) => {
    const f = fixture(), path = join(f.dist, file)
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, 'unreviewed bytes')
    expect(f.check).toThrow('Unreviewed retirement artifact file')
  })
  it.each(['https://external.invalid/app.js', '//external.invalid/app.js', '/wrong-base/retirement.js', base + 'assets/%2e%2e/source.js'])('rejects unsafe or external runtime references %s', (reference) => {
    const f = fixture()
    writeFileSync(join(f.dist, 'index.html'), html.replace(base + 'assets/retirement.js', reference))
    expect(f.check).toThrow(/Unsafe retirement asset reference|outside its historical base/)
  })
  it('checks nested CSS resources and rejects external fonts and scripts in HTML', () => {
    const f = fixture()
    writeFileSync(join(f.dist, 'assets/retirement.css'), '@font-face{src:url(https://external.invalid/font.woff2)}')
    expect(f.check).toThrow('Unsafe retirement asset reference')
    writeFileSync(join(f.dist, 'assets/retirement.css'), 'body{color:#000}')
    writeFileSync(join(f.dist, 'index.html'), html.replace('</head>', '<script>console.log("old app")</script></head>'))
    expect(f.check).toThrow('Inline executable script')
  })
  it('requires canonical, noindex, complete section entries and stable installation identity', () => {
    const f = fixture()
    writeFileSync(join(f.dist, 'index.html'), html.replace('noindex', 'index'))
    expect(f.check).toThrow('canonical destination and noindex')
    writeFileSync(join(f.dist, 'index.html'), html)
    writeFileSync(join(f.dist, 'ascension/index.html'), '<h1>Old app</h1>')
    expect(f.check).toThrow('section entry differs')
    writeFileSync(join(f.dist, 'ascension/index.html'), html)
    writeFileSync(join(f.dist, 'manifest.webmanifest'), JSON.stringify({ id: '/changed/', scope: base, start_url: base }))
    expect(f.check).toThrow('installation identity')
  })
  it('requires the exact reviewed catalog for spoiler-aware comparison exports', () => {
    const f = fixture()
    writeFileSync(join(f.dist, 'catalog.json'), readFileSync(join(f.dist, 'catalog.json'), 'utf8') + '\n')
    expect(f.check).toThrow('catalog differs')
  })
  it('rejects symlinked directories before following external artifact inputs', () => {
    const f = fixture(), outside = join(f.dist, '..', 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'private.sav'), 'not public')
    symlinkSync(outside, join(f.dist, 'assets/linked'), 'junction')
    expect(f.check).toThrow('Linked file or directory')
  })
})
