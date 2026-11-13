# Reviewed catalog refresh on Windows

Use this ordered route from the repository root. The current reviewed baseline is Windows Steam **7.2.0 / build 25551532**. Reproducing that baseline and supporting a different build are different tasks. A successful extraction or matching generated hash does not replace semantic or visual review.

## 1. Establish the input and keep it private

Work on an isolated branch. Preserve the existing reviewed catalog, receipts and profile-migration behavior for comparison. Use Node.js 24, pinned Yarn 4.13.0, Python 3.10+ and `yarn install --immutable`. Without a Yarn launcher, use `node .yarn/releases/yarn-4.13.0.cjs <command>`.

Read the actual Steam `appmanifest_1353300.acf` and installed version; do not assume Steam still has the reviewed build. Set these examples to your actual library or copied inputs:

```powershell
$gameInputPath = 'F:\SteamLibrary\steamapps\common\Idle Slayer'
$steamManifestPath = 'F:\SteamLibrary\steamapps\appmanifest_1353300.acf'
```

Keep the manifest, binaries, downloaded tools, raw exports, reconstructions, contact sheets and any user-selected saves in ignored `.local-game/` or outside Git. Never place them in `public` or `dist`. Extraction reads game files offline and must not launch the game, invoke its methods or read player saves to establish rules. [Input and provenance details](data.md).

## 2. Choose reproduction or new-build investigation

**Unchanged baseline:** run the [native pipeline](../scripts/logic/README.md), using the actual path:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/logic/extract-logic.ps1 -GamePath $gameInputPath
```

It verifies the pinned Cpp2IL executable, reconstructs private dummy assemblies/declarations/disassembly, then compares native inputs and selected method bodies with `scripts/logic/native-method-receipt.json`. Require a match. Also run the whole-input and save-method-range verification in [save-import.md](save-import.md#evidence-and-verification), replacing its example path. A changed binary can require investigation even when the version label is unchanged.

**Different inputs/build:** an evidence mismatch is an intentional stop. The pipeline writes private reconstructions and evidence before its final reviewed-receipt check; inspect those outputs and the failure. A metadata/tool incompatibility or incomplete reconstruction is a separate failure to resolve first. Never delete the check, relabel new inputs as the old build, or merely replace old hashes to get a green run.

If a changed method-selection list is needed during investigation, run the reviewed inspector against the already generated private outputs without asserting an old receipt match:

```powershell
python scripts/logic/inspect-methods.py --game-path $gameInputPath --logic-root .local-game/logic
```

This only indexes candidate evidence; it does not approve new semantics. Independently review declarations, field offsets and native bodies for registry loading, purchase AND/OR control flow, reveal gates, activation, reset retention, descriptions and coordinates. Update the sanitized native receipt, interpretation documents, normalizer and independent evaluator together only after that review. The default pipeline must retain its fail-closed reviewed-receipt check. [Native review and comparison contract](../scripts/logic/README.md).

## 3. Extract and review a private candidate

Follow the [asset extraction commands](../scripts/extract/README.md), including its pinned Python requirements and `.local-game/logic/dummy` input. Extract into `.local-game/asset-export`, then create the sprite-review inventory/contact sheets. Check complete registry coverage, unique stable IDs, references, exact decimal costs, raw native coordinates, localization transformations and every referenced sprite against the new inputs.

The current `normalize_catalog.py` explicitly accepts only 7.2.0/build 25551532. Its changed-build rejection is expected until the review in step 2 establishes the new contract. Update those guards, revision/source labels, evidence descriptions and affected transformation tests as a reviewed code change; do not add an arbitrary-build bypass. Tool success does not justify setting catalog verification flags to true without the corresponding review.

Inspect every numbered sprite sheet at nearest-neighbor scale. Only then mark `visualReviewComplete` and record evidence in the private inventory. The current receipt writer describes six sheets and 288 sprites; if coverage changes, update that description and reviewed expectations accurately rather than claiming the old visual review. Normalize again with the reviewed inventory:

```powershell
.\.local-game\extract-venv\Scripts\python.exe scripts\extract\normalize_catalog.py --export .local-game\asset-export\asset-export.json --output .local-game\catalog-candidate.json --sprite-review .local-game\sprite-review\sprite-review-inventory.json
python scripts/logic/validate_catalog_rules.py --export .local-game/asset-export/asset-export.json --catalog .local-game/catalog-candidate.json --receipt .local-game/native-rule-candidate.json
```

The second command uses an independent implementation and the reviewed native receipt. A mismatch blocks promotion. Review reachable dependency paths and distinguish native predicates from app-only milestone/removal policies. Compare old/new stable identities; preserve unknown profile records during catalog migrations. [Rule semantics](native-rules.md), [storage contract](architecture.md).

## 4. Review coordinated recommendation and save evidence

| Artifact or contract | Required coordinated work |
| --- | --- |
| `public/catalog.json`, `public/assets/upgrades/`, `data/catalog-receipt.json` | One reviewed normalized candidate, complete reviewed icon set and final-byte hashes. |
| `scripts/logic/native-method-receipt.json`, `data/native-rule-validation.json` | Reviewed native inputs/methods, independent comparison against the final catalog, and synchronized interpretation/tests. |
| `src/data/wiki-priorities.json`, `src/domain/recommendation-data-validation.ts` | Review source revisions, dates, license, mapping witnesses, exact costs and coverage against the new catalog. Update pinned validation expectations and provenance with the accepted snapshot. |
| `data/save-import-receipt.json`, importer/codec/tests, `scripts/check-release.mjs` | Separate static native save-format and progress-semantics review; reviewed catalog/version/build/ID mapping, native input/method hashes and exact final receipt digest. |
| Documentation, catalog validation and fixtures | Accurate supported counts/version/revision, dynamic descriptions, reset/reveal behavior and relevant regression cases; no invented source proof. |

Use the [wiki reproduction and candidate-refresh workflow](wiki-recommendations.md#reproduce-or-refresh-on-windows). A byte-for-byte replay of the accepted guide differs from accepting a new guide/catalog pair. Keep raw API responses private, preserve original artifact dates when reproducing, record actual fetch dates separately, and review license/mapping drift before promotion. Wiki order remains a priority guide; it cannot replace native costs or rules.

The wiki CLI reads `public/catalog.json`; it has no candidate-catalog argument. To review mappings against the native-reviewed candidate before final promotion, stage only that catalog locally, generate private wiki output, then restore the original catalog bytes. Do this in the isolated refresh checkout, with no concurrent build/promotion or publisher. The linked candidate/reproduction modes require the corrected workflow in #66 to be integrated first.

```powershell
$wikiReviewRoot = Join-Path (Join-Path (Get-Location).Path '.local-game') ('wiki-review-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $wikiReviewRoot -ErrorAction Stop | Out-Null
$catalogPublicPath = Join-Path (Get-Location).Path 'public\catalog.json'
$catalogRecoveryPath = Join-Path $wikiReviewRoot 'catalog-before-review.json'
try {
    $catalogBeforeWiki = [IO.File]::ReadAllBytes($catalogPublicPath)
    [IO.File]::WriteAllBytes($catalogRecoveryPath, $catalogBeforeWiki)
} catch {
    throw 'Could not preserve the original catalog; stop before staging.'
}
try {
    Copy-Item -LiteralPath .local-game\catalog-candidate.json -Destination $catalogPublicPath -ErrorAction Stop
    node scripts/extract/wiki-priorities.mjs --mode=candidate --refresh --revision=latest "--input=$wikiReviewRoot" "--output=$wikiReviewRoot\candidate.json"
    if ($LASTEXITCODE -ne 0) { throw 'Wiki candidate generation failed; review the private evidence.' }
} finally {
    [IO.File]::WriteAllBytes($catalogPublicPath, $catalogBeforeWiki)
}
```

If the shell is interrupted before `finally`, restore from the retained `$catalogRecoveryPath` before continuing. Record that path in private working notes. Check that the restored public file has its original hash and that the private wiki candidate records the **candidate catalog** hash/revision. Review that new pair and adjust pinned parser/validation expectations only with evidence. A successful private generation is not approval. Keep the accepted private `candidate.json` unchanged for the final comparison. Do not copy it into `src/data/` yet.

Save compatibility is a separate gate even if the catalog looks unchanged. Review native serialization/encoding, version discriminator, typed keys, milestone flags, UA count, Astral activation and retained-ownership baseline against new native evidence. Follow [the save-format contract and evidence list](save-import.md); synthetic decoder tests alone do not establish a new platform/version. There is currently no automatic generator that certifies a new save receipt. Assemble/review its sanitized evidence without embedding player data, then update the exact SHA-256 literal in `scripts/check-release.mjs` to the **reviewed final file bytes**:

```powershell
(Get-FileHash -LiteralPath data/save-import-receipt.json -Algorithm SHA256).Hash.ToLowerInvariant()
```

Do not remove that digest check, broaden the importer version allowlist speculatively or manufacture compatibility by hashing an unreviewed receipt. If compatibility cannot be established, the new-build release remains blocked until a separately reviewed support policy resolves it.

## 5. Promote reviewed files locally and regenerate final receipts

Only after the preceding reviews, copy the normalized candidate and reviewed individual PNGs using [the promotion commands](data.md#reproduce-and-refresh-on-windows). Reconcile icons against the new catalog IDs explicitly: copying cannot remove obsolete files or prove complete coverage. Review any removals within `public/assets/upgrades`; never recursively delete a computed path or copy raw export directories into the site.

Regenerate `data/catalog-receipt.json` against the exact final catalog and icon bytes with the documented `write_coverage_receipt.py` command. Regenerate the independent audit against the same final catalog:

```powershell
python scripts/logic/validate_catalog_rules.py --export .local-game/asset-export/asset-export.json --catalog public/catalog.json --receipt data/native-rule-validation.json
```

Inspect the full diff, receipt identities/hashes and attribution. No raw inputs, private review sheets, save bytes, preference values or installation paths belong in the commit. Receipts describe established review; generating them does not perform it.

With the accepted catalog now in `public/catalog.json`, regenerate wiki output from the **same reviewed cached responses** into a different output file, without `--refresh`. Preserve the accepted private candidate from step 4 and compare before promotion:

```powershell
$wikiFinalCandidatePath = Join-Path $wikiReviewRoot 'final-candidate.json'
if (Test-Path -LiteralPath $wikiFinalCandidatePath) { throw 'Preserve the existing final candidate and choose a new output path.' }
$wikiAcceptedPath = Join-Path $wikiReviewRoot 'candidate.json'
$wikiAcceptedRevision = (Get-Content -LiteralPath $wikiAcceptedPath -Raw | ConvertFrom-Json).source.revision
node scripts/extract/wiki-priorities.mjs --mode=candidate "--revision=$wikiAcceptedRevision" "--input=$wikiReviewRoot" "--output=$wikiFinalCandidatePath"
if ($LASTEXITCODE -ne 0) { throw 'Final wiki candidate generation failed.' }
$wikiAcceptedHash = (Get-FileHash -LiteralPath $wikiAcceptedPath -Algorithm SHA256).Hash
$wikiFinalHash = (Get-FileHash -LiteralPath $wikiFinalCandidatePath -Algorithm SHA256).Hash
if ($wikiFinalHash -ne $wikiAcceptedHash) { throw 'Final wiki candidate differs from accepted evidence; stop and review.' }
```

Check the catalog identity as well as the complete-byte hash. An unexpected difference blocks acceptance. Promote only the reviewed normalized priority JSON into `src/data/wiki-priorities.json`, together with reviewed validator expectations and provenance. Recompute all final receipts after the last catalog/icon/save-evidence change before validating.

## 6. Validate, independently review, then publish within authority

```powershell
yarn validate:catalog
yarn test:tools
yarn test
yarn typecheck
yarn build
yarn playwright install chromium
yarn test:e2e
yarn check:release
```

Keep browser checks on the local production build or isolated CI. Verify reveal/reset rules, suggestions, import/restore, unknown-ID preservation, both layouts and responsive interactions against the synchronized candidate. `check:release` binds the built catalog/icons, native audit, recommendation snapshot, save evidence and complete runtime notices; investigate stale evidence rather than weakening the gate. [Release artifact details](data.md#reproduce-and-refresh-on-windows).

Obtain an independent review of the final combined catalog/code/evidence diff. Record what was reproduced, newly reviewed and still unverified. Apply [the complete release gates](implementation-plan.md#validation-and-release) and current task authorization before pushing/merging or publishing. Existing successful main CI deploys through Pages; deliberate manual production readback is separate proof. Never run automated production checks or work around hosting rate limits.
