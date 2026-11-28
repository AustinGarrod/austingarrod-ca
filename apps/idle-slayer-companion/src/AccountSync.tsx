import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { accountHref, peekSession, refreshSession } from '../../../packages/accounts/client'
import { mountAccountReminder } from '../../../packages/accounts/reminder'
import { AccountPersistenceContext } from './AccountPersistenceContext'
import { createCompanionAccountSync } from './account-sync'
import { accountKey, documentKeys, type DocumentName } from './account-storage'
import './account-sync.css'
import { Dialog } from './MapDialog'

const labels: Record<DocumentName, string> = { progress: 'Companion progress', intentions: 'Goals and crafting plans', checkpoints: 'Ascension checkpoints', comparison: 'Saved upgrade comparison' }
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
/** Authentication is optional; the legacy compatibility build never mounts this boundary. */
export function AccountSyncBoundary({ revision, children }: { revision: string; children: (controls: ReactNode, notice: ReactNode, onSavedChange?: () => void) => ReactNode }) {
  const controller = useMemo(() => {
    let storage: Storage
    try { storage = localStorage } catch { storage = { getItem: () => { throw new Error('Browser storage is unavailable. Existing saved data was kept.') }, setItem: () => { throw new Error('Browser storage is unavailable.') }, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } }
    return createCompanionAccountSync({ revision, storage, locks: () => navigator.locks, uuid: () => crypto.randomUUID(), enabled: true })
  }, [revision])
  const view = useSyncExternalStore(controller.subscribe, controller.getState)
  const reminder = useRef<ReturnType<typeof mountAccountReminder> | null>(null)
  const recordGuestEdit = useCallback(() => {
    if (!controller.getState().accountId && !peekSession()?.user) reminder.current?.recordChange()
  }, [controller])
  const bindReminder = useCallback((host: HTMLElement | null) => {
    if (!host) return
    const mounted = mountAccountReminder(host, {
      title: 'Sync your progress',
      description: 'Use a free account to sync your progress across devices.',
      returnTo: '/utilities/idle-slayer-companion/',
      offered: () => {
        const account = controller.getState()
        const session = peekSession()
        return !!session?.enabled && session.migrationEnabled && !session.user && !account.accountId && !account.unavailable && !!navigator.locks
      },
      fallbackFocus: () => document.getElementById('companion-content'),
    })
    reminder.current = mounted
    const unsubscribe = controller.subscribe(mounted.refresh)
    return () => { unsubscribe(); mounted.dispose(); reminder.current = null }
  }, [controller])
  const [opened, setOpened] = useState(false), [feedback, setFeedback] = useState('')
  const previousAccountCopy = !!view.accountId && view.session !== null && view.accountId !== view.session.user?.id
  useEffect(() => setOpened(false), [view.mount])
  useEffect(() => {
    const online = () => { void refreshSession().then(() => controller.sync()).catch(() => undefined) }
    const changed = (event: StorageEvent) => { if (event.key === null || (view.accountId && event.key === accountKey(view.accountId))) void controller.refreshExternal() }
    window.addEventListener('online', online); window.addEventListener('storage', changed)
    const interval = setInterval(() => { if (navigator.onLine) void controller.sync() }, 30_000)
    return () => { clearInterval(interval); window.removeEventListener('online', online); window.removeEventListener('storage', changed) }
  }, [controller, view.accountId])
  useEffect(() => { void controller.start(); return () => controller.dispose() }, [controller])
  function exportData(account: boolean) {
    try { const text = account ? controller.exportAccount() : controller.exportOriginals(); if (text) { download(text, account ? 'idle-slayer-account-recovery.json' : 'idle-slayer-browser-originals.json'); setFeedback('Recovery copy exported. Keep this private file.') } }
    catch { setFeedback('Recovery data could not be read. Use the existing progress and reference export controls before closing this visit.') }
  }
  const controls = <section className="companion-account telemetry-private rr-block" aria-label="Account and sync">
    <button type="button" aria-expanded={opened} onClick={() => setOpened(!opened)}>Account & sync{previousAccountCopy ? ' · Previous account copy' : view.conflicts.length ? ' · Review needed' : ''}</button>
    {opened && <Dialog title="Account & sync" close={() => setOpened(false)} dismissDisabled={view.busy} closeOnBackdrop={!view.preview && !view.conflicts.length}><div className="companion-account-panel">
      <p role="status">{view.status}</p>
      {feedback && <p role="status">{feedback}</p>}
      {previousAccountCopy && <p role="alert">A previous account’s saved device copy remains open for recovery. It cannot sync to the current login. Export this open copy and recover any unsaved changes before changing accounts.</p>}
      <p>{previousAccountCopy ? 'The open device copy is separate from the account shown on the account page.' : view.accountId ? 'Progress, intentions, checkpoints, and saved comparison use your account. Offline changes are kept on this device until they can sync.' : 'Your existing browser saves remain available. Signing in lets you review and connect them to one account.'} Layout and tracking preferences stay on this device.</p>
      <div className="companion-account-actions">
        {view.unavailable && !view.session
          ? <button type="button" disabled={view.busy} onClick={() => { void controller.retryConnection() }}>Retry connecting to accounts</button>
          : <a href={accountHref('/utilities/idle-slayer-companion/')}>{view.session?.user ? 'Manage account' : 'Sign in with email or Google'}</a>}
        {view.accountId && <button type="button" disabled={view.busy} onClick={() => { void controller.sync() }}>Sync now</button>}
        {view.session && view.accountId !== (view.session.user?.id ?? null) && <button type="button" disabled={view.busy} onClick={() => { void controller.recheckSession().catch(() => setFeedback('Account status could not be checked. This visit was kept.')) }}>Retry account connection</button>}
        {!view.accountId && view.session?.user && view.session.migrationEnabled && !view.preview && <button type="button" disabled={view.busy} onClick={() => { void controller.reviewMigration() }}>Review and connect saved data</button>}
        <button type="button" onClick={() => exportData(false)}>Export browser originals</button>
        {view.accountId && <button type="button" onClick={() => exportData(true)}>{previousAccountCopy ? 'Export previous account’s open device copy' : 'Export this open account’s device copy'}</button>}
      </div>
      {view.preview && <section aria-label="Review first account connection">
        <h3>Choose the copy for each document</h3>
        <p>All four documents connect together after verification. Original browser saves stay untouched, and both selected and device snapshots are kept for recovery. No progress is combined automatically.</p>
        {Object.entries(labels).map(([key, label]) => {
          const name = key as DocumentName, preview = view.preview!, remote = preview.remote[name]
          return <fieldset key={name} disabled={view.busy || preview.prepared}><legend>{label}</legend>
            <p>{preview.raw[documentKeys[name]] === null ? 'No current-format browser document. Any supported legacy data is included in the device copy.' : 'Saved browser document found.'} {remote ? `Account revision ${remote.revision} found.` : 'No account document yet.'}</p>
            <label><input type="radio" name={'connect-' + name} checked={preview.choices[name] === 'device'} onChange={() => controller.choose(name, 'device')} />Use this device</label>
            {remote && <label><input type="radio" name={'connect-' + name} checked={preview.choices[name] === 'account'} onChange={() => controller.choose(name, 'account')} />Use account copy</label>}
          </fieldset>
        })}
        <div className="companion-account-actions"><button type="button" disabled={view.busy || Object.values(view.preview.choices).some((choice) => !choice)} onClick={() => { void controller.adopt() }}>{view.preview.prepared ? 'Retry prepared connection and verification' : 'Connect and verify all saved data'}</button>{view.preview.prepared && <button type="button" disabled={view.busy} onClick={() => { void controller.restartReview() }}>Preserve this attempt and review current copies</button>}<button type="button" disabled={view.busy} onClick={controller.cancelReview}>Cancel</button></div>
      </section>}
      {view.conflicts.map((name) => <section key={name} aria-label={'Review ' + labels[name] + ' conflict'}><h3>{labels[name]} changed elsewhere</h3><p>The device copy and account copy differ. Both are preserved before applying your choice.</p><div className="companion-account-actions"><button disabled={view.busy} onClick={() => { void controller.resolve(name, 'device') }}>Use device copy</button><button disabled={view.busy} onClick={() => { void controller.resolve(name, 'account') }}>Use account copy</button></div></section>)}
      <p><a href="/account/">Account recovery copies</a> are available after connection. Backups, restores and transfer stay in Data &amp; backup.</p>
    </div></Dialog>}
  </section>
  if (view.loading) return <main className="loading"><h1>Idle Slayer Companion</h1><p role="status">Opening saved account data… Browser originals are kept.</p></main>
  return <AccountPersistenceContext.Provider key={view.mount} value={controller.getPersistence()}>{children(controls, <aside ref={bindReminder} id="companion-account-reminder" hidden />, view.accountId ? undefined : recordGuestEdit)}</AccountPersistenceContext.Provider>
}
