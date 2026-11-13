import { checkForUpdate, promptInstall, usePwaStatus } from './pwa'

export function InstallPanel({ onReload, onRepair, progressStatus, repairBusy = false }: { onReload?: () => void; onRepair: () => void; progressStatus?: string; repairBusy?: boolean }) {
  const status = usePwaStatus()
  return <div className="install-panel">
    <p>{status.installed ? 'Installed in this browser. Open from its home-screen or desktop icon.' : 'Add Idle Slayer Companion to your home screen or desktop, then open it in its own window.'}</p>
    {!status.installed && status.canInstall && <button className="primary" onClick={() => { void promptInstall() }}>Install Idle Slayer Companion</button>}
    {!status.installed && !status.canInstall && <p>This browser has not offered an install prompt. Its menu may still support installation:</p>}
    {!status.installed && <ul className="install-guidance">
      <li><b>Android:</b> In Chrome or another supporting browser, open its menu and choose Install app or Add to Home screen. Menu wording varies.</li>
      <li><b>iPhone / iPad:</b> Open in Safari, tap Share (on iPad this may be in the toolbar), then Add to Home Screen. Enable Open as Web App if offered.</li>
      <li><b>Desktop:</b> Supporting Chrome/Edge browsers offer an install icon in the address bar or an Install app menu action. On supported macOS Safari versions, use File → Add to Dock. Other browsers may offer only a bookmark.</li>
    </ul>}
    <p className="offline-status" role="status">{status.offline === 'ready' ? 'Public app files are saved for offline reopening.' : status.offline === 'loading' ? 'Downloading and verifying offline app files… Keep this window online until ready.' : status.offline === 'unsupported' ? 'Offline installation is unavailable in this browser or development preview. Use a supported browser over HTTPS.' : 'Offline app files are not ready. Reconnect and retry; browser storage may be blocked or full.'} {status.online ? '' : 'You are offline.'}</p>
    <p>Once ready, reopen offline with Ascension, achievements, crafting, quests, Bestiary, Divinities, and your local progress actions. A first visit and external sources need internet.</p>
    {progressStatus && <p className="progress-save-status">{progressStatus}</p>}
    <p>Updates wait until every old companion tab and app window closes. Finish previews, save or export progress in each window, then close all and reopen. Reloading an open window keeps its old release. Closing ends session-only Undo.</p>
    {status.message && <p role="status">{status.message}</p>}
    <div className="dialog-actions">
      <button onClick={() => { void checkForUpdate() }}>Check update / retry download</button>
      {status.update && onReload && <button className="primary" onClick={onReload}>Prepare app update…</button>}
      <button disabled={repairBusy} onClick={onRepair}>Repair offline files and reload…</button>
    </div>
    <details><summary>Storage, privacy and recovery</summary>
      <p>Progress is stored by this browser on this device. Installed apps may use separate storage, especially on Apple devices; check your progress after installing and use a JSON backup to move it if needed. Export regular backups. Browser cleanup, storage eviction or uninstalling may remove app files or progress.</p>
      <p>Offline app files include all reviewed catalogs, icons, section pages, fonts and bundled software licenses. The browser may show its own offline error before the first download completes. Repair downloads the app again after reconnecting and keeps progress storage; it does not clear browser data.</p>
      <p>Updates keep saved companion observations, purchases, Astrals, milestones, unknown entries, layout and tracking preferences. Only public app files are cached; saves, backups, transfers and analytics are excluded. Offline usage is never queued for later tracking.</p>
      <p>The Companion keeps the previous Ascension Map installation identity on this origin. Browsers handle installation updates differently. Reopen online to refresh an existing installation; if it still opens the legacy page, export your backups and follow your browser’s reinstall guidance. A working browser preview does not verify a physical home-screen launch.</p>
    </details>
  </div>
}
