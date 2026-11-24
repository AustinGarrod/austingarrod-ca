# Private-key retirement

The former Binder API responds with HTTP 410 for every method. Guest progress is saved in IndexedDB. Account sync supports the National Pokédex and named set binders. An upgraded browser retains its last saved collection, including unsynced marks.

For the release, deploy the retired endpoint and account handlers first. Run `retire-keys.sql` in the existing Binder database with a maintenance account. It atomically clears active legacy payloads and their acknowledgments and tombstones their key digests. Re-running the script is safe. Previously migrated archives, account recovery copies, and existing revocations stay intact. Keep the retirement endpoint in place on any frontend rollback.

Run `npm run test:pokedex:api` with a loopback `POKEDEX_TEST_DSN` and optional `POKEDEX_TEST_USER` and `POKEDEX_TEST_PASSWORD` to rehearse retirement in a randomly named test database. The separate [accounts guide](../accounts/README.md) covers active sync and recovery.

The [Cardmarket snapshot guide](market-prices.md) covers the private cache and its daily refresh.

## Canadian store offers

The pricing endpoint uses Shopify's read-only Storefront Catalog to check 401 Games, Deck Out Gaming, and Skyfox Games. It needs PHP 8.4 with cURL enabled. APCu is optional and caches each store's response for nine minutes. Each lookup checks online availability, and the card view links to the quoted condition. [Shopify Storefront Catalog](https://shopify.dev/docs/agents/catalog/storefront-catalog)

After deployment, confirm that `/utilities/pokemon-binder/shopify-profile.json` is publicly reachable over HTTPS. Open Buy Cards and compare an exact printing with a known offer from each store. The pre-release checks used 151 Jolteon #135 reverse holo for 401 Games, 151 Electrode #101 reverse holo for Deck Out Gaming, and Team Rocket Dark Hypno #9 Unlimited holo for Skyfox Games. Verify the finish, condition, CAD price, and selected variant on the store page. Use another known in-stock printing if availability has changed.
