# Local progress transfer

Companion compatibility: this format remains **Ascension progress and layout only**. Full tracked progress uses Companion JSON; goals and recipe plans use the intentions export. New links use `/idle-slayer-companion/`; the prepared old-address bridge forwards recognized legacy links without analytics. See [site migration](site-migration.md).

Open **Progress → Transfer to another device… → Create transfer snapshot**. The desktop browser generates a QR code locally. Scan it with the phone's normal camera, open the link, review the replacement, then choose **Apply transfer**. **Copy transfer link** supplies the fallback: open the map on the other device, choose **Progress → Receive transfer…**, and paste the link. Clipboard permission failures select the link for manual copying.

This is a snapshot of the current in-memory map profile and its Game/Detailed Layout preference. Ownership, exact purchase epochs, Astral activation, Ultra Ascension count, milestones, catalog revision, spoiler preference and unrecognized IDs are included. A tracking preference, native game file or unrelated native preference is never included. There are no accounts, transfer server, external QR service or continuing synchronization. Possession of a code or link allows its recipient to copy that profile; the UI asks users to share it privately.

Opening a link, receiving a paste, generating a code and cancelling keep progress unchanged. Received data is validated before preview and migrated using the same profile validation and catalog-revision rules as JSON backups. Preview counts use `visibleProgress` with the destination's current spoiler preference. The complete normalized profile is replaced only on confirmation, including hidden and unrecognized source records; destination-only records are replaced like a JSON restore. The incoming spoiler and layout preferences are then applied. The destination's tracking preference remains independent.

Undo restores the preceding progress profile and the transferred layout during this session; Redo reapplies both. A subsequent explicit layout selection remains independent and invalidates the transfer's layout history association. Ordinary JSON backups, restores, clear and progress undo retain their existing layout-independent contract. Profile or layout write failures retain usable in-memory progress/layout and report existing retry/export recovery or a layout-for-this-visit message. Cancelling, leaving the transfer dialog, unmounting or an external progress update invalidates pending generation/decoding and previews. Confirmation rechecks the current session before replacing anything.

A transfer link arriving in the current page supersedes the active progress interaction. It closes purchase/OR, clear/reset/history, restore/import, conflict and tracking-reload confirmations, invalidates pending file reads and privacy reload work, and cancels pending saving while retaining the in-memory profile and Undo history. One named transfer dialog owns the preview or validation feedback. Malformed arrivals also cancel the older interaction without applying either action; cancelling the receiver does not reopen it. A late game-file selection while receiving is ignored.

An incoming transfer also supersedes PWA update preparation or app-file repair, including a committed unregister whose later completion must not reload the received preview. Offline receipt and confirmed application remain local after a complete public release has been cached; tokens and transfer URLs never become cache entries. Installation works independently, and browser/installed-app storage sharing still depends on the platform.

## Transport and bounds

The version 1 envelope contains `format: "ISAM"`, `version: 1`, `layout` and an explicit encoding. The URL carries `#transfer=v1.<gzip-base64url>` on the map's existing base path. Browser-native [Compression Streams](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream) perform gzip compression/decompression; unsupported browsers can use the unchanged JSON backup route. Gzip's integrity checks and strict base64url/UTF-8/JSON validation reject incomplete or damaged input. This is a copy format, not proof of a sender's identity.

Compact encoding uses the immutable revision-specific ID dictionaries in `src/data/transfer-dictionaries.json`. Two bits per known upgrade retain unowned, active and pending ownership; reserved states are rejected. Known earlier purchase epochs are grouped into one-bit membership masks, preserving every exact epoch and activation flag. Known milestones use a separate one-bit mask. Unrecognized purchase/milestone IDs are explicit and lossless. Dictionary revisions, exact bit lengths, padding, duplicate records, membership and history bounds are checked before reconstructing a profile. A catalog without a matching dictionary uses a full-profile envelope instead. Both encodings pass the existing profile parser and portable export-size validation.

Keep historical dictionary entries unchanged when refreshing the catalog, and append a new entry for a new revision. Old compact transfers can then reconstruct their stable IDs and use normal migration, preserving removed IDs as unrecognized records. Unknown dictionary revisions are refused with a fresh-transfer/JSON-backup explanation. The current dictionary comes only from the reviewed normalized 7.2.0 catalog's upgrade and milestone IDs; it contains no player data or raw game inputs. Its order is regression-checked against that catalog.

The existing 4 MiB profile limit remains authoritative. Encoded input is capped before base64 decoding; decompressed bytes are counted as they arrive and cancelled above 4 MiB, including compression bombs. Validated canonical backup size is checked again after migration. No transfer is truncated or partially applied. Large supported snapshots keep the complete copy/paste link and JSON backup fallback.

QR generation uses the locally bundled `qrcode-generator` 2.0.4, byte mode, error correction M, black-on-white SVG and a four-module quiet zone. The code contains SVG paths only; payload text and URL references never enter its markup. A conservative version-20/666-byte ceiling avoids presenting progressively denser codes. The desktop code displays at up to 480px. A synthetic snapshot with all 288 upgrades, all nine milestones, current and earlier purchase history and mixed Astral activation produced a 344-byte local link and version-14 code (73 modules plus quiet zone); independent OpenCV decoding of the actual rendered PNG recovered the exact link. Extra unknown IDs or varied history can increase size, triggering the explicit fallback rather than discarding records.

## Privacy and verification

`main.tsx` starts a memory-only transfer inbox before `initializeAnalytics`, capturing and removing the initial fragment and later hash/history arrivals even while the catalog is loading. It queues only the latest arrival until the catalog and saved profile are ready; a later malformed link supersedes the older one, and navigation away cancels it. Navigation away also closes an active receiver and invalidates pending decoding. Superseded and consumed tokens are discarded without entering loading markup or browser storage. URL cleanup failure prevents tracker/recorder startup and displays a fixed recovery explanation. Fragments are absent from HTTP navigation/referrer URLs, and the existing analytics sanitizer retains only its canonical URL/referrer contract. The early listener runs before ordinary analytics hash listeners; the existing dirty-URL safeguard can keep tracking off for that visit without modifying the stored preference.

QR codes, transfer links, paste fields, previews, feedback and clipboard status are inside `.telemetry-private rr-block`. Only the existing bounded `transfer` panel value is added to usage events; exact counters, complete profiles, links and transfer payloads are never event properties. The real Umami 3.4 fixture verifies incoming URL removal before tracking, blocked QR/link/preview contents and fail-closed cleanup. Normal visible progress may be recorded after applying, as disclosed by the app's existing tracking policy. Heatmap click/scroll coordinates follow the existing exclusion limits.

Local production-bundle browser checks cover desktop generation and an isolated phone-sized browser receiving the link, cancel/paste/confirm/undo, exact profile and layout replacement, independent tracking preferences, storage failures, pending cancellation and current-spoiler previews. Deferred-catalog checks use the actual app with the isolated production analytics adapter and real recorder, with tracking both enabled and disabled; valid/malformed supersession and navigation cancellation retain progress, and captured requests/referrers/telemetry exclude transfer payloads. Unit checks cover lossless compact/full envelopes, revision migration, complete-catalog QR size, malformed records, unsupported versions, encoded/decompressed/canonical size caps and the early arrival queue. Independent image decoding establishes software readability of the generated code. Automated QR decoding and local production-build browser validation satisfy software acceptance. Physical-camera scanning and mobile-OS behavior remain unverified optional follow-up; they are not merge requirements.

Windows verification uses the repository's pinned Yarn:

```powershell
yarn install --immutable
yarn typecheck
yarn test
yarn build
yarn check:release
yarn preview --host 127.0.0.1 --port 4255 --strictPort
# In another PowerShell window:
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:4255/idle-slayer-ascension-map/'
yarn test:e2e tests/browser/progress-transfer.spec.ts
yarn test:e2e tests/browser/transfer-interruption.spec.ts
yarn test:e2e tests/browser/analytics.spec.ts --grep transfer
```

Automated checks stay on local/isolated builds. The QR dependency's published archive omits its full license file, so a committed Yarn patch adds only the complete MIT license from pinned upstream commit `83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8`. Its JavaScript is unchanged. The strict installed-byte notice manifest, distributed notice and generated license index cover that pinned dependency; no notice-validation exception is used.
