import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CompanionEntity, CompanionEntityRef, CompanionProgress, CompanionRecord, CompanionSystem } from './domain/companion-types'
import { getCompanionRecord } from './domain/companion-progress'
import { companionDisplayText, companionExactSum, companionPlannedCosts, companionPlural, companionRecordedStatus, companionRefKey, companionSearchMatches, companionShoppingList, companionStatusText, companionSystemLabels, counterPercent } from './companion-view-model'
import { CompactCount, SPCost } from './SPCost'
import { companionSections } from './CompanionShell'
import type { CompanionSection } from './CompanionShell'
import './CompanionModules.css'

export interface CompanionReferenceEntry { ref: CompanionEntityRef; title: string; description?: string; status?: string }
export interface CompanionEntityPresentationState { available?: boolean; active?: boolean; blockers?: string[]; masteryTier?: number; masteryKills?: string }
export interface CompanionModulesProps {
  section: Exclude<CompanionSection, 'ascension'>
  entities: readonly CompanionEntity[]
  progress: CompanionProgress
  onRecord: (system: CompanionSystem, id: string, patch: CompanionRecord) => void
  onTrack: (system: CompanionSystem, tracked: boolean) => void
  pinnedRefs: ReadonlySet<string>
  onPinGoal: (ref: CompanionEntityRef) => void
  onNavigate: (section: CompanionSection, ref?: CompanionEntityRef) => void
  recipePlans: Readonly<Record<string, string>>
  onRecipePlan: (id: string, quantity: string) => void
  entityStates?: Readonly<Record<string, CompanionEntityPresentationState>>
  referenceEntries?: readonly CompanionReferenceEntry[]
  goalEntries?: readonly CompanionReferenceEntry[]
  focusedRef?: CompanionEntityRef | null
  busy?: boolean
  /** Recorded Ultra Ascensions and the one place outside the map to record a new one. */
  ultraAscension?: { count: number; eligible: boolean; onRecord: () => void }
  /** The one spoiler setting shared with Ascension, shown beside the filters it widens. */
  spoilers?: { shown: boolean; onChange: (shown: boolean) => void }
  onImport?: () => void
  /** Visible-only Ascension totals and the next suggestion, with the wiki ordering's attribution. */
  ascensionSummary?: {
    owned: number; total: number; status: 'wiki' | 'fallback' | 'all-owned' | 'blocked'
    next?: { id: string; title: string; cost: string; basis: string }
    source: { label: string; url: string; license: string }
  }
}

const systemsForSection: Record<Exclude<CompanionSection, 'overview' | 'ascension'>, readonly CompanionSystem[]> = {
  achievements: ['achievement'], crafting: ['craft', 'material'], quests: ['quest', 'village'], bestiary: ['enemy'], divinities: ['divinity'],
}
const sectionForSystem: Record<CompanionEntityRef['system'], CompanionSection> = {
  ascension: 'ascension', achievement: 'achievements', craft: 'crafting', material: 'crafting', quest: 'quests', village: 'quests', enemy: 'bestiary', divinity: 'divinities',
}
const sectionCopy = {
  achievements: { title: 'Achievements', description: 'Track earned achievements.' },
  crafting: { title: 'Crafting & materials', description: 'Track items and materials, and plan recipes.' },
  quests: { title: 'Quests & Village', description: 'Track quests, rewards, and Village tasks.' },
  bestiary: { title: 'Bestiary', description: 'Track enemies, kill counts, and mastery.' },
  divinities: { title: 'Divinities', description: 'Track selected Divinities and their goal costs.' },
}
const goalStatusLabel = (value?: string) => value === 'untracked' ? 'Not recorded' : value === 'incomplete' ? 'In progress' : value === 'complete' ? 'Complete' : value

export function EntityIcon({ entity, large = false }: { entity: CompanionEntity; large?: boolean }) {
  const symbol = { achievement: '♜', craft: '⚒', material: '◆', quest: '⚑', village: '⌂', enemy: '♞', divinity: '☼' }[entity.system]
  return <span className={`companion-entity-icon${large ? ' companion-entity-icon-large' : ''}`} aria-hidden="true">
    {entity.icon ? <img src={`${import.meta.env.BASE_URL}${entity.icon.replace(/^\//, '')}`} alt="" loading="lazy" /> : symbol}
  </span>
}

function SpoilerToggle({ shown, onChange, busy }: { shown: boolean; onChange: (shown: boolean) => void; busy?: boolean }) {
  return <label className="spoiler-control companion-spoiler-control"><input type="checkbox" checked={shown} disabled={busy} onChange={(event) => onChange(event.target.checked)} />Show spoilers</label>
}

export function StatusPill({ status, children }: { status?: string; children: ReactNode }) {
  return <span className={`companion-status-pill companion-status-${status ?? 'unknown'}`}>{children}</span>
}

/** A recorded yes/no fact as one tap: two pressed-state buttons. Neither is pressed until it is recorded. */
export function ObservationToggle({ label, value, onChange, yes = 'Recorded', no = 'Not yet', disabled, compact = false }: { label: string; value?: boolean; onChange: (value: boolean) => void; yes?: string; no?: string; disabled?: boolean; compact?: boolean }) {
  const id = useId()
  return <div className={`companion-observation${compact ? ' companion-observation-compact' : ''}`} role="group" aria-labelledby={id}>
    <span id={id} className={compact ? 'sr-only' : undefined}>{label}</span>
    <div className="companion-toggle">{([[false, no], [true, yes]] as const).map(([option, text]) => <button type="button" key={text} aria-pressed={value === option} disabled={disabled} onClick={() => { if (value !== option) onChange(option) }}>{value === option && <span aria-hidden="true">{option ? '✓ ' : '○ '}</span>}{text}</button>)}</div>
  </div>
}

/** Enter or leaving the field records a changed count; a short "Saved" confirms it. */
export function CounterEditor({ label, value, target, onChange, compact = false }: { label: string; value?: string; target?: string; onChange: (value: string) => void; compact?: boolean }) {
  const id = useId()
  const [draft, setDraft] = useState(value ?? '')
  const [saved, setSaved] = useState(false)
  const submitted = useRef(false)
  useEffect(() => { setDraft(value ?? ''); if (submitted.current) { submitted.current = false; setSaved(true) } }, [value])
  useEffect(() => { if (!saved) return; const timer = window.setTimeout(() => setSaved(false), 2500); return () => window.clearTimeout(timer) }, [saved])
  const valid = /^\d{1,80}$/.test(draft)
  const changed = valid && BigInt(draft).toString() !== value
  const percent = counterPercent(value, target)
  function commit() { if (!changed) return; submitted.current = true; setSaved(false); onChange(BigInt(draft).toString()) }
  return <form className={`companion-counter${compact ? ' companion-counter-compact' : ''}`} onSubmit={(event) => { event.preventDefault(); commit() }}>
    <label htmlFor={id} className={compact ? 'sr-only' : undefined}>{label}{target !== undefined && <small>Target: <CompactCount value={target} /></small>}</label>
    <div className="companion-counter-input"><input id={id} inputMode="numeric" pattern="[0-9]*" maxLength={80} value={draft} enterKeyHint="done" onChange={(event) => setDraft(event.target.value)} onBlur={(event) => { if (!event.currentTarget.form?.contains(event.relatedTarget as Node | null)) commit() }} placeholder="Not recorded" /><button type="submit" disabled={!changed}>Record</button></div>
    {draft && !valid && <small role="status">Use a whole number, zero or greater.</small>}
    {saved && <small className="companion-saved" role="status"><span aria-hidden="true">✓ </span>Saved</small>}
    {percent !== null && !compact && <div className="companion-counter-progress"><progress value={percent} max={100} aria-label={`${label}: ${percent}% of target`} /><small>{percent}%</small></div>}
  </form>
}

function RelatedLinks({ title, refs, lookup, onNavigate }: { title: string; refs?: readonly CompanionEntityRef[]; lookup: ReadonlyMap<string, CompanionReferenceEntry>; onNavigate: CompanionModulesProps['onNavigate'] }) {
  const visible = (refs ?? []).flatMap((ref) => { const entity = lookup.get(companionRefKey(ref)); return entity ? [entity] : [] })
  if (!visible.length) return null
  return <div className="companion-related"><span>{title}</span><div>{visible.map((entity) => <button type="button" key={companionRefKey(entity.ref)} onClick={() => onNavigate(sectionForSystem[entity.ref.system], entity.ref)}>{entity.title}<span aria-hidden="true"> ↗</span></button>)}</div></div>
}

export function EntityCard({ entity, record, pinned, onPin, onRecord, planned, onPlan, state, lookup, onNavigate, busy }: {
  entity: CompanionEntity; record: CompanionRecord; pinned: boolean; onPin: () => void; onRecord: (patch: CompanionRecord) => void
  planned?: string; onPlan: (quantity: string) => void; state?: CompanionEntityPresentationState
  lookup: ReadonlyMap<string, CompanionReferenceEntry>; onNavigate: CompanionModulesProps['onNavigate']
  busy?: boolean
}) {
  const status = companionRecordedStatus(entity, record)
  const [planDraft, setPlanDraft] = useState(planned ?? '0')
  const card = useRef<HTMLElement>(null)
  useEffect(() => setPlanDraft(planned ?? '0'), [planned])
  const itemId = `companion-entity-${entity.system}-${entity.id}`
  const recipeCosts = companionPlannedCosts([entity], { [entity.id]: '1' })
  return <article className={`companion-entity-card companion-entity-${status}`} id={itemId} tabIndex={-1} ref={card}>
    <div className="companion-card-heading"><EntityIcon entity={entity} /><div><span className="companion-eyebrow">{companionDisplayText(entity.category) || companionSystemLabels[entity.system]}</span><h3>{entity.title}</h3></div><button type="button" className="companion-pin" aria-label={`${pinned ? 'Remove' : 'Pin'} ${entity.title} ${pinned ? 'from' : 'as'} a goal`} aria-pressed={pinned} onClick={onPin} title={pinned ? 'Remove goal' : 'Pin as a goal'}>{pinned ? '★' : '☆'}</button></div>
    <div className="companion-card-badges"><StatusPill status={status}>{companionStatusText(entity, status)}</StatusPill>{entity.permanent === true && <span className="companion-tag">Permanent</span>}{entity.system === 'craft' && entity.permanent === false && <span className="companion-tag">Temporary</span>}{entity.platforms?.length ? <span className="companion-tag">{entity.platforms.join(' · ')}</span> : entity.steam ? <span className="companion-tag">Steam</span> : null}</div>
    <p className="companion-card-description">{companionDisplayText(entity.description)}</p>
    {state?.available === false && <div className="companion-blocker"><span aria-hidden="true">◇</span><span>{state.blockers?.join(' · ') || 'Requirements are not met by what you have recorded.'}</span></div>}
    {state?.available === undefined && entity.purchase && <small className="companion-eligibility">What you have recorded does not show whether this is available yet.</small>}
    <fieldset className="companion-card-controls" disabled={busy && entity.system !== 'craft'}><legend className="sr-only">{entity.title}: record and plan</legend>
      {entity.system === 'achievement' && <><ObservationToggle label="Achievement" value={record.completed} onChange={(completed) => onRecord({ completed })} yes="Earned" no="Not earned" />{entity.counterSupported === true && <CounterEditor label="Progress" value={record.count} target={entity.target} onChange={(count) => onRecord({ count })} />}</>}
      {entity.system === 'craft' && <>
        {entity.permanent !== false && <ObservationToggle label="Item ownership" value={record.completed} disabled={busy} onChange={(completed) => onRecord({ completed })} yes="Owned" no="Not owned" />}
        {recipeCosts.length > 0 && <div className="companion-crafting-costs"><span>Cost per craft</span>{recipeCosts.map((cost) => <strong key={cost.unit}><CompactCount value={cost.quantity} unit={cost.unit} /></strong>)}</div>}
        {!!entity.recipe?.length && <div className="companion-recipe"><span>Materials per craft</span><ul>{entity.recipe.filter((ingredient) => lookup.has(`material:${ingredient.materialId}`)).map((ingredient) => { const material = lookup.get(`material:${ingredient.materialId}`)!; return <li key={ingredient.materialId}><span><button type="button" onClick={() => onNavigate('crafting', material.ref)}>{material.title}</button></span><strong>× <CompactCount value={ingredient.quantity} /></strong></li> })}</ul>{entity.recipe.some((ingredient) => !lookup.has(`material:${ingredient.materialId}`)) && <small>Some materials are hidden until you reveal them.</small>}<label className="companion-observation"><span>Planned quantity</span><input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={planDraft} onChange={(event) => setPlanDraft(event.target.value)} aria-label={`Planned quantity for ${entity.title}`} /></label><button type="button" className="companion-plan-button" disabled={!/^\d{1,6}$/.test(planDraft) || BigInt(planDraft || '0').toString() === (planned ?? '0')} onClick={() => onPlan(BigInt(planDraft).toString())}>Update plan</button></div>}
      </>}
      {entity.system === 'material' && <><ObservationToggle label="Material discovery" value={record.discovered} onChange={(discovered) => onRecord({ discovered })} yes="Discovered" no="Not discovered" /><CounterEditor label="Amount held" value={record.count} onChange={(count) => onRecord({ count })} /></>}
      {entity.system === 'quest' && (entity.category === 'Quest packs' ? <ObservationToggle label="Quest pack ownership" value={record.completed} onChange={(completed) => onRecord({ completed })} yes="Owned" no="Not owned" /> : <><CounterEditor label="Progress" value={record.count} target={entity.target} onChange={(count) => onRecord({ count })} /><ObservationToggle label="Objective" value={record.completed} onChange={(completed) => onRecord({ completed, ...(completed === false ? { claimed: false } : {}) })} yes="Complete" no="In progress" /><ObservationToggle label="Reward" value={record.claimed} onChange={(claimed) => onRecord({ claimed, ...(claimed ? { completed: true } : {}) })} yes="Claimed" no="Unclaimed" />{record.completed && record.claimed !== true && <p className="companion-unclaimed">✦ Complete — reward not recorded as claimed</p>}</>)}
      {entity.system === 'village' && <><ObservationToggle label={entity.category === 'Village buildings' ? 'Building progress' : 'Village progress'} value={record.built ?? record.completed} onChange={(value) => onRecord(entity.category === 'Village buildings' ? { built: value } : { completed: value })} yes="Complete" no="In progress" />{entity.target !== undefined && <CounterEditor label="Progress" value={record.count} target={entity.target} onChange={(count) => onRecord({ count })} />}{recipeCosts.length > 0 && <div className="companion-crafting-costs"><span>Cost</span>{recipeCosts.map((cost) => <strong key={cost.unit}><CompactCount value={cost.quantity} unit={cost.unit} /></strong>)}</div>}</>}
      {entity.system === 'enemy' && <><ObservationToggle label="Discovery" value={record.discovered} onChange={(discovered) => onRecord({ discovered })} yes="Discovered" no="Not discovered" /><CounterEditor label="Kills" value={record.count} onChange={(count) => onRecord({ count })} />{!!entity.tiers?.length && <div className="companion-tier-guide"><div className="companion-divinity-facts"><span>Mastery tier</span><strong>{state?.masteryTier === undefined ? 'Unknown' : `Tier ${state.masteryTier}`}</strong></div>{state?.masteryKills !== undefined && <small><CompactCount value={state.masteryKills} /> kills across related evolutions</small>}<span>Mastery thresholds</span><ol>{entity.tiers.map((tier, index) => <li key={tier}><span>Tier {index + 1}</span><strong><CompactCount value={tier} unit={tier === '1' ? 'kill' : 'kills'} /></strong></li>)}</ol>{state?.masteryTier === undefined && <small>Mastery counts kills across related evolutions. Record the kills for each of them to see a tier.</small>}</div>}</>}
      {entity.system === 'divinity' && <><ObservationToggle label="Selected" value={record.selected} onChange={(selected) => onRecord({ selected })} yes="Selected" no="Not selected" /><div className="companion-divinity-facts"><span>Active in game</span><strong>{state?.active === undefined ? 'Unknown' : state.active ? 'Active' : 'Inactive'}</strong></div><div className="companion-divinity-facts"><span>Cost</span><strong>{entity.cost === undefined ? 'Unknown' : <CompactCount value={entity.cost} unit={entity.costUnit ?? 'points'} />}</strong></div></>}
    </fieldset>
    <RelatedLinks title="Gathering sources" refs={entity.sources} lookup={lookup} onNavigate={onNavigate} />
    <RelatedLinks title="Related" refs={entity.related} lookup={lookup} onNavigate={onNavigate} />
    {!!entity.provenance.length && <details className="companion-evidence"><summary>Source & identity</summary><small>Native ID: {entity.id}</small>{entity.provenance.map((source, index) => <small key={index}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a> : source.label}</small>)}</details>}
  </article>
}

export function TrackingNotice({ systems, progress, onTrack, busy }: { systems: readonly CompanionSystem[]; progress: CompanionProgress; onTrack: CompanionModulesProps['onTrack']; busy?: boolean }) {
  const untracked = systems.filter((system) => !progress.modules[system].tracked)
  if (!untracked.length) return <p className="companion-observation-note"><span aria-hidden="true">◉</span> Showing what you have recorded. Entries you have not recorded stay blank, never zero.</p>
  return <div className="companion-tracking-notice"><span className="companion-tracking-symbol" aria-hidden="true">✧</span><div><strong>Tracking not started</strong><p>{untracked.length === systems.length ? 'Nothing is recorded in this section yet.' : 'Part of this section is not tracked yet.'} Import a save or record entries by hand. Entries you have not recorded stay blank, never zero.</p></div>{untracked.map((system) => <button type="button" key={system} disabled={busy} onClick={() => onTrack(system, true)}>{untracked.length === 1 ? 'Start tracking' : `Track ${system === 'craft' ? 'recipes' : system === 'material' ? 'materials' : system === 'quest' ? 'quests' : system === 'village' ? 'Village' : system}`}</button>)}</div>
}

export function ShoppingList({ entities, progress, plans, onNavigate }: { entities: readonly CompanionEntity[]; progress: CompanionProgress; plans: Readonly<Record<string, string>>; onNavigate: CompanionModulesProps['onNavigate'] }) {
  const materials = entities.filter((entity) => entity.system === 'material')
  const lookup = new Map(materials.map((entity) => [entity.id, entity]))
  const stock = Object.fromEntries(materials.map((entity) => [entity.id, getCompanionRecord(progress, 'material', entity.id).count]))
  const lines = companionShoppingList(entities.filter((entity) => entity.system === 'craft'), plans, stock).filter((line) => lookup.has(line.materialId))
  const plannedCrafts = entities.filter((entity) => entity.system === 'craft' && /^\d+$/.test(plans[entity.id] ?? '') && BigInt(plans[entity.id]) > 0n)
  const costs = companionPlannedCosts(plannedCrafts, plans)
  const partial = plannedCrafts.some((entity) => entity.recipe?.some((ingredient) => !lookup.has(ingredient.materialId)))
  return <section className="companion-shopping" aria-labelledby="companion-shopping-title"><div className="companion-subheading"><div><h2 id="companion-shopping-title">Shopping list</h2></div><span className="companion-tag">No materials are spent</span></div>
    <p>Materials needed for your planned recipes, minus your recorded stock. Record stock to calculate what you still need.</p>
    {partial && <p className="companion-blocker">Some materials are hidden until you reveal them, so this list shows only the visible ones and leaves out full totals.</p>}
    {costs.length > 0 && <div className="companion-crafting-costs"><span>Recipe costs</span>{costs.map((cost) => <strong key={cost.unit}><CompactCount value={cost.quantity} unit={cost.unit} /></strong>)}<small>Currency balances are not tracked.</small></div>}
    {!lines.length ? <div className="companion-empty-inline">Set recipe quantities to build a shopping list.</div> : <div className="companion-shopping-table"><table><caption className="sr-only">Crafting shopping list</caption><thead><tr><th>Material</th><th>Needed</th><th>Recorded</th><th>To gather</th></tr></thead><tbody>{lines.map((line) => <tr key={line.materialId}><th scope="row"><button type="button" onClick={() => onNavigate('crafting', { system: 'material', id: line.materialId })}>{lookup.get(line.materialId)!.title}</button></th><td><CompactCount value={line.required} /></td><td>{line.stock === undefined ? 'Unknown' : <CompactCount value={line.stock} />}</td><td>{line.remaining === undefined ? 'Unknown' : BigInt(line.remaining) === 0n ? <span className="companion-stock-ready">✓ Ready</span> : <CompactCount value={line.remaining} />}</td></tr>)}</tbody></table></div>}
  </section>
}

function Overview(props: CompanionModulesProps & { lookup: ReadonlyMap<string, CompanionReferenceEntry> }) {
  const [query, setQuery] = useState('')
  const visibleGoals = props.goalEntries ?? [...props.lookup.values()].filter((entry) => props.pinnedRefs.has(companionRefKey(entry.ref)))
  // First run: nothing tracked, recorded or imported anywhere yet.
  const ascension = props.progress.ascension
  const firstRun = !Object.values(props.progress.modules).some((module) => module.tracked) && !Object.keys(ascension.purchases).length && !Object.keys(ascension.milestones).length && ascension.epoch === 0
  const results = query.trim() ? [...props.lookup.values()].filter((entry) => companionSearchMatches({ title: entry.title, description: entry.description ?? '', category: '' } as CompanionEntity, query)).slice(0, 30) : []
  return <div className="companion-page companion-overview telemetry-private rr-block">
    <header className="companion-page-header"><h1>Overview</h1><p>{firstRun ? 'Track your Idle Slayer progress, goals and next upgrades.' : 'Where you are across every section, from what you have recorded.'}</p></header>
    {firstRun && <section className="companion-start" aria-labelledby="companion-start-title">
      <h2 id="companion-start-title">Start here</h2>
      <p>Your progress stays in this browser. Import a Windows Steam save to fill every section at once, or record as you play.</p>
      <div className="companion-start-actions">{props.onImport && <button type="button" className="primary" onClick={props.onImport}>Import a Windows Steam save</button>}<button type="button" onClick={() => props.onNavigate('ascension')}>Track by hand</button></div>
    </section>}
    {props.ascensionSummary && !firstRun && <section className="companion-next" aria-labelledby="companion-next-title">
      <div><h2 id="companion-next-title">Next suggested upgrade</h2>
        {props.ascensionSummary.next ? <p><strong>{props.ascensionSummary.next.title}</strong> · <SPCost value={props.ascensionSummary.next.cost} /><small>{props.ascensionSummary.next.basis}. Your SP balance is not checked.</small></p>
          : <p>{props.ascensionSummary.status === 'all-owned' ? 'Every visible upgrade is recorded as owned.' : 'No visible upgrade has its requirements met yet.'}</p>}
        <small>Order adapted from <a href={props.ascensionSummary.source.url} target="_blank" rel="noreferrer">{props.ascensionSummary.source.label}</a> ({props.ascensionSummary.source.license}).</small>
      </div>
      {props.ascensionSummary.next && <button type="button" onClick={() => props.onNavigate('ascension', { system: 'ascension', id: props.ascensionSummary!.next!.id })}>Show on map</button>}
    </section>}
    <section className="companion-global-search" aria-label="Search the companion"><label htmlFor="companion-global-query"><span aria-hidden="true">⌕</span><input id="companion-global-query" type="search" placeholder="Find an upgrade, achievement, item, enemy…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search visible companion entries" /></label><div className="companion-search-note"><small>Search follows your current spoiler setting.</small>{props.spoilers && <SpoilerToggle {...props.spoilers} busy={props.busy} />}</div>{query.trim() && <div className="companion-global-results" role="region" aria-label="Search results">{!results.length ? <p>No visible entries match this search.</p> : results.map((entry) => <button type="button" key={companionRefKey(entry.ref)} onClick={() => { props.onNavigate(sectionForSystem[entry.ref.system], entry.ref); setQuery('') }}><span><strong>{entry.title}</strong><small>{companionSystemLabels[entry.ref.system]}</small></span><span aria-hidden="true">↗</span></button>)}{results.length === 30 && <small>Showing the first 30 matches. Refine your search to find a specific entry.</small>}</div>}</section>
    <section className="companion-goals-section" aria-labelledby="companion-goals-title"><div className="companion-subheading"><div><h2 id="companion-goals-title">Goals</h2></div><span className="companion-tag">Goals do not change progress</span></div>{!visibleGoals.length ? <div className="companion-empty-goals"><span aria-hidden="true">☆</span><div><h3>No goals pinned</h3><p>Use the star on an entry to pin it here. Pinning does not record progress.</p></div></div> : <div className="companion-goal-list">{visibleGoals.map((entry) => <div className="companion-goal" key={companionRefKey(entry.ref)}><button type="button" className="companion-goal-open" onClick={() => props.onNavigate(sectionForSystem[entry.ref.system], entry.ref)}><span aria-hidden="true">✦</span><span><strong>{entry.title}</strong><small>{goalStatusLabel(entry.status) ?? companionSystemLabels[entry.ref.system]}</small></span><span aria-hidden="true">↗</span></button><button type="button" onClick={() => props.onPinGoal(entry.ref)} aria-label={`Remove ${entry.title} from goals`}>×</button></div>)}</div>}</section>
    {props.ultraAscension && <section className="companion-ultra" aria-labelledby="companion-ultra-title"><div><h2 id="companion-ultra-title">Ultra Ascension</h2><p>{companionPlural(props.ultraAscension.count, 'Ultra Ascension')} recorded.</p></div><div><button type="button" disabled={props.busy} onClick={props.ultraAscension.onRecord}>Record Ultra Ascension…</button>{!props.ultraAscension.eligible && <small>Requirements not met yet; the review shows what is missing.</small>}</div></section>}
    <section className="companion-journey-grid" aria-label="Explore companion sections">{companionSections.filter((section) => section.id !== 'overview').map((section) => {
      const systems = section.id === 'ascension' ? [] : systemsForSection[section.id]
      const visible = props.entities.filter((entity) => systems.includes(entity.system))
      const observed = visible.filter((entity) => companionRecordedStatus(entity, getCompanionRecord(props.progress, entity.system, entity.id)) !== 'unknown').length
      const tracked = systems.some((system) => props.progress.modules[system].tracked)
      // "X of Y" over the visible entries only; Y never counts entries hidden by the reveal rules.
      const countable = section.id === 'crafting' ? visible.filter((entity) => entity.system === 'craft') : visible
      const complete = countable.filter((entity) => companionRecordedStatus(entity, getCompanionRecord(props.progress, entity.system, entity.id)) === 'complete').length
      const word = section.id === 'achievements' ? 'earned' : section.id === 'crafting' ? 'items owned' : section.id === 'quests' ? 'claimed or complete' : section.id === 'bestiary' ? 'discovered' : 'selected'
      const summary = section.id === 'ascension' ? props.ascensionSummary && { done: props.ascensionSummary.owned, total: props.ascensionSummary.total, text: `${props.ascensionSummary.owned.toLocaleString('en')} of ${props.ascensionSummary.total.toLocaleString('en')} visible upgrades owned · ${companionPlural(props.ultraAscension?.count ?? props.progress.ascension.epoch, 'Ultra Ascension')}` }
        : tracked ? { done: complete, total: countable.length, text: countable.length ? `${complete.toLocaleString('en')} of ${countable.length.toLocaleString('en')} ${word}` : 'Nothing visible yet' } : null
      return <button type="button" className="companion-journey-card" key={section.id} onClick={() => props.onNavigate(section.id)}><span className="companion-journey-symbol" aria-hidden="true">{section.symbol}</span><span className="companion-journey-name">{section.title}</span><span className="companion-journey-description">{section.description}</span>
        {summary && summary.total > 0 && <span className="companion-journey-bar" aria-hidden="true"><span style={{ width: `${Math.round(summary.done * 100 / summary.total)}%` }} /></span>}
        <span className="companion-journey-footer">{summary ? summary.text : section.id === 'ascension' ? 'Open map' : 'Not tracked yet'}{tracked && section.id !== 'ascension' && observed > complete && <small>{companionPlural(observed, 'entry', 'entries')} recorded</small>}<span aria-hidden="true">↗</span></span></button>
    })}</section>
    <aside className="companion-observation-ledger"><span className="companion-eyebrow">Progress records</span><p>Progress is stored in this browser. Manual edits do not spend materials or award rewards. Import a save to update your records.</p><div>{Object.entries(props.progress.modules).filter(([, value]) => value.tracked).map(([system, value]) => <span className="companion-tag" key={system}>{companionSystemLabels[system as CompanionSystem] ?? system}: {value.source === 'save' ? 'imported' : value.source === 'reset' ? 'updated by Ultra Ascension' : value.source === 'manual' ? 'recorded by hand' : 'tracking started'}{value.observedAt && Number.isFinite(Date.parse(value.observedAt)) ? ` · ${new Date(value.observedAt).toLocaleDateString()}` : ''}</span>)}</div></aside>
  </div>
}

export function CompanionModules(props: CompanionModulesProps) {
  const { section, entities, progress } = props
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [category, setCategory] = useState('all')
  const [platform, setPlatform] = useState('all')
  const [subsystem, setSubsystem] = useState<CompanionSystem | 'all'>('all')
  const [limit, setLimit] = useState(24)
  const lookup = useMemo(() => new Map([...entities.map((entity): CompanionReferenceEntry => ({ ref: { system: entity.system, id: entity.id }, title: entity.title, description: entity.description })), ...(props.referenceEntries ?? [])].map((entry) => [companionRefKey(entry.ref), entry])), [entities, props.referenceEntries])
  useEffect(() => { setQuery(''); setFilter('all'); setCategory('all'); setPlatform('all'); setSubsystem('all'); setLimit(24) }, [section])
  useEffect(() => { setLimit(24) }, [query, filter, category, subsystem, platform])
  useEffect(() => {
    if (!props.focusedRef || sectionForSystem[props.focusedRef.system] !== section || props.focusedRef.system === 'ascension') return
    // A reference reveals neither an identity nor its position unless it is in this visible projection.
    const target = entities.find((entity) => entity.system === props.focusedRef!.system && entity.id === props.focusedRef!.id)
    if (!target) return
    setQuery(target.title); setCategory('all'); setFilter('all'); setPlatform('all'); setSubsystem('all'); setLimit(24)
    const frame = requestAnimationFrame(() => { const element = document.getElementById(`companion-entity-${target.system}-${target.id}`); element?.scrollIntoView({ block: 'center', behavior: 'instant' }); element?.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(frame)
  }, [props.focusedRef, section, entities])
  if (section === 'overview') return <Overview {...props} lookup={lookup} />
  const systems = systemsForSection[section]
  const sectionEntities = entities.filter((entity) => systems.includes(entity.system)).sort((left, right) => systems.indexOf(left.system) - systems.indexOf(right.system))
  const categories = [...new Set(sectionEntities.map((entity) => entity.category).filter(Boolean))].sort()
  const platforms = [...new Set(sectionEntities.flatMap((entity) => entity.platforms ?? (entity.steam ? ['Steam'] : [])))].sort()
  const filtered = sectionEntities.filter((entity) => {
    if (subsystem !== 'all' && entity.system !== subsystem) return false
    if (category !== 'all' && entity.category !== category) return false
    if (platform !== 'all' && !(entity.platforms ?? (entity.steam ? ['Steam'] : [])).includes(platform)) return false
    if (!companionSearchMatches(entity, query)) return false
    if (filter === 'pinned') return props.pinnedRefs.has(companionRefKey(entity))
    return filter === 'all' || companionRecordedStatus(entity, getCompanionRecord(progress, entity.system, entity.id)) === filter
  })
  const copy = sectionCopy[section]
  const complete = sectionEntities.filter((entity) => companionRecordedStatus(entity, getCompanionRecord(progress, entity.system, entity.id)) === 'complete').length
  const observed = sectionEntities.filter((entity) => companionRecordedStatus(entity, getCompanionRecord(progress, entity.system, entity.id)) !== 'unknown').length
  const wishlist = sectionEntities.filter((entity) => props.pinnedRefs.has(companionRefKey(entity)))
  const wishlistUnits = [...new Set(wishlist.map((entity) => entity.costUnit ?? 'points'))]
  const wishlistCost = wishlistUnits.length > 1 ? null : companionExactSum(wishlist.map((entity) => entity.cost))
  return <div className="companion-page telemetry-private rr-block">
    <header className="companion-page-header companion-page-header-module"><h1>{copy.title}</h1><p>{copy.description}</p><div className="companion-section-stats"><span><strong>{observed}</strong> recorded</span>{section !== 'crafting' && <span><strong>{complete}</strong> {section === 'bestiary' ? 'discovered' : section === 'divinities' ? 'selected' : section === 'quests' ? 'claimed / complete' : 'earned'}</span>}<small>Visible entries only · blank entries are not counted as incomplete</small></div></header>
    {sectionEntities.length > 0 && <TrackingNotice systems={systems} progress={progress} onTrack={props.onTrack} busy={props.busy} />}
    {section === 'crafting' && <ShoppingList entities={entities} progress={progress} plans={props.recipePlans} onNavigate={props.onNavigate} />}
    {section === 'divinities' && <section className="companion-wishlist" aria-label="Divinity goals"><span aria-hidden="true">☆</span><div><h2>Divinity goals</h2><p>{wishlist.length ? <>{companionPlural(wishlist.length, 'visible power')} pinned · {wishlistCost === null ? 'Combined cost unknown' : <><CompactCount value={wishlistCost} unit={wishlistUnits[0] ?? 'points'} /> listed cost</>}</> : 'Pin powers with the star to make them goals.'}</p><small>Listed costs only. Your balance is not tracked.</small></div></section>}
    <section className="companion-browser" aria-label={`Browse ${copy.title}`}>
      <div className="companion-browser-toolbar"><label className="companion-module-search"><span aria-hidden="true">⌕</span><input type="search" placeholder={`Search visible ${section === 'quests' ? 'quests and Village entries' : copy.title.toLowerCase()}…`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`Search visible ${copy.title.toLowerCase()}`} /></label>{systems.length > 1 && <label className="companion-filter-label">Show<select value={subsystem} onChange={(event) => setSubsystem(event.target.value as CompanionSystem | 'all')}><option value="all">All types</option>{systems.map((system) => <option key={system} value={system}>{({ craft: 'Recipes', material: 'Materials', quest: 'Quests', village: 'Village' } as Record<string, string>)[system] ?? system}</option>)}</select></label>}{categories.length > 1 && <label className="companion-filter-label">Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}{platforms.length > 1 && <label className="companion-filter-label">Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">All platforms</option>{platforms.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}</div>
      <div className="companion-filter-row">{props.spoilers && <SpoilerToggle {...props.spoilers} busy={props.busy} />}<div className="companion-filter-chips" role="group" aria-label="Recorded status filter">{[['all', 'All visible'], ['unknown', 'Not recorded'], ['incomplete', section === 'bestiary' ? 'Not discovered' : section === 'divinities' ? 'Not selected' : 'Incomplete'], ['complete', section === 'bestiary' ? 'Discovered' : section === 'divinities' ? 'Selected' : 'Complete'], ['pinned', '★ Goals']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="companion-result-count" role="status">{companionPlural(filtered.length, 'visible entry', 'visible entries')}</span></div>
      {!filtered.length ? sectionEntities.length
        ? <div className="companion-empty-state"><span aria-hidden="true">◇</span><h2>No visible entries match.</h2><p>Try another search or filter.</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); setCategory('all'); setPlatform('all'); setSubsystem('all') }}>Clear filters</button></div>
        // Entries here are revealed as they are recorded. The only way to browse them all is the one shared spoiler setting.
        : <div className="companion-empty-state"><span aria-hidden="true">◇</span><h2>Nothing revealed here yet</h2><p>Entries here appear once you record them, following the game’s reveal rules.{props.spoilers && !props.spoilers.shown ? ' To track by hand now, show all entries. This turns on spoilers everywhere, including the Ascension map.' : ''}</p><div className="companion-empty-actions">{props.spoilers && !props.spoilers.shown && <button type="button" className="primary" disabled={props.busy} onClick={() => props.spoilers!.onChange(true)}>Show all entries</button>}{props.onImport && <button type="button" onClick={props.onImport}>Import a save</button>}</div></div> : <div className="companion-entity-grid">{filtered.slice(0, limit).map((entity) => <EntityCard key={companionRefKey(entity)} entity={entity} record={getCompanionRecord(progress, entity.system, entity.id)} pinned={props.pinnedRefs.has(companionRefKey(entity))} onPin={() => props.onPinGoal({ system: entity.system, id: entity.id })} onRecord={(patch) => props.onRecord(entity.system, entity.id, patch)} planned={props.recipePlans[entity.id]} onPlan={(quantity) => props.onRecipePlan(entity.id, quantity)} state={props.entityStates?.[companionRefKey(entity)]} lookup={lookup} onNavigate={props.onNavigate} busy={props.busy} />)}</div>}
      {filtered.length > limit && <button className="companion-load-more" type="button" onClick={() => setLimit(limit + 24)}>Show more entries ({Math.min(24, filtered.length - limit)} more)</button>}
    </section>
  </div>
}
