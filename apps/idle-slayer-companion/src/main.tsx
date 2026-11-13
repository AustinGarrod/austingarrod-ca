import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { honorMigrationOptOut, initializeAnalytics } from './analytics'
import { captureMigrationLink } from './migration-link'
import { createProgressTransferInbox } from './progress-transfer-inbox'
import { initializeUpgradeReferences } from './upgrade-reference-receiver'
import { initializePwa } from './pwa'
import { initializeReporting, Sentry } from './reporting'

honorMigrationOptOut(window)
captureMigrationLink(window)
initializeReporting()

const initialMapIntent = window.location.hash.startsWith('#transfer=') || window.location.hash.startsWith('#upgrade=')
const transferInbox = createProgressTransferInbox(window)
const references = initializeUpgradeReferences(window, import.meta.env.BASE_URL)
if (transferInbox.trackingSafe) initializeAnalytics()
references.cleanAddress()
initializePwa()

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<main className="loading"><h1>Companion could not render</h1><p>Reload to retry. Saved progress remains in this browser.</p></main>}>
      <App transferInbox={transferInbox} initialMapIntent={initialMapIntent} />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
