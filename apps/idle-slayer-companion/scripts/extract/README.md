# Offline catalog extraction

## Current 7.3.4 extraction

Current release inputs are **7.3.4 / build 25810322**. [The companion native review](../../docs/companion-native-review.md) records current extraction commands, method bindings, registry/icon coverage, adapter defaults, unsupported predicates, and cross-system reset rules. `normalize_catalog.py` accepts only the two reviewed version/build pairs. The older extraction narrative below describes the original 7.2.0 evidence; its RVAs/paths must not be substituted for current receipt values.

These tools read installed Unity assets and write inspection material only under
the ignored repository `.local-game/` directory. They never launch the game,
read player saves, call native game methods, or modify the installation.

The reviewed source is **Idle Slayer 7.2.0**, Steam app **1353300**, build
**25551532**, Unity **6000.3.14f1**, IL2CPP metadata **39**. UnityPy 1.25.4 reads
the built-in asset types. Custom type trees are stripped. Direct
TypeTreeGeneratorAPI 0.0.10 IL2CPP loading cannot interpret this metadata version;
use the dummy assemblies from the [offline logic pipeline](../logic/README.md).

Run from the repository in Windows PowerShell, using Python 3.10 or newer:

```powershell
python -m venv .local-game\extract-venv
.\.local-game\extract-venv\Scripts\python.exe -m pip install -r scripts\extract\requirements.txt
# Run scripts/logic pipeline first, producing .local-game/logic/dummy.
$gameInputPath = 'F:\SteamLibrary\steamapps\common\Idle Slayer'
$steamManifestPath = 'F:\SteamLibrary\steamapps\appmanifest_1353300.acf'
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\extract_assets.py --game-root $gameInputPath --manifest $steamManifestPath --dummy-assemblies .local-game\logic\dummy --output .local-game\asset-export
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\review_icons.py --export .local-game\asset-export\asset-export.json --output .local-game\sprite-review
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\normalize_catalog.py --export .local-game\asset-export\asset-export.json --output .local-game\catalog-candidate.json
```

The installation path is an example; pass the actual Steam library or a copied
input folder. Keep the manifest private: only app ID and build ID are exported.
Game paths, Steam account fields, gameplay timestamps, saves and credentials are
never written into provenance.

`extract_assets.py` compares every native `AscensionSkill` asset against the
`ResourceManager` entries under `ascension skills/`. Native
`PlayerInventory.Awake` loads exactly that resource path. This build has 288
unique upgrade IDs, 318 prerequisite connections, nine explicit external item
milestones and 288 referenced sprites. Costs remain decimal strings expanded
from the shortest round-trip representation of the serialized native double.
Coordinates preserve the native position without a layout substitution.

Generated MonoBehaviour root fields have an alignment problem in this toolchain;
the script uses the fixed native script pointer and discards generated base
fields. Every catalog custom field is read with full-length validation. Ancillary
description targets have only their leading ID/label read, avoiding unsupported
unrelated type trees. UnityPy's PlayerSettings tree misses four trailing bytes;
the earlier `bundleVersion` is read with that unrelated tail mismatch tolerated.

The English text is from the native `en-US` TextAsset. Descriptions use native
templates, serialized effect values and referenced labels. Unity rich-text tags
are converted to plain text. Native current totals and minion stats depend on
player state, which these tools never read: 14 descriptions show the static
effect and explicitly explain that current totals or stats vary. The mapping is
in `normalize_catalog.py`; native dynamic branches are recorded in the method
receipt. No incomplete wiki dependencies are substituted.

After visually inspecting all six numbered sprite sheets, mark
`visualReviewComplete` in the private `sprite-review-inventory.json` as true and
record the review evidence. Then normalize with the matching review inventory:

```powershell
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\normalize_catalog.py --export .local-game\asset-export\asset-export.json --output .local-game\catalog-candidate.json --sprite-review .local-game\sprite-review\sprite-review-inventory.json
```

External milestone controls use an explicit app policy: show a control when a
consuming branch is reachable through its ordinary purchase prerequisites, or
the consuming upgrade is already owned, while retaining other native reveal
gates. Exclude the milestone itself from the control's predicate. This prevents
both checklist spoilers and a self-deadlock when entering existing progress.
Isolated branch entry nodes with no ordinary tree prerequisites expose a
control only once that consuming node is already owned. Use **Show spoilers**
for first entry of those milestones; no guessed story or Ultra gate is used.
It does not redefine the game's purchase or reveal rules for upgrades.

Once the candidate and icons are promoted locally, regenerate the sanitized
receipt against the exact final catalog and final icon bytes:

```powershell
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\write_coverage_receipt.py --export .local-game\asset-export\asset-export.json --catalog public\catalog.json --sprite-review .local-game\sprite-review\sprite-review-inventory.json --icons public\assets\upgrades --output data\catalog-receipt.json
```

The committed receipt records every native ID, resource path, position, decimal
cost, prerequisite and relevant serialized flag, along with the final catalog
hash and all reviewed sprite hashes. CI can validate the committed static data
against this receipt without access to the game. Keep raw exports, dummy
assemblies, all game binaries and contact sheets private. Only the normalized
catalog, reviewed individual sprites, sanitized evidence and these tools may be
committed. Application code and game content attribution remain separate.

## Synthetic transformation checks

Run `yarn test:tools` from the repository with Node.js 24, pinned Yarn 4.13.0 and Python 3.10 or newer. On Windows the runner uses `python`; on other platforms it uses `python3`. For another interpreter, set `$env:PYTHON = 'C:\path\to\python.exe'` in PowerShell. The same command runs in routine CI. It uses only Python's standard library and Node's built-in test runner; Python runs with `-S`, so installed extraction packages are not loaded. The private-output boundary is shared in the standard-library-only `private_paths.py` module, allowing normalization without importing UnityPy.

`tests/tooling/normalize_catalog_test.py` constructs a small invented native-shaped registry and invokes the shipped normalization CLI. Independent expected predicates cover empty/AND/OR purchase behavior, the native OR early return before the Ultra Ascension gate, craftable and external reveal gates, Astral ancestor ownership, pending activation, milestone self-gate removal, retained grants, coordinates and exact large decimal strings. Description examples cover referenced names, rich-text conversion, localized specials, tiny coefficients, and replacement of player-derived totals/stats. Build drift, unresolved substitutions and public-output paths fail closed. Inputs, candidates and receipts exist only in a unique ignored `.local-game/synthetic-parser-*` directory, removed after each test.

`tests/tooling/wiki-priorities.test.mjs` supplies invented local API responses and a tiny invented catalog to the actual offline wiki CLI in a temporary directory. It verifies four-cell table filtering, markup/entity cleanup, exact scientific integer costs, earliest non-supplementary ordering, duplicate-title ambiguity, all eleven Astral Key cost-plus-prerequisite witnesses, the reviewed alias guard, and revision/anchor/license/witness drift failures. Ordinary fixtures use cached local inputs; one fresh-fetch reproduction test passes `--refresh` with fetch mocked to invented offline responses. No fixture downloads source text. Supplementary witnesses do not become invented priorities.

These fixtures detect transformation regressions; they do not establish a new game's registry coverage, binary decoding, asset review, native semantics, or a refreshed wiki's correctness. Continue the documented real-input extraction, independent native-method comparison and release checks for every refresh. No binaries, raw exports, saves or player information belong in these fixtures.
