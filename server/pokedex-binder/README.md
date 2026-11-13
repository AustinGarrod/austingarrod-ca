# Pokédex Binder database setup

The static site deploys the PHP API; it never deploys credentials or runs database migrations. The core API requires PHP 7.4+, PDO MySQL, and MySQL/MariaDB with InnoDB. Optional Sentry reporting requires PHP 8.1+ and stays disabled on older runtimes; collection and sync behavior do not depend on it.

1. Create a dedicated database in cPanel. Apply `schema.sql` through phpMyAdmin, or run `php server/pokedex-binder/migrate.php /absolute/private/config.php` using a database setup user with DDL privileges. The version 1 migration is repeatable and preserves existing binders.
2. Create a separate runtime database user with SELECT, INSERT, UPDATE, and DELETE privileges on these tables. Do not give that user global privileges.
3. Copy `config.example.php` to `~/private/pokedex-binder.php` outside `public_html`; set its actual DSN, runtime credentials, private rate-limit directory, and a random secret. Restrict the configuration file to the account owner (`0600`) and private directory to `0700`. Set trusted `POKEDEX_CONFIG` to an absolute path if using another location. Never place it inside `public/`, `dist/`, or the FTP upload root.
4. Deploy the ordinary static-plus-PHP output. Verify through ordinary browser interactions that create/connect/sync/delete work, keys remain out of URLs, and API responses send `Cache-Control: no-store`. Keep cPanel database backups separate from static files. Repeated FTPS deployments do not modify the database or private configuration.

Only a SHA-256 digest of each random private key is stored. A key grants read/write/delete access to one binder; there is no account recovery. Deleting a binder permanently clears its collection and client acknowledgments, retaining the key digest as a revocation tombstone so a delayed create retry cannot reactivate it. Request bodies and the `X-Pokedex-Key` header must be scrubbed from browser/PHP telemetry. The API logs only safe operation stages and request IDs. Rate limiting uses private HMAC-addressed files and fails closed if its state cannot be persisted.

## Local database integration checks

Start an isolated MySQL/MariaDB listening only on localhost. Enable the PHP PDO MySQL extension, then set `POKEDEX_TEST_DSN` (for example `mysql:host=127.0.0.1;port=3306;charset=utf8mb4`), `POKEDEX_TEST_USER`, and `POKEDEX_TEST_PASSWORD`; `PHP_BINARY` is optional. Run `node scripts/test-pokedex-api.mjs`.

The test helper rejects remote hosts. Each run creates a random `pokedex_test_*` database, uses two localhost PHP processes to exercise real concurrent transactions, then drops only that generated database. Its configuration and limiter files stay under ignored `tmp/`. It uses a small species fixture to prove validation follows the catalog IDs rather than a fixed maximum. No production requests or migrations are made.
