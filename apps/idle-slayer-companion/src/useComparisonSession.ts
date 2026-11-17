import { useEffect, useMemo, useState } from 'react'
import { createComparisonSession } from './domain/comparison-session'
import { diagnosticStorage } from './reporting-storage'
import { COMPARISON_STORAGE_KEY } from './domain/saved-comparison'
import { useAccountPersistence } from './AccountPersistenceContext'

export function useComparisonSession() {
  const persistence = useAccountPersistence()
  const session = useMemo(() => createComparisonSession({ storage: diagnosticStorage('saved-comparison', persistence.storage), locks: persistence.locks }), [persistence])
  const [state, setState] = useState(session.getState)
  useEffect(() => persistence.registerVisit('comparison', () => session.getState().list), [persistence, session])
  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    session.initialize()
    const changed = (event: StorageEvent) => {
      try {
        if (persistence.matches(event, [COMPARISON_STORAGE_KEY])) session.refreshExternal()
      } catch { session.refreshExternal() }
    }
    window.addEventListener('storage', changed)
    const stopRefresh = persistence.subscribe(() => session.refreshExternal())
    return () => { stopRefresh(); window.removeEventListener('storage', changed); unsubscribe(); session.cancelPending() }
  }, [session, persistence])
  return { session, state }
}
