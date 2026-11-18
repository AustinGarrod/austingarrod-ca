import { useRef, useState } from 'react'
import type { Catalog, Upgrade } from './domain/types'
import { upgradeReferenceURL } from './domain/upgrade-reference'

export function UpgradeReference({ catalog, upgrade }: { catalog: Catalog; upgrade: Upgrade }) {
  const [feedback, setFeedback] = useState('')
  const [manual, setManual] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const link = upgradeReferenceURL(new URL(import.meta.env.BASE_URL, window.location.origin).toString(), upgrade.id, catalog.revision)
  async function copy() {
    try { await navigator.clipboard.writeText(link); setFeedback('Upgrade reference copied.') }
    catch { setManual(true); setFeedback('Copy unavailable. Select and copy the reference below.') }
  }
  return <section className="upgrade-reference telemetry-private rr-block" aria-label="Share upgrade reference">
    <h3>Share or bookmark this upgrade</h3>
    <p>The link carries its public ID and catalog context. It opens using the recipient's own progress and spoiler setting. Facts follow their available catalog.</p>
    <button onClick={() => void copy()}>Copy upgrade reference</button>
    <a href={link} target="_blank" rel="noreferrer">Open reference in a new tab</a>
    <p className="reference-copy-feedback" aria-live="polite" aria-atomic="true">{feedback}</p>
    {manual && <><textarea ref={field} aria-label="Upgrade reference link" value={link} readOnly onFocus={() => field.current?.select()} /><button onClick={() => { field.current?.focus(); field.current?.select() }}>Select reference link</button></>}
  </section>
}
