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
  message: string
}
const listeners = new Set<() => void>()
let status: PwaStatus = { offline: 'loading', online: navigator.onLine, installed: false, canInstall: false, update: false, message: '' }
let registration: ServiceWorkerRegistration | undefined
let installPrompt: InstallPrompt | undefined
let started = false
function publish(next: Partial<PwaStatus>) { reportingAction('pwa.status', next); status = { ...status, ...next }; listeners.forEach((listener) => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const usePwaStatus = () => useSyncExternalStore(subscribe, () => status)
function installed() { return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true }
function request(worker: ServiceWorker, type: string, signal?: AbortSignal): Promise<{ ready?: boolean; accepted?: boolean }> {
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
  if (!registration) return
  publish({ update: Boolean(registration.waiting) })
  if (!registration.active) return
  try { publish({ offline: (await request(registration.active, 'CHECK_READY')).ready ? 'ready' : 'unavailable' }) }
  catch (error) { reportFailure(error, 'pwa.readiness'); publish({ offline: 'unavailable' }) }
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
  window.addEventListener('online', () => { publish({ online: true }); void checkForUpdate() })
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) { publish({ offline: 'unsupported' }); return }
  navigator.serviceWorker.addEventListener('message', (event) => { if (event.data?.type === 'REPORTING_FAILURE') reportFailure(event.data.error instanceof Error ? event.data.error : new Error(event.data.message), 'pwa.worker', { phase: event.data.phase, version: event.data.version, url: event.data.url }) })
  navigator.serviceWorker.addEventListener('controllerchange', () => { void refresh() })
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then((result) => {
    registration = result
    const watch = () => {
      const worker = result.installing
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' || worker.state === 'activated') void refresh(); if (worker.state === 'redundant') publish({ offline: result.active ? status.offline : 'unavailable', message: 'Offline download failed. Reconnect and check again; your current companion remains usable.' }) })
    }
    result.addEventListener('updatefound', watch); watch(); void refresh()
  }).catch((error) => { reportFailure(error, 'pwa.register'); publish({ offline: 'unavailable', message: 'Offline storage is unavailable. Keep using the online companion and export progress backups.' }) })
}
export async function promptInstall() {
  const prompt = installPrompt
  if (!prompt || status.installed) return
  installPrompt = undefined; publish({ canInstall: false, message: '' })
  try { await prompt.prompt(); const choice = await prompt.userChoice; publish({ message: choice.outcome === 'accepted' ? 'The browser accepted installation. Launch from its app icon when installation finishes.' : 'Installation dismissed. You can use the browser menu later.' }) }
  catch (error) { reportFailure(error, 'pwa.install'); publish({ message: 'The browser could not open installation. Use its menu or the instructions below.' }) }
}
export async function checkForUpdate() {
  if (!registration || !navigator.onLine) { publish({ message: 'Connect to the internet to check for an update or retry the offline download.' }); return }
  try { await registration.update(); await refresh(); publish({ message: registration.waiting ? 'An update is ready. Save or export progress, then close every companion window and reopen.' : registration.installing ? 'Downloading and verifying a complete offline release…' : 'Update check completed. No update is waiting.' }) }
  catch (error) { reportFailure(error, 'pwa.update'); publish({ message: 'Update check failed. The current cached companion remains available if its files are saved.' }) }
}
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
