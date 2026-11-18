import { createAnalyticsController } from '../../src/analytics'
export type { AnalyticsContext, AnalyticsEventName, AnalyticsOperation, AnalyticsProperties, TrackingStatus } from '../../src/analytics'
export { ANALYTICS_PREFERENCE_KEY, honorMigrationOptOut } from '../../src/analytics'
export { analyticsPosition } from '../../src/analytics'

// The browser test's in-memory app build aliases only application imports to this
// module. The normal app build never imports it or enables tracking on localhost.
const controller = createAnalyticsController({
  window,
  production: true,
  hostname: window.location.hostname,
  basePath: '/__analytics-app/',
  host: window.location.origin,
  websiteId: '11111111-2222-4333-8444-555555555555',
})
Object.assign(window, { analyticsHarness: controller })
export const initializeAnalytics = controller.initializeAnalytics
export const updateAnalyticsContext = controller.updateAnalyticsContext
export const trackEvent = controller.trackEvent
export const getTrackingStatus = controller.getTrackingStatus
export const setTrackingPreference = controller.setTrackingPreference
