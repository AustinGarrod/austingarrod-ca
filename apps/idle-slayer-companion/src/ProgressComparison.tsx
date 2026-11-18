import { useEffect, useMemo, useState } from 'react'
import { SPCost } from './SPCost'
import { compareProgress } from './domain/progress-comparison'
import type { Catalog, Profile } from './domain/types'

export type ProgressComparisonProps = {
  catalog: Catalog
  current: Profile
  incoming: Profile
  viewer?: Profile
  currentLabel?: string
  incomingLabel?: string
  context?: string
  showSettings?: boolean
  undoAvailable?: boolean
  purpose?: 'replacement' | 'reference'
  replacementDescription?: string
}

const ownership = (purchase: Profile['purchases'][string] | undefined) => !purchase ? 'Not owned' : purchase.active ? 'Owned and active' : 'Owned · awaiting activation'

export function ProgressComparison({ catalog, current, incoming, viewer = current, currentLabel = 'Current session', incomingLabel = 'After replacement', context, showSettings = true, undoAvailable = true, purpose = 'replacement', replacementDescription = 'The entire profile is replaced, including records outside these lists.' }: ProgressComparisonProps) {
  const changes = useMemo(() => compareProgress(catalog, current, incoming, viewer), [catalog, current, incoming, viewer])
  const [shown, setShown] = useState(10)
  useEffect(() => { setShown(10) }, [current, incoming, viewer])
  const count = changes.upgrades.length + changes.milestones.length
  return <section className="progress-comparison telemetry-private rr-block" aria-label="Progress differences">
    <h3>{purpose === 'reference' ? 'Snapshot differences' : 'Before and after'}</h3>
    {context && <p className="comparison-context">{context}</p>}
    <p><b>{currentLabel} → {incomingLabel}</b></p>
    {showSettings && <dl className="comparison-settings">
      <div><dt>Ultra Ascensions</dt><dd><span>{currentLabel}</span><b>{current.epoch.toLocaleString('en')}</b></dd><dd><span>{incomingLabel}</span><b>{incoming.epoch.toLocaleString('en')}</b></dd></div>
      <div><dt>Spoiler setting</dt><dd><span>{currentLabel}</span><b>{current.showSpoilers ? 'Shown' : 'Hidden'}</b></dd><dd><span>{incomingLabel}</span><b>{incoming.showSpoilers ? 'Shown' : 'Hidden'}</b></dd></div>
    </dl>}
    {purpose === 'reference' ? <p>Both references use only upgrades and milestones revealed in your current map. Historical spoiler settings cannot widen these lists. Unknown records are retained in checkpoints and backups but are not listed.</p> : <p>Details and their counts use only upgrades and milestones revealed in your current map. {replacementDescription} Unknown entries are not listed.</p>}
    <p>{count === 0 ? 'No differences among currently visible upgrades or milestones.' : `${count} changes among currently visible upgrades and milestones.`}</p>
    <ul className="comparison-changes">
      {changes.upgrades.slice(0, shown).map(({ upgrade, before, after }) => <li key={upgrade.id}>
        <b>{upgrade.title}</b><small><SPCost value={upgrade.cost} /> · ID: {upgrade.id}</small>
        <span>{ownership(before)} → {ownership(after)}</span>
        {before && after && before.epoch !== after.epoch && <small>Ownership baseline: UA {before.epoch.toLocaleString('en')} → UA {after.epoch.toLocaleString('en')}</small>}
      </li>)}
      {changes.milestones.slice(0, Math.max(0, shown - changes.upgrades.length)).map(({ milestone, before, after }) => <li key={milestone.id}>
        <b>{milestone.title}</b><small>Milestone · ID: {milestone.id}</small><span>{before ? 'Recorded' : 'Not recorded'} → {after ? 'Recorded' : 'Not recorded'}</span>
      </li>)}
    </ul>
    {count > shown && <button onClick={() => setShown((value) => value + 10)}>Show next {Math.min(10, count - shown)} visible changes</button>}
    {purpose === 'reference' ? <p>Read-only references: neither snapshot replaces active progress or changes Undo/Redo. The arrow follows your selected comparison direction, not an assumed chronology. Ownership baselines are recorded companion state, not recovered purchase dates.</p> : <p>Review before applying. Cancel leaves progress unchanged. {undoAvailable ? 'Undo is available after replacement in this visit.' : 'This overwrites saved progress; Undo cannot restore its prior contents. Export the saved profile from the other tab first if you need to keep it.'} Ownership baselines are recorded map history, not recovered purchase dates.</p>}
  </section>
}
