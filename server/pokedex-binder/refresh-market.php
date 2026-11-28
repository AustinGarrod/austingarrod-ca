<?php
declare(strict_types=1);

const BINDER_CARDMARKET_GUIDE = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const BINDER_EUR_CAD_RATES = 'https://www.bankofcanada.ca/valet/observations/FXEURCAD/json?recent=12';

function binder_market_fetch(string $url, int $limit): string
{
    $body = '';
    $request = curl_init($url);
    curl_setopt_array($request, [
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_USERAGENT => 'Pokemon Binder Tracker market refresh',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_ENCODING => '',
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, $limit): int {
            if (strlen($body) + strlen($chunk) > $limit) {
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) {
        curl_setopt($request, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
    }
    $ok = curl_exec($request);
    $status = curl_getinfo($request, CURLINFO_RESPONSE_CODE);
    $failure = curl_error($request);
    curl_close($request);
    if ($ok === false || $status !== 200) {
        throw new RuntimeException('Unable to download ' . $url . ($failure === '' ? ' (HTTP ' . $status . ').' : ' (' . $failure . ').'));
    }
    return $body;
}

function binder_market_as_of(array $guide): DateTimeImmutable
{
    $published = $guide['createdAt'] ?? null;
    if (($guide['version'] ?? null) !== 1 || !is_array($guide['priceGuides'] ?? null) ||
        !is_string($published) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/D', $published)) {
        throw new RuntimeException('The Cardmarket price guide format has changed.');
    }
    $asOf = new DateTimeImmutable($published);
    if (DateTimeImmutable::getLastErrors() !== false) {
        throw new RuntimeException('The Cardmarket observation date is invalid.');
    }
    return $asOf;
}

function binder_market_exchange(array $rates, string $day, string $series = 'FXEURCAD'): float
{
    $rate = null;
    $rateDate = '';
    // Weekends and bank holidays use the most recent preceding business day's published rate.
    foreach ($rates['observations'] ?? [] as $observation) {
        $date = $observation['d'] ?? null;
        $value = $observation[$series]['v'] ?? null;
        if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) && $date <= $day && $date > $rateDate
            && is_numeric($value) && is_finite((float) $value) && (float) $value > 0) {
            $rateDate = $date;
            $rate = (float) $value;
        }
    }
    $cutoff = (new DateTimeImmutable($day))->modify('-7 days')->format('Y-m-d');
    if ($rate === null || $rateDate < $cutoff) {
        throw new RuntimeException('No recent Bank of Canada ' . $series . ' rate is available for ' . $day . '.');
    }
    return $rate;
}

function binder_market_targets(array $catalog): array
{
    $targets = [];
    foreach ($catalog as $set) {
        foreach ($set as $variants) {
            foreach ($variants as [$product, $field]) {
                $targets[$product][$field] = binder_market_metric($field);
            }
        }
    }
    return $targets;
}

function binder_market_convert(array $guideRows, array $targets, float $rate): array
{
    $prices = [];
    $seen = [];
    foreach ($guideRows as $row) {
        $product = $row['idProduct'] ?? null;
        if (!is_int($product) || !isset($targets[$product])) {
            continue;
        }
        if (isset($seen[$product])) {
            unset($prices[$product]);
            continue;
        }
        $seen[$product] = true;
        foreach ($targets[$product] as $field => $metric) {
            $cents = binder_market_cents($row[$field] ?? null, $rate);
            if ($cents !== null) {
                $prices[$product][$metric] = $cents;
            }
        }
    }
    return $prices;
}

function binder_market_cents(mixed $value, float $rate): ?int
{
    if ((!is_float($value) && !is_int($value)) || !is_finite((float) $value) || $value <= 0) {
        return null;
    }
    $cents = round($value * $rate * 100, 0, PHP_ROUND_HALF_UP);
    return $cents >= 1 && $cents <= 9007199254740991 ? (int) $cents : null;
}

function binder_market_publish(PDO $db, DateTimeImmutable $asOf, float $rate, array $prices, string $source = 'cardmarket'): int
{
    if (!$prices) {
        throw new RuntimeException('The refresh returned no usable printing prices.');
    }
    $column = match ($source) { 'cardmarket' => 'eur_cad', 'tcgplayer' => 'usd_cad' };
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec("CREATE TABLE IF NOT EXISTS market_snapshots (
        day TEXT PRIMARY KEY, observed_at TEXT NOT NULL, $column REAL NOT NULL
    ) WITHOUT ROWID");
    $db->exec('CREATE TABLE IF NOT EXISTS market_prices (
        day TEXT NOT NULL REFERENCES market_snapshots(day) ON DELETE CASCADE,
        product INTEGER NOT NULL, metric INTEGER NOT NULL, cents INTEGER NOT NULL,
        PRIMARY KEY (day, product, metric)
    ) WITHOUT ROWID');
    $db->exec('CREATE INDEX IF NOT EXISTS market_price_history ON market_prices(product, metric, day)');
    $db->exec('BEGIN IMMEDIATE');
    try {
        $day = $asOf->format('Y-m-d');
        $previous = $db->prepare('SELECT observed_at FROM market_snapshots WHERE day = ?');
        $previous->execute([$day]);
        $oldAsOf = $previous->fetchColumn();
        if ($oldAsOf !== false && new DateTimeImmutable($oldAsOf) > $asOf) {
            $db->exec('COMMIT');
            return 0;
        }

        $db->prepare('DELETE FROM market_snapshots WHERE day = ?')->execute([$day]);
        $db->prepare("INSERT INTO market_snapshots(day, observed_at, $column) VALUES (?, ?, ?)")
            ->execute([$day, $asOf->format(DATE_ATOM), $rate]);
        $insert = $db->prepare('INSERT INTO market_prices(day, product, metric, cents) VALUES (?, ?, ?, ?)');
        $count = 0;
        foreach ($prices as $product => $metrics) {
            foreach ($metrics as $metric => $cents) {
                $insert->execute([$day, $product, $metric, $cents]);
                $count++;
            }
        }
        $db->exec("DELETE FROM market_snapshots WHERE day < date((SELECT MAX(day) FROM market_snapshots), '-89 days')");
        $db->exec('COMMIT');
        return $count;
    } catch (Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') !== __FILE__) {
    return;
}
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
if ($argc !== 2 || !is_dir($argv[1]) || !extension_loaded('curl') || !extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "Usage: php refresh-market.php /absolute/site/webroot (requires curl and pdo_sqlite)\n");
    exit(1);
}

umask(0077);
try {
    $root = realpath($argv[1]);
    require_once $root . '/utilities/pokemon-binder/api/_market.php';
    $file = binder_market_cache_path($root);
    if ($file === null) {
        throw new RuntimeException('Create the private cache directory before refreshing prices.');
    }
    $targets = binder_market_targets(binder_market_catalog($root));
    $guide = json_decode(binder_market_fetch(BINDER_CARDMARKET_GUIDE, 32 * 1024 * 1024), true, 12, JSON_THROW_ON_ERROR);
    $asOf = binder_market_as_of($guide);
    $rates = json_decode(binder_market_fetch(BINDER_EUR_CAD_RATES, 64 * 1024), true, 12, JSON_THROW_ON_ERROR);
    $rate = binder_market_exchange($rates, $asOf->format('Y-m-d'));
    $prices = binder_market_convert($guide['priceGuides'], $targets, $rate);
    unset($guide);
    $db = binder_market_connect($file, false);
    $count = binder_market_publish($db, $asOf, $rate, $prices);
    fwrite(STDOUT, 'Cardmarket ' . $asOf->format(DATE_ATOM) . ': ' . $count . " printing prices saved.\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
