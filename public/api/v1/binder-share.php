<?php

declare(strict_types=1);
if (PHP_VERSION_ID < 80400) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Referrer-Policy: no-referrer');
    http_response_code(503);
    echo json_encode(['error' => ['code' => 'runtime_unavailable', 'message' => 'Shared binders are temporarily unavailable.']]);
    exit;
}

require_once __DIR__.'/_binder-shares.php';
accounts_headers();
try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        header('Allow: GET');
        accounts_fail(405, 'method_not_allowed', 'Shared binders can only be viewed.');
    }
    $token = $_SERVER['HTTP_X_BINDER_SHARE_TOKEN'] ?? '';
    if (!is_string($token) || !preg_match('/^pbs_[a-f0-9]{64}$/D', $token)) binder_share_unavailable();
    $webroot = dirname(__DIR__, 2);
    $config = accounts_config($webroot);
    if ($config === null || !$config['enabled']) {
        accounts_fail(503, 'accounts_disabled', 'Shared binders are temporarily unavailable.');
    }
    accounts_origin($config, false);
    $db = accounts_database($config);
    accounts_rate($db, $config, 'binder-share-view', (string)($_SERVER['REMOTE_ADDR'] ?? ''), 120, 60);
    accounts_json(binder_share_read($db, $token, $webroot));
} catch (Throwable $error) {
    accounts_error($error);
}
