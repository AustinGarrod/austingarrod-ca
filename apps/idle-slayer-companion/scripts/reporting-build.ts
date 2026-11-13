import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, mkdirSync, copyFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import type { Plugin } from 'vite'
import { execFileSync } from 'node:child_process'
import { resolveDeployment } from '../deployment.ts'

export function reportingCommit(root: string) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return 'unavailable' }
}

export function reportingRelease(root: string) {
  const hash = createHash('sha256')
  hash.update(reportingCommit(root))
  function walk(directory: string) {
    for (const item of readdirSync(resolve(root, directory), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = directory + '/' + item.name
      if (item.isSymbolicLink()) throw new Error('Reporting source cannot be a symbolic link: ' + file)
      if (item.isDirectory() && !item.name.startsWith('.') && !['__pycache__', 'node_modules'].includes(item.name)) walk(file)
      else if (item.isFile() && /\.(?:tsx?|jsx?|mjs|cjs|json|css|svg|py|ps1)$/.test(item.name)) { hash.update(file); hash.update(readFileSync(resolve(root, file))) }
    }
  }
  walk('src'); walk('scripts')
  for (const file of ['public/catalog.json', 'public/companion-catalog.json']) hash.update(readFileSync(resolve(root, file)))
  hash.update(process.env.VITE_REPORTING_ENVIRONMENT || 'production')
  hash.update(process.env.VITE_REPORTING_ENABLED || 'false')
  hash.update(resolveDeployment(process.env.COMPANION_DEPLOY_TARGET).target)
  for (const file of ['package.json', 'yarn.lock', 'vite.config.ts', 'deployment.ts']) hash.update(readFileSync(resolve(root, file)))
  return 'idle-slayer-companion@' + hash.digest('hex').slice(0, 24)
}
/** Stage maps before PWA inventory hashing; never alter distributed JS afterwards. */
export function reportingBuildPlugin(root: string, release: string): Plugin {
  let out = ''
  return { name: 'reporting-source-maps', apply: 'build', enforce: 'post',
    configResolved(config) { out = resolve(root, config.build.outDir) },
    closeBundle: { sequential: true, order: 'pre', handler() {
      const stage = resolve(root, '.cache/reporting', release)
      mkdirSync(stage, { recursive: true })
      const files: { file: string; sha256: string }[] = []
      for (const file of readdirSync(resolve(out, 'assets'))) {
        if (!/\.js(?:\.map)?$/.test(file)) continue
        copyFileSync(resolve(out, 'assets', file), resolve(stage, file))
        files.push({ file, sha256: createHash('sha256').update(readFileSync(resolve(stage, file))).digest('hex') })
        if (file.endsWith('.map')) unlinkSync(resolve(out, 'assets', file))
      }
      writeFileSync(resolve(root, '.cache/reporting/build.json'), JSON.stringify({ release, commit: reportingCommit(root), files }, null, 2) + '\n')
      console.log('Reporting source maps: ' + relative(root, stage))
    } },
  }
}
