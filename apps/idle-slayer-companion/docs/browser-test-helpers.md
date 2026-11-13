# Browser test helpers

Companion migration keeps legacy `addInitScript` map/goals seeds intact to exercise the real startup reader. Assertion and deliberate other-tab-write helpers project the canonical new envelopes while preserving unrelated companion records and recipe plans. They do not replace application `Storage` APIs or mirror new state into old keys. `window.__readMapProfileText`, `window.__writeExternalMapProfileText`, and `window.__removeMapProfileStorage` are test-only helpers installed by the shared fixture. New companion scenarios inspect the actual canonical wrapper directly.

Use `test` and `expect` from `tests/browser/fixtures.ts` for app scenarios. Its automatic fixture records unhandled JavaScript errors for each test and every page in that test's supplied browser context, including new tabs. The list belongs to one test and is checked during teardown; errors identify the failed scenario. Tests that deliberately create separate contexts still own their specialized setup and error checks.

The default context blocks only top-level app service-worker registration before app code runs, preserving isolated request interception. It skips opaque startup pages and every subframe: Playwright's global `serviceWorkers: 'block'` injection otherwise reads the restricted Navigator accessor inside sandboxed reference previews and produces a harness error. Worker scenarios use `test.use({ appServiceWorkers: true })` and explicitly allow real workers. Separately created contexts must supply their own worker policy and page-error listeners; sandbox and error assertions stay intact.

Small public-behavior helpers live in `tests/browser/helpers/`:

- `app.ts`: toolbar readiness, responsive Map options access, Progress, spoilers, layout, title selection, Undo and a confirmed start purchase. Title selection is for fixtures with an unambiguous title; identity-sensitive scenarios must select their explicit stable ID.
- `profile.ts`: explicit synthetic profile seeding, an optional only-when-absent mode that preserves edits across reload, and profile-only write refusal. Use the same flag to release a simulated refusal; other storage keys retain normal behavior.
- `geometry.ts`: page overflow, selected-node containment, control overlap, 44-pixel hit area and center hit testing.
- `discovery-focus.ts`: focused title clearance below the discovery heading.

Keep domain expectations, state comparisons, async-read controls, privacy assertions and special geometry in the scenario. These helpers do not choose prerequisites, fill real progress, navigate production or suppress errors. Shared navigation waits for the toolbar and uses the same public buttons on desktop and compact layouts.

On Windows with Node.js 24 and the tracked Yarn CLI:

```powershell
yarn install --immutable
yarn typecheck
yarn build
yarn test:e2e tests/browser/map.spec.ts tests/browser/game-layout.spec.ts tests/browser/profile-sync.spec.ts tests/browser/save-status.spec.ts
```

Run the entire `yarn test:e2e` suite before integrating a helper change. Use the [isolated local preview recipe](local-browser-checks.md) when port 4173 is occupied. The default fixture does not disable tracking or seed progress; each scenario keeps those choices explicit. [Failure diagnostics](browser-diagnostics.md) retain local traces, screenshots and the HTML report.
