import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import snapshot from '../data/wiki-priorities.json'
import { recommendationDataErrors } from './recommendation-data-validation'
import type { Catalog } from './types'

const catalogBytes = readFileSync('public/catalog.json')
const catalog = JSON.parse(catalogBytes.toString('utf8')) as Catalog
const catalogSha256 = createHash('sha256').update(catalogBytes).digest('hex')
function changed(change: (copy: typeof snapshot) => void): string[] {
  const copy = structuredClone(snapshot)
  change(copy)
  return recommendationDataErrors(copy, catalog, catalogSha256)
}

describe('reviewed wiki recommendation data', () => {
  it('binds all shipped ranks, source rows, costs and duplicate-title witnesses to the reviewed native catalog', () => {
    expect(recommendationDataErrors(snapshot, catalog, catalogSha256)).toEqual([])
  })

  it('blocks a stale catalog hash, revision or game version', () => {
    const errors = changed((copy) => {
      copy.catalog.sha256 = '0'.repeat(64)
      copy.catalog.revision = 'previous-catalog'
      copy.catalog.gameVersion = '7.0.0'
    })
    expect(errors).toEqual(expect.arrayContaining([
      'Recommendation catalog mismatch: sha256', 'Recommendation catalog mismatch: revision', 'Recommendation catalog mismatch: gameVersion',
    ]))
  })

  it('blocks unknown and repeated ranked native identities', () => {
    const errors = changed((copy) => { copy.rows[1].id = copy.rows[0].id; copy.rows[2].id = 'invented-native-id' })
    expect(errors).toContain(`Duplicate ranked native ID: ${snapshot.rows[0].id}`)
    expect(errors).toContain('Unknown ranked native ID: invented-native-id')
    expect(errors).toContain('Rank pool does not match main-guide occurrences')
  })

  it('blocks a missing ranked row even when reported coverage still claims completeness', () => {
    const errors = changed((copy) => { copy.rows.splice(0, 1) })
    expect(errors).toContain('Expected 280 unique main-guide priorities')
    expect(errors).toContain('Explicit eight-ID unranked coverage mismatch')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('blocks a non-positive or non-integer rank: %s', (priority) => {
    expect(changed((copy) => { copy.rows[0].priority = priority })).toContain(`Invalid positive integer priority: ${snapshot.rows[0].id}`)
  })

  it('blocks duplicate priorities and unsorted order', () => {
    expect(changed((copy) => { copy.rows[1].priority = copy.rows[0].priority })).toContain('Duplicate priority: 1')
    expect(changed((copy) => { [copy.rows[0], copy.rows[1]] = [copy.rows[1], copy.rows[0]] })).toContain(`Unsorted priority: ${snapshot.rows[0].id}`)
  })

  it('blocks unreviewed guide revisions and forged license provenance', () => {
    const errors = changed((copy) => {
      copy.source.revision++
      copy.source.revisionTimestamp = '2026-10-05T00:00:00Z'
      copy.source.wikitextSha256 = 'f'.repeat(64)
      copy.source.license = 'MIT'
      copy.source.licenseUrl = 'https://example.com/license'
      copy.source.licenseEvidence.revision = 'unreviewed'
    })
    expect(errors).toEqual(expect.arrayContaining([
      'Reviewed wiki source mismatch: revision', 'Reviewed wiki source mismatch: revisionTimestamp',
      'Reviewed wiki source mismatch: wikitextSha256', 'Wiki license mismatch: license',
      'Wiki license mismatch: licenseUrl', 'Reviewed license evidence mismatch: revision',
    ]))
  })

  it('blocks numeric costs and detects a one-SP discrepancy beyond safe JavaScript integer precision', () => {
    const index = snapshot.occurrences.findIndex((row) => BigInt(row.wikiCost) > BigInt(Number.MAX_SAFE_INTEGER))
    const original = snapshot.occurrences[index]
    expect(index).toBeGreaterThanOrEqual(0)
    expect(changed((copy) => { copy.occurrences[index].wikiCost = Number(original.wikiCost) as unknown as string })).toContain(`Invalid wiki decimal cost: ${original.id}`)
    expect(changed((copy) => { copy.occurrences[index].wikiCost = (BigInt(original.wikiCost) + 1n).toString() })).toContain(`Wiki/native cost mismatch: ${original.id}`)
  })

  it('blocks an Astral Key mapped to the wrong same-title identity or prerequisite', () => {
    const index = snapshot.occurrences.findIndex((row) => row.mapping === 'duplicate-title-exact-cost-and-prerequisite')
    const original = snapshot.occurrences[index]
    const another = catalog.upgrades.find((node) => node.title === 'Astral Key' && node.id !== original.id)!
    const errors = changed((copy) => { copy.occurrences[index].id = another.id })
    expect(errors).toContain(`Wiki/native cost mismatch: ${another.id}`)
    expect(errors).toContain(`Astral Key prerequisite witness mismatch: ${another.id}`)
    expect(changed((copy) => { copy.occurrences[index].prerequisiteWitness = 'Unrelated native upgrade' })).toContain(`Astral Key prerequisite witness mismatch: ${original.id}`)
  })

  it('requires all eleven distinct supplementary Astral Key witnesses', () => {
    const index = snapshot.occurrences.findIndex((row) => row.supplementary && row.wikiCost === '1000000000000')
    expect(changed((copy) => { copy.occurrences.splice(index, 1) })).toContain('Complete Astral Key identity witnesses required')
  })

  it('keeps repeated upgrades ranked by their earliest main-guide appearance', () => {
    const repeats = snapshot.occurrences.filter((row) => !row.supplementary && row.id === catalog.upgrades.find((node) => node.title === 'Funky Space')!.id)
    expect(repeats.length).toBeGreaterThan(1)
    const later = repeats.at(-1)!
    const stage = snapshot.stages.find((entry) => entry.id === later.stage)!
    const index = snapshot.rows.findIndex((row) => row.id === later.id)
    const errors = changed((copy) => {
      copy.rows[index].priority = stage.sequence * 1000 + later.order
      copy.rows[index].tier = later.tier
      copy.rows[index].url = `${snapshot.source.url}?oldid=${snapshot.source.revision}#${encodeURIComponent(later.stage)}`
    })
    expect(errors).toContain(`Priority does not match earliest main-guide occurrence: ${later.id}`)
  })

  it('does not promote a supplementary resource goal into the universal guide ranking', () => {
    const key = snapshot.occurrences.find((row) => row.supplementary && row.wikiCost === '1000000000000')!
    const errors = changed((copy) => { copy.rows[0].id = key.id })
    expect(errors).toContain(`Priority does not match earliest main-guide occurrence: ${key.id}`)
    expect(errors).toContain('Explicit eight-ID unranked coverage mismatch')
  })

  it('detects a duplicated source slot and a missing row within the reviewed table', () => {
    const errors = changed((copy) => { copy.occurrences[1].order = copy.occurrences[0].order })
    expect(errors).toContain('Duplicate wiki source slot: Tier_1:1')
    expect(errors).toContain('Missing wiki source slot: Tier_1:2')
  })

  it.each(['unmappedRows', 'ambiguousRows', 'costMismatches'] as const)('blocks unresolved %s rather than accepting a coverage count', (name) => {
    expect(changed((copy) => { copy.coverage[name].push({ unresolved: true } as never) })).toContain(`Unresolved recommendation coverage: ${name}`)
  })

  it('preserves the explicitly reviewed title correction rather than introducing fuzzy aliases', () => {
    const errors = changed((copy) => { copy.coverage.reviewedAliases[0].nativeTitle = 'Unrelated upgrade'; copy.coverage.reviewedAliases[0].id = catalog.startId })
    expect(errors).toContain('Reviewed alias mismatch: nativeTitle')
    expect(errors).toContain('Reviewed alias mismatch: id')
    const index = snapshot.occurrences.findIndex((row) => row.wikiTitle === 'Cyclone Soul')
    expect(changed((copy) => { copy.occurrences[index].mapping = 'fuzzy-title' })).toContain('Unverified reviewed Cyclone Soul alias')
  })

  it('rejects malformed JSON structures without needing raw exports or a network call', () => {
    expect(recommendationDataErrors({ schemaVersion: 1, rows: null }, catalog, catalogSha256)).toContain('Invalid priority rows array')
  })
})
