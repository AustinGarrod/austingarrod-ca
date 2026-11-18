import { useContext, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { CompanionProfileContext } from './CompanionRuntimeContext'
import { createProfileSession } from './domain/profile-session'
import type { ProfileSessionState } from './domain/profile-session'
import { PROFILE_STORAGE_KEY } from './domain/storage'
import { diagnosticStorage } from './reporting-storage'
import { useAccountPersistence } from './AccountPersistenceContext'

type SessionObservers = {
  onState: (state: ProfileSessionState) => void
  onExternalChange: (state: ProfileSessionState) => void
  onErrorChange: (state: ProfileSessionState, recovered: boolean) => void
  onInitialized: () => void
  onBeforeInitialize: () => void
  onDispose: () => void
}

/** One React snapshot of the domain session; browser subscription lifetime lives here. */
export function useProfileSession(revision: string, observers: SessionObservers) {
  const providedSession = useContext(CompanionProfileContext)
  const persistence = useAccountPersistence()
  const session = useMemo(() => providedSession ?? createProfileSession({
    revision,
    storage: diagnosticStorage('legacy-map', persistence.storage),
    locks: persistence.locks,
  }), [revision, providedSession, persistence])
  const [state, setState] = useState(session.getState)
  const observe = useEffectEvent((next: ProfileSessionState) => observers.onState(next))
  const externalChange = useEffectEvent((next: ProfileSessionState) => observers.onExternalChange(next))
  const errorChange = useEffectEvent((next: ProfileSessionState, recovered: boolean) => observers.onErrorChange(next, recovered))
  const initialized = useEffectEvent(() => observers.onInitialized())
  const beforeInitialize = useEffectEvent(() => observers.onBeforeInitialize())
  const disposed = useEffectEvent(() => observers.onDispose())

  useEffect(() => {
    let externalVersion = session.getState().externalVersion
    let previousError = ''
    const unsubscribe = session.subscribe((next) => {
      observe(next)
      setState(next)
      if (next.error && next.error !== previousError) errorChange(next, false)
      else if (!next.error && previousError) errorChange(next, true)
      previousError = next.error
      if (next.externalVersion !== externalVersion) {
        externalVersion = next.externalVersion
        externalChange(next)
      }
    })
    beforeInitialize()
    if (!providedSession) session.initialize()
    observe(session.getState())
    setState(session.getState())
    initialized()
    const storageChanged = (event: StorageEvent) => {
      try { if (!providedSession && persistence.matches(event, [PROFILE_STORAGE_KEY])) session.refreshExternal() } catch { session.refreshExternal() }
    }
    window.addEventListener('storage', storageChanged)
    const stopRefresh = persistence.subscribe(() => { if (!providedSession) session.refreshExternal() })
    return () => {
      stopRefresh()
      window.removeEventListener('storage', storageChanged)
      unsubscribe()
      disposed()
      if (!providedSession) session.cancelPending()
    }
  }, [session, providedSession, persistence])

  return { session, state, loaded: state.persistence !== 'loading' }
}
