import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import catalogData from '../public/catalog.json'
import type { Catalog } from '../src/domain/types'
import { RetirementPage } from './RetirementPage'
import './retirement.css'

// Capture before cleaning the address. No tracker, reporting SDK, profile
// session, native-save importer or full-app startup is imported here.
const fragment = location.hash
try { history.replaceState(history.state, '', location.pathname) } catch { /* This page never sends telemetry. */ }
window.addEventListener('beforeinstallprompt', (event) => event.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode><RetirementPage catalog={catalogData as unknown as Catalog} initialFragment={fragment} /></StrictMode>,
)
