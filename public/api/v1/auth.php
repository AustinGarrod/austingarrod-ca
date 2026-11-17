<?php

declare(strict_types=1);
// Keep this entry point parseable on the legacy host until its runtime is upgraded.
if (PHP_VERSION_ID < 80400) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Referrer-Policy: no-referrer');
    if (($_GET['action'] ?? 'session') === 'google-callback') {
        setcookie('__Host-ag-oauth', '', ['expires' => time() - 3600, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'None']);
        header('Location: /account/?google=failed', true, 303);
        exit;
    }

    if (($_GET['action'] ?? 'session') === 'session' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        echo json_encode(['enabled' => false, 'migrationEnabled' => false, 'user' => null, 'csrfToken' => '']);
    } else {
        http_response_code(503);
        echo json_encode(['error' => ['code' => 'runtime_unavailable', 'message' => 'Accounts are not available yet. Local saves remain available.']]);
    }

    exit;
}

require_once __DIR__.'/_auth.php';
accounts_headers();
try {
    $webroot = dirname(__DIR__, 2);
    $config = accounts_config($webroot);
    $action = (string)($_GET['action'] ?? 'session');
    $method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if ($config === null || !$config['enabled']) {
        if ($action === 'session' && $method === 'GET') {
            accounts_json(['enabled' => false, 'migrationEnabled' => false, 'user' => null, 'csrfToken' => '']);
            exit;
        }

        accounts_fail(503, 'accounts_disabled', 'Accounts are not available yet. Local saves remain available.');
    }

    $db = accounts_database($config);
    $mutation = $method === 'POST';
    // The provider form POST uses a separate short-lived proof cookie; do not
    // create or replace a Lax account session when that cookie is absent here.
    if ($action !== 'google-callback') {
        accounts_origin($config, $mutation);
    }
    if (!$mutation || $action === 'google-callback') {
        accounts_rate($db, $config, 'auth-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 120, 60);
    }

    if ($action === 'google-callback') {
        $input = accounts_google_callback_input();
        $location = accounts_google_callback($db, $config, $input, $webroot);
        accounts_oauth_cookie();
        header('Location: '.$location, true, 303);
        exit;
    }

    if ($action === 'bootstrap' && $mutation) {
        accounts_json(accounts_bootstrap($db, $config, accounts_body()));
        exit;
    }

    $session = accounts_session($db, !$mutation, !$mutation);
    if ($method === 'GET' && $action === 'session') {
        accounts_json($session === null ? accounts_empty_view($config) : accounts_view($db, $config, $session));
        exit;
    }

    if (!$mutation) {
        header('Allow: GET, POST');
        accounts_fail(405, 'method_not_allowed', 'This request method is unsupported.');
    }

    if ($session === null) accounts_fail(409, 'session_changed', 'Your sign-in session changed. Start sign-in again. Your saved data has been kept.');
    accounts_csrf($session);
    $body = accounts_body();
    if ($action === 'email-start') {
        $result = accounts_email_start($db, $config, $session, $body, $webroot);
    } elseif ($action === 'email-verify') {
        $result = accounts_email_verify($db, $config, $session, $body);
    } elseif ($action === 'google-start') {
        $result = accounts_google_start($db, $config, $session, $body, $webroot);
    } elseif (in_array($action, ['logout', 'logout-all'], true)) {
        if (!accounts_fields($body, [])) {
            accounts_fail(422, 'invalid_request', 'The sign-out request is invalid.');
        }

        $result = accounts_logout($db, $config, $session, $action === 'logout-all');
    } else {
        accounts_fail(404, 'unknown_action', 'The accounts action does not exist.');
    }

    accounts_json($result);
} catch (Throwable $error) {
    if (($_GET['action'] ?? '') === 'google-callback') {
        accounts_oauth_cookie();
        // Never render callback bodies, provider errors, codes or state.
        header('Location: /account/?google=failed', true, 303);
        exit;
    }

    accounts_error($error);
}
