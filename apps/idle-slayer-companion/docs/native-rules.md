# Reviewed native Ascension rules

The catalog uses the installed Steam **build 25551532**, Idle Slayer **7.2.0**, Unity **6000.3.14f1**, IL2CPP metadata **39**. Native IDs, flags and references come from the complete 288-entry `Ascension Skills` resource registry. Native methods were inspected offline as PE bytes and IL2CPP metadata; no game process, player save, purchase, unlock or reset method was invoked.

The native assembly SHA-256 is `89b90f5bcd8544cd2388460bd3df31481bc8e9cce562aaaa540b85322cb216e7`; metadata SHA-256 is `379bcc74503d616b88b404884c7bcfaaf6d496e1ecdbdef7bdec21e5ccc2911b`. [The sanitized native-method receipt](../scripts/logic/native-method-receipt.json) records all 27 selected signatures, RVAs, byte lengths and individual body hashes. RVAs below are relative to PE image base `0x180000000`.

The offline tool is [Cpp2IL 2022.1.0-pre-release.21](https://github.com/SamboyCoding/Cpp2IL/releases/tag/2022.1.0-pre-release.21), revision `58fc404ac503f4e512055cafc48c03088fc6e224`. Its pinned Windows executable SHA-256 is `663fb432433b4371fd1ee0ebc321a8fff2a9aac5ac4230c843f9e03ddee4e04c`. See [the extraction command and tooling notes](../scripts/logic/README.md). Dummy assemblies, declaration dumps and disassembly stay in ignored `.local-game/logic/`.

## Native coordinate convention

`SkillTreeManager.AutoSizeContent` (`0x3B20A0`, byte length `0x99C`, body SHA-256 `f89b509a12b8d60caac1b37c9a664e847a1942d5072d65d6d13f442717c4966a`) reads the skill's serialized `position.x`/`position.y` at field offsets `0x70`/`0x74`. It adds `skillsBasePosition.x`/`.y` at manager offsets `0x20`/`0x24`, subtracts a shared content center and assigns the resulting `(x, y, 0)` directly to `Transform.localPosition`. The native method does not negate Y; pairwise coordinate differences preserve the serialized signs.

The serialized `level2` hierarchy confirms that there is no compensating reflection. `SkillTreeManager#9007` refers to `ScrollRect#8713`, whose content is `RectTransform#6984`. Its ancestor chain is `6984 → 6597 → 7012 → 5863 → 6046 → 7059 → 5974 → 5822`: every rotation is the identity quaternion. Content's Y scale is approximately `0.4`; the intermediate ancestors have Y scale `1`. The UIManager root's initial scale is `0` while collapsed and contains no negative Y scale. The shared `AscensionSkillObject#2484` prefab's `RectTransform#2016` in `sharedassets2.assets` has unit scale and identity rotation. UIManager's `Canvas#5324` uses Screen Space Camera mode with `Camera#2783`; that orthographic camera's `Transform#2671` also has unit scale and identity rotation.

Unity's positive Y is up, as its [version 6000.3 `Vector3.up` definition](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Vector3-up.html) confirms. For example, Soul Gatherer Bundle is at native `(-350, 100)` and Portals at `(0, 250)`: Portals appears 150 native units above it. Passing these coordinates straight into React Flow's positive-down display would mirror the native arrangement vertically.

The catalog retains its exact raw `position` fields. Rendering converts them to `{ x: native.x, y: -native.y }`, with any pan translation applied uniformly. Camera centering and connection handle selection use that same display coordinate conversion. This preserves native arrangement without rewriting the source data.

## Ownership and activation

`AscensionSkill.Init` (`0x3899A0`) reads the native-ID preference: values at least 1 mean owned, and values at least 2 mean its Astral Lock has activated. `IsUnlocked` (`0x389AF0`) reads ownership. `IsActive` (`0x389AA0`) requires ownership and returns false for an Astral with a pending Astral Lock. Thus a bought Astral can remain inactive until a later Ultra Ascension.

The app stores ownership, purchase epoch and activation separately. Its `ultra-ascended` predicate represents the native Ultra Ascension counter being greater than zero as `profile.epoch > 0`. The epoch counts explicit resets in the manual profile rather than reading native player progress.

## Purchase predicate

`AscensionSkill.CanBeBought` (`0x389010`) first checks every serialized craftable-item requirement. All must be active. The required tree nodes then use their **active** state, with `mandatoryRequirements` selecting AND versus OR:

- An empty tree prerequisite array succeeds, subject to `ultraAscensionsRequired` when set.
- AND requires all prerequisites active and applies the Ultra Ascension flag after the loop.
- A nonempty OR returns true immediately upon the first active prerequisite. That return occurs before the final Ultra Ascension check. The normalized OR purchase predicate therefore omits a separate Ultra condition; its independent reveal condition still applies.

The actual tree's craftable requirements are `PermanentCraftableItem` objects. `PermanentCraftableItem.IsActive` (`0x3A4090`) reads the received/crafted flag. `AdditionalInit` (`0x3A37B0`) initializes that flag from the item's preference. External `Upgrade` reveal requirements use its bought flag. App milestones record those exact items received/crafted or upgrades purchased explicitly, rather than inferring them from an earlier event.

## Reveal predicate

`AscensionSkillObject.CheckRequirements` (`0x2D4850`) ANDs three independent conditions:

1. `requiredUpgrade` is absent or bought (`CheckRequiredUpgrade`, `0x2D47B0`).
2. `requiredAscensionUpgrade` is absent or active (`CheckRequiredAscensionUpgrade`, `0x2D4710`).
3. `CheckUltraOrAstral` (`0x2D4B40`) succeeds.

The third condition handles Astral Slayer itself first: it requires a previous Ultra Ascension. For other Astrals or nodes with an Astral ancestor, Astral Slayer ownership or the node's own ownership suffices. For remaining nodes, `ultraAscensionsRequired` requires a previous Ultra Ascension when set; otherwise that condition is true. `HasAstralAncestor` (`0x389910`) recursively checks whether any serialized prerequisite is Astral or has an Astral ancestor.

Own ownership bypasses only the Astral branch's ownership gate. It does not bypass the required external item or required Ascension Upgrade. Ordinary purchase connections do not determine reveal. An ordinary node can be visible while its purchase prerequisites remain unsatisfied.

The same predicate controls map nodes, connections, search, details and totals. Filling prerequisites checks each planned node's reveal condition after filling ordinary active dependencies; an unresolved item or activation gate blocks the entire preview before applying any profile changes.

## Ultra Ascension order and conditional retention

`AscensionManager+<>c__DisplayClass51_0.<Ascend>b__0` (`0x2E1700`) contains the Ultra Ascension tree reset loop. `PlayerInventory.Awake` (`0x4D3600`) supplies its registry through `Resources.LoadAll<AscensionSkill>("Ascension Skills")`; extraction independently matches all registered entries and native IDs.

The reset retains owned `isAstral` upgrades. An owned `isAstral && astralLock` upgrade activates during this reset if pending. `isLegendary` alone does not retain ownership. Other purchases are cleared except these four conditional exceptions:

| Active source | Source native ID | Existing target retained | Target native ID | Registry order |
| --- | --- | --- | --- | --- |
| Astral Blessing | `le7ke3q2jdjdmyhtzpgs` | Stones of Time | `b68jn6acu00oiesllac3` | 5 → 204 |
| Eternal Rage | `gmhcwrfgzcjt6j95g1lr` | Rage Mode | `04u7349eha9vacsofx7l` | 18 → 202 |
| Landlord | `q1ohpayhstjat193jka8` | Village Key | `vhxvp4q2i077pymnfhz0` | 24 → 206 |
| Multiverse | `fxvp2gcw4zbve2cm35z4` | Portal Dominum | `utbtanttthwl6yjkv4yb` | 29 → 236 |

These exceptions preserve already purchased targets. They do not award absent targets: this reset path does not call `AscensionSkill.Unlock` (`0x389BA0`). Each source is Astral and precedes its target in the native registry. Consequently the app's order—activate pending Astrals, evaluate active retention sources, clear remaining repeat purchases, then increment the epoch—is equivalent for this reviewed build. The validator checks those source flags and ordering so a future export cannot silently assume the same equivalence.

Manual removal is app behavior. It cascades invalid current-epoch purchases while preserving valid OR alternatives and purchases retained from an earlier epoch. A later Ultra Ascension reevaluates the four source conditions and can clear a previously retained repeat purchase if its source was manually unmarked.

## Manual milestone visibility policy

The game has no manual checklist. The app derives each checklist control from its consuming upgrades, removing only that milestone's own predicate from their reveal and purchase expressions. A control appears when a consumer's remaining reveal conditions hold and the consumer is owned or its ordinary active purchase prerequisites are met. For an isolated consumer with no ordinary tree prerequisite, ownership is required to expose its control. This prevents empty prerequisite arrays from disclosing future story-item names on a new profile. `Show spoilers` provides the explicit route for first recording such isolated items; after item entry, their native reveal predicates expose the corresponding branches.

This is spoiler policy for manual entry, not a guessed native dependency. The same shared visibility calculation handles these controls. Native item receipt, purchase and reveal predicates stay separate from checklist presentation.

## Independent validation and refresh

```powershell
python scripts/logic/validate_catalog_rules.py --export .local-game/asset-export/asset-export.json --catalog public/catalog.json --receipt data/native-rule-validation.json
yarn test src/domain/native-rules.test.ts
```

The [independent validator](../scripts/logic/validate_catalog_rules.py) reconstructs the reviewed native control flow directly from serialized requirements without importing the normalizer. It compares every purchase truth table and all relevant reveal booleans, exact IDs and connections, retention, activation, Ultra Ascension eligibility and four retention mappings. This build yields **10,574** purchase/reveal cases over **288** nodes and **318** connections. [The sanitized comparison receipt](../data/native-rule-validation.json) binds those checks to catalog, export, validator and native-receipt hashes. App regression tests exercise the actual public catalog's reveal, hidden prerequisite, ownership exception, activation and historical-retention behavior.

Any native hash, build, registry order or method-body change requires a renewed interpretation review and synchronized updates to the receipt, normalized predicates and tests. Passing extraction alone does not verify semantics. The map deliberately excludes SP/USP balance simulation, Dark Divinity overrides, Stone allocation, minion state, quest state and other gameplay reset effects outside the Ascension-tree contract.
