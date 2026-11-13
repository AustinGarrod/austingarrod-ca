# Accepted implementation plan: Idle Slayer Companion

## Approved technical reporting

The 2026-10-25 task authorizes comprehensive browser errors, diagnostic logs and performance traces in the self-hosted GlitchTip project `garrod-house/idle-slayer-companion` at `reports.garrod.house`, independently of Umami usage controls. [reporting.md](reporting.md) defines collection, source maps, release/commit association, service retention and local verification. Existing progress, import, replay and game-data contracts remain in force. This implementation does not authorize a new site publication.

## Approved companion expansion

The first combined release includes Overview, Ascension, achievements, crafting/materials, regular quests/Village, Bestiary, and all three Divinity families. It rebrands the application and prepares the `idle-slayer-companion` repository/Pages migration while preserving old storage, map backups/QRs, public references, and installed-app identity. Current native review covers 7.3.4 / build 25810322. [companion.md](companion.md) defines the implementation contract and [site-migration.md](site-migration.md) defines rollout gates.

One canonical progress document and one bounded visit history serve actual observations across all modules. Shared craft/Village item ownership is canonical with Ascension milestones. One reviewed native save applies one full supported snapshot. Actual UA applies reviewed native cross-system effects atomically; unknown inputs produce unrecorded dependent outputs. Normal manual edits do not spend or award resources. Goals and recipe plans remain a separate bounded workspace document. Tree checkpoints/comparisons/planners stay tree-scoped; map/layout QR remains map/layout only. Hidden or unknown predicates do not disclose identities by default.

Daily/weekly quests, Armory, Minions, SP-balance simulation, Stone allocation, accounts, backend/auth, cloud saves, and automatic game-file access are deferred. The expanded native catalog, strict parsers, reset/session/storage tests, local browser privacy/responsive/offline regressions, artifact verification, and migration checks must pass before publication. Physical installation and live deployment are separate evidence claims.

## Original Ascension acceptance contract

The following sections preserve the original tree-specific requirements. Historical 7.2.0 source/RVA statements describe the original review; current receipts supersede their version bindings. Publication details are superseded by the staged migration runbook.


## Summary and current state

Build a static React and TypeScript app with Vite, Yarn and React Flow. Preserve the game's map positions in Game Layout, offer a clearer Detailed Layout (formerly Web), support title search and purchase tracking, and hide spoilers according to the game's reveal rules. Default to Game Layout and remember the user's last explicit layout selection in separate local storage.

Publish through GitHub Pages from `AustinGarrod/idle-slayer-ascension-map`. Progress stays in local storage, with JSON backup and restore.

The map, offline extraction, complete reviewed 7.2.0 catalog and local progress contract are implemented. README.md lists checks; docs/architecture.md describes behavior; docs/data.md and extraction READMEs record provenance and exact Windows refresh commands. Requirements below remain the acceptance contract. Every refresh must pass the release gate before publication.

## Data and game rules

The required source input is a copy of the Windows Steam installation folder and `appmanifest_1353300.acf`, or direct read-only access to those installed paths. Complete, verified tree data is a release requirement; the public wiki alone has layout and prerequisite gaps.

- Inspect the copied Unity assets using [UnityPy](https://github.com/K0lb3/UnityPy#monobehaviour), assessing type-tree tooling if needed. Extract native upgrade IDs, positions, connections, costs, localization, requirements, permanent flags and activation rules.
- If necessary, prepare an independent read-only exporter for the installed game. Collect data without invoking purchase, save, unlock or reset methods. Inspect serialized requirements and relevant game logic; a snapshot of one player's progress cannot establish every reveal rule.
- Supplement the extracted catalog with wiki descriptions and individual icons. Resolve conflicting wiki entries against the installed game. Bundle reviewed assets locally so the deployed app needs no wiki requests.
- Give every node a stable identity, including separate nodes sharing titles such as “Astral Key.” Store large costs as decimal strings to avoid numerical precision loss.
- Keep purchase requirements, reveal requirements, Astral activation and conditional retention separate. Preserve AND/OR relationships explicitly.
- Record game version, Steam build, source revisions and extraction provenance. Keep game binaries outside Git; commit the normalized catalog, reviewed assets and reproducible extraction tools.

Include every node belonging to the Ascension tree, including Ultra, Astral and later branches. Other progression systems appear only as milestones needed to unlock those branches.

## Map and progress behavior

- Provide fixed Game and Web layouts with mouse and touch pan/zoom, zoom controls and a return-to-start action. Game preserves extracted native coordinates with native circular icon proportions and thick straight center-vector lines; Web arranges only the visible dependency graph. Nodes cannot be rearranged. Web arrows and selected-path arrows/emphasis clarify connections, and visible neighbor buttons support direct navigation.
- Search titles and native effects without case, accent or apostrophe sensitivity; title matches retain first priority. Browse every visible result and filter available, locked, owned or awaiting-activation progress. Results include icons, native status, exact costs and stable IDs for duplicate titles; selecting one centers the map and opens its details. Availability does not infer an SP balance.
- Keep a compact, session-only recent-inspection list of up to 20 distinct stable IDs. Returning must use current visibility and never mix exploration with profile Undo; hiding an entry removes it from the trail.
- Details show title, description, cost, prerequisites, purchase/activation status and source references. Use a side panel on desktop and a compact expandable docked panel on mobile. Compact controls must preserve useful map space on small portrait and landscape screens.
- Default to hiding spoilers. Apply the game's reveal rules while retaining visible locked nodes. Filter search, milestone controls, details, connections and progress totals through the same visibility logic. The spoiler control matches the toolbar's brown and gold styling, and toggling it preserves map pan and zoom even when a selected hidden upgrade's details close.
- Provide a milestone checklist for unlocks outside the tree. Milestones represent the required item purchased or received—for example, Victor's Soul—not simply its preceding boss defeat.
- Marking a purchase fills missing prerequisites. For an unsatisfied OR requirement, let the user choose the path before applying changes. Outside milestones and Astral activation require explicit user input.
- Unmarking a prerequisite previews and clears purchases that lose their valid dependency path. Preserve retained Astral ownership from earlier Ultra Ascensions.
- Model Ultra Ascension with a previewed reset: clear repeat purchases, retain permanent upgrades and milestones, activate eligible Astral locks, and recalculate conditional retention of existing purchases. Track purchase epoch and activation separately, and allow users to record already activated Astrals when entering existing progress.
- Offer undo for progress changes and confirmation for clearing all progress. Do not simulate SP balances or Stone allocations.
- Suggest the next eligible upgrade using reviewed wiki priority ordering and recorded purchases. Keep native costs and reveal/purchase gates authoritative; hide spoilers, skip owned upgrades and label any cost fallback explicitly. Explain benefits, provide source/version attribution, and use normal preview/undo for recording a suggestion. Guide ordering must not infer SP balance, total USP, equipment or personal play style.
- Compare bounded, read-only transitive purchase/reveal routes for chosen visible targets, including consistent OR choices, shared distinct-ID SP sums, recorded ownership/activity and explicit external-item assumptions. Withhold complete totals for unsupported hidden, history, activation or bounded paths; never apply route intent to progress or stage future resets.
- Version saved data. Validate imports before replacing progress, preserve unknown IDs across catalog updates, and report storage failures without discarding the current session.
- Offer up to four deliberately named read-only normalized checkpoints in separate bounded local storage and a validated portable collection backup. Compare current/checkpoint or checkpoint/checkpoint through the live shared visible graph without mutating active progress or Undo/Redo. Keep ownership, activation, milestones and recorded UA count distinct; only exact unique current-visit history matches with native reset-plan verification establish known operations. Prior-visit/imported snapshots supply state, not authenticated gameplay history, dates or speed. Explicit deletion/replacement, external race recovery and exportable storage-failure state preserve the collection; checkpoint names/snapshots/controls remain excluded from replay and custom event payloads.
- Offer an optional four-entry saved visible-upgrade comparison reference, separately stored/exported from the actual progress profile. Compare arbitrary recorded states using exact native facts and current shared visibility; require explicit list replacement/removal and restore/recovery confirmation. Hide unrevealed identities/counts and replay-block saved contents, without goals, purchase automation, rankings, notes or new analytics payloads.
- Import the current state of a user-selected Windows Steam 7.2.0 `savedata.sav` or `backup.sav` locally. Validate transport, native version and verified fields before a spoiler-aware preview; apply only after confirmation and retain undo. Import stable-ID ownership, activation, UA count and verified milestones, discard unrelated native preferences, preserve unknown map IDs, and document the synthetic retention baseline for missing purchase history. Do not access game files automatically or authenticate to cloud storage.

## Optional single-event analysis

Forward impact analyzes one explicit currently valid native purchase or actually received/crafted/purchased visible milestone without editing recorded progress. Both purchase and reveal gates decide newly eligible options; direct native predicates, rather than map edges, identify affected alternatives. Current shared visibility governs default identities, counts and explanations. Hypothetical new reveals require explicit Show spoilers. No recursive purchases, prerequisite filling, pending-Astral flag activation, affordability, optimal-choice scores, persisted plan or new telemetry is added. The private optional dialog preserves compact Purchase keyboard order, stale-session invalidation and normal recovery controls.

## Authorized usage analytics

- Use only the self-hosted Umami website `f5c9bfd4-7ab5-4f82-a543-9357dcea1566` at `analytics.garrod.house`. Collect page views, bounded usage events, performance data and session recordings using the contract in [analytics.md](analytics.md); keep domain rules and progress storage independent.
- Start automatically after reading a separate persistent opt-out, honoring browser privacy signals. Reading failures keep tracking off. Changing the setting reloads the page; if map progress cannot be saved, offer export-and-reload, reload without backup or cancel. A failed tracking-preference write uses a disabled `#analytics=off` URL for the visit without claiming persistence. Undo, restore, clearing progress and catalog migration do not change the stored preference.
- Disclose that recordings can show visible map progress. Exclude search/file/counter inputs, import/restore previews, unrelated native data and raw error details from replay contents. Never upload saves or backups. Do not claim replay blocking prevents coarse heatmap click/scroll coordinates.
- Keep recorded URLs on the canonical map path. Strip arbitrary query/hash values and pass only bounded allowlisted campaign values. Exclude iframe recording. Never identify visitors through game saves, accounts or progress.
- Configure a private native Umami overview, conversion goals, ten-minute funnels and a five-step journey using documented event names. Verify server capabilities and saved report readbacks in Chrome; an empty report is not evidence of incoming production data. Public report sharing and deployment require their own authorization.

## Design and documentation

Follow `design.md` around the game's [official visual reference](https://idleslayer.com/img/press-kit/Editor%20Screenshot%202.png): dark brown and charcoal surfaces, gold framing, magenta connections and crisp pixel icons.

Use pixel typography for headings and readable text for descriptions. Distinguish states with symbols and outlines as well as color; support keyboard navigation, touch controls and reduced motion.

Maintain `AGENTS.md` and `README.md`, and add focused architecture and data documentation alongside implementation. Document setup, checks, extraction and refresh commands, source reconciliation, spoiler rules, storage migrations and deployment. Clearly separate application-code licensing from game-asset and wiki-text attribution.

## Validation and release

Installation and offline reopening follow [install-offline.md](install-offline.md): a standalone manifest at the Pages base, original normal/maskable icons, verified public-asset release caches, deliberate save/export preparation followed by closing all old windows and reopening, guarded app-file repair, unchanged progress/privacy storage and documented platform limits. Build/release checks bind the offline inventory and worker to the distributed bytes. Actual platform installation/launch receipts remain distinct from local browser emulation.

- Validate catalog coverage against the game export, unique IDs, references, icons, coordinates and reachable prerequisite paths.
- Test AND/OR dependencies, story gates, hidden search results, prerequisite filling, cascading removal, pending Astrals, conditional retention and repeated Ultra Ascensions.
- Test backup round trips, malformed imports, storage failures and catalog migrations.
- Use Playwright to verify search-to-node navigation, persistence, spoiler toggling and responsive interactions against the production bundle on local or isolated CI builds. Intercept analytics in those builds; never run automated suites or probes against the live production site.
- Configure CI for catalog validation, type checking, tests and build. Deploy successful `main` builds through GitHub Actions with the correct Pages base path.
- Publish only after the complete catalog and reveal/reset behavior are verified and publication is authorized. Then manually smoke-test the deployed site's assets, navigation and persistence without automated production probes or rate-limit workarounds.

V1 defaults: English, one local progress profile, spoilers hidden, no application backend or accounts, and the explicitly authorized Umami analytics with persistent opt-out. User-authorized Steam save import follows the scoped contract above.

## Windows handoff

See `README.md` for exact clone and plain `yarn` commands. Use Node.js 24 with the repository's Yarn 4.13.0 release, the committed `yarn.lock` and Yarn's `node-modules` linker. If no global launcher is installed, use `node .yarn/releases/yarn-4.13.0.cjs <command>`. Place optional copied inputs at `.local-game/Idle Slayer/` and `.local-game/appmanifest_1353300.acf`. Keep raw game inputs outside Git and outside the served site; do not infer that a public code repository authorizes redistribution of the complete game.


Public native-ID reference links are read-only navigation using each recipient's current profile and spoiler setting. Catalog context warns of a later revision without claiming a frozen record. Capture and universal URL cleanup precede rendering; live reference navigation preserves telemetry suspension on dirty buffered addresses. Sender progress and private annotations never enter the link.

Reference-sheet issue #89 adds bounded explicit public catalog selections, exact outgoing preview and local static HTML save/print. Native profile/Undo contracts remain unchanged, and default output is filtered before selection counts or content. No private annotations, ownership snapshot, connection excerpt, backend conversion or full-tree printing is included.

## Optional hypothetical UA sequences

Compare two deliberate named visit-only tree sequences in an optional dialog. Each contains up to four purchase stages, three explicit full native Ultra Ascension boundaries and four current-visible targets per stage. Require explicit OR intentions when alternatives remain, explicit hypothetical item receipts and native eligibility at every reset. Completion modes are checked before boundaries; activation may be checked in a following stage without repurchasing a pending Astral. Show retained ownership and honest repeat-purchase reacquisition. Freeze the original actual-viewer scope before route traversal, work limits and exact stage costs; incomplete proof stops later claims and withholds complete totals. Earlier edits invalidate later intentions. Plans never write actual progress, goals, history, storage, URLs or telemetry, and close on stale actual profile/catalog or recovery transitions. Imported state retains its synthetic baseline without invented chronology. This capability does not choose profitable or optimal overall UA timing or model other game systems.
