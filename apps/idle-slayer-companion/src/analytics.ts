import { reportingAction } from './reporting'
import { runtimeDeployment } from './runtime-deployment'
/** Bounded, optional Umami integration. Progress persistence never depends on telemetry. */
import { isAnalyticsEventName, isAnalyticsLayout, sanitizeAnalyticsProperties } from './analytics-contract'
import type { AnalyticsEventName, AnalyticsLayout, AnalyticsTrackEvent } from './analytics-contract'
import { sectionAtPath, sectionPath } from './domain/companion-navigation'
export type { AnalyticsEventName, AnalyticsOperation, AnalyticsProperties, AnalyticsTrackEvent } from './analytics-contract'
export { analyticsPosition } from './analytics-contract'

export const ANALYTICS_PREFERENCE_KEY = 'idle-slayer-ascension-map.analytics.v1'
export const ANALYTICS_WEBSITE_ID = 'f5c9bfd4-7ab5-4f82-a543-9357dcea1566'
export const ANALYTICS_HOST = 'https://analytics.garrod.house'
export const ANALYTICS_CALLBACK = 'ascensionMapBeforeSend'
const APP_VERSION = '0.2.0'
const QUEUE_LIMIT = 100
const QUEUE_TTL = 30_000

export interface AnalyticsContext {
  catalog_version: string
  catalog_revision: string
  layout: AnalyticsLayout
  spoilers: boolean
  visibleUpgradeIds: ReadonlySet<string>
  visibleMilestoneIds: ReadonlySet<string>
}
export interface TrackingStatus {
  enabled: boolean
  reason: string
  active: boolean
  preference: 'enabled' | 'disabled' | 'unavailable'
}
type SafeData = Record<string, string | number | boolean>
type Payload = Record<string, unknown>
interface Umami {
  track: (name: string, data?: SafeData) => unknown
  identify: (data: SafeData) => unknown
  getSession?: () => { cache: string | undefined; website: string | null }
}
type AnalyticsWindow = Window & {
  umami?: Umami
  ascensionMapBeforeSend?: (type: string, payload: Payload) => Payload | null
}
/** Explicit dependency seam for isolated local tests; the app uses the fixed singleton below. */
export interface AnalyticsEnvironment {
  window: Window
  production: boolean
  hostname: string
  basePath: string
  host: string
  websiteId: string
  migrationLanding?: boolean
}

let migrationLanding = false
/** Carry an explicit migration opt-out across origin changes before URL cleanup. */
export function honorMigrationOptOut(win: Window): void {
  if (new URL(win.location.href).searchParams.get('migration') !== '1') return
  migrationLanding = true
  try { win.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, 'disabled') } catch { /* This visit still fails closed when persistence is unavailable. */ }
}

const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const metadataToken = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(value)

export function createAnalyticsController(environment: AnalyticsEnvironment) {
  const win = environment.window as AnalyticsWindow
  let initialized = false
  let preference: TrackingStatus['preference'] = 'unavailable'
  let preferenceDisabled = false
  let sessionSuspended = false
  let trackerReady = false
  let scriptFailed = false
  let context: AnalyticsContext | undefined
  let lastSessionData = ''
  let queued: { name: AnalyticsEventName; data: SafeData; timestamp: number }[] = []
  let expiryTimer: number | undefined
  let pollTimer: number | undefined
  let trackerWaitStarted = 0
  let guardLiveURL = () => {}
  let runtimeErrorsReported = 0
  const runtimeErrorTimes = new Map<string, number>()
  const campaigns = new URLSearchParams()
  const origin = win.location.origin
  const appURL = new URL(environment.basePath, origin)

  function storagePreference() {
    try {
      const value = win.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)
      preference = value === null || value === 'enabled' ? 'enabled' : value === 'disabled' ? 'disabled' : 'unavailable'
    } catch { preference = 'unavailable' }
    preferenceDisabled = preference !== 'enabled'
  }
  function disabledReason(): string | undefined {
    if (!environment.production) return 'development'
    if (environment.migrationLanding) return 'migration-opt-out'
    if (win.location.hostname.toLowerCase() !== environment.hostname.toLowerCase() ||
      sectionAtPath(win.location.pathname, environment.basePath) === null && win.location.pathname !== environment.basePath.replace(/\/$/, '')) return 'unsupported-origin'
    try { if (win.self !== win.top) return 'embedded' } catch { return 'embedded' }
    const signals = win.navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
    if (signals.globalPrivacyControl === true) return 'global-privacy-control'
    const dnt = signals.doNotTrack || signals.msDoNotTrack || (win as Window & { doNotTrack?: string }).doNotTrack
    if (['1', 'yes'].includes(String(dnt))) return 'do-not-track'
    if (win.location.hash === '#analytics=off') return 'opt-out'
    if (preferenceDisabled) return preference === 'unavailable' ? 'storage-unavailable' : 'opt-out'
    try { if (win.localStorage.getItem('umami.disabled')) return 'umami-disabled' } catch {
      preference = 'unavailable'
      preferenceDisabled = true
      return 'storage-unavailable'
    }
    if (sessionSuspended) return 'reload-required'
    if (signals.onLine === false) return 'offline'
    return undefined
  }
  function getTrackingStatus(): TrackingStatus {
    const reason = disabledReason()
    return { enabled: !reason, reason: reason || (scriptFailed ? 'script-unavailable' : 'enabled'), active: !reason && trackerReady && !scriptFailed, preference }
  }
  function commonData(): SafeData {
    const data: SafeData = { app_version: APP_VERSION, screen_layout: win.innerWidth <= 1100 || win.innerHeight <= 540 ? 'compact' : 'wide' }
    if (context) {
      if (metadataToken(context.catalog_version)) data.catalog_version = context.catalog_version
      if (metadataToken(context.catalog_revision)) data.catalog_revision = context.catalog_revision
      if (isAnalyticsLayout(context.layout)) data.layout = context.layout
      if (typeof context.spoilers === 'boolean') data.spoilers = context.spoilers
    }
    return data
  }
  function trackerURL() {
    const url = new URL(appURL)
    const section = sectionAtPath(win.location.pathname, environment.basePath)
    if (section) url.pathname = sectionPath(section, environment.basePath)
    url.search = campaigns.toString()
    return url.toString()
  }
  function cleanReferrer(referrer: unknown) {
    if (typeof referrer !== 'string' || !referrer) return ''
    try {
      const url = new URL(referrer, origin)
      if (!['http:', 'https:'].includes(url.protocol)) return ''
      return url.origin === origin ? environment.basePath : `${url.origin}/`
    } catch { return '' }
  }
  function sanitizePayload(type: string, payload: Payload): Payload | null {
    guardLiveURL()
    if (disabledReason() || !payload || !['event', 'identify', 'performance'].includes(type)) return null
    const safe: Payload = {
      website: environment.websiteId, hostname: environment.hostname, url: trackerURL(),
      title: ['/idle-slayer-companion/', '/utilities/idle-slayer-companion/'].includes(environment.basePath) ? 'Idle Slayer Companion' : 'Idle Slayer Ascension Map', referrer: cleanReferrer(payload.referrer),
    }
    if (typeof payload.screen === 'string' && /^\d{1,5}x\d{1,5}$/.test(payload.screen)) safe.screen = payload.screen
    if (typeof payload.language === 'string' && /^[a-zA-Z0-9-]{1,35}$/.test(payload.language)) safe.language = payload.language
    if (type === 'event') {
      if (payload.name !== undefined) {
        if (!isAnalyticsEventName(payload.name)) return null
        safe.name = payload.name
        safe.data = { ...commonData(), ...sanitizeAnalyticsProperties(payload.name, payload.data, context) }
      }
    } else if (type === 'identify') {
      // Never forward a distinct ID, caller data or a stored profile.
      safe.data = commonData()
    } else {
      for (const key of ['lcp', 'inp', 'cls', 'fcp', 'ttfb']) {
        const value = payload[key]
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= (key === 'cls' ? 100 : 60_000)) safe[key] = value
      }
    }
    return safe
  }
  function beforeSend(type: string, payload: Payload): Payload | null {
    try { return sanitizePayload(type, payload) } catch { return null }
  }
  function discardQueue() {
    queued = []
    if (expiryTimer !== undefined) win.clearTimeout(expiryTimer)
    if (pollTimer !== undefined) win.clearTimeout(pollTimer)
    expiryTimer = pollTimer = undefined
  }
  function suspendSession() {
    sessionSuspended = true
    trackerReady = false
    discardQueue()
  }
  function installURLGuards() {
    // Keep the native methods beneath the tracker/recorder's later wrappers.
    // Calling these directly also cleans popstate before their listeners run.
    const nativeReplaceState = win.history.replaceState
    const nativePushState = win.history.pushState
    function cleanHistoryURL(value: string | URL | null | undefined) {
      let requested: URL
      try { requested = new URL(value ?? win.location.href, win.location.href) } catch {
        // Native History reports invalid destinations with its own exception.
        return value
      }
      // Let the browser retain its native cross-origin rejection semantics.
      if (requested.origin !== origin) return value
      const clean = new URL(appURL)
      const section = sectionAtPath(requested.pathname, environment.basePath)
      if (section) clean.pathname = sectionPath(section, environment.basePath)
      if (requested.hash === '#analytics=off') {
        suspendSession()
        clean.hash = 'analytics=off'
      }
      return clean.toString()
    }
    function guard(method: History['pushState']): History['pushState'] {
      return function (this: History, data: unknown, unused: string, url?: string | URL | null) {
        // Clearing a dirty address must not hide metadata already buffered
        // before the queued navigation event or recorder cache check.
        guardLiveURL()
        if (arguments.length < 2) return Reflect.apply(method, this, arguments)
        return method.call(this, data, unused, cleanHistoryURL(url))
      }
    }
    win.history.pushState = guard(nativePushState)
    win.history.replaceState = guard(nativeReplaceState)
    const cleanNavigation = () => {
      try {
        const url = cleanHistoryURL(win.location.href)
        if (url !== win.location.href) {
          // A dirty live URL may already be buffered before its queued
          // navigation event arrives. Never resume this recorder afterward.
          suspendSession()
          nativeReplaceState.call(win.history, win.history.state, '', url)
        }
      } catch {
        // The recorder uses the live address outside beforeSend. A failed
        // cleanup must deny cache access for the rest of this document.
        scriptFailed = true
        suspendSession()
      }
    }
    guardLiveURL = cleanNavigation
    win.addEventListener('popstate', cleanNavigation)
    win.addEventListener('hashchange', cleanNavigation)
  }
  function ignoreFailure(action: () => unknown) {
    try { void Promise.resolve(action()).catch(() => undefined) } catch { /* Optional telemetry cannot break an action. */ }
  }
  function identifyContext() {
    if (!context || !trackerReady || !win.umami || disabledReason()) return
    const data = commonData()
    const encoded = JSON.stringify(data)
    if (encoded === lastSessionData) return
    lastSessionData = encoded
    ignoreFailure(() => win.umami!.identify(data))
  }
  function flushQueue() {
    if (disabledReason()) { discardQueue(); return }
    if (!trackerReady || !win.umami) return
    const events = queued
    discardQueue()
    for (const event of events) {
      if (Date.now() - event.timestamp < QUEUE_TTL) {
        // Validate IDs again after visibility changes while scripts were loading.
        const data = { ...commonData(), ...sanitizeAnalyticsProperties(event.name, event.data, context) }
        ignoreFailure(() => win.umami!.track(event.name, data))
      }
    }
  }
  function waitForTracker() {
    if (win.umami) {
      const originalGetSession = win.umami.getSession?.bind(win.umami)
      if (originalGetSession) {
        // Umami 3.4 rereads this public accessor before every recorder flush.
        // Guard even a tracker that finishes loading after opt-out. Once this
        // document is suspended, its buffered replay can never resume sending.
        win.umami.getSession = () => {
          guardLiveURL()
          return disabledReason() ? { cache: undefined, website: environment.websiteId } : originalGetSession()
        }
      }
      if (disabledReason() || scriptFailed) { discardQueue(); return }
      trackerReady = true
      identifyContext()
      flushQueue()
      return
    }
    if (disabledReason() || scriptFailed) { discardQueue(); return }
    if (Date.now() - trackerWaitStarted >= QUEUE_TTL) { scriptFailed = true; discardQueue(); return }
    pollTimer = win.setTimeout(waitForTracker, 100)
  }
  function initializeAnalytics() {
    if (initialized) return
    initialized = true
    storagePreference()
    win.addEventListener('offline', suspendSession)
    if (win.navigator.onLine === false) suspendSession()
    if (disabledReason()) return
    // Replay and heatmaps use the actual URL, outside the tracker callback.
    const currentURL = new URL(win.location.href)
    for (const key of campaignKeys) {
      const value = currentURL.searchParams.get(key)
      if (value && /^[a-zA-Z0-9._~-]{1,64}$/.test(value)) campaigns.set(key, value)
    }
    const cleanStartup = new URL(appURL)
    const startupSection = sectionAtPath(win.location.pathname, environment.basePath)
    if (startupSection) cleanStartup.pathname = sectionPath(startupSection, environment.basePath)
    try { win.history.replaceState(win.history.state, '', cleanStartup.toString()) } catch {
      // Without a clean address, recorder URLs cannot satisfy the privacy contract.
      scriptFailed = true
      return
    }
    try { installURLGuards() } catch {
      scriptFailed = true
      suspendSession()
      return
    }
    win.ascensionMapBeforeSend = beforeSend
    const tracker = win.document.createElement('script')
    tracker.id = 'ascension-map-tracker'
    tracker.defer = true
    tracker.async = false
    tracker.src = `${environment.host}/script.js`
    tracker.dataset.websiteId = environment.websiteId
    tracker.dataset.hostUrl = environment.host
    tracker.dataset.domains = environment.hostname
    tracker.dataset.excludeSearch = 'true'
    tracker.dataset.excludeHash = 'true'
    tracker.dataset.doNotTrack = 'true'
    tracker.dataset.performance = 'true'
    tracker.dataset.beforeSend = ANALYTICS_CALLBACK
    tracker.onload = () => { trackerWaitStarted = Date.now(); waitForTracker() }
    tracker.onerror = () => { scriptFailed = true; discardQueue() }
    win.document.head.appendChild(tracker)
    const recorder = win.document.createElement('script')
    recorder.id = 'ascension-map-recorder'
    recorder.defer = true
    recorder.async = false
    recorder.src = `${environment.host}/recorder.js`
    recorder.dataset.websiteId = environment.websiteId
    recorder.dataset.hostUrl = environment.host
    win.document.head.appendChild(recorder)
    // Bound error loops to one per category / 30 seconds and ten per page session.
    // Never serialize errors, URLs or stacks.
    const reportError = (reason: 'runtime' | 'unhandled-rejection') => {
      const previous = runtimeErrorTimes.get(reason)
      if (runtimeErrorsReported >= 10 || (previous !== undefined && Date.now() - previous < 30_000)) return
      runtimeErrorTimes.set(reason, Date.now())
      runtimeErrorsReported++
      trackEvent('runtime_error', { reason })
    }
    win.addEventListener('error', () => reportError('runtime'))
    win.addEventListener('unhandledrejection', () => reportError('unhandled-rejection'))
    win.addEventListener('resize', identifyContext)
    win.addEventListener('storage', (event) => {
      if (event.key === null || event.key === ANALYTICS_PREFERENCE_KEY || event.key === 'umami.disabled') {
        // Read the event as well as current storage: another tab can disable
        // and enable before this document receives the queued disabling event.
        const disabledByEvent = event.key === null
          || (event.key === ANALYTICS_PREFERENCE_KEY && event.newValue !== null && event.newValue !== 'enabled')
          || (event.key === 'umami.disabled' && Boolean(event.newValue))
        storagePreference()
        if (disabledByEvent || disabledReason()) suspendSession()
      }
    })
  }
  function updateAnalyticsContext(next: AnalyticsContext) {
    context = { ...next, visibleUpgradeIds: new Set(next.visibleUpgradeIds), visibleMilestoneIds: new Set(next.visibleMilestoneIds) }
    identifyContext()
  }
  const trackEvent: AnalyticsTrackEvent = (name, properties) => {
    if (!initialized || !isAnalyticsEventName(name) || disabledReason() || scriptFailed) return
    const data = sanitizeAnalyticsProperties(name, properties, context)
    if (trackerReady && win.umami) ignoreFailure(() => win.umami!.track(name, { ...commonData(), ...data }))
    else {
      queued = queued.filter((event) => Date.now() - event.timestamp < QUEUE_TTL)
      if (queued.length >= QUEUE_LIMIT) queued.shift()
      queued.push({ name, data, timestamp: Date.now() })
      if (expiryTimer !== undefined) win.clearTimeout(expiryTimer)
      expiryTimer = win.setTimeout(() => { discardQueue() }, QUEUE_TTL)
    }
  }
  function setTrackingPreference(enabled: boolean) {
    discardQueue()
    let persisted = false
    try {
      win.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, enabled ? 'enabled' : 'disabled')
      preference = enabled ? 'enabled' : 'disabled'
      persisted = true
    } catch { preference = 'unavailable' }
    // Enabling takes effect only after a clean reload, never mid-session.
    sessionSuspended = true
    preferenceDisabled = true
    trackerReady = false
    const url = new URL(win.location.href)
    url.search = ''
    url.hash = enabled && persisted ? '' : 'analytics=off'
    return { persisted, reloadURL: url.toString() }
  }
  return { initializeAnalytics, updateAnalyticsContext, trackEvent, getTrackingStatus, setTrackingPreference }
}

let singleton: ReturnType<typeof createAnalyticsController> | undefined
function controller() {
  singleton ??= createAnalyticsController({ window, production: import.meta.env.PROD && runtimeDeployment.telemetryEnabled, hostname: runtimeDeployment.hostname,
    basePath: runtimeDeployment.base, host: ANALYTICS_HOST, websiteId: ANALYTICS_WEBSITE_ID, migrationLanding })
  return singleton
}
export const initializeAnalytics = () => controller().initializeAnalytics()
export const updateAnalyticsContext = (context: AnalyticsContext) => controller().updateAnalyticsContext(context)
export const trackEvent: AnalyticsTrackEvent = (name, properties) => { reportingAction(name, properties as Record<string, string | number | boolean>); controller().trackEvent(name, properties) }
export const getTrackingStatus = () => controller().getTrackingStatus()
export const setTrackingPreference = (enabled: boolean) => controller().setTrackingPreference(enabled)
