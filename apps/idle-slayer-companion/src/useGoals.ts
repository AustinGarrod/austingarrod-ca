import { useContext, useEffect, useRef, useState } from 'react'
import { CompanionMapGoalsContext } from './CompanionRuntimeContext'
import { emptyGoals, GOALS_STORAGE_KEY, parseGoals, type Goals } from './domain/goals'

type GoalsState = { goals: Goals; error: string; raw: string | null; dirty: boolean; readable: boolean }
export type GoalsController = GoalsState & {
  edit: (goals: Goals, expected: Goals, replace?: boolean) => boolean
  useSaved: () => void
  reviewRecovery?: () => void
  getState: () => GoalsState
}
function read(): GoalsState {
  try {
    const raw = window.localStorage.getItem(GOALS_STORAGE_KEY)
    return { goals: raw === null ? emptyGoals() : parseGoals(raw), raw, dirty: false, readable: true, error: '' }
  } catch { return { goals: emptyGoals(), raw: null, dirty: false, readable: false, error: 'Saved goals could not be read. Intentions remain usable for this visit; existing saved data will not be overwritten.' } }
}
/** Independent local intentions never write the game profile or its Undo history. */
export function useGoals(): GoalsController {
  const provided = useContext(CompanionMapGoalsContext)
  const [state, setState] = useState(read)
  const current = useRef(state)
  function publish(next: GoalsState) { current.current = next; setState(next) }
  function edit(goals: Goals, expected: Goals, replace = false) {
    const previous = current.current
    if (expected !== previous.goals) {
      publish({ ...previous, error: 'The goal list changed before this edit. Current goals were kept; review the updated list and retry.' })
      return false
    }
    const next = { ...previous, goals, dirty: true }
    try {
      if (!replace && (!previous.readable || window.localStorage.getItem(GOALS_STORAGE_KEY) !== previous.raw)) {
        publish({ ...next, error: 'Saved goals changed or could not be read. This visit keeps your intentions; choose a recovery action before replacing saved goals.' })
        return true
      }
      const raw = JSON.stringify(goals)
      window.localStorage.setItem(GOALS_STORAGE_KEY, raw)
      publish({ goals, raw, readable: true, dirty: false, error: '' })
    } catch { publish({ ...next, error: 'Goals could not be saved. Your intentions remain usable for this visit. Retry saving before closing this page.' }) }
    return true
  }
  function useSaved() {
    const incoming = read()
    if (incoming.readable) publish(incoming)
    else publish({ ...current.current, readable: false, dirty: true, error: incoming.error })
  }
  useEffect(() => {
    if (provided) return
    const changed = (event: StorageEvent) => {
      let storage: Storage
      try { storage = window.localStorage } catch { return }
      if (event.storageArea !== storage || (event.key !== null && event.key !== GOALS_STORAGE_KEY)) return
      if (current.current.dirty) publish({ ...current.current, error: 'Saved goals changed in another tab. This visit keeps its intentions; choose which goals to retain.' })
      else useSaved()
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [provided])
  return provided ?? { ...state, edit, useSaved, getState: () => current.current }
}
