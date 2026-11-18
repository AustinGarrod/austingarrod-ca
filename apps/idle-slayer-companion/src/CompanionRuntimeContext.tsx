import { createContext } from 'react'
import type { createProfileSession } from './domain/profile-session'
import type { GoalsController } from './useGoals'

export const CompanionProfileContext = createContext<ReturnType<typeof createProfileSession> | null>(null)
export const CompanionMapGoalsContext = createContext<GoalsController | null>(null)
