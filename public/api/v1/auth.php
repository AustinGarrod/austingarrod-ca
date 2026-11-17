<?php

declare(strict_types=1);
// Keep this entry point parseable on the legacy host until its runtime is upgraded.
if (PHP_VERSION_ID < 80400) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Referrer-Policy: no-referrer');
    if (($_GET['action'] ?? 'session') === 'google-callback') {
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
    // The provider redirect is necessarily cross-site; its single-use state,
    // nonce and session binding replace the ordinary API origin check.
    if (!($method === 'GET' && $action === 'google-callback')) {
        accounts_origin($config, $mutation);
    }
    accounts_rate($db, $config, 'auth-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 120, 60);

    $session = accounts_session($db);
    if ($method === 'GET' && $action === 'session') {
        accounts_json(accounts_view($db, $config, $session));
        exit;
    }

    if ($method === 'GET' && $action === 'google-callback') {
        $location = accounts_google_callback($db, $config, $session, $webroot);
        header('Location: '.$location, true, 303);
        exit;
    }

    if (!$mutation) {
        header('Allow: GET, POST');
        accounts_fail(405, 'method_not_allowed', 'This request method is unsupported.');
    }

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

        $fresh = accounts_transaction($db, function () use ($db, $session, $action) {
            if ($action === 'logout-all' && $session['user_id'] !== null) {
                accounts_query($db, 'DELETE FROM accounts_sessions WHERE user_id=?', [$session['user_id']]);
            }
            return accounts_new_session($db, null, $session['token_hash']);
        });
        $result = accounts_view($db, $config, $fresh);
    } else {
        accounts_fail(404, 'unknown_action', 'The accounts action does not exist.');
    }

    accounts_json($result);
} catch (Throwable $error) {
    if (($_GET['action'] ?? '') === 'google-callback') {
        // Never render diagnostics on the provider's code/state-bearing URL.
        header('Location: /account/?google=failed', true, 303);
        exit;
    }

    accounts_error($error);
}
