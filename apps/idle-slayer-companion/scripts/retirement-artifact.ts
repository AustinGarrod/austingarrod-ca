import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CompanionDeployment } from '../deployment.ts'

const sections = ['overview', 'ascension', 'achievements', 'crafting', 'quests', 'bestiary', 'divinities']
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const localPath = (file: string) => /^[a-zA-Z0-9_./-]+$/.test(file) && !file.startsWith('/') && !file.split('/').some((part) => !part || part === '.' || part === '..')

/** The retired build must have no dependency on the application or writable sessions. */
export function validateRetirementModules(modules: readonly string[]): void {
  if (!modules.length || new Set(modules).size !== modules.length || !modules.includes('migration/retirement.tsx')) throw new Error('Retirement module receipt must include its dedicated entry exactly once.')
  for (const file of modules) {
    const allowed = localPath(file) && (
      /^migration\/(?:retirement|RetirementPage|retirement-exports)\.tsx?$/.test(file)
      || file === 'migration/retirement.css'
      || file === 'src/migration-link.ts'
      || (file.startsWith('src/domain/') && file.endsWith('.ts') && !/(?:^|\/)[^/]*session\.ts$/.test(file) && !file.endsWith('.test.ts'))
      || file === 'src/data/transfer-dictionaries.json'
      || file === 'public/catalog.json'
      || /^src\/assets\/fonts\/[a-z0-9.-]+\.woff2$/.test(file)
      || file === 'index.html'
    )
    if (!allowed) throw new Error('Unreviewed retirement runtime module: ' + file)
  }
}

function attributes(tag: string): Map<string, string> {
  return new Map([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]))
}

export function validateRetirementArtifact(root: string, directory: string, deployment: CompanionDeployment): void {
  if (deployment.target !== 'legacy-migration' || !['/idle-slayer-companion/', '/idle-slayer-ascension-map/'].includes(deployment.base) || deployment.telemetryEnabled) throw new Error('Retirement artifact requires a reviewed telemetry-free historical deployment.')
  const dist = resolve(directory), files: string[] = []
  function inspect(parent = '') {
    const absolute = resolve(dist, parent), stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error('Linked file or directory in retirement artifact: ' + parent)
    if (!stat.isDirectory()) throw new Error('Retirement artifact must be a regular directory.')
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const file = parent + entry.name, path = resolve(dist, file)
      if (entry.isSymbolicLink()) throw new Error('Linked file or directory in retirement artifact: ' + file)
      if (entry.isDirectory()) inspect(file + '/')
      else {
        if (!entry.isFile() || !lstatSync(path).size) throw new Error('Retirement files must be regular and nonempty: ' + file)
        files.push(file)
      }
    }
  }
  inspect()
  const read = (file: string): Buffer => {
    if (!localPath(file)) throw new Error('Unsafe retirement asset path: ' + file)
    const path = resolve(dist, file), within = relative(dist, path)
    if (!within || isAbsolute(within) || within === '..' || within.startsWith('..' + sep) || !files.includes(file)) throw new Error('Required retirement asset is outside the artifact or missing: ' + file)
    return readFileSync(path)
  }
  const noticeManifest = JSON.parse(readFileSync(resolve(root, 'public/licenses/notices.json'), 'utf8')) as { packages: { notices: { file: string }[] }[]; fonts?: { notice: { file: string } }[] }
  const reviewed = new Set(['index.html', ...sections.map((section) => section + '/index.html'), 'catalog.json', 'retirement-entry.json', 'manifest.webmanifest', 'sw.js', 'offline-assets.json',
    ...['icon-192', 'icon-512', 'maskable-512', 'apple-touch-icon'].map((name) => 'pwa/' + name + '.png'), 'licenses/index.html', 'licenses/notices.json', 'licenses/bundle-notices.json',
    ...noticeManifest.packages.flatMap((item) => item.notices.map((notice) => 'licenses/' + notice.file)), ...(noticeManifest.fonts ?? []).map((font) => 'licenses/' + font.notice.file)])
  for (const file of files) if (!reviewed.has(file) && !/^assets\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?)$/.test(file)) throw new Error('Unreviewed retirement artifact file: ' + file)

  const receipt = JSON.parse(read('retirement-entry.json').toString('utf8')) as { version: number; entry: string; modules: string[]; chunks: { file: string; sha256: string }[] }
  if (receipt.version !== 1 || receipt.entry !== 'migration/retirement.tsx' || !Array.isArray(receipt.modules) || receipt.modules.some((file) => typeof file !== 'string') || !Array.isArray(receipt.chunks) || !receipt.chunks.length) throw new Error('Invalid retirement entry receipt.')
  validateRetirementModules(receipt.modules)
  const chunks = new Set<string>()
  for (const chunk of receipt.chunks) {
    if (!chunk || !/^assets\/[a-zA-Z0-9_.-]+\.js$/.test(chunk.file) || !/^[a-f0-9]{64}$/.test(chunk.sha256) || chunks.has(chunk.file) || hash(read(chunk.file)) !== chunk.sha256) throw new Error('Retirement chunk differs from its entry receipt.')
    chunks.add(chunk.file)
  }
  if (files.filter((file) => file.endsWith('.js') && file !== 'sw.js').some((file) => !chunks.has(file))) throw new Error('Unreceipted JavaScript in retirement artifact.')
  const coverage = JSON.parse(read('licenses/bundle-notices.json').toString('utf8')) as { packages: { name: string }[]; chunks: { file: string; sha256: string }[] }
  const allowedPackages = new Set(['react', 'react-dom', 'scheduler', 'vite', 'rolldown'])
  if (!Array.isArray(coverage.packages) || !coverage.packages.length || new Set(coverage.packages.map((item) => item?.name)).size !== coverage.packages.length
    || coverage.packages.some((item) => !item || !allowedPackages.has(item.name))) throw new Error('Retirement runtime receipt contains an unreviewed package.')
  if (!Array.isArray(coverage.chunks) || coverage.chunks.length !== chunks.size || new Set(coverage.chunks.map((chunk) => chunk.file)).size !== chunks.size || coverage.chunks.some((chunk) => !chunks.has(chunk.file) || hash(read(chunk.file)) !== chunk.sha256)) throw new Error('Retirement runtime notices do not cover exactly the dedicated entry chunks.')

  const base = deployment.base, origin = 'https://retirement.invalid'
  const referencePath = (reference: string, from = 'index.html'): string => {
    if (!/^[a-zA-Z0-9_./-]+$/.test(reference) || reference.startsWith('//') || reference.split('/').includes('..')) throw new Error('Unsafe retirement asset reference: ' + reference)
    const url = new URL(reference, origin + base + from)
    if (url.origin !== origin || !url.pathname.startsWith(base)) throw new Error('Retirement asset reference is outside its historical base: ' + reference)
    const file = url.pathname.slice(base.length)
    read(file)
    return file
  }
  const html = read('index.html').toString('utf8').replace(/<!--[\s\S]*?-->/g, '')
  const tags = [...html.matchAll(/<(div|script|link|meta)\b([^>]*)>/gi)].map((match) => ({ name: match[1].toLowerCase(), attrs: attributes(match[2]) }))
  if (tags.filter(({ name, attrs }) => name === 'div' && attrs.get('id') === 'root').length !== 1) throw new Error('Retirement HTML must have one root mount.')
  if (!tags.some(({ name, attrs }) => name === 'meta' && attrs.get('name') === 'robots' && attrs.get('content')?.split(/[,\s]+/).includes('noindex')) || !tags.some(({ name, attrs }) => name === 'link' && attrs.get('rel') === 'canonical' && attrs.get('href') === deployment.canonical)) throw new Error('Retirement HTML must advertise its canonical destination and noindex.')
  const modules = tags.filter(({ name, attrs }) => name === 'script' && attrs.get('type') === 'module')
  const styles = tags.filter(({ name, attrs }) => name === 'link' && attrs.get('rel') === 'stylesheet')
  if (!modules.length || !styles.length) throw new Error('Retirement HTML must reference built module and stylesheet entries.')
  for (const { name, attrs } of tags) {
    if (name === 'script') {
      if (attrs.has('src')) {
        if (attrs.get('type') !== 'module' || !chunks.has(referencePath(attrs.get('src')!))) throw new Error('Retirement HTML references an unreviewed runtime entry.')
      } else if (attrs.get('type') !== 'application/ld+json') throw new Error('Inline executable script in retirement HTML.')
    }
    if (name === 'link' && attrs.get('rel') === 'modulepreload' && !chunks.has(referencePath(attrs.get('href') ?? ''))) throw new Error('Retirement preload is absent from its entry receipt.')
    if (name === 'link' && ['icon', 'apple-touch-icon', 'manifest', 'preload'].includes(attrs.get('rel') ?? '')) referencePath(attrs.get('href') ?? '')
  }
  const checkedCSS = new Set<string>()
  function checkCSS(file: string) {
    if (!file.endsWith('.css')) throw new Error('Retirement stylesheet must reference built CSS.')
    if (checkedCSS.has(file)) return
    checkedCSS.add(file)
    const css = read(file).toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
      const reference = (match[1] ?? match[2] ?? match[3]).trim()
      if (reference.startsWith('data:') || reference.startsWith('#')) continue
      const asset = referencePath(reference, file)
      if (asset.endsWith('.css')) checkCSS(asset)
    }
    for (const match of css.matchAll(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)|"([^"]*)"|'([^']*)')/gi)) checkCSS(referencePath((match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]).trim(), file))
  }
  for (const { attrs } of styles) checkCSS(referencePath(attrs.get('href') ?? ''))
  for (const section of sections) if (read(section + '/index.html').toString('utf8') !== read('index.html').toString('utf8')) throw new Error('Retirement section entry differs from the transfer page.')
  const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'))
  if (manifest.id !== deployment.identity || manifest.start_url !== base || manifest.scope !== base) throw new Error('Retirement installation identity or scope changed.')
  const catalogBytes = read('catalog.json'), catalogReceipt = JSON.parse(readFileSync(resolve(root, 'data/catalog-receipt.json'), 'utf8')) as { catalogSha256: string }
  if (!catalogBytes.equals(readFileSync(resolve(root, 'public/catalog.json'))) || hash(catalogBytes) !== catalogReceipt.catalogSha256) throw new Error('Retirement catalog differs from its reviewed source and receipt.')
}
