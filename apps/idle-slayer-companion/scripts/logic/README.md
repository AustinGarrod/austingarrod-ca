# Offline native-rule evidence

## Current and legacy method evidence

`native-method-receipt.json` now binds reviewed **7.3.4 / build 25810322** map methods. `native-method-receipt-720.json` preserves the original 7.2.0 bodies. Companion-specific bodies are pinned separately in `data/companion-native-method-receipt.json`; [companion-native-review.md](../../docs/companion-native-review.md) explains their interpretation. The RVA narrative below is historical 7.2.0 review evidence. Use an isolated `-OutputRoot` for each Cpp2IL refresh and do not overwrite prior evidence.

This folder contains reproducible tooling and a sanitized receipt for the read-only inspection of Steam build **25551532**, game **7.2.0**, Unity **6000.3.14f1**, IL2CPP metadata **39**. The installed game's native code and serialized assets are the source for rule evaluation. No game or player-save method was invoked.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/logic/extract-logic.ps1 -GamePath 'F:\SteamLibrary\steamapps\common\Idle Slayer'
```

The pinned [Cpp2IL release](https://github.com/SamboyCoding/Cpp2IL/releases/tag/2022.1.0-pre-release.21) is downloaded into ignored `.local-game/logic/tools/` and checked against the recorded SHA-256. Cpp2IL reconstructs dummy assemblies, mapped declarations and disassembly into that ignored directory. It opens native files as data; it does not start Idle Slayer or load its methods into the game. Official Il2CppDumper 6.7.46 was assessed and rejected metadata version 39. Cpp2IL supports this version and mapped 80,517 native methods.

`inspect-methods.py` indexes 27 relevant methods and checks their original PE byte ranges. The local `.local-game/logic/evidence/receipt.json` records native-input hashes, RVA, body length and body SHA-256, with raw excerpts alongside it. `native-method-receipt.json` contains only sanitized provenance and hashes. A successful extractor run alone does not verify semantics; the interpretations below were reviewed against both disassembly and the field offsets in generated declarations.

## Reviewed tree rules

The identities below are native `DataObject.id` values, not titles or asset file names. Purchase, reveal and activation use different native state.

| Method | RVA | Reviewed behavior |
| --- | --- | --- |
| `AscensionSkill.Init` | `0x3899A0` | Native-ID preference at least 1 means owned; at least 2 means Astral Lock activated. It also calculates the recursive Astral ancestor flag. |
| `AscensionSkill.HasAstralAncestor` | `0x389910` | True when any prerequisite is Astral or recursively has an Astral ancestor. |
| `AscensionSkill.IsActive` | `0x389AA0` | Owned, except an Astral with an Astral Lock is inactive until the lock is activated. |
| `AscensionSkill.CanBeBought` | `0x389010` | Every required craftable item must be active. An empty prerequisite array succeeds subject to the Ultra Ascension flag. `mandatoryRequirements` uses every active prerequisite; otherwise any active prerequisite succeeds. |
| `AscensionSkillObject.CheckRequirements` | `0x2D4850` | Reveals only when the required external Upgrade is bought, the required Ascension Upgrade is active, and the Ultra/Astral reveal predicate succeeds. Ordinary connection prerequisites do not govern reveal. |
| `AscensionSkillObject.CheckUltraOrAstral` | `0x2D4B40` | Astral Slayer itself requires a previous Ultra Ascension. Other Astrals and nodes with an Astral ancestor require Astral Slayer ownership or their own ownership. Remaining nodes with `ultraAscensionsRequired` require a previous Ultra Ascension. |
| `PermanentCraftableItem.IsActive` | `0x3A4090` | Tests the item's received/crafted flag. It does not test visibility, crafting prerequisites or the preceding boss/event. |
| `AscensionManager+<>c__DisplayClass51_0.<Ascend>b__0` | `0x2E1700` | Ultra Ascension retains Astrals, activates owned pending Astral Locks, and clears other tree purchases except the conditional retention pairs below. |
| `PlayerInventory.Awake` | `0x4D3600` | Loads `Resources.LoadAll<AscensionSkill>("Ascension Skills")` into the tree registry. The asset extraction checks all 288 registered assets against this resource path. |
| `SkillTreeManager.AutoSizeContent` | `0x3B20A0` | Assigns raw skill X/Y plus a shared base offset minus a shared center directly to `Transform.localPosition`, preserving Unity's positive-up Y direction. |

The native OR loop returns immediately when it finds an active prerequisite. That return precedes the `ultraAscensionsRequired` check. Preserve this behavior: for a nonempty OR list, do not add a separate Ultra Ascension purchase requirement. The reveal predicate still applies. For an empty list or an AND list, apply the Ultra Ascension purchase flag when set.

The AND reveal predicates do not bypass an external Upgrade or a required Ascension Upgrade merely because the node is already owned. The own-ownership exception exists only inside the Astral branch of the reveal predicate. External milestones in the app record the required item received/crafted or Upgrade bought explicitly. How the manual-entry controls expose those milestones is app UI policy, not an additional native unlock rule.

## Native coordinate convention

`AutoSizeContent` reads `AscensionSkill.position` at offsets `0x70`/`0x74` and applies the same translation to every node; it does not negate Y. The serialized Content/Viewport/SkillTree ancestor chain has no negative Y scale or rotated frame. Its screen-space-camera Canvas uses a unit-scale, identity-rotation orthographic camera. The game therefore displays larger native Y values above smaller values. Preserve the raw catalog coordinates and convert only the renderer position to `{ x: native.x, y: -native.y }` for React Flow's positive-down screen coordinates. Apply the same conversion to camera targets and connection placement. [The detailed layout evidence](../../docs/native-rules.md#native-coordinate-convention) includes the method hash and serialized hierarchy references.

## Ultra Ascension retention

`isAstral` retains tree ownership. `isLegendary` alone does not. An owned `isAstral && astralLock` node activates on the next Ultra Ascension; its ownership survives that and subsequent resets. The native reset loop has four additional retention exceptions:

| Active source | Native source ID | Existing purchase retained | Native target ID |
| --- | --- | --- | --- |
| Astral Blessing | `le7ke3q2jdjdmyhtzpgs` | Stones of Time | `b68jn6acu00oiesllac3` |
| Eternal Rage | `gmhcwrfgzcjt6j95g1lr` | Rage Mode | `04u7349eha9vacsofx7l` |
| Landlord | `q1ohpayhstjat193jka8` | Village Key | `vhxvp4q2i077pymnfhz0` |
| Multiverse | `fxvp2gcw4zbve2cm35z4` | Portal Dominum | `utbtanttthwl6yjkv4yb` |

These preserve existing ownership; they do not purchase absent targets. The native resource registry indices are 5→204, 18→202, 24→206 and 29→236 respectively. Every source is Astral and occurs earlier than its target, so activating pending sources before evaluating these retention exceptions produces the same result for this verified build. Keep the source condition as **active**, not merely owned.

The app records reset epochs and activation separately. It deliberately does not simulate the native SP/USP balance, Dark Divinity overrides, Stone allocation, minion state, quests or gameplay reset effects outside the Ascension-tree contract. The game does not implement manual removal/undo; the app's cascade rules must preserve valid alternate paths and previously retained ownership using the inspected native purchase predicates.

## Refresh gate

Hash changes require reviewing the affected method and updating the receipt, normalized predicates and tests together. Do not infer new rules from names, wiki progress screenshots or a successful dummy-assembly run. Keep dummy DLLs, disassembly, tools, Unity assets and local metadata in `.local-game/`, never browser imports or production output.

Run the independent exhaustive comparison after normalization or public catalog promotion:

```powershell
python scripts/logic/validate_catalog_rules.py --export .local-game/asset-export/asset-export.json --catalog public/catalog.json --receipt data/native-rule-validation.json
yarn test src/domain/native-rules.test.ts
```

The comparison receipt contains hashes and counts only. It checks the reviewed control flow against all 288 normalized nodes in 10,574 boolean cases without importing the normalizer. [The native-rule documentation](../../docs/native-rules.md) also records app-only milestone presentation and manual-removal policy.
