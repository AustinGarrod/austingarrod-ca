import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

type Inclusion = 'module' | 'embedded' | 'helper'
export interface NoticePackage {
  name: string
  version: string
  license: string
  inclusion: Inclusion
  notices: { source: string; file: string; sha256: string }[]
}
export interface NoticeFont {
  name: string; version: string; license: 'OFL-1.1'; source: string; sha256: string
  notice: { source: string; file: string; sha256: string; upstream: string }
}
export interface NoticeManifest { schemaVersion: 1; packages: NoticePackage[]; fonts?: NoticeFont[] }
export const noticeHash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const read = (root: string, path: string) => readFileSync(resolve(root, path))
const escaped = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export function readNoticeManifest(root: string): NoticeManifest {
  return JSON.parse(read(root, 'public/licenses/notices.json').toString('utf8')) as NoticeManifest
}

export function renderNoticeIndex(manifest: NoticeManifest): string {
  const sections = manifest.packages.map((item) => '<section data-package="' + escaped(item.name) + '" data-version="' + escaped(item.version)
    + '"><h2>' + escaped(item.name) + ' ' + escaped(item.version) + '</h2><p>' + escaped(item.license) + ' · '
    + escaped(item.inclusion === 'helper' ? 'Bundled build helper' : item.inclusion === 'embedded' ? 'Embedded in Dagre' : 'Bundled runtime, CSS or font')
    + '</p><ul>' + item.notices.map((notice) => '<li><a href="' + escaped(notice.file) + '">' + escaped(notice.file) + '</a></li>').join('') + '</ul></section>')
  const fonts = (manifest.fonts ?? []).map((font) => '<section data-font="' + escaped(font.name) + '"><h2>' + escaped(font.name) + ' ' + escaped(font.version) + '</h2><p>OFL-1.1 · Locally bundled font</p><a href="' + escaped(font.notice.file) + '">' + escaped(font.notice.file) + '</a></section>')
  return ['<!doctype html>', '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Bundled software licenses · Idle Slayer Companion</title>',
    '<style>body{margin:0;background:#f8f9ff;color:#0b1c30;font:16px/1.6 Inter,Arial,sans-serif;letter-spacing:0}main{max-width:56rem;margin:auto;padding:24px}h1{font-size:1.5rem}h2{font-size:1.1rem;overflow-wrap:anywhere}a{color:#006a61;overflow-wrap:anywhere}section{border-top:1px solid #c6c6cd;margin-top:24px;padding-top:12px}:focus-visible{outline:3px solid #006a61;outline-offset:3px}</style>',
    '</head><body><main><h1>Bundled software licenses</h1><p>Complete upstream notices for the software, font and generated helpers distributed with this companion.</p>',
    '<p>Application code, game artwork/data and wiki recommendation content have separate attribution. See the <a href="https://github.com/AustinGarrod/austingarrod-ca/blob/main/apps/idle-slayer-companion/THIRD_PARTY_NOTICES.md">game/wiki attribution and application licensing</a>.</p>',
    '<p><a href="notices.json">Version and notice hash manifest</a> · <a href="../">Return to Companion</a></p>',
    ...sections, ...fonts, '</main></body></html>', ''].join('\n')
}

export function validateNoticeSources(root: string, manifest: NoticeManifest): void {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages) || !manifest.packages.length) throw new Error('Invalid runtime notice manifest.')
  const names = new Set<string>(), files = new Set<string>()
  for (const item of manifest.packages) {
    if (!/^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/.test(item.name) || names.has(item.name)
      || !['module', 'embedded', 'helper'].includes(item.inclusion) || !item.notices.length) throw new Error('Invalid or duplicate runtime notice identity.')
    names.add(item.name)
    const installed = JSON.parse(read(root, 'node_modules/' + item.name + '/package.json').toString('utf8')) as { version: string; license: string }
    if (installed.version !== item.version || installed.license !== item.license) throw new Error('Stale notice version or license: ' + item.name)
    for (const notice of item.notices) {
      if (!['LICENSE', 'LICENSE.md', 'THIRD-PARTY-LICENSE'].includes(notice.source)
        || !/^[a-zA-Z0-9_-]+\.txt$/.test(notice.file) || files.has(notice.file) || !/^[a-f0-9]{64}$/.test(notice.sha256)) throw new Error('Invalid or duplicate notice file: ' + item.name)
      files.add(notice.file)
      const upstream = read(root, 'node_modules/' + item.name + '/' + notice.source)
      if (noticeHash(upstream) !== notice.sha256 || !upstream.equals(read(root, 'public/licenses/' + notice.file))) throw new Error('Notice differs from complete upstream bytes: ' + item.name)
    }
  }
  validateFontSources(root, manifest)
  if (!read(root, 'public/licenses/index.html').equals(Buffer.from(renderNoticeIndex(manifest)))) throw new Error('Runtime notice index is stale.')
}

/** Direct local fonts retain reviewed bytes and complete upstream OFL notices. */
export function validateFontSources(root: string, manifest: NoticeManifest): void {
  const fonts = manifest.fonts ?? [], sources = new Set<string>(), notices = new Set<string>()
  for (const font of fonts) {
    if (!font.name || !font.version || font.license !== 'OFL-1.1'
      || !/^src\/assets\/fonts\/[a-z0-9.-]+\.woff2$/.test(font.source) || sources.has(font.source)
      || !/^[a-f0-9]{64}$/.test(font.sha256)
      || !/^src\/assets\/fonts\/[a-zA-Z0-9_-]+\.txt$/.test(font.notice.source)
      || !/^[a-zA-Z0-9_-]+\.txt$/.test(font.notice.file) || notices.has(font.notice.file)
      || !/^[a-f0-9]{64}$/.test(font.notice.sha256)
      || !/^https:\/\/raw\.githubusercontent\.com\//.test(font.notice.upstream)) throw new Error('Invalid reviewed local font notice.')
    sources.add(font.source); notices.add(font.notice.file)
    if (noticeHash(read(root, font.source)) !== font.sha256) throw new Error('Local font differs from reviewed bytes: ' + font.name)
    const source = read(root, font.notice.source)
    if (noticeHash(source) !== font.notice.sha256 || !source.equals(read(root, 'public/licenses/' + font.notice.file))) throw new Error('Local font notice differs from complete upstream bytes: ' + font.name)
  }
}

export function validateBundleCoverage(root: string, manifest: NoticeManifest, modules: readonly { id: string; renderedLength: number }[]): NoticePackage[] {
  const included = new Map<string, Inclusion>()
  const helpers = new Map([['\0vite/modulepreload-polyfill.js', 'vite'], ['\0rolldown/runtime.js', 'rolldown']])
  const add = (name: string, kind: Inclusion) => {
    if (included.has(name) && included.get(name) !== kind) throw new Error('Unreviewed runtime inclusion path: ' + name)
    included.set(name, kind)
  }
  for (const module of modules) {
    const id = module.id.replaceAll('\\', '/')
    const match = id.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    if (match) add(match[1], 'module')
    else if (helpers.has(id)) add(helpers.get(id)!, 'helper')
    else if (id.startsWith('\0') && module.renderedLength > 0) throw new Error('Unreviewed generated runtime helper: ' + JSON.stringify(id))
  }
  if (included.has('@dagrejs/dagre')) {
    const graphlib = manifest.packages.find((item) => item.name === '@dagrejs/graphlib')
    const map = JSON.parse(read(root, 'node_modules/@dagrejs/dagre/dist/dagre.esm.js.map').toString('utf8')) as { sources: string[]; sourcesContent: string[] }
    const index = map.sources.findIndex((path) => path.endsWith('@dagrejs/graphlib/lib/version.ts'))
    if (!graphlib || index < 0 || !map.sourcesContent[index].includes("export const version = '" + graphlib.version + "';")) throw new Error('Embedded Graphlib version evidence is stale.')
    add('@dagrejs/graphlib', 'embedded')
  }
  if (included.size !== manifest.packages.length || manifest.packages.some((item) => included.get(item.name) !== item.inclusion)) {
    const reviewed = new Map(manifest.packages.map((item) => [item.name, item.inclusion]))
    const added = [...included.keys()].filter((name) => !reviewed.has(name)).sort()
    const removed = [...reviewed.keys()].filter((name) => !included.has(name)).sort()
    const changed = [...included.keys()].filter((name) => reviewed.has(name) && reviewed.get(name) !== included.get(name)).sort()
    throw new Error('Actual bundle runtime coverage differs from reviewed notices.'
      + (added.length ? ' Unreviewed packages: ' + added.join(', ') + '.' : '')
      + (removed.length ? ' No longer bundled: ' + removed.join(', ') + '.' : '')
      + (changed.length ? ' Inclusion kind changed: ' + changed.join(', ') + '.' : ''))
  }
  return manifest.packages
}

export function runtimeNoticesPlugin(root: string): Plugin {
  return {
    name: 'reviewed-runtime-notices', apply: 'build', enforce: 'post',
    generateBundle(_options, bundle) {
      const manifest = readNoticeManifest(root)
      validateNoticeSources(root, manifest)
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk')
      const modules = chunks.flatMap((chunk) => Object.entries(chunk.modules).map(([id, info]) => ({ id, renderedLength: info.renderedLength })))
      validateBundleCoverage(root, manifest, modules)
      // Only public package identities and distributable paths leave the build.
      this.emitFile({ type: 'asset', fileName: 'licenses/bundle-notices.json', source: JSON.stringify({
        schemaVersion: 1, manifestSha256: noticeHash(read(root, 'public/licenses/notices.json')),
        packages: manifest.packages.map(({ name, version, inclusion }) => ({ name, version, inclusion })),
        chunks: chunks.map((chunk) => ({ file: chunk.fileName, sha256: noticeHash(chunk.code) })).sort((a, b) => a.file.localeCompare(b.file)),
      }, null, 2) + '\n' })
    },
  }
}

export function validateNoticeDistribution(root: string, directory: string): void {
  const manifest = readNoticeManifest(root)
  validateNoticeSources(root, manifest)
  for (const file of ['notices.json', 'index.html', ...manifest.packages.flatMap((item) => item.notices.map((notice) => notice.file)), ...(manifest.fonts ?? []).map((font) => font.notice.file)]) {
    if (!read(root, 'public/licenses/' + file).equals(read(directory, 'licenses/' + file))) throw new Error('Distributed notice is missing or stale: ' + file)
  }
  for (const font of manifest.fonts ?? []) {
    const outputs = readdirSync(resolve(directory, 'assets')).filter((file) => file.endsWith('.woff2'))
    if (!outputs.some((file) => noticeHash(read(directory, 'assets/' + file)) === font.sha256)) throw new Error('Distributed local font is missing or changed: ' + font.name)
  }
  const receipt = JSON.parse(read(directory, 'licenses/bundle-notices.json').toString('utf8')) as {
    schemaVersion: number; manifestSha256: string; packages: { name: string; version: string; inclusion: Inclusion }[]; chunks: { file: string; sha256: string }[]
  }
  if (receipt.schemaVersion !== 1 || receipt.manifestSha256 !== noticeHash(read(root, 'public/licenses/notices.json'))
    || JSON.stringify(receipt.packages) !== JSON.stringify(manifest.packages.map(({ name, version, inclusion }) => ({ name, version, inclusion })))
    || !Array.isArray(receipt.chunks) || !receipt.chunks.length) throw new Error('Distributed runtime notice coverage receipt is stale.')
  for (const chunk of receipt.chunks) {
    if (!/^assets\/[a-zA-Z0-9_-]+\.js$/.test(chunk.file) || !/^[a-f0-9]{64}$/.test(chunk.sha256)
      || noticeHash(read(directory, chunk.file)) !== chunk.sha256) throw new Error('Distributed code differs from its notice coverage receipt.')
  }
}
