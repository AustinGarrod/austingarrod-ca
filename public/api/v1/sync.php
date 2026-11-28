<?php

declare(strict_types=1);
if (PHP_VERSION_ID < 80400) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Referrer-Policy: no-referrer');
    http_response_code(503);
    echo json_encode(['error' => ['code' => 'runtime_unavailable', 'message' => 'Account sync is not available yet. Your saved data has been kept.']]);
    exit;
}

require_once __DIR__.'/_sync.php';
accounts_headers();
try {
    $webroot = dirname(__DIR__, 2);
    $config = accounts_config($webroot);
    if ($config === null || !$config['enabled']) {
        accounts_fail(503, 'accounts_disabled', 'Account sync is not available yet. Your saved data has been kept.');
    }

    $db = accounts_database($config);
    $method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $mutation = $method === 'POST';
    accounts_origin($config, $mutation);
    $session = accounts_session($db, false);
    if ($session === null) {
        accounts_fail(401, 'login_required', 'Sign in to sync your saved data.');
    }
    $user = accounts_user($db, $session);
    $id = $user['id'];
    $action = (string)($_GET['action'] ?? 'read');
    accounts_rate($db, $config, 'sync-user', $id, 240, 60);
    if ($mutation) {
        accounts_csrf($session);
        $body = accounts_body();
    } elseif ($method !== 'GET') {
        header('Allow: GET, POST');
        accounts_fail(405, 'method_not_allowed', 'This request method is unsupported.');
    }

    if ($action === 'binder-stock-alerts') {
        require_once __DIR__.'/_binder-stock-alerts.php';
        $result = $mutation ? binder_stock_save($db, $id, $session, $body) : binder_stock_settings($db, $id);
    } elseif ($action === 'read' && $method === 'GET') {
        [$app,$name] = accounts_document_pair($_GET['app'] ?? null, $_GET['document'] ?? null);
        $client = accounts_id($_GET['clientId'] ?? null);
        $result = ['document' => accounts_remote($db, accounts_document($db, $id, $app, $name), $client)];
    } elseif ($action === 'write' && $mutation) {
        $result = accounts_write($db, $id, $body, $webroot);
    } elseif (in_array($action, ['migration-stage', 'migration-commit'], true) && $mutation) {
        if (!$config['migrationEnabled']) {
            accounts_fail(503, 'migration_disabled', 'Account migration is not enabled yet. Your saved data has been kept.');
        }

        if ($action === 'migration-stage') {
            $result = accounts_migration_stage($db, $id, $body, $webroot);
        } else {
            $result = accounts_migration_commit($db, $id, $body, $webroot, $_SERVER['HTTP_X_POKEDEX_KEY'] ?? null);
        }

    } elseif ($action === 'recovery-list' && $method === 'GET') {
        $app = $_GET['app'] ?? null;
        if ($app !== null && (!is_string($app) || !isset(ACCOUNTS_DOCUMENT_LIMITS[$app]))) {
            accounts_fail(422, 'unknown_application', 'This application is not registered.');
        }

        $rows = accounts_query($db, 'SELECT id,app,document,label,schema_version,revision,created_at FROM accounts_recovery WHERE user_id=?'.($app === null ? '' : ' AND app=?').' ORDER BY created_at DESC,id DESC', $app === null ? [$id] : [$id, $app])->fetchAll();
        $result = ['snapshots' => array_map('accounts_recovery_metadata', $rows)];
    } elseif ($action === 'recovery-read' && $method === 'GET') {
        $row = accounts_recovery_get($db, $id, accounts_id($_GET['id'] ?? null));
        $result = ['snapshot' => accounts_recovery_metadata($row) + ['state' => json_decode($row['state_json'], false, 64, JSON_THROW_ON_ERROR)]];
    } elseif ($action === 'recovery-restore' && $mutation) {
        $result = accounts_recovery_restore($db, $id, $body, $webroot);
    } elseif ($action === 'recovery-delete' && $mutation) {
        if (!accounts_fields($body, ['id'])) {
            accounts_fail(422, 'invalid_request', 'The recovery request is invalid.');
        }
        $snapshot = accounts_id($body->id);
        accounts_query($db, 'DELETE FROM accounts_recovery WHERE id=? AND user_id=?', [$snapshot, $id]);
        $result = ['deleted' => true];
    } else {
        accounts_fail(404, 'unknown_action', 'The sync action does not exist.');
    }

    accounts_json($result);
} catch (Throwable $error) {
    accounts_error($error);
}
