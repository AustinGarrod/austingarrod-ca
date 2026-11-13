# Steam save import

## Current companion adapter (7.3.4)

**Import game save** now opens the global Companion preview. A reviewed **Windows Steam 7.3.4 / build 25810322** file replaces supported native observations across Ascension, achievements, crafting/materials, regular quests, supported Village construction state, Bestiary, and Divinities with one Undo operation. The native version is a compatibility discriminator, not authentication. Missing supported native keys use only their reviewed native defaults. Unsupported Village task predicates remain unrecorded; no unsupported NPC/task completion is inferred. See [native review](companion-native-review.md).

Native preferences are decoded once and discarded after normalization. Goals, recipe quantities, layout, tracking preference and the current spoiler choice are kept. Preview identities use the recipient's **current** visibility, including when the incoming save reveals more content. Unknown normalized IDs survive catalog updates. Shared craft/Village item completion and map milestones refer to one ownership fact. Selection and effective Divinity activation remain separate. Counters use exact decimal strings.

The **7.2.0 / build 25551532** adapter documented below is retained as **map-only** compatibility. It preserves companion modules instead of treating unsupported fields as zero. Its original receipt is `data/save-import-receipt-720.json`; the current receipt is `data/save-import-receipt.json`. Other versions/platforms remain rejected pending native review. Both adapters preserve the documented synthetic retained-ownership baseline because native saves do not provide complete purchase history.

The importer reads a user-selected copy of `savedata.sav` or `backup.sav` locally in the browser. It extracts the map's current upgrade ownership, Astral activation, Ultra Ascension count and nine external milestones. The preview replaces known map progress only after confirmation; undo remains available. The app does not write a game save, run the game, authenticate to cloud storage or upload the selected file.

The app separately uses self-hosted Umami usage analytics and session recording. File inputs, import previews, counters and import warnings are excluded from replay contents, and events describe only bounded import stages/outcomes. The selected file, filename, path, bytes, native preferences and imported ownership snapshot are never uploaded. After applying, ordinary visible map progress can appear in recordings. Excluded elements can still contribute coarse heatmap click/scroll coordinates. The separate persistent tracking opt-out in About & sources is unchanged by import or undo; see [analytics.md](analytics.md).

The reviewed input is **Windows Steam Idle Slayer 7.2.0, build 25551532**, using Unity **6000.3.14f1** and IL2CPP metadata version **39**. Native `FileBasedPrefs.GetSaveFilePath` combines `Application.persistentDataPath` with `savedata.sav`; the backup uses `backup.sav`. For this Windows installation the directory is:

```text
%USERPROFILE%\AppData\LocalLow\Pablo Leban\Idle Slayer\
```

The picker does not automatically scan that directory. Close the game before choosing the file so it is not changing while being read. A map JSON backup is a separate format and continues to use Restore JSON backup. Mobile file access and cloud-save downloads are outside this importer.

## Supported format and bounds

The native writer calls `JsonUtility.ToJson`, applies `FileBasedPrefs.DataScrambler`, and writes the result through `StreamWriter(string path)`. That constructor uses UTF-8 without a BOM. The native writer writes the string directly; it does not append a line ending.

The scramble is symmetric XOR over **UTF-16 code units**, using a fixed 78-character ASCII key. For each index `i`, the result is `input.charCodeAt(i) ^ key.charCodeAt(i % key.length)`. Iteration over Unicode code points would change the algorithm for non-BMP characters. The reviewed key's UTF-8 SHA-256 is `db3a2920820ea229c00d4fd063611f49108dfd3fecb1e1254f99417a2da5fcfc`; the application codec contains the matching constant. This is reversible file obfuscation, not an account credential.

`File.ReadAllText` reads the native file before applying the same scramble and calling `JsonUtility.FromJson<FileBasedPrefsSaveFileModel>`. A `Trim` call checks whether a file is empty, but the original, untrimmed string is subsequently decoded. Therefore the importer consumes an optional UTF-8 transport BOM and preserves every other scrambled character, including leading or trailing whitespace and control characters. Legal whitespace in the decoded JSON is handled by the JSON parser. Arbitrary whitespace appended to the scrambled file is not repaired. UTF-16 transport encodings are not supported by this reviewed Steam importer.

The root model contains four arrays. Each entry has `Key` and `Value`:

| Array | Key | Value |
| --- | --- | --- |
| `StringData` | String | String or null |
| `IntData` | String | Signed 32-bit integer |
| `FloatData` | String | Finite number |
| `BoolData` | String | Boolean |

The native constructor initializes all four arrays, including empty arrays. The importer requires this complete model and rejects malformed entries. Keys are unique **within each array**. The same key may appear in different typed arrays: the native lookup selects an array according to the requested default value's type. Native lookup returns the first match for an ambiguous same-array duplicate; the importer rejects those duplicates instead of choosing a value.

The native `StringItem` constructor assigns string references without a null guard. The codec permits unrelated null string values, but the importer does not assume a null or omitted version means 7.2.0 and rejects a null UA counter. Native serializer tolerance for every unusual omitted field is not a compatibility claim.

Importer resource bounds are application policy: at most **4 MiB**, **100,000 total preference entries**, **1,024 UTF-16 units per key** and **1 Mi UTF-16 units per string value**. These are not native game limits. Invalid input produces a generic message without reproducing file contents, preference values or parser exceptions. Decoded preferences are temporary and are not persisted as a native save.

`StringData["Last Played Version"]` must equal **`7.2.0`**. `PlayerInventory.Awake` writes this key from `Application.version`. Missing and different versions are rejected; the version is a compatibility discriminator, not an authentication or integrity guarantee. Supporting a new version requires a new static native review, catalog compatibility check and importer tests. A newer or older save must not silently reuse these rules.

## Progress semantics

`AscensionSkill` inherits `DataObject.id`. That same stable ID is the key read from `IntData`; it is not a title or an array index. `AscensionSkill.Init` interprets values at least 1 as owned and values at least 2 as setting `astralLockUnlocked`. `IsActive` returns ownership except when an Astral lock is owned but its lock activation flag is unset.

The reviewed importer accepts the current state values 0, 1 and 2 for known upgrade IDs and rejects unfamiliar values. A normal purchase writes 1. The Ultra Ascension callback writes 2 only for an owned, pending Astral lock. An immediate upgrade containing 2 still loads as owned and active in the native code; accepting it does not establish when or how it was purchased. For an Astral lock, 1 means pending and 2 means active. A lock marked active alongside zero Ultra Ascensions is rejected instead of inventing a reset.

The global reset counter is `StringData["Ultra Ascensions"]`, read by `PlayerInventory.LoadPrefs` as a double. An absent or empty native counter defaults to zero. Native `Utils.ParseDouble` replaces comma with decimal point, removes plus signs and Unicode category C characters, and parses with invariant culture. The importer accepts decimal and exponent forms only when they represent an exact nonnegative integer within the profile's **0–1,000,000** range. It rejects comma-containing counters and internal control characters rather than reproducing arbitrary native cleanup or treating a comma as a thousands separator. That profile bound and stricter parsing are application policy.

All nine milestone IDs were independently matched between the decoded native assets and the public catalog. `Upgrade.Init` reads `bought` when its integer preference equals 1. `PermanentCraftableItem.AdditionalInit` reads `unlocked` when its integer preference equals 1; `IsActive` returns that field. These flags record the actual required item received, purchased or crafted, rather than an earlier boss defeat or story event.

| Stable ID | Native asset | Milestone |
| --- | --- | --- |
| `cpxhw229fs2kgh2zgs0c` | `Upgrade` | Tome of Coimbo |
| `iwqw3uscrm8nbeibqtpz` | `Upgrade` | Victor's Soul |
| `jal6x8iarlhjjeujvy5e` | `PermanentCraftableItem` | Armory |
| `nnbcwhliklxqxvhhot4b` | `PermanentCraftableItem` | Book of Death Pact |
| `otkuywjipoknt3x4wrpf` | `Upgrade` | Wind Dash Training |
| `qjmm49gzsenrcbpcunbs` | `PermanentCraftableItem` | Crate |
| `sxfhaw7yth9yevc5ti2w` | `Upgrade` | Guardian's Soul |
| `wqg7vf0pk6gdwx64nhl5` | `Upgrade` | Climbing Kit |
| `xob1yba3zntx0ul0bn71` | `Upgrade` | Grapple Tome |

The importer reads only recognized catalog upgrade and milestone IDs plus the version and counter metadata. Other native preferences, including account-related data, currencies, statistics and unrelated systems, are discarded. Existing unknown IDs from the map profile remain preserved; they are distinct from unrecognized native save preferences. The existing spoiler preference remains unchanged, and imported progress is presented through the shared native visibility calculation.

## Snapshot baseline, not purchase history

The examined purchase, initialization and activation paths do **not** save a per-upgrade purchase epoch or timestamp. The counter gives the number of Ultra Ascensions but cannot recover exact upgrade chronology. The importer therefore constructs a documented baseline for existing ownership rather than claiming to restore history.

Let `E` be the imported Ultra Ascension count. Ordinary purchases and pending Astral locks receive epoch `E`. At `E > 0`, active Astrals and already owned targets of currently active conditional retention rules receive synthetic epoch `E - 1`. This preserves recorded retained ownership during subsequent prerequisite edits. It is a conservative application policy: immediate Astrals and retention targets can also have been purchased in the current epoch, and the save does not distinguish those cases. At `E = 0`, every imported purchase uses epoch zero.

Native conditional retention does not award missing targets. The four current source/target rules are Astral Blessing → Stones of Time, Eternal Rage → Rage Mode, Land Lord → Village Key, and Multiverse → Portal Dominum. The importer never fills prerequisites, chooses OR paths, grants an absent target, marks a pending lock active or adds an external milestone merely to make an imported path valid. The next previewed Ultra Ascension reevaluates native retention from the current recorded state.

Previously unknown map purchase records are preserved with their activation flags; epochs above the incoming counter are clamped to `E` so the resulting profile stays valid. Applying the import replaces recognized current state rather than merging the old known purchases into it. The confirmation and backup/undo flows let the user review or recover the previous map profile.

## Evidence and verification

[data/save-import-receipt.json](../data/save-import-receipt.json) records the reviewed format, native ID mappings and mapped native method-range hashes. It contains no player-save hashes, counts, preference values, account identifiers or player timestamps. Its semantic review uses only offline native declarations, IL2CPP metadata, asset exports and native method bytes. Raw reconstructions remain under ignored `.local-game/logic/`.

The primary native evidence is:

| Method | RVA | Purpose |
| --- | --- | --- |
| `FileBasedPrefs.DataScrambler` | `0x2CA9C0` | Repeating XOR and UTF-16 indexing |
| `FileBasedPrefs.WriteToSaveFile` | `0x2CC0A0` | Scrambled text write |
| `FileBasedPrefs.GetFileBasedPrefsSaveFileModel` | `0x2CB2F0` | Text read, symmetric decode and JSON parse |
| `FileBasedPrefsSaveFileModel.GetValueFromKey` | `0x2C94E0` | Typed-array preference lookup |
| `AscensionSkill.Init` | `0x3899A0` | Stable-ID ownership and lock flag |
| `AscensionSkill.IsActive` | `0x389AA0` | Pending Astral activation gate |
| `SkillTreeManager.BuyAscensionSkill` | `0x3B2BA0` | Purchase writes 1 |
| `Upgrade.Init` | `0x3AE390` | Required Upgrade item flag |
| `PermanentCraftableItem.AdditionalInit` | `0x3A37B0` | Crafted/received item flag |
| `PlayerInventory.Awake` | `0x4D3600` | Native version key |
| `PlayerInventory.LoadPrefs` | `0x4DBBE0` | Global UA counter |
| `Utils.ParseDouble` | `0x3DA880` | Native numeric parsing |
| `AscensionManager.<Ascend>b__0` | `0x2E1700` | Lock activation, retention and counter update |

The receipt also hashes the selected `StreamWriter(string path)` constructor that chooses UTF-8 without a BOM. Native semantics and decoder validation are separate checks: a successfully parsed file alone does not establish complete game rules, and synthetic fixture tests do not prove every real save or platform format.

Run the importer/domain tests and application checks after a change:

```powershell
yarn test
yarn typecheck
yarn build
yarn test:e2e
yarn check:release
```

To verify the receipt's mapped method ranges without executing game code, run this read-only check from the repository root against the reviewed installation:

```powershell
@'
import hashlib, json
from pathlib import Path
receipt = json.loads(Path('data/save-import-receipt.json').read_text(encoding='utf-8'))
game = Path(r'F:\SteamLibrary\steamapps\common\Idle Slayer')
native = (game / 'GameAssembly.dll').read_bytes()
metadata = (game / 'Idle Slayer_Data/il2cpp_data/Metadata/global-metadata.dat').read_bytes()
assert hashlib.sha256(native).hexdigest() == receipt['nativeInputs']['gameAssemblySha256']
assert hashlib.sha256(metadata).hexdigest() == receipt['nativeInputs']['metadataSha256']
for method in receipt['methods']:
    start, size = method['rawOffset'], method['length']
    assert hashlib.sha256(native[start:start + size]).hexdigest() == method['nativeBodySha256']
print('Reviewed native inputs and save-format method ranges match.')
'@ | python -
```

Replace the installation path only if Steam uses another library. A mismatch requires reviewing the new native code before expanding support; never read a player save to manufacture native rule verification.
