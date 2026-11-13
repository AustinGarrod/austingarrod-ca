import { COMPARISON_STORAGE_KEY, emptyComparison, exportComparison, parseComparison, type SavedComparison } from './saved-comparison'
import type { ProfileLocks } from './profile-session'

type Snapshot = { text: string | null; list: SavedComparison | null } | null
export interface ComparisonState {
  list: SavedComparison
  version: number
  loaded: boolean
  pending: boolean
  dirty: boolean
  conflict: boolean
  error: string
  saved: boolean
  canUseSaved: boolean
  savedList: SavedComparison | null
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** Separate bounded reference storage. No profile access, native rules or telemetry. */
export function createComparisonSession(dependencies: { storage: () => Storage; locks: () => ProfileLocks | undefined }) {
  let state: ComparisonState = { list: emptyComparison(), version: 0, loaded: false, pending: false, dirty: false, conflict: false, error: '', saved: false, canUseSaved: false, savedList: null }
  let baseline: Snapshot = null, observed: Snapshot = null, generation = 0
  const subscribers = new Set<(state: ComparisonState) => void>()
  function publish(patch: Partial<ComparisonState>) {
    state = { ...state, ...patch, savedList: observed?.list ?? null, version: state.version + 1 }
    subscribers.forEach((subscriber) => subscriber(state))
  }
  function read(): Snapshot {
    try {
      const text = dependencies.storage().getItem(COMPARISON_STORAGE_KEY)
      return { text, list: text === null ? emptyComparison() : parseComparison(text) }
    } catch { return null }
  }
  function external(snapshot: Snapshot) {
    generation++
    observed = snapshot
    if (!state.dirty && !state.pending && snapshot?.list) {
      baseline = snapshot
      publish({ list: snapshot.list, conflict: false, error: '', pending: false, saved: snapshot.text !== null, canUseSaved: true })
    } else publish({ conflict: true, pending: false, saved: false, canUseSaved: !!snapshot?.list,
      error: 'Saved comparison changed or cannot be read. Your local comparison was kept. Review recovery before saving.' })
  }
  async function save(replace = false, expectedVersion = state.version): Promise<boolean> {
    if (!state.loaded || state.pending || expectedVersion !== state.version) return false
    if ((!baseline?.list || state.conflict) && !replace) {
      publish({ error: 'Comparison is kept for this visit. Review recovery before replacing saved data.', saved: false })
      return false
    }
    const accepted = replace ? observed : baseline
    if (!accepted) { publish({ error: 'Comparison storage cannot be read. Export this comparison and retry recovery.', saved: false }); return false }
    const token = ++generation, list = state.list
    publish({ pending: true, saved: false })
    try {
      const locks = dependencies.locks()
      if (!locks) throw new Error('coordination')
      return await locks.request(`${COMPARISON_STORAGE_KEY}.write`, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (token !== generation) return false
        if (!lock) throw new Error('busy')
        const snapshot = read()
        if (!snapshot || snapshot.text !== accepted.text) { external(snapshot); return false }
        const text = exportComparison(list)
        dependencies.storage().setItem(COMPARISON_STORAGE_KEY, text)
        baseline = observed = { text, list }
        publish({ pending: false, dirty: false, saved: true, conflict: false, error: '', canUseSaved: true })
        return true
      })
    } catch {
      if (token === generation) publish({ pending: false, saved: false, error: 'Comparison is kept for this visit. Saving failed or another tab is busy. Export it or retry saving.' })
      return false
    }
  }
  return {
    getState: () => state,
    subscribe(callback: (state: ComparisonState) => void) { subscribers.add(callback); return () => { subscribers.delete(callback) } },
    initialize() {
      const snapshot = read()
      baseline = observed = snapshot
      publish({ loaded: true, list: snapshot?.list ?? emptyComparison(), saved: !!snapshot?.list && snapshot.text !== null,
        canUseSaved: !!snapshot?.list, conflict: !snapshot?.list,
        error: snapshot?.list ? '' : 'Saved comparison is unavailable or invalid. It has not been replaced. Export local entries or review recovery.' })
    },
    edit(list: SavedComparison, expectedVersion = state.version) {
      const validated = parseComparison(JSON.stringify(list))
      if (!state.loaded || state.pending || expectedVersion !== state.version || !validated) return false
      publish({ list: validated, dirty: true, saved: false })
      void save()
      return true
    },
    refreshExternal() {
      const snapshot = read()
      if (snapshot?.list && baseline?.list && snapshot.text === baseline.text) {
        observed = snapshot
        if (state.conflict) publish({ conflict: false, canUseSaved: !!snapshot.list, error: '' })
        return
      }
      external(snapshot)
    },
    useSaved(expectedVersion: number) {
      if (state.pending || state.version !== expectedVersion) return false
      const snapshot = read()
      if (!snapshot?.list || !observed || snapshot.text !== observed.text) { external(snapshot); return false }
      generation++; baseline = observed = snapshot
      publish({ list: snapshot.list, dirty: false, saved: snapshot.text !== null, conflict: false, error: '', canUseSaved: true })
      return true
    },
    save,
    cancelPending() { generation++; if (state.pending) publish({ pending: false, saved: false }) },
  }
}
