import { createContext, useContext, useMemo } from 'react'
import { guestPersistence, type CompanionPersistence } from './account-storage'

export const AccountPersistenceContext = createContext<CompanionPersistence | null>(null)
export function useAccountPersistence() { const context = useContext(AccountPersistenceContext); return useMemo(() => context ?? guestPersistence(), [context]) }
