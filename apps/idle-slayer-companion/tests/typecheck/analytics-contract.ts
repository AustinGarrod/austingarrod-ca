import { createAnalyticsController, trackEvent } from '../../src/analytics'
import type { AnalyticsOperation, AnalyticsProperties } from '../../src/analytics'

// Compiled by yarn typecheck/build, never executed or bundled in the app.
// An unused @ts-expect-error makes typecheck fail if a contract becomes too broad.
export function authoredAnalyticsContract(controller: ReturnType<typeof createAnalyticsController>) {
  trackEvent('app_ready')
  trackEvent('search_performed', { query_length: '4-10', results: '1-5' })
  controller.trackEvent('recommendation_selected', { upgrade_id: 'native-id', position: 3, basis: 'wiki', action: 'show' })
  controller.trackEvent('milestone_changed', { milestone_id: 'native-milestone', recorded: true })
  const properties: AnalyticsProperties<'panel_opened'> = { panel: 'keyboard-help' }
  controller.trackEvent('panel_opened', properties)
  const operation: AnalyticsOperation = 'ultra_ascension'
  trackEvent(`${operation}_previewed`)

  // @ts-expect-error Unsupported event names must not compile.
  trackEvent('purchase_apply')
  // @ts-expect-error A misspelled property must not disappear silently.
  trackEvent('search_performed', { query_lenght: '4-10' })
  // @ts-expect-error Raw input never belongs to the search event.
  controller.trackEvent('search_performed', { query: 'private' })
  // @ts-expect-error Buckets are bounded enums, not arbitrary strings.
  controller.trackEvent('search_performed', { results: '1-10' })
  // @ts-expect-error A valid enum from another event is still unsupported here.
  trackEvent('catalog_error', { reason: 'runtime' })
  // @ts-expect-error Property-free events cannot carry otherwise valid fields.
  trackEvent('app_ready', { source: 'map' })
  // @ts-expect-error Only actual panels are permitted.
  controller.trackEvent('panel_opened', { panel: 'new-panel' })
  // @ts-expect-error A string that looks like a boolean is not a boolean.
  trackEvent('details_toggled', { expanded: 'true' })
  // @ts-expect-error Camera actions cannot contain arbitrary link actions.
  trackEvent('map_camera_used', { action: 'wiki' })
  // @ts-expect-error Positions cannot expand beyond the current 1-3 boundary.
  trackEvent('recommendation_selected', { position: 4 })
  // @ts-expect-error Fractional positions cannot be authored.
  controller.trackEvent('prerequisite_chosen', { position: 1.5 })
  // @ts-expect-error Known identities are still event-specific.
  trackEvent('milestone_changed', { upgrade_id: 'native-id' })
  // @ts-expect-error A reset has no custom identity properties.
  trackEvent('ultra_ascension_applied', { upgrade_id: 'native-id' })
  // @ts-expect-error Import failures cannot be raw runtime failures.
  trackEvent('game_import_error', { reason: 'unhandled-rejection' })
  // @ts-expect-error Storage does not use backup file-read categories.
  trackEvent('storage_error', { reason: 'read' })
  const unexpectedProperties = { source: 'map', filename: 'private.sav' } as const
  // @ts-expect-error Variables with unsupported keys are rejected too.
  trackEvent('upgrade_selected', unexpectedProperties)
  const arbitrarySource: string = 'map'
  // @ts-expect-error An unvalidated broad string does not establish a bounded enum.
  controller.trackEvent('upgrade_selected', { source: arbitrarySource })
  // @ts-expect-error The named property type has the same event-specific boundary.
  const badProperties: AnalyticsProperties<'purchase_started'> = { source: 'pointer' }
  // @ts-expect-error Property-free named types also reject custom fields at declaration.
  const emptyProperties: AnalyticsProperties<'app_ready'> = { filename: 'private.sav' }
  return [badProperties, emptyProperties]
}
