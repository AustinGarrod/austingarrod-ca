import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import type { ProfileHistoryEntry } from './domain/profile-session'
import type { CheckpointState, createCheckpointSession } from './domain/checkpoint-session'
import { checkpointName, exportCheckpoints, MAX_CHECKPOINT_BYTES, MAX_CHECKPOINT_NAME, MAX_CHECKPOINTS, parseCheckpoints, type CheckpointVault } from './domain/checkpoints'
import { checkpointHistory } from './domain/checkpoint-history'
import { historyActionLabel } from './domain/profile-history'
import { compareProgress } from './domain/progress-comparison'
import { visibility } from './domain/rules'
import { ProgressComparison } from './ProgressComparison'
import './CheckpointPanel.css'

export function CheckpointPanel({ catalog, profile, history, redoHistory, state, session, currentProfile }: {
  catalog: Catalog; profile: Profile; history: ProfileHistoryEntry[]; redoHistory: ProfileHistoryEntry[]
  state: CheckpointState; session: ReturnType<typeof createCheckpointSession>; currentProfile: () => Profile
}) {
  const entries = state.vault.entries
  const [name, setName] = useState('')
  const [first, setFirst] = useState(() => entries[0] ? `saved:${entries[0].id}` : 'current')
  const [second, setSecond] = useState('current')
  const [rename, setRename] = useState<{ id: string; name: string; version: number } | null>(null)
  const [remove, setRemove] = useState<{ id: string; version: number } | null>(null)
  const [restore, setRestore] = useState<{ vault: CheckpointVault; version: number } | null>(null)
  const [recovery, setRecovery] = useState<{ action: 'saved' | 'local'; version: number } | null>(null)
  const [reading, setReading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const fileInput = useRef<HTMLInputElement>(null), request = useRef(0)
  const version = useRef(state.version); version.current = state.version
  const identity = useId()
  const disabled = !state.loaded || state.pending || reading
  const choices = [{ value: 'current', name: 'Current progress', profile, revision: catalog.revision }, ...entries.map((entry, index) => ({ value: `saved:${entry.id}`, name: `${entry.name} · checkpoint ${index + 1}`, profile: entry.profile, revision: entry.capturedRevision }))]
  const firstChoice = choices.find((choice) => choice.value === first) ?? choices[0]
  const secondChoice = choices.find((choice) => choice.value === second) ?? choices[0]
  const renameEntry = rename?.version === state.version && entries.find((entry) => entry.id === rename.id)
  const removeEntry = remove?.version === state.version && entries.find((entry) => entry.id === remove.id)
  const activeRestore = restore?.version === state.version ? restore : null
  const activeRecovery = recovery?.version === state.version ? recovery : null
  const visible = useMemo(() => visibility(catalog, profile), [catalog, profile])
  const changes = useMemo(() => compareProgress(catalog, firstChoice.profile, secondChoice.profile, profile), [catalog, firstChoice.profile, secondChoice.profile, profile])
  const context = useMemo(() => checkpointHistory(catalog, firstChoice.profile, secondChoice.profile, profile, history, redoHistory), [catalog, firstChoice.profile, secondChoice.profile, profile, history, redoHistory])
  const gained = changes.upgrades.filter((change) => !change.before && change.after)
  const removed = changes.upgrades.filter((change) => change.before && !change.after)
  const permanent = gained.filter((change) => change.upgrade.retention !== 'repeat')
  const activated = changes.upgrades.filter((change) => change.before && change.after && !change.before.active && change.after.active && change.upgrade.activation === 'after-ultra-ascension')
  const meaningful = changes.upgrades.length || changes.milestones.length || firstChoice.profile.epoch !== secondChoice.profile.epoch || firstChoice.profile.showSpoilers !== secondChoice.profile.showSpoilers
  useEffect(() => { request.current++; setReading(false); setRestore(null); setRecovery(null); setRename(null); setRemove(null); setFeedback('') }, [state.version])
  useEffect(() => () => { request.current++ }, [])
  function exportVault() {
    try {
      const text = exportCheckpoints(session.getState().vault, catalog.revision)
      if (!text) throw new Error('format')
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'idle-slayer-progress-checkpoints.json'; anchor.click(); URL.revokeObjectURL(url)
      setFeedback('Checkpoint collection exported. This is separate from your active progress backup.')
    } catch { setFeedback('Checkpoint export failed. The collection and active progress are unchanged.') }
  }
  async function readFile(file: File) {
    const token = ++request.current, expected = version.current
    setReading(true); setRestore(null); setFeedback('')
    try {
      const text = file.size <= MAX_CHECKPOINT_BYTES ? await file.text() : ''
      if (token !== request.current || expected !== version.current) return
      const vault = parseCheckpoints(text, catalog.revision)
      if (vault) setRestore({ vault, version: expected })
      else setFeedback('This is not a supported checkpoint collection within 4 MiB. Nothing was replaced.')
    } catch { if (token === request.current) setFeedback('Checkpoint backup could not be read. Nothing was replaced.') }
    finally { if (token === request.current) setReading(false) }
  }
  return <section className="checkpoint-panel telemetry-private rr-block" aria-label="Named progress checkpoints">
    <p>Keep up to four deliberately named snapshots of your recorded map state. Checkpoints are read-only references for one active profile. Capturing, comparing, renaming and deleting them never changes progress or Undo/Redo.</p>
    <p role="status" aria-label="Checkpoint storage and actions">{!state.loaded ? 'Checking checkpoint storage…' : reading ? 'Reading checkpoint backup…' : state.pending ? 'Saving checkpoints…' : state.saved ? 'Checkpoints saved on this device.' : 'Checkpoints kept for this visit.'} {state.error} {feedback}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (session.capture(name, currentProfile, state.version)) { setName(''); setFirst(`saved:${session.getState().vault.entries.at(-1)!.id}`) } }}>
      <label>Name current checkpoint<input required maxLength={MAX_CHECKPOINT_NAME} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button disabled={disabled || !checkpointName(name) || entries.length >= MAX_CHECKPOINTS}>Capture current progress</button>
      <small>1–64 characters · {entries.length} / {MAX_CHECKPOINTS} references · 4 MiB total. Captures the active in-memory state, including unknown records. A full collection requires deliberate deletion first. No game dates or activity log are stored.</small>
    </form>
    <div className="checkpoint-tools"><button onClick={exportVault}>Export checkpoints</button><button disabled={disabled} onClick={() => { request.current++; setRestore(null); fileInput.current?.click() }}>Restore checkpoints…</button>
      {(state.error || state.dirty) && !state.conflict && <button disabled={disabled} onClick={() => { void session.save() }}>Retry checkpoint saving</button>}
      {state.conflict && <><button disabled={disabled} onClick={() => session.refreshExternal()}>Refresh checkpoint recovery</button><button disabled={disabled || !state.savedVault} onClick={() => setRecovery({ action: 'saved', version: state.version })}>Use saved checkpoints…</button><button disabled={disabled} onClick={() => setRecovery({ action: 'local', version: state.version })}>Replace saved checkpoints…</button></>}
    </div>
    <small>Separate storage and JSON backup from active progress. A reload restores the last successful checkpoint save; export this collection before leaving if saving fails. Catalog updates normalize profiles without discarding unknown IDs. Portable files contain snapshots and names, never operation claims. Verified operation context is available only from this visit’s bounded Undo/Redo history.</small>
    <input className="sr-only telemetry-private rr-block" tabIndex={-1} type="file" accept="application/json,.json" aria-label="Progress checkpoints JSON backup" ref={fileInput} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); else { request.current++; setReading(false) } }} />
    <ul className="checkpoint-list">{entries.map((entry, index) => <li key={entry.id} data-checkpoint-id={entry.id}><b>{entry.name}</b><small>Checkpoint {index + 1} · Captured catalog {entry.capturedRevision}</small><div className="checkpoint-tools"><button disabled={disabled} onClick={() => { setFirst(`saved:${entry.id}`); setSecond('current') }}>Compare with current</button><button disabled={disabled} onClick={() => setRename({ id: entry.id, name: entry.name, version: state.version })}>Rename checkpoint {index + 1}…</button><button disabled={disabled} onClick={() => setRemove({ id: entry.id, version: state.version })}>Delete checkpoint {index + 1}…</button></div></li>)}</ul>
    {renameEntry && rename && <form className="checkpoint-confirm" onSubmit={(event) => { event.preventDefault(); session.rename(rename.id, rename.name, rename.version) }}><label>New checkpoint name<input required maxLength={MAX_CHECKPOINT_NAME} value={rename.name} onChange={(event) => setRename({ ...rename, name: event.target.value })} /></label><div className="checkpoint-tools"><button disabled={disabled || !checkpointName(rename.name)}>Save checkpoint name</button><button type="button" onClick={() => setRename(null)}>Cancel rename</button></div></form>}
    {removeEntry && remove && <section className="checkpoint-confirm" aria-label="Review checkpoint deletion"><h3>Delete {removeEntry.name}?</h3><p>Delete this historical reference only. Active progress and Undo/Redo remain unchanged. Export the collection first to keep it.</p><div className="checkpoint-tools"><button disabled={disabled} onClick={() => session.remove(removeEntry.id, remove.version)}>Delete checkpoint</button><button onClick={() => setRemove(null)}>Cancel deletion</button></div></section>}
    {activeRestore && <section className="checkpoint-confirm" aria-label="Review checkpoint restore"><h3>Replace checkpoint collection?</h3><p>Replace these references only. Active progress and Undo/Redo stay unchanged. Export this collection first to keep both.</p><ul>{activeRestore.vault.entries.map((entry) => <li key={entry.id}>{entry.name}</li>)}</ul><div className="checkpoint-tools"><button disabled={disabled} onClick={() => session.restore(activeRestore.vault, activeRestore.version)}>Replace checkpoint collection</button><button onClick={() => { request.current++; setRestore(null) }}>Cancel checkpoint restore</button></div></section>}
    {activeRecovery && <section className="checkpoint-confirm" aria-label="Review checkpoint recovery"><h3>{activeRecovery.action === 'saved' ? 'Use checked saved checkpoints?' : 'Replace checked saved checkpoints?'}</h3><p>{activeRecovery.action === 'saved' ? 'Discard this local collection and use the checked saved references below.' : 'Replace the checked saved references below with this local collection.'} Active progress stays unchanged. Export this collection first to keep it.</p>{state.savedVault ? <ul>{state.savedVault.entries.map((entry) => <li key={entry.id}>{entry.name}</li>)}</ul> : <p>Saved data cannot be read as a supported checkpoint collection.</p>}<div className="checkpoint-tools"><button disabled={disabled} onClick={() => { if (activeRecovery.action === 'saved') session.useSaved(activeRecovery.version); else void session.save(true, activeRecovery.version); setRecovery(null) }}>Confirm checkpoint recovery</button><button onClick={() => setRecovery(null)}>Cancel checkpoint recovery</button></div></section>}
    {!!entries.length && <><h3>Read-only comparison</h3><div className="checkpoint-choices">{[{ key: 'first', title: 'First reference', value: firstChoice.value, select: setFirst }, { key: 'second', title: 'Second reference', value: secondChoice.value, select: setSecond }].map((side) => <fieldset key={side.key}><legend>{side.title}</legend>{choices.map((choice) => <label key={choice.value}><input type="radio" name={`${identity}-${side.key}`} checked={side.value === choice.value} onChange={() => side.select(choice.value)} />{choice.name}</label>)}</fieldset>)}</div>
      <p>Both sides use the same {visible.total} currently visible upgrades and current revealed milestones. A changed visible denominator is a view/catalog change, not an achievement or loss.</p>
      <dl className="checkpoint-summary"><div><dt>Owned purchases added</dt><dd>{gained.length}</dd></div><div><dt>Owned purchases removed</dt><dd>{removed.length}</dd></div><div><dt>Permanent/Astral ownership gained</dt><dd>{permanent.length}</dd></div><div><dt>Owned Astral locks activated</dt><dd>{activated.length}</dd></div></dl>
      <p>Current game {catalog.gameVersion} · Steam build {catalog.steamBuild}. Stored catalog context: {firstChoice.revision} → {secondChoice.revision}. Names are your own labels, not verified game history. No lifetime SP, playtime, speed or combined gameplay benefits are inferred.</p>
      <section className="checkpoint-cause" aria-label="Operation context"><h3>What explains the difference?</h3>{!meaningful ? <p>No differences in the currently visible recorded state or compared settings.</p> : context ? <><p>These states uniquely match recorded operations in this visit’s Undo/Redo history. {context.reversed ? 'The selected comparison reverses their chronological direction.' : 'Their selected order follows that recorded context.'} This is companion context, not a complete game activity log.</p><ul>{context.steps.map((action, index) => <li key={index}>{historyActionLabel(action)}</li>)}</ul>{!!context.cleared.length && <p>Matched native reset context cleared {context.cleared.length} currently visible repeat purchases. Net differences can also include other operations in the matched path.</p>}{!!context.activated.length && <p>Matched native reset context activated {context.activated.length} currently visible owned locks.</p>}</> : <p>No unique verified operation path matches these references in this visit. Prior-visit or imported snapshots do not establish a cause. A higher Ultra Ascension counter alone does not prove that a reset cleared purchases.</p>}</section>
      <ProgressComparison catalog={catalog} current={firstChoice.profile} incoming={secondChoice.profile} viewer={profile} currentLabel={firstChoice.name} incomingLabel={secondChoice.name} purpose="reference" />
    </>}
  </section>
}
