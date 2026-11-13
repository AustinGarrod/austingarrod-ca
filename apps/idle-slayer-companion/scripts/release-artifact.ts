import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { resolveDeployment } from '../deployment.ts'

const origin = 'https://release.invalid'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
interface ReviewedCatalog { upgrades: { id: string; icon: string }[]; connections: unknown[] }
interface CatalogReceipt {
  catalogSha256: string; nativeNodeCount: number; nativeEdgeCount: number; spriteCount: number
  nodes: { id: string; icon: { sha256: string } }[]
}
interface ReviewedCompanionCatalog { entities: { system: string; id: string; icon?: string }[]; verification: { coverage: boolean; rules: boolean; assets: boolean } }
interface CompanionReceipt {
  catalogSha256: string
  catalogEntities: { system: string; id: string }[]
  icons: { system: string; id: string; sha256: string }[]
}

// Reject links before reading any deployed files, including the notice validator's inputs.
function inspect(directory: string): void {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Deployment must be a regular directory.')
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Linked file or directory in deployment: ' + path)
    if (entry.isDirectory()) {
      if (/^(?:\.local-game|Idle Slayer_Data|\.git|logic|extract)$/i.test(entry.name)) throw new Error('Private source in deployment: ' + path)
      inspect(path)
    } else {
      if (!entry.isFile() || lstatSync(path).size === 0) throw new Error('Deployment file must be regular and nonempty: ' + path)
      if (/\.(?:dll|exe|acf|assets|resS|resource|dat|sav|py|ps1|crt|pem)$/i.test(entry.name) || /(?:^\.env|appmanifest)/i.test(entry.name)) throw new Error('Private input in deployment: ' + path)
    }
  }
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4])
  return result
}

export function validateReleaseArtifact(root: string, directory: string, deployment = resolveDeployment(process.env.COMPANION_DEPLOY_TARGET)): void {
  const base = deployment.base
  const dist = resolve(directory)
  inspect(dist)
  const read = (file: string): Buffer => {
    const path = resolve(dist, file)
    const within = relative(dist, path)
    if (!within || isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) throw new Error('Asset outside deployment: ' + file)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Required deployment asset must be regular and nonempty: ' + file)
    return readFileSync(path)
  }
  const referencePath = (reference: string, from: string): string => {
    // Build output has plain local paths. Reject encodings/Windows paths and traversal
    // before URL normalization could hide them or a server could interpret them differently.
    if (!/^[a-zA-Z0-9_./-]+$/.test(reference) || reference.startsWith('//') || reference.split('/').includes('..')) throw new Error('Unsafe deployment asset reference: ' + reference)
    const url = new URL(reference, origin + base + from)
    if (url.origin !== origin || !url.pathname.startsWith(base)) throw new Error('Asset reference is outside the Pages base: ' + reference)
    const file = url.pathname.slice(base.length)
    read(file)
    return file
  }

  const html = read('index.html').toString('utf8').replace(/<!--[\s\S]*?-->/g, '')
  const tags = [...html.matchAll(/<(div|script|link)\b([^>]*)>/gi)].map((match) => ({ name: match[1].toLowerCase(), attrs: attributes(match[2]) }))
  if (tags.filter(({ name, attrs }) => name === 'div' && attrs.get('id') === 'root').length !== 1) throw new Error('Application HTML must contain one root mount.')
  const modules = tags.filter(({ name, attrs }) => name === 'script' && attrs.get('type') === 'module')
  const styles = tags.filter(({ name, attrs }) => name === 'link' && attrs.get('rel') === 'stylesheet')
  if (!modules.length || !styles.length) throw new Error('Application HTML must reference built module and stylesheet entries.')
  const coverage = JSON.parse(read('licenses/bundle-notices.json').toString('utf8')) as { chunks: { file: string }[] }
  const chunks = new Set(coverage.chunks.map((chunk) => chunk.file))
  const checkScript = (reference: string): void => {
    const entry = referencePath(reference, 'index.html')
    if (!entry.endsWith('.js') || !chunks.has(entry)) throw new Error('Application module entry is absent from the built runtime receipt.')
  }
  for (const { attrs } of modules) checkScript(attrs.get('src') ?? '')
  for (const { name, attrs } of tags) {
    if (name === 'script' && attrs.has('src') && attrs.get('type') !== 'module') checkScript(attrs.get('src')!)
    if (name === 'link' && attrs.get('rel') === 'modulepreload') checkScript(attrs.get('href') ?? '')
    if (name === 'link' && ['preload', 'icon'].includes(attrs.get('rel') ?? '')) referencePath(attrs.get('href') ?? '', 'index.html')
  }
  const checkedCSS = new Set<string>()
  const checkCSS = (file: string): void => {
    if (!file.endsWith('.css')) throw new Error('Stylesheet reference must point to built CSS: ' + file)
    if (checkedCSS.has(file)) return
    checkedCSS.add(file)
    const css = read(file).toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
      const reference = (match[1] ?? match[2] ?? match[3]).trim()
      if (/^data:/i.test(reference) || reference.startsWith('#')) continue
      const asset = referencePath(reference, file)
      if (asset.endsWith('.css')) checkCSS(asset)
    }
    for (const match of css.matchAll(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)|"([^"]*)"|'([^']*)')/gi)) {
      const reference = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]).trim()
      checkCSS(referencePath(reference, file))
    }
  }
  for (const { attrs } of styles) checkCSS(referencePath(attrs.get('href') ?? '', 'index.html'))

  const catalogBytes = read('catalog.json')
  const sourceBytes = readFileSync(resolve(root, 'public/catalog.json'))
  const receipt = JSON.parse(readFileSync(resolve(root, 'data/catalog-receipt.json'), 'utf8')) as CatalogReceipt
  if (!catalogBytes.equals(sourceBytes) || hash(catalogBytes) !== receipt.catalogSha256) throw new Error('Distributed catalog differs from the reviewed source and receipt.')
  const catalog = JSON.parse(catalogBytes.toString('utf8')) as ReviewedCatalog
  const nodes = new Map(receipt.nodes.map((node) => [node.id, node]))
  if (catalog.upgrades.length !== receipt.nativeNodeCount || catalog.connections.length !== receipt.nativeEdgeCount
    || catalog.upgrades.length !== receipt.spriteCount || nodes.size !== receipt.nativeNodeCount) throw new Error('Distributed catalog coverage differs from the reviewed receipt.')
  const icons = new Set<string>()
  for (const upgrade of catalog.upgrades) {
    const node = nodes.get(upgrade.id)
    if (!node || !/^assets\/upgrades\/[a-z0-9]+\.png$/.test(upgrade.icon) || icons.has(upgrade.icon)
      || hash(read(upgrade.icon)) !== node.icon.sha256) throw new Error('Distributed icon differs from its reviewed receipt: ' + upgrade.id)
    icons.add(upgrade.icon)
  }
  const distributedIcons = readdirSync(resolve(dist, 'assets/upgrades')).map((file) => 'assets/upgrades/' + file)
  if (distributedIcons.length !== icons.size || distributedIcons.some((file) => !icons.has(file))) throw new Error('Distributed sprite inventory differs from the reviewed catalog.')

  const companionBytes = read('companion-catalog.json')
  const companionReceipt = JSON.parse(readFileSync(resolve(root, 'data/companion-catalog-receipt.json'), 'utf8')) as CompanionReceipt
  if (!companionBytes.equals(readFileSync(resolve(root, 'public/companion-catalog.json'))) || hash(companionBytes) !== companionReceipt.catalogSha256) throw new Error('Distributed companion catalog differs from the reviewed source and receipt.')
  const companion = JSON.parse(companionBytes.toString('utf8')) as ReviewedCompanionCatalog
  if (!companion.verification.coverage || !companion.verification.rules || !companion.verification.assets) throw new Error('Companion catalog coverage, rules and assets must be reviewed before release.')
  const entityKey = (entity: { system: string; id: string }) => `${entity.system}:${entity.id}`
  const expectedIdentities = companionReceipt.catalogEntities?.map(entityKey).sort()
  const identities = companion.entities.map(entityKey).sort()
  if (!expectedIdentities || new Set(identities).size !== identities.length || JSON.stringify(identities) !== JSON.stringify(expectedIdentities)) throw new Error('Distributed companion catalog coverage differs from the reviewed receipt.')
  const companionIconReceipt = new Map(companionReceipt.icons.map((icon) => [entityKey(icon), icon]))
  const companionIcons = new Set<string>()
  for (const entity of companion.entities) {
    if (!entity.icon) continue
    const icon = companionIconReceipt.get(entityKey(entity))
    if (!icon || !/^assets\/companion\/[a-z0-9_-]+\.png$/i.test(entity.icon) || companionIcons.has(entity.icon) || hash(read(entity.icon)) !== icon.sha256) throw new Error('Distributed companion icon differs from its reviewed receipt: ' + entityKey(entity))
    companionIcons.add(entity.icon)
  }
  const distributedCompanionIcons = readdirSync(resolve(dist, 'assets/companion')).map((file) => 'assets/companion/' + file)
  if (companionIconReceipt.size !== companionIcons.size || distributedCompanionIcons.length !== companionIcons.size || distributedCompanionIcons.some((file) => !companionIcons.has(file))) throw new Error('Distributed companion sprite inventory differs from the reviewed catalog.')
}
