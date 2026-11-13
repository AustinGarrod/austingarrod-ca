import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportingRelease } from '../scripts/reporting-build'

const fixtures: string[] = []
afterEach(() => { for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true }); vi.unstubAllEnvs() })
it('binds releases to source/environment/commit while ignoring Python tooling caches', () => {
  vi.stubEnv('GITHUB_SHA', 'a'.repeat(40)); vi.stubEnv('VITE_REPORTING_ENVIRONMENT', 'production'); vi.stubEnv('VITE_REPORTING_ENABLED', '')
  const root = mkdtempSync(join(tmpdir(), 'companion-reporting-')); fixtures.push(root)
  for (const dir of ['src', 'scripts/__pycache__', 'public']) mkdirSync(join(root, dir), { recursive: true })
  for (const file of ['public/catalog.json', 'public/companion-catalog.json', 'package.json', 'yarn.lock', 'vite.config.ts', 'deployment.ts']) writeFileSync(join(root, file), '{}')
  writeFileSync(join(root, 'src/App.tsx'), 'source')
  const release = reportingRelease(root)
  writeFileSync(join(root, 'scripts/__pycache__/extract.pyc'), 'generated platform-specific bytecode')
  expect(reportingRelease(root)).toBe(release)
  vi.stubEnv('COMPANION_DEPLOY_TARGET', 'legacy-migration')
  expect(reportingRelease(root)).not.toBe(release)
  vi.stubEnv('COMPANION_DEPLOY_TARGET', 'website')
  expect(reportingRelease(root)).toBe(release)
  writeFileSync(join(root, 'src/App.tsx'), 'changed source')
  expect(reportingRelease(root)).not.toBe(release)
  writeFileSync(join(root, 'src/App.tsx'), 'source')
  vi.stubEnv('VITE_REPORTING_ENVIRONMENT', 'verification')
  expect(reportingRelease(root)).not.toBe(release)
  vi.stubEnv('VITE_REPORTING_ENVIRONMENT', 'production'); vi.stubEnv('GITHUB_SHA', 'b'.repeat(40))
  expect(reportingRelease(root)).not.toBe(release)
})
