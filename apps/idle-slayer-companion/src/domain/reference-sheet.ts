import type { Catalog, Profile } from './types'
import { emptyProfile } from './types'
import { visibility } from './rules'
import { visibleRequirement, type VisibleRequirement } from './requirement-view'

export const MAX_SHEET_UPGRADES = 4
const escape = (text: string) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

function requirementText(requirement: VisibleRequirement | null): string {
  if (!requirement) return 'No currently visible requirement entries.'
  if (requirement.kind === 'leaf') return `${requirement.label}${requirement.route && 'id' in requirement.route ? ` [${requirement.route.id}]` : ''}`
  const operator = requirement.kind === 'all' ? ' AND ' : ' OR '
  return requirement.requirements.map((child) => {
    const text = requirementText(child)
    return child.kind !== 'leaf' && child.kind !== requirement.kind ? `(${text})` : text
  }).join(operator)
}

/** Explicit public selections only. Never serialize profile state or hidden graph shape. */
export function createReferenceSheet(catalog: Catalog, viewer: Profile, requested: readonly string[]) {
  const visible = visibility(catalog, viewer)
  const ids = [...new Set(requested)].filter((id) => visible.ids.has(id)).slice(0, MAX_SHEET_UPGRADES)
  const index = new Map(catalog.upgrades.map((upgrade) => [upgrade.id, upgrade]))
  const publicProfile = emptyProfile(catalog.revision)
  const entries = ids.map((id) => {
    const upgrade = index.get(id)!
    const fields: [string, string][] = [
      ['Native identity', upgrade.id],
      ['Exact catalog cost', `${BigInt(upgrade.cost).toLocaleString('en')} Slayer Points`],
      ['Native effect', upgrade.description],
      ['Purchase requirements (visible excerpt)', requirementText(visibleRequirement(upgrade.purchase, publicProfile, visible))],
      ['Reveal requirements (visible excerpt)', requirementText(visibleRequirement(upgrade.reveal, publicProfile, visible))],
      ['Activation', upgrade.activation === 'after-ultra-ascension' ? 'Buying this Astral lock retains ownership but leaves it pending until a full native Ultra Ascension transition.' : 'Activates on purchase.'],
      ['Retention', upgrade.retention === 'repeat' ? 'Repeat purchase: clears on Ultra Ascension unless native Astral retention retains existing ownership. Current player retention is not included.' : 'Ownership is retained through Ultra Ascension.'],
    ]
    const sources = upgrade.sources.map((source) => `<li>${escape(source.label)}${source.url ? `: <a href="${escape(source.url)}" rel="noreferrer">${escape(source.url)}</a>` : ''}${source.evidence ? ` — ${escape(source.evidence)}` : ''}</li>`).join('')
    return `<article><h2>${escape(upgrade.title)}</h2><dl>${fields.map(([label, text]) => `<dt>${escape(label)}</dt><dd>${escape(text)}</dd>`).join('')}</dl><h3>Sources</h3><ul>${sources}</ul></article>`
  }).join('')
  const scope = viewer.showSpoilers ? 'Spoiler browsing was explicitly enabled for this selection.' : 'Selection and requirement excerpts follow the current hidden-spoiler view.'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Idle Slayer upgrade reference sheet</title><style>html{font-family:Arial,sans-serif;color:#171717;background:white}body{max-width:52rem;margin:auto;padding:min(1rem,4vw);line-height:1.5;overflow-wrap:anywhere}h1{font-size:1.5rem}h2{font-size:1.25rem}h3{font-size:1rem}article{border-top:1px solid #aaa;margin-top:1.5rem;padding-top:.5rem}dt{font-weight:bold;margin-top:.75rem}dd{margin:.25rem 0 0}ul{padding-left:1.25rem}a{color:#163c6a}@media(max-width:20rem){h1,h2{font-size:1rem}}@media print{body{max-width:none;padding:0}h2,dt{break-after:avoid}article{break-inside:auto}a{color:inherit}}</style></head><body><h1>Idle Slayer upgrade reference sheet</h1><p>Idle Slayer ${escape(catalog.gameVersion)} · Steam build ${escape(catalog.steamBuild)} · Catalog ${escape(catalog.revision)}</p><p>${scope} This bounded sheet contains ${ids.length} explicitly chosen upgrades. It freezes reviewed catalog facts; later catalogs may differ.</p><p>Requirements are visible excerpts, not complete routes or proof of eligibility. Hidden requirements, connections, topology, recorded ownership, milestones, Ultra Ascension count and personal notes are omitted. Effects can depend on game progress; no current effect totals, affordability or optimal build is calculated.</p>${entries}<footer><h2>Attribution and use</h2><p>Unofficial companion, unaffiliated with Idle Slayer. Game text and upgrade data belong to Pablo Leban and their respective rights holders and are excluded from the application's MIT license. Native English text and rules were extracted offline from the reviewed Windows Steam game. No guide ordering, wiki descriptions, icons or application runtime is included.</p><p><a href="https://idleslayer.com/" rel="noreferrer">Idle Slayer official site</a> · <a href="https://store.steampowered.com/app/1353300/Idle_Slayer/" rel="noreferrer">Steam game source</a></p><p>Save this HTML file locally, or use your browser's Print command (Ctrl+P) to print or save as PDF. Sharing is your choice.</p></footer></body></html>`
  return { ids, html }
}
