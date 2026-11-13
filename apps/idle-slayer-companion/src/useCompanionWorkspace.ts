import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createCompanionWorkspaceSession, COMPANION_WORKSPACE_KEY, type CompanionWorkspace } from './domain/companion-workspace'
import { GOALS_STORAGE_KEY } from './domain/goals'
import { diagnosticStorage } from './reporting-storage'
export { COMPANION_WORKSPACE_KEY, parseCompanionWorkspace } from './domain/companion-workspace'
export type { CompanionGoal, CompanionWorkspace, CompanionWorkspaceReview } from './domain/companion-workspace'

/** Intentions stay outside actual progress and its Undo history. */
export function useCompanionWorkspace() {
  const session = useMemo(() => createCompanionWorkspaceSession({ storage: diagnosticStorage('intentions'), locks: () => navigator.locks }), [])
  const state = useSyncExternalStore(session.subscribe, session.getState)
  useEffect(() => {
    session.initialize()
    const changed = (event: StorageEvent) => {
      let storage: Storage
      try { storage = localStorage } catch { session.refreshExternal(); return }
      if (event.storageArea === storage && (event.key === null || [COMPANION_WORKSPACE_KEY, GOALS_STORAGE_KEY].includes(event.key))) session.refreshExternal()
    }
    window.addEventListener('storage', changed)
    return () => { window.removeEventListener('storage', changed); session.cancelPending() }
  }, [session])
  return { ...state, edit: (workspace: CompanionWorkspace, expected = state.workspace) => session.edit(workspace, expected), save: session.save, getState: session.getState, review: session.review, useSaved: session.useSaved, replaceSaved: session.replaceSaved }
}
