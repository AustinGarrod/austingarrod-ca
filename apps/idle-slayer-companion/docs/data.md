# Catalog, provenance and refresh

## Current reviewed build

The current catalogs target **7.3.4 / Steam build 25810322**. The native map remains 288 upgrades, 318 links and nine map milestones; every native rule field, coordinate, cost, ID, connection, and icon matched the previously reviewed tree. Current map receipts and method hashes were regenerated from the installed build. The companion registry adds 1,293 entries and 1,205 icons; [companion-native-review.md](companion-native-review.md) records extraction, registry coverage, native adapters, unsupported predicates, source IDs, and reset review.

The detailed layout/prefab narrative and RVAs below describe the original **7.2.0** review. They are historical evidence, not current method addresses. Consult current receipts for 7.3.4 bindings; the original import/method receipts are retained with `-720` filenames. No player saves were inspected for catalog extraction.

Catalog validation checks every upgrade and milestone source before rendering: a nonempty label, typed optional evidence, and an absolute HTTP(S) URL without credentials when a link is present. Native evidence-only sources remain valid. Malformed provenance enters the recoverable catalog loading error screen rather than failing when details open.

The bundled catalog is the installed **Idle Slayer 7.2.0**, Steam app **1353300**,
build **25551532**, using Unity **6000.3.14f1** and IL2CPP metadata **39**. It
contains **288 unique native upgrades**, **318 native prerequisite links**,
**nine explicit external-item milestones**, and **288 individual sprites**.
Separate Astral Key upgrades intentionally share a title and icon while retaining
different native IDs, costs and positions.

The game's `PlayerInventory.Awake` loads `Resources.LoadAll<AscensionSkill>` from
`Ascension Skills`. The serialized `ResourceManager` has exactly 288 entries
under `ascension skills/`; these match all 288 decoded `AscensionSkill` objects.
Coverage therefore comes from the installed registry, rather than a player's
progress or a wiki list. Every requirement resolves to a registered native ID.
The complete sanitized coverage record is
[`data/catalog-receipt.json`](../data/catalog-receipt.json), including native
positions, decimal costs, rule fields, catalog hash and every icon hash.

Native tree coordinates use positive Y upward. `SkillTreeManager.AutoSizeContent`
(RVA `0x3B20A0`) passes the serialized X/Y through a shared origin and center
translation to `Transform.set_localPosition`. The `level2` content hierarchy
(`RectTransform` IDs 6984 → 6597 → 7012 → 5863 → 6046 → 7059 → 5974 → 5822)
has identity rotations and no negative Y scale; the content's X/Y scale is
approximately 0.4. The root Screen Space Camera canvas (ID 5324) uses camera
2783, whose transform 2671 has unit scale and identity rotation. The native
Ascension Skill prefab (`sharedassets2.assets`, component 2484, transform 2016)
also has unit scale and identity rotation. There is no serialized reflection
that changes the tree's Y direction. Catalog and receipt positions retain raw
native coordinates; the React Flow renderer converts only display coordinates
with `screenY = -nativeY` because browser Y increases downward.

The extractor reads the Steam manifest only for app and build ID. It does not
export installation paths, account IDs, play timestamps or the manifest text.
Input hashes identify the exact game assets and native code used for this
review. Catalog extraction neither inspected nor imported player saves. The
separate user-selected progress importer is documented in [save-import.md](save-import.md).
All catalog tooling ran
offline without launching the game or invoking its methods.

## Native UI presentation

Read-only inspection of the same installed 7.2.0 / build 25551532 assets also establishes Game's visual proportions. In `sharedassets2.assets`, Ascension Skill RectTransform 2016 and Container RectTransform 1997 have 100×100 bounds; centered Skill RectTransform 1845 is 64×64. Background Image 2480 references sprite 827 (`circle`), and Legendary Outline Image 2214 references sprite 874 (`circle-outline`). Both 32×32 sprites have a pixel-stepped circular silhouette. The prefab has no title label. The app recreates the circular frame with CSS and retains the already reviewed upgrade icons; no additional raw game assets are bundled.

AscensionSkillObject component 2484 supplies `lineSize=12`. Its native `Start` implementation calculates distance and rotation from node center differences, places the line at its own center and moves it behind the icons. Game routes preserve that vector, with endpoints clipped to the circle so selected arrowheads remain outside the icon. This replaces cardinal-side attachment without changing any catalog position. The native Colors component 7880 in `level2` supplies ordinary unowned grey `#7d7d7d` and owned-prerequisite purple `#ff00be`. The app uses these two ownership cues and adds accessible selection highlighting; it does not claim to reproduce every native special-category color or native pixel border exactly.

The evidence was inspected offline from installed assets and reconstructed `AscensionSkillObject.Start` instructions, without launching the game, invoking native methods or reading player saves. Node dimensions, icon proportions, fixed centers and straight connection angles have independent browser regression coverage. Presentation is separate from the catalog receipt and game-rule semantics.

## Native rules and their representation

[`scripts/logic/README.md`](../scripts/logic/README.md) records native method
interpretation. [`native-method-receipt.json`](../scripts/logic/native-method-receipt.json)
records immutable native method RVAs and body hashes. Hashes identify the
evidence; they do not replace the semantic review of the methods.

The catalog keeps purchase and reveal predicates separate. Prerequisites are
`active` requirements with native ALL/ANY behavior. Craftable item gates require
the actual item crafted or received. `requiredUpgrade` requires the actual
external upgrade purchased or received; Victor's Soul means Victor's Soul, not
a preceding boss defeat. `requiredAscensionUpgrade` requires that tree upgrade
active. Nodes requiring a prior Ultra Ascension use an explicit epoch gate.
Native ANY purchase success returns before the Ultra Ascension gate; the
normalizer preserves that detail rather than imposing a guessed universal gate.

An Astral node or node with an Astral ancestor is visible once Astral Slayer is
owned, or once the node itself is already owned, subject to its external reveal
gates. Astral Slayer itself requires a prior Ultra Ascension. Native ordinary
prerequisite ownership does not by itself define reveal behavior. The app's one
visibility result governs map nodes, connections, search, details and totals.

All `isAstral` nodes retain ownership across Ultra Ascensions. Native legendary
presentation is not a retention flag. Astral locks activate after an Ultra
Ascension; ownership, purchase epoch and activation remain separate. Native
conditional exceptions retain an already purchased target when the source is
active: Astral Blessing → Stones of Time, Eternal Rage → Rage Mode, Land Lord →
Village Key, and Multiverse → Portal Dominum. These exceptions do not award an
unowned upgrade automatically.

Milestone checklist visibility is an app policy, not an extracted game method:
show an item when a consuming upgrade passes its other reveal gates and its
ordinary purchase prerequisites, or is already owned. Remove that same item
from the control's own predicate. Aggregate multiple consumers with OR. This
lets users enter existing progress without a self-deadlock while keeping
untouched later branches out of the checklist. When an isolated branch entry
node has no ordinary tree prerequisites, only an already owned consuming node
exposes its item control. **Show spoilers** is the explicit first-entry route
for those milestones. This conservative policy avoids inventing an earlier
story event or an Ultra Ascension gate absent from the native reveal logic.

The catalog retains the legacy `grants` field name for these four conditional-retention rules. It represents preservation of existing purchases, never a separate ownership state or an award of an absent target.

## English descriptions and sprites

Titles and text originate in the game's `en-US` localization TextAsset.
Descriptions format native templates with serialized effect values and
referenced native names, then convert Unity text markup to plain text. Fourteen
descriptions omit player-derived current totals or changing minion statistics,
show their static base effect and explicitly label the variation. The app does
not simulate those other systems or read player data to fill the values.

Sprites are cropped by UnityPy from the native referenced Sprite objects. All
288 individual sprites were checked in six numbered contact sheets. Native
dimensions are 16 × 16, with one 17 × 16 sprite. Pixel bounds and aspect ratios
are preserved, and images are rendered with nearest-neighbor scaling. The
receipt records each reviewed sprite's native object reference and SHA-256.
No wiki data or wiki images were needed for this build.

## Reproduce and refresh on Windows

Start with the [ordered catalog-refresh runbook](catalog-refresh.md). It distinguishes unchanged-build reproduction from new-build investigation and coordinates native, sprite, recommendation, save-format and release evidence before promotion. The commands below remain the detailed catalog/receipt promotion reference.

Follow [`scripts/extract/README.md`](../scripts/extract/README.md) for the exact
Python environment, asset extraction, normalization and sprite review commands.
Run the [IL2CPP pipeline](../scripts/logic/README.md) first to generate private
dummy assemblies. UnityPy 1.25.4 reads the installed assets; direct
TypeTreeGeneratorAPI 0.0.10 IL2CPP loading fails on metadata 39, so the pipeline
uses the supported Cpp2IL pre-release dummy assemblies.

The output stays under `.local-game/`. A new game build requires a fresh native
rule review; `normalize_catalog.py` rejects any build other than the one reviewed
above. Review native coverage, dependency paths, coordinates and all sprites,
then promote only the normalized catalog and individual reviewed sprites:

```powershell
Copy-Item -LiteralPath .local-game\catalog-candidate.json -Destination public\catalog.json
Get-ChildItem -LiteralPath .local-game\asset-export\icons -Filter *.png | Copy-Item -Destination public\assets\upgrades
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\write_coverage_receipt.py --export .local-game\asset-export\asset-export.json --catalog public\catalog.json --sprite-review .local-game\sprite-review\sprite-review-inventory.json --icons public\assets\upgrades --output data\catalog-receipt.json
yarn typecheck
yarn build
```

Also run the repository's catalog, rule, storage and production-browser checks
documented in the root README. A matching receipt is a deterministic CI check
against the reviewed extraction, rather than a live comparison with a game
installation. Unknown native IDs from prior profiles must remain in backups and
local progress when the catalog changes. Publishing remains subject to the
implementation plan's complete catalog, rule and browser verification gate.

After building, `yarn check:release` validates the distributable itself. Its
`dist/catalog.json` must match both the reviewed source bytes and catalog receipt
hash; every catalog icon must be present, nonempty and match the corresponding
native ID's reviewed sprite hash. The application HTML must contain its root
mount and reference local built entries covered by the runtime notice receipt.
Stylesheets, their imports and packaged font/asset references must resolve inside
the Pages artifact. The recursive artifact scan rejects links, empty files and
prohibited private inputs before reading deployed content. These checks establish
artifact completeness and receipt consistency; browser checks and native semantic
review remain separate release requirements.

## Content ownership and attribution

Application source code and extraction tools are separate from game content.
The game's icons, titles and localization are Idle Slayer content by **Pablo
Leban**, extracted from the installed build identified above. Refer to the
[official website](https://idleslayer.com/) and
[Steam listing](https://store.steampowered.com/app/1353300/Idle_Slayer/).
This fan tool is not an official Idle Slayer product, and the application-code
license does not grant rights to game assets or text. No game binaries, raw
asset exports, dummy assemblies, saves or Steam manifests are distributed.

Extraction tooling sources are [UnityPy](https://github.com/K0lb3/UnityPy),
[TypeTreeGenerator](https://github.com/K0lb3/TypeTreeGenerator), and
[Cpp2IL](https://github.com/SamboyCoding/Cpp2IL). Their own licenses apply to
those tools. No wiki text or icons are bundled, so no wiki revision is claimed
as a source for this catalog.
