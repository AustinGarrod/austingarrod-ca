<?php

declare(strict_types=1);

require_once __DIR__ . '/_offers.php';

function binder_offer_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') {
    header('Allow: GET, POST');
    binder_offer_response(['error' => 'Method not allowed.'], 405);
    return;
}

$fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if ($fetchSite !== '' && $fetchSite !== 'same-origin') {
    binder_offer_response(['error' => 'Open Pokémon Binder Tracker to look up offers.'], 403);
    return;
}

try {
    $root = dirname(__DIR__, 3);
    if ($method === 'POST') {
        $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '', 2)[0]));
        if ($type !== 'application/json') {
            binder_offer_response(['error' => 'Send the batch as JSON.'], 415);
            return;
        }
        $body = file_get_contents('php://input', false, null, 0, 8193);
        if ($body === false || strlen($body) > 8192) {
            binder_offer_response(['error' => 'Store offer batch is too large.'], 413);
            return;
        }
        $targets = binder_offer_batch_targets($root, json_decode($body, true, 8));
        if ($targets === null) {
            binder_offer_response(['error' => 'Choose up to ten distinct card printings and known retailers.'], 400);
            return;
        }
        binder_offer_response(['results' => binder_offer_lookups($targets)]);
        return;
    }

    $target = binder_offer_target($root, $_GET);
    if ($target === null) {
        binder_offer_response(['error' => 'Choose a known card printing.'], 400);
        return;
    }
    $stores = binder_offer_stores($_GET['stores'] ?? null);
    if ($stores === null) {
        binder_offer_response(['error' => 'Choose known retailers.'], 400);
        return;
    }
    binder_offer_response(binder_offer_lookup($target, stores: $stores));
} catch (Throwable) {
    binder_offer_response(['error' => 'Store offers are temporarily unavailable.'], 503);
}
