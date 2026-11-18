# Private-key retirement

The former Binder API responds with HTTP 410 for every method. Guest progress is saved in IndexedDB. Account sync supports the National Pokédex and named set binders. An upgraded browser retains its last saved collection, including unsynced marks.

For the release, deploy the retired endpoint and account handlers first. Run `retire-keys.sql` in the existing Binder database with a maintenance account. It atomically clears active legacy payloads and their acknowledgments and tombstones their key digests. Re-running the script is safe. Previously migrated archives, account recovery copies, and existing revocations stay intact. Keep the retirement endpoint in place on any frontend rollback.

Run `npm run test:pokedex:api` with a loopback `POKEDEX_TEST_DSN` and optional `POKEDEX_TEST_USER` and `POKEDEX_TEST_PASSWORD` to rehearse retirement in a randomly named test database. The separate [accounts guide](../accounts/README.md) covers active sync and recovery.
