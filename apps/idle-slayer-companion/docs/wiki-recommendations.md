# Wiki purchase priorities

The recommendation data is an advisory ordering from the Idle Slayer Wiki. Native catalog data continues to determine upgrade identities, costs, visibility, purchase requirements, ownership, activation and reset behavior. The guide assumes a mixture of active and idle play; its order cannot measure the player's SP balance, equipment, coin income, quests, USP, Divinities, minion missions or play preference.

## Reviewed sources

The primary source is [Ascension Tree Tier List, revision 7187](https://idleslayer.fandom.com/wiki/Ascension_Tree_Tier_List?oldid=7187), edited **2026-07-05 at 09:50:07 UTC** and retrieved **2026-10-05**. Its version label is **7.0.0**; the installed native catalog is **7.2.0**. The page explicitly orders tiers, and orders upgrades within each tier from top to bottom. These are guide priorities, not native rules or guaranteed optimal purchases.

[Ascension Strategy, revision 7232](https://idleslayer.fandom.com/wiki/Ascension_Strategy?oldid=7232), edited **2026-08-04 at 14:35:39 UTC**, was reviewed for context. It directs purchase-order questions to the tier list. Its ascension timing and player statistics are not imported as automated conditions.

The MediaWiki API supplied live revision IDs, timestamps, wikitext and exact section anchors. Page HTML and Fandom's licensing landing page returned a browser challenge, so those responses were not used as evidence. The live wiki `siteinfo/rightsinfo` response reports **CC-BY-SA** and links Fandom's licensing policy. The primary [Fandom Help:Licensing policy, revision 3983537](https://community.fandom.com/wiki/Help:Licensing?oldid=3983537), edited **2025-07-02 at 23:39:18 UTC**, explicitly identifies the default text license as **Creative Commons Attribution-ShareAlike 3.0 Unported**. The wiki API does not identify an alternate license.

Attribution: **Idle Slayer Wiki contributors**. The wiki-derived ordering in [src/data/wiki-priorities.json](../src/data/wiki-priorities.json) is provided under [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The source revision, page history and license links accompany the data. Transformations are the extraction of factual ranks, stable native-ID reconciliation, earliest-occurrence deduplication, two source syntax recoveries and one reviewed title correction. Explanatory notes are original summaries based on native effects; wiki paragraphs and images are not copied. This attribution is separate from the MIT application/extraction code and from game-asset attribution.

## Coverage and reconciliation

The snapshot has **303 upgrade rows**, including an **11-row supplementary Astral Key table**. The **292 main-guide rows** cover **280 unique native IDs out of 288** after repeated appearances are deduplicated. Main priorities span Tier 1 through Tier 10 and First through Seventh Ultra Ascension. The supplementary quick-UA table supplies disambiguation evidence, but does not define a universal purchase order.

Every mapped row's parsed wiki cost exactly matches its native decimal cost string. **No outdated costs were observed** in this snapshot. This comparison does not promote wiki costs into the game catalog or imply that every effect, footnote, timing recommendation or player-dependent claim remains current for 7.2.0. The older guide-version label remains visible provenance.

Title comparisons normalize Unicode apostrophes, whitespace and case. Unique titles map directly. A repeated native title requires additional evidence; no row is assigned an identity solely because it is the first matching title.

All eleven **Astral Key** identities were resolved by exact native cost **and** the native active prerequisite named in the wiki's supplementary table. Main guide labels such as `Astral Key (+3)` are display annotations, not IDs. The native identities and the wiki prerequisite witnesses are recorded in `occurrences`. One Key, costing 1 trillion SP and following Limit Break, appears only in the supplementary resource-farming table; it has no general-guide priority.

The Fifth Ultra Ascension table calls one row **Cyclone Soul**. Its cost and effect exactly match native **Soul Cyclone**, and the same page revision uses **Soul Cyclone** as the prerequisite witness for an Astral Key. This reviewed name inversion is recorded explicitly; it is not a fuzzy match. That source section also has an extra image-cell delimiter before Stone of Hope Overcharge and Stone of Rage Overcharge. The parser recovers those two clearly separated name/cost/effect rows and records both corrections in `coverage.syntaxCorrections`.

Eight native upgrades have no general tier-list priority:

| Native upgrade | Stable native ID | Coverage reason |
| --- | --- | --- |
| Coimbo Master | `2oxx5mu5lw5rlpky0rsa` | No ranked row in this revision. |
| Astral Key, 1 trillion SP | `bfxg92d5su1vxe2fsg14` | Supplementary quick-UA table only. |
| Limit Break | `f0u5ddz1ddlbfcunejog` | No ranked row in this revision. |
| Coimbo Step | `f49bj6r65ffyqmf0anum` | No ranked row in this revision. |
| Secrets of Coimbo | `iugl3af4wlzw5ru7wooh` | No ranked row in this revision. |
| The Chosen One | `joffg528v6o2a86ldmnl` | No ranked row in this revision. |
| Knowledge Transfer | `tksbj36zo6dlvjdnx1n2` | No ranked row in this revision. |
| Preserved Effort | `z04g6cmfx6oucj9c7t9p` | No ranked row in this revision. |

The guide expressly leaves certain luck-dependent branches outside its main list. The data preserves omissions instead of manufacturing a wiki rank. Any native candidate outside these priorities must be labeled unranked, and any separate fallback order must be identified as application policy rather than wiki guidance.

## Data contract

The generated file contains:

```ts
{
  schemaVersion: 1,
  source: {
    label: string,
    url: string,
    revision: number,
    revisionTimestamp: string,
    revisionUrl: string,
    historyUrl: string,
    gameVersion: string,
    retrievedAt: string,
    wikitextSha256: string,
    license: 'CC-BY-SA-3.0',
    licenseUrl: string,
    licenseEvidence: object,
    attribution: string,
    strategyContext: object
  },
  catalog: { revision: string, gameVersion: string, sha256: string },
  orderingPolicy: string,
  rows: Array<{ id: string, priority: number, tier: string, url: string, note: string }>,
  stages: object[],
  occurrences: object[],
  coverage: object
}
```

Lower numeric `priority` sorts first: `source section sequence × 1000 + row order`. Each native ID keeps its earliest main-guide appearance; later appearances remain in `occurrences`. `row.url` points to the exact pinned tier-list revision and section, not an individual upgrade page. `tier` is source context and does not assert the user's current game stage.

Recommendation selection uses recorded progress and shared visibility, then checks native reveal and purchase requirements independently even when spoiler browsing is enabled. It does not turn a source stage label into an invented epoch or USP gate. A suggestion does not assert affordability or reset readiness. Revealed, unowned upgrades with satisfied native purchase requirements can be ordered using these facts; hidden goals and hidden prerequisite names must not leak through explanations or provenance text shown in the app. Source footnotes are not replayed as purchase predicates.

`recommendation-data-validation.ts` is shared by the data tests and `yarn check:release`. It checks the pinned source and license metadata, reviewed catalog hash, complete source slots, exact native decimal costs, all Astral Key prerequisite witnesses, earliest main-guide ranks and the explicit eight-ID coverage gap. A reviewed source refresh must update these pinned expectations alongside the generated data and provenance; replacing the JSON alone will fail the release gate.

## Reproduce or refresh on Windows

Use Node.js 24 from the repository root. No added dependencies or game access are needed. Keep raw responses and outputs in ignored `.local-game/`. The default is **candidate** mode, with output `candidate.json` inside the chosen input directory; no command below overwrites the committed snapshot.

To reproduce the reviewed snapshot with a fresh fetch, use **reproduce** mode:

```powershell
node scripts/extract/wiki-priorities.mjs --mode=reproduce --refresh --input=.local-game/wiki-reproduction
```

This reads the accepted `src/data/wiki-priorities.json` as its reference. It fetches all three recorded revision IDs (tier list 7187, strategy 7232 and licensing 3983537), verifies timestamps/hashes/license/catalog identity, and requires the complete generated bytes to equal the reference before writing `.local-game/wiki-reproduction/reproduced.json`. A different parser result or evidence fails closed; it does not change release expectations.

The reproduced snapshot retains its original `source.retrievedAt` because it is the original reviewed artifact. Actual new retrieval history remains in private `fetch-receipt.json`; `reproduced.json.reproduction-receipt.json` records the new fetch date, reproduction time, original snapshot retrieval date, revision IDs and equal reference/output hashes. A reproduction never claims the old date as the time of the new fetch.

For an offline replay of already cached responses:

```powershell
node scripts/extract/wiki-priorities.mjs --mode=reproduce --input=.local-game/wiki-priorities --output=.local-game/wiki-reproduction/reproduced.json
```

The existing cached fetch receipt is preserved. Missing/drifted responses fail; do not edit dates or secondary revisions to force a match. `--reference` can select another explicitly reviewed snapshot for tooling/fixture work, but is not a release-validation override.

To intentionally fetch and review a newer source, use a separate **candidate** directory:

```powershell
node scripts/extract/wiki-priorities.mjs --mode=candidate --refresh --revision=latest --input=.local-game/wiki-priorities-next
```

Candidate mode records the actual fetch date and current secondary revisions. Without `--refresh`, it parses the selected cache using that cache's fetch receipt. Review the actual revision, version label, license, all coverage changes, repeated titles, alias evidence and cost discrepancies. Do not substitute native costs or rules with wiki values. The script fails if exact duplicate-title evidence or the reviewed name-inversion evidence no longer matches; it reports unfamiliar titles rather than guessing. A future parser change must account for source rows explicitly.

After independent source/licensing review, explicitly promote a candidate and update the pinned expectations in `recommendation-data-validation.ts` plus provenance together; replacing JSON alone remains insufficient. Run `yarn test:tools`, recommendation/domain tests, typecheck, build, release verification and local browser checks. Promotion/publication authority comes from the task being performed.

The original October 5 review's independent API fetch and cached replay reproduced SHA-256 **`51af31fb5c620a833e525816ed6e0d46466afe881b3032a548e7c256ab644796`**. That is historical evidence. The JSON records native catalog and source hashes; a successful synthetic tooling test does not establish current archive availability or validate a changed guide snapshot. Reproduction tests exercise later dates, secondary drift, byte drift, private default output and mocked fresh-fetch revision selectors offline.
