import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CompanionEntity, CompanionEntityRef, CompanionProgress, CompanionRecord, CompanionSystem } from './domain/companion-types'
import { getCompanionRecord } from './domain/companion-progress'
import { companionExactSum, companionPlannedCosts, companionRecordedStatus, companionRefKey, companionSearchMatches, companionShoppingList, counterPercent } from './companion-view-model'
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
  divinities: { title: 'Divinities', description: 'Track selected Divinities and wishlist costs.' },
}
const numberFormat = new Intl.NumberFormat('en')
const formatCount = (value: string) => /^\d+$/.test(value) ? numberFormat.format(BigInt(value)) : value
const goalStatusLabel = (value?: string) => value === 'untracked' ? 'Not recorded' : value === 'incomplete' ? 'In progress' : value === 'complete' ? 'Complete' : value

export function EntityIcon({ entity, large = false }: { entity: CompanionEntity; large?: boolean }) {
  const symbol = { achievement: '♜', craft: '⚒', material: '◆', quest: '⚑', village: '⌂', enemy: '♞', divinity: '☼' }[entity.system]
  return <span className={`companion-entity-icon${large ? ' companion-entity-icon-large' : ''}`} aria-hidden="true">
    {entity.icon ? <img src={`${import.meta.env.BASE_URL}${entity.icon.replace(/^\//, '')}`} alt="" loading="lazy" /> : symbol}
  </span>
}

export function StatusPill({ status, children }: { status?: string; children: ReactNode }) {
  return <span className={`companion-status-pill companion-status-${status ?? 'unknown'}`}>{children}</span>
}

export function ObservationSelect({ label, value, onChange, yes = 'Recorded', no = 'Not yet', disabled }: { label: string; value?: boolean; onChange: (value: boolean) => void; yes?: string; no?: string; disabled?: boolean }) {
  const id = useId()
  return <label className="companion-observation" htmlFor={id}><span>{label}</span><select id={id} disabled={disabled} value={value === undefined ? '' : value ? 'yes' : 'no'} onChange={(event) => { if (event.target.value) onChange(event.target.value === 'yes') }}><option value="" disabled>Not recorded</option><option value="no">{no}</option><option value="yes">{yes}</option></select></label>
}

export function CounterEditor({ label, value, target, onChange }: { label: string; value?: string; target?: string; onChange: (value: string) => void }) {
  const id = useId()
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const valid = /^\d{1,80}$/.test(draft)
  const percent = counterPercent(value, target)
  return <div className="companion-counter">
    <label htmlFor={id}>{label}{target !== undefined && <small>Target: {formatCount(target)}</small>}</label>
    <div className="companion-counter-input"><input id={id} inputMode="numeric" pattern="[0-9]*" maxLength={80} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Not recorded" /><button type="button" disabled={!valid || draft === value} onClick={() => onChange(BigInt(draft).toString())}>Record</button></div>
    {draft && !valid && <small role="status">Use a whole number, zero or greater.</small>}
    {percent !== null && <div className="companion-counter-progress"><progress value={percent} max={100} aria-label={`${label}: ${percent}% of target`} /><small>{percent}%</small></div>}
  </div>
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
  const labels = entity.system === 'quest' && entity.category === 'Quest packs' ? ['Owned', 'Not owned'] : { achievement: ['Earned', 'Not earned'], craft: ['Owned', 'Not owned'], material: ['Recorded', 'Recorded'], quest: ['Claimed', 'Not claimed'], village: ['Complete', 'In progress'], enemy: ['Discovered', 'Not discovered'], divinity: ['Selected', 'Not selected'] }[entity.system]
  const itemId = `companion-entity-${entity.system}-${entity.id}`
  const recipeCosts = companionPlannedCosts([entity], { [entity.id]: '1' })
  return <article className={`companion-entity-card companion-entity-${status}`} id={itemId} tabIndex={-1} ref={card}>
    <div className="companion-card-heading"><EntityIcon entity={entity} /><div><span className="companion-eyebrow">{entity.category || entity.system}</span><h3>{entity.title}</h3></div><button type="button" className="companion-pin" aria-label={`${pinned ? 'Remove' : 'Pin'} ${entity.title} ${pinned ? 'from' : 'as'} a goal`} aria-pressed={pinned} onClick={onPin} title={pinned ? 'Remove goal' : 'Pin a goal'}>{pinned ? '★' : '☆'}</button></div>
    <div className="companion-card-badges"><StatusPill status={status}>{status === 'unknown' ? 'Not recorded' : labels[status === 'complete' ? 0 : 1]}</StatusPill>{entity.permanent === true && <span className="companion-tag">Permanent</span>}{entity.system === 'craft' && entity.permanent === false && <span className="companion-tag">Temporary</span>}{entity.platforms?.length ? <span className="companion-tag">{entity.platforms.join(' · ')}</span> : entity.steam ? <span className="companion-tag">Steam</span> : null}</div>
    <p className="companion-card-description">{entity.description}</p>
    {state?.available === false && <div className="companion-blocker"><span aria-hidden="true">◇</span><span>{state.blockers?.join(' · ') || 'Requirements are not yet met in your recorded progress.'}</span></div>}
    {state?.available === undefined && entity.purchase && <small className="companion-eligibility">Eligibility is not established by your recorded progress.</small>}
    <fieldset className="companion-card-controls" disabled={busy && entity.system !== 'craft'}><legend className="sr-only">{entity.title} observations and plans</legend>
      {entity.system === 'achievement' && <><ObservationSelect label="Achievement" value={record.completed} onChange={(completed) => onRecord({ completed })} yes="Earned" no="Not earned" />{entity.counterSupported === true && <CounterEditor label="Recorded progress" value={record.count} target={entity.target} onChange={(count) => onRecord({ count })} />}</>}
      {entity.system === 'craft' && <>
        {entity.permanent !== false && <ObservationSelect label="Item ownership" value={record.completed} disabled={busy} onChange={(completed) => onRecord({ completed })} yes="Owned" no="Not owned" />}
        {recipeCosts.length > 0 && <div className="companion-crafting-costs"><span>Currency per craft</span>{recipeCosts.map((cost) => <strong key={cost.unit}>{formatCount(cost.quantity)} {cost.unit}</strong>)}</div>}
        {!!entity.recipe?.length && <div className="companion-recipe"><span>Recipe per craft</span><ul>{entity.recipe.filter((ingredient) => lookup.has(`material:${ingredient.materialId}`)).map((ingredient) => { const material = lookup.get(`material:${ingredient.materialId}`)!; return <li key={ingredient.materialId}><span><button type="button" onClick={() => onNavigate('crafting', material.ref)}>{material.title}</button></span><strong>× {formatCount(ingredient.quantity)}</strong></li> })}</ul>{entity.recipe.some((ingredient) => !lookup.has(`material:${ingredient.materialId}`)) && <small>The complete recipe is outside your current revealed view.</small>}<label className="companion-observation"><span>Planned quantity</span><input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={planDraft} onChange={(event) => setPlanDraft(event.target.value)} aria-label={`Planned quantity for ${entity.title}`} /></label><button type="button" className="companion-plan-button" disabled={!/^\d{1,6}$/.test(planDraft) || BigInt(planDraft || '0').toString() === (planned ?? '0')} onClick={() => onPlan(BigInt(planDraft).toString())}>Update plan</button></div>}
      </>}
      {entity.system === 'material' && <><ObservationSelect label="Material discovery" value={record.discovered} onChange={(discovered) => onRecord({ discovered })} yes="Discovered" no="Not discovered" /><CounterEditor label="Recorded inventory" value={record.count} onChange={(count) => onRecord({ count })} /></>}
      {entity.system === 'quest' && (entity.category === 'Quest packs' ? <ObservationSelect label="Quest pack ownership" value={record.completed} onChange={(completed) => onRecord({ completed })} yes="Owned" no="Not owned" /> : <><CounterEditor label="Recorded progress" value={record.count} target={entity.target} onChange={(count) => onRecord({ count })} /><ObservationSelect label="Objective" value={record.completed} onChange={(completed) => onRecord({ completed, ...(completed === false ? { claimed: false } : {}) })} yes="Complete" no="In progress" /><ObservationSelect label="Reward" value={record.claimed} onChange={(claimed) => onRecord({ claimed, ...(claimed ? { completed: true } : {}) })} yes="Claimed" no="Unclaimed" />{record.completed && record.claimed !== true && <p className="companion-unclaimed">✦ Complete — reward not recorded as claimed</p>}</>)}
      {entity.system === 'village' && <><ObservationSelect label={entity.category === 'Village buildings' ? 'Building progress' : 'Village progress'} value={record.built ?? record.completed} onChange={(value) => onRecord(entity.category === 'Village buildings' ? { built: value } : { completed: value })} yes="Complete" no="In progress" />{entity.target !== undefined && <CounterEditor label="Recorded progress" value={record.count} target={entity.target} onChange={(count) => onRecord({ count })} />}{recipeCosts.length > 0 && <div className="companion-crafting-costs"><span>Native currency requirements</span>{recipeCosts.map((cost) => <strong key={cost.unit}>{formatCount(cost.quantity)} {cost.unit}</strong>)}</div>}</>}
      {entity.system === 'enemy' && <><ObservationSelect label="Discovery" value={record.discovered} onChange={(discovered) => onRecord({ discovered })} yes="Discovered" no="Not discovered" /><CounterEditor label="Recorded kills" value={record.count} onChange={(count) => onRecord({ count })} />{!!entity.tiers?.length && <div className="companion-tier-guide"><div className="companion-divinity-facts"><span>Native mastery</span><strong>{state?.masteryTier === undefined ? 'Not established' : `Tier ${state.masteryTier}`}</strong></div>{state?.masteryKills !== undefined && <small>{formatCount(state.masteryKills)} recorded family kills</small>}<span>Native mastery thresholds</span><ol>{entity.tiers.map((tier, index) => <li key={tier}><span>Tier {index + 1}</span><strong>{formatCount(tier)} kills</strong></li>)}</ol>{state?.masteryTier === undefined && <small>Native mastery aggregates related evolutions. Record all required kill counters to establish a tier.</small>}</div>}</>}
      {entity.system === 'divinity' && <><ObservationSelect label="Power selection / ownership" value={record.selected} onChange={(selected) => onRecord({ selected })} yes="Selected / owned" no="Not selected / owned" /><div className="companion-divinity-facts"><span>Effective activity</span><strong>{state?.active === undefined ? 'Not established' : state.active ? 'Active' : 'Inactive'}</strong></div><div className="companion-divinity-facts"><span>Native cost</span><strong>{entity.cost === undefined ? 'Not established' : `${formatCount(entity.cost)} ${entity.costUnit ?? 'points'}`}</strong></div></>}
    </fieldset>
    <RelatedLinks title="Gathering sources" refs={entity.sources} lookup={lookup} onNavigate={onNavigate} />
    <RelatedLinks title="Related" refs={entity.related} lookup={lookup} onNavigate={onNavigate} />
    {!!entity.provenance.length && <details className="companion-evidence"><summary>Source & identity</summary><small>Native ID: {entity.id}</small>{entity.provenance.map((source, index) => <small key={index}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a> : source.label}</small>)}</details>}
  </article>
}

export function TrackingNotice({ systems, progress, onTrack, busy }: { systems: readonly CompanionSystem[]; progress: CompanionProgress; onTrack: CompanionModulesProps['onTrack']; busy?: boolean }) {
  const untracked = systems.filter((system) => !progress.modules[system].tracked)
  if (!untracked.length) return <p className="companion-observation-note"><span aria-hidden="true">◉</span> Your recorded observations. Unknown values stay unknown until you record them.</p>
  return <div className="companion-tracking-notice"><span className="companion-tracking-symbol" aria-hidden="true">✧</span><div><strong>Tracking not started</strong><p>{untracked.length === systems.length ? 'This section has no recorded baseline yet.' : 'Some records in this section have no baseline yet.'} Import a supported save or record individual observations. Nothing is assumed incomplete or zero.</p></div>{untracked.map((system) => <button type="button" key={system} disabled={busy} onClick={() => onTrack(system, true)}>{untracked.length === 1 ? 'Start tracking' : `Track ${system === 'craft' ? 'recipes' : system === 'material' ? 'materials' : system === 'quest' ? 'quests' : system === 'village' ? 'Village' : system}`}</button>)}</div>
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
    {partial && <p className="companion-blocker">Some requirements are outside your revealed view. This list shows visible material requirements; complete material totals are withheld.</p>}
    {costs.length > 0 && <div className="companion-crafting-costs"><span>Recipe costs</span>{costs.map((cost) => <strong key={cost.unit}>{formatCount(cost.quantity)} {cost.unit}</strong>)}<small>Currency balances are not tracked.</small></div>}
    {!lines.length ? <div className="companion-empty-inline">Set recipe quantities to build a shopping list.</div> : <div className="companion-shopping-table"><table><caption className="sr-only">Crafting shopping list</caption><thead><tr><th>Material</th><th>Needed</th><th>Recorded</th><th>To gather</th></tr></thead><tbody>{lines.map((line) => <tr key={line.materialId}><th scope="row"><button type="button" onClick={() => onNavigate('crafting', { system: 'material', id: line.materialId })}>{lookup.get(line.materialId)!.title}</button></th><td>{formatCount(line.required)}</td><td>{line.stock === undefined ? 'Unknown' : formatCount(line.stock)}</td><td>{line.remaining === undefined ? 'Unknown' : BigInt(line.remaining) === 0n ? <span className="companion-stock-ready">✓ Ready</span> : formatCount(line.remaining)}</td></tr>)}</tbody></table></div>}
  </section>
}

function Overview(props: CompanionModulesProps & { lookup: ReadonlyMap<string, CompanionReferenceEntry> }) {
  const [query, setQuery] = useState('')
  const visibleGoals = props.goalEntries ?? [...props.lookup.values()].filter((entry) => props.pinnedRefs.has(companionRefKey(entry.ref)))
  const results = query.trim() ? [...props.lookup.values()].filter((entry) => companionSearchMatches({ title: entry.title, description: entry.description ?? '', category: '' } as CompanionEntity, query)).slice(0, 30) : []
  return <div className="companion-page companion-overview telemetry-private rr-block">
    <header className="companion-page-header"><h1>Overview</h1><p>Record progress manually or import a game save.</p></header>
    <section className="companion-global-search" aria-label="Search the companion"><label htmlFor="companion-global-query"><span aria-hidden="true">⌕</span><input id="companion-global-query" type="search" placeholder="Find an upgrade, achievement, item, enemy…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search visible companion entries" /></label><small>Search follows your current spoiler setting.</small>{query.trim() && <div className="companion-global-results" role="region" aria-label="Search results">{!results.length ? <p>No visible entries match this search.</p> : results.map((entry) => <button type="button" key={companionRefKey(entry.ref)} onClick={() => { props.onNavigate(sectionForSystem[entry.ref.system], entry.ref); setQuery('') }}><span><strong>{entry.title}</strong><small>{entry.ref.system}</small></span><span aria-hidden="true">↗</span></button>)}{results.length === 30 && <small>Showing the first 30 matches. Refine your search to find a specific entry.</small>}</div>}</section>
    <section className="companion-goals-section" aria-labelledby="companion-goals-title"><div className="companion-subheading"><div><h2 id="companion-goals-title">Goals</h2></div><span className="companion-tag">Goals do not change progress</span></div>{!visibleGoals.length ? <div className="companion-empty-goals"><span aria-hidden="true">☆</span><div><h3>No goals pinned</h3><p>Use the star on an entry to pin it here. Pinning does not record progress.</p></div></div> : <div className="companion-goal-list">{visibleGoals.map((entry) => <div className="companion-goal" key={companionRefKey(entry.ref)}><button type="button" className="companion-goal-open" onClick={() => props.onNavigate(sectionForSystem[entry.ref.system], entry.ref)}><span aria-hidden="true">✦</span><span><strong>{entry.title}</strong><small>{goalStatusLabel(entry.status) ?? entry.ref.system}</small></span><span aria-hidden="true">↗</span></button><button type="button" onClick={() => props.onPinGoal(entry.ref)} aria-label={`Remove ${entry.title} from goals`}>×</button></div>)}</div>}</section>
    <section className="companion-journey-grid" aria-label="Explore companion sections">{companionSections.filter((section) => section.id !== 'overview').map((section) => {
      const systems = section.id === 'ascension' ? [] : systemsForSection[section.id]
      const visible = props.entities.filter((entity) => systems.includes(entity.system))
      const observed = visible.filter((entity) => companionRecordedStatus(entity, getCompanionRecord(props.progress, entity.system, entity.id)) !== 'unknown').length
      const tracked = systems.some((system) => props.progress.modules[system].tracked)
      return <button type="button" className="companion-journey-card" key={section.id} onClick={() => props.onNavigate(section.id)}><span className="companion-journey-symbol" aria-hidden="true">{section.symbol}</span><span className="companion-journey-name">{section.title}</span><span className="companion-journey-description">{section.description}</span><span className="companion-journey-footer">{section.id === 'ascension' ? 'Open map' : !tracked ? 'Not tracked' : `${observed} visible entries recorded`}<span aria-hidden="true">↗</span></span></button>
    })}</section>
    <aside className="companion-observation-ledger"><span className="companion-eyebrow">Progress records</span><p>Progress is stored in this browser. Manual edits do not spend materials or award rewards. Import a save to update your records.</p><div>{Object.entries(props.progress.modules).filter(([, value]) => value.tracked).map(([system, value]) => <span className="companion-tag" key={system}>{system}: {value.source === 'save' ? 'imported' : value.source === 'reset' ? 'reset recorded' : value.source === 'manual' ? 'manually recorded' : 'baseline not recorded'}{value.observedAt && Number.isFinite(Date.parse(value.observedAt)) ? ` · ${new Date(value.observedAt).toLocaleDateString()}` : ''}</span>)}</div></aside>
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
    <header className="companion-page-header companion-page-header-module"><h1>{copy.title}</h1><p>{copy.description}</p><div className="companion-section-stats"><span><strong>{observed}</strong> recorded</span>{section !== 'crafting' && <span><strong>{complete}</strong> {section === 'bestiary' ? 'discovered' : section === 'divinities' ? 'selected' : section === 'quests' ? 'claimed / complete' : 'earned'}</span>}<small>Visible entries only · unknown values are not counted as incomplete</small></div></header>
    <TrackingNotice systems={systems} progress={progress} onTrack={props.onTrack} busy={props.busy} />
    {section === 'crafting' && <ShoppingList entities={entities} progress={progress} plans={props.recipePlans} onNavigate={props.onNavigate} />}
    {section === 'divinities' && <section className="companion-wishlist" aria-label="Divinity wishlist"><span aria-hidden="true">☆</span><div><h2>Divinity wishlist</h2><p>{wishlist.length ? `${wishlist.length} visible ${wishlist.length === 1 ? 'power' : 'powers'} pinned · ${wishlistCost === null ? 'Combined cost not established' : `${formatCount(wishlistCost)} ${wishlistUnits[0] ?? 'points'} catalog cost`}` : 'Pin powers to add them to your wishlist.'}</p><small>Listed costs only. Your balance is not tracked.</small></div></section>}
    <section className="companion-browser" aria-label={`Browse ${copy.title}`}>
      <div className="companion-browser-toolbar"><label className="companion-module-search"><span aria-hidden="true">⌕</span><input type="search" placeholder={`Search visible ${section === 'quests' ? 'quests and Village entries' : copy.title.toLowerCase()}…`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`Search visible ${copy.title.toLowerCase()}`} /></label>{systems.length > 1 && <label className="companion-filter-label">Show<select value={subsystem} onChange={(event) => setSubsystem(event.target.value as CompanionSystem | 'all')}><option value="all">All types</option>{systems.map((system) => <option key={system} value={system}>{({ craft: 'Recipes', material: 'Materials', quest: 'Quests', village: 'Village' } as Record<string, string>)[system] ?? system}</option>)}</select></label>}{categories.length > 1 && <label className="companion-filter-label">Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}{platforms.length > 1 && <label className="companion-filter-label">Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">All platforms</option>{platforms.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}</div>
      <div className="companion-filter-row"><div className="companion-filter-chips" role="group" aria-label="Recorded status filter">{[['all', 'All visible'], ['unknown', 'Not recorded'], ['incomplete', section === 'bestiary' ? 'Not discovered' : section === 'divinities' ? 'Not selected' : 'Incomplete'], ['complete', section === 'bestiary' ? 'Discovered' : section === 'divinities' ? 'Selected' : 'Complete'], ['pinned', '★ Goals']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="companion-result-count" role="status">{filtered.length} visible {filtered.length === 1 ? 'entry' : 'entries'}</span></div>
      {!filtered.length ? <div className="companion-empty-state"><span aria-hidden="true">◇</span><h2>{sectionEntities.length ? 'No visible entries match.' : 'Nothing revealed here yet.'}</h2><p>{sectionEntities.length ? 'Try another search or filter.' : 'Record your progress or import a supported save. New entries follow the reviewed game reveal rules.'}</p>{sectionEntities.length > 0 && <button type="button" onClick={() => { setQuery(''); setFilter('all'); setCategory('all'); setPlatform('all'); setSubsystem('all') }}>Clear filters</button>}</div> : <div className="companion-entity-grid">{filtered.slice(0, limit).map((entity) => <EntityCard key={companionRefKey(entity)} entity={entity} record={getCompanionRecord(progress, entity.system, entity.id)} pinned={props.pinnedRefs.has(companionRefKey(entity))} onPin={() => props.onPinGoal({ system: entity.system, id: entity.id })} onRecord={(patch) => props.onRecord(entity.system, entity.id, patch)} planned={props.recipePlans[entity.id]} onPlan={(quantity) => props.onRecipePlan(entity.id, quantity)} state={props.entityStates?.[companionRefKey(entity)]} lookup={lookup} onNavigate={props.onNavigate} busy={props.busy} />)}</div>}
      {filtered.length > limit && <button className="companion-load-more" type="button" onClick={() => setLimit(limit + 24)}>Show more entries ({Math.min(24, filtered.length - limit)} more)</button>}
    </section>
  </div>
}
