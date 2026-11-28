<?php
declare(strict_types=1);

require_once __DIR__ . '/refresh-market.php';

const BINDER_TCGCSV = 'https://tcgcsv.com';
const BINDER_USD_CAD_RATES = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=12';

function binder_tcgplayer_market_date(string $marker): DateTimeImmutable
{
    $timestamp = trim($marker);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/D', $timestamp)) {
        throw new RuntimeException('The TCGCSV snapshot timestamp is invalid.');
    }
    $asOf = new DateTimeImmutable($timestamp);
    if (DateTimeImmutable::getLastErrors() !== false || $asOf > new DateTimeImmutable('+5 minutes')) {
        throw new RuntimeException('The TCGCSV snapshot timestamp is invalid.');
    }
    return $asOf->setTimezone(new DateTimeZone('UTC'));
}

function binder_tcgplayer_market_prices(iterable $rows, array $targets, float $rate): array
{
    $seen = [];
    $prices = [];
    foreach ($rows as $row) {
        $product = $row['productId'] ?? null;
        $printing = $row['subTypeName'] ?? null;
        if (!is_int($product) || !is_string($printing) || !isset($targets[$product][$printing])) {
            continue;
        }
        $metric = $targets[$product][$printing];
        if (isset($seen[$product][$metric])) {
            unset($prices[$product][$metric]);
            continue;
        }
        $seen[$product][$metric] = true;
        $cents = binder_market_cents($row['marketPrice'] ?? null, $rate);
        if ($cents !== null) {
            $prices[$product][$metric] = $cents;
        }
    }
    return array_filter($prices);
}

function binder_tcgplayer_market_rows(array $groups): Generator
{
    foreach ($groups as $group) {
        if (!is_int($group) || $group < 1) {
            throw new RuntimeException('The TCGplayer group crosswalk is invalid.');
        }
        usleep(150_000);
        $response = json_decode(binder_market_fetch(BINDER_TCGCSV . "/tcgplayer/3/$group/prices", 8 * 1024 * 1024),
            true, 12, JSON_THROW_ON_ERROR);
        if (($response['success'] ?? null) !== true || !is_array($response['results'] ?? null) || !array_is_list($response['results'])) {
            throw new RuntimeException('TCGCSV returned an invalid response for group ' . $group . '.');
        }
        yield from $response['results'];
    }
}

function binder_tcgplayer_market_refresh(string $webroot, bool $rebuild = false): void
{
    $source = 'tcgplayer';
    $file = binder_market_cache_path($webroot, $source);
    if ($file === null) {
        throw new RuntimeException('Create the private cache directory before refreshing prices.');
    }
    $lock = fopen($file . '.lock', 'c');
    if ($lock === false) {
        throw new RuntimeException('Could not open the TCGplayer refresh lock.');
    }
    try {
        if (!flock($lock, LOCK_EX | LOCK_NB)) {
            fwrite(STDOUT, "TCGplayer refresh already running.\n");
            return;
        }
        $asOf = binder_tcgplayer_market_date(binder_market_fetch(BINDER_TCGCSV . '/last-updated.txt', 1024));
        if (is_file($file)) {
            $db = binder_market_connect($file, true);
            $exists = $db->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'market_snapshots'")->fetchColumn();
            $previous = $exists ? $db->query('SELECT observed_at FROM market_snapshots ORDER BY day DESC LIMIT 1')->fetchColumn() : false;
            unset($db);
            $published = $previous === false ? null : new DateTimeImmutable($previous);
            if ($published !== null && ($published > $asOf || ($published == $asOf && !$rebuild))) {
                fwrite(STDOUT, 'TCGplayer already published through ' . $previous . ".\n");
                return;
            }
        }
        $catalog = binder_market_catalog_data($webroot, $source);
        $groups = $catalog['groups'] ?? [];
        if (!is_array($groups) || !$groups || count($groups) !== count(array_unique($groups))) {
            throw new RuntimeException('The TCGplayer group crosswalk is invalid.');
        }
        $targets = binder_market_targets($catalog['sets']);
        $rates = json_decode(binder_market_fetch(BINDER_USD_CAD_RATES, 64 * 1024), true, 12, JSON_THROW_ON_ERROR);
        $rate = binder_market_exchange($rates, $asOf->format('Y-m-d'), 'FXUSDCAD');
        $prices = binder_tcgplayer_market_prices(binder_tcgplayer_market_rows($groups), $targets, $rate);
        $latest = binder_tcgplayer_market_date(binder_market_fetch(BINDER_TCGCSV . '/last-updated.txt', 1024));
        if ($latest != $asOf) {
            throw new RuntimeException('The TCGCSV snapshot changed during the refresh.');
        }
        $db = binder_market_connect($file, false);
        $count = binder_market_publish($db, $asOf, $rate, $prices, $source);
        fwrite(STDOUT, 'TCGplayer ' . $asOf->format(DATE_ATOM) . ': ' . $count . " printing prices saved.\n");
    } finally {
        fclose($lock);
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') !== __FILE__) {
    return;
}
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$rebuild = $argc === 3 && $argv[2] === '--rebuild';
if (($argc !== 2 && !$rebuild) || !is_dir($argv[1]) || !extension_loaded('curl') || !extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "Usage: php refresh-tcgplayer-market.php /absolute/site/webroot [--rebuild] (requires curl and pdo_sqlite)\n");
    exit(1);
}

umask(0077);
try {
    $root = realpath($argv[1]);
    require_once $root . '/utilities/pokemon-binder/api/_market.php';
    if (!function_exists('binder_market_catalog_data')) {
        throw new RuntimeException('Deploy the TCGplayer market reader before refreshing prices.');
    }
    binder_tcgplayer_market_refresh($root, $rebuild);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
