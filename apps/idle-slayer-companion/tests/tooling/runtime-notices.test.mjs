import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { noticeHash, renderNoticeIndex } from '../../scripts/runtime-notices.ts'

const command = resolve('scripts/maintain-runtime-notices.mjs')
const notice = Buffer.from('Synthetic complete upstream notice\r\nCopyright Fixture Authors\r\nAll fixture terms, including the final line.\r\n')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'idle-slayer-notice-tools-'))
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'idle-slayer-notice-tools-'))
    rmSync(root, { recursive: true, force: true })
  })
  mkdirSync(join(root, 'public/licenses'), { recursive: true })
  const manifest = { schemaVersion: 1, packages: [] }
  function add(name, inclusion = 'module', sources = ['LICENSE']) {
    const filePrefix = name.replaceAll(/[@/]/g, '_')
    mkdirSync(join(root, 'node_modules', name), { recursive: true })
    writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ version: '1.0.0', license: 'MIT' }))
    const item = { name, version: '1.0.0', license: 'MIT', inclusion, notices: sources.map((source, index) => ({ source, file: filePrefix + '-' + index + '.txt', sha256: '' })) }
    for (const source of sources) writeFileSync(join(root, 'node_modules', name, source), notice)
    manifest.packages.push(item)
    return item
  }
  function save() { writeFileSync(join(root, 'public/licenses/notices.json'), JSON.stringify(manifest, null, 2) + '\n') }
  function run(mode, extra = []) { return spawnSync(process.execPath, [command, mode, ...extra], { cwd: root, encoding: 'utf8' }) }
  function snapshot() {
    return Object.fromEntries(readdirSync(join(root, 'public/licenses')).sort().map((file) => [file, readFileSync(join(root, 'public/licenses', file)).toString('base64')]))
  }
  add('fixture-runtime')
  save()
  return { root, manifest, add, save, run, snapshot }
}

test('refresh copies complete bytes, hashes every reviewed source and renders a deterministic index', (t) => {
  const f = fixture(t)
  f.add('@dagrejs/graphlib', 'embedded')
  f.add('rolldown', 'helper', ['LICENSE', 'THIRD-PARTY-LICENSE'])
  f.save()
  const result = f.run('refresh')
  assert.equal(result.status, 0, result.stderr)
  const refreshed = JSON.parse(readFileSync(join(f.root, 'public/licenses/notices.json'), 'utf8'))
  assert.deepEqual(refreshed.packages.map(({ name, version, license, inclusion }) => ({ name, version, license, inclusion })),
    f.manifest.packages.map(({ name, version, license, inclusion }) => ({ name, version, license, inclusion })))
  for (const item of refreshed.packages) for (const source of item.notices) {
    assert.equal(source.sha256, noticeHash(notice))
    assert.deepEqual(readFileSync(join(f.root, 'public/licenses', source.file)), notice)
  }
  assert.equal(readFileSync(join(f.root, 'public/licenses/index.html'), 'utf8'), renderNoticeIndex(refreshed))
  const before = f.snapshot()
  assert.equal(f.run('check').status, 0)
  assert.deepEqual(f.snapshot(), before, 'check must be read-only')
  const repeated = f.run('refresh')
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.match(repeated.stdout, /0 files changed/)
  assert.deepEqual(f.snapshot(), before, 'a second refresh must produce identical bytes')
})

test('refresh refuses installed version or license changes until metadata is reviewed explicitly', (t) => {
  const f = fixture(t)
  assert.equal(f.run('refresh').status, 0)
  for (const metadata of [{ version: '2.0.0', license: 'MIT' }, { version: '1.0.0', license: 'BSD-3-Clause' }]) {
    writeFileSync(join(f.root, 'node_modules/fixture-runtime/package.json'), JSON.stringify(metadata))
    const before = f.snapshot()
    const result = f.run('refresh')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Review required.*Refresh never approves or changes versions, licenses/)
    assert.deepEqual(f.snapshot(), before)
  }
  f.manifest.packages[0].license = 'BSD-3-Clause'
  f.save()
  assert.equal(f.run('refresh').status, 0, 'explicitly reviewed matching metadata permits mechanical refresh')
  assert.equal(f.run('check').status, 0)
})

test('reviewed additions work and removals require explicit obsolete-file removal', (t) => {
  const f = fixture(t)
  assert.equal(f.run('refresh').status, 0)
  const added = f.add('new-runtime', 'module', ['LICENSE.md'])
  f.save()
  assert.equal(f.run('refresh').status, 0)
  assert.equal(f.run('check').status, 0)
  f.manifest.packages = f.manifest.packages.filter((item) => item.name !== added.name)
  f.save()
  const before = f.snapshot()
  for (const mode of ['check', 'refresh']) {
    const result = f.run(mode)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unreferenced notice files require manual removal review: new-runtime-0.txt/)
    assert.deepEqual(f.snapshot(), before)
  }
  rmSync(join(f.root, 'public/licenses', added.notices[0].file))
  assert.equal(f.run('refresh').status, 0)
  assert.equal(f.run('check').status, 0)
})

test('all inputs are preflighted before refresh writes any artifacts', (t) => {
  const f = fixture(t)
  assert.equal(f.run('refresh').status, 0)
  writeFileSync(join(f.root, 'node_modules/fixture-runtime/LICENSE'), 'New complete synthetic fixture terms\n')
  const second = f.add('second-runtime')
  rmSync(join(f.root, 'node_modules/second-runtime', second.notices[0].source))
  f.save()
  const before = f.snapshot()
  assert.equal(f.run('refresh').status, 1)
  assert.deepEqual(f.snapshot(), before)
})

test('invalid identities, unsafe paths and duplicate destinations are refused without writes', (t) => {
  const f = fixture(t)
  const original = structuredClone(f.manifest)
  const mutations = [
    (manifest) => { manifest.packages[0].name = '../outside' },
    (manifest) => { manifest.packages[0].notices[0].source = '../outside' },
    (manifest) => { manifest.packages[0].notices[0].file = '../outside.txt' },
    (manifest) => { manifest.packages[0].notices.push(structuredClone(manifest.packages[0].notices[0])) },
    (manifest) => { manifest.packages.push(structuredClone(manifest.packages[0])) },
    (manifest) => { manifest.packages[0].notices[0].sha256 = 'invalid' },
    (manifest) => { manifest.packages[0].inclusion = 'unreviewed' },
  ]
  for (const mutate of mutations) {
    f.manifest.packages = structuredClone(original.packages)
    mutate(f.manifest)
    f.save()
    const before = f.snapshot()
    const result = f.run('refresh')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid or duplicate reviewed/)
    assert.deepEqual(f.snapshot(), before)
  }
})

test('check refuses pending hashes, changed source bytes and a stale index without writing', (t) => {
  const f = fixture(t)
  let before = f.snapshot()
  assert.equal(f.run('check').status, 1, 'a pending hash is not a valid reviewed artifact')
  assert.deepEqual(f.snapshot(), before)
  assert.equal(f.run('refresh').status, 0)
  writeFileSync(join(f.root, 'node_modules/fixture-runtime/LICENSE'), 'Changed complete synthetic fixture terms\n')
  before = f.snapshot()
  assert.match(f.run('check').stderr, /Notice differs from complete upstream bytes/)
  assert.deepEqual(f.snapshot(), before)
  assert.equal(f.run('refresh').status, 0)
  writeFileSync(join(f.root, 'public/licenses/index.html'), 'stale index')
  before = f.snapshot()
  assert.match(f.run('check').stderr, /Runtime notice index is stale/)
  assert.deepEqual(f.snapshot(), before)
})

test('Windows case aliases are rejected before either command writes any artifact', (t) => {
  const f = fixture(t)
  assert.equal(f.run('refresh').status, 0)
  const second = f.add('second-runtime')
  writeFileSync(join(f.root, 'node_modules/second-runtime/LICENSE'), 'Distinct complete synthetic second notice\n')
  second.notices[0].file = f.manifest.packages[0].notices[0].file.toUpperCase().replace(/\.TXT$/, '.txt')
  f.save()
  const before = f.snapshot()
  for (const mode of ['check', 'refresh']) {
    const result = f.run(mode)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid or duplicate reviewed notice file/)
    assert.deepEqual(f.snapshot(), before, 'case aliases must fail during preflight, before copies or index/manifest writes')
  }
})

test('empty upstream notices and invalid commands are refused without writes', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'node_modules/fixture-runtime/LICENSE'), '')
  const before = f.snapshot()
  assert.match(f.run('refresh').stderr, /Empty upstream notice/)
  assert.equal(f.run('update').status, 1)
  assert.match(f.run('check', ['--approve-licenses']).stderr, /Usage:/)
  assert.deepEqual(f.snapshot(), before)
})

test('existing filename casing must be explicitly renamed before portable refresh', (t) => {
  const f = fixture(t)
  assert.equal(f.run('refresh').status, 0)
  const original = f.manifest.packages[0].notices[0].file
  const reviewed = original[0].toUpperCase() + original.slice(1)
  f.manifest.packages[0].notices[0].file = reviewed
  f.save()
  const before = f.snapshot()
  for (const mode of ['check', 'refresh']) {
    const result = f.run(mode)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Case-only notice filename changes require manual rename review/)
    assert.deepEqual(f.snapshot(), before, 'physical casing mismatch must fail before manifest/index or notice writes')
  }
  const directory = join(f.root, 'public/licenses')
  const intermediate = join(directory, 'reviewed-case-rename.tmp')
  renameSync(join(directory, original), intermediate)
  renameSync(intermediate, join(directory, reviewed))
  assert.equal(f.run('refresh').status, 0)
  assert.equal(f.run('check').status, 0)
  assert.ok(readdirSync(directory).includes(reviewed))
  assert.ok(!readdirSync(directory).includes(original))
})
