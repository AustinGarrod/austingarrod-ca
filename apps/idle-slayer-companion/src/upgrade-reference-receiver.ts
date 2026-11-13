import { parseUpgradeReference, type UpgradeReference } from './domain/upgrade-reference'
import { sectionAtPath, sectionPath } from './domain/companion-navigation'

type Delivery = { sequence: number; reference: UpgradeReference }
let current: Delivery | null = null
const listeners = new Set<() => void>()
export const subscribeUpgradeReference = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getUpgradeReference = () => current

/** Capture before telemetry installs its guards, then clean before yielding startup. */
export function initializeUpgradeReferences(win: Window, basePath: string) {
  const canonical = new URL(basePath, win.location.origin)
  function capture() {
    const reference = parseUpgradeReference(win.location.hash)
    if (reference) {
      current = { sequence: (current?.sequence ?? 0) + 1, reference }
      listeners.forEach((listener) => listener())
    }
  }
  function cleanAddress() {
    const clean = new URL(canonical)
    const section = sectionAtPath(win.location.pathname, basePath)
    if (section) clean.pathname = sectionPath(section, basePath)
    // This bounded opt-out sentinel must survive a failed preference write.
    if (win.location.hash === '#analytics=off') clean.hash = 'analytics=off'
    if (clean.toString() === win.location.href) return
    try {
      // Use the installed analytics wrapper on live navigation: it must see
      // a dirty address and permanently suspend any buffered recorder.
      win.history.replaceState(win.history.state, '', clean.toString())
    } catch { /* Analytics independently fails closed if URL cleanup fails. */ }
  }
  const receive = () => { capture(); cleanAddress() }
  capture()
  // Capture listeners precede tracker listeners and retain only the bounded
  // public reference; arbitrary query/hash contents are discarded universally.
  win.addEventListener('hashchange', receive, { capture: true })
  win.addEventListener('popstate', receive, { capture: true })
  return { cleanAddress }
}
