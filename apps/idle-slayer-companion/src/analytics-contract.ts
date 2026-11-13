/** The authored event API and runtime boundary share these bounded rules. */
type PropertyRule = readonly (string | number)[] | 'boolean' | 'visible-upgrade' | 'visible-milestone'
type PropertyRules = Readonly<Record<string, PropertyRule>>
type RuleValue<Rule> = Rule extends readonly (infer Value)[] ? Value
  : Rule extends 'boolean' ? boolean : string

const phases = ['previewed', 'applied', 'cancelled'] as const
const layouts = ['web', 'game'] as const
const purchaseSources = ['details', 'recommendation'] as const
const upgradeIdentity = { upgrade_id: 'visible-upgrade' } as const
const milestoneIdentity = { milestone_id: 'visible-milestone' } as const
const purchaseProperties = { ...upgradeIdentity, source: purchaseSources } as const
const operationProperties = {
  purchase: purchaseProperties,
  removal: upgradeIdentity,
  milestone_removal: milestoneIdentity,
  astral_activation: upgradeIdentity,
  ultra_ascension: {},
  clear: {},
  restore: {},
  recovery: {},
} as const satisfies Record<string, PropertyRules>

export type AnalyticsOperation = keyof typeof operationProperties
type OperationPhase = typeof phases[number]
type PhasedContracts<Operations> = {
  [Operation in keyof Operations & string as `${Operation}_${OperationPhase}`]: Operations[Operation]
}
function phasedContracts<const Operations extends Record<string, PropertyRules>>(operations: Operations): PhasedContracts<Operations> {
  // Every key is formed from exactly the operation and phase tuples above.
  return Object.fromEntries(Object.entries(operations).flatMap(([operation, properties]) =>
    phases.map((phase) => [`${operation}_${phase}`, properties]))) as PhasedContracts<Operations>
}

const panels = ['options', 'progress', 'milestones', 'about', 'recommendations', 'game-import', 'privacy', 'keyboard-help', 'transfer', 'install'] as const
const profileReasons = ['invalid-json', 'invalid-profile', 'too-large', 'storage-read', 'storage-write'] as const
const backupReasons = [...profileReasons, 'size', 'read'] as const
const positions = [1, 2, 3] as const
const eventContracts = {
  ...phasedContracts(operationProperties),
  app_ready: {},
  catalog_error: { reason: ['network', 'validation'] },
  runtime_error: { reason: ['runtime', 'unhandled-rejection'] },
  storage_error: { reason: [...profileReasons, 'unavailable', 'stale'], action: ['load', 'save'] },
  storage_recovered: { action: ['save'] },
  panel_opened: { panel: panels },
  panel_closed: { panel: panels },
  map_layout_changed: { layout: layouts },
  spoilers_changed: { enabled: 'boolean' },
  details_toggled: { expanded: 'boolean' },
  map_camera_used: {
    action: ['zoom_in', 'zoom_out', 'zoom', 'pan', 'pan_zoom', 'navigation_toggle', 'return_start'],
    source: ['keyboard', 'pointer', 'controls'], direction: ['left', 'right', 'up', 'down'], expanded: 'boolean',
  },
  search_performed: { query_length: ['1-3', '4-10', '11-30', '31+'], results: ['0', '1-5', '6-20', '21+'] },
  upgrade_selected: { ...upgradeIdentity, source: ['map', 'search', 'neighbor', 'recommendation', 'start', 'keyboard'] },
  source_link_opened: { ...upgradeIdentity, source: ['details', 'recommendation', 'about'], action: ['wiki', 'github', 'license', 'game', 'other'] },
  recommendations_viewed: { reason: ['wiki', 'catalog-fallback', 'all-owned', 'blocked'] },
  recommendation_selected: { ...upgradeIdentity, action: ['purchase', 'show'], position: positions, basis: ['wiki', 'catalog-fallback'] },
  recommendation_purchase_started: { ...upgradeIdentity, source: ['recommendation'] },
  recommendation_purchase_applied: upgradeIdentity,
  purchase_started: purchaseProperties,
  purchase_blocked: { ...purchaseProperties, reason: ['milestone', 'pending', 'reveal'] },
  prerequisite_chosen: { ...upgradeIdentity, position: positions },
  milestone_changed: { ...milestoneIdentity, recorded: 'boolean' },
  prior_ascensions_recorded: {},
  progress_undo: {},
  backup_download_requested: {},
  backup_error: { reason: backupReasons },
  game_import_started: {},
  game_import_previewed: {},
  game_import_applied: {},
  game_import_cancelled: {},
  game_import_error: { reason: ['size', 'read', 'validation', 'stale'] },
} as const satisfies Record<string, PropertyRules>

export type AnalyticsEventName = keyof typeof eventContracts
export type AnalyticsLayout = typeof layouts[number]
/** Optional fields preserve property-free events; each supplied value must obey its event's rules. */
export type AnalyticsProperties<Name extends AnalyticsEventName> = Name extends AnalyticsEventName ?
  keyof typeof eventContracts[Name] extends never ? Record<string, never> : {
  [Key in keyof typeof eventContracts[Name]]?: RuleValue<typeof eventContracts[Name][Key]>
} : never
type PropertyKey<Name extends AnalyticsEventName> = Name extends AnalyticsEventName ? keyof typeof eventContracts[Name] : never
/** NoInfer prevents an invalid property from widening a literal event name to another event. */
export type AnalyticsTrackEvent = <const Name extends AnalyticsEventName,
  const Properties extends AnalyticsProperties<NoInfer<Name>> = AnalyticsProperties<Name>>(
  name: Name,
  properties?: Properties & Record<Exclude<keyof Properties, PropertyKey<Name>>, never>,
) => void

const runtimeContracts: Readonly<Record<string, PropertyRules>> = eventContracts
export function isAnalyticsEventName(name: unknown): name is AnalyticsEventName {
  return typeof name === 'string' && Object.hasOwn(runtimeContracts, name)
}
export function isAnalyticsLayout(layout: unknown): layout is AnalyticsLayout {
  return typeof layout === 'string' && layouts.includes(layout as AnalyticsLayout)
}
/** Maps an existing numeric UI position without adding out-of-range telemetry. */
export function analyticsPosition(value: number): typeof positions[number] | undefined {
  return positions.find((position) => position === value)
}

type VisibleIdentities = { visibleUpgradeIds: ReadonlySet<string>; visibleMilestoneIds: ReadonlySet<string> }
export function sanitizeAnalyticsProperties(name: AnalyticsEventName, properties: unknown, context?: VisibleIdentities) {
  const data: Record<string, string | number | boolean> = {}
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return data
  const rules = runtimeContracts[name]
  try {
    for (const [key, value] of Object.entries(properties)) {
      if (!Object.hasOwn(rules, key)) continue
      const rule = rules[key]
      if (Array.isArray(rule) && (typeof value === 'string' || typeof value === 'number') && rule.includes(value)) data[key] = value
      else if (rule === 'boolean' && typeof value === 'boolean') data[key] = value
      else if (rule === 'visible-upgrade' && typeof value === 'string' && context?.visibleUpgradeIds.has(value)) data[key] = value
      else if (rule === 'visible-milestone' && typeof value === 'string' && context?.visibleMilestoneIds.has(value)) data[key] = value
    }
  } catch { return {} /* Malformed caller data cannot disrupt an optional event. */ }
  return data
}
