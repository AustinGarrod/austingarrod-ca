<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/public/utilities/pokemon-binder/api/_market.php';
require_once dirname(__DIR__, 2) . '/server/pokedex-binder/refresh-market.php';
require_once dirname(__DIR__, 2) . '/server/pokedex-binder/refresh-tcgplayer-market.php';

function verify_market(mixed $expected, mixed $actual): void
{
    if ($actual !== $expected) {
        throw new RuntimeException('Expected ' . json_encode($expected) . ', received ' . json_encode($actual));
    }
}

function reject_market(callable $action): void
{
    try {
        $action();
    } catch (RuntimeException) {
        return;
    }
    throw new RuntimeException('Invalid market input was accepted.');
}

$catalog = ['test' => [
    '001' => ['normal' => [10, 'trend'], 'reverse' => [10, 'trend-holo']],
    '002' => ['holo' => [11, 'trend']],
    '003' => ['normal' => [12, 'trend']],
    '004' => ['normal' => [13, 'trend']],
]];
$targets = binder_market_targets($catalog);
$guide = ['version' => 1, 'createdAt' => '2026-11-22T02:45:23+0100', 'priceGuides' => [
    ['idProduct' => 10, 'trend' => 2, 'trend-holo' => 0.5],
    ['idProduct' => 11, 'trend' => 0, 'trend-holo' => 1],
    ['idProduct' => 12, 'trend' => 2],
    ['idProduct' => 12, 'trend' => 3],
    ['idProduct' => 13, 'trend' => '1.23'],
    ['idProduct' => 99, 'trend' => 99],
]];
$rates = ['observations' => [
    ['d' => '2026-11-23', 'FXEURCAD' => ['v' => '1.55']],
    ['d' => '2026-11-20', 'FXEURCAD' => ['v' => '1.50']],
    ['d' => '2026-11-19', 'FXEURCAD' => ['v' => '1.51']],
]];
$asOf = binder_market_as_of($guide);
verify_market('2026-11-22T02:45:23+01:00', $asOf->format(DATE_ATOM));
reject_market(static fn() => binder_market_as_of(['createdAt' => '2026-02-31T02:45:23+0100'] + $guide));
$rate = binder_market_exchange($rates, $asOf->format('Y-m-d'));
verify_market(1.5, $rate);
reject_market(static fn() => binder_market_exchange($rates, '2026-12-02'));
$prices = binder_market_convert($guide['priceGuides'], $targets, $rate);
verify_market([10 => [0 => 300, 1 => 75]], $prices);

$file = tempnam(sys_get_temp_dir(), 'binder-market-');
if ($file === false) {
    throw new RuntimeException('Could not create a temporary cache.');
}
try {
    $writer = binder_market_connect($file, false);
    $reader = binder_market_connect($file, true);
    $set = $catalog['test'];
    verify_market(2, binder_market_publish($writer, new DateTimeImmutable('2026-08-24T07:00:00Z'), $rate, $prices));
    reject_market(static fn() => binder_market_publish($writer, $asOf, $rate, []));
    verify_market(2, binder_market_publish($writer, new DateTimeImmutable('2026-10-02T07:00:00Z'), $rate, $prices));
    verify_market(2, binder_market_publish($writer, new DateTimeImmutable('2026-11-19T07:00:00Z'), $rate, [10 => [0 => 250, 1 => 60]]));
    verify_market(2, binder_market_publish($writer, $asOf, $rate, $prices));
    verify_market(2, binder_market_publish($writer, $asOf, $rate, $prices));
    verify_market(0, binder_market_publish($writer, $asOf->modify('-1 hour'), $rate, [10 => [0 => 999]]));

    $published = $asOf->format(DATE_ATOM);
    verify_market(['asOf' => $published, 'prices' => [
        ['number' => '001', 'variant' => 'normal', 'cents' => 300, 'observedAt' => $published],
        ['number' => '001', 'variant' => 'reverse', 'cents' => 75, 'observedAt' => $published],
    ]], binder_market_read($reader, $set, null));
    verify_market(['asOf' => $published, 'points' => [
        ['date' => '2026-11-19', 'cents' => 60],
        ['date' => '2026-11-22', 'cents' => 75],
    ]], binder_market_read($reader, $set, ['001', 'reverse', 30]));
    verify_market(['asOf' => $published, 'points' => [
        ['date' => '2026-10-02', 'cents' => 75],
        ['date' => '2026-11-19', 'cents' => 60],
        ['date' => '2026-11-22', 'cents' => 75],
    ]], binder_market_read($reader, $set, ['001', 'reverse', 90]));
    verify_market(['asOf' => $published, 'points' => []], binder_market_read($reader, $set, ['002', 'holo', 90]));
    verify_market(3, $reader->query('SELECT COUNT(*) FROM market_snapshots')->fetchColumn());
} finally {
    unset($reader, $writer);
    unlink($file);
}

$usdAsOf = binder_tcgplayer_market_date("2026-11-22T20:06:22+0000\n");
verify_market('2026-11-22T20:06:22+00:00', $usdAsOf->format(DATE_ATOM));
reject_market(static fn() => binder_tcgplayer_market_date('2026-11-31T20:06:22+0000'));
$usdRate = binder_market_exchange(['observations' => [
    ['d' => '2026-11-23', 'FXUSDCAD' => ['v' => '1.50']],
    ['d' => '2026-11-20', 'FXEURCAD' => ['v' => '1.55'], 'FXUSDCAD' => ['v' => '1.41']],
]], $usdAsOf->format('Y-m-d'), 'FXUSDCAD');
verify_market(1.41, $usdRate);
$usdCatalog = ['test' => [
    '001' => ['normal' => [10, 'Normal'], 'reverse' => [10, 'Reverse Holofoil']],
    '002' => ['holo' => [11, 'Holofoil']],
    '003' => ['normal' => [12, 'Normal']],
]];
$usdTargets = binder_market_targets($usdCatalog);
$row = static fn(int $product, string $printing, mixed $market): array => [
    'productId' => $product, 'subTypeName' => $printing, 'marketPrice' => $market, 'lowPrice' => 7.25,
];
$usdPrices = binder_tcgplayer_market_prices([
    $row(10, 'Normal', 0.5), $row(10, 'Reverse Holofoil', 2.5), $row(10, 'Holofoil', 4),
    $row(11, 'Holofoil', 2), $row(11, 'Holofoil', 3), $row(11, 'Holofoil', 4),
    $row(12, 'Normal', null), $row(99, 'Normal', 5),
], $usdTargets, $usdRate);
verify_market([10 => [2 => 71, 4 => 353]], $usdPrices);
$usdCache = new PDO('sqlite::memory:', null, null, [PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
verify_market(2, binder_market_publish($usdCache, $usdAsOf, $usdRate, $usdPrices, 'tcgplayer'));
reject_market(static fn() => binder_market_publish($usdCache, $usdAsOf->modify('+1 day'), $usdRate, [], 'tcgplayer'));
verify_market(['asOf' => $usdAsOf->format(DATE_ATOM), 'points' => [
    ['date' => '2026-11-22', 'cents' => 353],
]], binder_market_read($usdCache, $usdCatalog['test'], ['001', 'reverse', 90]));
verify_market(['asOf' => $usdAsOf->format(DATE_ATOM), 'points' => []],
    binder_market_read($usdCache, $usdCatalog['test'], ['002', 'holo', 90]));

echo "Market price conversion, refresh, and history checks passed.\n";
