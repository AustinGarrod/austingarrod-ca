import type { ProfileLocks } from './profile-session'
import type { Profile } from './types'
import { CHECKPOINT_STORAGE_KEY, checkpointName, emptyCheckpoints, exportCheckpoints, MAX_CHECKPOINTS, parseCheckpoints, type CheckpointVault } from './checkpoints'

type Snapshot = { text: string | null; vault: CheckpointVault | null } | null
export interface CheckpointState {
  vault: CheckpointVault; savedVault: CheckpointVault | null; version: number; loaded: boolean
  pending: boolean; dirty: boolean; saved: boolean; conflict: boolean; error: string
}

/** Reducer commands always start from the current adopted document, never a render's full-list copy. */
export function createCheckpointSession(options: { revision: string; storage: () => Pick<Storage, 'getItem' | 'setItem'>; locks: () => ProfileLocks | undefined; id: () => string }) {
  let state: CheckpointState = { vault: emptyCheckpoints(), savedVault: null, version: 0, loaded: false, pending: false, dirty: false, saved: false, conflict: false, error: '' }
  let baseline: Snapshot = null, observed: Snapshot = null, generation = 0
  const listeners = new Set<(state: CheckpointState) => void>()
  function publish(patch: Partial<CheckpointState>) { state = { ...state, ...patch, savedVault: observed?.vault ?? null, version: state.version + 1 }; listeners.forEach((listener) => listener(state)) }
  function read(): Snapshot {
    try { const text = options.storage().getItem(CHECKPOINT_STORAGE_KEY); return { text, vault: text === null ? emptyCheckpoints() : parseCheckpoints(text, options.revision) } } catch { return null }
  }
  function external(snapshot: Snapshot) {
    generation++; observed = snapshot
    if (!state.dirty && !state.pending && snapshot?.vault) {
      baseline = snapshot
      publish({ vault: snapshot.vault, pending: false, conflict: false, error: '', saved: snapshot.text !== null })
    } else publish({ pending: false, saved: false, conflict: true, error: 'Saved checkpoints changed or cannot be read. This local collection was kept. Review recovery before saving.' })
  }
  async function save(replace = false, version = state.version): Promise<boolean> {
    if (!state.loaded || state.pending || version !== state.version) return false
    if ((!baseline?.vault || state.conflict) && !replace) { publish({ error: 'Checkpoints are kept for this visit. Review recovery before replacing saved data.', saved: false }); return false }
    const accepted = replace ? observed : baseline
    if (!accepted) { publish({ error: 'Checkpoint storage cannot be read. Export this collection and retry recovery.', saved: false }); return false }
    const token = ++generation, text = exportCheckpoints(state.vault, options.revision)
    if (!text) { publish({ error: 'The checkpoint collection exceeds its supported format or 4 MiB limit. Export or remove a checkpoint.', saved: false }); return false }
    publish({ pending: true, saved: false })
    try {
      const locks = options.locks()
      if (!locks) throw new Error('coordination')
      return await locks.request(`${CHECKPOINT_STORAGE_KEY}.write`, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (token !== generation) return false
        if (!lock) throw new Error('busy')
        const snapshot = read()
        if (!snapshot || snapshot.text !== accepted.text) { external(snapshot); return false }
        options.storage().setItem(CHECKPOINT_STORAGE_KEY, text)
        baseline = observed = { text, vault: state.vault }
        publish({ pending: false, dirty: false, saved: true, conflict: false, error: '' })
        return true
      })
    } catch {
      if (token === generation) publish({ pending: false, saved: false, error: 'Checkpoints are kept for this visit. Saving failed or another tab is busy. Export this collection or retry saving.' })
      return false
    }
  }
  function command(version: number, reduce: (vault: CheckpointVault) => CheckpointVault | null): boolean {
    if (!state.loaded || state.pending || version !== state.version) return false
    let parsed: CheckpointVault | null = null
    try { const next = reduce(state.vault); parsed = next && parseCheckpoints(JSON.stringify(next), options.revision) } catch { /* Keep the existing collection on failed capture/validation. */ }
    if (!parsed) { publish({ error: 'Checkpoint change refused. Use a name of 1–64 characters, at most four checkpoints, and a collection within 4 MiB. Nothing was replaced.' }); return false }
    publish({ vault: parsed, dirty: true, saved: false })
    void save()
    return true
  }
  return {
    getState: () => state,
    subscribe(listener: (state: CheckpointState) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    initialize() {
      baseline = observed = read()
      publish({ loaded: true, vault: baseline?.vault ?? emptyCheckpoints(), saved: !!baseline?.vault && baseline.text !== null,
        conflict: !baseline?.vault, error: baseline?.vault ? '' : 'Saved checkpoints are invalid or unavailable. They have not been replaced. Export local references or review recovery.' })
    },
    capture(name: string, currentProfile: () => Profile, version: number) {
      return command(version, (vault) => {
        const normalizedName = checkpointName(name)
        if (!normalizedName || vault.entries.length >= MAX_CHECKPOINTS) return null
        const profile = currentProfile()
        return { ...vault, entries: [...vault.entries, { id: options.id(), name: normalizedName, capturedRevision: profile.catalogRevision, profile }] }
      })
    },
    rename(id: string, name: string, version: number) { return command(version, (vault) => checkpointName(name) && vault.entries.some((entry) => entry.id === id) ? { ...vault, entries: vault.entries.map((entry) => entry.id === id ? { ...entry, name: checkpointName(name)! } : entry) } : null) },
    remove(id: string, version: number) { return command(version, (vault) => vault.entries.some((entry) => entry.id === id) ? { ...vault, entries: vault.entries.filter((entry) => entry.id !== id) } : null) },
    restore(vault: CheckpointVault, version: number) { return command(version, () => vault) },
    refreshExternal() {
      const snapshot = read()
      if (snapshot?.vault && baseline?.vault && snapshot.text === baseline.text) { observed = snapshot; if (state.conflict) publish({ conflict: false, error: '' }); return }
      external(snapshot)
    },
    useSaved(version: number) {
      if (state.pending || state.version !== version) return false
      const snapshot = read()
      if (!snapshot?.vault || !observed || snapshot.text !== observed.text) { external(snapshot); return false }
      generation++; baseline = observed = snapshot
      publish({ vault: snapshot.vault, dirty: false, saved: snapshot.text !== null, conflict: false, error: '' }); return true
    },
    save,
    cancelPending() { generation++; if (state.pending) publish({ pending: false, saved: false }) },
  }
}
