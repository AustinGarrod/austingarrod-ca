# HostPapa utility MCP

Pokémon Binder Tracker and Idle Slayer Companion each expose a Streamable HTTP endpoint under
`/api/v1/mcp/`. They share the existing HostPapa account sign-in and MySQL documents.
The public installation instructions are at `/account/assistants/`. Codex and Claude
Code install from the repository marketplace. Claude web and Desktop use the same
remote URLs and the skill ZIPs generated from those plugins.
ChatGPT web uses the same URLs with OAuth and Client Identifier Metadata Documents (CIMD).

## Build and migrate

1. Install the ordinary Composer lock plus the isolated PHP 8.4 MCP lock using
   `composer -d server/mcp install --no-dev --prefer-dist --no-interaction`.
   Run `npm run generate:assets`, `npm run build`, and the usual artifact checks.
   GitHub Actions packages the SDK, private rule assets and ZIPs in `dist/`.
2. Verify the current account database and take a fresh backup. Run
   `php server/mcp/migrate.php /absolute/private/accounts-setup.php` as the
   schema setup user after the account schema exists. The additive DDL can run
   twice. Grant the account runtime its ordinary DML privileges on the four
   `accounts_mcp_*` tables. The runtime needs no DDL.
3. Use the current HostPapa FTPS workflow to deploy with both utility entries
   disabled. Keep production switches in a private sibling file named
   \`utility-mcp.json\` beside \`accounts.php\`. Its utility objects use the same
   keys as the \`mcp\` block in the example account config. An absent file uses
   the embedded config. An invalid file disables the MCP utility endpoints. Check the manifest commit, the
   canonical routes, and the scoped PHP handler. Direct web requests for
   `_mcp-data` and `_mcp-vendor` must be denied.
4. For a pilot, retain `enabled: false` on each MCP utility and put the test
   account UUID in `previewAccounts`. The public metadata and OAuth challenge
   remain reachable from hosted clients during the pilot. Consent and tokens
   are restricted to the designated accounts. Check each supported client
   using an isolated test account and save. Exercise connect, read, preview,
   confirm, website readback, and revoke.
5. After the client checks pass, clear the preview lists and set each utility's
   private `enabled` flag to true. To stop one endpoint, set its flag to false
   and clear its preview list. Recheck the disabled response. Keep the database,
   including all saves, recovery copies, and grant revocations.

## Authorization and writes

The account session is used for consent and grant management. MCP only accepts
bearer credentials. Its OAuth server recognizes the published ChatGPT, Codex,
Claude Code, and hosted Claude client IDs and validates their redirect URIs.
ChatGPT connections can only read. Their tool lists omit previews and writes.
Each grant belongs to one account, client, and utility. Access tokens last up to 15 minutes.
Refresh tokens rotate with a 30-day window and a 90-day connection lifetime.
Revocation and sign-out everywhere invalidate the corresponding token families.

The write tool takes a preview ID after the user confirms. Previews are bound
to a grant and expire after ten minutes. A successful apply receipt is retained
for a day to make retries idempotent. The commit verifies the affected
document revisions and rule inputs under the same account lock used by normal
sync. Writes require a previously adopted synced save, and each changed document
preserves its former version as a recovery copy.

Keep the OAuth and MCP paths out of site analytics, session replay, and body or
header logging. Use HTTPS and verify the deployed `Authorization` header survives
the HostPapa rewrite. Application diagnostics contain a random request ID in place
of tokens, account identities, preview data, and save content.

## Local checks

Run `npm run test:mcp:parity` after installing root dependencies. It compares
PHP with the Companion's TypeScript rules using the shipped catalogs, including
real prerequisite choices, dependent removals, Astral activity and Ultra Ascension.

After building `dist/`, run `npm run test:mcp` with the same loopback MySQL settings
documented in [the accounts runbook](../accounts/README.md) and with Playwright
Chromium installed. This exercises real deployed handlers and the consent UI using
an isolated `accounts_test_mcp_*` database and fixture browser sessions. GitHub
Actions runs these checks before deploying. Browser tests for hosted providers
still need a live pilot.
