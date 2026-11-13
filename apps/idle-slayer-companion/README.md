# Idle Slayer Companion

Technical errors, diagnostic logs and performance traces use self-hosted GlitchTip at reports.garrod.house. See [reporting setup, source maps and Windows verification](docs/reporting.md). Usage analytics and recording remain in Umami.

An unofficial, static utility for **Idle Slayer 7.3.4 / Steam build 25810322**. It combines the reviewed Ascension Map with achievements, crafting and materials, regular quests and Village, Bestiary, and normal, Dark, and Elemental Divinities.

The map has **288 upgrades / 318 connections**. The companion catalog adds **1,293 entries** and **1,205 reviewed icons**. The game remains authoritative. Unsupported native predicates are marked unknown and do not reveal content by default.

The application is maintained inside [AustinGarrod/austingarrod-ca](https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion) and published at [austingarrod.ca/utilities/idle-slayer-companion/](https://austingarrod.ca/utilities/idle-slayer-companion/). [The migration runbook](docs/site-migration.md) covers guided file transfer, the frozen GitHub Pages recovery copies, reversible rollout, and deployment verification. Both previous GitHub Pages paths remain available for export and recovery.

## Use the companion

1. Open **Overview** for tracked systems, shared goals, and crafting plans. Use the section navigation for **Ascension**, **Achievements**, **Crafting**, **Quests**, **Bestiary**, and **Divinities**. Spoilers start hidden; lists, search, summaries, goals, and previews use the current visible universe.
2. Enable tracking for a system and record observations manually. A material count, achievement completion, quest claim, crafted item, building, enemy count, or Divinity selection is a recorded fact. Ordinary edits never spend stock, award rewards, or simulate gameplay. Missing observations remain unrecorded.
3. **Import game save** reads a selected file locally: reviewed Windows Steam 7.3.4 supplies supported companion state together; legacy 7.2.0 remains map-only. Review before applying. One import or actual Ultra Ascension is one visit-only Undo/Redo operation across tracked systems. Intentions and preferences stay separate.
4. **Backup & transfer → Export Companion progress** backs up all actual tracked progress. Export **intentions** separately for shared goals and recipe quantities. Ascension checkpoints and saved comparisons retain their own exports. Legacy map JSON and QR transfers cover **map progress/layout only**.
5. **Privacy & tracking** controls the existing self-hosted Umami integration. New companion module contents, observations, intentions, import/restore/reset previews, and recovery controls are blocked from replay. Ordinary visible Ascension progress can appear in recordings. Saves and backups never leave the browser.

See [Companion architecture and limits](docs/companion.md), [native review](docs/companion-native-review.md), and [Steam import compatibility](docs/save-import.md). No accounts, cloud backup, application backend, automatic game-file access, SP-balance simulation, or Stone allocation are included. Daily/weekly quests, Armory, and Minions remain outside this release.

## Ascension tools

Game Layout preserves native positions. Detailed Layout arranges the visible dependency graph. Search by title/effect, inspect native requirements, and record purchases through the existing prerequisite previews. Next upgrade uses the reviewed wiki priority snapshot without claiming affordability or an optimal build.

**Recent upgrades…** in Map view/options or expanded upgrade details returns to your latest inspections. It remembers up to 20 different visible upgrades for this visit, independently of progress Undo.

**Goals:** in expanded upgrade details, **Set progression goal…** records an acquisition, activation or recurring rebuild intention without purchasing anything. Review and reorder visible goals in **Progress**. Intentions stay in separate browser storage and are not included in progress JSON backups; reset, import and Undo only recompute their status.

**Compare prerequisite routes…** in Map view/options or expanded details compares up to four visible targets, including copied goal completion modes. It shows transitive purchase/reveal alternatives, distinct shared work and exact catalog SP sums. Choose an intended route and explicit external-item assumptions for reference only; blocked, hidden or bounded partial paths withhold full totals. This open comparison never edits progress or saved goals and does not stage a future reset.

Use **Map view…** on desktop or **Map options → Overview visible map** on phones to orient within the visible tree. **Return to inspection** or **Refocus selected upgrade** brings back your current target without changing progress.

**Plan hypothetical UAs…** in Map view/options or expanded upgrade details compares two deliberately named tree sequences for the open dialog only. Each has up to four purchase stages, three explicit full Ultra Ascension boundaries and four currently visible targets per stage. Choose completion modes, OR route intentions and hypothetical item receipts. The pre-UA checklist requires native eligibility at each boundary; activation, retained ownership and repeat purchases cleared/reacquired remain separate. Acquire a pending Astral before its reset, then check Activate in a following stage. Future reveals never expand the original current-viewer scope. Incomplete stages stop later claims and withhold complete totals. Closing discards both sequences; nothing edits progress, goals, Undo or storage.

**Forward impact:** expanded upgrade details offer **Analyze forward impact…**, and unrecorded visible Milestones offer **Analyze item receipt…**. This private, read-only dialog evaluates one currently valid purchase or item receipt using native purchase and reveal gates. It never fills prerequisites or purchases the newly eligible upgrades. Default rows and counts use only the current visible map; hypothetical reveal identities appear only while Show spoilers is enabled. Pending Astral purchases stay pending, and affordability is not inferred.

**Progress → Progress checkpoints…** keeps up to four named, read-only snapshots for comparing recorded ownership, Astral activation, milestones and the UA counter. Both sides use your current map's revealed entries. Checkpoints use separate local storage and a separate JSON export/restore; they never replace active progress or change Undo/Redo. Only uniquely matching operations in this visit's bounded history can explain a difference; portable and prior-visit snapshots establish state, not a game activity log.

**Saved upgrade comparison…** in Map options keeps up to four chosen visible upgrades, including owned, pending and blocked entries. **Compare this upgrade…** in expanded details opens the same reference workspace. It shows native benefits, exact costs, separate purchase/reveal requirements, activation, retention and current recorded state; it never records purchases or ranks a build. Stable IDs distinguish same-title entries. The list has separate device storage and its own **Export comparison / Restore comparison…** JSON files; progress backups and Undo do not include or edit it. Unrevealed entries have no placeholder or count, and exports and deliberate list edits omit them. Missing catalog IDs have an honest unavailable entry. Comparison contents and inputs are blocked from replay, with no additional analytics events.

**Copy progress to another device:** open **Progress → Transfer to another device…**, create a snapshot, then scan the QR code with the phone's camera and review it in the browser. **Receive transfer…** accepts a copied link when scanning is unavailable. Applying replaces the complete normalized map profile and layout; cancel keeps current progress, Undo restores it and Redo reapplies it in this session. Tracking preferences remain independent. Codes and links contain the profile, so share them privately. Large snapshots offer the existing JSON backup fallback. [Transfer format, privacy and validation](docs/progress-transfer.md).

**Map help…** in **About & sources** gives optional setup and state guidance. [The player guide](docs/player-guide.md) explains layouts, existing-progress setup, pending Astrals, milestones, reset/history entry, backup/restore and recommendations. [Steam import compatibility](docs/save-import.md) explains supported files and the retained-ownership baseline. The app does not simulate SP balances or Stone allocation.

**Privacy:** the production map starts self-hosted Umami usage analytics and session recording unless disabled through **Privacy & tracking**, Do Not Track or Global Privacy Control. Recordings can include visible map progress. Selected saves and JSON backups are excluded and never uploaded; file inputs, search text, counters, checkpoint names/snapshots and import/restore contents are blocked from replay. Layout and tracking preferences are separate from progress. See [privacy details and operator documentation](docs/analytics.md).

## Install and reopen offline

Open **Install & offline** from the Companion navigation (use **Menu** on phones). Supporting browsers offer installation; Android, iPhone/iPad and desktop guidance covers other cases. Keep the first visit online until public app files report ready, then reopen offline with the bundled catalog, icons, fonts, licenses and core progress actions.

Updates wait until every old map window closes. Prepare with saved/exported progress, close all windows, then reopen; reloading an open window keeps its old release. Repair retains stored progress. Separate unsaved checkpoints, comparison and goals require their own recovery before update preparation or repair; a profile backup does not include them. Browser tabs and installed apps may use different storage. Export regular backups before uninstalling or clearing data. [Installation, offline recovery, updates and platform limits](docs/install-offline.md) distinguishes automated evidence from optional, unverified physical installation behavior.

## Run locally on Windows

Install **Node.js 24**. The repository includes **Yarn 4.13.0** and directs normal `yarn` commands to that pinned release. Preserve `yarn.lock` and the node-modules linker; do not add other package-manager lockfiles.

```powershell
git clone https://github.com/AustinGarrod/austingarrod-ca.git
cd austingarrod-ca/apps/idle-slayer-companion
yarn install --immutable
yarn dev
```

Open the printed URL under `/utilities/idle-slayer-companion/`. The website repository root also provides the combined Astro/Companion build and HostPapa deployment commands. If Node.js is installed but no `yarn` launcher exists, use the tracked CLI directly:

```powershell
node .yarn/releases/yarn-4.13.0.cjs install --immutable
node .yarn/releases/yarn-4.13.0.cjs dev
```

No Corepack command or global Yarn upgrade is needed. [Bundled CLI provenance and license](.yarn/releases/README.md).

## Verify a change

```powershell
yarn validate:catalog
yarn typecheck
yarn test
yarn test:tools
yarn build
yarn playwright install chromium
yarn prepare:migration
yarn test:e2e
yarn check:release
```

Browser checks use a local production preview on port 4173 by default; `yarn preview` opens one manually. For a fresh build on a free port, follow the [Windows local browser-check recipe](docs/local-browser-checks.md), including a scoped `PLAYWRIGHT_BASE_URL` and cleanup. Keep all automated checks on local or isolated CI builds. Production confirmation is deliberate manual inspection only. Catalog checks compare every native ID, coordinate, cost, predicate and icon hash with reviewed evidence; unit tests cover rules/storage and browser tests cover interactions, spoilers and responsiveness. There is no lint script.

Shared [browser fixtures and helpers](docs/browser-test-helpers.md) keep ordinary setup, responsive navigation, synthetic profiles and geometry checks consistent while scenario expectations remain explicit.

Failed local/CI browser tests retain a trace, screenshot and HTML report. CI uploads only synthetic failure diagnostics for five days. See [browser diagnostics](docs/browser-diagnostics.md) for Windows retrieval and local viewer commands.

The website CI builds and verifies one immutable combined artifact, then runs the complete desktop/mobile browser suite in four isolated shards before HostPapa deployment. The separate historical Pages deployment is retired only after the compatibility host has been verified; see the runbook. `yarn check:release` inspects actual built entries, referenced assets, byte-identical catalog, all reviewed icons, complete runtime notices and exclusion of private inputs. The website subapp artifact is `dist`; the explicitly built legacy-origin compatibility artifact is `.cache/site-migration`; a merge or deployment alone does not establish manual production behavior.

`yarn test:tools` runs the real normalization and offline wiki-parser entry points on invented fixtures using Python 3.10+ standard library only. It needs no UnityPy, installed game, saves, downloaded wiki responses or network access. Use `python` on Windows, `python3` elsewhere, or set `$env:PYTHON` to an interpreter path. [Coverage and limits](scripts/extract/README.md#synthetic-transformation-checks) supplement independent native review and real-input release gates.

## Contributor and maintenance documentation

- [Architecture and progress contracts](docs/architecture.md), [design](design.md), [accepted scope and release gates](docs/implementation-plan.md), and [agent instructions](AGENTS.md).
- [Catalog provenance and refresh](docs/data.md), [offline asset extraction](scripts/extract/README.md), [native-rule inspection](scripts/logic/README.md), and [wiki recommendation refresh](docs/wiki-recommendations.md). Keep binaries, Steam manifests, saves, raw exports and tools in ignored `.local-game/` or outside Git; never serve them. A game update requires renewed native review, complete catalog coverage and asset verification.
- [Analytics event/privacy contract and private operator reports](docs/analytics.md).
- [Third-party attribution](THIRD_PARTY_NOTICES.md) and [bundled runtime notices](public/licenses/index.html). After reviewing dependency/license changes in the [version/hash inventory](public/licenses/notices.json), run `yarn notices:refresh` to copy complete bytes, hash them and regenerate the index. `yarn notices:check` checks source artifacts without writing; build and release checks verify actual bundle coverage. [The Windows maintenance recipe](docs/runtime-notices.md) covers additions, removals, embedded dependencies, helpers and human review responsibilities. The app links the license index in **About & sources**.

Application code and extraction tools use [MIT](LICENSE). Game text, data and icons are excluded from that code license and belong to their rights holders; wiki-derived ordering and font/software notices retain their separate attribution.


Exact upgrade references can be copied or opened from expanded details. They contain only the public native ID and catalog revision in a fragment. Recipients use their own progress and spoiler choice; unavailable or missing targets receive the same generic response. An older revision is a warning to use current catalog facts, never frozen historical evidence. The address is cleaned before application startup and on live navigation even when analytics is disabled; enabled telemetry keeps its existing dirty-URL suspension rule. Reference controls are excluded from replay, no sender profile is transferred, and outgoing referrers are suppressed. The address bar stays canonical, so bookmark the generated reference link. Clipboard refusal offers selectable text.

Use **Add to reference sheet** in expanded upgrade details, then **Map options > Reference sheet** to review up to four visible upgrades. Save the exact reviewed static HTML or open it in a separate tab and use the browser Print command. The visit-only selection includes public catalog facts, native IDs, exact costs, visible AND/OR requirement excerpts, activation/retention caveats, revision and attribution. It includes no recorded progress or notes.
