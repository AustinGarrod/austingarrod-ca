import { useState } from 'react'
import { forwardImpact, type HypotheticalEvent, type ImpactRow } from './domain/forward-impact'
import { visibility } from './domain/rules'
import type { Catalog, Profile, Upgrade } from './domain/types'
import { ReadOnlyRequirement } from './RequirementView'
import { SPCost } from './SPCost'
import './ForwardImpactPanel.css'

const gate = (value: boolean) => value ? 'Satisfied' : 'Missing'
function Identity({ upgrade }: { upgrade: Upgrade }) {
  return <><h4>{upgrade.title}</h4><small>ID: {upgrade.id} · <SPCost value={upgrade.cost} /></small></>
}
function Rows({ title, rows, after, profile, catalog }: { title: string; rows: ImpactRow[]; after: Profile; profile: Profile; catalog: Catalog }) {
  const [limit, setLimit] = useState(10)
  const visible = visibility(catalog, profile)
  return <section aria-label={title}><h3>{title} ({rows.length})</h3>{!rows.length ? <p>None among the currently visible affected upgrades.</p> : <><ul className="forward-impact-rows">{rows.slice(0, limit).map((row) => <li key={row.upgrade.id} data-impact-id={row.upgrade.id}>
    <Identity upgrade={row.upgrade} />
    <p>Purchase gates: {gate(row.before.purchase)} → {gate(row.after.purchase)}.<br />Reveal gates: {gate(row.before.reveal)} → {gate(row.after.reveal)}.</p>
    <details><summary>Requirements after this event</summary><b>Purchase</b><ReadOnlyRequirement requirement={row.upgrade.purchase} profile={after} visible={visible} /><b>Reveal</b><ReadOnlyRequirement requirement={row.upgrade.reveal} profile={after} visible={visible} /></details>
  </li>)}</ul>{limit < rows.length && <button onClick={() => setLimit((count) => count + 10)}>Show more affected upgrades</button>}</>}</section>
}

export function ForwardImpactPanel({ catalog, profile, event }: { catalog: Catalog; profile: Profile; event: HypotheticalEvent }) {
  const result = forwardImpact(catalog, profile, event)
  const visible = visibility(catalog, profile)
  return <div className="forward-impact telemetry-private rr-block">
    <p>Read-only analysis of one event. Actual progress, goals, Undo and Redo stay unchanged. No SP balance or affordability is assumed.</p>
    <p>Only visible requirement portions are explained; native gates still apply.</p>
    {result.kind === 'unavailable' ? <p role="status">{result.reason}</p> : <>
      <h3>{event.kind === 'purchase' ? 'Proposed purchase' : 'Proposed item receipt'}: {result.target.title}</h3>
      <small>ID: {result.target.id}{'cost' in result.target && <> · <SPCost value={result.target.cost} /></>}</small>
      {result.kind === 'blocked' ? <><p role="status">{result.reason}</p><h3>Current purchase gates</h3><ReadOnlyRequirement requirement={result.target.purchase} profile={profile} visible={visible} /><h3>Current reveal gates</h3><ReadOnlyRequirement requirement={result.target.reveal} profile={profile} visible={visible} /></> : <>
        <p>{event.kind === 'milestone' ? 'Assume only that this required item has actually been received, crafted or purchased. Its acquisition path is not inferred.' : 'Assume this purchase only. Newly eligible upgrades are not also purchased.'}</p>
        {'activation' in result.target && result.target.activation === 'after-ultra-ascension' && <p>This Astral purchase stays awaiting activation. Its future activation requires a full Ultra Ascension transition, including clearing and retention; it is not forecast here.</p>}
        <p>Rows and counts use the map’s current visible upgrades, in catalog order.</p>
        {profile.showSpoilers ? <p data-impact-reveals>Explicit spoiler browsing: {result.newlyRevealed.length} affected upgrade{result.newlyRevealed.length === 1 ? '' : 's'} would newly meet reveal gates. {result.newlyRevealed.filter((row) => !row.after.purchase).length} would still be blocked by purchase gates. A reveal alone does not establish purchase eligibility.</p> : <p>Hypothetically revealed identities and counts are omitted while spoilers are hidden.</p>}
        <Rows title="Newly eligible to purchase" rows={result.newlyEligible} after={result.after} profile={profile} catalog={catalog} />
        <Rows title="Still blocked" rows={result.blocked} after={result.after} profile={profile} catalog={catalog} />
        <Rows title="Already eligible before this event" rows={result.alreadyEligible} after={result.after} profile={profile} catalog={catalog} />
      </>}
    </>}
  </div>
}
