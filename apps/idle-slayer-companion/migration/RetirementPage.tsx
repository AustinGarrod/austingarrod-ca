import { useEffect, useMemo, useState } from 'react'
import type { Catalog } from '../src/domain/types'
import { reviewMigrationFragment, WEBSITE_COMPANION_URL, type MigrationLink } from '../src/migration-link'
import { createRetirementExports, type RetirementExportKind } from './retirement-exports'

const plain: MigrationLink = { href: WEBSITE_COMPANION_URL + '?migration=1#analytics=off', kind: 'plain' }
const backups = [
  { kind: 'progress', title: 'Companion progress', action: 'Export Companion progress', description: 'Your recorded progress across Ascension and the companion systems.', restore: 'Backup & transfer → Restore Companion progress' },
  { kind: 'intentions', title: 'Intentions', action: 'Export intentions', description: 'Your progression goals and crafting plans.', restore: 'Backup & transfer → Restore intentions' },
  { kind: 'checkpoints', title: 'Checkpoints', action: 'Export checkpoints', description: 'Your saved Ascension progress snapshots.', restore: 'Ascension → Progress → Progress checkpoints → Restore checkpoints' },
  { kind: 'comparison', title: 'Saved comparison', action: 'Export comparison', description: 'Your saved upgrade comparison, using your current spoiler setting.', restore: 'Ascension → Map options → Saved upgrade comparison → Restore comparison' },
] as const

export function RetirementPage({ catalog, initialFragment }: { catalog: Catalog; initialFragment: string }) {
  const reader = useMemo(() => createRetirementExports({ storage: () => localStorage, catalog }), [catalog])
  const [snapshot, setSnapshot] = useState(() => reader.read())
  const [feedback, setFeedback] = useState('Choose the backups you use, then restore them in the new app in the order below.')
  const [destination, setDestination] = useState(plain)
  const [checkingLink, setCheckingLink] = useState(Boolean(initialFragment))
  const [online, setOnline] = useState(navigator.onLine)
  const [offlineNote, setOfflineNote] = useState('')
  useEffect(() => {
    const changed = () => setSnapshot(reader.read())
    window.addEventListener('storage', changed)
    window.addEventListener('pageshow', changed)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('pageshow', changed) }
  }, [reader])
  useEffect(() => {
    let sequence = 0
    const receive = (fragment: string) => {
      const ticket = ++sequence
      setDestination(plain)
      setCheckingLink(Boolean(fragment))
      try { history.replaceState(history.state, '', location.pathname) } catch { /* No telemetry runs. */ }
      void reviewMigrationFragment(fragment).then((reviewed) => { if (sequence === ticket) { setDestination(reviewed); setCheckingLink(false) } }, () => { if (sequence === ticket) setCheckingLink(false) })
    }
    receive(initialFragment)
    const changedHistory = () => receive(location.hash)
    const changedHash = (event: HashChangeEvent) => {
      // A native fragment navigation fires popstate before hashchange. The
      // first receiver has already cleaned the address when the second runs.
      let fragment = location.hash
      try { fragment = new URL(event.newURL).hash } catch { /* Synthetic events can omit newURL. */ }
      receive(fragment)
    }
    window.addEventListener('hashchange', changedHash); window.addEventListener('popstate', changedHistory)
    return () => { sequence++; window.removeEventListener('hashchange', changedHash); window.removeEventListener('popstate', changedHistory) }
  }, [initialFragment])
  useEffect(() => {
    let active = true
    let registration: ServiceWorkerRegistration | undefined
    const connect = () => { setOnline(navigator.onLine); if (navigator.onLine) void registration?.update().catch(() => {}) }
    window.addEventListener('online', connect); window.addEventListener('offline', connect)
    if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL, updateViaCache: 'none' })
        .then((value) => { registration = value })
        .catch(() => { if (active) setOfflineNote('Offline access could not be prepared. Export your files while this page is open.') })
    }
    return () => { active = false; window.removeEventListener('online', connect); window.removeEventListener('offline', connect) }
  }, [])
  function download(kind: RetirementExportKind) {
    const result = reader.export(kind)
    setSnapshot(reader.read())
    if (!result.ok) { setFeedback(result.message); return }
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([result.text], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = result.filename
      document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove() }
      const completedURL = url
      window.setTimeout(() => URL.revokeObjectURL(completedURL), 1000)
      setFeedback('Backup download requested. Keep the file and your old browser data until you have checked the restored result.')
    } catch {
      if (url) URL.revokeObjectURL(url)
      setFeedback('The browser could not start the download. Allow downloads and try again. Your saved data has been kept.')
    }
  }
  const recovery = (['legacy-map', 'legacy-intentions'] as const).filter((kind) => snapshot.exports[kind].status !== 'missing')
  return <main className="retirement-page telemetry-private rr-block" data-analytics-private>
    <header className="retirement-header">
      <p className="retirement-eyebrow">Idle Slayer Companion · New home</p>
      <h1>Idle Slayer Companion has moved</h1>
      <p className="retirement-intro">Continue on AustinGarrod.ca. This old app is retired; this page is here to help you move your saved data.</p>
      <a className="retirement-primary" role="link" tabIndex={0} aria-disabled={checkingLink || undefined} href={checkingLink ? undefined : destination.href} rel="noreferrer" onClick={(event) => { if (checkingLink) event.preventDefault() }}>Open new app <span aria-hidden="true">↗</span></a>
      <p className="retirement-domain">austingarrod.ca/utilities/idle-slayer-companion/</p>
      {checkingLink && <p>Checking the incoming link locally before continuing…</p>}
      {destination.kind === 'transfer' && <p>The link carries your incoming map-only transfer. Review and confirm it in the new app before any progress changes.</p>}
      {destination.kind === 'reference' && <p>The link keeps the public upgrade reference and uses your progress in the new app.</p>}
    </header>
    <section className="retirement-backups" aria-labelledby="backups-heading">
      <div className="retirement-section-heading"><p className="retirement-eyebrow">Move your saved data</p><h2 id="backups-heading">Export here. Restore in the new app.</h2><p>Browser data stays at this old address. Download each backup you use, then restore the files in this order. Each restore asks you to review it first.</p></div>
      <p className="retirement-status" role="status">{feedback}</p>
      {Object.values(snapshot.exports).some((row) => row.status === 'unavailable') && <div className="retirement-retry"><button onClick={() => { setSnapshot(reader.read()); setFeedback('Saved data checked again. Your browser data has been kept.') }}>Retry reading backups</button></div>}
      <ol className="retirement-backup-list">{backups.map((backup) => {
        const row = snapshot.exports[backup.kind]
        const legacyMap = backup.kind === 'progress' && row.format === 'map'
        return <li key={backup.kind}>
          <div><h3>{legacyMap ? 'Ascension map progress' : backup.title}</h3><p>{legacyMap ? 'Your original Ascension Map backup. Companion observations are not included.' : backup.description}</p><p className="retirement-restore"><strong>Restore in:</strong> {legacyMap ? 'Ascension → Progress → Restore JSON backup' : backup.restore}</p><p className={row.status === 'invalid' || row.status === 'unavailable' ? 'retirement-error' : 'retirement-data-status'}>{row.message}</p></div>
          <button onClick={() => download(backup.kind)} disabled={row.status !== 'ready'}>{legacyMap ? 'Export Ascension map progress' : backup.action}</button>
        </li>
      })}</ol>
      {snapshot.warnings.length > 0 && <div className="retirement-warning">{snapshot.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
      {recovery.length > 0 && <details className="retirement-recovery"><summary>Other saved copies</summary><p>An older map copy may differ from your Companion data. These are separate backups; nothing is merged or changed here.</p>{recovery.map((kind) => <div key={kind}><p>{snapshot.exports[kind].message}</p>{kind === 'legacy-intentions' && <p>Restoring this alternate intentions file replaces destination intentions, including crafting plans. Keep your main intentions backup too.</p>}<button disabled={snapshot.exports[kind].status !== 'ready'} onClick={() => download(kind)}>{kind === 'legacy-map' ? 'Export legacy map copy' : 'Export legacy intentions copy'}</button></div>)}</details>}
      <p className="retirement-footnote">Restore progress first. Before restoring comparison, choose your intended spoiler setting. Comparison backups omit known unrevealed upgrades. Choose layout and tracking preferences again in the new app.</p>
    </section>
    <footer className="retirement-footer">
      <p>Keep these files and your old browser data until you have checked the restored result. Install the new app separately. Undo history and open plans do not transfer.</p>
      {!online && <p>You are offline. Available backups can still be downloaded here; reconnect to open the new app.</p>}
      {offlineNote && <p>{offlineNote}</p>}
      <p>For an older installed copy, reconnect, close every old Companion tab and app window, then reopen to receive this page. Updates never force an open window to reload.</p>
      <p><a href={import.meta.env.BASE_URL + 'licenses/index.html'}>Licenses and attribution</a><span aria-hidden="true"> · </span>No analytics or technical reporting on this page. Opening the new app starts with usage tracking off.</p>
    </footer>
  </main>
}
