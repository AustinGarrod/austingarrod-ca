import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { recommendationDataErrors } from '../src/domain/recommendation-data-validation.ts'
import { validateNoticeDistribution } from './runtime-notices.ts'
import { validateReleaseArtifact } from './release-artifact.ts'
import { validatePwaDistribution } from './pwa.ts'

const catalogBytes = readFileSync('public/catalog.json')
const catalog = JSON.parse(catalogBytes)
const receipt = JSON.parse(readFileSync('data/catalog-receipt.json', 'utf8'))
const audit = JSON.parse(readFileSync('data/native-rule-validation.json', 'utf8'))
const failed = Object.entries(catalog.verification).filter(([key, value]) => key !== 'evidence' && value !== true)
if (failed.length || !receipt.visualReview.complete) throw new Error(`Release blocked by catalog verification: ${failed.map(([key]) => key).join(', ')}`)
if (createHash('sha256').update(catalogBytes).digest('hex') !== receipt.catalogSha256) throw new Error('Catalog does not match reviewed receipt.')
if (audit.catalogSha256 !== receipt.catalogSha256 || Object.values(audit.checks).includes(false)) throw new Error('Native rule audit is incomplete or stale.')
const priorities = JSON.parse(readFileSync('src/data/wiki-priorities.json', 'utf8'))
const priorityErrors = recommendationDataErrors(priorities, catalog, receipt.catalogSha256)
if (priorityErrors.length) throw new Error(`Release blocked by recommendation data: ${priorityErrors.join('; ')}`)
const saveReceiptBytes = readFileSync('data/save-import-receipt.json')
const saveReceipt = JSON.parse(saveReceiptBytes)
if (createHash('sha256').update(saveReceiptBytes).digest('hex') !== '785adda970818f8ac74c295fe9eabd46764351536aaae325dbc1b0a2c7d5fcb2'
  || saveReceipt.catalogSha256 !== receipt.catalogSha256 || saveReceipt.reviewedGameVersion !== catalog.gameVersion
  || saveReceipt.steamBuild !== catalog.steamBuild
  || JSON.stringify(saveReceipt.milestoneMappings.map((item) => item.id).sort()) !== JSON.stringify(catalog.milestones.map((item) => item.id).sort())) throw new Error('Steam import evidence does not match the reviewed catalog and receipt. Re-review native save semantics before supporting a changed game version.')
// Version adapters are reviewed native contracts, not merely matching catalog labels.
for (const [file, expected] of [
  ['data/companion-native-rules.json', 'b3a43365e4ded79fd47fce56e9a257efc887045592e801f404b397c516816467'],
  ['data/companion-native-method-receipt.json', '5effd56bfa7c429b261e72d2e05c3d5f30a7b98df1763a3e467c155597dda732'],
  ['src/data/companion-reset-rules.json', '777bc43e62b7ce4587824cc1cefd8579364508f5805ec8c19b63d5c169dc9fe1'],
]) {
  const bytes = readFileSync(file), contract = JSON.parse(bytes)
  if (createHash('sha256').update(bytes).digest('hex') !== expected || contract.gameVersion !== catalog.gameVersion || contract.steamBuild !== catalog.steamBuild) throw new Error('Companion native contract requires renewed review: ' + file)
}
validateReleaseArtifact(process.cwd(), 'dist')
validateNoticeDistribution(process.cwd(), 'dist')
validatePwaDistribution(process.cwd(), 'dist')
console.log(`Release gate passed: built section entries, ${receipt.nativeNodeCount} reviewed upgrades, ${receipt.nativeEdgeCount} native connections, ${receipt.spriteCount} map icons, reviewed companion catalog/icons/import/reset contracts, ${priorities.rows.length} wiki priorities and complete runtime notices; static dist contains no private game inputs.`)
