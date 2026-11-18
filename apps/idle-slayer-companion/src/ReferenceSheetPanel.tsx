import { useEffect, useState } from 'react'
import type { Catalog, Profile } from './domain/types'
import { createReferenceSheet, MAX_SHEET_UPGRADES } from './domain/reference-sheet'

export function ReferenceSheetPanel({ catalog, ids, getIds, viewer, getViewer, remove, clear }: {
  catalog: Catalog; ids: string[]; getIds: () => readonly string[]; viewer: Profile; getViewer: () => Profile; remove: (id: string) => void; clear: () => void
}) {
  const sheet = createReferenceSheet(catalog, viewer, ids)
  const [preview, setPreview] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const currentPreview = preview === sheet.html ? preview : null
  useEffect(() => { setPreview(null); setFeedback('') }, [sheet.html])
  function reviewed() {
    const current = createReferenceSheet(catalog, getViewer(), getIds())
    if (!preview || current.html !== preview || !current.ids.length) {
      setPreview(null); setFeedback('The visible selection changed. Review a fresh sheet before saving or printing.'); return null
    }
    return preview
  }
  function save() {
    const html = reviewed(); if (!html) return
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'idle-slayer-upgrade-reference.html'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setFeedback('Reviewed reference sheet saved. Open the local HTML file to read or print it.')
  }
  function print() {
    const html = reviewed(); if (!html) return
    const popup = window.open('', '_blank')
    if (!popup) { setFeedback('The browser blocked the print tab. Save the reviewed HTML file and use its browser Print command.'); return }
    popup.opener = null
    popup.document.open(); popup.document.write(html); popup.document.close()
    setFeedback('Reviewed sheet opened in a separate tab. Use the browser Print command to print or save as PDF.')
  }
  return <section className="reference-sheet-panel telemetry-private rr-block" aria-label="Reference sheet selection">
    <p>Choose up to {MAX_SHEET_UPGRADES} visible upgrades using Add to reference sheet in their expanded details. This selection lasts for this visit. The sheet contains public catalog facts only.</p>
    <ul>{sheet.ids.map((id) => <li key={id}><b>{catalog.upgrades.find((upgrade) => upgrade.id === id)!.title}</b><small>Native ID: {id}</small><button onClick={() => remove(id)} aria-label={`Remove sheet upgrade ${id}`}>Remove from sheet</button></li>)}</ul>
    {!sheet.ids.length && <p>No visible upgrades selected. Inspect an upgrade and add it from its expanded details.</p>}
    <button disabled={!sheet.ids.length} onClick={() => { const current = createReferenceSheet(catalog, getViewer(), getIds()); setPreview(current.ids.length ? current.html : null); setFeedback('') }}>Review outgoing sheet</button>
    <button disabled={!sheet.ids.length} onClick={clear}>Clear reference selection</button>
    {currentPreview && <><p>The document below is the complete outgoing file. It includes only the selected visible facts and their attribution. Requirement excerpts are not complete routes. No recorded progress or notes are included.</p><iframe title="Complete outgoing upgrade reference sheet" srcDoc={currentPreview} sandbox="" referrerPolicy="no-referrer" /><div className="reference-sheet-actions"><button onClick={save}>Save reviewed HTML</button><button onClick={print}>Open reviewed sheet for printing</button></div></>}
    <p aria-live="polite" aria-atomic="true">{feedback}</p>
  </section>
}
