import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Catalog } from './domain/types'
import type { CompanionCatalog, CompanionEntityRef, CompanionProgress, CompanionRecord, CompanionSystem } from './domain/companion-types'
import MapApp, { type MapActions } from './MapApp'
import { catalogErrors } from './domain/catalog'
import { companionCatalogErrors, companionEntityState, companionRequirementState, deriveBestiaryMastery, entityKey, visibleCompanionEntities } from './domain/companion-catalog'
import { createCompanionSession } from './domain/companion-session'
import { COMPANION_STORAGE_KEY, exportCompanionBackup, MAX_COMPANION_BYTES, parseCompanionBackup } from './domain/companion-storage'
import { getCompanionRecord } from './domain/companion-progress'
import { planCompanionObservation } from './domain/companion-observation'
import { importCompanionGameSave } from './domain/companion-native'
import { deriveCompanionDivinityActive, planCompanionUltraAscension } from './domain/companion-reset'
import { exportProfileBackup, parseProfileBackup, PROFILE_STORAGE_KEY } from './domain/storage'
import { MAX_GAME_SAVE_BYTES } from './domain/save-codec'
import { planUltraAscension, visibility } from './domain/rules'
import { CompanionShell, type CompanionSection } from './CompanionShell'
import { MigrationGuide } from './components/MigrationGuide'
import { CompanionModules } from './CompanionModules'
import { CompanionMapGoalsContext, CompanionProfileContext } from './CompanionRuntimeContext'
import { useCompanionWorkspace, parseCompanionWorkspace, type CompanionWorkspace, type CompanionWorkspaceReview } from './useCompanionWorkspace'
import type { GoalsController } from './useGoals'
import type { Goals } from './domain/goals'
import { SessionHistoryControls } from './SessionHistoryControls'
import { PrivacyPanel, trackingDisclosure } from './PrivacyPanel'
import { Dialog } from './MapDialog'
import { InstallPanel } from './InstallPanel'
import { ANALYTICS_PREFERENCE_KEY, getTrackingStatus, setTrackingPreference, trackEvent } from './analytics'
import { repairOffline } from './pwa'
import type { ProgressTransferInbox } from './progress-transfer-inbox'
import { getUpgradeReference, subscribeUpgradeReference } from './upgrade-reference-receiver'
import { sectionAtPath, sectionPath } from './domain/companion-navigation'
import { ProgressComparison } from './ProgressComparison'
import { SPCost } from './SPCost'
import { reportFailure, reportingState, reportingAction, Sentry } from './reporting'

type LoadedCatalogs = { map: Catalog | null; companion: CompanionCatalog | null }
type Panel = 'import' | 'backup' | 'settings' | 'help' | 'install' | 'reset' | 'correction' | null
type ReloadAction = { kind: 'tracking'; enabled: boolean } | { kind: 'catalog' | 'repair' }
type MapToolAction = keyof Pick<MapActions, 'openHelp' | 'openInstall' | 'openReferences' | 'openProgress'>
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function reloadWithURL(url: string) {
  try { history.replaceState(history.state, '', url) } catch { location.replace(url); return }
  location.reload()
}
function observationText(record: CompanionRecord) {
  const values = Object.entries(record).map(([key, value]) => `${({ count: 'Count', completed: 'Complete', discovered: 'Discovered', claimed: 'Claimed', selected: 'Selected', built: 'Built', stage: 'Stage', active: 'Active' } as Record<string, string>)[key]}: ${typeof value === 'boolean' ? value ? 'yes' : 'no' : value}`)
  return values.length ? values.join(' · ') : 'Not recorded'
}
export default function App({ transferInbox, initialMapIntent = false }: { transferInbox: ProgressTransferInbox; initialMapIntent?: boolean }) {
  const [catalogs, setCatalogs] = useState<LoadedCatalogs | null>(null)
  const [startupTracking, setStartupTracking] = useState(getTrackingStatus)
  useEffect(() => { const changed = (event: StorageEvent) => { if (event.key === null || event.key === ANALYTICS_PREFERENCE_KEY || event.key === 'umami.disabled') setStartupTracking(getTrackingStatus()) }; window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed) }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load<T>(file: string, validate: (value: unknown) => string[]) {
      let failure: 'network' | 'validation' = 'network'
      return Sentry.startSpan({ name: `catalog.load ${file}`, op: 'catalog.load' }, async () => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}${file}`, { signal: controller.signal })
          if (!response.ok) throw new Error(`Catalog HTTP ${response.status} ${response.statusText}`)
          failure = 'validation'
          const value: unknown = await response.json(), errors = validate(value)
          if (errors.length) throw new Error(`Catalog validation: ${errors.join('; ')}`)
          reportingAction('catalog.loaded', { file })
          return value as T
        } catch (error) { if (!controller.signal.aborted) { reportFailure(error, 'catalog.load', { file, phase: failure, online: navigator.onLine }); trackEvent('catalog_error', { reason: failure }) }; return null }
      })
    }
    void Promise.all([load<Catalog>('catalog.json', (value) => catalogErrors(value as Catalog)), load<CompanionCatalog>('companion-catalog.json', companionCatalogErrors)])
      .then(([map, companion]) => { if (!controller.signal.aborted) setCatalogs({ map, companion }) })
    return () => controller.abort()
  }, [])
  if (!catalogs) return <main className="loading"><h1>Idle Slayer Companion</h1><p role="status">Opening your companion…</p><p className="startup-disclosure">{trackingDisclosure}</p><details className="startup-privacy" onToggle={(event) => { if (event.currentTarget.open) setStartupTracking(getTrackingStatus()) }}><summary>Privacy & tracking</summary><PrivacyPanel status={startupTracking} onChange={(enabled) => { const result = setTrackingPreference(enabled); reloadWithURL(result.reloadURL) }} /></details></main>
  return <Companion catalogs={catalogs} transferInbox={transferInbox} initialMapIntent={initialMapIntent} />
}

function Companion({ catalogs, transferInbox, initialMapIntent }: { catalogs: LoadedCatalogs; transferInbox: ProgressTransferInbox; initialMapIntent: boolean }) {
  const { map, companion } = catalogs
  const revision = map?.revision ?? companion?.revision ?? 'unavailable'
  const session = useMemo(() => createCompanionSession({ onFailure: reportFailure, revision, storage: () => localStorage, locks: () => navigator.locks, mapCatalog: map ?? undefined, companionCatalog: companion ?? undefined, mapMilestoneIds: map?.milestones.map((item) => item.id), companionItemIds: companion?.entities.filter((entity) => entity.system === 'craft' || entity.system === 'village').map((entity) => entity.id) }), [revision, map, companion])
  const state = useSyncExternalStore(session.subscribe, session.getState)
  useEffect(() => {
    reportingState({ revision, persistence: state.persistence, dirty: state.dirty, pending: state.pending, conflict: state.conflict?.kind, errorKind: state.errorKind })
    if (state.error) reportFailure(new Error(state.error), 'progress.persistence', { kind: state.errorKind, persistence: state.persistence })
  }, [revision, state.persistence, state.error, state.errorKind, state.dirty, state.pending, state.conflict?.kind])
  const workspace = useCompanionWorkspace()
  const [section, setSection] = useState<CompanionSection>(() => initialMapIntent || transferInbox.getKind?.() === 'transfer' ? 'ascension' : sectionAtPath(location.pathname, import.meta.env.BASE_URL) ?? 'overview')
  useEffect(() => { if (initialMapIntent || transferInbox.getKind?.() === 'transfer') { try { history.replaceState(history.state, '', sectionPath('ascension', import.meta.env.BASE_URL) + (location.hash === '#analytics=off' ? '#analytics=off' : '')) } catch { /* The incoming-link reader preserves its bounded cleanup error and keeps tracking off. */ } } }, [initialMapIntent, transferInbox])
  const [panel, setPanel] = useState<Panel>(null), [feedback, setFeedback] = useState('')
  const mapActions = useRef<MapActions | null>(null)
  const [mapAction, setMapAction] = useState<MapToolAction | null>(null)
  const [tracking, setTracking] = useState(getTrackingStatus)
  const [reloadAction, setReloadAction] = useState<ReloadAction | null>(null)
  const referenceGuard = useRef<() => boolean>(() => true)
  const [preview, setPreview] = useState<{ progress: CompanionProgress; version: number; kind: 'save' | 'backup' | 'reset' | 'correction' | 'saved-recovery' | 'local-recovery'; warnings: string[] } | null>(null)
  const [workspaceReview, setWorkspaceReview] = useState<CompanionWorkspaceReview | null>(null)
  const [workspaceRestore, setWorkspaceRestore] = useState<{ workspace: CompanionWorkspace; expected: CompanionWorkspace } | null>(null)
  const [busy, setBusy] = useState(false), [repairing, setRepairing] = useState(false), [repairLocked, setRepairLocked] = useState(false)
  const openedFrom = useRef<HTMLElement | null>(null)
  const request = useRef(0), [inspection, setInspection] = useState<{ ref: CompanionEntityRef; sequence: number } | null>(null)
  const repair = useRef<AbortController | null>(null), repairCommitted = useRef(false)
  const reference = useSyncExternalStore(subscribeUpgradeReference, getUpgradeReference, () => null)
  function cancelRepair(force = false) { if (repairCommitted.current && !force) return false; repair.current?.abort(); repair.current = null; repairCommitted.current = false; setRepairLocked(false); setRepairing(false); return true }
  const receiveTransfer = useEffectEvent(() => { cancelRepair(true); if (transferInbox.getKind?.() === 'transfer') navigate('ascension') })
  useEffect(() => { const stopTransfer = transferInbox.subscribe(receiveTransfer), stopReference = subscribeUpgradeReference(() => { cancelRepair(true) }); return () => { stopTransfer(); stopReference(); repair.current?.abort(); repair.current = null } }, [transferInbox])
  useEffect(() => { cancelRepair(true) }, [state.version, workspace.version])
  useEffect(() => { session.initialize(); const changed = (event: StorageEvent) => { if (event.key === null || [COMPANION_STORAGE_KEY, PROFILE_STORAGE_KEY].includes(event.key)) session.refreshExternal(); if (event.key === null || event.key === ANALYTICS_PREFERENCE_KEY) setTracking(getTrackingStatus()) }; window.addEventListener('storage', changed); return () => { window.removeEventListener('storage', changed); session.cancelPending() } }, [session])
  useEffect(() => { if (reference) navigate('ascension') }, [reference])
  const receiveNavigation = useEffectEvent(() => { cancelRepair(true); navigate(sectionAtPath(location.pathname, import.meta.env.BASE_URL) ?? 'overview') })
  useEffect(() => { window.addEventListener('popstate', receiveNavigation); return () => window.removeEventListener('popstate', receiveNavigation) }, [])
  useEffect(() => { setPreview(null); request.current++; setBusy(false) }, [state.externalVersion])
  useEffect(() => { document.title = `Idle Slayer Companion · ${section === 'overview' ? 'Overview' : section[0].toUpperCase() + section.slice(1)}` }, [section])
  useEffect(() => () => { request.current++; repair.current?.abort() }, [])
  useEffect(() => {
    if (section !== 'ascension' || !mapAction) return
    setMapAction(null)
    if (!mapActions.current?.[mapAction]()) setFeedback('Finish the current Ascension preview before opening another tool.')
  }, [section, mapAction])
  const entities = companion ? visibleCompanionEntities(companion, state.progress, map) : []
  const visibleMap = map ? visibility(map, state.profile) : null
  const previewBefore = preview?.kind === 'local-recovery' && state.conflict?.kind === 'valid' ? state.conflict.progress : state.progress
  const resetTree = map && preview?.kind === 'reset' ? planUltraAscension(map, state.profile) : null
  function navigate(next: CompanionSection, ref?: CompanionEntityRef) {
    reportingAction('navigation', { section: next })
    if (!cancelRepair()) return
    if (panel === 'import') trackEvent('game_import_cancelled')
    setPanel(null); setMapAction(null); setPreview(null); setWorkspaceReview(null); setWorkspaceRestore(null); setReloadAction(null); request.current++; setBusy(false); setSection(next)
    const path = sectionPath(next, import.meta.env.BASE_URL)
    if (location.pathname !== path) { try { history.pushState(null, '', path + (location.hash === '#analytics=off' ? '#analytics=off' : '')) } catch { /* Keep the current visit usable when browser history is unavailable. */ } }
    if (ref) setInspection((previous) => ({ ref, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  function openMapTool(action: MapToolAction) {
    if (!map || !cancelRepair()) return
    navigate('ascension')
    setMapAction(action)
  }
  function openInstallation() {
    if (panel || busy || preview || workspaceRestore || workspaceReview || reloadAction || repairing) {
      setFeedback('Finish or cancel the current dialog before opening Install & offline.')
      return
    }
    if (map) openMapTool('openInstall')
    else open('install')
  }
  function open(next: Panel) { if (next && !panel) openedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; if (!cancelRepair()) return; if (panel === 'import' && next !== 'import') trackEvent('game_import_cancelled'); if (next === 'import' && panel !== 'import') trackEvent('game_import_started'); if (next === 'settings') setTracking(getTrackingStatus()); window.dispatchEvent(new Event('companion-panel')); request.current++; setPreview(null); setWorkspaceReview(null); setWorkspaceRestore(null); setReloadAction(null); setFeedback(''); setBusy(false); setPanel(next) }
  function reviewIntentions() { open('backup'); setWorkspaceReview(workspace.review()) }
  function record(system: CompanionSystem, id: string, patch: CompanionRecord) {
    if (!entities.some((entity) => entity.system === system && entity.id === id)) return
    const current = session.getState()
    if (current.version !== state.version || current.pending) return
    const result = planCompanionObservation(map, current.progress, system, id, patch)
    if (!result.ok) { setFeedback(result.error); return }
    if (result.requiresPreview) {
      open('correction')
      setPreview({ progress: result.progress, version: current.version, kind: 'correction', warnings: [] })
    } else session.command(current.version, () => result.progress, 'companion_record')
  }
  function exportProgress() {
    reportingAction('progress.export.start')
    const result = exportCompanionBackup(session.getState().progress)
    if (!result.ok) { reportFailure(new Error(result.error.message), 'progress.export', { kind: result.error.kind }); setFeedback(result.error.message); return false }
    download(result.value, `idle-slayer-companion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`); setFeedback('Companion progress backup exported.'); return true
  }
  function exportChangedLegacy() {
    const current = session.getState(), saved = current.conflict
    if (current.version !== state.version || saved?.kind !== 'valid' || !saved.legacyChanged || saved.legacyText === null) { setFeedback('Saved progress changed. Review recovery again before exporting.'); return }
    const parsed = parseProfileBackup(saved.legacyText, revision)
    if (!parsed.ok) { setFeedback('The changed legacy map copy could not be safely read. Its saved bytes were kept.'); return }
    const result = exportProfileBackup(parsed.profile)
    if (!result.ok) { setFeedback(result.error.message); return }
    download(result.text, 'idle-slayer-changed-legacy-map.json'); setFeedback('Changed legacy map copy exported. Companion progress was not changed.')
  }
  async function finishReload(action: ReloadAction) {
    if (!referenceGuard.current()) { setFeedback('Checkpoints or saved comparison need recovery. Review them in Ascension before reloading.'); return }
    session.cancelPending()
    if (action.kind === 'repair') {
      if (repair.current) return
      const controller = new AbortController(), progress = session.getState().progress, intentions = workspace.getState().workspace, url = location.href
      repair.current = controller; repairCommitted.current = false; setRepairing(true)
      const canContinue = () => repair.current === controller && location.href === url && session.getState().progress === progress && workspace.getState().workspace === intentions && referenceGuard.current()
      const accepted = await repairOffline(controller.signal, () => { if (!canContinue()) controller.abort(); else { repairCommitted.current = true; setRepairLocked(true) } }, canContinue)
      if (!accepted && repair.current === controller) { cancelRepair(true); setFeedback('Repair did not reload the app. Keep this visit, review the offline status, and retry when ready.') }
      return
    }
    if (action.kind === 'tracking') { const result = setTrackingPreference(action.enabled); reloadWithURL(result.reloadURL); return }
    location.reload()
  }
  async function requestReload(action: ReloadAction) {
    if (repairCommitted.current) return
    open('settings')
    const ticket = request.current, progress = session.getState().progress, intentions = workspace.getState().workspace
    if (!referenceGuard.current()) { setFeedback('Checkpoints or saved comparison need recovery. Review them in Ascension before reloading.'); return }
    if (session.getState().pending || workspace.getState().pending) { setReloadAction(action); return }
    const saved = !session.getState().dirty || await session.save()
    const intentionsSaved = !workspace.getState().dirty || await workspace.save()
    if (ticket !== request.current) return
    if (session.getState().progress !== progress || workspace.getState().workspace !== intentions) { setFeedback('Progress or intentions changed. Review them and try again.'); return }
    if (saved && intentionsSaved) { setReloadAction(action); void finishReload(action) }
    else setReloadAction(action)
  }
  async function readIntentions(file: File) {
    const ticket = ++request.current, expected = workspace.getState().workspace
    setBusy(true); setWorkspaceRestore(null); setWorkspaceReview(null); setPreview(null); setFeedback('')
    try {
      if (file.size > 65_536) { setFeedback('The intentions file exceeds its size limit.'); return }
      const candidate = parseCompanionWorkspace(await file.text())
      if (ticket !== request.current) return
      if (expected !== workspace.getState().workspace) { setFeedback('Intentions changed while reading the file. Choose it again for a fresh preview.'); return }
      setWorkspaceRestore({ workspace: candidate, expected })
    } catch { if (ticket === request.current) setFeedback('The intentions file could not be restored. Existing intentions were kept.') }
    finally { if (ticket === request.current) setBusy(false) }
  }
  async function readFile(file: File, kind: 'save' | 'backup') {
    reportingAction('progress.import.start', { kind, bytes: file.size })
    const ticket = ++request.current, version = session.getState().version
    setBusy(true); setPreview(null); setWorkspaceRestore(null); setWorkspaceReview(null); setFeedback('')
    try {
      if (file.size > (kind === 'save' ? MAX_GAME_SAVE_BYTES : MAX_COMPANION_BYTES)) throw new Error('size')
      const result = kind === 'save'
        ? map && companion ? importCompanionGameSave(map, companion, session.getState().progress, new Uint8Array(await file.arrayBuffer())) : { ok: false as const, error: 'Both reviewed catalogs are required to import a game save.' }
        : parseCompanionBackup(await file.text(), revision)
      if (ticket !== request.current || version !== session.getState().version) { if (ticket === request.current) setFeedback('Progress changed while reading the file. Choose it again for a fresh preview.'); return }
      if (!result.ok) { const message = typeof result.error === 'string' ? result.error : result.error.message; reportFailure(new Error(message), 'progress.import.validation', { kind, bytes: file.size }); setFeedback(message); if (kind === 'save') trackEvent('game_import_error', { reason: 'validation' }); return }
      const candidate = 'progress' in result ? result.progress : result.value
      candidate.ascension.showSpoilers = session.getState().profile.showSpoilers
      setPreview({ progress: candidate, version, kind, warnings: 'warnings' in result ? result.warnings : [] })
      if (kind === 'save') trackEvent('game_import_previewed')
    } catch (error) { reportFailure(error, 'progress.import', { kind, bytes: file.size }); if (ticket === request.current) { setFeedback(file.size > MAX_GAME_SAVE_BYTES ? 'This file exceeds the 4 MiB import limit. Progress was kept.' : 'This file could not be read. Progress was kept.'); if (kind === 'save') trackEvent('game_import_error', { reason: file.size > MAX_GAME_SAVE_BYTES ? 'size' : 'read' }) } }
    finally { if (ticket === request.current) setBusy(false) }
  }
  function startReset() {
    open('reset')
    if (!map || !companion) { setFeedback('Reviewed catalogs are required to preview an Ultra Ascension.'); return }
    const result = planCompanionUltraAscension(map, companion, session.getState().progress)
    if (!result.ok) { setFeedback(result.error); return }
    setPreview({ progress: result.progress, version: state.version, kind: 'reset', warnings: result.warnings })
  }
  async function applyPreview() {
    if (!preview || session.getState().version !== preview.version) { setPreview(null); setFeedback('Progress changed. Create a fresh preview.'); return }
    const applied = preview.kind === 'saved-recovery' ? session.useSaved(preview.version) : preview.kind === 'local-recovery' ? await session.save(true, preview.version) : session.applyCompanion(preview.progress, preview.kind !== 'correction', preview.kind === 'reset' ? 'companion_reset' : preview.kind === 'correction' ? 'companion_record' : preview.kind === 'save' ? 'companion_import' : 'companion_restore')
    if (applied) { const savedOnly = preview.kind === 'local-recovery'; if (preview.kind === 'save') trackEvent('game_import_applied'); setPreview(null); setPanel(null); setFeedback(savedOnly ? 'Saved progress replaced with this visit. The overwritten saved copy is not retained by Undo.' : 'Progress updated. Undo is available for this visit.') }
  }
  const mapGoalCache = useRef(new WeakMap<CompanionWorkspace, Goals>())
  function projectMapGoals(value: CompanionWorkspace): Goals {
    const cached = mapGoalCache.current.get(value)
    if (cached) return cached
    const goals: Goals = { version: 1, targets: value.goals.filter((goal) => goal.ref.system === 'ascension' && ['acquire', 'activate', 'rebuild'].includes(goal.mode)).map((goal) => ({ id: goal.ref.id, mode: goal.mode as 'acquire' | 'activate' | 'rebuild' })) }
    mapGoalCache.current.set(value, goals); return goals
  }
  const mapGoals = projectMapGoals(workspace.workspace)
  const goalController: GoalsController = { goals: mapGoals, error: workspace.error, raw: workspace.raw, dirty: workspace.dirty, readable: workspace.readable,
    edit: (goals, expected, replace) => { if (replace) { reviewIntentions(); return false }; const live = workspace.getState(); return expected === projectMapGoals(live.workspace) && workspace.edit({ ...live.workspace, goals: [...live.workspace.goals.filter((goal) => goal.ref.system !== 'ascension'), ...goals.targets.map((goal) => ({ ref: { system: 'ascension' as const, id: goal.id }, mode: goal.mode }))] }, live.workspace) }, useSaved: reviewIntentions, reviewRecovery: reviewIntentions,
    getState: () => { const live = workspace.getState(); return { goals: projectMapGoals(live.workspace), error: live.error, raw: live.raw, dirty: live.dirty, readable: live.readable } } }
  function workspaceSummary(value: CompanionWorkspace) {
    const titles = (ref: CompanionEntityRef) => ref.system === 'ascension' ? references.find((entry) => entry.ref.id === ref.id)?.title : entities.find((entity) => entityKey(entity) === entityKey(ref))?.title
    return <><h4>Visible goals</h4><ul>{value.goals.flatMap((goal) => { const title = titles(goal.ref); return title ? [<li key={entityKey(goal.ref)}>{title} · {goal.mode}</li>] : [] })}</ul><h4>Visible recipe plans</h4><ul>{Object.entries(value.recipePlans).flatMap(([id, quantity]) => { const title = titles({ system: 'craft', id }); return title ? [<li key={id}>{title} × {quantity}</li>] : [] })}</ul></>
  }
  const pinnedRefs = new Set(workspace.workspace.goals.map((goal) => entityKey(goal.ref)))
  const references = (visibleMap?.upgrades ?? []).map((upgrade) => ({ ref: { system: 'ascension' as const, id: upgrade.id }, title: upgrade.title, description: upgrade.description, status: state.profile.purchases[upgrade.id] ? state.profile.purchases[upgrade.id].active ? 'Owned' : 'Awaiting activation' : 'Not recorded' }))
  const goalEntries = workspace.workspace.goals.flatMap((goal) => {
    const item = goal.ref.system === 'ascension' ? references.find((entry) => entry.ref.id === goal.ref.id) : entities.find((entity) => entityKey(entity) === entityKey(goal.ref))
    if (!item) return []
    return [{ ref: goal.ref, title: item.title, description: item.description, status: goal.ref.system === 'ascension' ? references.find((entry) => entry.ref.id === goal.ref.id)?.status : companionEntityState(item as typeof entities[number], state.progress) }]
  })
  const entityStates = Object.fromEntries(entities.map((entity) => { const mastery = deriveBestiaryMastery(entity, state.progress); return [entityKey(entity), { available: entity.purchase ? companionRequirementState(entity.purchase, state.progress, map) : undefined, active: entity.system === 'divinity' && map ? deriveCompanionDivinityActive(state.progress, map, entity.id) : undefined, masteryTier: mastery?.tier, masteryKills: mastery?.kills }] }))
  const progressStatus = {
    loading: 'Checking saved progress on this device…',
    new: 'No profile saved on this device yet.',
    saved: 'Current progress is saved on this device.',
    saving: 'Saving current progress on this device…',
    unsaved: 'Current progress is not saved on this device.',
    failed: 'Current progress is not saved on this device. Export a backup or retry recovery.',
    conflict: 'Progress conflict. Current session is not saved on this device.',
  }[state.persistence]
  const status = <>
    <span className="progress-save-status">{progressStatus}</span>
    {state.error && <>{section !== 'ascension' && <p role="status">{state.error}</p>}<button onClick={() => open('backup')}>Review recovery</button></>}
    {workspace.error ? section === 'ascension'
      ? <div role="status"><span>Intentions could not be saved.</span> <button onClick={reviewIntentions}>Review saved intentions</button></div>
      : <div role="status"><p>{workspace.error}</p><button onClick={() => download(JSON.stringify(workspace.workspace, null, 2), 'companion-intentions.json')}>Export intentions</button><button onClick={reviewIntentions}>Review saved intentions</button><button onClick={() => { void workspace.save() }}>Retry saving intentions</button></div>
      : workspace.pending ? <span>Saving intentions…</span> : workspace.dirty ? <span>Intentions need saving.</span> : null}
    <SessionHistoryControls undoAction={state.history.at(-1)?.action} redoAction={state.redoHistory.at(-1)?.action} busy={state.pending} onUndo={() => mapActions.current ? mapActions.current.undo() : session.undo()} onRedo={() => mapActions.current ? mapActions.current.redo() : session.redo()} />
  </>

  return <CompanionProfileContext.Provider value={session}><CompanionMapGoalsContext.Provider value={goalController}>
    <CompanionShell section={section} onNavigate={navigate} onImport={() => open('import')} onBackup={() => open('backup')} onSettings={() => open('settings')} onHelp={() => open('help')} onInstall={openInstallation} status={status} notice={<MigrationGuide />}
      ascension={map ? <MapApp embedded onActions={(actions) => { mapActions.current = actions }} catalog={map} transferInbox={transferInbox} active={section === 'ascension'} requestedUpgrade={inspection?.ref.system === 'ascension' ? { id: inspection.ref.id, sequence: inspection.sequence } : undefined} onCompanionImport={() => open('import')} onCompanionReset={startReset} onCompanionExport={exportProgress} onCompanionRecovery={() => open('backup')} onCompanionTrackingChange={(enabled) => { void requestReload({ kind: 'tracking', enabled }) }} onReferenceGuard={(guard) => { referenceGuard.current = guard }} /> : <div className="loading"><h2>Ascension catalog unavailable</h2><p>The reviewed tree could not be loaded. Other companion sections remain available.</p><button onClick={() => { void requestReload({ kind: 'catalog' }) }}>Retry catalog</button></div>}>
      {!companion ? <section className="loading"><h2>Companion data unavailable</h2><p>The reviewed companion catalog could not be loaded. Stored progress and Ascension remain available.</p><button onClick={() => { void requestReload({ kind: 'catalog' }) }}>Retry catalogs</button></section> : <>
        <div className="companion-page-controls telemetry-private rr-block"><label className="spoiler-control"><input type="checkbox" checked={state.profile.showSpoilers} disabled={state.pending} onChange={(event) => session.applyProfile({ ...state.profile, showSpoilers: event.target.checked }, false, 'spoilers')} />Show spoilers</label><button onClick={startReset}>Record Ultra Ascension…</button></div>
        <CompanionModules busy={state.pending} section={section === 'ascension' ? 'overview' : section} entities={entities} progress={state.progress} onRecord={record} onTrack={(system, tracked) => session.command(state.version, (progress) => ({ ...progress, modules: { ...progress.modules, [system]: { ...progress.modules[system], tracked } } }), 'companion_record')} pinnedRefs={pinnedRefs} onPinGoal={(ref) => { const goals = workspace.workspace.goals; workspace.edit({ ...workspace.workspace, goals: pinnedRefs.has(entityKey(ref)) ? goals.filter((goal) => entityKey(goal.ref) !== entityKey(ref)) : [...goals, { ref, mode: ref.system === 'ascension' ? 'acquire' : ref.system === 'divinity' ? 'select' : ref.system === 'enemy' ? 'mastery' : 'complete' }] }) }} onNavigate={navigate} recipePlans={workspace.workspace.recipePlans} onRecipePlan={(id, quantity) => { const recipePlans = { ...workspace.workspace.recipePlans }; if (!quantity || quantity === '0') delete recipePlans[id]; else recipePlans[id] = quantity; workspace.edit({ ...workspace.workspace, recipePlans }) }} referenceEntries={references} goalEntries={goalEntries} entityStates={entityStates} focusedRef={inspection?.ref} />
      </>}
      {feedback && !panel && <p role="status" className="telemetry-private rr-block">{feedback}</p>}
    </CompanionShell>
    {panel && <Dialog key={panel} dismissDisabled={repairLocked} returnFocus={() => openedFrom.current?.isConnected && openedFrom.current !== document.body ? openedFrom.current : document.querySelector<HTMLButtonElement>('.companion-import')} title={panel === 'import' ? 'Import game save' : panel === 'backup' ? 'Backup & transfer' : panel === 'settings' ? 'Privacy & tracking' : panel === 'install' ? 'Install & offline' : panel === 'reset' ? 'Review companion Ultra Ascension' : panel === 'correction' ? 'Review shared item correction' : 'About & sources'} close={() => open(null)}><div className="companion-operation telemetry-private rr-block">
      {feedback && <p role="status">{feedback}</p>}
      {panel === 'import' && <div className="companion-import-form">
        <p>Select a reviewed Windows Steam save. Files are read locally and never uploaded. Import replaces supported tracked progress together; intentions and tracking preferences are kept.</p>
        <section className="companion-dialog-section" aria-labelledby="save-location-heading">
          <h3 id="save-location-heading">Find your Windows save</h3>
          <p>Close Idle Slayer first. Paste this folder into the file picker or File Explorer:</p>
          <code className="companion-save-location">{'%USERPROFILE%\\AppData\\LocalLow\\Pablo Leban\\Idle Slayer\\'}</code>
          <p>Choose <code>savedata.sav</code> or <code>backup.sav</code>. The app reads only the file you select.</p>
        </section>
        <label className="companion-file-field"><span>Choose game save</span><input type="file" accept=".sav" aria-describedby="save-compatibility" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file, 'save') }} /></label>
        <small id="save-compatibility">7.3.4: full companion snapshot. Legacy 7.2.0: Ascension progress only.</small>
      </div>}
      {panel === 'backup' && <div className="companion-backup-form">
        {workspace.error && <p role="status">{workspace.error}</p>}
        <section className="companion-dialog-section" aria-labelledby="companion-progress-heading">
          <h3 id="companion-progress-heading">Companion progress</h3>
          <p>Companion JSON includes actual tracked progress across every supported system. Intentions, Ascension checkpoints, saved comparisons, layout, and tracking preferences are separate.</p>
          <div className="companion-dialog-actions"><button onClick={exportProgress}>Export Companion progress</button></div>
          <label className="companion-file-field"><span>Restore Companion progress</span><input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file, 'backup') }} /></label>
        </section>
        <section className="companion-dialog-section" aria-labelledby="intentions-heading">
          <h3 id="intentions-heading">Intentions and plans</h3>
          <p>Goals and crafting quantities have their own backup. Restoring them does not change recorded progress.</p>
          <div className="companion-dialog-actions"><button onClick={() => download(JSON.stringify(workspace.workspace, null, 2), 'companion-intentions.json')}>Export intentions</button></div>
          <label className="companion-file-field"><span>Restore intentions</span><input type="file" accept=".json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readIntentions(file) }} /></label>
        </section>
        <section className="companion-dialog-section" aria-labelledby="ascension-data-heading">
          <h3 id="ascension-data-heading">Ascension data tools</h3>
          <p>Legacy map JSON, map/layout QR transfer, checkpoints, and comparison backups remain in Ascension → Progress or Map options.</p>
          <div className="companion-dialog-actions"><button disabled={!map} onClick={() => openMapTool('openProgress')}>Open Ascension data tools</button></div>
        </section>
        {state.error && <section className="companion-dialog-section" aria-labelledby="progress-recovery-heading">
          <h3 id="progress-recovery-heading">Progress recovery</h3><p>{state.error}</p>
          <div className="companion-dialog-actions"><button onClick={() => { session.retry() }}>Retry recovery</button></div>
          {state.conflict?.kind === 'valid' && state.conflict.legacyChanged && <><p>The older map tab’s changes are not included in this Companion snapshot. Export that map copy to keep it before acknowledging the conflict.</p><div className="companion-dialog-actions"><button onClick={exportChangedLegacy}>Export changed legacy map copy</button></div></>}
          <div className="companion-dialog-actions">
            {state.conflict?.kind === 'valid' && <button onClick={() => { const saved = session.getState().conflict; if (saved?.kind !== 'valid' || session.getState().version !== state.version) return; const result = exportCompanionBackup(saved.progress); if (result.ok) { download(result.value, 'companion-checked-saved-progress.json'); setFeedback('Checked saved progress backup exported.') } else setFeedback(result.error.message) }}>Export checked saved progress</button>}
            {state.conflict?.kind === 'valid' && <button onClick={() => { const version = state.version; const saved = session.getState().conflict; if (saved?.kind === 'valid') setPreview({ progress: saved.progress, version, kind: 'saved-recovery', warnings: ['Use this checked saved Companion snapshot instead of this visit. Export this visit first to keep both.'] }) }}>Use checked saved progress</button>}
            {state.conflict && state.conflict.kind !== 'unavailable' && <button onClick={() => { const version = state.version; setPreview({ progress: session.getState().progress, version, kind: 'local-recovery', warnings: ['Replace the checked saved document with this visit. Export before applying to keep another recovery copy.'] }) }}>Replace checked saved progress</button>}
          </div>
        </section>}
      </div>}
      {panel === 'settings' && <><PrivacyPanel status={tracking} progressStatus={progressStatus} onChange={(enabled) => { void requestReload({ kind: 'tracking', enabled }) }} additionalActions={<button disabled={!map} onClick={() => openMapTool('openReferences')}>Review Ascension references</button>} />{reloadAction !== null && <section aria-label="Reload with unsaved progress"><h3>Save a copy before reloading?</h3><p>Export Companion progress and intentions before reloading to keep this visit. Checkpoints and saved comparison have their own recovery.</p><div className="dialog-actions"><button disabled={repairing} onClick={() => { if (exportProgress()) { download(JSON.stringify(workspace.getState().workspace, null, 2), 'companion-intentions.json'); void finishReload(reloadAction) } }}>Export backups and reload</button><button disabled={repairing} className="danger" onClick={() => void finishReload(reloadAction)}>Reload without backup</button><button disabled={repairCommitted.current} onClick={() => { cancelRepair(); setReloadAction(null) }}>Cancel reload</button></div></section>}</>}
      {panel === 'correction' && <p>Removing a shared item also reviews Ascension purchases that require it. Valid alternate paths and retained ownership are preserved. Materials, rewards, and intentions are kept.</p>}
      {panel === 'help' && <><p>Idle Slayer Companion tracks Ascension upgrades, achievements, crafting, quests, enemies, and Divinities. Record progress manually or import a selected save.</p><p>This is an unofficial utility. Game assets belong to their respective rights holders. Application code and asset attribution are documented separately.</p><p>Game data: {map?.gameVersion ?? companion?.gameVersion ?? 'unavailable'} · Steam build {map?.steamBuild ?? companion?.steamBuild ?? 'unavailable'}. Data and icons are bundled locally. The game remains authoritative.<small>Catalog {revision}</small></p><p className="progress-save-status">{progressStatus}</p><div className="companion-dialog-actions"><button disabled={!map} onClick={() => openMapTool('openHelp')}>Map help…</button></div><ul className="source-links"><li><a href="https://idleslayer.com/" target="_blank" rel="noreferrer">Official game</a></li><li><a href="https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion" target="_blank" rel="noreferrer" onClick={() => trackEvent('source_link_opened', { source: 'about', action: 'github' })}>Source and extraction documentation</a></li><li><a href={`${import.meta.env.BASE_URL}licenses/index.html`} target="_blank" rel="noreferrer" onClick={() => trackEvent('source_link_opened', { source: 'about', action: 'license' })}>Bundled software licenses</a></li></ul></>}
      {panel === 'install' && <InstallPanel onRepair={() => { void requestReload({ kind: 'repair' }) }} progressStatus={progressStatus} repairBusy={repairing} />}
      {busy && <p role="status">Reading and validating locally…</p>}
      {workspaceRestore && <section aria-label="Review intentions restore"><h3>Replace goals and crafting plans?</h3><p>This replaces intentions only. Actual progress, checkpoints, comparison, and Undo remain separate.</p>{workspaceSummary(workspaceRestore.workspace)}<div className="companion-dialog-actions"><button onClick={() => { if (workspace.edit(workspaceRestore.workspace, workspaceRestore.expected)) setWorkspaceRestore(null) }}>Replace intentions</button><button onClick={() => setWorkspaceRestore(null)}>Cancel intentions restore</button></div></section>}
      {workspaceReview && <section aria-label="Review intentions recovery"><h3>Recover saved intentions</h3><p>Export this visit first to keep both. Unknown or unrevealed references are preserved without listing their identities.</p>{workspaceReview.snapshot.kind === 'valid' ? <>{workspaceSummary(workspaceReview.snapshot.workspace)}<button onClick={() => { if (workspace.useSaved(workspaceReview)) setWorkspaceReview(null) }}>Use checked saved intentions</button></> : <p>{workspaceReview.snapshot.error}</p>}{workspaceReview.snapshot.kind !== 'unavailable' && <button onClick={() => { void workspace.replaceSaved(workspaceReview).then((saved) => { if (saved) setWorkspaceReview(null) }) }}>Replace checked saved intentions with this visit</button>}<button onClick={() => setWorkspaceReview(null)}>Cancel intentions recovery</button></section>}
      {preview && <section aria-label="Review progress replacement"><h3>{preview.kind === 'reset' ? 'Apply this Ultra Ascension?' : preview.kind === 'correction' ? 'Apply this correction?' : 'Apply this snapshot?'}</h3><p>{preview.kind === 'local-recovery' ? 'This replaces the checked saved copy with this visit. Undo does not recover overwritten saved bytes; export both copies before applying to keep them.' : 'One operation with Undo for this visit.'} Lists show only your current visible entries; this operation never enables spoilers.</p>{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}{resetTree && map && <section aria-label="Ascension reset effects">{[{ label: 'Repeat purchases cleared', ids: resetTree.cleared }, { label: 'Astral locks activated', ids: resetTree.activated }, { label: 'Conditionally retained purchases', ids: resetTree.conditionallyRetained }].map((group) => { const nodes = map.upgrades.filter((node) => group.ids.includes(node.id) && visibleMap?.ids.has(node.id)); return <section key={group.label}><h3>{group.label} ({nodes.length})</h3><ul className="upgrade-changes">{nodes.map((node) => <li key={node.id} data-upgrade-id={node.id}>{node.title} · <SPCost value={node.cost} /><small>ID: {node.id}</small></li>)}</ul></section> })}</section>}<ul>{entities.filter((entity) => JSON.stringify(getCompanionRecord(previewBefore, entity.system, entity.id)) !== JSON.stringify(getCompanionRecord(preview.progress, entity.system, entity.id))).map((entity) => <li key={entityKey(entity)}><b>{entity.title}</b><small>{observationText(getCompanionRecord(previewBefore, entity.system, entity.id))} → {observationText(getCompanionRecord(preview.progress, entity.system, entity.id))}</small></li>)}</ul><>{map && <ProgressComparison catalog={map} current={previewBefore.ascension} incoming={preview.progress.ascension} viewer={state.profile} undoAvailable={preview.kind !== 'local-recovery'} currentLabel={preview.kind === 'local-recovery' ? 'Checked saved snapshot' : 'Current session'} context="Ascension changes within this Companion operation." />}</><p>Recorded Ultra Ascensions: {previewBefore.ascension.epoch} → {preview.progress.ascension.epoch}</p><div className="companion-dialog-actions"><button className="primary" disabled={state.pending || preview.version !== state.version} onClick={applyPreview}>{preview.kind === 'reset' ? 'Record companion Ultra Ascension' : preview.kind === 'correction' ? 'Apply correction' : 'Apply snapshot'}</button><button onClick={() => setPreview(null)}>Cancel preview</button></div>{preview.version !== state.version && <p role="status">Progress changed. Choose the file or action again.</p>}</section>}
    </div></Dialog>}
  </CompanionMapGoalsContext.Provider></CompanionProfileContext.Provider>
}
