# HostPapa accounts and utility sync

The site remains static Astro plus PHP. Accounts, sessions, email-code verification, Google sign-in, app documents, migration archives, and recovery copies live in HostPapa MySQL. Anonymous utilities and their existing backups continue to work when this backend is absent or disabled.

## Setup

1. Back up the **existing Binder database** and rehearse restoration into a separate database. Accounts must use that same database so copying a legacy collection and revoking its key can commit atomically.
2. Verify PHP **8.4 or newer**, PDO MySQL, OpenSSL, cURL, mbstring, outbound authenticated TLS SMTP, and outbound HTTPS to Google. Use a patched supported runtime. The public entry points remain parseable on PHP 7.4 and return an unavailable response before loading modern code; they do not upgrade the server automatically.
3. Install the root Composer lockfile before building. The account code loads `public/reporting/vendor/autoload.php` independently of the optional reporting bootstrap. Google signature verification also requires the pinned `phpseclib/phpseclib` package.
4. Copy `config.example.php` to `~/private/accounts.php` outside `public_html`. Use owner-only directory/file permissions (`0700`/`0600`), a new random secret, and a dedicated domain mailbox. Obtain actual SMTP hostname, TLS port, and credentials from cPanel rather than disabling certificate checks. An absolute trusted `ACCOUNTS_CONFIG` path may override the default.
5. Apply the additive schema using a separate setup user: `php server/accounts/migrate.php /absolute/private/accounts.php`. The CLI migration is repeatable and preserves existing tables and data. The Binder schema ledger remains version 1.
6. Use a runtime user with SELECT/INSERT/UPDATE/DELETE on the new account tables; it also needs SELECT/UPDATE on `pokedex_binders` and SELECT on `pokedex_binder_clients`. It needs no DDL or global privileges. Keep the legacy Binder runtime credentials separate.
7. Register a dedicated Google web OAuth client and exact callback `https://austingarrod.ca/api/v1/auth.php?action=google-callback`, requesting only `openid email`. Configure its consent branding and production publishing. Store its secret only in the private configuration.
   The public account disclosure is `https://austingarrod.ca/account/privacy/`; use the site homepage and that URL for the client branding/privacy configuration.
8. Deploy with both `enabled` and `migrationEnabled` false. Verify headers, private-file protection, backups, runtime, SMTP delivery, and Google login before enabling accounts, then migrations. The FTP artifact contains no runtime configuration or database dump. Public `/_*.php` helpers are denied by the API's scoped `.htaccess`.

Do not record auth request bodies, cookies, codes, Google tokens, key headers, email addresses, or saved state in error reporting or session replays. Provider callbacks immediately redirect to a clean account URL; configure host access logs to omit/redact query strings on the callback endpoint as well. Server diagnostics contain only a generated request ID. Auth/sync responses always use `Cache-Control: no-store` and must never enter a service-worker cache.

## Protocol and preservation

`/api/v1/auth.php` provides session discovery, emailed-code start/verify, Google start/callback, logout, and logout-all. Codes last ten minutes, allow five attempts, and have a sixty-second address cooldown. Their keyed hashes and opaque session-token hashes stay server-side. The host-only session cookie is Secure/HttpOnly/SameSite=Lax, with thirty-day inactivity and ninety-day absolute expiry. Mutations require the session CSRF token and exact configured Origin.

`/api/v1/sync.php` requires a signed-in session **and** `X-Account-ID` matching it on every read and mutation. Documents are registered by `(app, document)` and owned by immutable account UUID. The current registry is Binder `binder`, and Idle Slayer `progress`, `intentions`, `checkpoints`, `comparison`; Radius Map is intentionally absent. Each app document has strict versioned validation and its existing size bounds. Unknown Slayer catalogue IDs and canonical decimal strings are retained.

Writes use revision preconditions, device sequence acknowledgments, and operation IDs. Exact operation replay returns current state without applying an old mutation again. A stale revision returns `409` with the current document, preserving both copies. Every replaced server state gets a recovery copy. Devices retain their own durable outbox and must review a real divergent state before retrying.

Migration uploads each selected/device variant separately under one durable migration UUID, keeping individual requests within existing document limits. Reusing an ID with different staged content is rejected. First adoption commits all documents for the app together. Later `purpose: "conflict"` commits can cover a subset of existing documents, require both device and selected variants, and cannot claim a legacy key. Stages remain available for exact replay after a lost commit response.

A Binder migration additionally proves the private key through `X-Pokedex-Key` and supplies the reviewed legacy revision. One MySQL transaction locks the source, verifies all revisions/stages, preserves source/account/device/selected states and legacy acknowledgments, writes account documents, records the operation result, and sets the existing legacy `deleted_at` tombstone. Original state and acknowledgments remain archived; the key cannot be resurrected by old API code or claimed by another account. No raw key is stored in account tables. Switch local storage only after commit and verified readback.

Recovery list/read/restore/delete operations check ownership. Restoration saves the previous live state before creating another revision. Migration, conflict, and recovery copies are never automatically expired; deletion is explicit. Do not restore an older production database over newer saves as an application rollback. Keep account tables and key revocations when rolling back frontend assets, and preserve any newer device outboxes.

## Local verification

Run `node scripts/test-accounts-api.mjs` with `ACCOUNTS_TEST_DSN`, optional `ACCOUNTS_TEST_USER`/`ACCOUNTS_TEST_PASSWORD`, and optional `PHP_BINARY`. The DSN must use a loopback host. The harness creates a random `accounts_test_*` database and drops only that database; it uses real production handlers, two PHP processes, and a local SMTP sink to read and verify actual emailed codes. Its fixtures, configuration, and logs remain under ignored `tmp/`.

The harness checks CSRF/origin/account isolation, expired/reused/brute-forced codes, Google state/PKCE/cancellation, locally signed RSA tokens through Google's production verifier, concurrent writes, exact replay, migration revocation/archives, partial conflict resolution, large Slayer state, and recovery. It never contacts Google or production data. Live Google consent/callback, mailbox delivery, and hosting behavior still need separate owner-operated smoke tests before enabling production.

`npm run test:accounts:browser` uses the built `dist/`, a fresh isolated database and an actual loopback SMTP inbox to verify the account page, shared session, both utility migrations, retired legacy key, second browser, recovery and logout. It blocks external traffic and keeps screenshots/results under ignored `output/accounts-browser/`.

## Adding another utility

Register its document names and byte limits in `ACCOUNTS_DOCUMENT_LIMITS`, add a strict validator in the utility adapter section of `_validators.php`, and implement its browser storage/migration adapter using `packages/accounts/client.ts`. Complete adoption manifests are derived from that registry; authentication, sessions, CSRF, revisions, recovery, and the API routes do not change. Local entry routes under `/utilities/<slug>/` or `/apps/<slug>/` work as login return destinations. Add validation fixtures and a real migration/recovery browser scenario before enabling the adapter.

The browser adapter must retain originals, keep an immutable in-flight request until acknowledgement, use per-document device sequences, fence late responses by account/resource/revision, and switch its active namespace only after durable commit and checked readback. Missing, malformed and deliberately cleared documents are distinct cases. The server accepts only registered schema versions and never assumes an arbitrary JSON object is a valid save.
