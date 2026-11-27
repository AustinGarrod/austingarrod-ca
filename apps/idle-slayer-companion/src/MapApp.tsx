import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import { Background, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { reportFailure, reportingState } from './reporting'
import '@xyflow/react/dist/style.css'
import type { Catalog, Profile, Requirement, Upgrade } from './domain/types'
import { emptyProfile, MAX_PROFILE_EPOCH } from './domain/types'
import { planAstralActivation, planPurchase, planRemoval, planUltraAscension, retainedPurchasesOnReset, satisfies, visibility } from './domain/rules'
import { upgradeState } from './domain/discovery'
import { SearchPanel } from './SearchPanel'
import { formatRequirement } from './domain/requirement-label'
import { OVERVIEW_MIN_ZOOM, visibleOverviewViewport, type OverviewViewport } from './domain/map-overview'
import { requirementReviewTarget } from './domain/requirement-view'
import type { RequirementRoute } from './domain/requirement-view'
import { RequirementView } from './RequirementView'
import { exportProfileBackup, parseProfileBackup } from './domain/storage'
import { visibleProgress } from './domain/progress-summary'
import type { StoredSnapshot } from './domain/profile-session'
import { historyActionLabel, type HistoryAction } from './domain/profile-history'
import { SessionHistoryControls } from './SessionHistoryControls'
import { useProfileSession } from './useProfileSession'
import { Dialog, DialogFeedbackContext } from './MapDialog'
import { MenuButton, PopoverButton } from './MenuButton'
import { Icon, nodeTypes, edgeTypes } from './UpgradeCard'
import type { UpgradeNode } from './UpgradeCard'
import { createMapLayout, GAME_NODE_SIZE, MAP_NODE_HEIGHT, MAP_NODE_WIDTH } from './domain/map-layout'
import { loadLayoutPreference, saveLayoutPreference } from './domain/layout-preference'
import { recommendUpgrades } from './domain/recommendations'
import { schemaVersion, source as wikiSource, rows as wikiRows } from './data/wiki-priorities.json'
import { RecommendationPanel } from './RecommendationPanel'
import { importGameSave } from './domain/game-save-import'
import type { GameSaveImportPreview } from './domain/game-save-import'
import { MAX_GAME_SAVE_BYTES } from './domain/save-codec'
import { GameSaveImportPanel } from './GameSaveImportPanel'
import { planPriorAscensions } from './domain/prior-ascensions'
import { PriorAscensionsForm } from './PriorAscensionsForm'
import { decodeProgressTransfer, encodeProgressTransfer, progressTransferLink } from './domain/progress-transfer'
import type { TransferCapture } from './domain/progress-transfer'
import type { ProgressTransferInbox } from './progress-transfer-inbox'
import { createTransferQr } from './domain/transfer-qr'
import type { TransferQrResult } from './domain/transfer-qr'
import type { MapLayoutMode } from './domain/map-layout'
import { ProgressTransferPanel } from './ProgressTransferPanel'
import type { TransferPreview } from './ProgressTransferPanel'
import { analyticsPosition, getTrackingStatus, setTrackingPreference, trackEvent, updateAnalyticsContext } from './analytics'
import type { AnalyticsOperation } from './analytics'
import { PrivacyPanel, trackingDisclosure } from './PrivacyPanel'
import { ProgressComparison, type ProgressComparisonProps } from './ProgressComparison'
import { progressBackupFilename } from './domain/progress-comparison'
import { MapHelpPanel } from './MapHelpPanel'
import { SPCost, ExactCostDetails } from './SPCost'
import { presentCost } from './domain/cost-presentation'
import type { useCheckpointSession } from './useCheckpointSession'
import { CheckpointPanel } from './CheckpointPanel'
import type { useComparisonSession } from './useComparisonSession'
import { SavedComparisonPanel } from './SavedComparisonPanel'
import { UpgradeReference } from './UpgradeReference'
import { getUpgradeReference, subscribeUpgradeReference } from './upgrade-reference-receiver'
import { ReferenceSheetPanel } from './ReferenceSheetPanel'
import { MAX_SHEET_UPGRADES } from './domain/reference-sheet'
import { RecentUpgrades } from './RecentUpgrades'
import { reconcileRecentUpgrades, visitRecentUpgrade } from './domain/recent-navigation'
import { GoalsPanel } from './GoalsPanel'
import { useGoals } from './useGoals'
import { PrerequisiteRoutesPanel } from './PrerequisiteRoutesPanel'
import { UARoadmapPanel } from './UARoadmapPanel'
import { ForwardImpactPanel } from './ForwardImpactPanel'
import type { HypotheticalEvent } from './domain/forward-impact'
import { InstallPanel } from './InstallPanel'
import { prepareUpdate, repairOffline, usePwaStatus } from './pwa'

type Preview = { operation: AnalyticsOperation | 'prior_ascensions'; title: string; text: string; profile: Profile; confirmLabel?: string; destructive?: boolean; changes?: string[]; groups?: { label: string; ids: string[] }[]; replaceStorage?: boolean; upgradeId?: string; milestoneId?: string; sessionVersion?: number; resolution?: 'saved' | 'local'; comparison?: Omit<ProgressComparisonProps, 'catalog'> }
type Menu = 'goals' | 'goal' | 'prior-ascensions' | 'milestones' | 'about' | 'recommendations' | 'game-import' | 'privacy' | 'keyboard-help' | 'reference-sheet' | 'transfer' | 'install' | null
type SelectionSource = 'map' | 'search' | 'neighbor' | 'recommendation' | 'start' | 'keyboard' | 'reference'
const menuTitles: Record<Exclude<Menu, null>, string> = { goals: 'Goals', goal: 'Set a goal', 'prior-ascensions': 'Previous Ultra Ascensions', milestones: 'Milestones', about: 'About this map', recommendations: 'Suggested next upgrade', 'game-import': 'Import save', privacy: 'Privacy & tracking', 'keyboard-help': 'Map help', 'reference-sheet': 'Upgrade reference sheet', transfer: 'Transfer map progress', install: 'Install & offline' }
const graphKeyboardHelp = 'Arrow Right or Down: next visible upgrade. Arrow Left or Up: previous. Home or End: first or last. Enter or Space: select. Escape: deselect. Tab: leave upgrades for camera controls. Shift+Tab: return to the map shortcut. Upgrades are browsed in catalog order; tree positions stay fixed. Directional pan controls close during keyboard exploration.'

const wikiPriorities = { schemaVersion, source: wikiSource, rows: wikiRows }
const cost = (value: string) => presentCost(value).exact

/**
 * Entry points the shell uses for Ascension-scoped work. Each runs through the map's own guarded
 * flows, so previews, transfers and save-before-reload protections still apply.
 */
export interface MapActions {
  openHelp: () => boolean
  openInstall: () => boolean
  openGoals: () => boolean
  openPriorAscensions: () => boolean
  /** Which separately stored references hold unsaved or conflicting edits. */
  referenceRecovery: () => ('checkpoints' | 'comparison' | 'goals')[]
  /** Restore the original Ascension-only map file through the map's own preview. */
  restoreMapBackup: (text: string, name: string) => boolean
  /** QR transfer carries Ascension map progress and layout only. */
  openTransfer: (mode: 'send' | 'receive') => boolean
  openCheckpoints: (restoreText?: string) => boolean
  openComparison: (restoreText?: string) => boolean
  openMilestones: () => boolean
  exportMapBackup: () => boolean
  clearAscension: () => boolean
  undo: () => void
  redo: () => void
}
export type MapReferenceSessions = { checkpoints: ReturnType<typeof useCheckpointSession>; comparison: ReturnType<typeof useComparisonSession> }

interface MapAppProps {
  catalog: Catalog
  transferInbox: ProgressTransferInbox
  active?: boolean
  embedded?: boolean
  onActions?: (actions: MapActions | null) => void
  requestedUpgrade?: { id: string; sequence: number }
  onCompanionImport?: () => void
  onCompanionReset?: () => void
  onCompanionExport?: () => boolean
  onCompanionTrackingChange?: (enabled: boolean) => void
  onReferenceGuard?: (guard: () => boolean) => void
  onCompanionRecovery?: () => void
  /** Called when Install & offline closes, so a shell that opened it from another section can return there. */
  onInstallClosed?: () => void
  /** Checkpoint and comparison sessions are owned by the shell so Data & backup can include them. */
  references: MapReferenceSessions
}
function Atlas({ catalog, transferInbox, active = true, embedded = false, onActions, requestedUpgrade, onCompanionImport, onCompanionReset, onCompanionExport, onCompanionTrackingChange, onReferenceGuard, onCompanionRecovery, references, onInstallClosed }: MapAppProps) {
  const { session: profileSession, state: sessionState, loaded } = useProfileSession(catalog.revision, {
    onState: (state) => { currentProfile.current = state.profile },
    onErrorChange: (state, recovered) => {
      if (recovered) trackEvent('storage_recovered', { action: 'save' })
      else trackEvent('storage_error', { reason: state.errorKind ?? 'unavailable', action: storageLoadReported.current ? 'save' : 'load' })
    },
    onInitialized: () => { storageLoadReported.current = true },
    onBeforeInitialize: syncAnalyticsContext,
    onExternalChange: (state) => {
      invalidatePendingFiles()
      setTransferBusy(false); setTransferGenerated(null); setTransferPreview(null); transferLayoutUndo.current = new WeakMap()
      setPreviewState(null); setPurchaseTarget(null); setChoices({})
      setGameImport(null); setGameImportLoading(false); setGameImportError('')
      setConflictReview(null); setTrackingReload(null); setMenuState(null); setRequirementReview(null)
      setForecast(null)
      setRecentOpen(false)
      setRoutesOpen(false); setRoadmap(null)
      setMessage(state.conflict ? 'Saved progress changed. This session was kept for recovery.' : 'Progress updated from another tab. Previous previews, Undo and Redo were cleared.')
    },
    onDispose: invalidatePendingFiles,
  })
  const { profile, history, redoHistory, writable: storageWritable, error: storageError, pending: saving, persistence, conflict } = sessionState
  const [conflictReview, setConflictReview] = useState<{ version: number; snapshot: StoredSnapshot } | null>(null)
  const intentions = useGoals()
  const [goalTarget, setGoalTarget] = useState<string | null>(null)
  const focusGoals = useRef(false)
  const [forecast, setForecast] = useState<{ event: HypotheticalEvent; profile: Profile } | null>(null)
  const currentForecast = forecast?.profile === profile ? forecast : null
  useEffect(() => { if (forecast && forecast.profile !== profile) setForecast(null) }, [forecast, profile])
  const [selected, setSelected] = useState<string | null>(null)
  type SheetSelection = { ids: string[]; feedback: string }
  const [sheetSelection, setSheetSelectionState] = useState<SheetSelection>({ ids: [], feedback: '' })
  const sheetSelectionRef = useRef(sheetSelection)
  function setSheetSelection(next: SheetSelection | ((current: SheetSelection) => SheetSelection)) {
    const updated = typeof next === 'function' ? next(sheetSelectionRef.current) : next
    sheetSelectionRef.current = updated
    setSheetSelectionState(updated)
  }
  const [recent, setRecent] = useState<string[]>([])
  const [recentOpen, setRecentOpen] = useState(false)
  const [requirementReview, setRequirementReview] = useState<{ target: string; route: RequirementRoute } | null>(null)
  const [graphFocus, setGraphFocus] = useState(catalog.startId)
  const graphHasFocus = useRef(false)
  const [detailFocusRevision, setDetailFocusRevision] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menu, setMenuStateValue] = useState<Menu>(null)
  const menuRef = useRef<Menu>(null)
  function setMenuState(next: Menu) { menuRef.current = next; setMenuStateValue(next) }
  useEffect(() => {
    if (menu !== 'goals' || !focusGoals.current) return
    focusGoals.current = false
    document.getElementById('goals-heading')?.focus()
  }, [menu])
  const [routesOpen, setRoutesOpen] = useState(false)
  const [routeInitialId, setRouteInitialId] = useState<string | undefined>()
  const [roadmap, setRoadmap] = useState<{ profile: Profile; catalog: Catalog; initialId?: string } | null>(null)
  const roadmapCatalog = useRef(catalog)
  roadmapCatalog.current = catalog
  const currentRoadmap = roadmap?.profile === profile && roadmap.profile === profileSession.getState().profile && roadmap.catalog === catalog ? roadmap : null
  useEffect(() => { if (roadmap && !currentRoadmap) setRoadmap(null) }, [roadmap, currentRoadmap])
  const { checkpoints, comparison } = references
  const [checkpointsOpen, setCheckpointsOpen] = useState(false)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  // A file chosen in Data & backup, handed to the collection's own restore preview.
  const [incomingReference, setIncomingReference] = useState<{ kind: 'checkpoints' | 'comparison'; text: string; sequence: number } | null>(null)
  const [comparisonInitialId, setComparisonInitialId] = useState<string | undefined>()
  const [gameImport, setGameImport] = useState<{ result: GameSaveImportPreview; original: Profile } | null>(null)
  const [gameImportError, setGameImportError] = useState('')
  const [gameImportLoading, setGameImportLoading] = useState(false)
  const [transferMode, setTransferMode] = useState<'send' | 'receive'>('send')
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferGenerated, setTransferGenerated] = useState<{ link: string; qr: TransferQrResult } | null>(null)
  const [transferPreview, setTransferPreview] = useState<TransferPreview | null>(null)
  const transferRequest = useRef(0)
  const transferLayoutUndo = useRef(new WeakMap<Profile, { before: MapLayoutMode; after: MapLayoutMode }>())
  const gameImportRequest = useRef(0)
  const restoreRequest = useRef(0)
  const trackingChangeRequest = useRef(0)
  const currentProfile = useRef(profile)
  currentProfile.current = profile
  const [layoutMode, setLayoutMode] = useState(() => loadLayoutPreference(() => window.localStorage))
  const [detailExpanded, setDetailExpanded] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [overviewView, setOverviewView] = useState(false)
  const previousOverviewViewport = useRef<OverviewViewport | null>(null)
  const [preview, setPreviewState] = useState<Preview | null>(null)
  const [trackingReload, setTrackingReload] = useState<boolean | null>(null)
  const [appReload, setAppReloadValue] = useState<'update' | 'repair' | null>(null)
  const appReloadState = useRef(appReload)
  function setAppReload(next: typeof appReload) { appReloadState.current = next; setAppReloadValue(next) }
  const [updatePrepared, setUpdatePrepared] = useState(false)
  const [appReloadPhase, setAppReloadPhase] = useState<'idle' | 'checking' | 'committed'>('idle')
  const appReloadOperation = useRef<{ controller: AbortController; committed: boolean } | null>(null)
  const appReloadRequest = useRef(0)
  const appReloadTitle = appReload === 'update' ? updatePrepared ? 'Close all companion windows to update' : 'Prepare app update?' : 'Reload the app?'
  const pwaStatus = usePwaStatus()
  const [purchaseTarget, setPurchaseTarget] = useState<string | null>(null)
  const purchaseSource = useRef<'details' | 'recommendation'>('details')
  const purchaseEventKey = useRef('')
  const lastSelection = useRef<string | null>(null)
  const keyboardSelection = useRef(false)
  const cameraStart = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const cameraRequest = useRef(0)
  const pendingOverviewRequest = useRef<number | null>(null)
  const recenterOnMapResize = useRef(true)
  const previousSelectionPosition = useRef<{ id: string; mode: 'native' | 'web'; x: number; y: number; progress: string } | null>(null)
  const appReadyReported = useRef(false)
  const storageLoadReported = useRef(false)
  const [choices, setChoices] = useState<Record<string, number>>({})
  const [message, updateMessage] = useState('')
  const [messageSequence, setMessageSequence] = useState(0)
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<number | undefined>(undefined)
  const gameFileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const keyboardSearchDetails = useRef(false)
  const mapElement = useRef<HTMLElement>(null)
  const cameraEntry = useRef<HTMLButtonElement>(null)
  const detailsElement = useRef<HTMLElement>(null)
  const atlasElement = useRef<HTMLElement>(null)
  const toolbarElement = useRef<HTMLElement>(null)
  const workspaceElement = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const atlas = atlasElement.current, toolbar = toolbarElement.current, workspace = workspaceElement.current
    if (!atlas || !toolbar || !workspace) return
    const measure = () => {
      const available = workspace.getBoundingClientRect().height
      atlas.style.setProperty('--toolbar-height', `${toolbar.getBoundingClientRect().height}px`)
      atlas.style.setProperty('--workspace-height', `${available}px`)
      atlas.style.setProperty('--map-reserve', available < 400 ? '80px' : '230px')
      atlas.style.setProperty('--map-navigation-reserve', available < 400 ? '130px' : '230px')
    }
    measure()
    // Updating reserved space inside resize delivery can synchronously resize
    // the observed workspace again. Defer that layout write to the next frame.
    let pendingFrame: number | undefined
    const observer = new ResizeObserver(() => {
      if (pendingFrame !== undefined) return
      pendingFrame = window.requestAnimationFrame(() => { pendingFrame = undefined; measure() })
    })
    observer.observe(toolbar); observer.observe(workspace)
    return () => { observer.disconnect(); if (pendingFrame !== undefined) window.cancelAnimationFrame(pendingFrame) }
  }, [])
  const flow = useReactFlow<UpgradeNode>()
  const motionPreference = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])
  const [reducedMotion, setReducedMotion] = useState(() => motionPreference.matches)
  // Short phone canvases hide the status row; Record then carries Undo and Redo.
  const shortPhoneQuery = useMemo(() => window.matchMedia("(max-width: 600px) and (max-height: 650px)"), [])
  const [shortPhone, setShortPhone] = useState(() => shortPhoneQuery.matches)
  useEffect(() => { const update = () => setShortPhone(shortPhoneQuery.matches); shortPhoneQuery.addEventListener("change", update); return () => shortPhoneQuery.removeEventListener("change", update) }, [shortPhoneQuery])
  useEffect(() => {
    const update = () => setReducedMotion(motionPreference.matches)
    motionPreference.addEventListener('change', update)
    update()
    return () => motionPreference.removeEventListener('change', update)
  }, [motionPreference])
  const visible = useMemo(() => visibility(catalog, profile), [catalog, profile])
  const visibleSheetIds = sheetSelection.ids.filter((id) => visible.ids.has(id))
  useEffect(() => {
    setSheetSelection((current) => { const ids = current.ids.filter((id) => visible.ids.has(id)); return ids.length === current.ids.length ? current : { ids, feedback: '' } })
  }, [visible.ids])
  function addToSheet(id: string) {
    const live = visibility(catalog, profileSession.getState().profile)
    if (!live.ids.has(id)) { setMessage('This upgrade is no longer visible. Review the current map before adding a reference.'); return }
    setSheetSelection((current) => {
      const ids = current.ids.filter((entry) => live.ids.has(entry))
      if (ids.includes(id)) return { ids, feedback: 'This upgrade is already in the reference selection.' }
      if (ids.length >= MAX_SHEET_UPGRADES) return { ids, feedback: 'The four-upgrade sheet is full. Remove an entry in Reference sheet before adding another.' }
      return { ids: [...ids, id], feedback: 'Upgrade added to the reference selection. Open Plan → Reference sheet… to review it.' }
    })
  }
  const graphTabStop = visible.ids.has(graphFocus) ? graphFocus : visible.upgrades[0]?.id
  useLayoutEffect(() => {
    if (!graphTabStop || graphFocus === graphTabStop) return
    setGraphFocus(graphTabStop)
    if (graphHasFocus.current) focusGraphUpgrade(graphTabStop)
  }, [graphFocus, graphTabStop])
  const retainedOnReset = useMemo(() => retainedPurchasesOnReset(catalog, profile), [catalog, profile])
  const index = useMemo(() => new Map(catalog.upgrades.map((node) => [node.id, node])), [catalog])
  const goalUpgrade = goalTarget && visible.ids.has(goalTarget) ? index.get(goalTarget) : undefined
  const detail = selected && visible.ids.has(selected) ? index.get(selected) : undefined
  // Filter before rendering, then discard hidden IDs so revealing them later cannot revive an old trail.
  const visibleRecent = reconcileRecentUpgrades(recent, visible.ids)
  useLayoutEffect(() => {
    setRecent((previous) => {
      const next = reconcileRecentUpgrades(previous, visible.ids)
      return next.length === previous.length && next.every((id, position) => id === previous[position]) ? previous : next
    })
  }, [visible.ids])
  const requirementOrigin = requirementReview && visible.ids.has(requirementReview.target) ? index.get(requirementReview.target) : undefined
  useEffect(() => {
    if (requirementReview && !visible.ids.has(requirementReview.target)) setRequirementReview(null)
  }, [requirementReview, visible.ids])
  useEffect(() => {
    const route = requirementReview?.route
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    const field = menu === 'prior-ascensions' && route?.kind === 'history' ? dialog?.querySelector<HTMLInputElement>('.prior-ascensions input')
      : menu === 'milestones' && route?.kind === 'milestone' ? Array.from(dialog?.querySelectorAll<HTMLInputElement>('[data-requirement-milestone]') ?? []).find((input) => input.dataset.requirementMilestone === route.id) : undefined
    field?.focus({ preventScroll: true }); field?.scrollIntoView({ block: 'nearest' })
  }, [menu, requirementReview])
  // View-only changes must never turn an intentional spoiler toggle into camera navigation.
  const layoutProgress = useMemo(() => JSON.stringify([
    profile.epoch,
    Object.keys(profile.purchases).sort().map((id) => [id, profile.purchases[id].epoch, profile.purchases[id].active]),
    Object.keys(profile.milestones).sort(),
  ]), [profile])
  useLayoutEffect(() => {
    if (detailsElement.current) detailsElement.current.scrollTop = 0
  }, [detail?.id])
  const visibleGraphKey = JSON.stringify([visible.upgrades.map((node) => node.id), visible.connections])
  const layout = useMemo(() => createMapLayout({ mode: layoutMode, upgrades: visible.upgrades, connections: visible.connections }), [catalog, layoutMode, visibleGraphKey])
  const latestOverviewLayout = useRef(layout)
  latestOverviewLayout.current = layout
  const previousOverviewProgress = useRef({ progress: layoutProgress, layout })
  const incoming = visible.connections.filter((edge) => edge.to === detail?.id).map((edge) => index.get(edge.from)!)
  useEffect(() => { reportingState({ mapLayout: layoutMode, visibleNodes: visible.upgrades.length, visibleEdges: visible.connections.length, selectedUpgrade: detail?.id, showSpoilers: profile.showSpoilers }) }, [layoutMode, visible.upgrades.length, visible.connections.length, detail?.id, profile.showSpoilers])
  const outgoing = visible.connections.filter((edge) => edge.from === detail?.id).map((edge) => index.get(edge.to)!)
  const related = useMemo(() => new Set(visible.connections.flatMap((edge) =>
    edge.to === detail?.id ? [edge.from] : edge.from === detail?.id ? [edge.to] : [])), [visible.connections, detail?.id])
  const purchasePlan = purchaseTarget ? planPurchase(catalog, profile, purchaseTarget, choices) : null
  const activeDialogTitle = preview?.title
    ?? (purchasePlan && purchaseTarget ? purchasePlan.kind === 'choice' ? 'Choose a prerequisite path' : purchasePlan.kind === 'blocked' ? 'Explicit progress required' : 'Record purchase?' : null)
    ?? (conflictReview ? 'Review progress conflict' : null)
    ?? (trackingReload !== null ? 'Reload with unsaved progress?' : null)
    ?? (appReload !== null ? appReloadTitle : null)
    ?? (currentRoadmap ? 'Hypothetical UA roadmap' : null)
    ?? (routesOpen ? 'Prerequisite routes' : null)
    ?? (currentForecast ? 'Forward impact' : null)
    ?? (checkpointsOpen ? 'Progress checkpoints' : null)
    ?? (comparisonOpen ? 'Saved upgrade comparison' : null)
    ?? (recentOpen ? 'Recent upgrades' : null)
    ?? (menu ? menuTitles[menu] : null)
  const recommendations = useMemo(() => recommendUpgrades(catalog, profile, wikiPriorities), [catalog, profile])
  const uaEligible = useMemo(() => planUltraAscension(catalog, profile) !== null, [catalog, profile])
  const availableCount = useMemo(() => visible.upgrades.filter((node) => upgradeState(node, profile) === 'available').length, [visible.upgrades, profile])
  const blockedRecommendation = recommendations.status === 'blocked' ? requirementReviewTarget(visible, profile, selected) : undefined
  const progressStatus = {
    loading: 'Checking saved progress on this device…',
    new: 'No profile saved on this device yet.',
    saved: 'Current progress is saved on this device.',
    saving: 'Saving current progress on this device…',
    unsaved: 'Current progress is not saved on this device.',
    failed: 'Current progress is not saved on this device. Export a backup or retry recovery.',
    conflict: 'Progress conflict. Current session is not saved on this device.',
  }[persistence]
  useEffect(() => {
    const heading = detailHeading.current
    if (!keyboardSearchDetails.current || !detail || !heading) return
    if (detailsElement.current) detailsElement.current.scrollTop = 0
    heading.focus({ preventScroll: true })
    heading.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [detail?.id, detailFocusRevision])
  function syncAnalyticsContext() {
    updateAnalyticsContext({ catalog_version: catalog.gameVersion, catalog_revision: catalog.revision,
      layout: layoutMode === 'native' ? 'game' : 'web', spoilers: profile.showSpoilers,
      visibleUpgradeIds: visible.ids, visibleMilestoneIds: new Set(visible.milestones.map((item) => item.id)) })
  }
  useEffect(() => {
    syncAnalyticsContext()
    if (loaded && !appReadyReported.current) { appReadyReported.current = true; trackEvent('app_ready') }
  }, [catalog, layoutMode, loaded, profile.showSpoilers, visible])
  useEffect(() => {
    if (!purchasePlan || !purchaseTarget) { purchaseEventKey.current = ''; return }
    const key = `${purchaseTarget}:${purchasePlan.kind}`
    if (purchaseEventKey.current === key) return
    purchaseEventKey.current = key
    if (purchasePlan.kind === 'ready') trackEvent('purchase_previewed', { upgrade_id: purchaseTarget, source: purchaseSource.current })
    else if (purchasePlan.kind === 'blocked') trackEvent('purchase_blocked', {
      upgrade_id: purchaseTarget, source: purchaseSource.current,
      reason: purchasePlan.requirement.kind === 'milestone' ? 'milestone' : purchasePlan.requirement.kind === 'active' ? 'pending' : 'reveal',
    })
  }, [purchasePlan, purchaseTarget])
  function setMenu(next: Menu, recommendationStatus = recommendations.status) {
    if (appReloadOperation.current?.committed) return
    if (next === 'install' && (preview || purchaseTarget || gameImportLoading || conflictReview || trackingReload !== null
      || menuRef.current === 'transfer' || checkpointsOpen || comparisonOpen || routesOpen || currentRoadmap || currentForecast)) return
    setRoutesOpen(false); setRoadmap(null)
    setForecast(null)
    setRecentOpen(false)
    setCheckpointsOpen(false); setComparisonOpen(false)
    const previous = menuRef.current
    if (next === previous) return
    if (previous === 'prior-ascensions') restoreRequest.current++
    if (previous === 'transfer' && next !== 'transfer') { transferRequest.current++; setTransferBusy(false); setTransferPreview(null); setTransferGenerated(null) }
    if (next) setMessage('')
    if (previous === 'privacy' && next !== 'privacy') trackingChangeRequest.current++
    if (previous === 'install' && next !== 'install') cancelAppReload()
    // Closing Install & offline returns the shell to the section it was opened from.
    if (previous === 'install' && next === null) onInstallClosed?.()
    if (previous && previous !== 'reference-sheet') trackEvent('panel_closed', { panel: previous })
    if (next && next !== 'reference-sheet') trackEvent('panel_opened', { panel: next })
    if (next === 'recommendations') trackEvent('recommendations_viewed', { reason: recommendationStatus === 'fallback' ? 'catalog-fallback' : recommendationStatus })
    setMenuState(next)
  }
  function openCheckpoints() { if (!interruptAppReload()) return; setMenu(null); setSearchOpen(false); setCheckpointsOpen(true) }
  function openComparison(id?: string) {
    if (!interruptAppReload()) return
    setMenu(null); setSearchOpen(false); setComparisonInitialId(id); setComparisonOpen(true)
  }
  function openCompanionTool(target: 'keyboard-help' | 'install' | 'goals' | 'prior-ascensions' | null) {
    if (!loaded) { setMessage('The Ascension map is still loading. Try this action again when it is ready.'); return false }
    if (appReloadOperation.current?.committed) return false
    // A queued install click must never discard an in-flight purchase, import,
    // transfer or reference preview. These are the same guards as setMenu.
    if (target === 'install' && (preview || purchaseTarget || gameImportLoading || conflictReview || trackingReload !== null
      || menuRef.current === 'transfer' || checkpointsOpen || comparisonOpen || routesOpen || currentRoadmap || currentForecast || appReloadState.current !== null)) {
      setMessage('Finish or cancel the current map action before opening Install & offline.')
      return false
    }
    if (!interruptAppReload()) return false
    invalidatePendingFiles()
    setMenu(null); setPreviewState(null); setPurchaseTarget(null); setChoices({})
    setGameImport(null); setGameImportLoading(false); setGameImportError('')
    setConflictReview(null); setTrackingReload(null); setSearchOpen(false)
    if (target) setMenu(target)
    return true
  }
  function previewClearAscension() {
    setMenu(null)
    setPreview({ operation: 'clear', title: 'Clear Ascension progress?', text: 'Clear Ascension purchases and reviewed map milestones, and return to zero Ultra Ascensions with spoilers hidden. Achievements, crafting, quests, Bestiary and Divinities records, and milestones outside the reviewed map, are kept. You can undo this change in this session.', profile: emptyProfile(catalog.revision), replaceStorage: true, confirmLabel: 'Clear Ascension progress', destructive: true })
  }
  // The shell owns app-wide entry points; register fresh closures without
  // exposing map progress or rendering a second set of global controls.
  useLayoutEffect(() => {
    // Each Data & backup hand-off first clears any open map dialog, like the other shell entry points.
    const ready = () => openCompanionTool(null)
    onActions?.({ openHelp: () => openCompanionTool('keyboard-help'), openInstall: () => openCompanionTool('install'), openGoals: () => { focusGoals.current = true; return openCompanionTool('goals') }, openPriorAscensions: () => openCompanionTool('prior-ascensions'),
      referenceRecovery: () => unsavedReferenceKinds(),
      restoreMapBackup: (text, name) => { if (!ready()) return false; void restoreText(text, name); return true },
      openTransfer: (mode) => { if (!ready() || profileSession.getState().pending) return false; openTransfer(mode); return true },
      openCheckpoints: (restoreText) => { if (!ready()) return false; if (restoreText !== undefined) setIncomingReference((current) => ({ kind: 'checkpoints', text: restoreText, sequence: (current?.sequence ?? 0) + 1 })); openCheckpoints(); return true },
      openComparison: (restoreText) => { if (!ready()) return false; if (restoreText !== undefined) setIncomingReference((current) => ({ kind: 'comparison', text: restoreText, sequence: (current?.sequence ?? 0) + 1 })); openComparison(); return true },
      openMilestones: () => { if (!ready()) return false; setMenu('milestones'); return true },
      exportMapBackup: () => backup(),
      clearAscension: () => { if (!ready()) return false; previewClearAscension(); return true },
      undo, redo })
    return () => onActions?.(null)
  })
  function openRoadmap(id?: string) {
    if (!interruptAppReload()) return
    const latest = profileSession.getState().profile
    if (latest !== profile || catalog !== roadmapCatalog.current || id && !visibility(catalog, latest).ids.has(id)) return
    invalidatePendingFiles()
    setMenu(null); setPreviewState(null); setPurchaseTarget(null); setChoices({})
    setConflictReview(null); setTrackingReload(null); setMessage(''); setSearchOpen(false)
    setRoadmap({ profile: latest, catalog, initialId: id })
  }
  function openRoutes(id?: string) {
    if (!interruptAppReload()) return
    if (profileSession.getState().profile !== profile) return
    if (id && !visibility(catalog, profileSession.getState().profile).ids.has(id)) return
    invalidatePendingFiles()
    setMenu(null); setPreviewState(null); setPurchaseTarget(null); setChoices({})
    setConflictReview(null); setTrackingReload(null); setMessage(''); setSearchOpen(false)
    setRouteInitialId(id); setRoutesOpen(true)
  }
  function setPreview(next: Preview | null) {
    if (next && !interruptAppReload()) return
    if (next && profileSession.getState().profile !== profile) { setMessage('Progress changed. Create a fresh preview from the current session.'); return }
    if (next) { setRoutesOpen(false); setRoadmap(null); setForecast(null); setCheckpointsOpen(false); setComparisonOpen(false); setRecentOpen(false) }
    if (next && next.operation !== 'prior_ascensions') trackEvent(`${next.operation}_previewed`, { upgrade_id: next.upgradeId, milestone_id: next.milestoneId })
    else if (!next && preview && preview.operation !== 'prior_ascensions') trackEvent(`${preview.operation}_cancelled`, { upgrade_id: preview.upgradeId, milestone_id: preview.milestoneId })
    setMessage('')
    setPreviewState(next ? { ...next, sessionVersion: next.sessionVersion ?? profileSession.getState().version } : null)
  }
  function startPurchase(id: string, source: 'details' | 'recommendation' = 'details') {
    if (!interruptAppReload()) return
    if (!visible.ids.has(id)) return
    setRoutesOpen(false); setRoadmap(null)
    setForecast(null)
    setMessage('')
    purchaseSource.current = source; purchaseEventKey.current = ''
    trackEvent('purchase_started', { upgrade_id: id, source })
    if (source === 'recommendation') trackEvent('recommendation_purchase_started', { upgrade_id: id, source })
    setChoices({}); setPurchaseTarget(id)
  }
  function cancelPurchase() {
    if (purchaseTarget) trackEvent('purchase_cancelled', { upgrade_id: purchaseTarget, source: purchaseSource.current })
    setPurchaseTarget(null); setChoices({})
    setMessage('')
  }
  function startForecast(event: HypotheticalEvent) {
    if (!interruptAppReload()) return
    if (profileSession.getState().profile !== profile) return
    invalidatePendingFiles()
    setMenu(null); setPreviewState(null); setPurchaseTarget(null); setChoices({})
    setConflictReview(null); setTrackingReload(null); setSearchOpen(false); setMessage('')
    setForecast({ event, profile })
  }
  function closeForecast() {
    setForecast(null)
    if (currentForecast?.event.kind === 'milestone') setMenu('milestones')
  }
  function applyPurchase(continueSuggestions = false) {
    if (purchasePlan?.kind !== 'ready' || !purchaseTarget) return
    const target = purchaseTarget, source = purchaseSource.current
    if (!change(purchasePlan.profile, 'Purchase recorded.', false, 'purchase')) return
    trackEvent('purchase_applied', { upgrade_id: target, source })
    if (source === 'recommendation') trackEvent('recommendation_purchase_applied', { upgrade_id: target })
    setPurchaseTarget(null); setChoices({})
    if (continueSuggestions) setMenu('recommendations', recommendUpgrades(catalog, purchasePlan.profile, wikiPriorities).status)
  }
  function selectSuggestion(id: string, purchase = false) {
    const position = recommendations.suggestions.findIndex((suggestion) => suggestion.upgrade.id === id)
    if (position < 0) return
    const suggestion = recommendations.suggestions[position]
    trackEvent('recommendation_selected', { upgrade_id: id, action: purchase ? 'purchase' : 'show', position: analyticsPosition(position + 1), basis: suggestion.basis === 'fallback' ? 'catalog-fallback' : suggestion.basis })
    setMenu(null); center(id, 'recommendation')
    if (purchase) startPurchase(id, 'recommendation')
  }
  function reviewRequirement(route: RequirementRoute, target: string, fromComparison = false) {
    if (!visible.ids.has(target) || route.kind === 'upgrade' && !visible.ids.has(route.id)
      || route.kind === 'milestone' && !visible.milestones.some((item) => item.id === route.id)) return
    setRequirementReview({ target: fromComparison ? target : requirementOrigin?.id ?? target, route })
    if (purchaseTarget) cancelPurchase()
    if (route.kind === 'upgrade') { setMenu(null); center(route.id, 'neighbor', true, !fromComparison); setDetailExpanded(true) }
    else setMenu(route.kind === 'milestone' ? 'milestones' : 'prior-ascensions')
  }
  function returnToRequirementTarget() {
    if (!requirementOrigin) return
    setMenu(null); center(requirementOrigin.id, 'neighbor', true); setDetailExpanded(true); setRequirementReview(null)
  }
  function reviewBlockedRecommendation(id: string) {
    if (id !== blockedRecommendation?.id) return
    setMenu(null); center(id, 'neighbor', true); setDetailExpanded(true)
  }
  function setMessage(text: string) {
    setMessageSequence((sequence) => sequence + 1)
    updateMessage(text); setToastVisible(Boolean(text)); window.clearTimeout(toastTimer.current)
    if (text) toastTimer.current = window.setTimeout(() => setToastVisible(false), 4000)
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  useEffect(() => {
    const input = gameFileInput.current
    const cancel = () => trackEvent('game_import_cancelled')
    input?.addEventListener('cancel', cancel)
    return () => input?.removeEventListener('cancel', cancel)
  }, [])
  async function persist(next: Profile): Promise<boolean> {
    if (profileSession.getState().profile !== next) return false
    return profileSession.save()
  }
  function change(next: Profile, announcement: string, replaceStorage = false, action: HistoryAction = 'change'): boolean {
    if (!interruptAppReload()) return false
    if (profileSession.getState().profile !== profile) { setMessage('Progress changed. Try this action again using the current session.'); return false }
    if (!profileSession.apply(next, replaceStorage, action)) return false
    setMessage(announcement)
    return true
  }
  function invalidatePendingFiles() {
    cancelAppReload(true)
    gameImportRequest.current++
    restoreRequest.current++
    trackingChangeRequest.current++
    transferRequest.current++
  }
  function reviewConflict() {
    if (onCompanionRecovery) { setMenu(null); setConflictReview(null); onCompanionRecovery(); return }
    cancelAppReload(true)
    setMessage('')
    const current = profileSession.getState()
    if (current.conflict) {
      setRoutesOpen(false); setRoadmap(null)
      setCheckpointsOpen(false)
      setComparisonOpen(false)
      gameImportRequest.current++; restoreRequest.current++; trackingChangeRequest.current++
      setMenu(null); setPreviewState(null); setPurchaseTarget(null); setChoices({}); setTrackingReload(null)
      setGameImport(null); setGameImportLoading(false); setGameImportError('')
      setConflictReview({ version: current.version, snapshot: current.conflict })
    }
  }
  function retryStorage() {
    setMessage('')
    if (profileSession.retry()) reviewConflict()
  }
  useEffect(() => { if (selected && !visible.ids.has(selected)) clearSelection() }, [selected, visible.ids])
  const gameLayout = layoutMode === 'native'
  const nodeWidth = gameLayout ? GAME_NODE_SIZE : MAP_NODE_WIDTH
  const nodeHeight = gameLayout ? GAME_NODE_SIZE : MAP_NODE_HEIGHT
  const startZoom = gameLayout ? 0.6 : 0.85
  const selectionZoom = gameLayout ? 0.85 : 1
  function moveCamera(id: string, zoom = selectionZoom) {
    const position = layout.centers.get(id)
    if (!position) return
    const request = ++cameraRequest.current
    recenterOnMapResize.current = true
    // Docked details resize the canvas. Wait for its new dimensions before centering.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (request !== cameraRequest.current || layout !== latestOverviewLayout.current
        || !visibility(catalog, profileSession.getState().profile).ids.has(id)) return
      const map = mapElement.current?.getBoundingClientRect()
      const camera = mapElement.current?.querySelector('.camera-controls')?.getBoundingClientRect()
      const attribution = mapElement.current?.querySelector('.react-flow__attribution')?.getBoundingClientRect()
      if (map && map.width > 16 && map.height > 16) zoom = Math.min(zoom, (map.width - 16) / nodeWidth, (map.height - 16) / nodeHeight)
      let inset = 0
      let rightOffset = 0
      if (map && camera && camera.right > map.left + map.width / 2 - nodeWidth * zoom / 2) {
        if (camera.top - map.top - 12 >= nodeHeight * zoom + 8) {
          const safeCenter = Math.min(map.height / 2, camera.top - map.top - nodeHeight * zoom / 2 - 12)
          inset = (map.height / 2 - safeCenter) / zoom
        } else if (map.right - camera.right >= nodeWidth * Math.max(44 / nodeWidth, 44 / nodeHeight) + 12) {
          // Short portrait canvases have room beside, rather than above, controls.
          zoom = Math.min(zoom, (map.right - camera.right - 12) / nodeWidth)
          const heightAboveCredit = attribution ? attribution.top - map.top - 8 : 0
          if (heightAboveCredit >= 44) {
            zoom = Math.min(zoom, heightAboveCredit / nodeHeight)
            inset = (map.height / 2 - nodeHeight * zoom / 2 - 4) / zoom
          }
          rightOffset = camera.right - map.left + 8 + nodeWidth * zoom / 2 - map.width / 2
        } else if (camera.top - map.top - 20 >= 44) {
          // Fit above controls when their enlarged text leaves no room beside them.
          zoom = Math.min(zoom, (camera.top - map.top - 20) / nodeHeight)
          inset = (map.height / 2 - nodeHeight * zoom / 2 - 8) / zoom
        }
      }
      // A hidden map (another section is open) has no size, and an animated
      // move on a zero-size canvas interpolates through NaN. Jump instead.
      const duration = reducedMotion || !map?.width || !map.height ? 0 : 220
      // Inspector changes can precede React Flow's cached container dimensions.
      // Both layouts center using the actual canvas rather than that stale cache.
      if (map) void flow.setViewport({
        x: map.width / 2 + rightOffset - position.x * zoom,
        y: map.height / 2 - (position.y + inset) * zoom,
        zoom,
      }, { duration })
      else void flow.setCenter(position.x, position.y + inset, { zoom, duration })
    }))
  }
  function center(id: string, source: SelectionSource = 'map', focusDetails = false, reportSelection = true) {
    const liveVisible = visibility(catalog, profileSession.getState().profile)
    if (!liveVisible.ids.has(id)) return
    leaveOverview()
    keyboardSearchDetails.current = focusDetails
    if (focusDetails) setDetailFocusRevision((revision) => revision + 1)
    if (!selected) setDetailExpanded(false)
    if (reportSelection && source !== 'reference' && lastSelection.current !== id) trackEvent('upgrade_selected', { upgrade_id: id, source })
    lastSelection.current = id
    setRecent((previous) => visitRecentUpgrade(previous, id, liveVisible.ids))
    setGraphFocus(id); setSelected(id); setSearchOpen(false); moveCamera(id)
  }
  const referenceDelivery = useSyncExternalStore(subscribeUpgradeReference, getUpgradeReference, () => null)
  const handledReference = useRef(0)
  const handledCompanionInspection = useRef(0)
  useEffect(() => {
    if (!active || !loaded || !requestedUpgrade || requestedUpgrade.sequence === handledCompanionInspection.current) return
    handledCompanionInspection.current = requestedUpgrade.sequence
    if (visible.ids.has(requestedUpgrade.id)) center(requestedUpgrade.id, 'reference', true)
  }, [active, loaded, requestedUpgrade, visible.ids])
  useEffect(() => {
    if (active) return
    setMenuState(null); setSearchOpen(false); setPreviewState(null); setPurchaseTarget(null)
    setRecentOpen(false); setRoutesOpen(false); setRoadmap(null); setForecast(null)
    setCheckpointsOpen(false); setComparisonOpen(false)
    invalidatePendingFiles()
  }, [active])
  useEffect(() => {
    const close = () => { setMenuState(null); setPreviewState(null); setPurchaseTarget(null); setRecentOpen(false); setRoutesOpen(false); setRoadmap(null); setForecast(null); setCheckpointsOpen(false); setComparisonOpen(false); invalidatePendingFiles() }
    window.addEventListener('companion-panel', close)
    return () => window.removeEventListener('companion-panel', close)
  }, [])
  useEffect(() => {
    if (!loaded || !referenceDelivery || referenceDelivery.sequence === handledReference.current) return
    if (profileSession.getState().version !== sessionState.version) return
    handledReference.current = referenceDelivery.sequence
    cancelAppReload(true)
    if (menuRef.current === 'install') setMenuState(null)
    const reference = referenceDelivery.reference
    if (reference.kind === 'invalid') { setMessage('This upgrade reference is invalid. Your progress and spoiler setting were kept.'); return }
    if (!visible.ids.has(reference.id)) { setMessage('The referenced upgrade is unavailable under your current spoiler setting, or is missing from this catalog. Your progress was kept.'); return }
    center(reference.id, 'reference', true)
    setMessage(reference.revision === catalog.revision ? 'Upgrade reference opened using your own recorded progress.' : 'This reference uses a different catalog revision. Upgrade facts follow the current catalog; your progress was kept.')
  }, [referenceDelivery, loaded, sessionState.version, catalog, visible.ids])
  function openRecentUpgrades() { if (!interruptAppReload()) return; setMenu(null); setMessage(''); setSearchOpen(false); setRecentOpen(true) }
  function returnToRecentUpgrade(id: string) {
    if (!visibility(catalog, profileSession.getState().profile).ids.has(id)) return
    setRecentOpen(false)
    center(id, 'neighbor', true)
  }
  function focusGraphUpgrade(id: string) {
    leaveOverview()
    const node = Array.from(mapElement.current?.querySelectorAll<HTMLElement>('.react-flow__node') ?? []).find((element) => element.dataset.id === id)
    setNavigationOpen(false)
    node?.focus({ preventScroll: true })
    if (node === document.activeElement) moveCamera(id)
  }
  function navigateGraph(event: KeyboardEvent<HTMLElement>) {
    const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.react-flow__node') : null
    const id = element?.dataset.id
    keyboardSelection.current = Boolean(id) && (event.key === 'Enter' || event.key === ' ')
    if (!id || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') {
      // React Flow blurs on Escape. Keep the graph's keyboard exit predictable.
      event.preventDefault(); event.stopPropagation(); clearSelection(); focusGraphUpgrade(id)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
    const ids = visible.upgrades.map((upgrade) => upgrade.id)
    const position = ids.indexOf(id)
    const next = event.key === 'Home' ? ids[0] : event.key === 'End' ? ids.at(-1)
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? ids[(position + 1) % ids.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? ids[(position - 1 + ids.length) % ids.length] : undefined
    if (!next) return
    event.preventDefault(); event.stopPropagation()
    setGraphFocus(next); focusGraphUpgrade(next)
  }
  function clearSelection() {
    lastSelection.current = null; setSelected(null); setRequirementReview(null)
    if (keyboardSearchDetails.current) {
      keyboardSearchDetails.current = false
      // Return to search only when focus was in the closing details (or lost with them); a player
      // working in another control, such as Show spoilers under View, keeps their place.
      const active = document.activeElement
      if (!active || active === document.body || document.querySelector('.details')?.contains(active)) searchInput.current?.focus({ preventScroll: true })
    }
  }
  function toggleSpoilers(enabled: boolean) {
    if (!change({ ...profile, showSpoilers: enabled }, enabled ? 'Spoilers shown.' : 'Spoilers hidden.', false, 'spoilers')) return
    // Changing visibility must not recenter, including when a hidden selection's
    // inspector closes and resizes the canvas. Cancel pending camera work too.
    cameraRequest.current += 1
    recenterOnMapResize.current = false
    void flow.setViewport(flow.getViewport())
    trackEvent('spoilers_changed', { enabled })
  }
  function changeLayout(mode: 'native' | 'web', manualChoice = true) {
    if (manualChoice) transferLayoutUndo.current = new WeakMap()
    if (mode !== layoutMode) trackEvent('map_layout_changed', { layout: mode === 'native' ? 'game' : 'web' })
    setLayoutMode(mode)
    const saved = saveLayoutPreference(mode, () => window.localStorage)
    if (!saved) setMessage('Layout selected for this visit. Your browser could not save the layout preference.')
    return saved
  }
  function beginCameraControl() {
    cameraRequest.current += 1
    recenterOnMapResize.current = false
  }
  function travelHistory(direction: 'undo' | 'redo') {
    if (!interruptAppReload()) return
    const current = profileSession.getState()
    const entry = (direction === 'undo' ? current.history : current.redoHistory).at(-1)
    const transferredLayout = transferLayoutUndo.current.get(direction === 'undo' ? current.profile : entry?.profile ?? current.profile)
    if (!entry || !profileSession[direction]()) return
    invalidatePendingFiles()
    setPreviewState(null); setPurchaseTarget(null); setChoices({})
    setGameImport(null); setGameImportLoading(false); setGameImportError('')
    setConflictReview(null); setTrackingReload(null)
    const restored = profileSession.getState().profile
    const layoutSaved = !transferredLayout || layoutMode !== (direction === 'undo' ? transferredLayout.after : transferredLayout.before)
      || changeLayout(direction === 'undo' ? transferredLayout.before : transferredLayout.after, false)
    if (entry.action === 'spoilers') { beginCameraControl(); void flow.setViewport(flow.getViewport()) }
    setMessage(`${direction === 'undo' ? 'Undid' : 'Redid'} ${historyActionLabel(entry.action).toLowerCase()}. ${direction === 'undo' ? 'Earlier progress' : 'Change'} restored. Spoilers ${restored.showSpoilers ? 'shown' : 'hidden'}.${layoutSaved ? '' : ' Restored layout applies to this visit; your browser could not save it.'}`)
    if (direction === 'undo') trackEvent('progress_undo')
  }
  function leaveOverview() { setOverviewView(false); previousOverviewViewport.current = null; pendingOverviewRequest.current = null }
  function fitOverviewCamera() {
    const request = ++cameraRequest.current
    pendingOverviewRequest.current = request
    recenterOnMapResize.current = true
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (pendingOverviewRequest.current === request) pendingOverviewRequest.current = null
      if (request !== cameraRequest.current || profile !== currentProfile.current || layout !== latestOverviewLayout.current) return
      const map = mapElement.current?.getBoundingClientRect()
      if (!map) return
      const controls = mapElement.current?.querySelector('.camera-controls')?.getBoundingClientRect()
      const summary = mapElement.current?.querySelector('.map-summary')?.getBoundingClientRect()
      const top = summary ? summary.bottom - map.top + 12 : 12
      const bottom = controls ? controls.top - map.top - 12 : map.height - 12
      const viewport = visibleOverviewViewport({ centers: layout.centers, visibleIds: visible.ids, nodeWidth, nodeHeight,
        area: { x: 12, y: top, width: map.width - 24, height: bottom - top } })
      if (!viewport) { leaveOverview(); setMessage('The map needs more room for an overview. Resize the view and try again.'); return }
      void flow.setViewport(viewport, { duration: motionPreference.matches ? 0 : 220 })
    }))
  }
  function showOverview() {
    if (!visible.ids.size) return
    if (!overviewView) previousOverviewViewport.current = flow.getViewport()
    setMenu(null); setSearchOpen(false); setNavigationOpen(false); setOverviewView(true)
    fitOverviewCamera()
    setMessage(detail ? 'Visible map overview. Return to inspection for readable upgrade details.' : 'Visible map overview. Return to your previous view or select an upgrade to inspect it.')
    // The persistent map caption explains this view; avoid covering it on phones.
    setToastVisible(false)
  }
  function refocusSelection(focusDetails = false) {
    if (!detail) return
    setMenu(null); setSearchOpen(false); setNavigationOpen(false); leaveOverview()
    setMessage('')
    if (focusDetails) { keyboardSearchDetails.current = true; setDetailFocusRevision((revision) => revision + 1) }
    moveCamera(detail.id)
  }
  function returnFromOverview(focusDetails = false) {
    if (detail) { refocusSelection(focusDetails); return }
    const previous = previousOverviewViewport.current
    leaveOverview(); beginCameraControl(); setMessage('')
    if (previous) void flow.setViewport(previous, { duration: reducedMotion ? 0 : 220 })
  }
  function undo() { travelHistory('undo') }
  function redo() { travelHistory('redo') }
  function openTransfer(mode: 'send' | 'receive', arrival = false) {
    if (!arrival && !interruptAppReload()) return
    // An arriving link replaces the active interaction, never its progress.
    // Invalidate async work before it can reopen a superseded preview or reload.
    invalidatePendingFiles()
    profileSession.cancelPending()
    setRoutesOpen(false); setRoadmap(null); setForecast(null); setRecentOpen(false)
    setCheckpointsOpen(false); setComparisonOpen(false); setRequirementReview(null); setSearchOpen(false)
    setPreview(null); cancelPurchase(); setChoices({}); setConflictReview(null); setTrackingReload(null)
    setGameImport(null); setGameImportLoading(false); setGameImportError('')
    transferRequest.current++; setTransferBusy(false); setTransferGenerated(null); setTransferPreview(null)
    setMessage('')
    setTransferMode(mode); setMenu('transfer')
  }
  function closeTransfer() {
    transferRequest.current++; setTransferBusy(false); setTransferGenerated(null); setTransferPreview(null); setMenu(null)
  }
  async function generateTransfer() {
    const request = ++transferRequest.current, original = currentProfile.current
    setMessage(''); setTransferBusy(true); setTransferGenerated(null)
    const result = await encodeProgressTransfer(catalog, original, layoutMode)
    if (request !== transferRequest.current) return
    setTransferBusy(false)
    if (currentProfile.current !== original) { setMessage('Progress changed while creating this snapshot. Create a fresh transfer.'); return }
    if (!result.ok) { setMessage(result.error); return }
    const link = progressTransferLink(result.token, window.location.origin, import.meta.env.BASE_URL)
    setTransferGenerated({ link, qr: createTransferQr(link) })
  }
  async function receiveTransfer(input: string) {
    const request = ++transferRequest.current, original = currentProfile.current
    setMessage(''); setTransferBusy(true); setTransferPreview(null)
    const result = await decodeProgressTransfer(input, catalog.revision)
    if (request !== transferRequest.current) return
    setTransferBusy(false)
    if (currentProfile.current !== original) { setMessage('Progress changed while reading this transfer. Paste it again for a fresh preview.'); return }
    if (!result.ok) { setMessage(result.error); return }
    setTransferPreview({ profile: result.profile, layout: result.layout, original })
  }
  function applyTransfer() {
    if (!transferPreview) return
    if (currentProfile.current !== transferPreview.original) { setTransferPreview(null); setMessage('Progress changed while reviewing this transfer. Paste it again for a fresh preview.'); return }
    if (!change(transferPreview.profile, 'Map progress transferred. Undo is available in this session.', true, 'transfer')) return
    transferLayoutUndo.current.set(profileSession.getState().profile, { before: layoutMode, after: transferPreview.layout })
    changeLayout(transferPreview.layout, false)
    closeTransfer()
  }
  const receiveCapturedTransfer = useEffectEvent((received: NonNullable<TransferCapture>) => {
    openTransfer('receive', true)
    if (received.error) setMessage(received.error)
    else if (received.token !== undefined) {
      const token = received.token
      delete received.token
      void receiveTransfer(token)
    }
  })
  const deliverTransferArrival = useEffectEvent(() => {
    const arrival = transferInbox.take()
    if (!arrival) return
    if (arrival.capture) receiveCapturedTransfer(arrival.capture)
    else if (menu === 'transfer') closeTransfer()
  })
  useEffect(() => {
    if (!loaded) return
    const unsubscribe = transferInbox.subscribe(deliverTransferArrival)
    deliverTransferArrival()
    return unsubscribe
  }, [loaded, transferInbox])
  function finishTrackingChange(enabled: boolean) {
    const result = setTrackingPreference(enabled)
    // A fragment-only navigation does not tear down the recorder's listeners.
    window.history.replaceState(window.history.state, '', result.reloadURL)
    window.location.reload()
  }
  async function requestTrackingChange(enabled: boolean) {
    if (onCompanionTrackingChange) { setMenu(null); onCompanionTrackingChange(enabled); return }
    if (!interruptAppReload()) return
    const request = ++trackingChangeRequest.current
    const current = profileSession.getState()
    if (current.pending) { profileSession.cancelPending(); setMenu(null); setTrackingReload(enabled); return }
    const saved = !current.dirty || await persist(current.profile)
    if (request !== trackingChangeRequest.current) return
    if (saved) finishTrackingChange(enabled)
    else { setMenu(null); setTrackingReload(enabled) }
  }
  function unsavedReferenceKinds() {
    const pending: ('checkpoints' | 'comparison' | 'goals')[] = []
    const vault = checkpoints.session.getState(), list = comparison.session.getState()
    if (vault.dirty || vault.pending || vault.conflict) pending.push('checkpoints')
    if (list.dirty || list.pending || list.conflict) pending.push('comparison')
    if (intentions.getState().dirty) pending.push('goals')
    return pending
  }
  const referenceRecovery = unsavedReferenceKinds()
  useEffect(() => { onReferenceGuard?.(() => { const vault = checkpoints.session.getState(), list = comparison.session.getState(); return !(vault.dirty || vault.pending || vault.conflict || list.dirty || list.pending || list.conflict) }) }, [onReferenceGuard])
  useEffect(() => {
    if (appReloadOperation.current && unsavedReferenceKinds().length) {
      cancelAppReload(true)
      setMessage('Local references need recovery before closing or reloading. A progress backup does not include checkpoints, comparison or goals.')
    }
  }, [checkpoints.state.version, comparison.state.version, intentions.dirty])
  function interruptAppReload() {
    if (appReloadOperation.current?.committed) return false
    if (appReloadState.current !== null || appReloadOperation.current || menuRef.current === 'install') {
      cancelAppReload()
      if (menuRef.current === 'install') setMenuState(null)
    }
    return true
  }
  async function requestAppReload(action: 'update' | 'repair') {
    if (menuRef.current !== 'install' || preview || purchaseTarget || gameImportLoading || conflictReview || transferBusy || appReloadOperation.current) return
    if (unsavedReferenceKinds().length) { setMessage('Local references need recovery before closing or reloading. A progress backup does not include checkpoints, comparison or goals.'); return }
    setUpdatePrepared(false)
    const request = ++appReloadRequest.current
    const current = profileSession.getState()
    if (current.pending) { profileSession.cancelPending(); setAppReload(action); return }
    const saved = !current.dirty || await persist(current.profile)
    if (request !== appReloadRequest.current || menuRef.current !== 'install' || profileSession.getState().profile !== current.profile) return
    setAppReload(action)
    if (!saved) setMessage('Progress could not be saved. Export a backup before closing or reloading, or cancel to keep this session.')
  }
  function cancelAppReload(force = false) {
    if (!force && appReloadOperation.current?.committed) return
    appReloadRequest.current++
    appReloadOperation.current?.controller.abort()
    appReloadOperation.current = null
    setAppReloadPhase('idle'); setUpdatePrepared(false); setAppReload(null)
  }
  async function finishAppReload(action: 'update' | 'repair') {
    if (appReloadOperation.current || appReloadState.current !== action || menuRef.current !== 'install') return
    if (unsavedReferenceKinds().length) { cancelAppReload(true); setMessage('Local references need recovery before closing or reloading. Review the separate checkpoint, comparison or goal recovery controls.'); return }
    profileSession.cancelPending()
    if (action === 'update') {
      if (prepareUpdate()) setUpdatePrepared(true)
      else cancelAppReload()
      return
    }
    const current = profileSession.getState()
    const repairURL = window.location.href
    const operation = { controller: new AbortController(), committed: false }
    const canContinue = () => appReloadOperation.current === operation && menuRef.current === 'install'
      && window.location.href === repairURL && profileSession.getState().profile === current.profile && !unsavedReferenceKinds().length
    appReloadOperation.current = operation; setAppReloadPhase('checking')
    const accepted = await repairOffline(operation.controller.signal, () => {
      if (!canContinue()) { operation.controller.abort(); return }
      operation.committed = true; setAppReloadPhase('committed')
    }, canContinue)
    if (appReloadOperation.current !== operation) return
    if (!accepted) cancelAppReload(true)
  }
  const recenterCamera = useEffectEvent(() => {
    const focused = graphHasFocus.current && visible.ids.has(graphFocus) ? graphFocus : null
    if (!loaded) return
    if (overviewView) fitOverviewCamera()
    else moveCamera(focused ?? detail?.id ?? catalog.startId, focused || detail ? selectionZoom : startZoom)
  })
  const resizeMapCamera = useEffectEvent(() => {
    if (recenterOnMapResize.current) recenterCamera()
  })
  const followProgressSelection = useEffectEvent(() => {
    if (detail) moveCamera(detail.id, flow.getViewport().zoom)
  })
  useEffect(() => {
    const position = detail ? layout.centers.get(detail.id) : undefined
    const previous = previousSelectionPosition.current
    previousSelectionPosition.current = detail && position ? {
      id: detail.id, mode: layoutMode, x: position.x, y: position.y, progress: layoutProgress,
    } : null
    if (overviewView || layoutMode !== 'web' || !detail || !position || !previous || previous.id !== detail.id || previous.mode !== layoutMode
      || previous.progress === layoutProgress || (previous.x === position.x && previous.y === position.y)) return
    followProgressSelection()
  }, [detail?.id, layoutMode, layout, layoutProgress])
  useEffect(() => {
    recenterCamera()
  }, [layoutMode, loaded, detailExpanded])
  useEffect(() => {
    const resize = () => recenterCamera()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (!loaded || !mapElement.current) return
    // Grid rows can finish resizing after the initial camera frames, including
    // late font metrics. Keep this observer stable across visibility changes;
    // its initial callback must not reset the user's view on each new graph.
    const observer = new ResizeObserver(() => resizeMapCamera())
    observer.observe(mapElement.current)
    return () => observer.disconnect()
  }, [loaded])
  useEffect(() => {
    const previous = previousOverviewProgress.current
    previousOverviewProgress.current = { progress: layoutProgress, layout }
    // Preserve exploration when recorded progress leaves the visible geometry
    // unchanged. A pending fit still needs a current profile snapshot.
    if (overviewView && previous.progress !== layoutProgress
      && (previous.layout !== layout || pendingOverviewRequest.current === cameraRequest.current)) fitOverviewCamera()
  }, [layoutProgress, layout])
  const state = (node: Upgrade) => upgradeState(node, profile)
  // Unrelated modal/feedback state must not reset React Flow's measured nodes.
  const nodes = useMemo<UpgradeNode[]>(() => visible.upgrades.map((node) => ({ id: node.id, type: 'upgrade', position: layout.centers.get(node.id)!,
    data: { upgrade: node, state: state(node) }, selected: selected === node.id,
    className: !overviewView && detail && node.id !== detail.id ? related.has(node.id) ? 'node-related' : 'node-muted' : '',
    ariaLabel: `${node.title}, ${state(node)}, ${cost(node.cost)} Slayer Points`, width: nodeWidth, height: nodeHeight,
    domAttributes: { tabIndex: node.id === graphTabStop ? 0 : -1, 'aria-current': selected === node.id ? 'true' : undefined },
    ...(gameLayout ? { zIndex: 2 } : {}) })), [visible.upgrades, profile, selected, overviewView, detail?.id, related, layout, nodeWidth, nodeHeight, graphTabStop, gameLayout])
  const edges = visible.connections.map((edge) => {
    const from = layout.centers.get(edge.from)!, to = layout.centers.get(edge.to)!
    const dx = to.x - from.x, dy = to.y - from.y
    const horizontal = Math.abs(dx) > Math.abs(dy)
    const sourceHandle = layoutMode === 'web' ? 'right-out' : horizontal ? dx > 0 ? 'right-out' : 'left-out' : dy > 0 ? 'bottom-out' : 'top-out'
    const targetHandle = layoutMode === 'web' ? 'left-in' : horizontal ? dx > 0 ? 'left-in' : 'right-in' : dy > 0 ? 'top-in' : 'bottom-in'
    const direction = overviewView ? null : edge.to === detail?.id ? 'incoming' : edge.from === detail?.id ? 'outgoing' : null
    const color = direction === 'incoming' ? '#006a61' : direction === 'outgoing' ? '#0b1c30'
      : gameLayout && satisfies({ kind: 'owned', id: edge.from }, profile) ? '#006a61' : '#76777d'
    return { id: `${edge.from}:${edge.to}`, source: edge.from, target: edge.to, sourceHandle, targetHandle,
      type: gameLayout ? 'native' : 'dependency', focusable: false, selectable: false,
      data: { points: layout.edgePaths.get(`${edge.from}:${edge.to}`) },
      className: detail ? direction ? `connection-${direction}` : 'connection-muted' : '',
      style: { stroke: color, strokeWidth: gameLayout ? direction ? 14 : 12 : direction ? 4 : 2 }, zIndex: direction ? 1 : 0,
      markerEnd: gameLayout && !direction ? undefined : { type: MarkerType.ArrowClosed, markerUnits: 'userSpaceOnUse', width: gameLayout ? 24 : 32, height: gameLayout ? 24 : 32, color } }
  })
  function previewIdentity(id: string) {
    const node = index.get(id)
    return node ? <>{node.title} · <SPCost value={node.cost} /></> : 'Unknown upgrade'
  }
  function label(requirement: Requirement): string {
    return formatRequirement(requirement, (leaf) => {
      switch (leaf.kind) {
        case 'always': return 'No prerequisites'
        case 'ultra-ascended': return 'At least one Ultra Ascension'
        case 'milestone': return visible.milestones.find((item) => item.id === leaf.id)?.title ?? 'Unrevealed milestone'
        case 'owned': case 'active': return `${visible.ids.has(leaf.id) ? index.get(leaf.id)?.title ?? 'Unknown upgrade' : 'Unrevealed upgrade'}${leaf.kind === 'active' ? ' (active)' : ''}`
      }
    })
  }
  function previewRemoval(id: string, milestone = false) {
    const result = planRemoval(catalog, profile, id, milestone)
    const changes = result.removed.filter((changedId) => visible.ids.has(changedId))
    setPreview({ operation: milestone ? 'milestone_removal' : 'removal', upgradeId: milestone ? undefined : id, milestoneId: milestone ? id : undefined, title: milestone ? 'Remove milestone?' : 'Remove purchase?', text: `This clears ${changes.length} visible purchase${changes.length === 1 ? '' : 's'} that would lose their dependency path. Valid alternate paths and earlier retained ownership stay intact. The change applies to the entire profile. Lists and counts show only currently visible upgrades.`, profile: result.profile, changes })
  }
  function previewAstralActivation(id: string) {
    const result = planAstralActivation(catalog, profile, id)
    if (result.kind === 'blocked') { setMessage(result.reason); return }
    setPreview({ operation: 'astral_activation', upgradeId: id, title: 'Record an activated Astral?', text: 'Use this when entering existing game progress where this Astral lock already activated in an earlier Ultra Ascension. This Astral receives an earlier-ascension ownership baseline so removing its former prerequisites keeps it. Other purchases keep their recorded history.', profile: result.profile })
  }
  function ultra() {
    if (onCompanionReset) { setMenu(null); onCompanionReset(); return }
    const result = planUltraAscension(catalog, profile)
    if (!result) { setMessage(profile.epoch >= MAX_PROFILE_EPOCH ? 'The supported Ultra Ascension count limit has been reached. Progress was not changed; your current backup remains usable.' : `Ultra Ascension requires: ${label(catalog.ultraAscension)}.`); return }
    setMenu(null)
    const groups = [{ label: 'Repeat purchases cleared', ids: result.cleared }, { label: 'Astral locks activated', ids: result.activated }, { label: 'Conditionally retained purchases', ids: result.conditionallyRetained }]
      .map((group) => ({ ...group, ids: group.ids.filter((id) => visible.ids.has(id)) }))
    setPreview({ operation: 'ultra_ascension', title: 'Ultra Ascend?', text: `Start epoch ${result.profile.epoch}. Clear ${groups[0].ids.length} visible repeat purchases, activate ${groups[1].ids.length} visible Astral locks, and retain ${groups[2].ids.length} visible existing purchases through Astral retention. Keep Astral ownership and milestones. The change applies to the entire profile. Lists and counts show only currently visible upgrades.`, profile: result.profile, groups })
  }
  function reviewPriorAscensions(value: string): string | undefined {
    const result = planPriorAscensions(catalog, profile, value)
    if (result.kind === 'blocked') { setMessage(result.reason); return result.reason }
    setMenu(null)
    setPreview({ operation: 'prior_ascensions', title: 'Record prior Ultra Ascensions?', text: `Change the recorded count from ${profile.epoch} to ${result.profile.epoch}. Keep current purchases in the new current ascension and preserve earlier ownership history, milestones and unknown IDs. Purchases and Astral activation stay unchanged. Recording history does not apply an Ultra Ascension reset. Undo is available in this session; restore an earlier JSON backup after reloading if needed.`, profile: result.profile })
  }
  function backup(): boolean {
    const result = exportProfileBackup(profile)
    if (!result.ok) { setMessage(result.error.message); trackEvent('backup_error', { reason: result.error.kind }); return false }
    const url = URL.createObjectURL(new Blob([result.text], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = progressBackupFilename(profile); link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Progress backup exported.')
    trackEvent('backup_download_requested'); return true
  }
  /** The original map file chosen in Data & backup: same validation and preview, already read by the shell. */
  function restoreText(text: string, name: string) {
    restoreRequest.current++
    setMessage('')
    previewRestore(text, name)
  }
  function previewRestore(text: string, name: string) {
    const result = parseProfileBackup(text, catalog.revision)
    if (!result.ok) { reportFailure(new Error(result.error.message), 'map.backup.validation', { kind: result.error.kind }); setMessage(result.error.message); trackEvent('backup_error', { reason: result.error.kind }); return }
    const incoming = visibleProgress(catalog, result.profile, currentProfile.current.showSpoilers)
    setMenu(null)
    setPreview({ operation: 'restore', title: 'Restore progress?', text: `The backup has ${incoming.owned} visible recorded purchases and ${incoming.milestones} visible milestones, in epoch ${result.profile.epoch}. Counts follow the map's current spoiler setting and the backup's progress. This replaces Ascension purchases, its recorded count and reviewed map milestones. Companion observations and existing milestones outside the reviewed map are kept. Unknown IDs in the backup are retained. The backup's spoiler setting is restored when applied. Undo remains available.`, profile: result.profile, replaceStorage: true, comparison: { current: currentProfile.current, incoming: result.profile, context: `JSON backup: ${name.slice(0, 120)}`, incomingLabel: 'After restore' } })
  }
  function chooseGameSave() { if (!interruptAppReload()) return; restoreRequest.current++; trackEvent('game_import_started'); gameFileInput.current?.click() }
  function closeGameImport() {
    trackEvent('game_import_cancelled')
    gameImportRequest.current++
    setGameImport(null); setGameImportError(''); setGameImportLoading(false); setMenu(null)
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-game-import-trigger]')?.focus({ preventScroll: true }))
  }
  async function readGameSave(file: File) {
    if (menu !== 'game-import') return
    const request = ++gameImportRequest.current
    setGameImport(null); setGameImportError(''); setGameImportLoading(true); setMenu('game-import')
    let bytes: Uint8Array
    try {
      if (file.size > MAX_GAME_SAVE_BYTES) throw new Error('too-large')
      bytes = new Uint8Array(await file.arrayBuffer())
    } catch (error) {
      reportFailure(error, 'map.game-import.read', { bytes: file.size })
      if (request !== gameImportRequest.current) return
      setGameImportLoading(false)
      setGameImportError(file.size > MAX_GAME_SAVE_BYTES ? 'The game save exceeds the 4 MiB import limit. Map progress was not changed.' : 'The game save could not be read. Map progress was not changed.')
      trackEvent('game_import_error', { reason: file.size > MAX_GAME_SAVE_BYTES ? 'size' : 'read' })
      return
    }
    if (request !== gameImportRequest.current) return
    const original = currentProfile.current
    const result = importGameSave(catalog, original, bytes)
    setGameImportLoading(false)
    if (!result.ok) { reportFailure(new Error(result.error), 'map.game-import.validation'); setGameImportError(result.error); trackEvent('game_import_error', { reason: 'validation' }); return }
    setGameImport({ result, original })
    trackEvent('game_import_previewed')
  }
  function applyGameImport() {
    if (!gameImport) return
    if (currentProfile.current !== gameImport.original) {
      setGameImport(null); setGameImportError('Map progress changed while reviewing this import. Choose the save again to create a fresh preview.')
      trackEvent('game_import_error', { reason: 'stale' })
      return
    }
    if (!change(gameImport.result.profile, 'Game progress imported. Undo is available.', true, 'game_import')) return
    trackEvent('game_import_applied')
    gameImportRequest.current++; setGameImport(null); setGameImportError(''); setMenu(null)
  }
  async function applyPreview() {
    if (!preview) return
    const current = profileSession.getState()
    if (preview.sessionVersion !== current.version) { setPreviewState(null); setMessage('Progress changed while reviewing this action. Create a fresh preview.'); return }
    const applied = preview.resolution === 'saved' ? profileSession.useSaved(current.version)
      : preview.resolution === 'local' ? await profileSession.save(true, current.version)
        : change(preview.profile, preview.operation === 'prior_ascensions' ? 'Previous Ultra Ascensions recorded. Undo is available in this session.' : 'Progress updated.', preview.replaceStorage, preview.operation)
    if (!applied) return
    if (preview.operation === 'prior_ascensions') trackEvent('prior_ascensions_recorded')
    else if (preview.resolution !== 'local') trackEvent(`${preview.operation}_applied`, { upgrade_id: preview.upgradeId, milestone_id: preview.milestoneId })
    if (preview.operation === 'milestone_removal') trackEvent('milestone_changed', { milestone_id: preview.milestoneId, recorded: false })
    setPreviewState(null)
  }
  const verified = Object.entries(catalog.verification).filter(([key]) => key !== 'evidence').every(([, value]) => value === true)
  const historyControls = <SessionHistoryControls undoAction={history.at(-1)?.action} redoAction={redoHistory.at(-1)?.action} busy={saving} onUndo={undo} onRedo={redo} />
  const layoutButtons = <><button aria-pressed={layoutMode === 'native'} onClick={() => changeLayout('native')} title="Original game positions">Game Layout</button><button aria-pressed={layoutMode === 'web'} onClick={() => changeLayout('web')} title="Readable dependency layout">Detailed Layout</button></>
  const requirementReturn = requirementOrigin && <div className="requirement-return"><button onClick={returnToRequirementTarget}>Return to {requirementOrigin.title}</button><small>Review the target again to create a fresh purchase preview.</small></div>
  const recoveryControls = <>{!conflictReview && <button onClick={conflict ? reviewConflict : retryStorage}>{conflict ? 'Review progress conflict' : storageWritable ? 'Retry saving' : 'Retry recovery'}</button>}{!conflictReview && <button onClick={backup}>Export backup</button>}</>
  const feedbackContent = <>{message && message !== storageError && <p key={messageSequence}>{message}</p>}{storageError && <><p>{storageError}</p>{!conflictReview && <div className="dialog-actions">{recoveryControls}</div>}</>}</>
  return <DialogFeedbackContext.Provider value={{ title: activeDialogTitle, announcement: [...new Set([message, storageError].filter(Boolean))].join(' '), sequence: messageSequence, content: feedbackContent, clear: () => setMessage('') }}><section ref={atlasElement} className="atlas" aria-label="Ascension map" aria-busy={saving}>
    <header ref={toolbarElement} className="toolbar">
      <h1 className="sr-only">Ascension Map</h1>
      {/* Find: search with its state filter. Then the tools by intent: View, Plan and Record. Data actions live in Data & backup. */}
      <SearchPanel upgrades={visible.upgrades} profile={profile} inputRef={searchInput} open={searchOpen} onOpenChange={setSearchOpen} onSelect={(id, keyboard) => center(id, 'search', keyboard)} />
      <div className="map-tools" role="group" aria-label="Map tools">
        <button id="map-tools" className="next-upgrade" onClick={() => { setSearchOpen(false); setMenu('recommendations') }}>Next upgrade</button>
        <div className="layout-control toolbar-layout" role="group" aria-label="Map layout">{layoutButtons}</div>
        <PopoverButton label="View" className="view-tools">{(close) => <div className="view-popover">
          <div className="layout-control view-layout" role="group" aria-label="Map layout">{layoutButtons}</div>
          <label className="spoiler-control"><input type="checkbox" disabled={saving} checked={profile.showSpoilers} onChange={(event) => toggleSpoilers(event.target.checked)} />Show spoilers</label>
          <button onClick={() => { close(); showOverview() }} disabled={!visible.ids.size}>Overview visible map</button>
          <button onClick={(event) => { const keyboard = event.detail === 0; close(); refocusSelection(keyboard) }} disabled={!detail}>Refocus selected upgrade</button>
          <button onClick={() => { close(); openRecentUpgrades() }}>Recent upgrades…</button>
          <button onClick={() => { close(); setMenu('keyboard-help') }}>Map help…</button>
        </div>}</PopoverButton>
        <MenuButton label="Plan" className="plan-tools" items={[
          { label: 'Goals…', onSelect: () => { focusGoals.current = true; setMenu('goals') } },
          { label: 'Compare prerequisite routes…', onSelect: () => openRoutes() },
          { label: 'Plan hypothetical UAs…', onSelect: () => openRoadmap() },
          { label: 'Saved upgrade comparison…', onSelect: () => openComparison() },
          { label: 'Progress checkpoints…', onSelect: openCheckpoints },
          { label: 'Reference sheet…', onSelect: () => setMenu('reference-sheet') },
        ]} />
        <MenuButton label="Record" className="record-tools" items={[
          { label: 'Milestones…', onSelect: () => setMenu('milestones') },
          { label: 'Record Ultra Ascension…', note: uaEligible ? undefined : 'Requirements not met yet; the review shows what is missing.', onSelect: ultra },
          { label: 'Previous Ultra Ascensions…', onSelect: () => setMenu('prior-ascensions') },
          // Short phones hide the status row to keep the canvas; Undo and Redo live here instead.
          shortPhone && { label: 'Undo', note: history.length ? historyActionLabel(history.at(-1)!.action) : 'No change available', disabled: saving || !history.length, onSelect: undo },
          shortPhone && { label: 'Redo', note: redoHistory.length ? historyActionLabel(redoHistory.at(-1)!.action) : 'No change available', disabled: saving || !redoHistory.length, onSelect: redo },
        ]} />
      </div>
    </header>
    {storageError && !activeDialogTitle && <div className="notice telemetry-private rr-block" role="alert">{storageError} {recoveryControls}</div>}
    {!verified && <div className="notice">Local preview · Catalog verification is incomplete. Publication is gated.</div>}
    <div ref={workspaceElement} className={`workspace ${detail && !overviewView ? 'has-details' : ''} ${detailExpanded ? 'details-expanded' : ''} ${navigationOpen ? 'navigation-open' : ''}`}>
      <section ref={mapElement} className={`map ${gameLayout ? 'map-game' : ''}`} aria-label="Ascension tree" onKeyDownCapture={navigateGraph}
        onFocusCapture={(event) => {
          const node = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.react-flow__node') : null
          const id = node?.dataset.id
          if (!id || !visible.ids.has(id)) return
          graphHasFocus.current = true; keyboardSearchDetails.current = false; setGraphFocus(id); setSearchOpen(false)
          if (node.matches(':focus-visible')) { leaveOverview(); setNavigationOpen(false); moveCamera(id) }
        }} onBlurCapture={(event) => {
          if (!(event.relatedTarget instanceof HTMLElement) || !event.relatedTarget.closest('.react-flow__node')) graphHasFocus.current = false
        }}>
        <div className="map-keyboard-entry"><button aria-describedby="map-keyboard-help" onClick={() => cameraEntry.current?.focus({ preventScroll: true })}>Skip upgrades to camera controls</button><small id="map-keyboard-help">{graphKeyboardHelp}</small></div>
        {loaded && <ReactFlow<UpgradeNode> onError={(code, message) => reportFailure(new Error(message), "map.render", { code, layout: gameLayout ? "game" : "web", nodes: nodes.length, edges: edges.length })} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} elevateEdgesOnSelect={!gameLayout} nodeOrigin={[0.5, 0.5]} autoPanOnNodeFocus={false} nodesDraggable={false} nodeClickDistance={6} paneClickDistance={6} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} minZoom={overviewView ? OVERVIEW_MIN_ZOOM : 0.15} maxZoom={2.5} defaultViewport={{ x: 0, y: 0, zoom: 0.7 }} onInit={(instance) => { const start = layout.centers.get(catalog.startId); if (start) void instance.setCenter(start.x, start.y, { zoom: startZoom }) }} onNodesChange={(changes) => { const selection = changes.find((entry) => entry.type === 'select' && entry.selected); if (selection?.type === 'select') { if (keyboardSelection.current && selection.id !== selected) center(selection.id, 'keyboard'); keyboardSelection.current = false } else if (changes.some((entry) => entry.type === 'select' && !entry.selected && entry.id === selected)) clearSelection() }} onNodeClick={(_, node) => { keyboardSelection.current = false; center(node.id) }} onMoveStart={(event, viewport) => { if (event) { if (overviewView) beginCameraControl(); cameraStart.current = viewport } }} onMoveEnd={(event, viewport) => { const start = cameraStart.current; cameraStart.current = null; if (event && start) { const pan = start.x !== viewport.x || start.y !== viewport.y; const zoom = start.zoom !== viewport.zoom; if (pan || zoom) trackEvent('map_camera_used', { action: pan && zoom ? 'pan_zoom' : zoom ? 'zoom' : 'pan', source: 'pointer' }) } }} onPaneClick={() => setSearchOpen(false)} ariaLabelConfig={{ 'node.a11yDescription.default': graphKeyboardHelp, 'node.a11yDescription.keyboardDisabled': graphKeyboardHelp }}><Background color="#c6c6cd" gap={32} size={1} /></ReactFlow>}
        {/* Two short lines: counts (including how many can be bought now) and the tile legend, so it covers little of the canvas. */}
        <div className="map-summary">{overviewView ? <><b>Visible map overview</b><span>{detail ? 'Return to inspection to read upgrade details.' : 'Return to your previous view or select an upgrade.'}</span></> : <>
          <span className="map-summary-counts"><span><b>{visible.owned}</b> / {visible.total} visible upgrades owned</span><span><b>{availableCount}</b> available</span><span>Ultra Ascensions {profile.epoch}<span className="map-summary-spoilers"> · {profile.showSpoilers ? 'Spoilers shown' : 'Spoilers hidden'}</span></span></span>
          <span className="map-summary-legend"><span><i className="legend-symbol purchased" aria-hidden="true">✓</i>Owned</span><span><i className="legend-symbol available" aria-hidden="true">+</i>Available</span><span><i className="legend-symbol pending" aria-hidden="true">◷</i><span className="legend-long">Awaiting activation</span><span className="legend-short">Pending</span></span><span><i className="legend-symbol locked" aria-hidden="true">◇</i>Locked</span><span className="connection-hint">{detail ? 'Dashed: connected from · Solid: leads to' : layoutMode === 'web' ? 'Prerequisite → upgrade' : 'Teal line: owned prerequisite'}</span></span>
        </>}</div>
        <div className="camera-controls" role="group" aria-label="Map camera controls"><button ref={cameraEntry} aria-label="Zoom out" onClick={() => { beginCameraControl(); trackEvent('map_camera_used', { action: 'zoom_out', source: 'controls' }); void flow.zoomOut({ duration: reducedMotion ? 0 : 150 }) }}>−</button><button aria-label="Zoom in" onClick={() => { beginCameraControl(); trackEvent('map_camera_used', { action: 'zoom_in', source: 'controls' }); void flow.zoomIn({ duration: reducedMotion ? 0 : 150 }) }}>+</button><button aria-label={overviewView ? detail ? "Return to inspection" : "Return to previous view" : "Return to start"} onClick={(event) => { if (overviewView) returnFromOverview(event.detail === 0); else { trackEvent('map_camera_used', { action: 'return_start', source: 'controls' }); center(catalog.startId, 'start') } }}>{overviewView ? detail ? 'Return to inspection' : 'Return to view' : 'Return to start'}</button><button aria-label="Map navigation" aria-expanded={navigationOpen} aria-controls="pan-controls" onClick={() => { trackEvent('map_camera_used', { action: 'navigation_toggle', expanded: !navigationOpen }); setNavigationOpen(!navigationOpen) }}>↔</button></div>
        {/* Feedback sits on the canvas above the camera controls, clear of the toolbar and Undo. */}
        {!activeDialogTitle && message !== storageError && message && toastVisible && <div className="toast" onClick={() => setMessage('')}>{message}<button aria-label="Dismiss status" onClick={() => setMessage('')}>×</button></div>}
        {navigationOpen && <div className="pan-controls" id="pan-controls" aria-label="Map navigation controls"><button aria-label="Pan map left" onClick={() => { beginCameraControl(); trackEvent('map_camera_used', { action: 'pan', source: 'controls', direction: 'left' }); const v = flow.getViewport(); void flow.setViewport({ ...v, x: v.x + 180 }) }}>←</button><button aria-label="Pan map right" onClick={() => { beginCameraControl(); trackEvent('map_camera_used', { action: 'pan', source: 'controls', direction: 'right' }); const v = flow.getViewport(); void flow.setViewport({ ...v, x: v.x - 180 }) }}>→</button><button aria-label="Pan map up" onClick={() => { beginCameraControl(); trackEvent('map_camera_used', { action: 'pan', source: 'controls', direction: 'up' }); const v = flow.getViewport(); void flow.setViewport({ ...v, y: v.y + 180 }) }}>↑</button><button aria-label="Pan map down" onClick={() => { beginCameraControl(); trackEvent('map_camera_used', { action: 'pan', source: 'controls', direction: 'down' }); const v = flow.getViewport(); void flow.setViewport({ ...v, y: v.y - 180 }) }}>↓</button></div>}
      </section>
      {/* Details read in a planner's order: state, cost, the one action, requirements with one shared note,
          then what it leads to and comes from, retention, and sources (collapsed). Planning and sharing tools sit behind two disclosures. */}
      {detail && !overviewView && <aside ref={detailsElement} className={`details ${detailExpanded ? 'expanded' : ''}`} aria-label="Upgrade details"><div className="detail-heading"><div className="detail-identity"><Icon node={detail} /><div><h2 ref={detailHeading} tabIndex={-1}>{detail.title}</h2></div></div><div className="detail-tools"><button className="detail-toggle" aria-expanded={detailExpanded} aria-controls="detail-content" onClick={() => { trackEvent('details_toggled', { expanded: !detailExpanded }); setDetailExpanded(!detailExpanded) }}>{detailExpanded ? 'Hide details' : 'Show details'}</button><button aria-label="Close upgrade details" onClick={clearSelection}>×</button></div><small className="detail-cost"><SPCost value={detail.cost} /></small></div><p className={`state-label ${state(detail)}`}>{state(detail) === 'pending' ? '◷ Owned · awaiting activation' : state(detail) === 'purchased' ? '✓ Purchased and active' : state(detail) === 'locked' ? '◇ Locked' : '+ Available'}</p>
        <div className="detail-actions">
        {!profile.purchases[detail.id] && <button className="primary full" disabled={saving} onClick={() => startPurchase(detail.id)}>Record purchase…</button>}
        {profile.purchases[detail.id] && detail.activation === 'after-ultra-ascension' && !profile.purchases[detail.id].active && <button className="primary full" disabled={saving} onClick={() => previewAstralActivation(detail.id)}>Already activated…</button>}
        {profile.purchases[detail.id] && <button className="text-action danger-text" disabled={saving} onClick={() => previewRemoval(detail.id)}>Remove purchase…</button>}
        </div>
        <div className="detail-content" id="detail-content"><p className="detail-description">{detail.description}</p>{requirementReturn}
          <div className="detail-tools-row">
            <MenuButton label="Plan" buttonLabel="Plan with this upgrade" className="detail-plan" items={[
              { label: 'Set a goal…', onSelect: () => { setGoalTarget(detail.id); setMenu('goal') } },
              { label: 'Compare this upgrade…', onSelect: () => openComparison(detail.id) },
              { label: 'Compare prerequisite routes…', onSelect: () => openRoutes(detail.id) },
              { label: 'Plan hypothetical UAs…', onSelect: () => openRoadmap(detail.id) },
              { label: 'Analyze forward impact…', onSelect: () => startForecast({ kind: 'purchase', id: detail.id }) },
            ]} />
            <PopoverButton label="Share" buttonLabel="Share this upgrade" className="detail-share">{() => <div className="detail-share-panel telemetry-private rr-block">
              <UpgradeReference key={`reference:${detail.id}`} catalog={catalog} upgrade={detail} />
              <ExactCostDetails key={`cost:${detail.id}`} value={detail.cost} upgradeId={detail.id} />
              <section className="sheet-add" aria-label="Add public reference"><button onClick={() => addToSheet(detail.id)}>Add to reference sheet</button><p aria-live="polite" aria-atomic="true">{sheetSelection.feedback}</p></section>
            </div>}</PopoverButton>
          </div>
          <dl><dt>Purchase requirements</dt><dd><RequirementView requirement={detail.purchase} profile={profile} visible={visible} onReview={(route) => reviewRequirement(route, detail.id)} guidance={false} /></dd><dt>Reveal requirements</dt><dd><RequirementView requirement={detail.reveal} profile={profile} visible={visible} onReview={(route) => reviewRequirement(route, detail.id)} guidance={false} /></dd></dl>
          <small className="requirement-guidance">Only requirements you can see are listed; the game’s other rules still apply. Opening one records nothing.</small>
          <div className="connection-list"><section aria-label="Leads to"><h3>Leads to</h3>{outgoing.length ? outgoing.map((node) => <button key={node.id} onClick={() => center(node.id, 'neighbor')}><Icon node={node} /><span>{node.title}</span><span aria-hidden="true">→</span></button>) : <p>No visible outgoing connections.</p>}</section><section aria-label="Connected from"><h3>Connected from</h3>{incoming.length ? incoming.map((node) => <button key={node.id} onClick={() => center(node.id, 'neighbor')}><Icon node={node} /><span>{node.title}</span><span aria-hidden="true">←</span></button>) : <p>No visible incoming connections.</p>}</section></div>
          <dl className="detail-retention"><dt>Ultra Ascension</dt><dd>{detail.retention === 'repeat' ? retainedOnReset.has(detail.id) ? 'Existing purchase · retained by Astral progress on reset' : profile.purchases[detail.id] ? 'Repeat purchase · clears on reset' : 'Repeat purchase · not currently owned' : 'Ownership retained'}{detail.activation === 'after-ultra-ascension' ? ' · Astral lock' : ''}</dd></dl>
          <details className="source-notes"><summary>Sources</summary>{detail.sources.map((source, i) => <p key={i}>{source.url ? <a onClick={() => trackEvent('source_link_opened', { source: 'details', upgrade_id: detail.id, action: 'other' })} href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source.label}{source.evidence && <small>{source.evidence}</small>}</p>)}</details>
        </div></aside>}
    </div>
    {currentRoadmap && <Dialog title="Hypothetical UA roadmap" close={() => setRoadmap(null)}><UARoadmapPanel catalog={catalog} profile={currentRoadmap.profile} getProfile={() => profileSession.getState().profile} initialId={currentRoadmap.initialId} /></Dialog>}
    {routesOpen && <Dialog title="Prerequisite routes" close={() => { setRoutesOpen(false); setRoadmap(null) }}><PrerequisiteRoutesPanel catalog={catalog} profile={profile} visible={visible} goals={intentions.goals} initialId={routeInitialId} /></Dialog>}
    {!embedded && <footer><span>Unofficial companion · {progressStatus}</span>{historyControls}<button onClick={() => setMenu('keyboard-help')}>Map help…</button><button onClick={() => setMenu('about')}>About & sources</button><button aria-label="Install & offline" onClick={() => setMenu('install')}>{pwaStatus.update ? 'Install & offline · Update ready' : 'Install & offline'}</button><button onClick={() => setMenu('privacy')}>Privacy & tracking</button></footer>}
    {!activeDialogTitle && <p className="sr-only" role="status" aria-label="Map action feedback">{message === storageError ? '' : message}</p>}
    <input className="sr-only telemetry-private rr-block" tabIndex={-1} aria-label="Idle Slayer game save" ref={gameFileInput} type="file" accept=".sav" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readGameSave(file) }} />
    {currentForecast && <Dialog title="Forward impact" close={closeForecast} closeOnBackdrop><ForwardImpactPanel catalog={catalog} profile={profile} event={currentForecast.event} /><div className="dialog-actions"><button className="forward-impact-close" onClick={closeForecast}>{currentForecast.event.kind === 'milestone' ? 'Back to Milestones' : 'Return to details'}</button></div></Dialog>}
    {recentOpen && <Dialog title="Recent upgrades" close={() => setRecentOpen(false)} closeOnBackdrop><RecentUpgrades upgrades={visibleRecent.map((id) => index.get(id)!)} visibleUpgrades={visible.upgrades} selected={detail?.id ?? null} onSelect={returnToRecentUpgrade} onClear={() => setRecent([])} /></Dialog>}
    {checkpointsOpen && <Dialog title="Progress checkpoints" close={() => setCheckpointsOpen(false)}><CheckpointPanel incoming={incomingReference?.kind === 'checkpoints' ? incomingReference : undefined} catalog={catalog} profile={profile} history={history} redoHistory={redoHistory} state={checkpoints.state} session={checkpoints.session} currentProfile={() => profileSession.getState().profile} /></Dialog>}
    {comparisonOpen && <Dialog title="Saved upgrade comparison" close={() => setComparisonOpen(false)}><SavedComparisonPanel incoming={incomingReference?.kind === 'comparison' ? incomingReference : undefined} catalog={catalog} profile={profile} getProfile={() => profileSession.getState().profile} visible={visible} session={comparison.session} state={comparison.state} initialId={comparisonInitialId}
      onInspect={(id) => { setComparisonOpen(false); setRequirementReview(null); center(id, 'neighbor', true, false) }}
      onReview={(route, origin) => { setComparisonOpen(false); reviewRequirement(route, origin, true) }} /></Dialog>}
    {menu === 'game-import' && <Dialog title="Import save" close={closeGameImport}>{gameImport ? <GameSaveImportPanel catalog={catalog} currentProfile={gameImport.original} preview={gameImport.result} onApply={applyGameImport} onCancel={closeGameImport} /> : <div className="game-save-picker">{gameImportLoading ? <p role="status">Reading game save…</p> : <><p className="telemetry-private rr-block" role="alert">{gameImportError}</p><p>Choose <b>savedata.sav</b> or <b>backup.sav</b> from a reviewed Idle Slayer 7.3.4 or legacy 7.2.0 Steam save. The selected file is read locally in your browser.</p><p className="game-save-path">%USERPROFILE%\AppData\LocalLow\Pablo Leban\Idle Slayer\</p></>}<div className="dialog-actions">{!gameImportLoading && <button className="primary" onClick={chooseGameSave}>Choose game save…</button>}<button onClick={closeGameImport}>Cancel</button></div></div>}</Dialog>}
    {menu === 'recommendations' && <Dialog title="Suggested next upgrade" close={() => setMenu(null)} closeOnBackdrop><RecommendationPanel catalog={catalog} recommendations={recommendations} onSelect={(id) => selectSuggestion(id)} onPurchase={(id) => selectSuggestion(id, true)} blockedUpgrade={blockedRecommendation} onReviewRequirements={reviewBlockedRecommendation} /></Dialog>}
    {menu === 'reference-sheet' && <Dialog title="Upgrade reference sheet" close={() => setMenu(null)}><ReferenceSheetPanel catalog={catalog} ids={visibleSheetIds} getIds={() => menuRef.current === 'reference-sheet' ? sheetSelectionRef.current.ids : []} viewer={profile} getViewer={() => profileSession.getState().profile} remove={(id) => setSheetSelection((current) => ({ ids: current.ids.filter((entry) => entry !== id), feedback: '' }))} clear={() => setSheetSelection({ ids: [], feedback: '' })} /></Dialog>}
    {menu === 'milestones' && <Dialog title="Milestones" close={() => setMenu(null)} closeOnBackdrop><p>Record the required item received or purchased in the game.</p>{requirementReturn}{visible.milestones.map((item) => <div key={item.id}><label className="milestone"><input data-requirement-milestone={item.id} type="checkbox" disabled={saving} checked={profile.milestones[item.id] === true} onChange={(event) => { if (event.target.checked) { if (change({ ...profile, milestones: { ...profile.milestones, [item.id]: true } }, 'Milestone recorded.', false, 'milestone')) trackEvent('milestone_changed', { milestone_id: item.id, recorded: true }) } else { setMenu(null); previewRemoval(item.id, true) } }} /><span>{item.title}<small>{item.description}</small></span></label>{!profile.milestones[item.id] && <div className="telemetry-private rr-block"><button className="forward-impact-trigger" data-forward-milestone={item.id} aria-label={`Analyze receipt of ${item.title}`} onClick={() => startForecast({ kind: 'milestone', id: item.id })}>Analyze item receipt…</button></div>}</div>)}{!visible.milestones.length && <div><p>No milestone controls are currently revealed. Controls follow the game's reveal rules. To enter existing progress on an isolated branch, you can explicitly show spoilers (also under View), then record here. Record only the required item actually received, crafted or purchased.</p><button onClick={() => toggleSpoilers(true)} disabled={saving}>Show spoilers</button></div>}</Dialog>}
    {/* Goals: the saved list, reached from Plan. Setting one goal has its own small dialog below. */}
    {menu === 'goals' && <Dialog title="Goals" close={() => setMenu(null)}><GoalsPanel catalog={catalog} profile={profile} targetId={null} intentions={intentions} onInspect={(id) => { setMenu(null); center(id, 'neighbor') }} /></Dialog>}
    {menu === 'goal' && goalUpgrade && <Dialog title={`Set a goal for ${goalUpgrade.title}`} close={() => setMenu(null)} initialFocus={() => document.querySelector<HTMLElement>('dialog[open] select[aria-label="Goal completion"]')}><GoalsPanel catalog={catalog} profile={profile} targetId={goalUpgrade.id} intentions={intentions} onInspect={(id) => { setMenu(null); center(id, 'neighbor') }} only="choice" onShowAll={() => setMenu('goals')} /></Dialog>}
    {menu === 'prior-ascensions' && <Dialog title="Previous Ultra Ascensions" close={() => setMenu(null)}><p>Enter Ultra Ascensions you made before using this app. Current purchases stay current, and nothing is reset.</p>{requirementReturn}<PriorAscensionsForm key={profile.epoch} epoch={profile.epoch} disabled={!loaded || saving} onReview={reviewPriorAscensions} onEdit={() => setMessage('')} /></Dialog>}
    {menu === 'transfer' && <Dialog title="Transfer map progress" close={closeTransfer}><ProgressTransferPanel catalog={catalog} profile={profile} layout={layoutMode} mode={transferMode} busy={transferBusy || saving} generated={transferGenerated} preview={transferPreview} onGenerate={() => { void generateTransfer() }} onReceive={(input) => { void receiveTransfer(input) }} onApply={applyTransfer} onCancel={closeTransfer} onBackup={backup} /></Dialog>}
    {menu === 'about' && <Dialog title="About this map" close={() => setMenu(null)} closeOnBackdrop><p>Unofficial Idle Slayer companion. Game assets belong to their respective rights holders. Application code and asset attribution are documented separately.</p><p>Game {catalog.gameVersion} · Steam build {catalog.steamBuild}<br />Catalog {catalog.revision}</p><p>All map data and icons are bundled locally. No account or application backend is required.</p><p className="progress-save-status">{progressStatus}</p><p>{trackingDisclosure}</p><button aria-label="Install & offline" onClick={() => setMenu('install')}>{pwaStatus.update ? 'Install & offline · Update ready' : 'Install & offline'}</button><button onClick={() => setMenu('keyboard-help')}>Map help…</button><button onClick={() => setMenu('privacy')}>Privacy & tracking</button><a onClick={() => trackEvent('source_link_opened', { source: 'about', action: 'github' })} href="https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion">Source and extraction documentation</a><a className="software-license-link" target="_blank" rel="noreferrer" onClick={() => trackEvent('source_link_opened', { source: 'about', action: 'license' })} href={`${import.meta.env.BASE_URL}licenses/index.html`}>Bundled software licenses</a></Dialog>}
    {menu === 'keyboard-help' && <Dialog title="Map help" close={() => setMenu(null)} closeOnBackdrop><MapHelpPanel onImport={onCompanionImport ? () => { setMenu(null); onCompanionImport() } : undefined} onPriorAscensions={() => setMenu('prior-ascensions')} onMilestones={() => setMenu('milestones')} onSpoilers={() => toggleSpoilers(true)} spoilersShown={profile.showSpoilers} /><h3>Keyboard map navigation</h3><p>The map has one Tab stop for its visible upgrades. All visible upgrades remain available by keyboard.</p><ul><li>From the toolbar, Tab reaches the map shortcut. Press Enter to skip directly to camera controls, or Tab again to explore upgrades.</li><li>Arrow Right / Down browses the next upgrade; Left / Up browses the previous. Home / End jumps to the first / last visible upgrade. Browsing follows catalog order and wraps at its ends.</li><li>Enter / Space selects the focused upgrade and opens its details. Escape deselects it. Focus browsing preserves recorded progress and fixed positions.</li><li>Tab leaves upgrades for camera controls; Shift+Tab returns to the map shortcut and toolbar. Camera controls provide zoom, return to start and directional panning. Entering keyboard exploration closes the directional pan controls so upgrades remain unobscured. Use Map navigation to reopen them.</li><li>Search selection by keyboard goes directly to details. Closing those details returns to search.</li></ul><p>Screen-reader users may need their reader's interaction mode to send arrow keys to the focused upgrade. The focused upgrade announces its title, state, cost and keyboard instructions.</p></Dialog>}
    {menu === 'privacy' && <Dialog title="Privacy & tracking" close={() => setMenu(null)} closeOnBackdrop><PrivacyPanel status={getTrackingStatus()} onChange={requestTrackingChange} progressStatus={progressStatus} /></Dialog>}
    {menu === 'install' && appReload === null && <Dialog title="Install & offline" close={() => setMenu(null)} closeOnBackdrop>{referenceRecovery.length > 0 && <div className="telemetry-private rr-block"><p>Local references need recovery before closing or reloading. A progress backup does not include these separate collections.</p><div className="dialog-actions">{referenceRecovery.includes('checkpoints') && <button onClick={openCheckpoints}>Review checkpoint recovery</button>}{referenceRecovery.includes('comparison') && <button onClick={() => openComparison()}>Review comparison recovery</button>}{referenceRecovery.includes('goals') && <button onClick={() => setMenu('goals')}>Review goal recovery</button>}</div></div>}<InstallPanel onReload={() => { void requestAppReload('update') }} onRepair={() => { void requestAppReload('repair') }} progressStatus={progressStatus} /></Dialog>}
    {appReload !== null && <Dialog title={appReloadTitle} close={() => cancelAppReload()} dismissDisabled={appReloadPhase === 'committed'}>
      {updatePrepared ? <><p>Close every Idle Slayer Companion browser tab and installed app window, including this one. Then reopen your companion from its icon or browser. The browser can activate the downloaded update after all old windows close; reloading an open window keeps the old release.</p><p className="telemetry-private rr-block">Before closing, save or export progress in each window. Unsaved changes and session-only Undo and Redo end when its window closes. Restore an exported backup after reopening if needed.</p><button onClick={() => cancelAppReload()}>Keep this session open</button></> : <>
        <p>{appReload === 'repair' ? 'Reconnect and download the app again. Close other map tabs and app windows first. Session-only Undo ends on reload.' : 'Review progress before closing every map tab and app window, then reopen to update. Session-only Undo ends when this window closes.'}</p>
        <div className="telemetry-private rr-block"><p>{progressStatus}</p><p>{profileSession.getState().dirty ? 'This session has unsaved progress. Export a backup before closing or reloading. Cancel keeps this session available.' : 'Saved progress, layout and tracking preferences will be kept. Export a backup first if you want an extra recovery copy.'}</p></div>
        {appReloadPhase !== 'idle' && <p role="status">{appReloadPhase === 'checking' ? 'Checking other map windows… You can still cancel.' : 'Repair started. Keep this window open until it reloads.'}</p>}
        <div className="dialog-actions"><button className="primary" disabled={appReloadPhase !== 'idle'} onClick={() => { if ((onCompanionExport ?? backup)()) void finishAppReload(appReload) }}>{appReload === 'update' ? 'Export backup and prepare update' : 'Export backup and reload'}</button>{!profileSession.getState().dirty ? <button disabled={appReloadPhase !== 'idle'} onClick={() => { void finishAppReload(appReload) }}>{appReload === 'update' ? 'Prepare with saved progress' : 'Reload with saved progress'}</button> : <button className="danger" disabled={appReloadPhase !== 'idle'} onClick={() => { void finishAppReload(appReload) }}>{appReload === 'update' ? 'Prepare without backup' : 'Reload without backup'}</button>}<button disabled={appReloadPhase === 'committed'} onClick={() => cancelAppReload()}>Cancel</button></div>
      </>}
    </Dialog>}
    {trackingReload !== null && <Dialog title="Reload with unsaved progress?" close={() => { setTrackingReload(null); setMenu('privacy') }}>
      <p>Current progress could not be saved. Reloading may lose these changes and clears session-only Undo and Redo. Export a backup first to keep this progress.</p>
      <p>Recording stops when you confirm the tracking change and reload. Cancelling keeps this session and its current tracking choice.</p>
      <div className="dialog-actions"><button className="primary" onClick={() => { if ((onCompanionExport ?? backup)()) finishTrackingChange(trackingReload) }}>Export backup and reload</button><button className="danger" onClick={() => finishTrackingChange(trackingReload)}>Reload without backup</button><button onClick={() => { setTrackingReload(null); setMenu('privacy') }}>Cancel</button></div>
    </Dialog>}
    {conflictReview && <Dialog title="Review progress conflict" close={() => setConflictReview(null)}><div className="telemetry-private rr-block"><p>This session was kept when saved progress changed. Export a backup to keep this session before choosing which progress to use.</p><p>{conflictReview.snapshot.kind === 'valid' ? conflictReview.snapshot.text === null ? 'Saved progress was cleared in another tab.' : `${visibility(catalog, { ...conflictReview.snapshot.profile, showSpoilers: profile.showSpoilers }).owned} visible purchases are in the saved profile.` : conflictReview.snapshot.kind === 'invalid' ? 'Saved progress is not a valid profile. It cannot replace this session.' : 'Saved progress cannot be read. Retry recovery before replacing it.'}</p>{conflictReview.snapshot.kind === 'valid' && <ProgressComparison catalog={catalog} current={profile} incoming={conflictReview.snapshot.profile} incomingLabel="Saved profile" context="Saved progress from another browser tab" />}</div><div className="dialog-actions"><button onClick={backup}>Export this session</button><button disabled={conflictReview.snapshot.kind !== 'valid'} onClick={() => { const snapshot = conflictReview.snapshot; if (snapshot.kind !== 'valid') return; setConflictReview(null); setPreview({ operation: 'recovery', title: 'Use saved progress?', text: 'Replace this session with the reviewed saved progress. This change can be undone until another tab changes saved progress. Export a backup first if you want to keep both.', profile: snapshot.profile, resolution: 'saved', sessionVersion: conflictReview.version, comparison: { current: profile, incoming: snapshot.profile, incomingLabel: 'After replacement (saved)', context: 'Saved progress from another browser tab' } }) }}>Use saved progress…</button><button disabled={conflictReview.snapshot.kind === 'unavailable'} onClick={() => { setConflictReview(null); setPreview({ operation: 'recovery', title: 'Replace saved progress with this session?', text: 'Replace the reviewed saved profile with this session. Export a backup first if you want to keep both. This deliberately replaces the other tab’s saved progress.', profile, resolution: 'local', sessionVersion: conflictReview.version, comparison: conflictReview.snapshot.kind === 'valid' ? { current: conflictReview.snapshot.profile, incoming: profile, viewer: profile, currentLabel: 'Saved profile', incomingLabel: 'After replacement (this session)', undoAvailable: false } : undefined }) }}>Keep this session…</button><button onClick={() => { setConflictReview(null); profileSession.refreshExternal(); reviewConflict() }}>Refresh recovery</button><button onClick={() => { setMessage(''); setConflictReview(null) }}>Cancel</button></div></Dialog>}
    {purchasePlan && purchaseTarget && <Dialog title={purchasePlan.kind === 'choice' ? 'Choose a prerequisite path' : purchasePlan.kind === 'blocked' ? 'Explicit progress required' : 'Record purchase?'} close={cancelPurchase}>{purchasePlan.kind === 'choice' ? <><p>This OR requirement has no satisfied path. Choose before any progress changes.</p>{purchasePlan.options.map((option, i) => <button className="full" key={i} onClick={() => { trackEvent('prerequisite_chosen', { position: analyticsPosition(i + 1), upgrade_id: purchaseTarget }); setChoices({ ...choices, [purchasePlan.key]: i }) }}>{label(option)}</button>)}</> : purchasePlan.kind === 'blocked' ? <><RequirementView requirement={purchasePlan.requirement} profile={profile} visible={visible} onReview={(route) => reviewRequirement(route, purchaseTarget)} /><p>{purchasePlan.reason}</p><button onClick={cancelPurchase}>Close</button></> : <><p>Record {purchasePlan.added.length} purchase{purchasePlan.added.length === 1 ? '' : 's'}, including missing prerequisites.</p><ul className="upgrade-changes">{purchasePlan.added.filter((id) => visible.ids.has(id)).map((id) => <li key={id} data-upgrade-id={id}>{previewIdentity(id)}</li>)}</ul><div className="dialog-actions purchase-confirm-actions">{purchaseSource.current === 'recommendation' && <button className="primary" disabled={saving} onClick={() => applyPurchase(true)}>Apply and continue suggestions</button>}<button className={purchaseSource.current === 'recommendation' ? undefined : 'primary'} disabled={saving} onClick={() => applyPurchase()}>Apply purchases</button>{purchaseSource.current === 'recommendation' && <button onClick={() => { cancelPurchase(); setMenu('recommendations') }}>Back to suggestions</button>}<button onClick={cancelPurchase}>Cancel</button></div></>}</Dialog>}
    {preview && <Dialog title={preview.title} close={() => setPreview(null)}><p className={preview.operation === 'restore' || preview.operation === 'recovery' || preview.operation === 'prior_ascensions' ? 'telemetry-private rr-block' : undefined}>{preview.text}</p>{preview.comparison && <ProgressComparison catalog={catalog} {...preview.comparison} replacementDescription={onCompanionRecovery ? "This replaces Ascension purchases, its recorded count and reviewed map milestones. Companion observations and milestones outside the reviewed map are preserved." : undefined} />}{preview.changes && <ul className="upgrade-changes">{preview.changes.filter((id) => visible.ids.has(id)).map((id) => <li key={id} data-upgrade-id={id}>{previewIdentity(id)}</li>)}</ul>}{preview.groups?.map((group) => <section key={group.label}><h3>{group.label} ({group.ids.length})</h3><ul className="upgrade-changes">{group.ids.filter((id) => visible.ids.has(id)).map((id) => <li key={id} data-upgrade-id={id}>{previewIdentity(id)}</li>)}</ul></section>)}<div className="dialog-actions"><button className={preview.destructive ? 'danger-confirm' : 'primary'} disabled={saving} onClick={() => { void applyPreview() }}>{preview.confirmLabel ?? (preview.operation === 'prior_ascensions' ? 'Record history' : 'Apply changes')}</button><button onClick={() => setPreview(null)}>Cancel</button></div></Dialog>}
  </section></DialogFeedbackContext.Provider>
}

export default function MapApp(props: MapAppProps) {
  return <ReactFlowProvider><Atlas {...props} /></ReactFlowProvider>
}
