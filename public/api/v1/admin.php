<?php

declare(strict_types=1);
if (PHP_VERSION_ID < 80400) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    http_response_code(503);
    echo '{"error":{"code":"runtime_unavailable","message":"Utility admin is temporarily unavailable."}}';
    exit;
}

require_once __DIR__.'/_admin.php';
accounts_headers();
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        accounts_fail(405, 'method_not_allowed', 'Use POST to access utility admin.');
    }
    $webroot = dirname(__DIR__, 2);
    $config = accounts_config($webroot);
    $admin = accounts_admin_config($webroot);
    if ($config === null || !$config['enabled'] || $admin === null) {
        accounts_fail(503, 'admin_unavailable', 'Utility admin is unavailable.');
    }

    accounts_origin($config, true);
    $db = accounts_database($config);
    $session = accounts_session($db, false, false);
    $operator = $session['user_id'] ?? null;
    if ($operator === null) {
        accounts_fail(401, 'login_required', 'Sign in to open utility admin.');
    }
    if (!in_array($operator, $admin['operators'], true)) {
        accounts_fail(403, 'admin_required', 'This account does not have utility admin access.');
    }
    accounts_user($db, $session);
    accounts_csrf($session);
    accounts_rate($db, $config, 'utility-admin', $operator, 120, 60);
    $body = accounts_body();
    $action = $body->action ?? null;
    if (!is_string($action)) {
        accounts_fail(422, 'invalid_request', 'Choose a utility admin action.');
    }
    $target = null;
    $record = null;

    switch ($action) {
        case 'overview':
            $result = accounts_admin_overview($db);
            break;
        case 'users':
            $result = accounts_admin_users($db, $body);
            break;
        case 'account':
        case 'recovery':
            $target = accounts_id($body->userId ?? null);
            $result = $action === 'account'
                ? accounts_admin_account($db, $target)
                : accounts_admin_recovery($db, $target, $body);
            break;
        case 'save':
        case 'snapshot':
            $target = accounts_id($body->userId ?? null);
            $record = accounts_id($body->id ?? null);
            $result = accounts_admin_saved_data($db, $target, $record, $action === 'snapshot');
            break;
        default:
            accounts_fail(404, 'unknown_action', 'This admin action is unavailable.');
    }

    accounts_admin_audit($admin['auditPath'], $operator, $action, $target, $record);
    accounts_json($result);
} catch (Throwable $error) {
    accounts_error($error);
}
