# Private-key retirement

The former Binder API responds with HTTP 410 for every method. Guest progress is saved in IndexedDB. Account sync supports the National Pokédex and named set binders. An upgraded browser retains its last saved collection, including unsynced marks.

For the release, deploy the retired endpoint and account handlers first. Run `retire-keys.sql` in the existing Binder database with a maintenance account. It atomically clears active legacy payloads and their acknowledgments and tombstones their key digests. Re-running the script is safe. Previously migrated archives, account recovery copies, and existing revocations stay intact. Keep the retirement endpoint in place on any frontend rollback.

Run `npm run test:pokedex:api` with a loopback `POKEDEX_TEST_DSN` and optional `POKEDEX_TEST_USER` and `POKEDEX_TEST_PASSWORD` to rehearse retirement in a randomly named test database. The separate [accounts guide](../accounts/README.md) covers active sync and recovery.

The [Cardmarket snapshot guide](market-prices.md) covers the private cache and its daily refresh.

## Store offers in CAD

The pricing endpoint uses Shopify’s read-only Storefront Catalog. The browser and PHP share the retailer list in `public/utilities/pokemon-binder/retailers.json`. It includes 401 Games, Deck Out Gaming, Skyfox Games, Danireon, Dungeon Comics & Cards, Le Coin du Jeu, Space Social, Swirl Café & Games, and US-based Pokemon Plug. Lookups use the Canadian market and accept CAD quotes. The card view links to the in-stock variant for the quoted condition. PHP 8.4 and cURL are required. APCu is optional and caches each store's response for nine minutes. [Shopify Storefront Catalog](https://shopify.dev/docs/agents/catalog/storefront-catalog)

Set up a Catalog API identity in Shopify Dev Dashboard under **Agents**. Provision its `client_id` and `client_secret` in `~/private/shopify-catalog.json` with owner-only permissions outside `public_html`. PHP exchanges the credentials for a short-lived token and keeps it in `~/private/shopify-catalog-token.json`. Keep both files out of release artifacts and public backups. Authenticated storefront calls send the web server's validated public buyer IP to Shopify. [Shopify authentication](https://shopify.dev/docs/agents/get-started/authentication) · [Shopify buyer IP and rate limits](https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting)

Authenticated checks follow Shopify's per-retailer `Retry-After` responses with a shared cooldown across PHP workers. Buy Cards keeps checking available retailers, retains fresh quotes, and retries only the deferred stores. Unauthenticated fallback has a shared rolling limit of 24 uncached printings per minute. The response uses `retryAfter` for that shared wait and `storeRetryAfter` for retailer-specific waits. An optional `stores` query limits a retry to named supported stores.

Buy Cards can check all supported missing printings in the selected binder scope. Recently checked printings on the visible Buy Cards page refresh after expiry while the tab is visible.

After deployment, confirm that `/utilities/pokemon-binder/shopify-profile.json` is publicly reachable over HTTPS with `Cache-Control: public, max-age=3600`. Open Buy Cards and compare exact printings. For example, check 30th Celebration Pikachu #027 stamped holo at Swirl Café & Games and Diamond & Pearl Weavile #40 reverse holo at Pokemon Plug. Check the finish, condition, CAD price, and selected variant on each store page. Use another currently stocked printing if inventory has changed. [UCP profile hosting requirements](https://ucp.dev/specification/overview/#hosting)
