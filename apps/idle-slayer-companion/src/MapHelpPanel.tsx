/** Optional guidance uses public concepts only; opening it never changes progress. */
export function MapHelpPanel({ onImport, onPriorAscensions, onMilestones, onSpoilers, spoilersShown }: {
  onImport?: () => void
  onPriorAscensions: () => void
  onMilestones: () => void
  onSpoilers: () => void
  spoilersShown: boolean
}) {
  return <section className="map-help" aria-label="Starting and recording progress">
    <h3>Start with your game progress</h3>
    <p>Explore with spoilers hidden. Select a tile to read its effect, exact cost and requirements. This companion records what happened in your game; it never purchases or changes anything in the game.</p>
    <p>For existing Windows Steam 7.3.4 progress (or legacy 7.2.0 map progress), open <b>Data → Import save…</b> and choose your save locally. Review the summary before applying. To set up by hand, record your previous Ultra Ascension count (<b>Record → Previous Ultra Ascensions…</b>), then purchases and the required milestone items. Missing OR paths need your choice before purchases are applied.</p>
    <div className="dialog-actions">{onImport && <button onClick={onImport}>Import save…</button>}<button onClick={onPriorAscensions}>Previous Ultra Ascensions…</button></div>
    <h3>The map tools</h3>
    <p><b>View</b> changes what you see: layout, spoilers, an overview of the whole visible map, refocusing your selection and recent upgrades. <b>Plan</b> holds goals, prerequisite routes, hypothetical Ultra Ascensions, the saved comparison, checkpoints and the reference sheet; none of them records progress. <b>Record</b> holds milestones and Ultra Ascensions. Undo and Redo are in the status row above the map (in Record on short phone screens). Backups, restore, transfer and clearing are in <b>Data</b>.</p>
    <h3>Map states</h3>
    <dl className="map-help-legend">
      <dt>+ Available</dt><dd>The recorded game requirements are met; the tile has a black badge. This does not establish that you can afford the game's SP cost.</dd>
      <dt>◇ Locked</dt><dd>Game requirements are not all recorded, and the artwork is dimmed. A visible tile can remain locked.</dd>
      <dt>✓ Purchased and active</dt><dd>The upgrade is recorded as owned and active.</dd>
      <dt>◷ Owned · awaiting activation</dt><dd>An Astral lock is owned but pending. Buying it and activating it are separate states.</dd>
    </dl>
    <h3>Previous Ultra Ascensions and a new reset</h3>
    <p>The Ultra Ascensions counter is your recorded prior history. Record previous Ultra Ascensions to match an existing game; this does not apply a new reset or activate pending Astrals.</p>
    <p>Record Ultra Ascension… previews a new reset: repeat purchases clear, permanent ownership and milestones remain, and eligible Astral locks activate. Confirm only when you want that transition recorded. For an already activated lock in your existing game, use Already activated… in its details and review the separate confirmation.</p>
    <h3>Milestones and spoilers</h3>
    <p>Milestones mean the required item actually received, crafted or purchased, rather than an earlier event. Controls follow the same reveal rules as the map. When entering existing progress on an isolated branch, you can explicitly show spoilers (under View), then return to Milestones.</p>
    <div className="dialog-actions"><button onClick={onMilestones}>Open Milestones</button><button onClick={onSpoilers} disabled={spoilersShown}>{spoilersShown ? 'Spoilers shown' : 'Show spoilers'}</button></div>
    <h3>Keep a backup</h3>
    <p>There is one local profile in this browser. Use <b>Data → Back up everything</b> regularly, especially before switching browsers or devices. Restore and import require confirmation. Undo is for this visit; changes from another tab can clear its history. Layout and tracking preferences are separate.</p>
  </section>
}
