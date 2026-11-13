# Companion architecture and player contract

Idle Slayer Companion is a static React/TypeScript application. Its seven routes are the Overview root plus `ascension/`, `achievements/`, `crafting/`, `quests/`, `bestiary/`, and `divinities/`. Every route has a built HTML entry for direct links and offline reopening. Navigation does not reload the application or discard the mounted Ascension canvas.

The Companion navigation owns **Privacy & tracking**, **About & sources**, and **Install & offline**. **Map help…** is available from About & sources. The embedded map omits its former app-wide footer and duplicate app-wide menu actions. Ascension-specific progress, checkpoint, comparison, transfer and planning controls remain in the map. **Review Ascension references** opens the actual reference collections; it does not merely navigate to an already-open route. The shell uses the map's guarded action controller for help, reference recovery and installation, preserving purchase/transfer previews and save-before-reload protections. Its shared Undo/Redo also uses that controller while the map is mounted, retaining transfer layout restoration, pending-preview invalidation, feedback and camera handling across sections. On short phone map views, Undo/Redo remain in Map options while the ordinary status strip is hidden to preserve the inspection canvas. Recovery controls stay visible.

## Actual observations

`CompanionProgress` contains the existing Ascension profile and seven typed record collections: achievement, craft, material, quest, village, enemy, and divinity. Each collection has an explicit tracked state. A missing field means **unrecorded**, not false or zero. Decimal counters remain strings; calculations use integer arithmetic. Observation timestamps describe recording in this utility, not authenticated gameplay dates.

The new storage key is `idle-slayer-companion.progress.v1`. Its device wrapper contains a validated progress document and the exact legacy profile baseline. Startup reads legacy map data without writing, deleting, or mirroring it. The first deliberate change writes the new envelope under the original profile write lock. Reads and writes check both old and new baselines; a stale older tab cannot silently overwrite the Companion. When a changed legacy copy is detected, Backup offers an optional normalized legacy-map export before acknowledgement, preserving unknown IDs without merging or rewriting that old copy. Invalid new storage never falls back to an older map profile. Failed saving leaves the visit usable and exportable.

The session has one bounded 20-action Undo/Redo history across all actual observations. Its map adapter projects the existing profile/history APIs without leaking companion-only item records into old map JSON or QR. Known shared craft/Village completion uses the same milestone ownership fact as Ascension. Removing that fact previews dependent Ascension removals using the existing native rules, preserves valid alternate paths and retained purchases, and applies the correction with one Undo. The map catalog must be available before removing recorded item ownership while Ascension purchases exist. Recording observations never consumes stock or infers an earlier boss/NPC event. Map-only operations preserve companion observations and facts outside their reviewed map scope.

## Rules and projections

Both catalogs load and validate independently. An unavailable map does not disable manual achievement tracking; an unavailable companion catalog does not disable the tree. Native import and actual reset require both reviewed catalogs. Retrying or repairing app files uses the same save/export/cancel protection as a privacy reload.

Companion requirements evaluate to met, unmet, or unknown. Unknown unsupported game conditions stay hidden by default. The shared visible projection governs module cards, search, counts, detail references, goal labels, shopping lists, and operation previews. Turning on spoilers permits reference browsing but does not make an unknown purchase gate met. Achievement names follow the native locked-title policy until earned; platform labels refer to native registration flags. Only reviewed UA achievement counters claim numeric progress. Four enemies excluded by the native Bestiary remain conservatively hidden.

Divinity selection is recorded separately from effective activity. Activity depends on the native global activation gate; Dark availability also has reviewed item/upgrade and boss gates. Bestiary mastery sums the exact native evolution family; it remains unknown until every required count is recorded. Recipes retain static material, coin, and Divinity Point costs. Shopping lists aggregate only visible planned recipes with exact integer arithmetic, distinguish unknown inventory from a deficit, and never spend resources.

## Imports and actual resets

The global importer decodes a selected save once, validates the versioned adapter, and previews all supported changes against the current visible universe. A confirmed 7.3.4 import is one replacement and one Undo action. A legacy 7.2.0 import replaces only reviewed map fields and keeps companion modules. Neither imports unrelated native preferences. Inputs are transient and never uploaded or stored as raw saves. Native purchase history is absent, so the reviewed synthetic retained-ownership baseline remains explicit.

The actual Ultra Ascension button uses `planCompanionUltraAscension`, combining the native tree plan with reviewed quest/shop reset and retention rules, automatic quest rewards, item facts, UA achievement updates, and conditional counters. All effects apply atomically. A missing input clears dependent outputs to unrecorded instead of making up a count. Ordinary manual completion/claim/craft edits do not run these side effects. Tree-only hypothetical plans stay separate and never simulate the other modules.

Checkpoint operation context is still tree-only. A Companion reset may explain a tree transition only through visit-local proof of the full reviewed native transition plus an exact projected tree-plan match. Imports, portable snapshots, names, and a higher UA count cannot establish reset history.

## Intentions and references

The independent `idle-slayer-companion.workspace.v1` document contains at most 20 typed goals and 100 recipe quantities. It migrates old map goals without startup writes and checks its exact old/new baselines under coordinated writing. Recovery requires a reviewed draft and current version; a later write invalidates that draft. Goals and plans never enter progress Undo and survive save imports and actual resets. They have their own JSON export/restore.

Four named Ascension checkpoints and the four-entry saved upgrade comparison retain their existing separate formats, storage, recovery, and spoiler rules. They are not full companion backups. Legacy map JSON and map/layout QR readers remain supported and explicitly map-scoped.

## Privacy and limits

New module contents and all global operation/recovery dialogs are replay-blocked. Existing visible map progress can appear in recordings as disclosed. No new telemetry provider or progress payload was added. Tracking settings, layout, and installed-app caches remain independent from progress and intentions.

Daily/weekly quests, Armory, Minions, SP-balance simulation, Stone allocation, accounts, application backend, cloud authentication, cloud-save downloads, and automatic game-file access are outside this release. Unsupported NPC/task conditions remain unknown. Physical device installation and live production behavior require separate evidence. Native extraction details and refresh commands are in [companion-native-review.md](companion-native-review.md).
