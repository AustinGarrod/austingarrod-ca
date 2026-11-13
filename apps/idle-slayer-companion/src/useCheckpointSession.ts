import { useEffect, useMemo, useState } from 'react'
import { createCheckpointSession } from './domain/checkpoint-session'
import { CHECKPOINT_STORAGE_KEY } from './domain/checkpoints'
import { diagnosticStorage } from './reporting-storage'

export function useCheckpointSession(revision: string) {
  const session = useMemo(() => createCheckpointSession({ revision, storage: diagnosticStorage('checkpoints'), locks: () => window.navigator.locks, id: () => window.crypto.randomUUID() }), [revision])
  const [state, setState] = useState(session.getState)
  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    session.initialize()
    const changed = (event: StorageEvent) => {
      try { if (event.storageArea === window.localStorage && (event.key === null || event.key === CHECKPOINT_STORAGE_KEY)) session.refreshExternal() } catch { session.refreshExternal() }
    }
    window.addEventListener('storage', changed)
    return () => { window.removeEventListener('storage', changed); unsubscribe(); session.cancelPending() }
  }, [session])
  return { session, state }
}
