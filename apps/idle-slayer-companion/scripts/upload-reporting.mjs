import { reportingRelease } from './reporting-build.ts'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolveDeployment } from '../deployment.ts'
const deployment = resolveDeployment(process.env.COMPANION_DEPLOY_TARGET)
if (!deployment.telemetryEnabled) throw new Error('Migration builds do not publish telemetry or reporting releases.')
const release = reportingRelease(process.cwd())
const receipt = JSON.parse(readFileSync('.cache/reporting/build.json', 'utf8'))
if (receipt.release !== release || !receipt.files?.some((file) => file.file.endsWith('.js.map'))) throw new Error('Build the current source and reporting environment before uploading.')
for (const file of receipt.files) {
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  if (hash(resolve('.cache/reporting', release, file.file)) !== file.sha256
    || (file.file.endsWith('.js') && hash(resolve('dist/assets', file.file)) !== file.sha256)) throw new Error('Source-map staging differs from the built app. Rebuild before uploading.')
}
if (!process.env.SENTRY_AUTH_TOKEN) throw new Error('Set SENTRY_AUTH_TOKEN to a reports.garrod.house project:releases token.')
const env = { ...process.env, SENTRY_URL: 'https://reports.garrod.house', SENTRY_ORG: 'garrod-house', SENTRY_PROJECT: 'idle-slayer-companion' }
delete env.SENTRY_DSN
function cli(args) {
  const result = spawnSync(process.execPath, ['node_modules/@sentry/cli/bin/sentry-cli', ...args], { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Reporting upload failed')
}
cli(['releases', 'new', release])
cli(['releases', 'files', release, 'upload-sourcemaps', resolve('.cache/reporting', release), '--url-prefix', '~' + deployment.base + 'assets', '--dist', 'web', '--rewrite', '--validate'])
cli(['releases', 'finalize', release])
console.log('Uploaded reporting release ' + release)
