# Umami analytics and operator guide

The separately authorized [technical reporting integration](reporting.md) sends errors, diagnostic logs and performance traces to reports.garrod.house independently of this Umami preference. Statements below about tracking controls and allowed usage-analytics providers describe Umami; they do not disable technical reporting. No saves, backups or reference contents are attached to technical reports.

## Companion additions

The canonical production base is now `/idle-slayer-companion/`. Only its exact root and six static section routes (including `index.html` aliases) are allowed by URL sanitization; arbitrary subpaths, query/hash values, private transfers and references keep the existing cleanup/suspension rules. No new analytics provider, player identity, module record, goal, recipe, counter, or event payload has been added.

All new companion module DOM, private status/error feedback, goals/recipe plans, and global import/backup/reset/recovery contents use both `telemetry-private` and `rr-block` before recorder startup. The bounded existing game-import lifecycle remains supported. Real local recorder checks cover full snapshots and subsequent mutations across all companion pages. Ordinary visible Ascension progress retains its existing disclosure. Coarse heatmap coordinates remain subject to the existing limitation.

Settings & privacy saves actual progress and intentions before reload, offers export-both/discard/cancel if those cannot be saved, and blocks reload while separate tree references need recovery. Old preference keys and the disabled URL marker stay compatible. No live analytics settings or reports were changed for this implementation.

The user authorized usage analytics and session recording for this static app through the self-hosted [Umami instance](https://analytics.garrod.house), website ID `f5c9bfd4-7ab5-4f82-a543-9357dcea1566`. This replaces the original no-analytics boundary only for this integration. It does not add an application backend, accounts, save uploads, game-file access or other analytics services. This analytics scope is a lasting implementation constraint. Authority to commit, push or publish future work must come from the task being performed, under [AGENTS.md](../AGENTS.md) and the [release gate](implementation-plan.md#validation-and-release); a historical deployment receipt does not authorize a new publication. The original authorized deployment and manual production readbacks are dated below.

## Visitor behavior and privacy

Tracking starts automatically after reading the separate tracking preference. Privacy & tracking in the Companion navigation offers a persistent opt-out. Changing it reloads the page so disabling recording stops active observers and network activity. The preference is outside the map profile: backup, restore, game import, undo, clear progress and catalog migration do not change it. A preference read failure keeps tracking off. If current map progress cannot be saved before reload, show **Export backup and reload**, **Reload without backup** and **Cancel**; never choose for the user. Reloading clears session-only undo normally. If writing the tracking preference itself fails, reload with the disabled `#analytics=off` URL; do not claim that fallback is persistent. Keep/bookmark the off URL if storage remains unavailable.

Disabling tracking or clearing browser storage in another tab also suspends this tab for the rest of its current page session. An unreadable/invalid preference or native `umami.disabled` opt-out does the same when reported by a storage change. Later enabling from another tab cannot resume its buffered recording, including when scripts are still loading. The current map and unsaved progress remain usable; this tab is never reloaded automatically. Privacy & tracking explains when a clean reload is required and uses the same save/export/cancel choices before starting a new recording.

Recordings can include ordinary visible map progress: purchased/available/pending states, milestones and displayed summaries. Hidden nodes stay absent under the shared visibility rules. Selected saves and JSON backups are never uploaded. Search text, file inputs, UA-counter inputs, save-import comparison/warnings, JSON-restore content and unknown IDs, and raw error details are excluded from replay contents. After applying an import or restore, its ordinary visible map result can appear in recording. Iframe recording is disabled.

The entire optional named-checkpoint region uses `telemetry-private rr-block`, including names, snapshot choices/differences, operation context, storage errors and capture/rename/delete/portable restore/recovery controls. Its file input is also blocked. Checkpoints add no event names or payload properties. Actual local Umami 3.4 recorder checks verify a blocked region in a full snapshot, private edits absent from mutation/event data, and public proof markers outside the region present in both. Coarse heatmap coordinates retain the existing limitation.

Catalog startup failures display fixed public wording with a retry action. Parser excerpts and catalog-validation details are never stored in React state or displayed; `catalog_error` retains only its bounded `network` or `validation` category. The fixed loading/error screen can appear in recordings.

Current action feedback and storage recovery warnings inside map dialogs use one accessible live region within the active modal. Its contents and controls are replay-blocked with `.telemetry-private rr-block`, including fixed restore/read/export failures. Global storage warnings use the same exclusions; bounded error event categories are unchanged. Heatmap coordinates still follow the existing exclusion limits.

The prerequisite-route comparison blocks its entire pane, including target queries, copied local goals, external-item assumptions and intended OR choices, with `.telemetry-private rr-block`. These visit-only annotations never alter the profile or generate new usage events. Coarse click and scroll coordinates follow the existing recording limits.

The disclosure and keyboard-accessible **Privacy & tracking** control remain available while the catalog is loading, stalled or unavailable. Opening the control and cross-tab preference changes refresh its controller status. Changing tracking from startup reloads without editing the existing stored map profile, because no map editing session has initialized yet. Once the map is loaded, its existing save/export/cancel protection still applies before a tracking reload.

Standard collection also includes page visits, sanitized referral/campaign information, browser/device information, approximate location when available and bounded performance measurements. These service/session dimensions are separate from the application's allowlisted custom event properties below.

Replay exclusions block DOM contents, not every interaction measurement. Umami still records coarse click and scroll coordinates for heatmaps, including over excluded elements. Moderate masking is not a promise that ordinary rendered progress is private. Do not weaken the explicit exclusions when adjusting replay fidelity.

Events never contain save bytes, decoded native preferences, filenames, paths, file hashes, JSON backup contents, ownership arrays, arbitrary unknown IDs, search text, exact UA counters, arbitrary error messages/stacks or player/account identifiers. A native upgrade or milestone ID is allowed only for an explicit action on an entry in the current shared visibility result. No whole profile, import summary or hidden topology is an analytics payload.

Saved upgrade comparison adds no events or properties. Its complete reference workspace, choices, file input, export/restore context and recovery feedback are inside `.telemetry-private.rr-block` before recording can start. Saved IDs, unavailable IDs and comparison search text do not enter payloads. Showing a private comparison entry on the ordinary visible map can expose that normal map inspection to replay, but emits no comparison-derived selection event. Coarse heatmap coordinates remain subject to the existing disclosed limits.

The controller runs only in a production build on `austingarrod.github.io`, at `/idle-slayer-ascension-map/` (or its no-trailing-slash form), in the top-level frame. Local previews and development builds do not contact Umami. It also honors Do Not Track (`1` or `yes`), Global Privacy Control and native `umami.disabled`. The app preference key is `idle-slayer-ascension-map.analytics.v1`, with `enabled` or `disabled`; a missing preference enables the default, while an invalid value or failed read disables tracking.

Before scripts load, `history.replaceState` removes arbitrary query/hash values from the address. Only `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` and `utm_term` values matching `[a-zA-Z0-9._~-]{1,64}` survive in tracker metadata, held in memory. External referrers retain only their origin; internal referrers use the canonical map path. If address cleanup fails, scripts do not load. The session-only fallback is `#analytics=off`; it is an opt-out marker, not a saved map preference. Do not use visitor identification to attach game/account identities or map profiles to sessions. Script failures, blocked requests and unavailable Umami APIs must leave the map usable.

URL guards are installed before the tracker and recorder throughout the page session. Same-document push/replace calls are sanitized before the browser changes the address, so eligible recording can continue. Direct fragment navigation and back/forward visits to dirty older entries can expose an address before queued navigation events run: the guard cleans it and suspends this document until reload, preventing any buffered metadata from uploading afterward. Every guarded history call checks the existing live address first, so clearing it cannot hide previously buffered metadata. Recorder cache access and tracker callbacks also check the live address synchronously. Caller history state, push/replace behavior and native history exceptions are preserved, including malformed destinations. `#analytics=off` remains intact and suspends recording until a clean reload; removing it cannot resume the old recording. A later cleanup failure also suspends the document and denies recorder cache access. Startup campaign metadata remains the bounded in-memory snapshot above.

## Scripts and event contract

Offline documents suspend tracking until a fresh online reload. Offline startup loads no tracking scripts; a later offline signal discards the startup event queue and denies the recorder's guarded session-cache accessor so buffered events/replays cannot resume after reconnection. No offline upload queue or background sync exists. The PWA caches only reviewed public static files and bypasses external analytics requests. Preference, disabled-URL and browser privacy-signal checks apply again on reload. See [install-offline.md](install-offline.md). The bounded `panel` property also accepts `install` for the installation/offline dialog; no profile or installation payload is tracked.

The bootstrap creates only the authorized tracker and recorder after applying startup safeguards. Its effective tracker attributes include host/domain restrictions, query/hash exclusion, Do Not Track, performance collection and the sanitizing callback:

```html
<script defer src="https://analytics.garrod.house/script.js" data-website-id="f5c9bfd4-7ab5-4f82-a543-9357dcea1566" data-host-url="https://analytics.garrod.house" data-domains="austingarrod.github.io" data-exclude-search="true" data-exclude-hash="true" data-do-not-track="true" data-performance="true" data-before-send="ascensionMapBeforeSend"></script>
<script defer src="https://analytics.garrod.house/recorder.js" data-website-id="f5c9bfd4-7ab5-4f82-a543-9357dcea1566" data-host-url="https://analytics.garrod.house"></script>
```

Do not paste static embeds into `index.html` and bypass the bootstrap. Umami 3.4 obtains effective replay settings from the website configuration: both replays and heatmaps enabled, sampling `1`, moderate masking, 1,200,000 ms (20 minutes) maximum and `.telemetry-private` as the block selector. The application marks excluded DOM with both `telemetry-private` and `rr-block`. These settings describe collection, not server retention; no retention policy is established by the original requested script attributes.

The analytics adapter owns tracking. Pure game rules, save decoding and profile storage retain their existing contracts and do not make telemetry requests. Common context is limited to `app_version`, `catalog_version`, `catalog_revision`, `screen_layout`, `layout` and `spoilers`. Screen layout is `compact` at widths ≤1,100 px or heights ≤540 px; otherwise it is `wide`. Map layout is `web` or `game`. Session metadata contains the same safe context and never a distinct visitor ID or profile. Event properties use typed enums, booleans, bounded counts/buckets or current-visible catalog IDs; names and property sets form an allowlist.

[`src/analytics-contract.ts`](../src/analytics-contract.ts) is the shared definition of event names, supported keys and permitted values. Its literal rules derive the `trackEvent` API and runtime sanitizer; operation names and phases generate their events together. Authored misspellings, unrelated properties and unsupported enum values fail typecheck, including extra keys passed through variables. [`tests/typecheck/analytics-contract.ts`](../tests/typecheck/analytics-contract.ts) preserves these checks with compiler fixtures. Properties remain optional, and runtime filtering remains authoritative for JavaScript callers, malformed data and current-visible identities at both enqueue and flush. The controller supplies common context; unrelated caller context and arbitrary fields are discarded. `analyticsPosition()` preserves the existing omission of numeric positions outside 1–3 without changing the underlying purchase choices.

Search length buckets are `1-3`, `4-10`, `11-30`, `31+`; result buckets are `0`, `1-5`, `6-20`, `21+`. Recommendation positions are 1–3 and basis is `wiki` or `catalog-fallback`. During script startup, the bounded in-memory event queue retains at most 100 entries, drops the oldest on overflow and expires entries after 30 seconds; visibility IDs are checked again at flush. API exceptions/rejections are ignored safely. Runtime failures emit fixed categories at most once per category per 30 seconds and ten times per page, without messages/stacks.

Search events follow deliberate input edits after 500 ms of idle input. Rapid edits coalesce, and an empty/whitespace-only input cancels the pending event. Purchases, Undo, spoiler changes and cross-tab progress updates can recalculate visible results; they update a pending search's bounded result bucket without restarting its timer or counting another search. Focusing or reopening an unchanged query also does not count as new input. Only bounded length/result buckets are retained for that timer.

| Area | Exact event names | Event properties and meaning |
| --- | --- | --- |
| Startup and reliability | `app_ready`, `catalog_error`, `runtime_error`, `storage_error`, `storage_recovered` | Fixed `reason`/`action` categories as applicable. Readiness means the catalog and local profile initialization finished; it does not imply a saved edit or a production release. |
| Dialogs and presentation | `panel_opened`, `panel_closed`, `map_layout_changed`, `spoilers_changed`, `details_toggled`, `map_camera_used` | Panel events accept `panel`; layout changes accept `layout`; spoiler changes accept `enabled`; details accept `expanded`; camera events accept bounded `action`, `source`, `direction` and `expanded`. Track deliberate user actions, not automatic recentering or resize. |
| Exploration | `search_performed`, `upgrade_selected`, `source_link_opened` | Bounded `query_length`/`results`, `source`, `upgrade_id` and `action` as applicable. Search text and arbitrary external URLs are excluded; overlapping selection callbacks produce one semantic selection. |
| Recommendations | `recommendations_viewed`, `recommendation_selected`, `recommendation_purchase_started`, `recommendation_purchase_applied` | Viewed accepts bounded `reason`; selected accepts `position`, `basis`, `action` and current-visible `upgrade_id`; started accepts `upgrade_id` and recommendation `source`; applied accepts `upgrade_id`. Viewed suggestions do not establish ownership or affordability. Applied means the user confirmed a recommendation purchase through the normal purchase flow. |
| Confirmed progress operations | `<operation>_previewed`, `<operation>_applied`, `<operation>_cancelled` | Operations are exactly `purchase`, `removal`, `milestone_removal`, `astral_activation`, `ultra_ascension`, `clear`, `restore`, `recovery`. Purchase accepts current-visible `upgrade_id` and bounded `source`; removal/activation accept `upgrade_id`; milestone removal accepts `milestone_id`; the remaining operations have only common context. A preview or cancellation never counts as an application. |
| Progress entry and history | `purchase_started`, `purchase_blocked`, `prerequisite_chosen`, `milestone_changed`, `prior_ascensions_recorded`, `progress_undo` | Current-visible IDs, bounded `source`, `reason`, `position` and `recorded` as applicable. Prior-ascension events contain no exact epoch; prerequisite events contain no hidden requirement arrays. |
| Backups | `backup_download_requested`, `backup_error` | Error accepts a fixed `reason`; requested has only common context. Requested means the browser download was initiated; it does not prove the visitor saved the file. |
| Game-save import | `game_import_started`, `game_import_previewed`, `game_import_applied`, `game_import_cancelled`, `game_import_error` | Error accepts a fixed `reason`; other stages have only common context. No imported ownership, counter or file metadata. Cancelled/stale reads cannot emit applied. |

Map help retains the bounded `keyboard-help` panel value for setup, state and keyboard guidance. Focus browsing emits no upgrade selection or progress event.

Prior Ultra Ascension drafts, validation feedback and count confirmation remain replay-blocked. `prior_ascensions_recorded` fires only after **Record history** applies the confirmed change. Editing, reviewing and cancelling emit no history application event; the existing bounded event contract is unchanged.

An applied event means the current in-memory map session changed after confirmation. Local storage can still fail; track that separately with `storage_error`, keep the usable session and existing recovery/export controls. Do not equate conversion counts with durable local saves. Do not emit synthetic traffic to populate reports.

Cross-tab recovery uses the same bounded recovery events and storage error categories. Conflict summaries and replacement previews are replay-blocked like import/restore previews; stored text, unknown IDs and full profiles never enter their DOM or event properties. A pending profile write can be cancelled before a privacy reload, and a held write lock promptly exposes the existing export/reload/cancel choices rather than blocking opt-out.

QR progress transfer captures and removes its URL fragment before analytics startup; failed cleanup suppresses tracker/recorder initialization. Same-document transfers use a capture-phase hash listener and the existing dirty-URL suspension. QR codes, generated links, paste fields, replacement previews and copy feedback are inside `.telemetry-private rr-block`. Only the bounded `transfer` panel value is added; no profile, encoded link, token or exact counter becomes an event property. The destination tracking preference is never included or overwritten. Local real-recorder fixtures verify content and URL exclusions. [Transfer privacy contract](progress-transfer.md).

## Private Umami setup and reports

Use Chrome to inspect and configure the existing website. The board and reports remain private; do not enable website/report share links. The definitions below were configured and read back on October 5–6, 2026. Empty reports do not establish that production telemetry arrived.

| Configuration | Accepted definition |
| --- | --- |
| Website | **Idle Slayer**, ID `f5c9bfd4-7ab5-4f82-a543-9357dcea1566`, for the app's canonical GitHub Pages site. |
| Board | [**Ascension Map — Product overview**](https://analytics.garrod.house/boards/f10ebd6f-2e22-4148-983a-ecb405e6524d), saved and read back with 14 native widgets across seven rows, all sourced from **Idle Slayer**. No public sharing link was created. |
| Goal: Purchase applied | Event `purchase_applied`. |
| Goal: Recommendation purchase applied | Event `recommendation_purchase_applied`. |
| Goal: Game save imported | Event `game_import_applied`. |
| Goal: Ultra Ascension applied | Event `ultra_ascension_applied`. |
| Goal: Backup requested | Event `backup_download_requested`; label this a request, not a completed file save. |
| Funnel: Purchase recorded | `purchase_started` → `purchase_previewed` → `purchase_applied`, ten-minute conversion window. |
| Funnel: Game save import | `game_import_started` → `game_import_previewed` → `game_import_applied`, ten-minute conversion window. |
| Funnel: Recommendation purchase | `recommendations_viewed` → `recommendation_purchase_started` → `recommendation_purchase_applied`, ten-minute conversion window. |
| Journey: Map exploration | Native Journeys view: five steps, **Events**, Start Step `app_ready`, End Step empty; subsequent steps use any event. This is a view recipe, not a saved named report. |
| Cohort: Confirmed purchases — last 30 days | Rolling Last 30 days, event `purchase_applied`; [private cohort view](https://analytics.garrod.house/websites/f5c9bfd4-7ab5-4f82-a543-9357dcea1566?cohort=62ca75a0-fdc3-4483-b1e4-ad1691ef4b02). |
| Cohort: Game-save importers — last 30 days | Rolling Last 30 days, event `game_import_applied`; [private cohort view](https://analytics.garrod.house/websites/f5c9bfd4-7ab5-4f82-a543-9357dcea1566?cohort=94a09037-f05b-4303-b9ba-ee678c63c374). |
| Cohort: Recommendation users — last 30 days | Rolling Last 30 days, event `recommendations_viewed`; [private cohort view](https://analytics.garrod.house/websites/f5c9bfd4-7ab5-4f82-a543-9357dcea1566?cohort=17be121f-d431-4ad5-bbe9-097841978209). |

Use the native website **Performance**, **Replays** and **Heatmaps** screens where supported by this installed Umami version. Performance aggregates describe visitor page experience; they do not benchmark game-rule correctness. Replays show eligible recorded sessions and their visible map UI, while heatmaps aggregate coarse interaction positions. These are dedicated native screens; do not claim that a custom board embeds them unless the installed widget picker supports it. An unavailable screen or widget is an installation capability limit, not an invitation to add another service.

The saved board's seven rows contain **Site usage** (metrics bar); **Visitors over time** and **Feature activity over time** (events chart); **Feature adoption** (event metrics bar) and **Feature events** (Event metrics table, 20 rows); three goal widgets; the remaining two goals; three funnel widgets; and **Diagnostics & exploration** plain-text guidance. All five goals and three funnels are bound to the exact saved names/events above. The outer design Save and normal-view spacing/content review passed. Do not enable public sharing.

Umami 3.4's [widget registry](https://github.com/umami-software/umami/blob/v3.4.0/src/app/%28main%29/boards/boardComponentRegistry.tsx) has no performance, replay, heatmap or journey widget, so use their dedicated native screens. Its Text widget displays plain text rather than Markdown hyperlinks; the diagnostics widget gives navigation instructions, and this guide supplies clickable links. Review future layout edits in the saved normal view: design-editor row whitespace does not determine saved row height.

For exploration, segment native traffic/event views by available device/screen and campaign dimensions, then use typed event data such as layout, selection source, recommendation basis and failure category. The native Device filter showed **No data** before the first visitor; saved device/session-property segments remain deferred until real collected values are available. `screen_layout` (`wide`/`compact`) reflects the app UI and is distinct from native device category. Session-level funnels can mix repeated attempts within the window; this integration does not introduce a game/player identity or upload attempt payloads to manufacture exact attribution.

### Journey capability in Umami 3.4

The native [Journeys screen](https://analytics.garrod.house/websites/f5c9bfd4-7ab5-4f82-a543-9357dcea1566/journeys) accepts a typed `app_ready` Start Step even before that event has arrived. In v3.4.0, the input immediately updates the selected value and retains it among options. Choose **Events** so the initial automatic page view cannot precede `app_ready` in the ranked sequence. These conclusions follow the official [journey page](https://github.com/umami-software/umami/blob/v3.4.0/src/app/%28main%29/websites/%5BwebsiteId%5D/%28reports%29/journeys/JourneysPage.tsx), [step input](https://github.com/umami-software/umami/blob/v3.4.0/src/components/input/WebsiteValueComboBox.tsx) and [journey query](https://github.com/umami-software/umami/blob/v3.4.0/src/queries/sql/journeys/getJourney.ts) sources.

The page stores steps/start/end/view only in component state. Umami 3.4 has no native Save Journey action or URL/local-storage persistence for these parameters; a link opens the screen but does not configure the recipe. Set the four controls after reopening it. Do not invent a saved report ID or parameterized permalink, modify the host or create synthetic events to fill the selector. The current view's empty result is expected before matching traffic exists.

### Configuration readback: October 5–6, 2026

Manual Chrome readback verified the installed Umami 3.4 website settings: replays and heatmaps enabled, both sampling at `1`, moderate masking, maximum duration `1200000` and `.telemetry-private` block selector. The five goals, three ten-minute funnels, private board's 14 widgets and three rolling Last 30 days cohorts listed above were saved and read back. The Journey tab was configured and verified with Steps 5, Events selected, Start Step `app_ready` and empty End Step; its transient-view limitation remains as documented. Configuration and normal-view screenshots are retained outside Git.

Only data-dependent device/session-property segments remain deferred until real visitor values are available. These configuration receipts establish saved settings and reports; deployment and manual app inspection are recorded separately below.

### Deployment and manual readback: October 6, 2026

The October 6 delivery request authorized committing, pushing and publishing the verified analytics integration through GitHub Pages. That authorization applied to that completed delivery. Implementation commit [`eae6ecc7a02d6e5b6f9bdb829f99feb15291ccce`](https://github.com/AustinGarrod/idle-slayer-ascension-map/commit/eae6ecc7a02d6e5b6f9bdb829f99feb15291ccce) was pushed to `main`. The [GitHub Pages workflow](https://github.com/AustinGarrod/idle-slayer-ascension-map/actions/runs/37413647900) completed validation and deployment successfully. Local checks passed: typecheck, catalog validation, 201 unit tests, production build, 66 browser cases and release checks. Browser tests used local builds and isolated telemetry endpoints.

Deliberate manual Chrome inspection of the [live app](https://austingarrod.github.io/idle-slayer-ascension-map/) verified rendering, search, upgrade details, Game/Web layouts, Next upgrade recommendations and the privacy disclosure. No progress changes were applied. The privacy panel reported **Your browser privacy setting prevents tracking**, so this Chrome profile correctly remained excluded from collection.

The user accepted finishing without live ingestion proof. Production page views, events, performance data, recordings and heatmaps remain unverified; successful deployment and app inspection do not establish their arrival. Device/session-property segments still await values from an eligible visitor. Manual screenshots are retained outside Git.

## Local verification and Windows handoff

Use Node.js 24 and the repository's pinned Yarn 4.13.0. From the repository root:

```powershell
yarn install --immutable
yarn typecheck
yarn test
yarn build
yarn playwright install chromium
yarn test:e2e
yarn check:release
```

Without a global Yarn launcher, use the same pinned release directly:

```powershell
node .yarn/releases/yarn-4.13.0.cjs install --immutable
node .yarn/releases/yarn-4.13.0.cjs typecheck
node .yarn/releases/yarn-4.13.0.cjs test
node .yarn/releases/yarn-4.13.0.cjs build
node .yarn/releases/yarn-4.13.0.cjs playwright install chromium
node .yarn/releases/yarn-4.13.0.cjs test:e2e
node .yarn/releases/yarn-4.13.0.cjs check:release
```

Local/isolated CI browser tests must intercept tracker/recorder scripts and analytics endpoints, check the event allowlists and lifecycle, assert replay exclusions, and prove synthetic account/save markers never reach any telemetry payload. Cover initial opt-out, reload persistence, preference read/write failures and disabled-URL fallback, profile-save failure with explicit backup/reload/cancel choices, undo/reset independence, blocked/missing Umami, duplicate selections, cancellation/stale import and storage failure after application. Retain existing spoiler, storage, import and responsive tests.

Never point automated suites, probes, API tests or scheduled checks at the live production site. Production confirmation is deliberate manual inspection only; do not retry or work around hosting rate limits. Chrome inspection of private Umami configuration, local tests, deployment success and manual production collection are separate evidence. For future work, establish commit/push/publication authority from that task before using the applicable delivery workflow, and satisfy the standing release gate. The October 6 approval recorded above is historical. The authorized Umami integration does not authorize other hosted-service changes, and automated production tests remain prohibited.


Supported public upgrade fragments are captured in memory before URL cleanup. Startup cleanup finishes synchronously before the tracker or recorder can execute. Live fragment capture uses the installed history wrapper, preserving permanent suspension when a dirty URL may already be buffered. The public ID/revision never enters recorder, heatmap or referrer URLs; hidden reference outcomes reveal neither the ID nor title. Disabled tracking also receives universal address cleanup. The bounded `#analytics=off` sentinel survives preference-write failure. Sharing adds no telemetry event.

Reference-sheet selection, feedback and complete iframe preview sit under `.telemetry-private.rr-block`. No new reference-sheet events are emitted. Generated static HTML and print tabs contain no tracking scripts; they use a no-referrer policy and source links retain noreferrer. Local actual-recorder snapshot/mutation tests inspect decoded blocked nodes and ensure the complete outgoing document and synthetic private markers never enter telemetry.

Hypothetical UA roadmap names, target pickers, item assumptions, OR intentions, stage state, costs, pre-UA checklists and reset results are inside both `.telemetry-private` and `.rr-block`. This open-dialog feature adds no event, URL state, storage, export or profile write. Local browser evidence uses the reviewed actual recorder fixture to verify blocked snapshots and mutations; coarse heatmap coordinates remain subject to the existing disclosure.
