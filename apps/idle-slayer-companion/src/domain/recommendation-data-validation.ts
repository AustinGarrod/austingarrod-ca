import type { Catalog, Requirement } from './types'

const pageUrl = 'https://idleslayer.fandom.com/wiki/Ascension_Tree_Tier_List'
const sourceRevision = 7187
const unrankedIds = [
  '2oxx5mu5lw5rlpky0rsa', 'bfxg92d5su1vxe2fsg14', 'f0u5ddz1ddlbfcunejog', 'f49bj6r65ffyqmf0anum',
  'iugl3af4wlzw5ru7wooh', 'joffg528v6o2a86ldmnl', 'tksbj36zo6dlvjdnx1n2', 'z04g6cmfx6oucj9c7t9p',
]
const stageLabels = [
  'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5 (4,500+ SP)', 'Tier 6', 'Tier 7', 'Tier 8', 'Tier 9 (70,000+ SP)', 'Tier 10',
  'First Ultra Ascension', 'Second Ultra Ascension', 'Third Ultra Ascension', 'Fourth Ultra Ascension',
  'Fifth Ultra Ascension', 'Sixth Ultra Ascension', 'Seventh Ultra Ascension', 'Quick Ultra Ascensions (Repeatable)',
]
const stageCounts = [14, 11, 4, 13, 6, 10, 4, 12, 31, 1, 35, 27, 32, 23, 36, 14, 19, 11]
const normalize = (value: string) => value.normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim()
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function activePrerequisites(requirement: Requirement): string[] {
  if (requirement.kind === 'active') return [requirement.id]
  return requirement.kind === 'all' || requirement.kind === 'any' ? requirement.requirements.flatMap(activePrerequisites) : []
}

/** Shipped snapshot validation shared by unit tests and the offline release gate. */
export function recommendationDataErrors(data: unknown, catalog: Catalog, catalogSha256: string): string[] {
  const errors: string[] = []
  function object(value: unknown, label: string): Record<string, unknown> {
    if (isRecord(value)) return value
    errors.push(`Invalid ${label} object`)
    return {}
  }
  function records(value: unknown, label: string): Record<string, unknown>[] {
    if (!Array.isArray(value)) { errors.push(`Invalid ${label} array`); return [] }
    return value.map((entry) => object(entry, label))
  }
  function fields(value: Record<string, unknown>, expected: Record<string, unknown>, label: string) {
    for (const [key, wanted] of Object.entries(expected)) if (value[key] !== wanted) errors.push(`${label} mismatch: ${key}`)
  }
  const document = object(data, 'recommendation data')
  if (document.schemaVersion !== 1) errors.push('Unsupported recommendation schema')
  const source = object(document.source, 'source')
  fields(source, {
    label: 'Idle Slayer Wiki · Ascension Tree Tier List', url: pageUrl, revision: sourceRevision,
    revisionTimestamp: '2026-07-05T09:50:07Z', revisionUrl: `${pageUrl}?oldid=${sourceRevision}`,
    historyUrl: `${pageUrl}?action=history`, gameVersion: '7.0.0', retrievedAt: '2026-10-05',
    wikitextSha256: '550d10f516e5f0a06cbd6a5c2d3a355ade16c517ba8b6d440dcb1cae202ae0f2',
    attribution: 'Idle Slayer Wiki contributors. Ordering adapted into stable native IDs; descriptions are original summaries based on native effects. Raw wiki paragraphs and images are not copied.',
  }, 'Reviewed wiki source')
  fields(source, { license: 'CC-BY-SA-3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' }, 'Wiki license')
  fields(object(source.licenseEvidence, 'license evidence'), {
    wikiApiRights: 'CC-BY-SA', wikiApiRightsUrl: 'https://www.fandom.com/licensing',
    fandomDefaultUrl: 'https://community.fandom.com/wiki/Help:Licensing', revision: '3983537', revisionTimestamp: '2025-07-02T23:39:18Z',
  }, 'Reviewed license evidence')
  fields(object(source.strategyContext, 'strategy context'), {
    url: 'https://idleslayer.fandom.com/wiki/Ascension_Strategy', revision: '7232', revisionTimestamp: '2026-08-04T14:35:39Z',
    wikitextSha256: 'e28ad739c894768684a7741406c189c425338d4615b256580b50835a9656c1a2',
  }, 'Reviewed strategy source')
  if (document.orderingPolicy !== 'Ascending tier sequence and top-to-bottom row order; each stable ID keeps its earliest non-supplementary occurrence. Stage labels are source context, not inferred player state. The quick-UA key table is mapping evidence, not a universal purchase order.') errors.push('Reviewed ordering policy mismatch')
  fields(object(document.catalog, 'catalog reference'), {
    revision: catalog.revision, gameVersion: catalog.gameVersion, sha256: catalogSha256,
  }, 'Recommendation catalog')

  const byId = new Map(catalog.upgrades.map((node) => [node.id, node]))
  const titleCounts = new Map<string, number>()
  for (const node of catalog.upgrades) titleCounts.set(normalize(node.title), (titleCounts.get(normalize(node.title)) ?? 0) + 1)
  const stages = records(document.stages, 'stages')
  if (stages.length !== stageLabels.length) errors.push('Reviewed stage coverage mismatch')
  stages.forEach((stage, index) => fields(stage, {
    id: stageLabels[index]?.replaceAll(' ', '_'), label: stageLabels[index], sequence: index,
    supplementary: index === 17, rowCount: stageCounts[index],
  }, `Reviewed stage ${index}`))
  const stageById = new Map(stages.map((stage) => [stage.id, stage]))
  const occurrences = records(document.occurrences, 'occurrences')
  if (occurrences.length !== 303) errors.push('Expected 303 mapped wiki occurrences')
  const slots = new Set<string>()
  const supplementaryKeys = new Set<string>()
  for (const occurrence of occurrences) {
    const id = typeof occurrence.id === 'string' ? occurrence.id : ''
    const node = byId.get(id)
    if (!node) { errors.push(`Unknown occurrence native ID: ${id}`); continue }
    const stage = stageById.get(occurrence.stage)
    const slot = `${String(occurrence.stage)}:${String(occurrence.order)}`
    if (slots.has(slot)) errors.push(`Duplicate wiki source slot: ${slot}`)
    slots.add(slot)
    if (!stage || !Number.isSafeInteger(occurrence.order) || Number(occurrence.order) < 1 || Number(occurrence.order) > Number(stage.rowCount)) errors.push(`Invalid wiki source slot: ${slot}`)
    if (!stage || occurrence.tier !== stage.label || occurrence.supplementary !== stage.supplementary) errors.push(`Occurrence stage mismatch: ${slot}`)
    if (typeof occurrence.wikiCost !== 'string' || !/^\d+$/.test(occurrence.wikiCost)) errors.push(`Invalid wiki decimal cost: ${id}`)
    if (occurrence.wikiCost !== node.cost) errors.push(`Wiki/native cost mismatch: ${id}`)
    const title = typeof occurrence.wikiTitle === 'string' ? occurrence.wikiTitle : ''
    if (node.title === 'Astral Key') {
      if (!/^Astral Key(?: \(\+\d+\))?$/.test(title) || occurrence.mapping !== 'duplicate-title-exact-cost-and-prerequisite') errors.push(`Unverified duplicate-title mapping: ${id}`)
      const witness = typeof occurrence.prerequisiteWitness === 'string' ? normalize(occurrence.prerequisiteWitness) : ''
      if (!activePrerequisites(node.purchase).some((prerequisite) => normalize(byId.get(prerequisite)?.title ?? '') === witness)) errors.push(`Astral Key prerequisite witness mismatch: ${id}`)
      if (occurrence.supplementary === true) {
        if (supplementaryKeys.has(id)) errors.push(`Duplicate supplementary Astral Key: ${id}`)
        supplementaryKeys.add(id)
      }
    } else if (title === 'Cyclone Soul') {
      if (node.id !== 'izb5dl843znc6zz080ev' || node.title !== 'Soul Cyclone' || node.description !== 'Get +75% Souls per Wind Dash kill.' || occurrence.mapping !== 'reviewed-name-inversion-exact-cost-and-effect') errors.push('Unverified reviewed Cyclone Soul alias')
    } else if (normalize(title) !== normalize(node.title) || titleCounts.get(normalize(node.title)) !== 1 || occurrence.mapping !== 'unique-normalized-title') errors.push(`Wiki/native title mapping mismatch: ${id}`)
  }
  // Use the reviewed bounds so malformed rowCount values cannot stall a gate.
  stageLabels.forEach((label, index) => {
    const stage = label.replaceAll(' ', '_')
    for (let order = 1; order <= stageCounts[index]; order++) if (!slots.has(`${stage}:${order}`)) errors.push(`Missing wiki source slot: ${stage}:${order}`)
  })
  const nativeKeyIds = catalog.upgrades.filter((node) => node.title === 'Astral Key').map((node) => node.id).sort()
  if (!equal([...supplementaryKeys].sort(), nativeKeyIds) || nativeKeyIds.length !== 11) errors.push('Complete Astral Key identity witnesses required')

  const expected = new Map<string, { priority: number; tier: unknown; url: string }>()
  for (const occurrence of [...occurrences].sort((a, b) => Number(stageById.get(a.stage)?.sequence) - Number(stageById.get(b.stage)?.sequence) || Number(a.order) - Number(b.order))) {
    if (occurrence.supplementary !== false || typeof occurrence.id !== 'string' || expected.has(occurrence.id)) continue
    expected.set(occurrence.id, {
      priority: Number(stageById.get(occurrence.stage)?.sequence) * 1000 + Number(occurrence.order), tier: occurrence.tier,
      url: `${pageUrl}?oldid=${sourceRevision}#${encodeURIComponent(String(occurrence.stage))}`,
    })
  }
  const rows = records(document.rows, 'priority rows')
  if (rows.length !== 280 || expected.size !== 280) errors.push('Expected 280 unique main-guide priorities')
  const ids = new Set<string>()
  const priorities = new Set<number>()
  let previous = 0
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : ''
    if (!byId.has(id)) errors.push(`Unknown ranked native ID: ${id}`)
    if (ids.has(id)) errors.push(`Duplicate ranked native ID: ${id}`)
    ids.add(id)
    if (!Number.isSafeInteger(row.priority) || Number(row.priority) <= 0) errors.push(`Invalid positive integer priority: ${id}`)
    if (priorities.has(Number(row.priority))) errors.push(`Duplicate priority: ${String(row.priority)}`)
    if (Number(row.priority) <= previous) errors.push(`Unsorted priority: ${id}`)
    previous = Number(row.priority)
    priorities.add(Number(row.priority))
    const first = expected.get(id)
    if (!first || row.priority !== first.priority || row.tier !== first.tier || row.url !== first.url) errors.push(`Priority does not match earliest main-guide occurrence: ${id}`)
    if (typeof row.note !== 'string' || !row.note.trim()) errors.push(`Missing original priority note: ${id}`)
  }
  if (!equal([...ids].sort(), [...expected.keys()].sort())) errors.push('Rank pool does not match main-guide occurrences')

  const coverage = object(document.coverage, 'coverage')
  fields(coverage, { nativeUpgradeCount: catalog.upgrades.length, rankedUpgradeCount: 280, extractedRowCount: 303, mappedOccurrenceCount: 303 }, 'Reviewed coverage')
  if (catalog.upgrades.length !== 288) errors.push('Reviewed native catalog count changed')
  const actualUnranked = catalog.upgrades.filter((node) => !ids.has(node.id)).map((node) => node.id).sort()
  if (!equal(coverage.unrankedNativeIds, unrankedIds) || !equal(actualUnranked, unrankedIds)) errors.push('Explicit eight-ID unranked coverage mismatch')
  for (const name of ['unmappedRows', 'ambiguousRows', 'costMismatches']) if (!Array.isArray(coverage[name]) || coverage[name].length !== 0) errors.push(`Unresolved recommendation coverage: ${name}`)
  const aliases = records(coverage.reviewedAliases, 'reviewed aliases')
  if (aliases.length !== 1) errors.push('Reviewed alias coverage mismatch')
  fields(aliases[0] ?? {}, {
    wikiTitle: 'Cyclone Soul', nativeTitle: 'Soul Cyclone', id: 'izb5dl843znc6zz080ev', tier: 'Fifth Ultra Ascension',
    evidence: 'Exact cost and effect match; the same wiki revision uses Soul Cyclone in its Astral Key prerequisite table.',
  }, 'Reviewed alias')
  const corrections = records(coverage.syntaxCorrections, 'syntax corrections')
  if (corrections.length !== 2) errors.push('Reviewed syntax correction coverage mismatch')
  corrections.forEach((correction, index) => fields(correction, { tier: 'Fifth Ultra Ascension', order: 12 + index, title: ['Stone of Hope Overcharge', 'Stone of Rage Overcharge'][index] }, `Reviewed syntax correction ${index}`))
  return [...new Set(errors)]
}
