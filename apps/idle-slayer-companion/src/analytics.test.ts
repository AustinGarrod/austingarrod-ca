import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANALYTICS_CALLBACK, ANALYTICS_PREFERENCE_KEY, analyticsPosition, createAnalyticsController, type AnalyticsContext, type AnalyticsEventName } from './analytics'

const hostname = 'example.test'
const basePath = '/map/'
const websiteId = '11111111-1111-4111-8111-111111111111'
const context: AnalyticsContext = {
  catalog_version: '7.2.0', catalog_revision: 'steam-25551532-v1', layout: 'web', spoilers: false,
  visibleUpgradeIds: new Set(['visible-upgrade']), visibleMilestoneIds: new Set(['visible-milestone']),
}
type TestWindow = Window & { umami?: ReturnType<typeof fakeTracker>; ascensionMapBeforeSend?: (type: string, payload: Record<string, unknown>) => Record<string, unknown> | null }
function fakeTracker() {
  return { track: vi.fn(), identify: vi.fn(), getSession: vi.fn(() => ({ cache: 'local-only-cache', website: websiteId })) }
}
function setup(options: { url?: string; production?: boolean; preference?: string; storageFails?: boolean; dnt?: string; gpc?: boolean; embedded?: boolean; nativeDisabled?: boolean; migrationLanding?: boolean } = {}) {
  let url = new URL(options.url || `https://${hostname}${basePath}`)
  const stored = new Map<string, string>()
  if (options.preference) stored.set(ANALYTICS_PREFERENCE_KEY, options.preference)
  if (options.nativeDisabled) stored.set('umami.disabled', '1')
  const scripts: HTMLScriptElement[] = []
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  const historyCalls = {
    replaceState: vi.fn((_state: unknown, _title: string, next: string | URL | null | undefined) => { url = new URL(next ?? url.href, url.href) }),
    pushState: vi.fn((_state: unknown, _title: string, next: string | URL | null | undefined) => { url = new URL(next ?? url.href, url.href) }),
  }
  const storage = {
    getItem: vi.fn((key: string) => { if (options.storageFails) throw new Error('sensitive storage failure'); return stored.get(key) ?? null }),
    setItem: vi.fn((key: string, value: string) => { if (options.storageFails) throw new Error('sensitive write failure'); stored.set(key, value) }),
  }
  const win = {
    get location() { return url },
    localStorage: storage,
    navigator: { doNotTrack: options.dnt, globalPrivacyControl: options.gpc },
    innerWidth: 1280, innerHeight: 800,
    history: { state: { preserve: 'state' }, ...historyCalls },
    document: {
      createElement: vi.fn(() => ({ dataset: {}, onload: null, onerror: null })),
      head: { appendChild: vi.fn((script: HTMLScriptElement) => scripts.push(script)) },
    },
    addEventListener: vi.fn((name: string, handler: (event: unknown) => void) => listeners.set(name, [...(listeners.get(name) ?? []), handler])),
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  } as unknown as TestWindow
  Object.defineProperties(win, { self: { value: win }, top: { value: options.embedded ? {} : win } })
  const analytics = createAnalyticsController({ window: win, production: options.production ?? true, hostname, basePath, host: 'https://isolated.test', websiteId, migrationLanding: options.migrationLanding })
  const tracker = fakeTracker()
  const ready = () => {
    win.umami = tracker
    scripts[0].onload?.call(scripts[0], new Event('load'))
  }
  return { analytics, win, scripts, tracker, storage, stored, ready, listeners, historyCalls }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('analytics activation and preference', () => {
  it('keeps a migration landing opted out even when its preference write is unavailable', () => {
    const { analytics, scripts } = setup({ migrationLanding: true, storageFails: true })
    analytics.initializeAnalytics()
    analytics.trackEvent('app_ready')
    expect(scripts).toEqual([])
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason: 'migration-opt-out' })
    analytics.setTrackingPreference(true)
    analytics.initializeAnalytics()
    expect(scripts).toEqual([])
  })
  it('discards offline events and denies buffered replay after returning online', () => {
    const { analytics, win, ready, tracker, listeners, stored } = setup({ preference: 'enabled' })
    analytics.initializeAnalytics(); analytics.trackEvent('app_ready')
    listeners.get('offline')!.forEach((listener) => listener({}))
    ready()
    expect(tracker.track).not.toHaveBeenCalled()
    expect(tracker.getSession()).toEqual({ cache: undefined, website: websiteId })
    listeners.get('online')?.forEach((listener) => listener({}))
    analytics.trackEvent('app_ready')
    expect(tracker.track).not.toHaveBeenCalled()
    expect(win.ascensionMapBeforeSend?.('event', { name: 'app_ready' })).toBeNull()
    expect(stored.get(ANALYTICS_PREFERENCE_KEY)).toBe('enabled')
  })
  it('does not load tracking scripts during offline startup or begin queuing for later delivery', () => {
    const { analytics, win, scripts } = setup()
    Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true })
    analytics.initializeAnalytics(); analytics.trackEvent('app_ready')
    Object.defineProperty(win.navigator, 'onLine', { value: true })
    analytics.trackEvent('app_ready')
    expect(scripts).toEqual([])
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, reason: 'reload-required' })
  })
  it.each([
    ['development', { production: false }],
    ['unsupported-origin', { url: 'https://other.test/map/' }],
    ['unsupported-origin', { url: 'https://example.test/private/' }],
    ['embedded', { embedded: true }],
    ['do-not-track', { dnt: '1' }],
    ['global-privacy-control', { gpc: true }],
    ['umami-disabled', { nativeDisabled: true }],
    ['opt-out', { preference: 'disabled' }],
    ['opt-out', { url: 'https://example.test/map/#analytics=off' }],
    ['storage-unavailable', { storageFails: true }],
    ['storage-unavailable', { preference: 'invalid' }],
  ])('loads no scripts for %s', (reason, options) => {
    const { analytics, scripts } = setup(options)
    analytics.initializeAnalytics()
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason })
    expect(scripts).toEqual([])
  })

  it('initializes once, honors the fixed script contract, and preserves history state', () => {
    const { analytics, scripts, historyCalls, ready } = setup()
    analytics.initializeAnalytics()
    analytics.initializeAnalytics()
    expect(scripts).toHaveLength(2)
    expect(scripts[0].dataset).toMatchObject({ websiteId, beforeSend: ANALYTICS_CALLBACK, performance: 'true', excludeSearch: 'true', excludeHash: 'true' })
    expect(scripts[1].dataset).toEqual({ websiteId, hostUrl: 'https://isolated.test' })
    expect(historyCalls.replaceState).toHaveBeenCalledWith({ preserve: 'state' }, '', 'https://example.test/map/')
    expect(analytics.getTrackingStatus().active).toBe(false)
    ready()
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: true, active: true })
  })

  it('opt-out clears pending events and immediately removes recorder cache access', () => {
    const { analytics, tracker, ready, stored } = setup()
    analytics.initializeAnalytics()
    analytics.trackEvent('app_ready')
    ready()
    expect(tracker.getSession()).toMatchObject({ cache: 'local-only-cache' })
    tracker.track.mockClear()
    expect(analytics.setTrackingPreference(false)).toEqual({ persisted: true, reloadURL: 'https://example.test/map/#analytics=off' })
    expect(stored.get(ANALYTICS_PREFERENCE_KEY)).toBe('disabled')
    expect(tracker.getSession()).toEqual({ cache: undefined, website: websiteId })
    analytics.trackEvent('app_ready')
    expect(tracker.track).not.toHaveBeenCalled()
  })

  it('fails closed on preference writes and supplies a reload marker without touching progress', () => {
    const { analytics, storage, stored } = setup({ storageFails: true })
    analytics.initializeAnalytics()
    expect(analytics.setTrackingPreference(false)).toEqual({ persisted: false, reloadURL: 'https://example.test/map/#analytics=off' })
    expect(analytics.setTrackingPreference(true)).toEqual({ persisted: false, reloadURL: 'https://example.test/map/#analytics=off' })
    expect(storage.setItem.mock.calls.every(([key]) => key === ANALYTICS_PREFERENCE_KEY)).toBe(true)
    expect(stored.size).toBe(0)
  })

  it('enabling is deferred until reload and removes the fallback marker from the reload URL', () => {
    const { analytics, scripts } = setup({ preference: 'disabled', url: 'https://example.test/map/#analytics=off' })
    analytics.initializeAnalytics()
    expect(analytics.setTrackingPreference(true)).toEqual({ persisted: true, reloadURL: 'https://example.test/map/' })
    expect(scripts).toHaveLength(0)
    expect(analytics.getTrackingStatus().active).toBe(false)
  })

  it('stops access when another tab disables tracking', () => {
    const { analytics, stored, listeners, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    stored.set(ANALYTICS_PREFERENCE_KEY, 'disabled')
    listeners.get('storage')?.forEach((handler) => handler({ key: ANALYTICS_PREFERENCE_KEY }))
    expect(tracker.getSession().cache).toBeUndefined()
    expect(analytics.getTrackingStatus().enabled).toBe(false)
  })

  it.each([
    ['app opt-out', ANALYTICS_PREFERENCE_KEY, 'disabled', false],
    ['invalid preference', ANALYTICS_PREFERENCE_KEY, 'invalid', false],
    ['native opt-out', 'umami.disabled', '1', false],
    ['cleared storage', null, null, false],
    ['unreadable preference', ANALYTICS_PREFERENCE_KEY, 'disabled', true],
  ])('requires a clean reload after another tab causes %s', (_scenario, key, value, readFailure) => {
    const { analytics, stored, storage, listeners, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    if (key && value) stored.set(key, value)
    else stored.clear()
    if (readFailure) storage.getItem.mockImplementationOnce(() => { throw new Error('Synthetic inaccessible preference') })
    listeners.get('storage')?.forEach((handler) => handler({ key, newValue: value }))
    expect(tracker.getSession().cache).toBeUndefined()
    stored.delete('umami.disabled')
    stored.set(ANALYTICS_PREFERENCE_KEY, 'enabled')
    listeners.get('storage')?.forEach((handler) => handler({ key: ANALYTICS_PREFERENCE_KEY, newValue: 'enabled' }))
    tracker.track.mockClear()
    analytics.trackEvent('app_ready')
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason: 'reload-required', preference: 'enabled' })
    expect(tracker.getSession().cache).toBeUndefined()
    expect(tracker.track).not.toHaveBeenCalled()
  })

  it.each([
    [ANALYTICS_PREFERENCE_KEY, 'disabled'],
    ['umami.disabled', '1'],
  ])('honors queued disabling storage events for %s even after another tab restores eligibility', (key, value) => {
    const { analytics, stored, listeners, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    // Storage already reflects a later enable; the earlier queued event still
    // establishes a disabled interval whose recorder buffer cannot be reused.
    stored.set(ANALYTICS_PREFERENCE_KEY, 'enabled')
    listeners.get('storage')?.forEach((handler) => handler({ key, newValue: value }))
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason: 'reload-required' })
    expect(tracker.getSession().cache).toBeUndefined()
  })

  it('does not resume a local tracking change when another tab enables tracking', () => {
    const { analytics, stored, listeners, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    analytics.setTrackingPreference(false)
    stored.set(ANALYTICS_PREFERENCE_KEY, 'enabled')
    listeners.get('storage')?.forEach((handler) => handler({ key: ANALYTICS_PREFERENCE_KEY, newValue: 'enabled' }))
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason: 'reload-required' })
    expect(tracker.getSession().cache).toBeUndefined()
  })

  it('guards a tracker that finishes loading after another tab disables tracking', () => {
    const { analytics, stored, listeners, tracker, ready } = setup()
    analytics.initializeAnalytics()
    analytics.trackEvent('app_ready')
    stored.set(ANALYTICS_PREFERENCE_KEY, 'disabled')
    listeners.get('storage')?.forEach((handler) => handler({ key: ANALYTICS_PREFERENCE_KEY, newValue: 'disabled' }))
    ready()
    stored.set(ANALYTICS_PREFERENCE_KEY, 'enabled')
    listeners.get('storage')?.forEach((handler) => handler({ key: ANALYTICS_PREFERENCE_KEY, newValue: 'enabled' }))
    expect(analytics.getTrackingStatus()).toMatchObject({ active: false, reason: 'reload-required' })
    expect(tracker.getSession().cache).toBeUndefined()
    expect(tracker.track).not.toHaveBeenCalled()
  })

  it('keeps the application usable when cleaning the recorder URL is prohibited', () => {
    const { analytics, win, scripts } = setup()
    vi.mocked(win.history.replaceState).mockImplementation(() => { throw new Error('PRIVATE') })
    expect(() => analytics.initializeAnalytics()).not.toThrow()
    expect(scripts).toHaveLength(0)
    expect(analytics.getTrackingStatus()).toMatchObject({ active: false, reason: 'script-unavailable' })
  })
})

describe('analytics payload privacy', () => {
  it.each(['pushState', 'replaceState'] as const)('cleans later %s addresses before native history receives them and preserves caller state', (method) => {
    const { analytics, win, historyCalls } = setup()
    analytics.initializeAnalytics()
    const state = { preserve: method }
    win.history[method](state, 'Ignored native title', '/map/?private=PRIVATE#PRIVATE')
    expect(historyCalls[method]).toHaveBeenLastCalledWith(state, 'Ignored native title', 'https://example.test/map/')
    expect(win.location.href).toBe('https://example.test/map/')
  })

  it.each(['popstate', 'hashchange'])('cleans %s addresses using the native method and retains history state', (event) => {
    const { analytics, win, listeners, historyCalls } = setup()
    analytics.initializeAnalytics()
    historyCalls.pushState({}, '', '/map/?private=PRIVATE#PRIVATE')
    listeners.get(event)?.forEach((handler) => handler({}))
    expect(win.location.href).toBe('https://example.test/map/')
    expect(historyCalls.replaceState).toHaveBeenLastCalledWith({ preserve: 'state' }, '', 'https://example.test/map/')
  })

  it('preserves a later opt-out URL marker and never resumes its recording when the marker is removed', () => {
    const { analytics, win, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    win.history.pushState({}, '', '/map/#analytics=off')
    expect(win.location.hash).toBe('#analytics=off')
    expect(analytics.getTrackingStatus()).toMatchObject({ active: false, reason: 'opt-out' })
    win.history.replaceState({}, '', '/map/')
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason: 'reload-required' })
    expect(tracker.getSession().cache).toBeUndefined()
  })

  it('fails closed on a later URL cleanup failure without allowing buffered replay to resume', () => {
    const { analytics, win, listeners, historyCalls, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    historyCalls.pushState({}, '', '/map/#PRIVATE')
    historyCalls.replaceState.mockImplementationOnce(() => { throw new Error('Synthetic prohibited cleanup') })
    listeners.get('popstate')?.forEach((handler) => handler({}))
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false })
    expect(tracker.getSession().cache).toBeUndefined()
    historyCalls.replaceState({}, '', '/map/')
    analytics.trackEvent('app_ready')
    expect(tracker.track).not.toHaveBeenCalled()
    expect(win.location.href).toBe('https://example.test/map/')
  })

  it('denies recorder cache immediately for a dirty live URL before navigation listeners run', () => {
    const { analytics, win, historyCalls, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    historyCalls.pushState({}, '', '/map/#PRIVATE')
    expect(tracker.getSession().cache).toBeUndefined()
    expect(win.location.href).toBe('https://example.test/map/')
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason: 'reload-required' })
  })

  it('latches a dirty live URL before guarded history can replace it without navigation listeners or cache checks', () => {
    const { analytics, win, historyCalls, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    historyCalls.pushState({}, '', '/map/#PRIVATE')
    win.history.replaceState({ cleaned: true }, '', '/map/')
    expect(analytics.getTrackingStatus()).toMatchObject({ enabled: false, active: false, reason: 'reload-required' })
    expect(tracker.getSession().cache).toBeUndefined()
    expect(win.location.href).toBe('https://example.test/map/')
    expect(historyCalls.replaceState).toHaveBeenLastCalledWith({ cleaned: true }, '', 'https://example.test/map/')
  })

  it.each(['pushState', 'replaceState'] as const)('preserves native %s failures without replacing their exceptions', (method) => {
    const { analytics, win, historyCalls } = setup()
    analytics.initializeAnalytics()
    const nativeError = new Error('Synthetic native state-cloning failure')
    historyCalls[method].mockImplementationOnce(() => { throw nativeError })
    expect(() => win.history[method]({}, '', '/map/#PRIVATE')).toThrow(nativeError)
    expect(win.location.href).toBe('https://example.test/map/')
  })

  it('cleans the actual URL before recorder loading while retaining only valid native campaign tokens', () => {
    const { analytics, win } = setup({ url: 'https://example.test/map/?utm_source=github&utm_medium=referral&utm_campaign=autumn&utm_content=contains%40email&utm_term=map-tree&save=PRIVATE#secret' })
    analytics.initializeAnalytics()
    expect(win.location.href).toBe('https://example.test/map/')
    const payload = win.ascensionMapBeforeSend!('event', { url: 'https://private.test/secret', referrer: 'https://referrer.test/private-person?q=PRIVATE#hidden' })
    expect(payload).toMatchObject({ website: websiteId, hostname, title: 'Idle Slayer Ascension Map', referrer: 'https://referrer.test/' })
    expect(payload?.url).toBe('https://example.test/map/?utm_source=github&utm_medium=referral&utm_campaign=autumn&utm_term=map-tree')
    expect(JSON.stringify(payload)).not.toMatch(/PRIVATE|secret|private-person|email/)
  })

  it('allowlists event fields and only currently visible native identities', () => {
    const { analytics, tracker, ready } = setup()
    analytics.initializeAnalytics()
    analytics.updateAnalyticsContext(context)
    ready()
    // Deliberately bypass TypeScript to exercise the JavaScript caller boundary.
    const unexpectedCaller = analytics.trackEvent as (name: string, properties?: unknown) => void
    unexpectedCaller('upgrade_selected', { upgrade_id: 'visible-upgrade', milestone_id: 'hidden-milestone', source: 'search', query: 'PRIVATE', filename: 'PRIVATE.sav', epoch: 112, results: '1-5', query_length: '4-10', position: 4, reason: 'PRIVATE error' })
    expect(tracker.track).toHaveBeenCalledWith('upgrade_selected', { app_version: '0.2.0', screen_layout: 'wide', catalog_version: '7.2.0', catalog_revision: 'steam-25551532-v1', layout: 'web', spoilers: false, upgrade_id: 'visible-upgrade', source: 'search' })
    expect(tracker.identify).toHaveBeenCalledWith({ app_version: '0.2.0', screen_layout: 'wide', catalog_version: '7.2.0', catalog_revision: 'steam-25551532-v1', layout: 'web', spoilers: false })
  })

  it('revalidates queued upgrade identities after spoilers or progress change', () => {
    const { analytics, tracker, ready } = setup()
    analytics.initializeAnalytics()
    analytics.updateAnalyticsContext(context)
    analytics.trackEvent('upgrade_selected', { upgrade_id: 'visible-upgrade' })
    analytics.updateAnalyticsContext({ ...context, visibleUpgradeIds: new Set() })
    ready()
    expect(tracker.track.mock.calls[0][1]).not.toHaveProperty('upgrade_id')
  })

  it.each([
    ['search_performed', { query_length: '4-10', results: '1-5', upgrade_id: 'visible-upgrade', source: 'search' }, { query_length: '4-10', results: '1-5' }],
    ['catalog_error', { reason: 'runtime', action: 'load' }, {}],
    ['storage_error', { reason: 'invalid-profile', action: 'load', source: 'progress' }, { reason: 'invalid-profile', action: 'load' }],
    ['map_camera_used', { action: 'pan', source: 'controls', direction: 'left', expanded: true, enabled: true }, { action: 'pan', source: 'controls', direction: 'left', expanded: true }],
    ['milestone_changed', { milestone_id: 'visible-milestone', recorded: true, upgrade_id: 'visible-upgrade' }, { milestone_id: 'visible-milestone', recorded: true }],
    ['milestone_removal_applied', { milestone_id: 'visible-milestone', upgrade_id: 'visible-upgrade' }, { milestone_id: 'visible-milestone' }],
    ['purchase_applied', { upgrade_id: 'visible-upgrade', source: 'details', milestone_id: 'visible-milestone' }, { upgrade_id: 'visible-upgrade', source: 'details' }],
    ['ultra_ascension_applied', { upgrade_id: 'visible-upgrade', milestone_id: 'visible-milestone', operation: 'ultra_ascension', phase: 'applied' }, {}],
    ['app_ready', { enabled: true, catalog_revision: 'PRIVATE', layout: 'game', spoilers: true }, {}],
  ] satisfies [AnalyticsEventName, Record<string, unknown>, Record<string, unknown>][])('filters supported fields for %s at dispatch and the tracker callback', (name, properties, expected) => {
    const { analytics, tracker, ready, win } = setup()
    analytics.initializeAnalytics()
    analytics.updateAnalyticsContext(context)
    ready()
    const unexpectedCaller = analytics.trackEvent as (name: string, properties?: unknown) => void
    unexpectedCaller(name, properties)
    const common = { app_version: '0.2.0', screen_layout: 'wide', catalog_version: '7.2.0', catalog_revision: 'steam-25551532-v1', layout: 'web', spoilers: false }
    expect(tracker.track).toHaveBeenCalledWith(name, { ...common, ...expected })
    const callback = win.ascensionMapBeforeSend!('event', { name, data: properties })
    expect(callback?.data).toEqual({ ...common, ...expected })
  })

  it('keeps every supported operation phase available without accepting invented phases or inherited object names', () => {
    const { analytics, win, ready, tracker } = setup()
    analytics.initializeAnalytics()
    ready()
    const operations = ['purchase', 'removal', 'milestone_removal', 'astral_activation', 'ultra_ascension', 'clear', 'restore', 'recovery'] as const
    const phases = ['previewed', 'applied', 'cancelled'] as const
    for (const operation of operations) for (const phase of phases) {
      const name = `${operation}_${phase}` as const
      analytics.trackEvent(name)
      expect(win.ascensionMapBeforeSend!('event', { name })?.name).toBe(name)
    }
    expect(tracker.track).toHaveBeenCalledTimes(24)
    const unexpectedCaller = analytics.trackEvent as (name: string) => void
    for (const name of ['purchase_started_typo', 'purchase_confirmed', 'constructor', '__proto__', 'toString']) {
      unexpectedCaller(name)
      expect(win.ascensionMapBeforeSend!('event', { name })).toBeNull()
    }
    expect(tracker.track).toHaveBeenCalledTimes(24)
  })

  it.each([0, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', true])('drops invalid positions such as %s at the JavaScript boundary', (position) => {
    const { analytics, win } = setup()
    analytics.initializeAnalytics()
    const payload = win.ascensionMapBeforeSend!('event', { name: 'prerequisite_chosen', data: { position } })
    expect(payload?.data).not.toHaveProperty('position')
  })

  it('preserves positions 1-3 and omits out-of-range UI positions', () => {
    const { analytics, win } = setup()
    analytics.initializeAnalytics()
    for (const position of [1, 2, 3]) {
      expect(analyticsPosition(position)).toBe(position)
      expect(win.ascensionMapBeforeSend!('event', { name: 'recommendation_selected', data: { position } })?.data).toHaveProperty('position', position)
    }
    for (const position of [0, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(analyticsPosition(position)).toBeUndefined()
  })

  it('rechecks queued milestone IDs and never substitutes hidden identities or cross-event fields', () => {
    const { analytics, tracker, ready } = setup()
    analytics.initializeAnalytics()
    analytics.updateAnalyticsContext(context)
    const unexpectedCaller = analytics.trackEvent as (name: string, properties?: unknown) => void
    unexpectedCaller('milestone_changed', { milestone_id: 'visible-milestone', recorded: true, upgrade_id: 'visible-upgrade' })
    analytics.updateAnalyticsContext({ ...context, visibleMilestoneIds: new Set() })
    ready()
    expect(tracker.track.mock.calls[0][1]).toMatchObject({ recorded: true })
    expect(tracker.track.mock.calls[0][1]).not.toHaveProperty('milestone_id')
    expect(tracker.track.mock.calls[0][1]).not.toHaveProperty('upgrade_id')
  })

  it('ignores malformed property getters without throwing or retaining partial data', () => {
    const { analytics, tracker, ready } = setup()
    analytics.initializeAnalytics()
    ready()
    const properties = Object.defineProperty({ source: 'map' }, 'upgrade_id', { enumerable: true, get() { throw new Error('PRIVATE') } })
    const unexpectedCaller = analytics.trackEvent as (name: string, properties?: unknown) => void
    expect(() => unexpectedCaller('upgrade_selected', properties)).not.toThrow()
    expect(tracker.track.mock.calls[0][1]).not.toHaveProperty('source')
    expect(tracker.track.mock.calls[0][1]).not.toHaveProperty('upgrade_id')
    expect(JSON.stringify(tracker.track.mock.calls)).not.toContain('PRIVATE')
  })

  it('sanitizes identify and performance through the same callback without forwarding a distinct ID or caller data', () => {
    const { analytics, win } = setup()
    analytics.initializeAnalytics()
    analytics.updateAnalyticsContext(context)
    const identify = win.ascensionMapBeforeSend!('identify', { id: 'PRIVATE', data: { email: 'PRIVATE', profile: 'PRIVATE' }, referrer: '/map/?save=PRIVATE', screen: '1920x1080', language: 'en-US' })
    expect(identify).not.toHaveProperty('id')
    expect(identify?.data).toEqual({ app_version: '0.2.0', screen_layout: 'wide', catalog_version: '7.2.0', catalog_revision: 'steam-25551532-v1', layout: 'web', spoilers: false })
    expect(identify?.referrer).toBe('/map/')
    const performance = win.ascensionMapBeforeSend!('performance', { data: 'PRIVATE', stack: 'PRIVATE', lcp: 2400, inp: -1, cls: 0.03, fcp: Number.NaN, ttfb: 90000 })
    expect(performance).toMatchObject({ lcp: 2400, cls: 0.03 })
    expect(performance).not.toHaveProperty('inp')
    expect(performance).not.toHaveProperty('ttfb')
    expect(JSON.stringify({ identify, performance })).not.toContain('PRIVATE')
  })

  it('rejects unknown event names and unsupported payload types', () => {
    const { analytics, win, ready, tracker } = setup()
    analytics.initializeAnalytics()
    ready()
    analytics.trackEvent('PRIVATE raw name' as AnalyticsEventName)
    expect(tracker.track).not.toHaveBeenCalled()
    expect(win.ascensionMapBeforeSend!('event', { name: 'PRIVATE' })).toBeNull()
    expect(win.ascensionMapBeforeSend!('record', {})).toBeNull()
    analytics.setTrackingPreference(false)
    expect(win.ascensionMapBeforeSend!('event', {})).toBeNull()
  })

  it('bounds generic runtime categories even when an error source loops', () => {
    vi.useFakeTimers()
    const { analytics, ready, listeners, tracker } = setup()
    analytics.initializeAnalytics()
    ready()
    for (let cycle = 0; cycle < 15; cycle++) {
      for (let repeat = 0; repeat < 20; repeat++) listeners.get('error')?.forEach((handler) => handler({ message: 'PRIVATE', stack: 'PRIVATE' }))
      vi.advanceTimersByTime(30_000)
    }
    expect(tracker.track).toHaveBeenCalledTimes(10)
    expect(tracker.track.mock.calls.every(([name, data]) => name === 'runtime_error' && data.reason === 'runtime')).toBe(true)
    expect(JSON.stringify(tracker.track.mock.calls)).not.toContain('PRIVATE')
  })

  it('cancels malformed payload getters without throwing into the tracker', () => {
    const { analytics, win } = setup()
    analytics.initializeAnalytics()
    const payload = Object.defineProperty({}, 'referrer', { get() { throw new Error('PRIVATE') } })
    expect(() => win.ascensionMapBeforeSend!('event', payload)).not.toThrow()
    expect(win.ascensionMapBeforeSend!('event', payload)).toBeNull()
  })
})

describe('optional tracker failures', () => {
  it('caps delayed events at 100 and expires events after 30 seconds', () => {
    vi.useFakeTimers()
    const first = setup()
    first.analytics.initializeAnalytics()
    for (let count = 0; count < 105; count++) first.analytics.trackEvent('app_ready')
    first.ready()
    expect(first.tracker.track).toHaveBeenCalledTimes(100)
    const second = setup()
    second.analytics.initializeAnalytics()
    second.analytics.trackEvent('app_ready')
    vi.advanceTimersByTime(30_000)
    second.ready()
    expect(second.tracker.track).not.toHaveBeenCalled()
  })

  it('discards failed loads and safely absorbs throwing or rejected tracker calls', async () => {
    const blocked = setup()
    blocked.analytics.initializeAnalytics()
    blocked.analytics.trackEvent('app_ready')
    blocked.scripts[0].onerror?.call(blocked.scripts[0], new Event('error'))
    blocked.ready()
    expect(blocked.tracker.track).not.toHaveBeenCalled()
    expect(blocked.analytics.getTrackingStatus()).toMatchObject({ active: false, reason: 'script-unavailable' })
    const rejecting = setup()
    rejecting.analytics.initializeAnalytics()
    rejecting.tracker.identify.mockImplementation(() => Promise.reject(new Error('PRIVATE')))
    rejecting.tracker.track.mockImplementation(() => { throw new Error('PRIVATE') })
    expect(() => { rejecting.analytics.updateAnalyticsContext(context); rejecting.ready(); rejecting.analytics.trackEvent('app_ready') }).not.toThrow()
    await Promise.resolve()
  })
})
