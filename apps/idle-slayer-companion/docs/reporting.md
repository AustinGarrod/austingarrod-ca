# Technical reporting

The 2026-10-25 implementation adds technical diagnostics to [Idle Slayer Companion in GlitchTip](https://reports.garrod.house/garrod-house/issues?project=7), organization `garrod-house`, project `idle-slayer-companion` (ID 7, team `internal`). There was no Sentry SDK, DSN, project configuration or source-map upload in this repository. Existing Umami events only counted coarse failures. No historical Sentry projects or reports were deleted.

The destination was verified through its authenticated GlitchTip API, MCP tools and a read-only inspection of the running `glitchtip/glitchtip:6.2.6` service. Its JavaScript error ingestion, source-map processing, structured logs and complete performance transactions were tested with the pinned MIT Sentry React SDK. This app is static React hosted with AustinGarrod.ca on HostPapa: there is no application server, server DSN or cross-service application request to instrument. The compatibility host remains separate and does not run this application's reporting SDK.

Upstream capability references: [JavaScript SDK](https://glitchtip.com/sdkdocs/javascript/), [structured logs](https://glitchtip.com/documentation/logs/), [performance monitoring](https://glitchtip.com/documentation/performance/) and [release/symbol tooling](https://glitchtip.com/documentation/cli/). Installed SDK types and actual server readbacks determine the compatibility choices below.

## Website integration

Maintained source is `apps/idle-slayer-companion/` in [AustinGarrod/austingarrod-ca](https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion). The default build publishes `/utilities/idle-slayer-companion/`; symbol uploads use the matching `~/utilities/idle-slayer-companion/assets` prefix. Both application telemetry projects remain separate from the portfolio projects. `COMPANION_DEPLOY_TARGET=legacy-migration` builds the old-origin migration version with the previous paths/installation identity and disables both reporting and usage analytics. Migration builds never upload reporting releases. Historical verification receipts below describe the original standalone deployment.

## Collection and operation context

`src/reporting.ts` initializes before React renders and before catalog/PWA startup. It captures global exceptions, unhandled promise rejections, original linked causes, React render/recovery errors, error/assert console calls, info/warn/error console logs, fetch/XHR failures, failed image/script/stylesheet resources, navigation/network breadcrumbs and browser performance transactions. React's root handlers and boundary use the SDK's exception deduplication. Catalog loading also has a named span and reports HTTP status or validation details instead of discarding the error.

Operation reports cover Companion and legacy-map import/read/validation, export validation, native browser storage access/read/write, map rendering, PWA registration, readiness checks, install/update/repair failures, and cache/install failures forwarded by the service worker. Actual Companion persistence retains the original exception through an optional observer outside the domain contract; reference/intentions documents use a browser storage adapter that rethrows the same exception. Diagnostics never change progress, locking, Undo or recovery outcomes.

Context includes the build release, `web` distribution, environment, browser/OS/device/locale, trace IDs, catalog revision, persistence/dirty/pending/conflict state, current visible map layout/counts/selection and spoiler mode. Existing typed feature lifecycle events also supply diagnostic breadcrumbs independently of Umami eligibility. The last 100 breadcrumbs are retained per event; native file bytes, full profiles, checkpoint names/snapshots, comparison contents, intentions and hidden topology are not attached. Incoming portable-transfer URLs lose their query and fragment in diagnostic request/navigation URLs. Automatic DOM text capture is replaced by explicit feature breadcrumbs so private form contents are not incidentally included. Original useful exception messages, stacks, causes and console diagnostics are retained.

Technical reporting starts for normal production builds independently of the Umami tracking preference. The startup disclosure explains that distinction. Umami's existing opt-out, recording exclusions and usage reports remain intact. Development and automated browser regression runs do not send reports by default; the separate local delivery check explicitly opts in.

## Sampling, supported features and limits

Errors and performance transactions are sampled at **100%**. Info/warn/error structured logs are enabled (SDK 11 enables logs by default). The server project was read back with `eventThrottleRate: 0`; no project throttle or additional ignore list was added. SDK duplicate/error filtering and bounded queues still apply. Traces use SDK 11's `traceLifecycle: 'static'` because GlitchTip accepts complete transaction envelopes. `BrowserSession` is excluded because GlitchTip does not support Sentry release-health sessions. Sentry Replay, profiling, session-health dashboards and other Sentry-only products are not enabled. Existing replay remains in Umami.

GlitchTip's MCP confirmed searchable logs with trace correlation and transaction performance statistics. The running service has logs enabled, **30-day retention** for events, transactions, raw spans, logs and uploaded files, and **365-day retention** for release metadata. These are shared server settings; no global retention or unrelated project policy was changed. Older cached app builds can outlive uploaded-symbol retention, so retain/re-upload the matching release artifacts when investigating those builds. Review server storage/retention as volume grows before reducing useful diagnostics.

The utility-scoped HostPapa CSP allows `connect-src https://reports.garrod.house` for envelopes, alongside the existing Umami endpoint. Browser delivery from the local preview verified the destination's cross-origin ingest behavior. No trace headers are sent to third-party services. GitHub Pages and the static cache cannot provide server traces or record failures that happen before the application starts. Worker failures preserve the original Error/stack when a matching app window exists; a worker with no open client cannot upload them. Offline reporting is best effort, with no persistent diagnostic outbox or delivery guarantee after the browser closes.

## Build, source maps and CI

Use Node 24 and the checked-in Yarn 4.13.0 launcher. The SDK is pinned at 11.9.0 and the CLI at 2.58.6; CLI 3 removed the release-file command used here. The CLI's upload deprecation notice is expected. Verified server symbolication uses the uploaded release artifacts.

Vite generates hidden source maps. Before the PWA inventory is generated, `scripts/reporting-build.ts` copies JS/maps to ignored `.cache/reporting/<release>/` and removes maps from `dist`. The release identity hashes source/scripts, catalogs, dependency lock/config, Git commit, reporting environment and the reviewed deployment target. Build context also carries the commit and public source repository; local modifications remain distinguished by the source-content hash. The stage receipt binds uploaded JS/maps to the current source, environment and distributed JS. Uploading never rewrites `dist`, so offline hashes, notice receipts and deployed code remain coherent. Source maps are not public hosting or offline assets.

The website CI/deployment workflow uploads/finalizes the Companion release before retaining the tested HostPapa artifact. The website repository supplies its protected reporting-upload credential as `SENTRY_AUTH_TOKEN`; the Companion still uploads to its own GlitchTip project. Its value is never a Vite variable or public build input. A failed/missing symbol upload blocks publication. PR builds do not receive the token or upload releases. Only the public ingest DSN belongs in browser code.

Normal Windows validation:

```powershell
node .yarn/releases/yarn-4.13.0.cjs install --immutable
node .yarn/releases/yarn-4.13.0.cjs typecheck
node .yarn/releases/yarn-4.13.0.cjs test
node .yarn/releases/yarn-4.13.0.cjs test:tools
node .yarn/releases/yarn-4.13.0.cjs build
node .yarn/releases/yarn-4.13.0.cjs check:release
node .yarn/releases/yarn-4.13.0.cjs test:e2e
```

For a deliberate synthetic delivery check, obtain `SENTRY_AUTH_TOKEN` through protected local credential handling, then build and upload in the same environment:

```powershell
$env:VITE_REPORTING_ENABLED='true'
$env:VITE_REPORTING_ENVIRONMENT='verification'
node .yarn/releases/yarn-4.13.0.cjs build
node scripts/upload-reporting.mjs
node .yarn/releases/yarn-4.13.0.cjs preview --host 127.0.0.1 --port 4173 --strictPort
```

In another terminal, run `$env:REPORTING_DELIVERY_CHECK='true'; node scripts/verify-reporting.mjs`. The script has a fixed loopback app URL, creates an isolated browser, intercepts a synthetic invalid catalog, and verifies accepted exception/cause/rejection/log/transaction envelopes. Its ignored receipt contains only synthetic diagnostics. Separately inspect the matching event in GlitchTip for an original `src/App.tsx` frame and source context; HTTP acceptance alone does not establish symbolication. Clear the `VITE_REPORTING_*` verification variables and rebuild before normal regression/release work. Never run this script or browser/API regression suites against the live website.

## Verification receipt

On 2026-10-25, final verification event `57a73bef81a74f80b5bfa91e2a34ea9d` was read back from project 7 with `../../src/App.tsx:66`, original source context, catalog file/phase, release/environment, Git commit, browser/OS and a trace ID. The same delivery check included an uncaught exception with its original TypeError cause, a separate unhandled promise rejection, structured logs and a complete `pageload` transaction. Earlier readbacks also confirmed trace-correlated searchable logs and performance statistics. The pre-commit local production build was `idle-slayer-companion@2834a1b4e3d21eef9e2e044f`, with matching uploaded symbols; committed CI builds receive their own commit-bound release identity.

Validation passed: immutable installation, typecheck, build/release gate, 676 unit tests, 35 tooling tests and 322 selected desktop/mobile browser cases. The browser command was `node .yarn/releases/yarn-4.13.0.cjs test:e2e catalog-loading.spec.ts map.spec.ts companion.spec.ts companion-layout.spec.ts companion-map-actions.spec.ts analytics.spec.ts pwa.spec.ts game-save-import.spec.ts save-status.spec.ts profile-sync.spec.ts backup-reads.spec.ts notices.spec.ts --workers=2` (the map filename pattern also selects UA-roadmap cases). The full browser suite was not run for this task. A final catalog browser smoke check was repeated after the reporting metadata/URL guard refinements.

These are synthetic local-browser receipts, distinct from production confirmation. The reporting project, repository upload secret and release artifacts were configured before publication. The user subsequently authorized committing, pushing and deploying this migration on 2026-10-25. Publication uses the existing main-branch Pages workflow, including all four browser shards and the required symbol upload; GitHub's run/deployment receipts identify the published commit. Confirm production deliberately in a normal browser after the deployment succeeds, and keep automated suites on local or isolated CI builds.
