# Cardmarket price snapshots

The binder displays estimated market prices from Cardmarket’s daily Pokémon price guide. It matches explicit TCGdex product IDs to printings in the English binder catalog, then converts Cardmarket’s EUR product trend to CAD using the Bank of Canada’s latest published rate dated on or before the guide date. Weekends and holidays use the preceding published rate. Each guide price is a European market estimate for the Cardmarket product. [Cardmarket price data](https://www.cardmarket.com/en/Pokemon/Data/Price-Guide) · [Bank of Canada exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) · [TCGdex](https://tcgdex.dev/)

A printing has no estimate when its product and price series cannot be identified uniquely or the guide has no positive price. The cache keeps up to 90 days of published observations and starts recording history with the first successful refresh.

## HostPapa setup

1. Confirm that PHP 8.4 has `pdo_sqlite` enabled for web requests and that the CLI has `pdo_sqlite` and `curl` enabled.
2. Put `refresh-market.php` in the account’s private directory alongside `public_html`. Run it as the same hosting account that serves PHP so the web reader can access the SQLite file. The default location is `private/pokemon-binder-market.sqlite` alongside `public_html`. To override it, set the same absolute `POKEMON_BINDER_MARKET_CACHE` path in both the web and cron environments. The file must be outside the web root.
3. After deploying the web app, run an initial refresh. Substitute the account’s PHP 8.4 binary and actual web root.

```sh
php -d memory_limit=256M "$HOME/private/refresh-market.php" "$HOME/public_html"
```

4. Schedule that command daily through cPanel. Choose a server-local time after the Bank of Canada’s daily rate is published at about 4:30 p.m. Eastern. Capture cron output in the private directory to see the guide timestamp and the number of prices saved. A failed refresh leaves the previous snapshot available. Repeat an initial refresh after adding newly mapped printings if they need prices before the next scheduled run.
5. Open the market endpoint with `set=sv03.5` and confirm it reports a current `asOf` and positive prices. Query `set=sv03.5&number=001&variant=reverse&days=30` and confirm it reports the dated CAD price for that exact printing. Before the first successful refresh, both endpoints return empty data with `asOf: null`.

## Local maintenance

`npm run refresh:pokedex` regenerates the crosswalk with the pinned source catalog. To rebuild just the crosswalk, run `node scripts/refresh-pokedex-cardmarket-ids.mjs`.

Run `php tests/pokedex-binder/market.test.php` with `pdo_sqlite` enabled to verify currency conversion, cache replacement, retention, and history using fixtures. The refresh command above can be run against the repository’s `public` directory with `POKEMON_BINDER_MARKET_CACHE` pointing to an ignored local file outside `public`.
