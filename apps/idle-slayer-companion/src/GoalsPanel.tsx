import { useEffect, useRef, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import { goalModeLabels, moveGoal, setGoal, visibleGoals, type GoalMode } from './domain/goals'
import { visibility } from './domain/rules'
import type { useGoals } from './useGoals'
import { SPCost } from './SPCost'

/**
 * The saved goals list (Plan → Goals), or with `only="choice"` the small "Set a goal for X" form
 * opened from upgrade details, which shows that one goal's status after saving.
 */
export function GoalsPanel({ catalog, profile, targetId, onInspect, intentions, only, onShowAll }: { catalog: Catalog; profile: Profile; targetId: string | null; onInspect: (id: string) => void; intentions: ReturnType<typeof useGoals>; only?: 'choice'; onShowAll?: () => void }) {
  const allGoals = visibleGoals(catalog, profile, intentions.goals)
  const goals = only === 'choice' ? allGoals.filter((goal) => goal.id === targetId) : allGoals
  const visibleIds = new Set(allGoals.map((goal) => goal.id))
  const target = visibility(catalog, profile).upgrades.find((node) => node.id === targetId)
  const [mode, setMode] = useState<GoalMode>('acquire')
  const [notice, setNotice] = useState('')
  const [recovery, setRecovery] = useState<'saved' | 'local' | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (targetId) setMode(intentions.goals.targets.find((goal) => goal.id === targetId)?.mode ?? 'acquire') }, [targetId])
  function save() {
    if (!target || (mode === 'rebuild' && target.retention !== 'repeat')) return
    try { if (intentions.edit(setGoal(intentions.goals, { id: target.id, mode }), intentions.goals)) setNotice('Goal saved. Recorded progress was not changed.') }
    catch { setNotice('You have the maximum number of goals. Remove one before adding another.') }
  }
  return <section className="goals-panel telemetry-private rr-block" aria-labelledby={only === 'choice' ? 'goal-choice-heading' : 'goals-heading'}>
    {only !== 'choice' && <>
      <h3 id="goals-heading" ref={heading} tabIndex={-1}>Saved goals</h3>
      <p>Set a goal from an upgrade’s Plan tools. A goal records nothing; it tracks a target against the game’s requirements, not your SP balance, and stays when progress is imported, restored, cleared or undone.</p>
    </>}
    {target && <div className="goal-choice"><h4 id="goal-choice-heading" tabIndex={-1} className={only === 'choice' ? 'sr-only' : undefined}>Goal for {target.title}</h4><small>ID: {target.id} · <SPCost value={target.cost} /></small><label>Completion<select aria-label="Goal completion" value={mode} onChange={(event) => setMode(event.target.value as GoalMode)}><option value="acquire">Acquire</option><option value="activate">Activate</option><option value="rebuild" disabled={target.retention !== 'repeat'}>Rebuild</option></select></label><button className={only === 'choice' ? 'primary' : undefined} onClick={save}>Save goal</button><p>Acquire: recorded as owned. Activate: owned and its effect active. Rebuild: owned again after every reset.</p></div>}
    {only !== 'choice' && <p>{goals.length} visible goal{goals.length === 1 ? '' : 's'} · {goals.filter((goal) => goal.achieved).length} achieved. Only currently visible targets appear.</p>}
    <ol className="goal-list">{goals.map((goal, index) => <li key={goal.id} data-goal-id={goal.id}><h4>{goal.upgrade.title}</h4><small>ID: {goal.id} · <SPCost value={goal.upgrade.cost} /></small><p>{goalModeLabels[goal.mode]} · {goal.state === 'pending' ? 'Owned, awaiting activation' : goal.state === 'eligible' ? 'Eligible to purchase' : goal.state === 'blocked' ? 'Blocked by game requirements' : 'Achieved'}{goal.state === 'pending' && goal.achieved ? ' · acquisition achieved' : ''}</p>{only !== 'choice' && <div className="dialog-actions"><button onClick={() => onInspect(goal.id)}>Inspect goal</button><button disabled={index === 0} onClick={() => intentions.edit(moveGoal(intentions.goals, goal.id, -1, visibleIds), intentions.goals)}>Higher priority</button><button disabled={index === goals.length - 1} onClick={() => intentions.edit(moveGoal(intentions.goals, goal.id, 1, visibleIds), intentions.goals)}>Lower priority</button><button onClick={() => { if (intentions.edit({ version: 1, targets: intentions.goals.targets.filter((target) => target.id !== goal.id) }, intentions.goals)) setNotice('Goal retired. Actual progress was not changed.') }}>Retire goal</button></div>}</li>)}</ol>
    {notice && <p role="status">{notice}</p>}
    {only === 'choice' && onShowAll && <div className="dialog-actions"><button onClick={onShowAll}>All goals…</button></div>}
    {intentions.error && <div className="goal-recovery"><p role="status">{intentions.error}</p><div className="dialog-actions"><button onClick={() => intentions.reviewRecovery ? intentions.reviewRecovery() : setRecovery('saved')}>Review saved goals</button><button onClick={() => intentions.reviewRecovery ? intentions.reviewRecovery() : setRecovery('local')}>Save this visit's goals…</button></div></div>}
    {recovery && <div className="goal-recovery" role="group" aria-label="Confirm goal recovery"><p>{recovery === 'saved' ? 'Discard this visit’s unsaved intentions and read the currently saved goals?' : 'Replace the saved goals with this visit’s intentions? This cannot recover the overwritten saved goals.'} Actual game progress is unaffected.</p><div className="dialog-actions"><button onClick={() => { if (recovery === 'saved') intentions.useSaved(); else intentions.edit(intentions.goals, intentions.goals, true); setRecovery(null) }}>Confirm goal recovery</button><button onClick={() => setRecovery(null)}>Cancel goal recovery</button></div></div>}
  </section>
}
