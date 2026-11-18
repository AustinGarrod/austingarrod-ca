import { cpSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'
import { validateRetirementModules } from './retirement-artifact.ts'

/** This entry has no dependency on the usable application or its startup code. */
export function retirementBuildPlugin(root: string): Plugin {
  let directory = ''
  return {
    name: 'companion-retirement-only',
    configResolved(config) { directory = resolve(root, config.build.outDir) },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace('/src/main.tsx', '/migration/retirement.tsx')
          .replace('<title>Idle Slayer Companion | Austin Garrod</title>', '<title>Idle Slayer Companion has moved</title>')
          .replace('Track achievements, plan crafting, follow quests, and explore the Ascension tree with your unofficial Idle Slayer Companion.', 'Move your saved Idle Slayer Companion data to AustinGarrod.ca. This former application is retired.')
          .replace('<div id="root"></div>', '<div id="root"></div><noscript><h1>Idle Slayer Companion has moved</h1><p>Enable JavaScript to export saved browser data, or open the new app.</p><a href="https://austingarrod.ca/utilities/idle-slayer-companion/?migration=1#analytics=off" rel="noreferrer">Open new app</a></noscript>')
      },
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk')
      const modules = [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules))
        .filter((id) => !id.includes('node_modules') && !id.startsWith('\0'))
        .map((id) => relative(root, id).replaceAll('\\', '/')))].sort()
      validateRetirementModules(modules)
      this.emitFile({ type: 'asset', fileName: 'retirement-entry.json', source: JSON.stringify({
        version: 1, entry: 'migration/retirement.tsx', modules,
        chunks: chunks.map((chunk) => ({ file: chunk.fileName, sha256: createHash('sha256').update(chunk.code).digest('hex') })).sort((a, b) => a.file.localeCompare(b.file)),
      }, null, 2) + '\n' })
    },
    writeBundle() {
      // Game images, the full companion catalog and application chunks do not
      // belong in the transfer-only offline release.
      for (const file of ['catalog.json', 'pwa', 'licenses']) cpSync(resolve(root, 'public', file), resolve(directory, file), { recursive: true })
    },
  }
}
