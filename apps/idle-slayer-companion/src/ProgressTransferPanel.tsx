import { useEffect, useId, useRef, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import type { MapLayoutMode } from './domain/map-layout'
import { visibleProgress } from './domain/progress-summary'
import type { TransferQrResult } from './domain/transfer-qr'

export type TransferPreview = { profile: Profile; layout: MapLayoutMode; original: Profile }
export function ProgressTransferPanel({ catalog, profile, layout, mode, busy, generated, preview, onGenerate, onReceive, onApply, onCancel, onBackup }: {
  catalog: Catalog; profile: Profile; layout: MapLayoutMode; mode: 'send' | 'receive'; busy: boolean
  generated: { link: string; qr: TransferQrResult } | null; preview: TransferPreview | null
  onGenerate: () => void; onReceive: (input: string) => void; onApply: () => void; onCancel: () => void; onBackup: () => void
}) {
  const [draft, setDraft] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const linkField = useRef<HTMLTextAreaElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const generatedHeading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  const name = (value: MapLayoutMode) => value === 'native' ? 'Game Layout' : 'Detailed Layout'
  useEffect(() => {
    if (preview) previewHeading.current?.focus({ preventScroll: true })
    else if (generated) generatedHeading.current?.focus({ preventScroll: true })
  }, [generated, preview])
  async function copy() {
    if (!generated) return
    try { await navigator.clipboard.writeText(generated.link); setCopyStatus('Transfer link copied. Paste it into Receive transfer on the other device.') }
    catch { linkField.current?.focus(); linkField.current?.select(); setCopyStatus('Copy the selected link, then paste it into Receive transfer on the other device.') }
  }
  if (preview) {
    const current = visibleProgress(catalog, profile, profile.showSpoilers), incoming = visibleProgress(catalog, preview.profile, profile.showSpoilers)
    const rows = [
      { label: 'Ultra Ascensions', current: profile.epoch, incoming: preview.profile.epoch },
      { label: 'Owned upgrades', current: current.owned, incoming: incoming.owned },
      { label: 'Active Astral locks', current: current.activeLocks, incoming: incoming.activeLocks },
      { label: 'Pending Astral locks', current: current.pendingLocks, incoming: incoming.pendingLocks },
      { label: 'Map milestones', current: current.milestones, incoming: incoming.milestones },
    ]
    return <div className="progress-transfer telemetry-private rr-block">
      <h3 ref={previewHeading} tabIndex={-1}>Review transfer</h3>
      <p>Review this snapshot before replacing Ascension purchases, history and reviewed map milestones. Companion observations and existing milestones outside the reviewed map are kept. Unrecognized IDs in the transfer are retained. Undo is available in this session.</p>
      <table className="game-save-import-comparison" aria-describedby={id}><caption>Transfer progress preview</caption><thead><tr><th scope="col">Progress</th><th scope="col">Current</th><th scope="col">After transfer</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.current.toLocaleString('en')}</td><td>{row.incoming.toLocaleString('en')}</td></tr>)}</tbody></table>
      <p id={id}>Counts follow this map's current spoiler setting. The complete profile is applied, including recorded progress outside this preview.</p>
      <dl><dt>Layout</dt><dd>{name(layout)} → {name(preview.layout)}</dd><dt>Spoiler preference after transfer</dt><dd>{preview.profile.showSpoilers ? 'Shown' : 'Hidden'}</dd></dl>
      <p>Your tracking preference stays independent. Applying changes only this browser's map; there is no ongoing synchronization.</p>
      <div className="dialog-actions"><button className="primary" disabled={busy} onClick={onApply}>Apply transfer</button><button onClick={onCancel}>Cancel</button></div>
    </div>
  }
  if (mode === 'receive') return <div className="progress-transfer telemetry-private rr-block">
    <p>Paste a transfer link copied from the other device. A local preview appears before progress changes.</p>
    <form onSubmit={(event) => { event.preventDefault(); onReceive(draft) }}><label htmlFor={id}>Transfer link or code</label><textarea id={id} value={draft} onChange={(event) => setDraft(event.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} /><div className="dialog-actions"><button className="primary" disabled={busy}>Review transfer</button><button type="button" onClick={onCancel}>Cancel</button></div></form>
    {busy && <p>Reading transfer locally…</p>}
  </div>
  return <div className="progress-transfer telemetry-private rr-block">
    <p>Copy a snapshot of current map progress and layout to another device. Anyone with the code or link can copy this profile; share it privately.</p>
    {busy ? <p>Creating transfer locally…</p> : generated ? <>
      <h3 ref={generatedHeading} tabIndex={-1}>Transfer snapshot ready</h3>
      {generated.qr.status === 'ready' ? <><div className="transfer-qr" dangerouslySetInnerHTML={{ __html: generated.qr.svg }} /><p>On your phone, scan with its camera, open the link, then review and apply in the browser.</p></> : <p>This snapshot is too large for a readable single QR code. Copy and paste the link into Receive transfer on the other device, or use Export JSON backup.</p>}
      <label htmlFor={id}>Private transfer link</label><textarea id={id} ref={linkField} value={generated.link} readOnly autoComplete="off" spellCheck={false} />
      <button onClick={() => { void copy() }}>Copy transfer link</button><p role="status">{copyStatus}</p>
    </> : <button className="primary" onClick={onGenerate}>Create transfer snapshot</button>}
    <p>Generation and decoding happen locally. The transfer contains normalized map progress and layout. Tracking preferences and native game files are excluded.</p>
    <div className="dialog-actions"><button onClick={onBackup}>Export JSON backup</button><button onClick={onCancel}>Close</button></div>
  </div>
}
