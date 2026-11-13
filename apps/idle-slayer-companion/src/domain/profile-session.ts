import { emptyProfile, type Profile } from './types'
import { exportProfileBackup, parseProfileBackup, PROFILE_STORAGE_KEY, type ProfileErrorKind } from './storage'
import type { HistoryAction } from './profile-history'

export const PROFILE_WRITE_LOCK = `${PROFILE_STORAGE_KEY}.write`
interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface ProfileLocks {
  request<T>(name: string, options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => T): Promise<T>
}
export type StoredSnapshot =
  | { kind: 'valid'; text: string | null; profile: Profile }
  | { kind: 'invalid'; text: string; error: string; errorKind: ProfileErrorKind }
  | { kind: 'unavailable'; error: string; errorKind: 'storage-read' }
export type ProfilePersistence = 'loading' | 'new' | 'saved' | 'saving' | 'unsaved' | 'failed' | 'conflict'
export interface ProfileHistoryEntry { profile: Profile; action: HistoryAction }
export interface ProfileSessionState {
  profile: Profile
  history: ProfileHistoryEntry[]
  redoHistory: ProfileHistoryEntry[]
  version: number
  externalVersion: number
  pending: boolean
  dirty: boolean
  persistence: ProfilePersistence
  writable: boolean
  error: string
  errorKind?: ProfileErrorKind | 'unavailable' | 'stale'
  conflict: StoredSnapshot | null
}

/** Supported device-persistence boundary: coordinates all profile reads and writes without changing portable v1. */
export function createProfileSession(options: { revision: string; storage: () => Storage; locks: () => ProfileLocks | undefined }) {
  let baseline: string | null | undefined
  let persisted: Profile | undefined
  let initialized = false
  let operation = 0
  let state: ProfileSessionState = { profile: emptyProfile(options.revision), history: [], redoHistory: [], version: 0, externalVersion: 0, pending: false, dirty: false, persistence: 'loading', writable: false, error: '', conflict: null }
  const listeners = new Set<(state: ProfileSessionState) => void>()
  function emit() {
    const persistence = !initialized ? 'loading' : state.conflict ? 'conflict' : state.pending ? 'saving'
      : state.profile === persisted ? baseline === null ? 'new' : 'saved' : state.error ? 'failed' : 'unsaved'
    state = { ...state, dirty: state.profile !== persisted || state.conflict !== null || state.pending, persistence }
    listeners.forEach((listener) => listener(state))
  }
  function error(message: string, kind: ProfileSessionState['errorKind']) { state = { ...state, error: message, errorKind: kind }; emit() }
  function read(): StoredSnapshot {
    let text: string | null
    try { text = options.storage().getItem(PROFILE_STORAGE_KEY) } catch {
      return { kind: 'unavailable', error: 'Saved progress could not be read. Current progress remains available in this session.', errorKind: 'storage-read' }
    }
    if (text === null) return { kind: 'valid', text, profile: emptyProfile(options.revision) }
    const result = parseProfileBackup(text, options.revision)
    return result.ok ? { kind: 'valid', text, profile: result.profile }
      : { kind: 'invalid', text, error: result.error.message, errorKind: result.error.kind }
  }
  function initialize() {
    const snapshot = read()
    initialized = true
    baseline = snapshot.kind === 'unavailable' ? undefined : snapshot.text
    if (snapshot.kind === 'valid') {
      persisted = snapshot.profile
      state = { ...state, profile: snapshot.profile, history: [], redoHistory: [], writable: true, error: '', errorKind: undefined, version: state.version + 1 }
    } else state = { ...state, error: snapshot.error, errorKind: snapshot.errorKind, writable: false }
    emit()
  }
  function observe(snapshot: StoredSnapshot): boolean {
    if (snapshot.kind !== 'unavailable' && snapshot.text === baseline && !state.conflict) return false
    const preserve = state.dirty || state.pending || state.conflict !== null || snapshot.kind !== 'valid'
    operation++ // Superseded callbacks must never write or clear this conflict later.
    if (!preserve && snapshot.kind === 'valid') {
      baseline = snapshot.text
      persisted = snapshot.profile
      state = { ...state, profile: snapshot.profile, history: [], redoHistory: [], conflict: null, pending: false, writable: true, error: '', errorKind: undefined }
    } else {
      state = { ...state, history: [], redoHistory: [], conflict: snapshot, pending: false, error: snapshot.kind === 'valid'
        ? 'Saved progress changed in another tab. This session was kept. Export it or review the conflict before saving.'
        : `${snapshot.error} This session was kept; review recovery before replacing saved data.`, errorKind: snapshot.kind === 'valid' ? 'stale' : snapshot.errorKind }
    }
    state = { ...state, version: state.version + 1, externalVersion: state.externalVersion + 1 }
    emit()
    return true
  }
  function refreshExternal() { return observe(read()) }
  function cancelPending() {
    if (!state.pending) return
    operation++
    state = { ...state, pending: false, version: state.version + 1 }
    error('Saving was cancelled. Current progress remains available in this session; export a backup to keep it.', 'unavailable')
  }
  async function save(replaceStorage = false, conflictVersion?: number): Promise<boolean> {
    if (state.pending) return false
    const replacingConflict = conflictVersion !== undefined
    if (replacingConflict && (state.version !== conflictVersion || !state.conflict)) { error('Progress changed while reviewing recovery. Review the current conflict again.', 'stale'); return false }
    if (replacingConflict && state.conflict?.kind === 'unavailable') { error('Saved progress must be readable before it can be deliberately replaced. Export this session or retry recovery.', 'storage-read'); return false }
    const expected = replacingConflict && state.conflict?.kind !== 'unavailable' ? state.conflict?.text : baseline
    if (expected === undefined || (state.conflict && !replacingConflict) || (!state.writable && !replaceStorage)) {
      error(state.conflict ? 'Review the progress conflict or export this session before saving.' : 'Saved data could not be read. Changes stay in memory. Retry recovery, export a backup, or explicitly restore/clear progress to replace stored data.', state.conflict ? 'stale' : 'storage-read')
      return false
    }
    const backup = exportProfileBackup(state.profile)
    if (!backup.ok) { error(backup.error.message, backup.error.kind); return false }
    let locks: ProfileLocks | undefined
    try { locks = options.locks() } catch { /* Coordination can be unavailable separately from storage. */ }
    if (!locks) { error('Safe saving is unavailable in this browser. Current progress remains available in this session; export a backup to keep it.', 'unavailable'); return false }
    const ticket = ++operation
    const version = state.version
    const profile = state.profile
    state = { ...state, pending: true }
    emit()
    try {
      return await locks.request(PROFILE_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (ticket !== operation || version !== state.version) return false
        if (!lock) { error('Another tab is saving progress. Current progress remains available in this session; retry saving or export a backup.', 'unavailable'); return false }
        const current = read()
        if (current.kind === 'unavailable' || current.text !== expected) { observe(current); return false }
        try { options.storage().setItem(PROFILE_STORAGE_KEY, backup.text) } catch {
          error('Progress could not be saved on this device. Current progress remains available in this session; export a backup to keep it.', 'storage-write')
          return false
        }
        baseline = backup.text
        persisted = profile
        state = { ...state, conflict: null, writable: true, error: '', errorKind: undefined }
        emit()
        return true
      })
    } catch {
      if (ticket === operation) error('Safe saving is unavailable in this browser. Current progress remains available in this session; export a backup to keep it.', 'unavailable')
      return false
    } finally {
      if (ticket === operation) { state = { ...state, pending: false }; emit() }
    }
  }
  function apply(next: Profile, replaceStorage = false, action: HistoryAction = 'change'): boolean {
    if (state.pending) { error('Progress is being saved. Try this change again when saving finishes.', 'unavailable'); return false }
    state = { ...state, profile: next, history: [...state.history.slice(-19), { profile: state.profile, action }], redoHistory: [], version: state.version + 1 }
    emit()
    void save(replaceStorage)
    return true
  }
  function undo(): boolean {
    if (state.pending || !state.history.length) return false
    const previous = state.history.at(-1)!
    state = { ...state, profile: previous.profile, history: state.history.slice(0, -1), redoHistory: [...state.redoHistory, { profile: state.profile, action: previous.action }], version: state.version + 1 }
    emit()
    void save()
    return true
  }
  function redo(): boolean {
    if (state.pending || !state.redoHistory.length) return false
    const next = state.redoHistory.at(-1)!
    state = { ...state, profile: next.profile, history: [...state.history, { profile: state.profile, action: next.action }], redoHistory: state.redoHistory.slice(0, -1), version: state.version + 1 }
    emit()
    void save()
    return true
  }
  function useSaved(version: number): boolean {
    if (state.pending || state.version !== version || state.conflict?.kind !== 'valid') { error('Progress changed while reviewing recovery. Review the current conflict again.', 'stale'); return false }
    const current = read()
    if (current.kind !== 'valid' || current.text !== state.conflict.text) { observe(current); return false }
    baseline = current.text
    persisted = current.profile
    state = { ...state, profile: current.profile, history: [{ profile: state.profile, action: 'recovery' }], redoHistory: [], conflict: null, version: state.version + 1, error: '', errorKind: undefined, writable: true }
    emit()
    return true
  }
  function retry(): StoredSnapshot | null {
    if (state.conflict) return state.conflict
    const current = read()
    if (current.kind === 'unavailable') { error(current.error, current.errorKind); return null }
    if (baseline === undefined) { observe(current); return state.conflict }
    if (current.text !== baseline) { observe(current); return state.conflict }
    if (state.writable || current.text === null) { void save(current.text === null); return null }
    error(current.kind === 'invalid' ? current.error : 'Review recovered progress before replacing this session.', current.kind === 'invalid' ? current.errorKind : 'stale')
    return null
  }
  function subscribe(listener: (state: ProfileSessionState) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
  return { initialize, subscribe, getState: () => state, apply, undo, redo, save, retry, refreshExternal, cancelPending, useSaved }
}
