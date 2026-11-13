# Companion native evidence: Windows Steam 7.3.4

The current review reads **Idle Slayer 7.3.4 / Steam build 25810322**, Unity
**6000.3.14f1**, IL2CPP metadata **39**. It does not launch the game, invoke game
methods, inspect player saves, or modify the installation. Only selected native
definitions, English text, individual sprites, identities and hash receipts are
promoted. Installation paths, manifest contents, raw assets and reconstructed
code remain outside the application and Git.

## Coverage

`public/companion-catalog.json` is generated from these complete native registries:

| Native definitions | Count | Companion representation |
| --- | ---: | --- |
| Achievement | 662 | In-game catalog, native target/type and platform flags |
| PermanentCraftableItem | 73 | Owned permanent items and base recipes |
| TemporaryCraftableItem | 33 | Base temporary recipes; no guessed craft history |
| Drop | 25 | Discovered materials and recorded quantities |
| Quest | 229 | 214 regular quests; 15 map-event quests excluded |
| Enemy | 82 | Native variants, evolution families and mastery thresholds |
| Divinity | 71 | Normal, Dark and Elemental categories |
| UpgradableBuilding | 8 | Village construction completion and material requirements |
| BoardStepSO / BoardSubStepSO | 62 / 16 | Complete Village board reference tasks |

The companion also exposes the **31 actual quest-pack upgrades** referenced by
regular quests and **16 actual unlock upgrades** referenced by crafting or
permanent quest rewards. These use native IDs and observed purchase state; they
are not newly invented milestones. The same ID is reused when another system
requires the same item.

Every ordinary definition resolves through ResourceManager. The sole native
BoardDefinitionSO references all 62 board steps; their substep references cover
all 16 substeps. Board assets lack DataObject IDs, so application IDs use their
serialized editor GUIDs, retaining a subtask suffix where present. Titles and
native asset path numbers are not identities.

`data/companion-catalog-receipt.json` records exact public identities, source
registry mappings, input hashes, all **1,205 sprite hashes**, and the catalog
hash. All eleven numbered nearest-neighbor sprite sheets were inspected. Crops
retain native pixel bounds, transparency, aspect ratio and orientation. No wiki
images or text are used for the new companion modules.

Generated Enemy type trees omit the inherited fields of generic
AssetReferenceT. The extractor supplies the three strings declared with native
SerializeField attributes: AssetGUID, SubObjectName and SubObjectType. Every Enemy
record must then deserialize to its exact byte length. Village board managed
references use the separately bounded registry-version-two reader; unknown
condition types, missing references, duplicate references and trailing bytes fail
extraction. Synthetic tests exercise these readers without Unity packages or game
inputs.

## Save reads and observation semantics

`data/companion-native-rules.json` is the compile-time allowlist for the reviewed
version. `data/companion-native-method-receipt.json` pins 47 inspected method
bodies. A body hash identifies evidence; it is not an automatic semantic proof.

| Native key / data array | Reviewed interpretation |
| --- | --- |
| Achievement ID / IntData | Exactly 1 means earned |
| PermanentCraftableItem ID / IntData | Exactly 1 means crafted or received |
| Regular Quest ID / IntData | Nonnegative value is current progress; negative value means claimed and current progress equals the native goal |
| Quest-pack / unlock Upgrade ID / IntData | Exactly 1 means purchased or received |
| Drop ID / StringData | Absent or empty means undiscovered with zero stock; a nonempty numeric string means discovered, including stock zero |
| Enemy ID / StringData | Numeric per-variant kill count; not a family-total value |
| Divinity ID / StringData | Hash-delimited values: first component is a new-item flag; second component equal to 1 is stored selection |
| UpgradableBuilding ID / StringData | Hash-delimited values: first component equal to 1 is built; later material-deposit fields are not imported |

No native preference is imported merely because its key exists. Board task
completion that depends on unreviewed NPC dialog, Armory, boss or interaction
state remains unknown unless explicitly recorded. Missing module observations
in a companion backup remain unknown, rather than being treated as zero or
incomplete. Native-save defaults are applied only within the versioned adapter.
Temporary-item timers, favorites, unlock dates and missing purchase history are
not reconstructed.

The seven Ultra Ascension achievement targets use the reviewed Ultra Ascensions
counter. Other achievement target values do not authorize displaying an invented
numeric counter. Their earned flags remain supported.

Current FileBasedPrefs.GetCurrentSaveBytes, GetSaveFile, DataScrambler, GetInt,
GetString, CreateNewSaveFile and the save-model declarations have the same
normalized read/transport control flow as the reviewed 7.2.0 version. The
write-only WriteToSaveFile body changed; inspection retains symmetric XOR over
UTF-16 code units and the same UTF-8 transport/model. The fresh save receipt pins
the current ranges and hashes. The older review is retained in
`data/save-import-receipt-720.json` for the legacy map-only adapter.

## Visibility, requirements and costs

Native AchievementManager uses a locked icon and generic title until an
achievement is earned. The companion conservatively reveals its name only after
earned state, or with the explicit spoiler option. Platform flags distinguish
in-game availability from Steam, iOS Game Center and Google Play registration.
This applies to all 662 identities: `secret: true` is the normalized identity
policy, rather than a serialized native secret-achievement flag.
`ShowAchievement` ISIL 57–69 tests `Achievement.unlocked` at offset `0x58`
before selecting its title or `popup_achievement_info_locked`; ISIL 76–84
similarly selects the native or locked icon. The native popup still calls
`GetDescription` at ISIL 85–87 for a locked entry. The companion's shared
visibility projection also withholds that description, rather than exposing
hidden identities through a separate search or details path.

Craft reveal checks native material discovery, ANDed active Ascension gates,
required crafted items, required upgrades, and required character states. The
companion also keeps an explicitly owned item reachable as a tracking policy;
this differs from the native crafting tab, which removes already-crafted items.
Untracked character conditions are unknown. Purchase prerequisites remain
separate from material stock; recording completion never spends materials.
Recipes show static serialized requirements. Divinity Point charges are retained
separately from material quantities and coin costs, including Village buildings.

Regular quest reveal depends on its actual native bundle upgrade and any native
character requirement. A quest completing does not purchase its reward upgrade.
Map-event and collaboration quests do not silently enter the regular quest list.

Divinity selection and effect activity differ. Native effect activity also
requires active Divinities or Blessing of Cronus; the session recomputes this
separately. Dark Divinity availability requires the actual Book of Death Pact.
Boss Dark Divinities additionally require active Sacred Tome of Death Pact and
the corresponding boss defeat; an untracked boss result stays unknown.
Individual required Ascension upgrades must be active. All normal, Dark and
Elemental costs use **Divinity Points**; Elemental is not a separate currency.

An enemy's mastery count is the sum of its entire native evolution family:
GetTotalKillCount first follows evolutionBackward to the base, then sums the
base and every evolutionForward variant. `masteryCountIds` records that exact
ordered set. Tier one requires a positive total. The next three base thresholds
are 50,000, 100,000 and 250,000. Giants divide them by ten; an explicit custom
divider instead uses max(1, native divider), followed by native ceiling. Four
native enemies are marked hideInBestiary; their catalog category says they are
excluded, and their reveal stays unknown. Their existence does not inflate
visible native Bestiary progress.

## Ascension compatibility review

The fresh native Ascension registry still has **288 upgrades, 318 connections,
nine external milestones and 288 sprites**. Every native ID, named-skill mapping,
position, cost, purchase/reveal field, retention flag, activation flag, English
title, description template and description parameter matches 7.2.0 after
discarding changed Unity object references. All 288 icon PNGs are byte-identical
to their previously reviewed versions.

The normalized native Init, HasAstralAncestor, CanBeBought, IsActive,
CheckRequirements and CheckUltraOrAstral control flow is unchanged. Inspection of
the changed complete reset callback confirms that the Ascension-tree loop and
four conditional retention pairs are unchanged. Added branches affect native
event upgrades and event quests, plus null guards; they do not change tree
retention. The independent current-build rule comparison passes all **10,574
boolean cases**, including tree retention and activation mappings.

The recommendation artifact rebinds its catalog hash/revision only. Its existing
280 reviewed native priorities and actual wiki source version/revision remain
unchanged. The application does not claim that the older guide was republished
for 7.3.4. The prior native method receipt remains available as
`scripts/logic/native-method-receipt-720.json`.

## Reproduce on Windows

Use Node.js 24, pinned Yarn 4.13.0 and the extraction venv described in
`scripts/extract/README.md`. Preserve old private evidence by using a separate
output root for this build:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/logic/extract-logic.ps1 -GamePath 'F:\SteamLibrary\steamapps\common\Idle Slayer' -OutputRoot '.local-game\companion-734\logic'
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\extract_companion.py --game-root 'F:\SteamLibrary\steamapps\common\Idle Slayer' --manifest 'F:\SteamLibrary\steamapps\appmanifest_1353300.acf' --dummy-assemblies .local-game\companion-734\logic\dummy --declarations .local-game\companion-734\logic\cs\DiffableCs\Assembly-CSharp --output .local-game\companion-734\companion
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\review_companion_icons.py --catalog .local-game\companion-734\companion\companion-catalog.json --icons .local-game\companion-734\companion\icons --output .local-game\companion-734\sprite-review
```

Inspect all contact sheets, then mark the private review inventory complete with
the evidence. Rerun extraction with
`--sprite-review .local-game\companion-734\sprite-review\sprite-review-inventory.json`.
Promote only the final catalog, referenced individual sprites, native import
allowlist and sanitized receipt. Run `yarn test:tools`, catalog validation,
typecheck, application tests, build and release checks. Local/CI validation and
native static review do not prove behavior on an installed physical PWA.
