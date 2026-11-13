import { emptyCompanionProgress, normalizeSharedCompanionItems, replaceAscensionProfile } from './companion-progress'
import { COMPANION_STORAGE_KEY, exportCompanionBackup, exportCompanionStored, parseCompanionStored } from './companion-storage'
import type { CompanionCatalog, CompanionProgress } from './companion-types'
import type { HistoryAction } from './profile-history'
import { PROFILE_WRITE_LOCK, type ProfileLocks, type ProfileSessionState } from './profile-session'
import { parseProfileBackup, PROFILE_STORAGE_KEY, type ProfileErrorKind } from './storage'
import type { Catalog, Profile } from './types'
import { planCompanionUltraAscension } from './companion-reset'
import { certifyCompanionReset, copyCompanionResetProof } from './companion-reset-proof'

type Baseline = { companionText: string | null; legacyText: string | null }
export type CompanionStoredSnapshot =
  | (Baseline & { kind: 'valid'; text: string | null; profile: Profile; progress: CompanionProgress; legacyChanged: boolean })
  | (Baseline & { kind: 'invalid'; text: string; error: string; errorKind: ProfileErrorKind })
  | { kind: 'unavailable'; error: string; errorKind: 'storage-read' }
export interface CompanionHistoryEntry { progress: CompanionProgress; profile: Profile; action: HistoryAction }
export interface CompanionSessionState extends Omit<ProfileSessionState, 'history' | 'redoHistory' | 'conflict'> {
  progress: CompanionProgress
  history: CompanionHistoryEntry[]
  redoHistory: CompanionHistoryEntry[]
  conflict: CompanionStoredSnapshot | null
}
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>
const sameBaseline = (first: Baseline, second: Baseline) => first.companionText === second.companionText && first.legacyText === second.legacyText

/** One coordinated envelope, one bounded history, and a read-only legacy migration boundary. */
export function createCompanionSession(options: { onFailure?: (error: unknown, operation: string) => void; revision: string; storage: () => StorageAccess; locks: () => ProfileLocks | undefined; mapMilestoneIds?: readonly string[]; companionItemIds?: readonly string[]; mapCatalog?: Catalog; companionCatalog?: CompanionCatalog }) {
  let baseline: Baseline | undefined
  let persisted: CompanionProgress | undefined
  let initialized = false, adoptedCompanion = false, operation = 0
  const initial = emptyCompanionProgress(options.revision)
  const projected = new WeakMap<Profile, Profile>()
  const companionItems = new Set(options.companionItemIds ?? [])
  const mapItems = new Set(options.mapMilestoneIds ?? [])
  function project(profile: Profile): Profile {
    const cached = projected.get(profile)
    if (cached) return cached
    const milestones = Object.fromEntries(Object.entries(profile.milestones).filter(([id]) => !companionItems.has(id) || mapItems.has(id)))
    const result = Object.keys(milestones).length === Object.keys(profile.milestones).length ? profile : { ...profile, milestones }
    projected.set(profile, result)
    return result
  }
  const failure = (cause: unknown, operation: string) => { try { options.onFailure?.(cause, operation) } catch { /* Diagnostics cannot change persistence. */ } }
  let state: CompanionSessionState = { progress: initial, profile: initial.ascension, history: [], redoHistory: [], version: 0, externalVersion: 0, pending: false, dirty: false, persistence: 'loading', writable: false, error: '', conflict: null }
  const listeners = new Set<(state: CompanionSessionState) => void>()
  function emit() {
    const saved = baseline && (baseline.companionText !== null || (!adoptedCompanion && baseline.legacyText !== null))
    const persistence = !initialized ? 'loading' : state.conflict ? 'conflict' : state.pending ? 'saving'
      : state.progress === persisted ? saved ? 'saved' : 'new' : state.error ? 'failed' : 'unsaved'
    state = { ...state, profile: project(state.progress.ascension), dirty: state.progress !== persisted || state.conflict !== null || state.pending, persistence }
    listeners.forEach((listener) => listener(state))
  }
  function error(message: string, errorKind: CompanionSessionState['errorKind']) { state = { ...state, error: message, errorKind }; emit() }
  function read(): CompanionStoredSnapshot {
    let pair: Baseline
    try { const storage = options.storage(); pair = { companionText: storage.getItem(COMPANION_STORAGE_KEY), legacyText: storage.getItem(PROFILE_STORAGE_KEY) } } catch (cause) { failure(cause, 'storage.read')
      return { kind: 'unavailable', error: 'Saved Companion progress could not be read. Current progress remains available in this session.', errorKind: 'storage-read' }
    }
    if (pair.companionText !== null) {
      adoptedCompanion = true
      const parsed = parseCompanionStored(pair.companionText, options.revision)
      return parsed.ok
        ? { ...pair, kind: 'valid', text: pair.companionText, progress: parsed.value.progress, profile: project(parsed.value.progress.ascension), legacyChanged: parsed.value.legacyBaseline !== pair.legacyText }
        : { ...pair, kind: 'invalid', text: pair.companionText, error: parsed.error.message, errorKind: parsed.error.kind }
    }
    const progress = emptyCompanionProgress(options.revision)
    // Once adopted, removing the companion key must not resurrect an older map profile.
    if (!adoptedCompanion && pair.legacyText !== null) {
      const parsed = parseProfileBackup(pair.legacyText, options.revision)
      if (!parsed.ok) return { ...pair, kind: 'invalid', text: pair.legacyText, error: parsed.error.message, errorKind: parsed.error.kind }
      progress.ascension = parsed.profile
    }
    return { ...pair, kind: 'valid', text: pair.legacyText, progress, profile: project(progress.ascension), legacyChanged: false }
  }
  function initialize() {
    if (initialized) return
    const snapshot = read()
    initialized = true
    baseline = snapshot.kind === 'unavailable' ? undefined : snapshot
    if (snapshot.kind === 'valid') {
      persisted = snapshot.progress
      state = { ...state, progress: snapshot.progress, history: [], redoHistory: [], writable: true, version: state.version + 1, error: '', errorKind: undefined }
      if (snapshot.legacyChanged) state = { ...state, conflict: snapshot, writable: false, error: 'An older map tab changed saved map progress. Companion progress was kept. Review recovery before saving.', errorKind: 'stale' }
    } else state = { ...state, error: snapshot.error, errorKind: snapshot.errorKind, writable: false }
    emit()
  }
  function observe(snapshot: CompanionStoredSnapshot): boolean {
    if (snapshot.kind !== 'unavailable' && baseline && sameBaseline(snapshot, baseline) && !state.conflict) return false
    const olderWriter = snapshot.kind === 'valid' && baseline?.companionText !== null && baseline?.companionText !== undefined && snapshot.legacyText !== baseline.legacyText
    const preserve = state.dirty || state.pending || state.conflict !== null || snapshot.kind !== 'valid' || olderWriter || snapshot.legacyChanged
    operation++
    if (!preserve && snapshot.kind === 'valid') {
      baseline = snapshot; persisted = snapshot.progress
      state = { ...state, progress: snapshot.progress, history: [], redoHistory: [], conflict: null, pending: false, writable: true, error: '', errorKind: undefined }
    } else {
      state = { ...state, history: [], redoHistory: [], conflict: snapshot, pending: false,
        error: snapshot.kind === 'valid' ? olderWriter
          ? 'An older map tab changed saved map progress. This Companion session was kept. Review recovery before saving.'
          : 'Saved Companion progress changed in another tab. This session was kept. Review recovery before saving.'
          : `${snapshot.error} This session was kept; review recovery before replacing saved data.`,
        errorKind: snapshot.kind === 'valid' ? 'stale' : snapshot.errorKind }
    }
    state = { ...state, version: state.version + 1, externalVersion: state.externalVersion + 1 }
    emit(); return true
  }
  function refreshExternal() { return observe(read()) }
  function cancelPending() {
    if (!state.pending) return
    operation++; state = { ...state, pending: false, version: state.version + 1 }
    error('Saving was cancelled. Current Companion progress remains available in this session; export a backup to keep it.', 'unavailable')
  }
  async function save(replaceStorage = false, conflictVersion?: number): Promise<boolean> {
    if (!initialized || state.pending) return false
    const replacing = conflictVersion !== undefined
    if (replacing && (state.version !== conflictVersion || !state.conflict)) { error('Progress changed while reviewing recovery. Review the current conflict again.', 'stale'); return false }
    if (replacing && state.conflict?.kind === 'unavailable') { error('Saved progress must be readable before it can be deliberately replaced. Export this session or retry recovery.', 'storage-read'); return false }
    const expected = replacing && state.conflict?.kind !== 'unavailable' ? state.conflict ?? undefined : baseline
    if (!expected || (state.conflict && !replacing) || (!state.writable && !replaceStorage)) {
      error(state.conflict ? 'Review the Companion progress conflict or export this session before saving.' : 'Saved data could not be read. Changes stay in memory. Retry recovery or explicitly restore progress to replace saved data.', state.conflict ? 'stale' : 'storage-read'); return false
    }
    const backup = exportCompanionStored({ progress: state.progress, legacyBaseline: expected.legacyText })
    if (!backup.ok) { error(backup.error.message, backup.error.kind); return false }
    let locks: ProfileLocks | undefined
    try { locks = options.locks() } catch (cause) { failure(cause, 'storage.lock'); /* Safe in-memory progress remains available. */ }
    if (!locks) { error('Safe saving is unavailable in this browser. Current Companion progress remains available in this session; export a backup to keep it.', 'unavailable'); return false }
    const ticket = ++operation, version = state.version, progress = state.progress
    state = { ...state, pending: true }; emit()
    try {
      // Share the original lock so a cooperating legacy tab cannot race the first migration write.
      return await locks.request(PROFILE_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (ticket !== operation || version !== state.version) return false
        if (!lock) { error('Another tab is saving progress. Retry saving or export a Companion backup.', 'unavailable'); return false }
        const current = read()
        if (current.kind === 'unavailable' || !sameBaseline(current, expected)) { observe(current); return false }
        try { options.storage().setItem(COMPANION_STORAGE_KEY, backup.value) } catch (cause) { failure(cause, 'storage.write')
          error('Companion progress could not be saved on this device. Current progress remains available in this session; export a backup to keep it.', 'storage-write'); return false
        }
        adoptedCompanion = true
        baseline = { companionText: backup.value, legacyText: expected.legacyText }; persisted = progress
        state = { ...state, conflict: null, writable: true, error: '', errorKind: undefined }; emit(); return true
      })
    } catch (cause) { failure(cause, 'storage.lock-request')
      if (ticket === operation) error('Safe saving is unavailable in this browser. Current Companion progress remains available in this session; export a backup to keep it.', 'unavailable')
      return false
    } finally { if (ticket === operation) { state = { ...state, pending: false }; emit() } }
  }
  function entry(progress: CompanionProgress, action: HistoryAction): CompanionHistoryEntry { return { progress, profile: project(progress.ascension), action } }
  function applyCompanion(next: CompanionProgress, replaceStorage = false, action: HistoryAction = 'change'): boolean {
    if (!initialized || state.pending) { error('Progress is being saved. Try this change again when saving finishes.', 'unavailable'); return false }
    const checked = exportCompanionBackup(next)
    if (!checked.ok) { error(checked.error.message, checked.error.kind); return false }
    next = normalizeSharedCompanionItems(next)
    const previous = entry(state.progress, action)
    if (action === 'companion_reset' && options.mapCatalog && options.companionCatalog) {
      const plan = planCompanionUltraAscension(options.mapCatalog, options.companionCatalog, state.progress)
      if (plan.ok) {
        const expected = exportCompanionBackup(plan.progress), actual = exportCompanionBackup(next)
        if (expected.ok && actual.ok && expected.value === actual.value) certifyCompanionReset(previous, previous.profile, project(next.ascension), options.mapCatalog.revision)
      }
    }
    state = { ...state, progress: next, history: [...state.history.slice(-19), previous], redoHistory: [], version: state.version + 1 }
    emit(); void save(replaceStorage); return true
  }
  function applyProfile(next: Profile, replaceStorage = false, action: HistoryAction = 'change') { return applyCompanion(replaceAscensionProfile(state.progress, next, options.mapMilestoneIds), replaceStorage, action) }
  function command(version: number, reduce: (progress: CompanionProgress) => CompanionProgress | null, action: HistoryAction = 'change') {
    if (version !== state.version || state.pending) { error('Progress changed while reviewing this action. Review the current progress again.', 'stale'); return false }
    try { const next = reduce(structuredClone(state.progress)); return next !== null && applyCompanion(next, false, action) } catch { error('This progress change could not be validated. Nothing was replaced.', 'invalid-profile'); return false }
  }
  function undo() {
    if (state.pending || !state.history.length) return false
    const previous = state.history.at(-1)!
    const undone = entry(state.progress, previous.action)
    copyCompanionResetProof(previous, undone)
    state = { ...state, progress: previous.progress, history: state.history.slice(0, -1), redoHistory: [...state.redoHistory, undone], version: state.version + 1 }
    emit(); void save(); return true
  }
  function redo() {
    if (state.pending || !state.redoHistory.length) return false
    const next = state.redoHistory.at(-1)!
    const redone = entry(state.progress, next.action)
    copyCompanionResetProof(next, redone)
    state = { ...state, progress: next.progress, history: [...state.history, redone], redoHistory: state.redoHistory.slice(0, -1), version: state.version + 1 }
    emit(); void save(); return true
  }
  function useSaved(version: number): boolean {
    if (state.pending || version !== state.version || state.conflict?.kind !== 'valid') { error('Progress changed while reviewing recovery. Review the current conflict again.', 'stale'); return false }
    const current = read()
    if (current.kind !== 'valid' || !sameBaseline(current, state.conflict)) { observe(current); return false }
    baseline = current; persisted = current.legacyChanged ? undefined : current.progress
    state = { ...state, progress: current.progress, history: [entry(state.progress, 'recovery')], redoHistory: [], conflict: null, version: state.version + 1, error: '', errorKind: undefined, writable: true }
    emit()
    // Acknowledging an older writer changes the device wrapper, even when the
    // accepted Companion snapshot itself is unchanged. Persist that choice so
    // a reload does not resurrect the already reviewed legacy conflict.
    if (current.legacyChanged) void save()
    return true
  }
  function retry(): CompanionStoredSnapshot | null {
    if (state.conflict) return state.conflict
    const current = read()
    if (current.kind === 'unavailable') { error(current.error, current.errorKind); return null }
    if (!baseline || !sameBaseline(current, baseline)) { observe(current); return state.conflict }
    if (state.writable || (current.companionText === null && current.legacyText === null)) { void save(current.companionText === null && current.legacyText === null); return null }
    error(current.kind === 'invalid' ? current.error : 'Review recovered Companion progress before replacing this session.', current.kind === 'invalid' ? current.errorKind : 'stale'); return null
  }
  function subscribe(listener: (state: CompanionSessionState) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
  return { initialize, subscribe, getState: () => state, apply: applyProfile, applyProfile, applyCompanion, command, undo, redo, save, retry, refreshExternal, cancelPending, useSaved }
}
export type CompanionSession = ReturnType<typeof createCompanionSession>
