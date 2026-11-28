import { useEffect, useMemo, useState } from 'react'
import { createCheckpointSession } from './domain/checkpoint-session'
import { CHECKPOINT_STORAGE_KEY } from './domain/checkpoints'
import { diagnosticStorage } from './reporting-storage'
import { useAccountPersistence } from './AccountPersistenceContext'

export function useCheckpointSession(revision: string, onSavedChange?: () => void) {
  const persistence = useAccountPersistence()
  const session = useMemo(() => createCheckpointSession({ revision, storage: diagnosticStorage('checkpoints', persistence.storage), locks: persistence.locks, id: () => window.crypto.randomUUID(), onSavedChange }), [revision, persistence, onSavedChange])
  const [state, setState] = useState(session.getState)
  useEffect(() => persistence.registerVisit('checkpoints', () => session.getState().vault), [persistence, session])
  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    session.initialize()
    const changed = (event: StorageEvent) => {
      try { if (persistence.matches(event, [CHECKPOINT_STORAGE_KEY])) session.refreshExternal() } catch { session.refreshExternal() }
    }
    window.addEventListener('storage', changed)
    const stopRefresh = persistence.subscribe(() => session.refreshExternal())
    return () => { stopRefresh(); window.removeEventListener('storage', changed); unsubscribe(); session.cancelPending() }
  }, [session, persistence])
  return { session, state }
}
