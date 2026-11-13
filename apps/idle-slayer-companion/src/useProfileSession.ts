import { useContext, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { CompanionProfileContext } from './CompanionRuntimeContext'
import { createProfileSession } from './domain/profile-session'
import type { ProfileSessionState } from './domain/profile-session'
import { PROFILE_STORAGE_KEY } from './domain/storage'
import { diagnosticStorage } from './reporting-storage'

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
  const session = useMemo(() => providedSession ?? createProfileSession({
    revision,
    storage: diagnosticStorage('legacy-map'),
    locks: () => window.navigator.locks,
  }), [revision, providedSession])
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
      let local: Storage
      try { local = window.localStorage } catch { session.refreshExternal(); return }
      if (!providedSession && event.storageArea === local && (event.key === null || event.key === PROFILE_STORAGE_KEY)) session.refreshExternal()
    }
    window.addEventListener('storage', storageChanged)
    return () => {
      window.removeEventListener('storage', storageChanged)
      unsubscribe()
      disposed()
      if (!providedSession) session.cancelPending()
    }
  }, [session, providedSession])

  return { session, state, loaded: state.persistence !== 'loading' }
}
