import type { Upgrade } from './domain/types'
import { Icon } from './UpgradeCard'
import './RecentUpgrades.css'

export function RecentUpgrades({ upgrades, visibleUpgrades, selected, onSelect, onClear }: {
  upgrades: Upgrade[]; visibleUpgrades: Upgrade[]; selected: string | null; onSelect: (id: string) => void; onClear: () => void
}) {
  const titles = new Map<string, number>()
  for (const node of visibleUpgrades) titles.set(node.title, (titles.get(node.title) ?? 0) + 1)
  return <section className="recent-upgrades telemetry-private rr-block" aria-label="Recently inspected upgrades">
    <p>Return to an upgrade inspected during this visit. Newest first, up to 20 different upgrades. This list clears on reload; entries disappear when they are hidden. Returning changes only your map view, independently of progress Undo.</p>
    {upgrades.length ? <><ol>{upgrades.map((node) => <li key={node.id}><button data-upgrade-id={node.id} aria-current={selected === node.id ? 'true' : undefined} onClick={() => onSelect(node.id)}>
      <Icon node={node} /><span><b>{node.title}</b><small>{BigInt(node.cost).toLocaleString('en')} SP</small>{(titles.get(node.title) ?? 0) > 1 && <small>ID: {node.id}</small>}{selected === node.id && <small>Currently selected</small>}</span>
    </button></li>)}</ol><button onClick={onClear}>Clear recent upgrades</button></> : <p>No recently inspected visible upgrades. Select an upgrade on the map or in search to begin exploring.</p>}
  </section>
}
