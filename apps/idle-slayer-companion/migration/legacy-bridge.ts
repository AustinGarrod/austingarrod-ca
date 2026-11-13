import { COMPANION_STORAGE_KEY, exportCompanionBackup, parseCompanionStored } from '../src/domain/companion-storage'
import { exportProfileBackup, parseProfileBackup, PROFILE_STORAGE_KEY } from '../src/domain/storage'
import { MAX_TRANSFER_TOKEN_CHARS } from '../src/domain/progress-transfer'
import { parseUpgradeReference } from '../src/domain/upgrade-reference'
import { visibility } from '../src/domain/rules'
import { emptyProfile, type Catalog, type Profile } from '../src/domain/types'
import { reviewMigrationFragment } from '../src/migration-link'

const COMPANION_BASE = '/idle-slayer-companion/'
const LEGACY_BASE = '/idle-slayer-ascension-map/'

/** Compatibility launcher is deliberately independent of analytics and performs no storage writes. */
const target = new URL(COMPANION_BASE, location.origin)
const fragment = location.hash
const suffix = location.pathname.slice(LEGACY_BASE.length).replace(/(?:index\.html)?$/, '').replace(/\/$/, '')
if (['ascension', 'achievements', 'crafting', 'quests', 'bestiary', 'divinities'].includes(suffix)) target.pathname += suffix + '/'
void reviewMigrationFragment(fragment).then((reviewed) => { const destination = document.querySelector<HTMLAnchorElement>('#new-home'); if (destination) destination.href = reviewed.href })
const reference = parseUpgradeReference(fragment)
if (fragment === '#analytics=off') target.hash = fragment
else if (reference?.kind === 'reference') target.hash = new URLSearchParams({ upgrade: reference.id, catalog: reference.revision }).toString()
else if (fragment.startsWith('#transfer=') && fragment.length <= MAX_TRANSFER_TOKEN_CHARS + 10 && /^#transfer=v1\.[a-zA-Z0-9_-]+$/.test(fragment)) target.hash = fragment
try { history.replaceState(null, '', location.pathname) } catch { /* No analytics or third-party code runs here. */ }
const open = document.querySelector<HTMLAnchorElement>('#open')!
open.href = target.href
if (navigator.onLine) location.replace(target.href)
else {
  const status = document.querySelector<HTMLElement>('#status')!
  const button = document.querySelector<HTMLButtonElement>('#export')!
  void fetch(LEGACY_BASE + 'catalog.json').then((response) => { if (!response.ok) throw new Error(); return response.json() as Promise<Catalog> }).then((catalog) => {
    let profile: Profile = emptyProfile(catalog.revision), backup: { text: string; filename: string } | undefined
    const current = localStorage.getItem(COMPANION_STORAGE_KEY)
    if (current !== null) {
      const parsed = parseCompanionStored(current, catalog.revision)
      if (!parsed.ok) throw new Error()
      profile = parsed.value.progress.ascension
      const exported = exportCompanionBackup(parsed.value.progress)
      if (exported.ok) backup = { text: exported.value, filename: 'idle-slayer-companion-progress.json' }
    } else {
      const legacy = localStorage.getItem(PROFILE_STORAGE_KEY)
      if (legacy !== null) { const parsed = parseProfileBackup(legacy, catalog.revision); if (!parsed.ok) throw new Error(); profile = parsed.profile }
      const exported = exportProfileBackup(profile)
      if (exported.ok) backup = { text: exported.text, filename: 'idle-slayer-ascension-progress.json' }
    }
    status.textContent = 'You are offline. Your saved map and export remain available here.'
    button.disabled = !backup
    button.onclick = () => {
      if (!backup) return
      const url = URL.createObjectURL(new Blob([backup.text], { type: 'application/json' })), anchor = document.createElement('a')
      anchor.href = url; anchor.download = backup.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    const visible = visibility(catalog, profile), namespace = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(namespace, 'svg')
    const xs = visible.upgrades.map((node) => node.position.x), ys = visible.upgrades.map((node) => -node.position.y)
    const minX = Math.min(0, ...xs) - 80, minY = Math.min(0, ...ys) - 80
    svg.setAttribute('viewBox', `${minX} ${minY} ${Math.max(...xs, 0) - minX + 80} ${Math.max(...ys, 0) - minY + 80}`)
    const nodes = new Map(visible.upgrades.map((node) => [node.id, node]))
    for (const edge of visible.connections) {
      const from = nodes.get(edge.from)!, to = nodes.get(edge.to)!, line = document.createElementNS(namespace, 'line')
      for (const [key, value] of Object.entries({ x1: from.position.x, y1: -from.position.y, x2: to.position.x, y2: -to.position.y })) line.setAttribute(key, String(value))
      line.setAttribute('stroke', profile.purchases[from.id] ? '#ff00be' : '#7d7d7d'); line.setAttribute('stroke-width', '12'); svg.append(line)
    }
    for (const node of visible.upgrades) {
      const group = document.createElementNS(namespace, 'g'), circle = document.createElementNS(namespace, 'circle'), icon = document.createElementNS(namespace, 'image')
      group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0'); group.setAttribute('aria-label', node.title)
      circle.setAttribute('cx', String(node.position.x)); circle.setAttribute('cy', String(-node.position.y)); circle.setAttribute('r', '50'); circle.setAttribute('fill', '#231e19'); circle.setAttribute('stroke', '#d6ae61'); circle.setAttribute('stroke-width', '5')
      icon.setAttribute('href', LEGACY_BASE + node.icon); icon.setAttribute('x', String(node.position.x - 32)); icon.setAttribute('y', String(-node.position.y - 32)); icon.setAttribute('width', '64'); icon.setAttribute('height', '64')
      group.append(circle, icon)
      const inspect = () => { const detail = document.querySelector('#detail')!; detail.replaceChildren(); const title = document.createElement('h2'), description = document.createElement('p'), cost = document.createElement('p'); title.textContent = node.title; description.textContent = node.description; cost.textContent = `${node.cost} SP · ${profile.purchases[node.id] ? 'Owned' : 'Not recorded as owned'}`; detail.append(title, description, cost) }
      group.onclick = inspect; group.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect() } }; svg.append(group)
    }
    document.querySelector('#map')!.append(svg)
  }).catch(() => { status.textContent = 'Saved progress could not be safely read. Reconnect and use Companion recovery; do not clear browser data.' })
}
if ('serviceWorker' in navigator && isSecureContext) void navigator.serviceWorker.register(LEGACY_BASE + 'sw.js', { scope: LEGACY_BASE }).catch(() => {})
