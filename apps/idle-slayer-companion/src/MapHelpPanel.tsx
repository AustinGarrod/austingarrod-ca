/** Optional guidance uses public concepts only; opening it never changes progress. */
export function MapHelpPanel({ onProgress, onMilestones, onSpoilers }: {
  onProgress: () => void
  onMilestones: () => void
  onSpoilers: () => void
}) {
  return <section className="map-help" aria-label="Starting and recording progress">
    <h3>Start with your game progress</h3>
    <p>Explore with spoilers hidden. Select a tile to read its effect, exact cost and requirements. This companion records what happened in your game; it never purchases or changes anything in the game.</p>
    <p>For existing Windows Steam 7.3.4 progress (or legacy 7.2.0 map progress), open Progress → Import game save… and choose your save locally. Review the preview before applying. For manual setup, record your previous Ultra Ascension count, purchases and the required milestone items. Missing OR paths need your choice before purchases are applied.</p>
    <button onClick={onProgress}>Open Progress</button>
    <h3>Map states</h3>
    <dl className="map-help-legend">
      <dt>+ Available</dt><dd>The recorded native requirements are met. This does not establish that you can afford the game's SP cost.</dd>
      <dt>◇ Locked</dt><dd>Native requirements are not all recorded. A visible tile can remain locked.</dd>
      <dt>✓ Purchased and active</dt><dd>The upgrade is recorded as owned and active.</dd>
      <dt>◷ Owned · awaiting activation</dt><dd>An Astral lock is owned but pending. Buying it and activating it are separate states.</dd>
    </dl>
    <h3>Previous Ultra Ascensions and a new reset</h3>
    <p>The Ultra Ascensions counter is your recorded prior history. Record previous Ultra Ascensions to match an existing game; this does not apply a new reset or activate pending Astrals.</p>
    <p>Ultra Ascend… previews a new reset: repeat purchases clear, permanent ownership and milestones remain, and eligible Astral locks activate. Confirm only when you want that transition recorded. For an already activated lock in your existing game, use Already activated… in its details and review the separate confirmation.</p>
    <h3>Milestones and spoilers</h3>
    <p>Milestones mean the required item actually received, crafted or purchased, rather than an earlier event. Controls follow the same reveal rules as the map. When entering existing progress on an isolated branch, you can explicitly choose Show spoilers in Map options, then return to Milestones.</p>
    <div className="dialog-actions"><button onClick={onMilestones}>Open Milestones</button><button onClick={onSpoilers}>Review spoiler setting</button></div>
    <h3>Keep a backup</h3>
    <p>There is one local profile in this browser. Export a JSON backup regularly, especially before switching browsers or devices. Restore and import require confirmation. Undo is for this visit; changes from another tab can clear its history. Layout and tracking preferences are separate.</p>
  </section>
}
