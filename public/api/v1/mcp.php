<?php

declare(strict_types=1);

if (PHP_VERSION_ID < 80400) {
    header('Cache-Control: no-store, private');
    http_response_code(503);
    exit;
}

require_once __DIR__.'/_mcp-auth.php';

accounts_headers();
header('X-Robots-Tag: noindex, nofollow');
$route = parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$tokenRoute = $route === MCP_ROOT.'/oauth/token';

try {
    $root = dirname(__DIR__, 2);
    $config = accounts_config($root);
    if ($config === null || !$config['enabled']) {
        accounts_fail(503, 'unavailable', 'Utility assistant connections are unavailable.');
    }
    if (($_SERVER['HTTP_HOST'] ?? '') !== parse_url($config['allowedOrigin'], PHP_URL_HOST)
        .(($port = parse_url($config['allowedOrigin'], PHP_URL_PORT)) === null ? '' : ':'.$port)) {
        accounts_fail(403, 'host_not_allowed', 'Use the published utility endpoint.');
    }
    $config = mcp_runtime_config($config, $root);
    if ($method === 'GET' && $route === '/.well-known/oauth-authorization-server') {
        accounts_json(mcp_metadata($config, null));
        exit;
    }
    foreach (MCP_APPS as $app => $_title) {
        if ($method === 'GET' && $route === '/.well-known/oauth-protected-resource'.MCP_ROOT.'/'.$app) {
            accounts_json(mcp_metadata($config, $app));
            exit;
        }
    }
    if ($route === MCP_ROOT.'/connections') {
        if (!in_array($method, ['GET', 'POST'], true)) {
            accounts_fail(405, 'method_not_allowed', 'Use GET or POST.');
        }
        accounts_origin($config, $method === 'POST');
        $db = accounts_database($config);
        $session = accounts_session($db, false, false);
        if ($session === null) {
            accounts_fail(401, 'login_required', 'Sign in to manage assistant connections.');
        }
        $user = accounts_user($db, $session)['id'];
        accounts_rate($db, $config, 'mcp-browser-user', $user, 60, 60);
        if ($method === 'POST') {
            accounts_csrf($session);
            $body = accounts_body();
            if (!accounts_fields($body, ['id'])) {
                mcp_invalid_request();
            }
            $id = accounts_id($body->id);
            accounts_transaction($db, function () use ($db, $session, $user, $id) {
                accounts_mutating_session($db, $session);
                accounts_lock_user($db, $user);
                accounts_query($db, 'UPDATE accounts_mcp_grants SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL', [time(), $id, $user]);
            });
            accounts_json(['revoked' => true]);
        } else {
            try {
                $rows = accounts_query($db, "SELECT g.id,g.app,g.client_id,g.can_write,g.created_at,g.expires_at
                    FROM accounts_mcp_grants g WHERE g.user_id=? AND g.revoked_at IS NULL AND g.expires_at>?
                    AND EXISTS(SELECT 1 FROM accounts_mcp_tokens t WHERE t.grant_id=g.id AND t.kind='refresh' AND t.used_at IS NULL AND t.expires_at>?)
                    ORDER BY g.created_at DESC LIMIT 50", [$user, time(), time()])->fetchAll();
            } catch (PDOException $error) {
                if ($error->getCode() !== '42S02') {
                    throw $error;
                }
                $rows = [];
            }
            $items = array_map(fn($row) => [
                'id' => $row['id'], 'utility' => MCP_APPS[$row['app']],
                'client' => MCP_CLIENTS[$row['client_id']][0] ?? 'Assistant',
                'canWrite' => (bool)$row['can_write'],
                'createdAt' => gmdate(DATE_ATOM, (int)$row['created_at']),
            ], $rows);
            $available = array_values(array_filter(array_keys(MCP_APPS), fn($app) => mcp_available($config, $app, $user)));
            accounts_json(['connections' => $items, 'available' => $available]);
        }
        exit;
    }

    if ($route === MCP_ROOT.'/oauth/authorize' && $method === 'GET') {
        $db = accounts_database($config);
        accounts_rate($db, $config, 'mcp-auth-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 120, 60);
        mcp_begin($db, $config, mcp_parameters((string)($_SERVER['QUERY_STRING'] ?? '')));
    }
    if ($tokenRoute) {
        if ($method !== 'POST') {
            header('Allow: POST');
            accounts_fail(405, 'invalid_request', 'Use POST to exchange tokens.');
        }
        if (!preg_match('~^application/x-www-form-urlencoded(?:\s*;|$)~i', (string)($_SERVER['CONTENT_TYPE'] ?? ''))) {
            mcp_invalid_request();
        }
        $db = accounts_database($config);
        accounts_rate($db, $config, 'mcp-token-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 400, 60);
        $raw = file_get_contents('php://input', false, null, 0, 16385);
        accounts_json(mcp_exchange($db, $config, mcp_parameters($raw === false ? '' : $raw)));
        exit;
    }
    if ($route === MCP_ROOT.'/oauth/consent') {
        if ($method !== 'POST') {
            accounts_fail(405, 'method_not_allowed', 'Use POST.');
        }
        accounts_origin($config, true);
        $db = accounts_database($config);
        $session = accounts_session($db, false, false);
        if ($session === null || $session['user_id'] === null) {
            accounts_fail(401, 'login_required', 'Sign in to connect an assistant.');
        }
        $user = accounts_user($db, $session)['id'];
        accounts_csrf($session);
        accounts_rate($db, $config, 'mcp-browser-user', $user, 60, 60);
        $body = accounts_body();
        if (accounts_fields($body, ['flow'])) {
            $flow = mcp_flow($db, $body->flow);
            if (!mcp_available($config, $flow['app'], $user)) {
                accounts_fail(403, 'unavailable', 'This assistant connection is unavailable for your account.');
            }
            accounts_json([
                'utility' => MCP_APPS[$flow['app']], 'client' => MCP_CLIENTS[$flow['client']][0],
                'destination' => parse_url($flow['redirect'], PHP_URL_HOST), 'mayWrite' => $flow['write'],
            ]);
        } else {
            accounts_json(mcp_consent($db, $config, $session, $body));
        }
        exit;
    }
    foreach (MCP_APPS as $app => $_title) {
        if ($route !== MCP_ROOT.'/'.$app) {
            continue;
        }
        accounts_origin($config, false);
        if (!mcp_available($config, $app)) {
            accounts_fail(503, 'unavailable', 'This utility endpoint is unavailable.');
        }
        $authorization = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        if ($authorization === '') {
            mcp_challenge($config, $app);
        }
        $db = accounts_database($config);
        $grant = mcp_access($db, $config, $app, $authorization);
        accounts_rate($db, $config, 'mcp-tool-user', $grant['user_id'], 180, 60);
        require_once __DIR__.'/_mcp-transport.php';
        mcp_run_transport($db, $config, $grant, $root);
        exit;
    }
    accounts_fail(404, 'unknown_route', 'This utility endpoint does not exist.');
} catch (Throwable $error) {
    if ($tokenRoute) {
        if ($error instanceof AccountsError) {
            http_response_code($error->status);
            if (isset($error->extra['retryAfter'])) {
                header('Retry-After: '.(int)$error->extra['retryAfter']);
            }
            accounts_json(['error' => $error->errorCode, 'error_description' => $error->getMessage()]);
        } else {
            http_response_code(503);
            error_log('Utility OAuth unavailable; request_id='.bin2hex(random_bytes(8)));
            accounts_json(['error' => 'temporarily_unavailable']);
        }
    } else {
        accounts_error($error);
    }
}
