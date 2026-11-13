import { useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import { retainedPurchasesOnReset, visibility } from './domain/rules'
import { discoverUpgrades, upgradeState } from './domain/discovery'
import { editComparison, emptyComparison, exportComparison, MAX_COMPARISON_BYTES, MAX_COMPARISON_ENTRIES, parseComparison, presentedComparison, type SavedComparison } from './domain/saved-comparison'
import type { createComparisonSession, ComparisonState } from './domain/comparison-session'
import type { RequirementRoute } from './domain/requirement-view'
import { RequirementView } from './RequirementView'
import { Icon } from './UpgradeCard'
import './SavedComparisonPanel.css'

const stateLabels = { available: 'Available · prerequisites recorded; SP balance unknown', locked: 'Locked · native requirements not recorded', purchased: 'Owned and active', pending: 'Owned · awaiting activation' }
const choiceStateLabels = { available: 'Available', locked: 'Locked', purchased: 'Owned and active', pending: 'Owned · awaiting activation' }
const cost = (value: string) => `${BigInt(value).toLocaleString('en')} SP`

export function SavedComparisonPanel({ catalog, profile, getProfile, visible, session, state, initialId, onInspect, onReview }: {
  catalog: Catalog; profile: Profile; visible: ReturnType<typeof visibility>
  getProfile: () => Profile
  session: ReturnType<typeof createComparisonSession>; state: ComparisonState; initialId?: string
  onInspect: (id: string) => void; onReview: (route: RequirementRoute, origin: string) => void
}) {
  const list = presentedComparison(state.list, catalog, visible.ids)
  const index = useMemo(() => new Map(catalog.upgrades.map((upgrade) => [upgrade.id, upgrade])), [catalog])
  const retained = retainedPurchasesOnReset(catalog, profile)
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState<string | undefined>()
  const activeReplace = replace !== undefined && list.ids.includes(replace) ? replace : undefined
  const [feedback, setFeedback] = useState('')
  const [restore, setRestore] = useState<{ list: SavedComparison; version: number; visibleKey: string } | null>(null)
  const [recovery, setRecovery] = useState<{ version: number; action: 'saved' | 'local' } | null>(null)
  const [reading, setReading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const readGeneration = useRef(0)
  const visibleKey = JSON.stringify([...visible.ids])
  function current() { return { version: session.getState().version, visibleKey: JSON.stringify([...visibility(catalog, getProfile()).ids]) } }
  const found = discoverUpgrades(visible.upgrades, profile, query)
  const results = !query && initialId ? [...found.filter(({ node }) => node.id === initialId), ...found.filter(({ node }) => node.id !== initialId)] : found
  useEffect(() => {
    readGeneration.current++; setReading(false); setRestore(null); setRecovery(null); setFeedback('')
    setReplace(undefined)
  }, [state.version, visibleKey])
  useEffect(() => () => { readGeneration.current++ }, [])
  function edit(next: SavedComparison) {
    const projected = presentedComparison(next, catalog, visibility(catalog, getProfile()).ids)
    if (session.edit(projected, state.version)) { setReplace(undefined); setFeedback('Comparison updated. Progress is unchanged.') }
  }
  function add(id: string) {
    const next = editComparison(session.getState().list, id, visibility(catalog, getProfile()).ids, catalog, activeReplace)
    if (next) edit(next)
  }
  function download() {
    try {
      const liveList = presentedComparison(session.getState().list, catalog, visibility(catalog, getProfile()).ids)
      const blob = new Blob([exportComparison(liveList)], { type: 'application/json' })
      const url = URL.createObjectURL(blob), anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'idle-slayer-upgrade-comparison.json'; anchor.click(); URL.revokeObjectURL(url)
      setFeedback('Comparison exported. This file contains no progress profile.')
    } catch { setFeedback('Comparison could not be exported. This session is unchanged.') }
  }
  async function readFile(file: File) {
    const generation = ++readGeneration.current, snapshot = current()
    setReading(true); setRestore(null); setFeedback('')
    try {
      const text = file.size <= MAX_COMPARISON_BYTES ? await file.text() : ''
      const latest = current()
      if (generation !== readGeneration.current || snapshot.version !== latest.version || snapshot.visibleKey !== latest.visibleKey) return
      const parsed = parseComparison(text)
      if (!parsed) { setFeedback('This file is not a supported comparison backup. Nothing was replaced.'); return }
      setRestore({ list: presentedComparison(parsed, catalog, visibility(catalog, getProfile()).ids), version: snapshot.version, visibleKey: snapshot.visibleKey })
    } catch {
      if (generation === readGeneration.current) setFeedback('Comparison backup could not be read. Nothing was replaced.')
    } finally { if (generation === readGeneration.current) setReading(false) }
  }
  const disabled = !state.loaded || state.pending || reading
  return <section className="saved-comparison telemetry-private rr-block" aria-label="Saved upgrade comparison">
    <p>Compare up to {MAX_COMPARISON_ENTRIES} visible upgrades in any recorded state. This is a reference list: it records no purchases, goals or preferred build.</p>
    <small>Native game {catalog.gameVersion} · Steam build {catalog.steamBuild} · Catalog {catalog.revision}. Benefits are native descriptions; player-dependent values are not simulated or combined.</small>
    <p className="saved-comparison-status" role="status" aria-label="Comparison storage and actions" aria-live="polite">{!state.loaded ? 'Checking comparison storage…' : reading ? 'Reading comparison backup…' : state.pending ? 'Saving comparison…' : state.saved ? 'Comparison saved on this device.' : 'Comparison is kept for this visit.'} {state.error} {feedback}</p>
    <div className="saved-comparison-tools">
      <button onClick={download}>Export comparison</button>
      <button disabled={disabled} onClick={() => { readGeneration.current++; setRestore(null); fileInput.current?.click() }}>Restore comparison…</button>
      {(!!state.error || state.dirty) && !state.conflict && <button disabled={disabled} onClick={() => { void session.save() }}>Retry saving comparison</button>}
      {state.conflict && <><button disabled={disabled} onClick={() => session.refreshExternal()}>Refresh recovery</button>
        <button disabled={disabled || !state.canUseSaved} onClick={() => setRecovery({ version: state.version, action: 'saved' })}>Use saved comparison…</button>
        <button disabled={disabled} onClick={() => setRecovery({ version: state.version, action: 'local' })}>Replace saved comparison…</button></>}
    </div>
    <small>Separate from your progress JSON backup. Exports contain only currently visible and unavailable entries. Unrevealed entries are omitted from the display and export; a deliberate list edit also omits them. Keep a comparison export when changing browsers or devices. Clearing progress and Undo do not edit this list.</small>
    <input className="sr-only telemetry-private rr-block" tabIndex={-1} aria-label="Upgrade comparison JSON backup" type="file" accept="application/json,.json" ref={fileInput} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); else { readGeneration.current++; setReading(false) } }} />
    {restore && <section className="saved-comparison-confirm" aria-label="Review comparison restore">
      <h3>Replace this comparison?</h3><p>This replaces only the reference list with the currently visible and unavailable entries below. Progress stays unchanged. Export this list first if you want to keep both.</p>
      <ul>{presentedComparison(restore.list, catalog, visible.ids).ids.map((id) => <li key={id}>{index.has(id) ? `${index.get(id)!.title} · ${cost(index.get(id)!.cost)} · ${id}` : 'Unavailable catalog entry'}</li>)}</ul>
      {!presentedComparison(restore.list, catalog, visible.ids).ids.length && <p>No visible or unavailable entries to restore.</p>}
      <div className="dialog-actions"><button disabled={disabled} onClick={() => { const latest = current(); if (restore.version === latest.version && restore.visibleKey === latest.visibleKey) edit(restore.list) }}>Replace comparison</button><button onClick={() => { readGeneration.current++; setRestore(null) }}>Cancel restore</button></div>
    </section>}
    {recovery && <section className="saved-comparison-confirm" aria-label="Review comparison recovery"><h3>{recovery.action === 'saved' ? 'Use saved comparison?' : 'Replace saved comparison?'}</h3><p>{recovery.action === 'saved' ? 'Discard this local reference list and load the checked saved comparison below.' : 'Replace the checked device comparison below with this local reference list. Another tab may be using the saved list.'} Export this list first to keep it. Progress is unchanged.</p><h3>Checked saved entries</h3>{state.savedList ? <><ul>{presentedComparison(state.savedList, catalog, visible.ids).ids.map((id) => <li key={id}>{index.has(id) ? `${index.get(id)!.title} · ${cost(index.get(id)!.cost)} · ${id}` : 'Unavailable catalog entry'}</li>)}</ul><small>Only currently visible and unavailable saved entries are shown.</small></> : <p>Saved comparison cannot be read as a supported reference list.</p>}<div className="dialog-actions"><button disabled={disabled} onClick={() => { if (recovery.action === 'saved') session.useSaved(recovery.version); else void session.save(true, recovery.version); setRecovery(null) }}>Confirm comparison recovery</button><button onClick={() => setRecovery(null)}>Cancel recovery</button></div></section>}
    <h3>Compared entries · {list.ids.length} / {MAX_COMPARISON_ENTRIES}</h3>
    {!list.ids.length && <p>No visible entries in this comparison. Choose an upgrade below.</p>}
    <div className="saved-comparison-cards">{list.ids.map((id, position) => {
      const node = index.get(id)
      const record = profile.purchases[id]
      return <article className="saved-comparison-card" key={id} data-upgrade-id={node?.id} aria-label={node ? `${node.title} · ${cost(node.cost)} · ${node.id}` : `Unavailable catalog entry ${position + 1}`}>
        {node ? <><div className="saved-comparison-identity"><Icon node={node} /><h3>{node.title}</h3></div><p className="saved-comparison-cost">{cost(node.cost)}</p><small>Native ID: {node.id}</small><p>{stateLabels[upgradeState(node, profile)]}{record && <small>Recorded ownership baseline: Ultra Ascension {record.epoch}</small>}</p><p>{node.description}</p>
          <dl><dt>Purchase requirements</dt><dd><RequirementView requirement={node.purchase} profile={profile} visible={visible} onReview={(route) => onReview(route, node.id)} /></dd>
            <dt>Reveal requirements</dt><dd><RequirementView requirement={node.reveal} profile={profile} visible={visible} onReview={(route) => onReview(route, node.id)} /></dd>
            <dt>Activation</dt><dd>{node.activation === 'after-ultra-ascension' ? 'Astral lock · activates after Ultra Ascension; ownership alone is not activation.' : 'Immediate when purchased.'}</dd>
            <dt>Ultra Ascension retention</dt><dd>{node.retention === 'repeat' ? retained.has(node.id) ? 'Existing purchase retained by Astral progress on the next reset.' : record ? 'Repeat purchase · clears on reset.' : 'Repeat purchase · not currently owned.' : node.retention === 'astral' ? 'Astral · ownership retained on reset.' : 'Permanent · ownership retained on reset.'}</dd></dl>
          <details><summary>Sources</summary>{node.sources.map((source, i) => <p key={i}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source.label}{source.evidence && <small>{source.evidence}</small>}</p>)}</details></> : <><h3>Unavailable catalog entry</h3><p>This saved ID is absent from the current catalog. Its identity, benefit, cost and rules cannot be established. Remove it or replace it explicitly.</p></>}
        <div className="saved-comparison-tools">{node && <button onClick={() => onInspect(id)}>Show on map</button>}<button disabled={disabled} aria-pressed={activeReplace === id} onClick={() => { setReplace(id); setQuery('') }}>Replace entry {position + 1}…</button><button disabled={disabled} onClick={() => edit({ ...list, ids: list.ids.filter((entry) => entry !== id) })}>Remove entry {position + 1}</button></div>
      </article>
    })}</div>
    <details className="saved-comparison-picker" open={activeReplace !== undefined || !!initialId || !list.ids.length}>
      <summary>{activeReplace === undefined ? 'Choose a visible upgrade' : `Choose replacement for entry ${list.ids.indexOf(activeReplace) + 1}`}</summary>
      {activeReplace !== undefined && <button onClick={() => setReplace(undefined)}>Cancel replacement</button>}
      <label>Find a visible upgrade<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {list.ids.length === MAX_COMPARISON_ENTRIES && activeReplace === undefined && <p>Select Replace on an entry, or remove it, before adding another.</p>}
      <div className="saved-comparison-results" role="region" aria-label="Visible comparison choices">{results.map(({ node, state: status }) => <button key={node.id} data-upgrade-id={node.id} disabled={disabled || list.ids.includes(node.id) || (activeReplace === undefined && list.ids.length >= MAX_COMPARISON_ENTRIES)} onClick={() => add(node.id)}><b>{node.title}</b><span>{cost(node.cost)}</span><small>{choiceStateLabels[status]} · Native ID: {node.id}{list.ids.includes(node.id) ? ' · Already compared' : ''}</small></button>)}</div>
      {!results.length && <p>No visible matches.</p>}
    </details>
    {!!list.ids.length && <button disabled={disabled} onClick={() => edit(emptyComparison())}>Remove all compared entries</button>}
  </section>
}
