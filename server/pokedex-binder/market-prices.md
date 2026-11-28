# Binder market price snapshots

The binder displays TCGplayer Market Price, which reflects recent completed sales. TCGCSV publishes this data daily in USD. The refresh converts each amount to CAD using the latest Bank of Canada USD/CAD observation dated on or before the feed date. The estimate covers the exact English printing when it can be matched uniquely. The cache retains up to 90 days of TCGplayer observations. [TCGplayer Market Price](https://help.tcgplayer.com/hc/en-us/articles/222376867-What-do-the-different-price-points-on-TCGplayer-com-mean) · [TCGCSV](https://tcgcsv.com/docs) · [Bank of Canada exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/)

## TCGplayer refresh on HostPapa

1. Keep `refresh-tcgplayer-market.php` and its `refresh-market.php` dependency together in a private directory outside `public_html`. Run the PHP 8.4 CLI with `curl` and `pdo_sqlite` as the hosting account that serves the site.
2. Run the refresh against the release webroot. To seed ahead of deployment, run it locally against the release's `public` directory and upload the resulting SQLite file only to the hosting account's private directory with owner-only permissions. The default path is `private/pokemon-binder-tcgplayer.sqlite` alongside `public_html`. Set the same absolute `POKEMON_BINDER_TCGPLAYER_CACHE` path in the web and CLI environments to override it.
3. Schedule the refresh once daily in cPanel after both sources publish. Use a private log. The feed timestamp prevents repeated downloads and a failed refresh leaves the last successful snapshot available.

```sh
/opt/alt/php84/usr/bin/php -d memory_limit=256M "$HOME/private/pokemon-binder-tcgplayer/refresh-tcgplayer-market.php" "$HOME/public_html"
```

4. Verify both the `set=sv03.5&source=tcgplayer` response and the exact history request with `set=sv03.5&source=tcgplayer&number=001&variant=reverse&days=30`. A fresh cache starts with one observation per priced printing.

The regular catalog refresh regenerates the TCGplayer market crosswalk with the transfer IDs. To refresh just these two crosswalks, run `npm run refresh:pokedex:transfer-ids`.

## Cardmarket compatibility

Requests with no `source` parameter still serve Cardmarket data to older open tabs. This price guide matches explicit TCGdex product IDs to English printings, then converts Cardmarket’s EUR trend to CAD using the latest Bank of Canada rate dated on or before the guide date. Each observation reflects the European market. [Cardmarket price data](https://www.cardmarket.com/en/Pokemon/Data/Price-Guide) · [Bank of Canada exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) · [TCGdex](https://tcgdex.dev/)

A printing has no estimate when its product and price series cannot be identified uniquely or the guide has no positive price. The cache keeps up to 90 days of published observations and starts recording history with the first successful refresh.

### HostPapa setup

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

Run `php tests/pokedex-binder/market.test.php` with `pdo_sqlite` enabled to verify both feeds' currency conversion, cache replacement, retention, and history using fixtures. Either refresh command can run against the repository's `public` directory with its cache environment variable pointing to an ignored local file outside `public`.
