import { useEffect, useRef, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import { goalModeLabels, moveGoal, setGoal, visibleGoals, type GoalMode } from './domain/goals'
import { visibility } from './domain/rules'
import type { useGoals } from './useGoals'
import { SPCost } from './SPCost'

export function GoalsPanel({ catalog, profile, targetId, onInspect, intentions }: { catalog: Catalog; profile: Profile; targetId: string | null; onInspect: (id: string) => void; intentions: ReturnType<typeof useGoals> }) {
  const goals = visibleGoals(catalog, profile, intentions.goals)
  const visibleIds = new Set(goals.map((goal) => goal.id))
  const target = visibility(catalog, profile).upgrades.find((node) => node.id === targetId)
  const [mode, setMode] = useState<GoalMode>('acquire')
  const [notice, setNotice] = useState('')
  const [recovery, setRecovery] = useState<'saved' | 'local' | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (targetId) { setMode(intentions.goals.targets.find((goal) => goal.id === targetId)?.mode ?? 'acquire'); heading.current?.focus({ preventScroll: false }) } }, [targetId])
  function save() {
    if (!target || (mode === 'rebuild' && target.retention !== 'repeat')) return
    try { if (intentions.edit(setGoal(intentions.goals, { id: target.id, mode }), intentions.goals)) setNotice('Intention recorded. Actual progress was not changed.') }
    catch { setNotice('Saved target capacity reached. Retire an intention before adding another.') }
  }
  return <section className="goals-panel telemetry-private rr-block" aria-labelledby="goals-heading">
    <h3 id="goals-heading" ref={heading} tabIndex={-1}>Goals and rebuild checklist</h3>
    <p>Choose intentions from upgrade details. They never record purchases, prerequisites, milestones or activation. Eligibility checks native requirements, not SP balance.</p>
    <p>Goals stay in this browser, separate from progress. Import, restore, clear progress and Undo recompute their status without removing them. Progress JSON backups contain no goals. Clearing browser storage removes them.</p>
    {target && <div className="goal-choice"><h4>Goal for {target.title}</h4><small>ID: {target.id} · <SPCost value={target.cost} /></small><label>Completion<select aria-label="Goal completion" value={mode} onChange={(event) => setMode(event.target.value as GoalMode)}><option value="acquire">Acquire</option><option value="activate">Activate</option><option value="rebuild" disabled={target.retention !== 'repeat'}>Rebuild</option></select></label><button onClick={save}>Save goal</button><p>Acquire measures current recorded ownership. Activate also requires the effect to be active. Rebuild follows actual ownership after every reset, including conditionally retained purchases. Retire an intention when you no longer want to track it.</p></div>}
    <p>{goals.length} visible goal{goals.length === 1 ? '' : 's'} · {goals.filter((goal) => goal.achieved).length} achieved. Only currently visible targets appear.</p>
    <ol className="goal-list">{goals.map((goal, index) => <li key={goal.id} data-goal-id={goal.id}><h4>{goal.upgrade.title}</h4><small>ID: {goal.id} · <SPCost value={goal.upgrade.cost} /></small><p>{goalModeLabels[goal.mode]} · {goal.state === 'pending' ? 'Owned, awaiting activation' : goal.state === 'eligible' ? 'Eligible to purchase' : goal.state === 'blocked' ? 'Blocked by native requirements' : 'Achieved'}{goal.state === 'pending' && goal.achieved ? ' · acquisition achieved' : ''}</p><div className="dialog-actions"><button onClick={() => onInspect(goal.id)}>Inspect goal</button><button disabled={index === 0} onClick={() => intentions.edit(moveGoal(intentions.goals, goal.id, -1, visibleIds), intentions.goals)}>Higher priority</button><button disabled={index === goals.length - 1} onClick={() => intentions.edit(moveGoal(intentions.goals, goal.id, 1, visibleIds), intentions.goals)}>Lower priority</button><button onClick={() => { if (intentions.edit({ version: 1, targets: intentions.goals.targets.filter((target) => target.id !== goal.id) }, intentions.goals)) setNotice('Goal retired. Actual progress was not changed.') }}>Retire goal</button></div></li>)}</ol>
    {notice && <p role="status">{notice}</p>}
    {intentions.error && <div className="goal-recovery"><p role="status">{intentions.error}</p><div className="dialog-actions"><button onClick={() => intentions.reviewRecovery ? intentions.reviewRecovery() : setRecovery('saved')}>Review saved goals</button><button onClick={() => intentions.reviewRecovery ? intentions.reviewRecovery() : setRecovery('local')}>Save this visit's goals…</button></div></div>}
    {recovery && <div className="goal-recovery" role="group" aria-label="Confirm goal recovery"><p>{recovery === 'saved' ? 'Discard this visit’s unsaved intentions and read the currently saved goals?' : 'Replace the saved goals with this visit’s intentions? This cannot recover the overwritten saved goals.'} Actual game progress is unaffected.</p><div className="dialog-actions"><button onClick={() => { if (recovery === 'saved') intentions.useSaved(); else intentions.edit(intentions.goals, intentions.goals, true); setRecovery(null) }}>Confirm goal recovery</button><button onClick={() => setRecovery(null)}>Cancel goal recovery</button></div></div>}
  </section>
}
