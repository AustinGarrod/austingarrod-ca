import type { getTrackingStatus } from './analytics'
import type { ReactNode } from 'react'

export const trackingDisclosure = 'Companion progress is stored in this browser when saving succeeds. Technical error reports, diagnostic logs and performance traces are sent to reports.garrod.house independently of the usage-tracking setting. This site uses self-hosted Umami for usage analytics and session recordings, which may include visible map progress. Save files, backups and transfer contents are never uploaded. You can disable tracking in Privacy & tracking.'

export function PrivacyPanel({ status, onChange, progressStatus = 'Progress saving is checked after the companion loads.', additionalActions }: {
  status: ReturnType<typeof getTrackingStatus>
  onChange: (enabled: boolean) => void
  progressStatus?: string
  additionalActions?: ReactNode
}) {
  const preferenceEnabled = status.preference === 'enabled' && !['opt-out', 'reload-required'].includes(status.reason)
  const urlOnlyOptOut = status.reason === 'opt-out' && status.preference !== 'disabled'
  const explanation = ['development', 'unsupported-origin'].includes(status.reason) ? 'Tracking is off in this local preview.'
    : status.reason === 'embedded' ? 'Embedded previews are not tracked.'
      : ['global-privacy-control', 'do-not-track', 'umami-disabled'].includes(status.reason) ? 'Your browser privacy setting prevents tracking.'
        : status.reason === 'storage-unavailable' ? 'Your tracking preference could not be read. Tracking is off for this visit.'
          : status.reason === 'offline' ? 'Tracking is off while offline. Offline usage is not queued for later delivery.'
          : status.reason === 'reload-required' ? 'Tracking remains off in this tab until a clean reload. Reload to start a new recording with your current preference.'
          : urlOnlyOptOut ? 'Tracking is off for this visit. The disabled preference was not saved in this browser; keep this page URL to retain the choice.'
            : status.reason === 'script-unavailable' ? 'Tracking could not load. Your companion remains usable.'
            : status.enabled ? 'Usage analytics and recording are enabled for this visit.' : 'Usage analytics and recording are disabled.'
  return <div className="privacy-panel">
    <p>{trackingDisclosure}</p>
    <p className="progress-save-status">{progressStatus}</p>
    <p className="tracking-status" role="status">{explanation}</p>
    <h3>What is collected</h3>
    <p>Page visits, referral and campaign information, browser/device information, approximate location when available, performance measurements and interactions with map features. Recordings can show clicks, navigation and your visible upgrade and milestone states.</p>
    <h3>What stays private</h3>
    <p>Companion module contents, observations, goals and recipe plans, selected files, backups, transfer contents, import/reset/recovery previews, typed searches and history inputs are excluded from recordings. Unrelated game preferences are discarded locally. Events contain bounded feature information rather than your full profile or file contents.</p>
    <p>Heatmaps record click positions and scrolling, including positions over excluded controls, without their input contents. Recordings are sampled at 100% of eligible sessions and stop after 20 minutes.</p>
    <h3>Your choice</h3>
    <p>Changing tracking reloads the page to stop or start recording. Saved progress is kept; session-only undo is cleared. If progress cannot be saved, you can export a backup before reloading. Browser privacy settings continue to apply.</p>
    <div className="dialog-actions privacy-actions"><button className={preferenceEnabled ? '' : 'primary'} onClick={() => onChange(!preferenceEnabled)}>{preferenceEnabled ? 'Disable tracking and reload' : 'Enable tracking and reload'}</button>{additionalActions}</div>
  </div>
}
