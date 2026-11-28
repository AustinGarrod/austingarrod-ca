<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/_market.php';

function binder_market_reply(int $code, array $payload): never
{
    http_response_code($code);
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    binder_market_reply(405, ['error' => 'Only GET is supported.']);
}

$set = $_GET['set'] ?? null;
$number = $_GET['number'] ?? null;
$variant = $_GET['variant'] ?? null;
$days = $_GET['days'] ?? null;
$source = $_GET['source'] ?? 'cardmarket';
$history = $number !== null || $variant !== null || $days !== null;
$allowed = $history ? ['set', 'source', 'number', 'variant', 'days'] : ['set', 'source'];
if (array_diff(array_keys($_GET), $allowed) || !in_array($source, ['cardmarket', 'tcgplayer'], true)
    || !is_string($set) || !preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/D', $set)
    || ($history && (!is_string($number) || $number === '' || strlen($number) > 48 || !is_string($variant) ||
        $variant === '' || strlen($variant) > 200 || !in_array($days, ['30', '90'], true)))) {
    binder_market_reply(400, ['error' => 'Invalid market price query.']);
}

try {
    $webroot = dirname(__DIR__, 3);
    $catalog = $webroot . '/utilities/pokedex-binder/catalog/master-sets/';
    if ($set === 'index' || !is_file($catalog . $set . '.json')) {
        binder_market_reply(404, ['error' => 'Unknown set.']);
    }
    if ($history) {
        $cards = json_decode(file_get_contents($catalog . $set . '.json'), true, 16, JSON_THROW_ON_ERROR);
        $known = false;
        foreach ($cards as $card) {
            if ($card['number'] === $number) {
                $known = in_array($variant, array_column($card['variants'], 'id'), true);
                break;
            }
        }
        if (!$known) {
            binder_market_reply(404, ['error' => 'Unknown printing.']);
        }
    }
    $file = binder_market_cache_path($webroot, $source);
    if ($file === null || !is_file($file)) {
        binder_market_reply(200, ['asOf' => null, $history ? 'points' : 'prices' => []]);
    }

    $mapping = binder_market_catalog($webroot, $source)[$set] ?? [];
    $db = binder_market_connect($file, true);
    binder_market_reply(200, binder_market_read($db, $mapping, $history ? [$number, $variant, (int) $days] : null));
} catch (Throwable $error) {
    binder_market_reply(503, ['error' => 'Market prices are temporarily unavailable.']);
}
