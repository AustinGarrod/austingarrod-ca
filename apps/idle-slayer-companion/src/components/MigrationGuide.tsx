import { useSyncExternalStore } from 'react'
import { runtimeDeployment } from '../runtime-deployment'
import { getMigrationLink, subscribeMigrationLink } from '../migration-link'
import './MigrationGuide.css'

/** Guidance only: the existing reviewed export/import controls own every document. */
export function MigrationGuide() {
  const legacy = runtimeDeployment.target === 'legacy-migration'
  const destination = useSyncExternalStore(subscribeMigrationLink, getMigrationLink, getMigrationLink)
  return <section className={`migration-guide${legacy ? ' migration-guide-legacy' : ''} telemetry-private rr-block`} data-analytics-private aria-label="Move Companion progress">
    {legacy && <div className="migration-notice"><div><p className="migration-eyebrow">New home</p><h2>Idle Slayer Companion has moved</h2><p>This GitHub Pages copy is kept for backup and recovery. Your progress is still in this browser; it does not move automatically.</p></div><a className="migration-open" href={destination.href} rel="noreferrer">Open new utility</a></div>}
    <details>
      <summary>{legacy ? 'Move your progress with existing JSON backups' : 'Moving progress from the old GitHub Pages app?'}</summary>
      <div className="migration-instructions">
        <p>In the old app, export each file you use. In the new utility, restore them in this order and review each preview before applying:</p>
        <ol>
          <li><strong>Companion progress.</strong> Open <strong>Backup &amp; transfer</strong>, then <strong>Export Companion progress</strong>. On the new site, choose <strong>Restore Companion progress</strong>.</li>
          <li><strong>Intentions.</strong> In the same panel, use <strong>Export intentions</strong> and <strong>Restore intentions</strong> for goals and crafting plans.</li>
          <li><strong>Checkpoints.</strong> In <strong>Ascension → Progress → Progress checkpoints</strong>, export and restore the checkpoint collection separately.</li>
          <li><strong>Saved comparison.</strong> In <strong>Ascension → Map options → Saved upgrade comparison</strong>, export and restore the comparison separately.</li>
        </ol>
        <p>Comparison exports include only currently visible upgrades. Restore progress first and choose your intended spoiler setting before restoring the comparison; nothing enables spoilers for you.</p>
        <p>Select Game/Detailed Layout, spoiler visibility, and Privacy &amp; tracking again on the new site. QR links transfer Ascension map progress and layout only. Undo history, recent navigation, open plans, reference sheets, and installed app files do not transfer.</p>
        <p>If you only used the original Ascension Map, its existing map JSON backup still restores through Ascension. Export intentions from this Companion copy after reviewing any legacy-goals recovery. Keep the old files and browser data until you have checked the restored result.</p>
        {legacy && <><p>To receive this move notice in an older installed copy, reconnect, close every old Companion tab/app window, then reopen online. Export a backup before uninstalling. Install the new-domain utility separately.</p><p>This recovery copy sends no analytics or technical reports. Opening the new utility from here starts with usage tracking off; choose your new-domain preference explicitly.</p>{destination.kind === 'transfer' && <p className="migration-transfer-note">The link above carries the reviewed incoming map-only transfer. The new site will ask you to review it; it does not replace progress automatically.</p>}{destination.kind === 'reference' && <p>The link above keeps the public upgrade reference and uses your own progress on the new site.</p>}</>}
      </div>
    </details>
  </section>
}
