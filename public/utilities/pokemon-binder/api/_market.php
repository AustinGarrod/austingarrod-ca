<?php
declare(strict_types=1);

function binder_market_cache_path(string $webroot, string $source = 'cardmarket'): ?string
{
    $root = realpath($webroot);
    if ($root === false) {
        throw new RuntimeException('The binder web root could not be found.');
    }
    [$setting, $filename] = match ($source) {
        'cardmarket' => ['POKEMON_BINDER_MARKET_CACHE', 'pokemon-binder-market.sqlite'],
        'tcgplayer' => ['POKEMON_BINDER_TCGPLAYER_CACHE', 'pokemon-binder-tcgplayer.sqlite'],
    };
    $configured = getenv($setting);
    $file = ($configured === false || $configured === '')
        ? dirname($root) . '/private/' . $filename
        : $configured;
    if (!str_starts_with($file, '/') && (DIRECTORY_SEPARATOR !== '\\' || !preg_match('~^[A-Za-z]:[/\\\\]~', $file))) {
        throw new RuntimeException('Use an absolute path for the market cache.');
    }

    $directory = realpath(dirname($file));
    if ($directory === false) {
        return null;
    }
    $normalize = static fn(string $value): string => DIRECTORY_SEPARATOR === '\\'
        ? strtolower(str_replace('\\', '/', $value))
        : $value;
    $normalizedRoot = rtrim($normalize($root), '/');
    $normalizedDirectory = $normalize($directory);
    $path = $directory . '/' . basename($file);
    if ($normalizedDirectory === $normalizedRoot || str_starts_with($normalizedDirectory, $normalizedRoot . '/') || is_link($path)) {
        throw new RuntimeException('The market cache must be outside the web root.');
    }
    return $path;
}

function binder_market_connect(string $file, bool $readOnly): PDO
{
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 5,
    ];
    if ($readOnly) {
        $options[Pdo\Sqlite::ATTR_OPEN_FLAGS] = Pdo\Sqlite::OPEN_READONLY;
    }
    return new PDO('sqlite:' . $file, null, null, $options);
}

function binder_market_catalog_data(string $webroot, string $source): array
{
    $file = $webroot . '/utilities/pokedex-binder/catalog/' . $source . '-printings.json';
    $json = json_decode(file_get_contents($file), true, 16, JSON_THROW_ON_ERROR);
    if (($json['schemaVersion'] ?? null) !== 1 || !is_array($json['sets'] ?? null)) {
        throw new RuntimeException('The market printing crosswalk is invalid.');
    }
    return $json;
}

function binder_market_catalog(string $webroot, string $source = 'cardmarket'): array
{
    return binder_market_catalog_data($webroot, $source)['sets'];
}

function binder_market_metric(string $field): int
{
    return match ($field) {
        'trend' => 0,
        'trend-holo' => 1,
        'Normal' => 2,
        'Holofoil' => 3,
        'Reverse Holofoil' => 4,
        'Unlimited' => 5,
        'Unlimited Holofoil' => 6,
        '1st Edition' => 7,
        '1st Edition Holofoil' => 8,
    };
}

function binder_market_latest_snapshot(PDO $db): ?array
{
    $row = $db->query('SELECT day, observed_at FROM market_snapshots ORDER BY day DESC LIMIT 1')->fetch();
    return $row === false ? null : $row;
}

/** A read transaction keeps the latest snapshot and its observations consistent. */
function binder_market_read(PDO $db, array $set, ?array $history): array
{
    $db->beginTransaction();
    try {
        $newest = binder_market_latest_snapshot($db);
        if ($newest === null) {
            return ['asOf' => null, $history === null ? 'prices' : 'points' => []];
        }
        $asOf = $newest['observed_at'];
        if ($history !== null) {
            [$number, $variant, $days] = $history;
            $mapping = $set[$number][$variant] ?? null;
            if ($mapping === null) {
                return ['asOf' => $asOf, 'points' => []];
            }
            [$product, $field] = $mapping;
            $cutoff = (new DateTimeImmutable($newest['day']))->modify('-' . ($days - 1) . ' days')->format('Y-m-d');
            $query = $db->prepare('SELECT day AS date, cents FROM market_prices WHERE product = ? AND metric = ? AND day >= ? ORDER BY day');
            $query->execute([$product, binder_market_metric($field), $cutoff]);
            return ['asOf' => $asOf, 'points' => $query->fetchAll()];
        }

        $targets = [];
        foreach ($set as $variants) {
            foreach ($variants as [$id, $field]) {
                $targets[$id] = true;
            }
        }
        $amounts = [];
        foreach (array_chunk(array_keys($targets), 400) as $products) {
            $placeholders = implode(',', array_fill(0, count($products), '?'));
            $query = $db->prepare('SELECT product, metric, cents FROM market_prices WHERE day = ? AND product IN (' . $placeholders . ')');
            $query->execute([$newest['day'], ...$products]);
            foreach ($query as $row) {
                $amounts[$row['product']][$row['metric']] = $row['cents'];
            }
        }

        $prices = [];
        foreach ($set as $number => $variants) {
            foreach ($variants as $variant => [$product, $field]) {
                $cents = $amounts[$product][binder_market_metric($field)] ?? null;
                if ($cents !== null) {
                    $prices[] = ['number' => (string) $number, 'variant' => $variant, 'cents' => $cents, 'observedAt' => $asOf];
                }
            }
        }
        return ['asOf' => $asOf, 'prices' => $prices];
    } finally {
        $db->rollBack();
    }
}
