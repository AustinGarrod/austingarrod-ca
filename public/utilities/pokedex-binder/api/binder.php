<?php
declare(strict_types=1);
require_once __DIR__ . '/_library.php';
require_once dirname(__DIR__, 3) . '/reporting/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
$requestId = bin2hex(random_bytes(16));
header('X-Request-ID: ' . $requestId);
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
$stage = 'configuration';
try {
    if (!in_array($method, ['GET', 'POST', 'PATCH', 'DELETE'], true)) {
        header('Allow: GET, POST, PATCH, DELETE');
        throw new PokedexApiError(405, 'method_not_allowed', 'This request method is not supported.');
    }
    $webroot = dirname(__DIR__, 3);
    $config = pokedex_configuration($webroot);
    if ((isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $config['allowedOrigin']) || (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site')) throw new PokedexApiError(403, 'origin_not_allowed', 'Open this utility on its own website to sync.');
    $stage = 'rate_limit';
    pokedex_rate_limit($config, $webroot, 'requests', 120, 60);
    try { $keyHash = pokedex_key_hash($_SERVER['HTTP_X_POKEDEX_KEY'] ?? null); }
    catch (PokedexApiError $error) { pokedex_rate_limit($config, $webroot, 'invalid_keys', 60, 60); throw $error; }
    if ($method === 'POST') pokedex_rate_limit($config, $webroot, 'create', 20, 3600);
    $body = in_array($method, ['POST', 'PATCH'], true) ? pokedex_request_body() : null;
    $readClient = isset($_SERVER['HTTP_X_POKEDEX_CLIENT']) ? pokedex_client_id($_SERVER['HTTP_X_POKEDEX_CLIENT']) : null;
    $stage = 'catalog';
    $allowedIds = pokedex_allowed_ids($webroot);
    $stage = 'database';
    $database = pokedex_database($config);
    try { $result = pokedex_handle($database, $method, $keyHash, $body, $readClient, $allowedIds); }
    catch (PokedexApiError $error) {
        if ($error->status === 404) pokedex_rate_limit($config, $webroot, 'invalid_keys', 60, 60);
        throw $error;
    }
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (PokedexApiError $error) {
    http_response_code($error->status);
    if ($error->status === 429) header('Retry-After: ' . (string) ($error->extra['retryAfter'] ?? 60));
    $extra = $error->extra;
    unset($extra['retryAfter']);
    echo json_encode(['error' => ['code' => $error->errorCode, 'message' => $error->getMessage()]] + $extra, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $error) {
    http_response_code(503);
    // Never log the request, key, credentials, imported state, or database exception text.
    error_log('Pokedex binder sync unavailable; stage=' . $stage . '; request_id=' . $requestId);
    if (function_exists('report_failure')) report_failure('pokedex.' . $stage, ['request_id' => $requestId]);
    echo json_encode(['error' => ['code' => 'sync_unavailable', 'message' => 'Binder sync is temporarily unavailable. Your local collection is still available.']]);
}
