# Website consolidation and transfer-only retirement

The maintained source is now `apps/idle-slayer-companion/` in [AustinGarrod/austingarrod-ca](https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion). The public utility is [Idle Slayer Companion](https://austingarrod.ca/utilities/idle-slayer-companion/). The former source repository is retained as archived history after verified cutover. Do not recreate either former repository name or remove existing source/issue redirects.

## Two deliberately separate artifacts

The default website build uses `/utilities/idle-slayer-companion/` and its origin-specific installation identity. `COMPANION_DEPLOY_TARGET=legacy-migration` builds only the retirement page through a dedicated entry, without importing the full app, editable progress sessions, analytics or reporting. The generator builds both `/idle-slayer-companion/` and `/idle-slayer-ascension-map/`, including every known section and `index.html` bookmark. Neither address redirects or exposes a usable map, companion module, import, reset, spoiler switch or installation control. The existing installed-app identity and each historical worker's scope/cache prefix are preserved.

From this app directory on Windows, use Node.js 24 and the pinned launcher:

```powershell
node .yarn/releases/yarn-4.13.0.cjs install --immutable
node .yarn/releases/yarn-4.13.0.cjs typecheck
node .yarn/releases/yarn-4.13.0.cjs test
node .yarn/releases/yarn-4.13.0.cjs test:tools
node .yarn/releases/yarn-4.13.0.cjs build
node .yarn/releases/yarn-4.13.0.cjs check:release
node .yarn/releases/yarn-4.13.0.cjs test:e2e --workers=4
```

`prepare:migration` (also run by `test:e2e`) builds into `.cache/legacy-migration-app` and `.cache/legacy-migration-map`, verifies their dedicated-entry receipts, complete runtime notices and worker inventories, and assembles `.cache/site-migration`. Its sibling `.cache/site-migration-SHA256SUMS` lists the exact bytes under the compatibility repository's `site/` prefix; `.cache/site-migration-release.json` records source commit, dirty-source status, file counts, bytes and both offline releases. Commit source and regenerate before publication if a clean source-commit binding is required. No website-base bytes are copied under historical paths; the website source-map-upload receipt is untouched. This preparation changes no hosting or repository settings.

Both historical pages strip arbitrary query/fragment data and keep only validated incoming public references or map transfers for the explicit **Open new app** link. This link waits for incoming transfer validation; it never applies a transfer to old storage. Every destination link includes `migration=1`, so the new app persists usage tracking off before URL cleanup. Plain links also retain `#analytics=off` as a visit-only fallback. Reopening the canonical app remains opted out until the user explicitly changes that preference. The retirement page runs no telemetry, and its downloads contain only the existing portable documents.

## Guided transfer

Browser storage is origin-bound. Existing state cannot be read by AustinGarrod.ca, and an installed GitHub Pages app does not become the new installation automatically. Keep old browser data and all exported files until destination restore has been checked. Use these existing files, in order:

The four exports appear directly on the retirement page:

1. **Companion progress:** download **Export Companion progress**, then use **Backup & transfer → Restore Companion progress** in the new app. With only an original map profile saved, the action instead downloads the existing map JSON; restore it in **Ascension → Progress → Restore JSON backup**.
2. **Intentions:** download **Export intentions**, then use **Backup & transfer → Restore intentions**. This contains goals and crafting plans; legacy-only goals are normalized into the existing intentions format without writing old storage.
3. **Checkpoints:** download **Export checkpoints**, then restore through **Ascension → Progress → Progress checkpoints**.
4. **Saved comparison:** download **Export comparison**, then restore through **Ascension → Map options → Saved upgrade comparison**.

The reader uses existing bounded validators and exporters without initializing editable sessions. Missing documents display an empty state; invalid/unreadable documents disable only dependent exports and remain untouched. A present invalid canonical document never silently falls back to legacy data. Once a canonical document is seen, its removal during the visit cannot resurrect an old profile. Downloads reread their input keys and refuse a changed baseline. Storage events refresh the page; storage access failures have an explicit retry.

**Other saved copies** is a collapsed, conditional recovery disclosure. Valid conflicting legacy map/goals can be downloaded separately without merging or acknowledging either migration baseline. Restoring alternate intentions replaces destination intentions, including crafting plans. Keep the primary files too. Malformed raw storage is never exported as a supported backup or overwritten.

Comparison export and restore intentionally omit known unrevealed upgrades. Restore progress first and choose the intended destination spoiler setting before restoring comparison. Nothing silently enables spoilers. Reselect Game/Detailed Layout, spoiler visibility and tracking preferences on the new site. QR transfer is map progress/layout only. Session Undo history, recent navigation, open hypothetical plans and reference sheets do not migrate. The original map JSON format remains supported in Ascension for legacy-only users. Every import retains its existing preview, cancellation and validation.

## Ordered production rollout

Publication requires separate user authorization; implementation and artifact preparation do not publish either site.

1. Preserve the prior compatibility artifact and settings for rollback. Recheck current remote/Pages settings; the old source repository should remain archived with project Pages disabled, while `AustinGarrod/AustinGarrod.github.io` remains the compatibility host. Keep automated checks local or in isolated CI.
2. In that compatibility repository, replace both complete historical directories with the prepared directories, removing obsolete full-app chunks and offline map files. Update its owned root landing page from the generated landing page if still applicable; preserve unrelated files. Copy the sibling metadata/checksums to `release.json` and `SHA256SUMS` only if their inventory exactly matches the assembled `site/`; otherwise regenerate the complete manifest, counts and manifest hash while preserving unrelated site files.
3. Review source commit/dirty status, both retirement receipts, inventories and checksums, then publish through the existing Pages workflow. Do not republish the archived source project or deploy the retirement artifact to HostPapa.
4. Deliberately inspect both old addresses, section bookmarks, destination-link behavior and backup downloads manually. Reconnect and close every old controlled tab/app window before reopening online to receive the new worker. Confirm offline reopening separately.

Existing old workers intentionally keep their immutable release until all controlled windows close. An already cached copy can remain usable offline until the retirement update is downloaded and activated. There is no immediate offline revocation, `skipWaiting`, forced takeover or progress deletion. Each new worker removes only superseded caches within its own prefix. After activation, online and offline section navigation show only the transfer page. If cached files are evicted, the fallback gives the move message and reconnect guidance, never a usable map.

## Rollback and evidence

Restore a prior reviewed artifact only at its matching original prefix and without changing browser documents; never publish a website build at an old prefix. Reintroducing a usable historical app is a deliberate rollback decision, not an automatic fallback. Do not downgrade Companion state into map-only storage or clear browser data. The maintained website's destination restore flow and formats remain unchanged.

Record source and compatibility commits, workflow URLs, publication settings and deliberate manual readback separately. Local/CI success proves artifact behavior, not production delivery, physical installation continuity or analytics ingestion.
