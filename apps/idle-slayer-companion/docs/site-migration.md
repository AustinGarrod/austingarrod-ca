# Website consolidation and legacy recovery

The maintained source is now `apps/idle-slayer-companion/` in [AustinGarrod/austingarrod-ca](https://github.com/AustinGarrod/austingarrod-ca/tree/main/apps/idle-slayer-companion). The public utility is [Idle Slayer Companion](https://austingarrod.ca/utilities/idle-slayer-companion/). The former source repository is retained as archived history after verified cutover. Do not recreate either former repository name or remove existing source/issue redirects.

## Two deliberately separate artifacts

The default website build uses `/utilities/idle-slayer-companion/` and a new origin-specific installation identity. `COMPANION_DEPLOY_TARGET=legacy-migration` builds a frozen full Companion at `/idle-slayer-companion/` with the old `/idle-slayer-ascension-map/` installation identity and no analytics or technical reporting. A deployment profile sets navigation, manifests, worker scope, metadata and artifact validation together; changing only Vite base is unsupported.

From this app directory, run the pinned Yarn `build`, `check:release`, then `prepare:migration`. The generator independently builds the legacy profile into `.cache/legacy-migration-app`, validates it, and prepares `.cache/site-migration`. It never copies website-base bytes under historical paths and preserves the website source-map-upload receipt. It changes no hosting or repository settings.

The compatibility artifact contains the frozen full app at `/idle-slayer-companion/` and the previous-address launcher/read-only offline map-export fallback at `/idle-slayer-ascension-map/`, including known section entries. The old launcher forwards same-origin to the frozen full app when online. It strips arbitrary URL fields, retains supported public references or bounded map transfers, and never sends telemetry or writes saved progress. Explicit new-domain links forward only reviewed public references or successfully decoded map transfers. Every generated new-domain link includes the fixed `migration=1` marker, so the landing persists usage tracking off before URL cleanup. Plain links also retain `#analytics=off` as a visit-only fallback. Reopening the canonical app remains opted out until the user explicitly changes the preference.

## Guided transfer

Browser storage is origin-bound. Existing state cannot be read by AustinGarrod.ca, and an installed GitHub Pages app does not become the new installation automatically. Keep old browser data and all exported files until destination restore has been checked. Use these existing files, in order:

1. **Companion progress:** Backup & transfer → Export Companion progress; destination Restore Companion progress. This contains supported actual progress across the map and companion systems.
2. **Intentions:** Export intentions / Restore intentions in the same panel. This contains goals and crafting plans. Legacy-only goals are normalized by the existing workspace reader; review any recovery conflict before exporting.
3. **Checkpoints:** Ascension → Progress → Progress checkpoints → Export/Restore checkpoints.
4. **Saved comparison:** Ascension → Map options → Saved upgrade comparison → Export/Restore comparison.

Comparison export and restore intentionally omit known unrevealed upgrades. Restore progress first and choose the intended destination spoiler setting before restoring comparison. Nothing silently enables spoilers. Reselect Game/Detailed Layout, spoiler visibility and tracking preferences on the new site. QR transfer is map progress/layout only. Session Undo history, recent navigation, open hypothetical plans and reference sheets do not migrate. The original map JSON format remains supported in Ascension for legacy-only users. Every import retains its existing preview, cancellation and validation.

## Ordered production rollout

1. Preserve both prior hosting artifacts and settings for rollback. Deploy and manually verify the website utility, direct section loads, supported imports, backup downloads and installation metadata. Keep automated browser/API suites on localhost or isolated CI only.
2. Update the existing `AustinGarrod/AustinGarrod.github.io` compatibility repository, preserving unrelated files. Replace only its reviewed two legacy directories with `.cache/site-migration` output, then regenerate its existing checksum manifest and release metadata. Publish through its reviewed Pages workflow.
3. Verify both old paths, deep bookmarks, public-reference/map-transfer forwarding, migration guidance and exports. Keep existing workers and offline recovery files available. Old open windows keep their immutable release until all controlled windows close; reconnect and close/reopen old tabs and installed windows to receive the move notice. No `skipWaiting`, forced takeover or progress deletion is used. Each worker deletes only its own cache prefix.
4. Disable the former Companion project Pages deployment only after the compatibility host is ready. Confirm the compatibility host then serves the current old path as well as the older map path. Do not disable the compatibility host.
5. Update the old source repository README, homepage and description to the new utility and maintained source, confirm no new open work needs preservation, then archive it. Recheck the archived status and both historical addresses manually. Keep the local old checkout unchanged.

## Rollback and evidence

Restore the prior website artifact without changing browser documents. Restore old-prefix artifacts only at their matching original prefixes; never publish a website build at an old prefix. Keep the full frozen Companion and existing keys available while investigating. Do not downgrade Companion state into map-only storage or clear browser data.

Record source and compatibility commits, workflow URLs, publication settings and deliberate manual readback separately. Local/CI success proves artifact behavior, not production delivery, physical installation continuity or analytics ingestion.
