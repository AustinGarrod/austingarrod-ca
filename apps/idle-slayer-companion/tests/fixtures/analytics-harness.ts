import { createAnalyticsController, type AnalyticsEnvironment } from '../../src/analytics'

// Bundled in memory by browser tests, never an application entry point.
const options = (window as Window & { analyticsTestOptions?: Partial<AnalyticsEnvironment> }).analyticsTestOptions
const controller = createAnalyticsController({
  window,
  production: true,
  hostname: window.location.hostname,
  basePath: '/__analytics-fixture/',
  host: window.location.origin,
  websiteId: '11111111-2222-4333-8444-555555555555',
  ...options,
})
Object.assign(window, { analyticsHarness: controller })
