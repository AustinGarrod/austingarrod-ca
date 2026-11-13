import { useEffect, useMemo, useState } from 'react'
import { createComparisonSession } from './domain/comparison-session'
import { diagnosticStorage } from './reporting-storage'
import { COMPARISON_STORAGE_KEY } from './domain/saved-comparison'

export function useComparisonSession() {
  const session = useMemo(() => createComparisonSession({ storage: diagnosticStorage('saved-comparison'), locks: () => window.navigator.locks }), [])
  const [state, setState] = useState(session.getState)
  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    session.initialize()
    const changed = (event: StorageEvent) => {
      try {
        if (event.storageArea === window.localStorage && (event.key === null || event.key === COMPARISON_STORAGE_KEY)) session.refreshExternal()
      } catch { session.refreshExternal() }
    }
    window.addEventListener('storage', changed)
    return () => { window.removeEventListener('storage', changed); unsubscribe(); session.cancelPending() }
  }, [session])
  return { session, state }
}
