import * as Sentry from '@sentry/react'
import { runtimeDeployment } from './runtime-deployment'

export const REPORTING_DSN = 'https://9f79667e017d4cd0bec28a268a47ba4e@reports.garrod.house/7'
let started = false
let appContext: Record<string, string | number | boolean | undefined> = {}
/** Preserve causes and stacks; callers supply operation metadata, never file bytes. */
export function reportFailure(error: unknown, operation: string, context: Record<string, string | number | boolean | undefined> = {}) {
  if (!started) return
  try { Sentry.withScope((scope) => {
    scope.setTag('operation', operation)
    scope.setContext('operation', context)
    Sentry.captureException(error)
    Sentry.logger.error(operation, context)
  }) } catch { /* Optional diagnostics cannot replace the original application failure. */ }
}
export function reportingState(context: Record<string, string | number | boolean | undefined>) {
  appContext = { ...appContext, ...context }
  try { if (started) Sentry.setContext('companion', appContext) } catch { /* Keep the active visit usable. */ }
}
export function reportingAction(action: string, data: Record<string, string | number | boolean> = {}) {
  try { if (started) Sentry.addBreadcrumb({ category: 'companion', message: action, data, level: 'info' }) } catch { /* Keep the action usable. */ }
}
export function initializeReporting() {
  if (started || !runtimeDeployment.telemetryEnabled || (!import.meta.env.PROD && import.meta.env.VITE_REPORTING_ENABLED !== 'true')) return
  // Browser regressions are isolated unless the dedicated delivery check opts in.
  if (navigator.webdriver && import.meta.env.VITE_REPORTING_ENABLED !== 'true') return
  try { Sentry.init({
    dsn: REPORTING_DSN,
    release: import.meta.env.VITE_REPORTING_RELEASE,
    environment: import.meta.env.VITE_REPORTING_ENVIRONMENT || 'production',
    dist: 'web',
    sampleRate: 1,
    tracesSampleRate: 1,
    // SDK 11 enables logs by default. GlitchTip consumes complete transactions.
    traceLifecycle: 'static',
    maxBreadcrumbs: 100,
    attachStacktrace: true,
    initialScope: { tags: { service: 'idle-slayer-companion', surface: 'browser' }, contexts: { build: { commit: import.meta.env.VITE_REPORTING_COMMIT, source: 'https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion', release: import.meta.env.VITE_REPORTING_RELEASE } } },
    beforeSendLog(log) { log.attributes = { ...log.attributes, 'service.name': 'idle-slayer-companion' }; return log },
    integrations: (defaults) => [...defaults.filter((integration) => !['BrowserSession', 'Breadcrumbs'].includes(integration.name)), Sentry.breadcrumbsIntegration({ dom: false }), Sentry.browserTracingIntegration(), Sentry.httpClientIntegration(),
      Sentry.captureConsoleIntegration({ levels: ['error', 'assert'] }),
      Sentry.consoleLoggingIntegration({ levels: ['info', 'warn', 'error'] })],
    // There is no app backend. Do not propagate tracing headers to third parties.
    tracePropagationTargets: [],
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'ui.input') return null
      return breadcrumb
    },
    beforeSend: cleanDiagnosticEvent,
    beforeSendTransaction: cleanDiagnosticEvent,
  }) } catch { return }
  started = true
  reportingState({ online: navigator.onLine, serviceWorker: Boolean(navigator.serviceWorker?.controller) })
  window.addEventListener('online', () => { reportingState({ online: true }); reportingAction('network.online') })
  window.addEventListener('offline', () => { reportingState({ online: false }); reportingAction('network.offline') })
  window.addEventListener('error', (event) => {
    const target = event.target
    if (target instanceof HTMLImageElement || target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
      const url = target instanceof HTMLLinkElement ? target.href : target.src
      reportFailure(new Error('Resource failed to load'), 'resource.load', { url: cleanReportingURL(url), tag: target.tagName, online: navigator.onLine })
    }
  }, true)
}
export function cleanReportingURL(value: string) {
  try { const url = new URL(value, globalThis.location?.href ?? 'http://localhost/'); if (!['https:', 'http:'].includes(url.protocol)) return `[${url.protocol} resource]`; url.hash = ''; url.search = ''; return url.toString() } catch { return '[invalid URL]' }
}
/** Transfer fragments are portable backups, including in performance span attributes. */
export function cleanDiagnosticEvent<T extends Sentry.Event>(event: T): T {
  if (event.request?.url) event.request.url = cleanReportingURL(event.request.url)
  for (const crumb of event.breadcrumbs ?? []) {
    for (const key of ['url', 'from', 'to']) if (typeof crumb.data?.[key] === 'string') crumb.data[key] = cleanReportingURL(crumb.data[key])
  }
  for (const data of [event.contexts?.trace?.data, ...(event.spans ?? []).map((span) => span.data)]) {
    if (!data) continue
    for (const key of ['http.url', 'url.full', 'url']) if (typeof data[key] === 'string') data[key] = cleanReportingURL(data[key])
    delete data['url.query']; delete data['url.fragment']
  }
  return event
}
export { Sentry }
