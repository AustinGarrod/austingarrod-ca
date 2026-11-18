import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { resolveDeployment, type CompanionDeployment } from '../deployment.ts'

export const PWA_BASE = resolveDeployment().base
export const PWA_IDENTITY = resolveDeployment().identity
export const COMPANION_SECTION_PATHS = ['overview', 'ascension', 'achievements', 'crafting', 'quests', 'bestiary', 'divinities'] as const
export function writeSectionEntries(directory: string): void {
  const entry = readFileSync(resolve(directory, 'index.html'))
  for (const section of COMPANION_SECTION_PATHS) {
    mkdirSync(resolve(directory, section), { recursive: true })
    writeFileSync(resolve(directory, section, 'index.html'), entry)
  }
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export interface OfflineRelease { version: string; cachePrefix: string; assets: { file: string; sha256: string }[] }
export function offlineRelease(root: string, directory: string, deployment = resolveDeployment(process.env.COMPANION_DEPLOY_TARGET)): OfflineRelease {
  const catalog = JSON.parse(readFileSync(resolve(root, 'public/catalog.json'), 'utf8')) as { upgrades: { icon: string }[] }
  const companion = JSON.parse(readFileSync(resolve(root, 'public/companion-catalog.json'), 'utf8')) as { entities: { icon?: string }[] }
  const notices = JSON.parse(readFileSync(resolve(root, 'public/licenses/notices.json'), 'utf8')) as { packages: { notices: { file: string }[] }[]; fonts?: { notice: { file: string } }[] }
  const reviewed = new Set(['index.html', 'catalog.json', 'companion-catalog.json', 'manifest.webmanifest',
    ...COMPANION_SECTION_PATHS.map((section) => section + '/index.html'),
    ...['icon-192', 'icon-512', 'maskable-512', 'apple-touch-icon'].map((name) => 'pwa/' + name + '.png'),
    ...catalog.upgrades.map((upgrade) => upgrade.icon), ...companion.entities.flatMap((entity) => entity.icon ? [entity.icon] : []), 'licenses/index.html', 'licenses/notices.json', 'licenses/bundle-notices.json',
    ...notices.packages.flatMap((item) => item.notices.map((notice) => 'licenses/' + notice.file)),
    ...(notices.fonts ?? []).map((font) => 'licenses/' + font.notice.file)])
  const publicFile = (file: string) => reviewed.has(file) || /^assets\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2?)$/.test(file)
  const files: string[] = []
  const walk = (parent: string) => {
    for (const entry of readdirSync(resolve(directory, parent), { withFileTypes: true })) {
      const file = parent + entry.name
      if (entry.isSymbolicLink()) throw new Error('Offline assets cannot be links.')
      if (entry.isDirectory()) walk(file + '/')
      else if (!['sw.js', 'offline-assets.json', '.htaccess'].includes(file)) {
        if (!entry.isFile() || !publicFile(file)) throw new Error('Unreviewed offline asset: ' + file)
        files.push(file)
      }
    }
  }
  walk('')
  const assets = files.sort().map((file) => ({ file, sha256: hash(readFileSync(resolve(directory, file))) }))
  const version = hash(deployment.cachePrefix + JSON.stringify(assets) + readFileSync(resolve(root, 'scripts/pwa-worker.js'), 'utf8'))
  return { version, cachePrefix: deployment.cachePrefix, assets }
}
export function renderWorker(root: string, release: OfflineRelease): string {
  return 'const RELEASE = ' + JSON.stringify(release) + ';\n' + readFileSync(resolve(root, 'scripts/pwa-worker.js'), 'utf8')
}
export function pwaPlugin(root: string, deployment: CompanionDeployment = resolveDeployment(process.env.COMPANION_DEPLOY_TARGET)): Plugin {
  let directory = ''
  return { name: 'public-offline-release', apply: 'build', enforce: 'post',
    configResolved(config) {
      if (config.base !== deployment.base) throw new Error('Application base must match a reviewed deployment profile.')
      directory = resolve(root, config.build.outDir)
    },
    closeBundle() {
      writeSectionEntries(directory)
      const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'))
      Object.assign(manifest, { id: deployment.identity, start_url: deployment.base, scope: deployment.base, theme_color: '#f8f9ff', background_color: '#f8f9ff' })
      writeFileSync(resolve(directory, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n')
      const release = offlineRelease(root, directory, deployment)
      writeFileSync(resolve(directory, 'offline-assets.json'), JSON.stringify(release, null, 2) + '\n')
      writeFileSync(resolve(directory, 'sw.js'), renderWorker(root, release))
    },
  }
}
export function validatePwaDistribution(root: string, directory: string, deployment = resolveDeployment(process.env.COMPANION_DEPLOY_TARGET)): void {
  const expected = offlineRelease(root, directory, deployment)
  const actual = JSON.parse(readFileSync(resolve(directory, 'offline-assets.json'), 'utf8')) as OfflineRelease
  if (JSON.stringify(actual) !== JSON.stringify(expected) || readFileSync(resolve(directory, 'sw.js'), 'utf8') !== renderWorker(root, expected)) throw new Error('Offline release inventory or worker is stale.')
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.webmanifest'), 'utf8'))
  if (manifest.id !== deployment.identity || manifest.start_url !== deployment.base || manifest.scope !== deployment.base || manifest.display !== 'standalone'
    || manifest.theme_color !== '#f8f9ff' || manifest.background_color !== '#f8f9ff') throw new Error('Invalid installation identity, scope or colors.')
  const expectedIcons = ['pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/maskable-512.png']
  if (manifest.icons?.length !== 3 || manifest.icons.some((icon: { src: string; sizes: string; purpose: string; type: string }, index: number) => icon.src !== expectedIcons[index]
    || icon.sizes !== (index === 0 ? '192x192' : '512x512') || icon.purpose !== (index === 2 ? 'maskable' : 'any') || icon.type !== 'image/png')) throw new Error('Invalid reviewed install icons.')
  for (const [file, size] of [...expectedIcons.map((file, i) => [file, i === 0 ? 192 : 512] as const), ['pwa/apple-touch-icon.png', 180] as const]) {
    const bytes = readFileSync(resolve(directory, file))
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size
      || !bytes.equals(readFileSync(resolve(root, 'public', file)))) throw new Error('Invalid or stale reviewed app icon: ' + file)
  }
  const html = readFileSync(resolve(directory, 'index.html'), 'utf8')
  if (!html.includes('rel="manifest" href="' + deployment.base + 'manifest.webmanifest"') || !html.includes('rel="apple-touch-icon" href="' + deployment.base + 'pwa/apple-touch-icon.png"')) throw new Error('Missing install metadata in built HTML.')
  for (const section of COMPANION_SECTION_PATHS) if (readFileSync(resolve(directory, section, 'index.html'), 'utf8') !== html) throw new Error('Static section entry is missing or differs from the application entry.')
}
