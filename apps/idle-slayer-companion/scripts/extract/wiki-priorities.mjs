// Original code: MIT. The generated wiki-derived ordering is CC-BY-SA-3.0.
// Raw wiki responses stay in ignored .local-game/; no game files are modified.
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const options = Object.fromEntries(process.argv.slice(2).filter((argument) => argument.startsWith('--')).map((argument) => {
  const [name, value] = argument.slice(2).split('=')
  return [name, value ?? true]
}))
const input = String(options.input ?? '.local-game/wiki-priorities')
const mode = String(options.mode ?? 'candidate')
if (!['candidate', 'reproduce'].includes(mode)) throw new Error('Use --mode=candidate or --mode=reproduce')
const output = String(options.output ?? path.join(input, mode === 'reproduce' ? 'reproduced.json' : 'candidate.json'))
const referenceText = mode === 'reproduce' ? await readFile(String(options.reference ?? 'src/data/wiki-priorities.json'), 'utf8') : null
const reference = referenceText === null ? null : JSON.parse(referenceText)
const revision = String(options.revision ?? reference?.source.revision ?? '7187')
if (reference && revision !== String(reference.source.revision)) throw new Error('Reproduction must use the reviewed primary revision')
const pageUrl = 'https://idleslayer.fandom.com/wiki/Ascension_Tree_Tier_List'
const api = 'https://idleslayer.fandom.com/api.php'
const sha = (value) => createHash('sha256').update(value).digest('hex')
const readJSON = async (name) => JSON.parse(await readFile(path.join(input, name), 'utf8'))
await mkdir(input, { recursive: true })

async function download(name, url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'IdleSlayerAscensionMap/1.0 (offline recommendation provenance)' } })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const body = await response.text()
  JSON.parse(body)
  await writeFile(path.join(input, name), body)
}

if (options.refresh) {
  const selector = revision === 'latest' ? 'titles=Ascension_Tree_Tier_List' : `revids=${encodeURIComponent(revision)}`
  await download('tier-list-api.json', `${api}?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&${selector}&format=json`)
  const page = Object.values((await readJSON('tier-list-api.json')).query.pages)[0]
  await download('tier-sections.json', `${api}?action=parse&oldid=${page.revisions[0].revid}&prop=sections&format=json`)
  await download('rightsinfo.json', `${api}?action=query&meta=siteinfo&siprop=rightsinfo&format=json`)
  const strategySelector = reference ? `revids=${encodeURIComponent(reference.source.strategyContext.revision)}` : 'titles=Ascension_Strategy'
  const licensingSelector = reference ? `revids=${encodeURIComponent(reference.source.licenseEvidence.revision)}` : 'titles=Help%3ALicensing'
  await download('ascension-strategy-api.json', `${api}?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&${strategySelector}&format=json`)
  await download('licensing-api.json', `https://community.fandom.com/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&${licensingSelector}&format=json`)
  await writeFile(path.join(input, 'fetch-receipt.json'), JSON.stringify({ retrievedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n')
}

const page = Object.values((await readJSON('tier-list-api.json')).query.pages)[0]
const wikiRevision = page.revisions[0]
if (revision !== 'latest' && wikiRevision.revid !== Number(revision)) throw new Error('Input does not match the requested revision')
const wikitext = wikiRevision.slots.main['*']
const sections = (await readJSON('tier-sections.json')).parse
if (sections.revid !== wikiRevision.revid) throw new Error('Section anchors do not match the page revision')
const rights = (await readJSON('rightsinfo.json')).query.rightsinfo
if (rights.text !== 'CC-BY-SA') throw new Error('Wiki license changed; review before generating')
const licensingPage = Object.values((await readJSON('licensing-api.json')).query.pages)[0]
const licensingRevision = licensingPage.revisions[0]
if (!/all of the text on a wiki is licensed under the \[https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\//.test(licensingRevision.slots.main['*'])) throw new Error('Fandom license version needs manual review')
const strategyPage = Object.values((await readJSON('ascension-strategy-api.json')).query.pages)[0]
const strategyRevision = strategyPage.revisions[0]
const fetched = await readJSON('fetch-receipt.json')
const fetchDate = fetched?.retrievedAt
const parsedFetchDate = typeof fetchDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fetchDate)
  ? Date.parse(`${fetchDate}T00:00:00.000Z`) : NaN
if (!Number.isFinite(parsedFetchDate) || new Date(parsedFetchDate).toISOString().slice(0, 10) !== fetchDate) {
  throw new Error('Fetch receipt must contain a valid YYYY-MM-DD calendar date')
}
const catalogText = await readFile('public/catalog.json', 'utf8')
const catalog = JSON.parse(catalogText)
const byId = new Map(catalog.upgrades.map((node) => [node.id, node]))
if (reference && (
  wikiRevision.revid !== reference.source.revision || wikiRevision.timestamp !== reference.source.revisionTimestamp ||
  sha(wikitext) !== reference.source.wikitextSha256 ||
  String(strategyRevision.revid) !== reference.source.strategyContext.revision || strategyRevision.timestamp !== reference.source.strategyContext.revisionTimestamp ||
  sha(strategyRevision.slots.main['*']) !== reference.source.strategyContext.wikitextSha256 ||
  String(licensingRevision.revid) !== reference.source.licenseEvidence.revision || licensingRevision.timestamp !== reference.source.licenseEvidence.revisionTimestamp ||
  rights.text !== reference.source.licenseEvidence.wikiApiRights || rights.url !== reference.source.licenseEvidence.wikiApiRightsUrl ||
  sha(catalogText) !== reference.catalog.sha256
)) throw new Error('Cached/fetched evidence differs from the reviewed snapshot; generate and review a candidate instead')

function plain(value) {
  return value.replace(/<ref\b[^>]*\/>/gi, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/''+/g, '').replace(/\s+/g, ' ').trim()
}
const key = (value) => plain(value).normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim()
const byTitle = new Map()
for (const node of catalog.upgrades) {
  const title = key(node.title)
  byTitle.set(title, [...(byTitle.get(title) ?? []), node])
}
function decimalCost(value) {
  const number = plain(value).match(/^[\s]*([\d,]+(?:\.\d+)?)(?:e([+-]?\d+))?/i)
  if (!number) return null
  const [integer, fraction = ''] = number[1].replaceAll(',', '').split('.')
  const exponent = Number(number[2] ?? 0) - fraction.length
  const digits = BigInt(integer + fraction)
  if (exponent >= 0) return (digits * 10n ** BigInt(exponent)).toString()
  const divisor = 10n ** BigInt(-exponent)
  return digits % divisor === 0n ? (digits / divisor).toString() : null
}
function activePrerequisites(requirement) {
  if (requirement.kind === 'active') return [requirement.id]
  if (requirement.kind === 'all' || requirement.kind === 'any') return requirement.requirements.flatMap(activePrerequisites)
  return []
}

// This parser deliberately accepts only four-cell upgrade rows beginning with
// a File image. Narrative/colspan rows and references cannot become priorities.
const headings = [...wikitext.matchAll(/^===(.+?)===\s*$/gm)]
const stages = []
const extracted = []
const syntaxCorrections = []
for (let index = 0; index < headings.length; index++) {
  const heading = headings[index]
  const label = plain(heading[1])
  const section = sections.sections.find((entry) => entry.level === '3' && plain(entry.line) === label)
  if (!section) throw new Error(`Missing exact section anchor: ${label}`)
  const supplementary = label === 'Quick Ultra Ascensions (Repeatable)'
  const body = wikitext.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? wikitext.length)
  const stage = { id: section.anchor, label, sequence: index, supplementary }
  stages.push(stage)
  let order = 0
  for (const table of body.matchAll(/\{\|[^\n]*\n([\s\S]*?)\n\|\}/g)) {
    for (const row of table[1].split(/\n\|-\s*\n/)) {
      const cells = []
      for (const line of row.split('\n')) {
        if (line.startsWith('|') && !line.startsWith('|-')) cells.push(line.slice(1))
        else if (cells.length && !line.startsWith('!')) cells[cells.length - 1] += '\n' + line
      }
      if (cells.length !== 4 || !/^\|?\[\[File:/i.test(cells[0].trim())) continue
      order++
      if (cells[0].trim().startsWith('|')) syntaxCorrections.push({ tier: label, order, title: plain(cells[1]), correction: 'Ignored one extra delimiter before the File image; the name, cost and effect remain their own cells.' })
      extracted.push({ stage: stage.id, tier: label, stageSequence: index, order, supplementary, title: plain(cells[1]), cost: decimalCost(cells[2]), fourthCell: plain(cells[3]) })
    }
  }
  stage.rowCount = order
  if (!order) throw new Error(`No upgrade rows extracted from ${label}`)
}

const keyWitnesses = extracted.filter((row) => row.supplementary && /^Astral Key(?: \(\+\d+\))?$/.test(row.title))
if (keyWitnesses.length !== 11) throw new Error('Astral Key witness table changed; review duplicate-title mappings')
const unmappedRows = []
const ambiguousRows = []
const costMismatches = []
const reviewedAliases = []
const occurrences = []
const best = new Map()

const specificNotes = {
  'Permanent Slayer': 'Keeps the initial enemy unlocks ready across ordinary Ascensions.',
  'Soul Gatherer Bundle': 'Keeps the basic soul-gathering unlocks available across ordinary Ascensions.',
  'Permanent Quests': 'Avoids re-unlocking quest bundles after an ordinary Ascension.',
  'Soul Reaper': 'Builds the soul bonus that scales with earned Slayer Points.',
  'Portals': 'Unlocks travel. The guide places it late in its early tier; changing dimensions can alter soul farming.',
  'Ultra Ascension': 'Unlocks the reset system. Check the guide preparation advice first; readiness outside recorded purchases is not tracked here.',
  'Inner Power': 'Adds minion rewards based on spent SP; current mission and spending totals are outside this tracker.',
  'Astral Slayer': 'Opens Astral progression. Ownership and activation still follow the native rules.',
  "Wander's Path": 'Strengthens giant soul farming. The guide offers a different route for players focused on Chest Hunt.',
  'Magic Beetle Box': 'Opens coin upgrades. The guide conditions its usefulness on coin earnings that this tracker does not record.',
  'Master of Realms': 'A distant CpS goal. The guide presents it as optional until the player is ready for its native cost.',
}
function rationale(node) {
  if (specificNotes[node.title]) return specificNotes[node.title]
  if (node.title === 'Astral Key') return 'Adds Astral Keys at Ultra Ascension; this is a repeatable resource goal, not a readiness check.'
  const effect = node.description.toLowerCase()
  if (node.activation === 'after-ultra-ascension') return 'Builds a retained upgrade whose effect waits for Astral activation; purchase and activation are separate.'
  if (effect.includes('unlock')) return 'Opens another progression feature; its native prerequisites and external milestones still apply.'
  if (effect.includes('souls') || effect.includes('soul')) return 'Supports soul income; the benefit depends on the activity described in the native effect.'
  if (effect.includes('minion')) return 'Improves minion progression; mission state and current minion levels are not recorded here.'
  if (effect.includes('quest')) return 'Supports quest progression; current quest completion is outside this tracker.'
  if (effect.includes('coin') || effect.includes('cps')) return 'Supports coin or CpS progression; current equipment and coin earnings are not recorded here.'
  if (effect.includes('rage')) return 'Improves Rage Mode; its usefulness depends on the player’s active play.'
  if (effect.includes('bonus stage') || effect.includes('random')) return 'Improves an event or minigame benefit described by the native effect.'
  return 'Follows the guide’s general mixed-play order; use the native effect and cost to judge personal value.'
}
for (const row of extracted) {
  const title = row.title.replace(/^Astral Key \(\+\d+\)$/, 'Astral Key')
  let candidates = byTitle.get(key(title)) ?? []
  let node
  let mapping
  if (!candidates.length && title === 'Cyclone Soul') {
    candidates = byTitle.get(key('Soul Cyclone')) ?? []
    if (candidates.length !== 1 || candidates[0].cost !== row.cost || key(candidates[0].description) !== key(row.fourthCell)) throw new Error('Reviewed Cyclone Soul alias no longer matches native cost and exact effect')
    node = candidates[0]
    mapping = 'reviewed-name-inversion-exact-cost-and-effect'
    reviewedAliases.push({ wikiTitle: title, nativeTitle: node.title, id: node.id, tier: row.tier, evidence: 'Exact cost and effect match; the same wiki revision uses Soul Cyclone in its Astral Key prerequisite table.' })
  } else if (candidates.length === 1) {
    node = candidates[0]
    mapping = 'unique-normalized-title'
  } else if (candidates.length > 1) {
    // Cost alone is not enough evidence for repeated native titles. The wiki's
    // supplementary table also names the prerequisite of each Astral Key.
    const witness = title === 'Astral Key' ? keyWitnesses.find((entry) => entry.cost === row.cost) : null
    const matches = candidates.filter((candidate) => candidate.cost === row.cost && witness && activePrerequisites(candidate.purchase).some((id) => key(byId.get(id)?.title ?? '') === key(witness.fourthCell)))
    if (matches.length === 1) {
      node = matches[0]
      mapping = 'duplicate-title-exact-cost-and-prerequisite'
    } else {
      ambiguousRows.push({ tier: row.tier, order: row.order, title: row.title, wikiCost: row.cost, candidateIds: candidates.map((candidate) => candidate.id) })
      continue
    }
  } else {
    unmappedRows.push({ tier: row.tier, order: row.order, title: row.title, wikiCost: row.cost })
    continue
  }
  if (row.cost !== node.cost) costMismatches.push({ id: node.id, title: node.title, tier: row.tier, wikiCost: row.cost, nativeCost: node.cost })
  const occurrence = { id: node.id, tier: row.tier, stage: row.stage, order: row.order, wikiTitle: row.title, wikiCost: row.cost, mapping, supplementary: row.supplementary }
  if (mapping.startsWith('duplicate')) occurrence.prerequisiteWitness = keyWitnesses.find((entry) => entry.cost === row.cost).fourthCell
  occurrences.push(occurrence)
  if (!row.supplementary && !best.has(node.id)) best.set(node.id, {
    id: node.id, priority: row.stageSequence * 1000 + row.order, tier: row.tier,
    url: `${pageUrl}?oldid=${wikiRevision.revid}#${encodeURIComponent(row.stage)}`,
    note: rationale(node),
  })
}

const rows = [...best.values()].sort((a, b) => a.priority - b.priority)
const data = {
  schemaVersion: 1,
  source: {
    label: 'Idle Slayer Wiki · Ascension Tree Tier List', url: pageUrl,
    revision: wikiRevision.revid, revisionTimestamp: wikiRevision.timestamp,
    revisionUrl: `${pageUrl}?oldid=${wikiRevision.revid}`, historyUrl: `${pageUrl}?action=history`,
    gameVersion: wikitext.match(/Last updated:\s*v([^\s]+)/)?.[1] ?? null,
    retrievedAt: reference?.source.retrievedAt ?? fetched.retrievedAt, wikitextSha256: sha(wikitext),
    license: 'CC-BY-SA-3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    licenseEvidence: { wikiApiRights: rights.text, wikiApiRightsUrl: rights.url, fandomDefaultUrl: 'https://community.fandom.com/wiki/Help:Licensing', revision: String(licensingRevision.revid), revisionTimestamp: licensingRevision.timestamp },
    attribution: 'Idle Slayer Wiki contributors. Ordering adapted into stable native IDs; descriptions are original summaries based on native effects. Raw wiki paragraphs and images are not copied.',
    strategyContext: { url: 'https://idleslayer.fandom.com/wiki/Ascension_Strategy', revision: String(strategyRevision.revid), revisionTimestamp: strategyRevision.timestamp, wikitextSha256: sha(strategyRevision.slots.main['*']) },
  },
  catalog: { revision: catalog.revision, gameVersion: catalog.gameVersion, sha256: sha(catalogText) },
  orderingPolicy: 'Ascending tier sequence and top-to-bottom row order; each stable ID keeps its earliest non-supplementary occurrence. Stage labels are source context, not inferred player state. The quick-UA key table is mapping evidence, not a universal purchase order.',
  rows, stages, occurrences,
  coverage: {
    nativeUpgradeCount: catalog.upgrades.length, rankedUpgradeCount: rows.length,
    extractedRowCount: extracted.length, mappedOccurrenceCount: occurrences.length,
    unrankedNativeIds: catalog.upgrades.filter((node) => !best.has(node.id)).map((node) => node.id).sort(),
    unmappedRows, ambiguousRows, costMismatches, reviewedAliases, syntaxCorrections,
  },
}
const generated = JSON.stringify(data, null, 2) + '\n'
if (referenceText !== null && generated !== referenceText) throw new Error('Generated reproduction differs from the reviewed bytes; do not promote it')
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, generated)
if (referenceText !== null) await writeFile(output + '.reproduction-receipt.json', JSON.stringify({
  mode, reproducedAt: new Date().toISOString(), sourceFetchedAt: fetched.retrievedAt,
  originalSnapshotRetrievedAt: reference.source.retrievedAt,
  referenceSha256: sha(referenceText), reproducedSha256: sha(generated),
  primaryRevision: wikiRevision.revid, strategyRevision: strategyRevision.revid, licensingRevision: licensingRevision.revid,
}, null, 2) + '\n')
console.log(JSON.stringify({ output, revision: data.source.revision, ranked: rows.length, native: catalog.upgrades.length, rawRows: extracted.length, unmapped: unmappedRows, ambiguous: ambiguousRows, costMismatches }, null, 2))
