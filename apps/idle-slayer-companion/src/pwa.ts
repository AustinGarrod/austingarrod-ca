import { reportFailure, reportingAction } from './reporting'
import { useSyncExternalStore } from 'react'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
export interface PwaStatus {
  offline: 'loading' | 'ready' | 'unavailable' | 'unsupported'
  online: boolean
  installed: boolean
  canInstall: boolean
  update: boolean
  updateVersion: string | null
  message: string
}
const listeners = new Set<() => void>()
let status: PwaStatus = { offline: 'loading', online: navigator.onLine, installed: false, canInstall: false, update: false, updateVersion: null, message: '' }
let registration: ServiceWorkerRegistration | undefined
let installPrompt: InstallPrompt | undefined
let started = false
let refreshSequence = 0
let checking = false
let checkedAt = -Infinity
const updateInterval = 5 * 60_000
const resumeInterval = 30_000
function publish(next: Partial<PwaStatus>) {
  const { updateVersion: _version, ...diagnostics } = next
  reportingAction('pwa.status', diagnostics)
  status = { ...status, ...next }
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const usePwaStatus = () => useSyncExternalStore(subscribe, () => status)
function installed() { return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true }
interface WorkerReply { ready?: boolean; accepted?: boolean; version?: string; contentVersion?: string }
function request(worker: ServiceWorker, type: string, signal?: AbortSignal): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const channel = new MessageChannel()
    const cleanup = () => { window.clearTimeout(timer); channel.port1.close(); signal?.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Worker unavailable')) }, 8000)
    signal?.addEventListener('abort', cancel, { once: true })
    channel.port1.onmessage = (event) => { cleanup(); resolve(event.data) }
    worker.postMessage({ type }, [channel.port2])
  })
}
async function refresh() {
  const active = registration?.active
  const waiting = registration?.waiting
  const sequence = ++refreshSequence
  if (!active) { publish({ update: false, updateVersion: null }); return }
  const [current, next] = await Promise.allSettled([
    request(active, 'CHECK_READY'),
    waiting ? request(waiting, 'CHECK_READY') : Promise.resolve(null),
  ])
  if (sequence !== refreshSequence || active !== registration?.active || waiting !== registration?.waiting) return
  if (current.status === 'rejected') reportFailure(current.reason, 'pwa.readiness')
  if (next.status === 'rejected') reportFailure(next.reason, 'pwa.waiting-readiness')
  const activeContent = current.status === 'fulfilled' ? current.value.contentVersion : undefined
  const nextRelease = next.status === 'fulfilled' && next.value?.ready ? next.value : null
  const nextContent = nextRelease?.contentVersion ?? nextRelease?.version ?? null
  const updateVersion = nextContent === activeContent ? null : nextContent
  publish({ offline: current.status === 'fulfilled' && current.value.ready ? 'ready' : 'unavailable', update: updateVersion !== null, updateVersion })
}
export function initializePwa() {
  if (started) return
  started = true
  publish({ installed: installed() })
  const display = matchMedia('(display-mode: standalone)')
  display.addEventListener('change', () => publish({ installed: installed() }))
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPrompt = event as InstallPrompt
    publish({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => { installPrompt = undefined; publish({ installed: true, canInstall: false, message: 'Installation completed in this browser.' }) })
  window.addEventListener('offline', () => publish({ online: false }))
  window.addEventListener('online', () => { publish({ online: true }); void refreshFromNetwork(0) })
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) { publish({ offline: 'unsupported' }); return }
  navigator.serviceWorker.addEventListener('message', (event) => { if (event.data?.type === 'REPORTING_FAILURE') reportFailure(event.data.error instanceof Error ? event.data.error : new Error(event.data.message), 'pwa.worker', { phase: event.data.phase, version: event.data.version, url: event.data.url }) })
  navigator.serviceWorker.addEventListener('controllerchange', () => { void refresh() })
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then((result) => {
    registration = result
    const watch = () => {
      const worker = result.installing
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' || worker.state === 'activated') void refresh(); if (worker.state === 'redundant') publish({ offline: result.active ? status.offline : 'unavailable', message: 'Offline download failed. Reconnect and check again; your current companion remains usable.' }) })
    }
    result.addEventListener('updatefound', watch); watch(); void refresh(); void refreshFromNetwork(0)
  }).catch((error) => { reportFailure(error, 'pwa.register'); publish({ offline: 'unavailable', message: 'Offline storage is unavailable. Keep using the online companion and export progress backups.' }) })
  window.setInterval(() => { void refreshFromNetwork(resumeInterval) }, updateInterval)
  document.addEventListener('visibilitychange', () => { void refreshFromNetwork(resumeInterval) })
  window.addEventListener('pageshow', () => { void refreshFromNetwork(resumeInterval) })
}
export async function promptInstall() {
  const prompt = installPrompt
  if (!prompt || status.installed) return
  installPrompt = undefined; publish({ canInstall: false, message: '' })
  try { await prompt.prompt(); const choice = await prompt.userChoice; publish({ message: choice.outcome === 'accepted' ? 'The browser accepted installation. Launch from its app icon when installation finishes.' : 'Installation dismissed. You can use the browser menu later.' }) }
  catch (error) { reportFailure(error, 'pwa.install'); publish({ message: 'The browser could not open installation. Use its menu or the instructions below.' }) }
}
async function refreshFromNetwork(minimumInterval: number, manual = false) {
  if (!registration || !navigator.onLine) {
    if (manual) publish({ message: 'Connect to the internet to check for an update or retry the offline download.' })
    return
  }
  if (checking || (!manual && (document.hidden || Date.now() - checkedAt < minimumInterval))) return
  checking = true
  checkedAt = Date.now()
  try {
    await registration.update()
    await refresh()
    if (manual) publish({ message: status.update ? 'An update is ready. Save or export progress, then close every companion window and reopen.' : registration.installing ? 'Downloading and verifying a complete offline release…' : 'Update check completed. No app update is waiting.' })
  } catch (error) {
    if (manual) {
      reportFailure(error, 'pwa.update')
      publish({ message: 'Update check failed. The current cached companion remains available if its files are saved.' })
    }
  } finally { checking = false }
}
export const checkForUpdate = () => refreshFromNetwork(0, true)
export function prepareUpdate(): boolean {
  if (!registration?.waiting) { publish({ message: 'The update is no longer waiting. Check again.' }); return false }
  // The browser activates the waiting release only after all old controlled
  // windows close. A client snapshot cannot safely authorize skipWaiting.
  return true
}
export async function repairOffline(signal: AbortSignal, onCommit: () => void, canContinue: () => boolean = () => true): Promise<boolean> {
  if (signal.aborted) return false
  if (!navigator.onLine) { publish({ message: 'Reconnect before repairing the offline download.' }); return false }
  if (registration?.active) {
    try {
      const response = await request(registration.active, 'CHECK_WINDOWS', signal)
      if (signal.aborted) return false
      if (!response.accepted) { publish({ message: 'Close other Idle Slayer Companion tabs and app windows before repairing.' }); return false }
      // Dismissal is disabled once unregister begins. External session changes
      // can still abort this operation, including while unregister is pending.
      onCommit()
      if (signal.aborted || !canContinue()) return false
      // An invalidated committed repair may already have removed this scope,
      // while the old document still holds its activated registration object.
      if (!await registration.unregister() && await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)) throw new Error('Unavailable')
    } catch (error) { if (!signal.aborted) reportFailure(error, 'pwa.repair'); if (!signal.aborted) publish({ message: 'Offline repair could not start. Close other companion windows and try again.' }); return false }
  } else onCommit()
  if (signal.aborted || !canContinue()) return false
  window.location.reload()
  return true
}
