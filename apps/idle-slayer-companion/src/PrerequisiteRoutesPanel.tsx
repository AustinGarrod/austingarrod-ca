import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import type { visibility } from './domain/rules'
import { discoverUpgrades, upgradeState } from './domain/discovery'
import { visibleGoals, type GoalMode, type Goals } from './domain/goals'
import { comparePrerequisiteRoutes, ROUTE_DISPLAY_LIMIT, ROUTE_TARGET_LIMIT, type RouteProblem, type RouteRequirement, type RouteTarget } from './domain/prerequisite-routes'
import './PrerequisiteRoutesPanel.css'
import { SPCost } from './SPCost'

const cost = (value: string) => <SPCost value={value} />
const modes: Record<GoalMode, string> = { acquire: 'Acquire', activate: 'Activate', rebuild: 'Rebuild' }
const states = { available: 'Native prerequisites recorded', locked: 'Native requirements blocked', purchased: 'Owned and active', pending: 'Owned, awaiting activation' }

export function PrerequisiteRoutesPanel({ catalog, profile, visible, goals, initialId }: {
  catalog: Catalog; profile: Profile; visible: ReturnType<typeof visibility>; goals: Goals; initialId?: string
}) {
  const [targets, setTargets] = useState<RouteTarget[]>(() => initialId && visible.ids.has(initialId)
    ? [{ id: initialId, mode: goals.targets.find((goal) => goal.id === initialId)?.mode ?? 'acquire' }] : [])
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(!initialId)
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [intention, setIntention] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)
  const focusFrame = useRef<number | undefined>(undefined)
  const index = useMemo(() => new Map(visible.upgrades.map((node) => [node.id, node])), [visible])
  const items = useMemo(() => new Map(visible.milestones.map((item) => [item.id, item])), [visible])
  const chosen = targets.filter((target) => visible.ids.has(target.id))
  const savedGoals = visibleGoals(catalog, profile, goals)
  const result = useMemo(() => comparePrerequisiteRoutes(catalog, profile, targets, { assumedMilestones: new Set(assumptions) }), [catalog, profile, targets, assumptions])
  const found = discoverUpgrades(visible.upgrades, profile, query)
  useLayoutEffect(() => {
    setTargets((previous) => previous.every((target) => visible.ids.has(target.id)) ? previous : previous.filter((target) => visible.ids.has(target.id)))
    setAssumptions((previous) => previous.every((id) => items.has(id)) ? previous : previous.filter((id) => items.has(id)))
  }, [visible, items])
  useEffect(() => { setIntention(null) }, [profile, targets, assumptions])
  function clearFocusedTitle() {
    const button = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('button[data-route-choice], button[data-route-goal]') : null
    if (!button || !panel.current?.contains(button) || !button.matches(':focus-visible')) return
    const dialog = button.closest('dialog'), title = button.querySelector('.route-choice-title')
    if (!dialog || !title) return
    const frame = dialog.getBoundingClientRect(), heading = dialog.querySelector('.dialog-heading')!.getBoundingClientRect(), text = title.getBoundingClientRect()
    if (!text.height) return
    const top = Math.max(frame.top, heading.bottom) + 8, bottom = Math.min(frame.bottom, innerHeight) - 8
    if (text.top < top) dialog.scrollTop -= top - text.top
    else if (text.bottom > bottom) dialog.scrollTop += text.bottom - bottom
  }
  function focusChoice() {
    clearFocusedTitle()
    if (focusFrame.current !== undefined) window.cancelAnimationFrame(focusFrame.current)
    focusFrame.current = window.requestAnimationFrame(clearFocusedTitle)
  }
  useEffect(() => {
    const observer = new ResizeObserver(clearFocusedTitle)
    if (panel.current) { observer.observe(panel.current); const heading = panel.current.closest('dialog')?.querySelector('.dialog-heading'); if (heading) observer.observe(heading) }
    return () => { observer.disconnect(); if (focusFrame.current !== undefined) window.cancelAnimationFrame(focusFrame.current) }
  }, [])
  function add(target: RouteTarget) {
    if (!visible.ids.has(target.id)) return
    setTargets((previous) => {
      const current = previous.filter((item) => visible.ids.has(item.id))
      return current.some((item) => item.id === target.id) || current.length >= ROUTE_TARGET_LIMIT ? current : [...current, target]
    })
    setPickerOpen(false)
  }
  function expression(requirement: RouteRequirement): string {
    if ('requirements' in requirement) return `(${requirement.requirements.map(expression).join(requirement.kind === 'all' ? ' AND ' : ' OR ')})`
    switch (requirement.kind) {
      case 'always': return 'No prerequisites'
      case 'unrevealed': return 'Unrevealed gate'
      case 'ultra-ascended': return 'Recorded previous Ultra Ascension'
      case 'milestone': return items.get(requirement.id)?.title ?? 'Unrevealed gate'
      case 'owned': case 'active': return `${index.get(requirement.id)?.title ?? 'Unrevealed upgrade'} (${requirement.kind}; ID: ${requirement.id})`
    }
  }
  function issue(problem: RouteProblem): string {
    switch (problem.kind) {
      case 'unrevealed': return 'An unrevealed native gate prevents proving a complete route. Browse spoilers explicitly in Map options to review additional revealed facts.'
      case 'history': return 'A previous Ultra Ascension must be recorded. Purchasing its tree upgrade does not perform a reset or establish that history.'
      case 'activation': return profile.purchases[problem.id] ? `${index.get(problem.id)!.title} (ID: ${problem.id}) is already owned but inactive. It is not repurchased; active requirements remain blocked until verified activation or a later reset.` : `${index.get(problem.id)!.title} (ID: ${problem.id}) would remain inactive after purchase. A later Ultra Ascension is needed before an active requirement can be met.`
      case 'milestone': return `${items.get(problem.id)!.title} is not recorded. Receipt must be verified separately, or explicitly treated as an assumption below.`
      case 'cycle': return 'This chosen branch cannot establish its prerequisites from the current recorded state.'
      case 'limit': return 'This branch reached a comparison limit; some prerequisite work is unresolved.'
      case 'gate': return 'Native gates prevent proving this purchase order from the current recorded state.'
      case 'rebuild': return 'Rebuild completion is available only for repeat purchases. Choose acquisition or activation for this target.'
    }
  }
  const intended = result.routes.find((route) => route.key === intention)
  return <section ref={panel} onFocusCapture={focusChoice} className="prerequisite-routes telemetry-private rr-block" aria-label="Prerequisite route comparison">
    <p>Compare current routes for up to {ROUTE_TARGET_LIMIT} visible targets. Choosing a route records only an intention for this open comparison; it never purchases, activates, records items, edits goals or enters progress Undo.</p>
    <small>Native game {catalog.gameVersion} · Steam build {catalog.steamBuild}. Costs are exact catalog purchase sums, counted once per stable ID. They do not model an SP balance or an optimal build.</small>
    <p>Acquire ends at recorded ownership, including a pending Astral. Activate also requires its effect. Rebuild uses actual current repeat-purchase ownership, including retained purchases; it stages no future reset.</p>
    <h3>Chosen targets</h3>
    {!chosen.length && <p>Choose a currently visible target to begin.</p>}
    <ol className="route-targets">{chosen.map((target) => {
      const node = index.get(target.id)!
      return <li key={target.id} data-route-target={target.id}><h4>{node.title}</h4><small>ID: {node.id} · {cost(node.cost)} · {states[upgradeState(node, profile)]}</small>
        <label>Completion<select aria-label={`Completion for ${node.title} ${node.id}`} value={target.mode} onChange={(event) => setTargets((previous) => previous.map((item) => item.id === target.id ? { ...item, mode: event.target.value as GoalMode } : item))}>
          <option value="acquire">Acquire</option><option value="activate">Activate</option><option value="rebuild" disabled={node.retention !== 'repeat'}>Rebuild</option></select></label>
        <button aria-label={`Remove target ${node.title}`} onClick={() => setTargets((previous) => previous.filter((item) => item.id !== target.id))}>Remove target</button></li>
    })}</ol>
    {!!savedGoals.length && <details className="route-goals"><summary>Add a saved visible goal</summary><p>Copy its completion mode into this comparison. The saved intention is unchanged.</p>{savedGoals.map((goal) => <button key={goal.id} data-route-goal={goal.id} disabled={chosen.length >= ROUTE_TARGET_LIMIT || chosen.some((target) => target.id === goal.id)} onClick={() => add({ id: goal.id, mode: goal.mode })}><b className="route-choice-title">{goal.upgrade.title}</b><small>{modes[goal.mode]} · {cost(goal.upgrade.cost)} · ID: {goal.id}</small></button>)}</details>}
    <details className="route-picker" open={pickerOpen} onToggle={(event) => setPickerOpen(event.currentTarget.open)}><summary>Add a visible target</summary>
      <label>Find a route target<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {chosen.length >= ROUTE_TARGET_LIMIT && <p>Remove a target before adding another.</p>}
      <div className="route-target-results" role="region" aria-label="Visible route targets">{found.map(({ node, state }) => <button key={node.id} data-route-choice={node.id} disabled={chosen.length >= ROUTE_TARGET_LIMIT || chosen.some((target) => target.id === node.id)} onClick={() => add({ id: node.id, mode: 'acquire' })}><b className="route-choice-title">{node.title}</b><small>{cost(node.cost)} · {states[state]} · ID: {node.id}</small></button>)}</div>
      {!found.length && <p>No visible matches.</p>}
    </details>
    <details className="route-assumptions"><summary>External-item assumptions</summary><p>Assumptions are for this comparison only. They never record receipt, crafting, an earlier event or an external upgrade.</p>
      {!visible.milestones.length && <p>No external-item controls are currently revealed.</p>}
      {visible.milestones.map((item) => <label key={item.id}><input data-route-milestone={item.id} type="checkbox" disabled={profile.milestones[item.id] === true} checked={profile.milestones[item.id] === true || assumptions.includes(item.id)} onChange={(event) => setAssumptions((previous) => event.target.checked ? [...previous, item.id] : previous.filter((id) => id !== item.id))} /><span>{profile.milestones[item.id] ? 'Recorded: ' : 'Assume received/purchased: '}{item.title}</span></label>)}
    </details>
    <p role="status" aria-label="Route comparison state">{result.routes.length ? `${result.routes.length} displayed route${result.routes.length === 1 ? '' : 's'}. ` : 'No routes selected. '}{result.bounded ? 'Comparison limits were reached; other routes may remain unexplored. ' : ''}{intended ? 'An intended route is selected for reference only.' : 'Select an intended route after reviewing its choices and blockers.'}</p>
    <small>Only the current visible graph is compared. At most {ROUTE_DISPLAY_LIMIT} routes are shown. “In every displayed route” describes this displayed set, not a globally required or cheapest build. Incomplete paths withhold full totals.</small>
    <div className="route-comparisons">{result.routes.map((route, position) => <article className="route-card" key={route.key} data-route-cost={route.cost ?? 'incomplete'}>
      <h3>Route {position + 1} · {route.cost === null ? 'Incomplete' : route.assumptions.length ? 'Conditional on listed items' : 'Complete for chosen completion modes'}</h3>
      <p className="route-total">{route.cost === null ? <>Full total withheld. Shown visible purchases subtotal: {cost(route.subtotal)}.</> : <>Exact combined catalog cost: {cost(route.cost)}.</>}</p>
      {!!route.problems.length && <ul className="route-blockers">{route.problems.map((problem, i) => <li key={i}>{issue(problem)}</li>)}</ul>}
      {!!route.assumptions.length && <p>Explicit item assumptions: {route.assumptions.map((id) => items.get(id)!.title).join('; ')}. These items are not recorded by this route.</p>}
      {!!route.pending.length && <p>These new purchases would await activation: {route.pending.map((id) => `${index.get(id)!.title} (ID: ${id})`).join('; ')}. Acquisition and effect activation remain distinct.</p>}
      {!!route.choices.length && <section><h4>Chosen OR alternatives</h4><ul>{route.choices.map((choice) => <li key={choice.key}>{index.get(choice.owner)!.title} (ID: {choice.owner}) · {choice.phase === 'purchase' ? 'purchase' : 'reveal'} gate: {expression(choice.option)}</li>)}</ul></section>}
      <h4>Missing visible purchases · {route.added.length} distinct IDs</h4>
      {!route.added.length && <p>No additional shown purchases. Review any activation, history or item blockers above.</p>}
      {route.cost === null && <p>This incomplete list is not an executable purchase sequence.</p>}
      <ol className="route-steps">{route.added.map((id) => <li key={id} data-route-step={id}><b>{index.get(id)!.title}</b><small>{cost(index.get(id)!.cost)} · ID: {id}{route.shared.includes(id) ? ' · Shared across chosen targets' : ''}{route.common.includes(id) ? ' · In every displayed route' : ' · Alternative-specific work'}</small></li>)}</ol>
      {!!route.shared.length && <p>Shared purchase subtotal: {cost(route.shared.reduce((sum, id) => sum + BigInt(index.get(id)!.cost), 0n).toString())}. Shared IDs are counted once above.</p>}
      {route.targets.length > 1 && <ul>{route.targets.map((item) => <li key={item.target.id}>{index.get(item.target.id)!.title}: target-specific shown additions {cost(item.uniqueCost)}.</li>)}</ul>}
      {!!route.recorded.length && <details><summary>Already recorded requirements</summary><ul>{route.recorded.map((item) => <li key={`${item.kind}/${item.id}`}>{item.kind === 'milestone' ? items.get(item.id)!.title : index.get(item.id)!.title} · ID: {item.id} · {item.kind === 'milestone' ? 'item received/purchased' : item.kind === 'active' ? 'owned and active' : 'ownership recorded'}{route.recordedShared.includes(item.id) ? ' · Shared recorded requirement across chosen targets' : ''}</li>)}</ul></details>}
      <label className="route-intention"><input type="radio" name="intended-route" checked={intended?.key === route.key} onChange={() => setIntention(route.key)} />Mark route {position + 1} as intended for this comparison only</label>
    </article>)}</div>
  </section>
}
