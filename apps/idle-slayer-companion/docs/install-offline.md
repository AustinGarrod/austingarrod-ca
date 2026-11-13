# Installation and offline use

## Companion identity and URL migration

The start URL and scope are now `/idle-slayer-companion/`; the manifest's stable ID stays `/idle-slayer-ascension-map/` to preserve the existing same-origin installation identity. The inventory includes every static section entry, both reviewed catalogs, all reviewed icons, fonts, notices, and bundled scripts. Companion caches use `idle-slayer-companion-public-`; the legacy bridge has its own cache prefix and scope. No progress data, import file, intentions, or analytics is cached by the worker.

[site-migration.md](site-migration.md) describes the generated old-address launcher and staged user-site release. The old address forwards recognized map transfer/public reference fragments without analytics. Its offline fallback is read-only and can export saved progress; it cannot migrate data between browser storage partitions. Same-origin storage continuity and manifest identity do not prove physical browser/OS installation behavior. Android, iOS and desktop install/update behavior remains unverified on physical devices for this release.

Updates still wait for old windows to close. Export **Companion progress** for all tracked actual state and **intentions** separately; tree checkpoints and comparison have separate recovery/exports. A legacy map JSON/QR contains only Ascension progress/layout.

The static Companion can be installed from a supporting browser. **Install & offline** is available in the Companion navigation (use **Menu** on phones). It offers **Install Companion** only after the browser supplies an installation event. Dismissed prompts fall back to instructions; an installed standalone window shows its installed state. A browser tab cannot reliably detect a separate installation, so browser-menu guidance remains conditional.

| Platform | Installation route |
| --- | --- |
| Android | In a supporting browser such as Chrome, choose **Install app** or **Add to Home screen** from its menu. Follow the browser's confirmation and launch the resulting home-screen icon. |
| iPhone / iPad | Open the map in Safari. Choose **Share → Add to Home Screen**; enable **Open as Web App** if offered. Launch that icon. On iPad, Share may be in the toolbar. |
| Desktop | Supporting Chrome/Edge browsers offer an address-bar install icon or an install menu command. Supported macOS Safari versions offer **File → Add to Dock**. Other browsers may provide a bookmark instead. |

Menu wording, installation eligibility and storage behavior depend on the browser and OS. Installation requires a secure context (HTTPS, or localhost for controlled local checks). The manifest keeps the identity `/idle-slayer-ascension-map/`, launches and scopes the worker to `/idle-slayer-companion/`, and uses standalone display. It contains no progress, transfer or tracking data. Its original gold/magenta journal and compass mark has separate 192/512px regular and 512px maskable assets; the maskable design places meaningful artwork inside the central 80%-diameter safe circle. A 180px Apple touch icon is included. `scripts/generate-app-icons.mjs` renders the original vector drawing using the already-reviewed Playwright development dependency; inspect regenerated icons before committing.

The installation routes follow the platform guidance in [Chrome's web-app help](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid), [Apple's iPhone guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), and [Apple's Safari web-app guide](https://support.apple.com/104996). Browser install-event handling follows [MDN's installation documentation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt).

## Download and reopen

Keep the initial visit online until **Install & offline** says **Public app files are saved for offline reopening**. A successful catalog render alone does not establish offline readiness. The worker verifies a complete release before installation succeeds: application HTML, compiled code/styles, the reviewed catalog, all 288 icons, local fonts, installation icons/manifest, and bundled software licenses. Once ready, close/reopen or reload the map to use the cached release. The map, search, recommendations, purchases, milestones, reset previews, undo, JSON backups and supported user-selected native-save import run locally. External sources need internet.

A first-ever visit cannot work offline; the browser can display its own network error before any app code exists. If code loads but the catalog does not, the loading screen explains reconnect/retry and offers offline recovery without replacing the saved profile. Blocked/full storage or a failed/incomplete download keeps the online app usable and reports that offline files are not ready. Browser eviction can remove cached files later: a missing app shell shows reconnect/repair instructions. Reconnect, close other map windows, then use **Repair app files and reload**; within the normal app use **Repair offline files and reload…**. Repair unregisters the app worker and downloads again, retaining profile/layout/tracking storage. It does not clear browser data.

## Progress and storage limits

The existing version 1 profile and storage key remain unchanged. A browser tab and installed app may share storage in some browsers; do not assume they do everywhere. Apple home-screen or Dock apps, separate browsers, profiles and devices may have different storage contexts. Check the installed app's progress and use the existing JSON export/restore route when moving it. Installation works independently of any device-transfer feature.

Export regular backups. Local storage is not cloud backup; browser cleanup, private-mode restrictions, device loss, cache/storage eviction or uninstalling may remove app files or progress. Uninstall behavior differs by platform: removing an icon can leave browser data, while an uninstall that also clears site data can delete progress. Export before uninstalling or clearing data. Session-only undo and unconfirmed previews never survive a reload. Read/write failures retain an exportable memory session and expose the existing retry/conflict recovery controls.

## Complete releases and deliberate updates

The build writes `offline-assets.json`, an explicit public-file inventory with SHA-256 hashes, and `sw.js`. Its release identity binds every listed byte and worker source. Installation fetches with cache bypass and verifies every response; missing or mismatched bytes reject the installation and delete the incomplete release cache. This prevents a racing deployment from combining catalog/code/assets from different releases. Running releases serve their own verified cache without opportunistic network refresh. New bytes are not substituted after eviction; recovery downloads a complete release instead.

A replacement worker waits while a map window is open. The Companion navigation shows **Update ready**, and **Install & offline** offers **Prepare app update…**. **Check update / retry download** manually checks the worker; reconnecting also checks. There is no scheduled polling or forced reload. Native import, restore, purchase, OR-choice and recovery previews are not interrupted. Leave or complete them before opening installation controls.

Preparing an update first attempts the existing coordinated profile save. A confirmation explains loss of session-only undo on closing and shows current save status. Unsaved/failed/pending progress offers **Export backup and prepare update**, **Prepare without backup**, or **Cancel**; no action is selected automatically. Saved progress offers backup export or **Prepare with saved progress**. The next screen instructs you to save or export progress in every map tab/app window, close all of them including the current window, and reopen. You can keep the session open instead. Unsaved changes are lost on closing unless exported; restore that backup after reopening if needed.

Checkpoints, saved comparison and goals use separate storage. Unsaved, pending or conflicted checkpoint/comparison state and unsaved goals block update preparation and repair until their existing recovery controls are reviewed. Install & offline links directly to the affected workspace. A progress JSON backup cannot protect these separate collections. Recovery does not edit active progress. Confirmation reads their current state again; newer reference changes cancel an in-flight repair before reload.

Incoming private transfers and public references invalidate asynchronous repair and update preparation before their review opens, including after unregister has started. Startup also aborts repair when a newer link arrives or the catalog finishes loading. Startup repair warns that deliberate reload ends the visit; reopen the original link afterward to review it. Transfer payloads remain memory-only and never enter loading markup or the public cache.

Preparing does not activate or reload anything. Reloading an open window keeps its old release. The worker never calls `skipWaiting` or `clients.claim`: normal browser activation waits until every old controlled window has closed, including any window opened after preparation. Existing windows continue using the old code, catalog and complete asset cache. Once the browser activates the new verified release, it removes old public release caches; profile, purchases, pending Astrals, milestones, unknown IDs, layout and tracking preferences remain separate and intact.

App-file repair still offers **Export backup and reload**, **Reload with saved progress** or **Reload without backup**, and **Cancel**. During its asynchronous window check, Cancel, Close and Escape stop the operation before unregister or reload. Once unregister starts, dismissal and duplicate actions are disabled until reload or failure. A profile change from another window invalidates the operation, so a stale reply or unregister completion cannot later reload a new preview. Repair keeps browser-stored progress and never clears browser data.

If an update fails, keep using the previous complete cache and retry online. If files were evicted, use repair and restore a JSON backup if progress storage was independently lost. Do not clear all browser site data as an app-file recovery step.

## Privacy

The worker accepts only GET requests for the exact generated public inventory and root navigation. It never caches arbitrary URLs, query-bearing asset requests, native saves, file/Blob inputs, backups, transfer payloads, external analytics responses or POSTs. Root navigation uses the canonical cached shell without storing the query/hash. No background sync, telemetry cache or upload queue is added.

When the browser signals offline, the analytics boundary discards its bounded startup queue, suspends that document and denies the recorder's public session-cache accessor. Buffered offline replay/events cannot resume uploading when connectivity returns. An offline-started document also stays untracked until a fresh online reload. The existing tracking preference, disabled `#analytics=off` URL, Do Not Track and Global Privacy Control continue to apply on that reload. Source [analytics.md](analytics.md) defines the remaining behavior.

## Local verification and platform evidence

From Windows PowerShell with Node.js 24 and pinned Yarn 4.13.0:

```powershell
yarn install --immutable
yarn typecheck
yarn test
yarn build
yarn check:release
yarn playwright install chromium
yarn test:e2e
```

Without a global Yarn launcher, use `node .yarn/releases/yarn-4.13.0.cjs <command>`. Existing browser fixtures block only top-level app registration for isolated request interception, preserving sandboxed reference previews; `tests/browser/pwa.spec.ts` opts into real workers and uses only local production builds. It exercises manifest/public cache coverage, offline reload/new-window progress and licenses, prompt/installed-state presentation, offline-download failure, evicted-cache repair, and two complete local releases with natural activation only after all old windows close, late-window retention of the old catalog/cache, retained Astral/unknown state/preferences and failed-saving backup/cancel paths. Delayed repair replies cover Cancel, Close, Escape and external-profile invalidation without interrupting a new purchase preview; repair window checks reject pre-existing other windows. Unit tests verify cache integrity/privacy boundaries and offline telemetry suppression. The build/release gate verifies manifest scope, app icon dimensions/source bytes, public inventory and exact worker output alongside the existing catalog/notices checks. No runtime dependency was added.

Automated local/isolated CI checks satisfy acceptance. Physical Android, iOS/iPadOS and desktop installation/standalone behavior remains unverified and nonblocking; owner-performed tests are not required. Browser emulation and synthetic installation events do not establish that physical behavior. Optional physical follow-up can record platform, browser version, install route, standalone launch, offline reopen and progress persistence separately. Never run automated checks against production; authorized production confirmation remains deliberate manual inspection.
