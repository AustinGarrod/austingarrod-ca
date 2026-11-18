import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createCompanionWorkspaceSession, COMPANION_WORKSPACE_KEY, type CompanionWorkspace } from './domain/companion-workspace'
import { GOALS_STORAGE_KEY } from './domain/goals'
import { diagnosticStorage } from './reporting-storage'
import { useAccountPersistence } from './AccountPersistenceContext'
export { COMPANION_WORKSPACE_KEY, parseCompanionWorkspace } from './domain/companion-workspace'
export type { CompanionGoal, CompanionWorkspace, CompanionWorkspaceReview } from './domain/companion-workspace'

/** Intentions stay outside actual progress and its Undo history. */
export function useCompanionWorkspace() {
  const persistence = useAccountPersistence()
  const session = useMemo(() => createCompanionWorkspaceSession({ storage: diagnosticStorage('intentions', persistence.storage), locks: persistence.locks }), [persistence])
  const state = useSyncExternalStore(session.subscribe, session.getState)
  useEffect(() => persistence.registerVisit('intentions', () => session.getState().workspace), [persistence, session])
  useEffect(() => {
    session.initialize()
    const changed = (event: StorageEvent) => {
      try { if (persistence.matches(event, [COMPANION_WORKSPACE_KEY, GOALS_STORAGE_KEY])) session.refreshExternal() } catch { session.refreshExternal() }
    }
    window.addEventListener('storage', changed)
    const unsubscribe = persistence.subscribe(() => session.refreshExternal())
    return () => { unsubscribe(); window.removeEventListener('storage', changed); session.cancelPending() }
  }, [session, persistence])
  return { ...state, edit: (workspace: CompanionWorkspace, expected = state.workspace) => session.edit(workspace, expected), save: session.save, getState: session.getState, review: session.review, useSaved: session.useSaved, replaceSaved: session.replaceSaved }
}
