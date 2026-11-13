import { useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import { visibility, satisfies } from './domain/rules'
import { discoverUpgrades } from './domain/discovery'
import type { GoalMode } from './domain/goals'
import type { RouteRequirement, RouteProblem } from './domain/prerequisite-routes'
import { ROADMAP_PLAN_LIMIT, ROADMAP_STAGE_LIMIT, editRoadmapStage, emptyRoadmapStage, intendRoadmapRoute, simulateRoadmap, type RoadmapPlan, type RoadmapStage, type RoadmapStageResult } from './domain/ua-roadmap'
import { SPCost } from './SPCost'
import './UARoadmapPanel.css'

type Scope = ReturnType<typeof visibility>
const reasons = {
  previous: 'Unavailable until the preceding stage and boundary are proved.', choice: 'Choose an intended route explicitly before continuing this sequence.',
  route: 'This route is incomplete. Review the listed gates; later stages and full totals are withheld.', native: 'The native purchase order or completion gate could not be proved.',
  eligibility: 'The native Ultra Ascension prerequisite is not yet proved for this stage. Include its visible missing purchases as targets before this boundary.',
  epoch: 'Another Ultra Ascension cannot be represented at the maximum supported counter.', limit: 'A planning limit was reached. Later stages and full totals are withheld.', targets: 'A target is unavailable within the original current-viewer scope.' }

export function UARoadmapPanel({ catalog, profile, getProfile, initialId }: { catalog: Catalog; profile: Profile; getProfile: () => Profile; initialId?: string }) {
  const visible = useMemo(() => visibility(catalog, profile), [catalog, profile])
  const [workspace, setWorkspace] = useState<{ plans: RoadmapPlan[]; active: number }>(() => ({ plans: [{ name: '', stages: [{ ...emptyRoadmapStage(), targets: initialId && visible.ids.has(initialId) ? [{ id: initialId, mode: 'acquire' }] : [] }] }], active: 0 }))
  const { plans, active } = workspace
  const panel = useRef<HTMLElement>(null), frame = useRef<number | undefined>(undefined)
  const results = useMemo(() => plans.map((plan) => simulateRoadmap(catalog, profile, plan)), [catalog, profile, plans])
  function update(change: (plan: RoadmapPlan) => RoadmapPlan) {
    if (getProfile() !== profile) return
    setWorkspace((current) => {
      if (getProfile() !== profile || current.active !== active) return current
      const next = change(current.plans[active])
      return next === current.plans[active] ? current : { ...current, plans: current.plans.map((plan, index) => index === active ? next : plan) }
    })
  }
  function choosePlan(index: number) {
    setWorkspace((current) => getProfile() !== profile || index < 0 || index >= current.plans.length ? current : { ...current, active: index })
  }
  function addPlan() {
    setWorkspace((current) => getProfile() !== profile || current.plans.length >= ROADMAP_PLAN_LIMIT ? current : {
      plans: [...current.plans, { name: '', stages: [emptyRoadmapStage()] }], active: current.plans.length,
    })
  }
  function clearFocusedTitle() {
    const button = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('button[data-roadmap-choice]') : null
    if (!button || !panel.current?.contains(button) || !button.matches(':focus-visible')) return
    const dialog = button.closest('dialog'), title = button.querySelector('.roadmap-choice-title')
    if (!dialog || !title) return
    const bounds = dialog.getBoundingClientRect(), heading = dialog.querySelector('.dialog-heading')!.getBoundingClientRect(), text = title.getBoundingClientRect()
    const top = Math.max(bounds.top, heading.bottom) + 8, bottom = Math.min(bounds.bottom, innerHeight) - 8
    if (text.top < top) dialog.scrollTop -= top - text.top
    else if (text.bottom > bottom) dialog.scrollTop += text.bottom - bottom
  }
  function focusChoice() {
    clearFocusedTitle()
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(clearFocusedTitle)
  }
  useEffect(() => {
    const observer = new ResizeObserver(clearFocusedTitle)
    if (panel.current) { observer.observe(panel.current); const heading = panel.current.closest('dialog')?.querySelector('.dialog-heading'); if (heading) observer.observe(heading) }
    return () => { observer.disconnect(); if (frame.current !== undefined) cancelAnimationFrame(frame.current) }
  }, [])
  if (getProfile() !== profile) return null
  const plan = plans[active], result = results[active], named = plan.name.trim().length > 0
  return <section ref={panel} onFocusCapture={focusChoice} className="ua-roadmap telemetry-private rr-block" aria-label="Hypothetical Ultra Ascension roadmap">
    <p>Compare two deliberately named tree sequences for this open dialog only. Nothing here records purchases, items, goals, history or a real Ultra Ascension. Closing discards these plans.</p>
    <p>Each stage completes its chosen purchases <b>before</b> the optional full Ultra Ascension boundary. Choose Acquire for a new pending Astral, then Activate in a following stage after its reset. Rebuild checks repeat ownership in that stage; it never buys a retained purchase again.</p>
    <small>Native game {catalog.gameVersion} · Steam build {catalog.steamBuild}. All names, counts, costs and gates stay within the original current visible map, even after hypothetical receipts or resets. Browse spoilers explicitly outside this dialog for a broader starting view.</small>
    <p>Starting ownership is your actual snapshot, not recovered purchase chronology. Imported saves use the documented synthetic retained-ownership baseline. Later ownership, activation and receipts below are hypothetical stage state.</p>
    <p>No SP/USP balances, profitability, optimal UA timing, Stones, Dark Divinities, minions, quests or Astral Key payouts are modeled.</p>
    <div className="roadmap-plan-actions" role="group" aria-label="Choose sequence">{plans.map((entry, index) => <button key={index} aria-pressed={active === index} onClick={() => choosePlan(index)}>{entry.name.trim() || `Unnamed sequence ${index + 1}`}</button>)}
      {plans.length < ROADMAP_PLAN_LIMIT && <button onClick={addPlan}>Add comparison sequence</button>}</div>
    <label>Plan name<input aria-label="Plan name" maxLength={64} value={plan.name} onChange={(event) => update((value) => ({ ...value, name: event.target.value }))} /></label>
    {!named && <p role="status">Name this sequence deliberately to review its results.</p>}
    <div className="roadmap-summary" aria-label="Named sequence comparison">{plans.map((entry, index) => entry.name.trim() ? <article key={index} data-roadmap-summary={index}><h3>{entry.name}</h3><p>{results[index].complete ? 'Chosen sequence supported by reviewed tree rules' : 'Incomplete sequence; full total withheld'}</p><p>{results[index].cost === null ? <>Shown visible purchase subtotal: <SPCost value={results[index].subtotal} /></> : <>Exact purchase sum across stages: <SPCost value={results[index].cost} /></>}</p></article> : null)}</div>
    {plan.stages.map((stage, position) => <StageEditor key={`${active}/${position}`} catalog={catalog} actual={profile} visible={visible} stage={stage} result={result.stages[position]} position={position} named={named}
      edit={(change) => update((value) => value.stages[position] === stage ? editRoadmapStage(value, position, change) : value)} intend={(key) => update((value) => value.stages[position] === stage ? intendRoadmapRoute(value, position, key) : value)} />)}
    <div className="roadmap-plan-actions"><button disabled={plan.stages.length >= ROADMAP_STAGE_LIMIT} onClick={() => update((value) => value.stages.length >= ROADMAP_STAGE_LIMIT ? value : { ...value, stages: [...value.stages, emptyRoadmapStage()] })}>Add purchase stage</button>
      <button disabled={plan.stages.length <= 1} onClick={() => update((value) => value.stages.length <= 1 ? value : { ...value, stages: value.stages.slice(0, -1) })}>Remove last stage</button></div>
    <small>At most four stages, three full reset boundaries and four visible targets per stage. Shared additions count once per stage; reacquiring cleared repeat purchases counts again. Partial or unresolved stages stop future claims and withhold complete totals. Exact catalog sums do not establish affordability or an optimal build.</small>
  </section>
}

function StageEditor({ catalog, actual, visible, stage, result, position, named, edit, intend }: {
  catalog: Catalog; actual: Profile; visible: Scope; stage: RoadmapStage; result: RoadmapStageResult; position: number; named: boolean
  edit: (change: Partial<RoadmapStage>) => void; intend: (key: string) => void
}) {
  const [query, setQuery] = useState(''), [picker, setPicker] = useState(false)
  const nodes = new Map(visible.upgrades.map((node) => [node.id, node])), items = new Map(visible.milestones.map((item) => [item.id, item]))
  const found = discoverUpgrades(visible.upgrades, actual, query)
  const uaTarget = catalog.ultraAscension.kind === 'active' && nodes.has(catalog.ultraAscension.id) ? catalog.ultraAscension.id : undefined
  const identity = (id: string) => `${nodes.get(id)!.title} (ID: ${id})`
  const state = (profile: Profile, id: string) => profile.purchases[id] ? profile.purchases[id].active ? 'Owned and active' : 'Owned, awaiting activation' : 'Unowned'
  function expression(requirement: RouteRequirement): string {
    if ('requirements' in requirement) return `(${requirement.requirements.map(expression).join(requirement.kind === 'all' ? ' AND ' : ' OR ')})`
    switch (requirement.kind) {
      case 'always': return 'No prerequisites'
      case 'unrevealed': return 'Unrevealed native gate'
      case 'ultra-ascended': return 'Previous full Ultra Ascension'
      case 'milestone': return `${items.get(requirement.id)!.title} received/purchased`
      case 'active': case 'owned': return `${identity(requirement.id)} · ${requirement.kind}`
    }
  }
  function problem(value: RouteProblem): string {
    if (value.kind === 'activation') return `${identity(value.id)} needs activation through a full UA boundary. Choose acquisition before that boundary and activation in a following stage; pending ownership is not repurchased.`
    if (value.kind === 'milestone') return `${items.get(value.id)!.title} requires actual receipt/purchase or an explicit hypothetical receipt for this stage.`
    if (value.kind === 'history') return 'A previous full Ultra Ascension is required; a purchase or edited history counter is not a future reset.'
    if (value.kind === 'unrevealed') return 'An unrevealed native gate prevents complete proof within the original view.'
    if (value.kind === 'rebuild') return 'Rebuild applies only to repeat purchases.'
    if (value.kind === 'limit') return 'The route exploration bound was reached.'
    return 'The native gates or purchase order could not be proved.'
  }
  return <article className="roadmap-stage" data-roadmap-stage={position + 1}>
    <h3>Stage {position + 1} · purchases before boundary</h3>
    <p>Start: {position === 0 ? 'actual recorded snapshot' : 'hypothetical state after the preceding stage'}. {named && result.state !== 'unavailable' ? `Ultra Ascensions ${result.before.epoch}.` : ''}</p>
    <ol className="roadmap-targets">{stage.targets.filter((target) => nodes.has(target.id)).map((target) => <li key={target.id} data-roadmap-target={target.id}><h4>{nodes.get(target.id)!.title}</h4><small>ID: {target.id} · <SPCost value={nodes.get(target.id)!.cost} /> · Actual baseline: {state(actual, target.id)}</small>
      {named && result.state !== 'unavailable' && <small>Hypothetical stage start: {state(result.before, target.id)}</small>}
      <label>Completion before boundary<select aria-label={`Completion for ${identity(target.id)} stage ${position + 1}`} value={target.mode} onChange={(event) => edit({ targets: stage.targets.map((entry) => entry.id === target.id ? { ...entry, mode: event.target.value as GoalMode } : entry) })}>
        <option value="acquire">Acquire</option><option value="activate">Activate</option><option value="rebuild" disabled={nodes.get(target.id)!.retention !== 'repeat'}>Rebuild</option></select></label>
      <button onClick={() => edit({ targets: stage.targets.filter((entry) => entry.id !== target.id) })}>Remove target {nodes.get(target.id)!.title}</button></li>)}</ol>
    <details className="roadmap-picker" open={picker} onToggle={(event) => setPicker(event.currentTarget.open)}><summary>Add visible target to stage {position + 1}</summary><label>Find a stage target<input type="search" aria-label={`Find target for stage ${position + 1}`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {stage.targets.length >= 4 && <p>Remove a target before adding another.</p>}
      <div className="roadmap-target-results">{found.map(({ node }) => <button key={node.id} data-roadmap-choice={node.id} disabled={stage.targets.length >= 4 || stage.targets.some((target) => target.id === node.id)} onClick={() => { edit({ targets: [...stage.targets, { id: node.id, mode: 'acquire' }] }); setPicker(false) }}><b className="roadmap-choice-title">{node.title}</b><small><SPCost value={node.cost} /> · ID: {node.id}</small></button>)}</div>{!found.length && <p>No current visible matches.</p>}</details>
    <details className="roadmap-items"><summary>Hypothetical item receipts for stage {position + 1}</summary><p>These explicit receipts are assumptions, not earlier events or recorded progress. Once assumed, they persist through later hypothetical resets.</p>{visible.milestones.map((item) => <label key={item.id}><input data-roadmap-item={item.id} type="checkbox" disabled={actual.milestones[item.id] === true || result.before.milestones[item.id] === true} checked={actual.milestones[item.id] === true || result.before.milestones[item.id] === true || stage.assumedMilestones.includes(item.id)} onChange={(event) => edit({ assumedMilestones: event.target.checked ? [...stage.assumedMilestones, item.id] : stage.assumedMilestones.filter((id) => id !== item.id) })} />{actual.milestones[item.id] ? 'Actual recorded item: ' : result.before.milestones[item.id] ? 'Earlier hypothetical receipt: ' : 'Assume received/purchased: '}{item.title}</label>)}{!visible.milestones.length && <p>No external-item controls are currently revealed.</p>}</details>
    {position < ROADMAP_STAGE_LIMIT - 1 && <label className="roadmap-boundary"><input type="checkbox" aria-label={`Full Ultra Ascension after stage ${position + 1}`} checked={stage.resetAfter} onChange={(event) => edit({ resetAfter: event.target.checked })} />Full Ultra Ascension after these purchases</label>}
    {named && <div className="roadmap-stage-results"><p role="status">{result.state === 'complete' ? `All selected completion modes checked before boundary. ${stage.resetAfter ? 'Full UA boundary supported.' : 'No reset staged.'}` : reasons[result.problem!]}</p>
      {!!result.comparison.routes.length && <div className="roadmap-routes">{result.comparison.routes.map((route, index) => <article key={route.key} className="roadmap-route"><h4>Route {index + 1} · {route.cost === null ? 'Incomplete' : 'Purchases supported'}</h4><p>{route.cost === null ? 'Shown visible subtotal' : 'Exact stage purchase sum'}: <SPCost value={route.subtotal} /></p>
        {!!route.problems.length && <ul>{route.problems.map((entry, index) => <li key={index}>{problem(entry)}</li>)}</ul>}
        {!!route.choices.length && <div><b>Explicit OR choices</b><ul>{route.choices.map((choice) => <li key={choice.key}>{identity(choice.owner)} · {choice.phase}: {expression(choice.option)}</li>)}</ul></div>}
        <ol className="roadmap-purchases">{route.added.map((id) => <li key={id} data-roadmap-step={id}>{identity(id)} · <SPCost value={nodes.get(id)!.cost} />{route.shared.includes(id) ? ' · Shared across stage targets; counted once' : ''}{result.reacquired.includes(id) ? ' · Reacquired after hypothetical reset' : ''}</li>)}</ol>
        {!route.added.length && <p>No additional shown purchases; ownership and activation remain distinct.</p>}
        {result.comparison.routes.length > 1 && <label><input type="radio" name={`roadmap-route-${position}`} checked={stage.routeKey === route.key} onChange={() => intend(route.key)} />Intend route {index + 1} for this stage</label>}</article>)}</div>}
      {!!result.receipts.length && <p>Explicit hypothetical receipts for this stage: {result.receipts.map((id) => items.get(id)!.title).join('; ')}.</p>}
      {!!result.pending.length && <p>New purchases awaiting activation before boundary: {result.pending.map(identity).join('; ')}.</p>}
      {stage.resetAfter && result.state !== 'unavailable' && <section className="roadmap-checklist"><h4>Pre-UA checklist</h4><p>Every selected completion mode must be met before the boundary. Native UA prerequisite: {expression(result.uaRequirement)}.</p><p>{result.uaEligible ? 'Native UA prerequisite and counter are supported. The boundary still needs complete native proof.' : 'UA prerequisite or supported counter remains unresolved. Add the required visible purchase target to this stage.'}</p>{uaTarget && <button disabled={stage.targets.length >= 4 || stage.targets.some((target) => target.id === uaTarget)} onClick={() => edit({ targets: [...stage.targets, { id: uaTarget, mode: 'activate' }] })}>Include native UA prerequisite in stage {position + 1}</button>}<p>Full resets activate eligible locks, preserve existing Astrals and conditional targets, clear repeat purchases and keep item receipts. They never grant an absent target. This tree check does not decide when to UA overall.</p></section>}
      {result.state === 'complete' && stage.resetAfter && <div className="roadmap-reset" data-roadmap-reset={position + 1}><h4>After full UA · hypothetical Ultra Ascensions {result.after!.epoch}</h4><p>Activated: {result.activated.length ? result.activated.map(identity).join('; ') : 'No shown locks'}.</p><p>Cleared repeat purchases: {result.cleared.length ? result.cleared.map(identity).join('; ') : 'No shown purchases'}.</p><details><summary>Retained shown ownership · {result.retained.length}</summary><ul>{result.retained.map((id) => <li key={id}>{identity(id)} · {satisfies({ kind: 'active', id }, result.after!) ? 'Active' : 'Awaiting activation'}</li>)}</ul></details><small>Only original-view identities are listed. The full native transition also preserves unlisted unknown facts without displaying them.</small></div>}
    </div>}
  </article>
}
