<?php

declare(strict_types=1);

require_once __DIR__.'/_sync.php';

const MCP_APPS = [
    'pokedex-binder' => 'Pokémon Binder Tracker',
    'idle-slayer-companion' => 'Idle Slayer Companion',
];
const MCP_CHATGPT_CLIENT = 'https://chatgpt.com/oauth/client.json';
const MCP_CLIENTS = [
    MCP_CHATGPT_CLIENT => ['ChatGPT', 'https://chatgpt.com/connector_platform_oauth_redirect'],
    'https://chatgpt.com/oauth/codex/client.json' => ['Codex', 'loopback'],
    'https://claude.ai/oauth/claude-code-client-metadata' => ['Claude Code', 'loopback'],
    'https://claude.ai/oauth/mcp-oauth-client-metadata' => ['Claude', 'https://claude.ai/api/mcp/auth_callback'],
];
const MCP_ROOT = '/api/v1/mcp';
const MCP_PROOF_COOKIE = '__Host-ag-mcp';
const MCP_ACCESS_SECONDS = 900;
const MCP_REFRESH_SECONDS = 30 * 86400;
const MCP_GRANT_SECONDS = 90 * 86400;

/** Optional sidecar keeps pilot switches separate from account credentials. */
function mcp_runtime_config(array $config, string $root): array
{
    $home = getenv('HOME') ?: getenv('USERPROFILE') ?: dirname($root);
    $accounts = getenv('ACCOUNTS_CONFIG') ?: $home.'/private/accounts.php';
    $path = dirname($accounts).'/utility-mcp.json';
    clearstatcache(true, $path);
    if (!is_file($path) && !is_link($path)) {
        return $config;
    }
    $config['mcp'] = [];
    if (!accounts_private_path($path, $root)) {
        return $config;
    }
    $raw = file_get_contents($path, false, null, 0, 16385);
    if ($raw === false || strlen($raw) > 16384) {
        return $config;
    }
    $flags = json_decode($raw, true, 16);
    if (is_array($flags)) {
        foreach (MCP_APPS as $app => $_title) {
            $settings = $flags[$app] ?? null;
            if (!is_array($settings)) {
                continue;
            }
            $users = $settings['previewAccounts'] ?? [];
            $config['mcp'][$app] = [
                'enabled' => ($settings['enabled'] ?? false) === true,
                'previewAccounts' => array_is_list((array)$users) ? array_filter((array)$users,
                    fn($id) => is_string($id) && preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $id)) : [],
            ];
        }
    }
    return $config;
}

function mcp_resource(array $config, string $app): string
{
    return $config['allowedOrigin'].MCP_ROOT.'/'.$app;
}

function mcp_preview_users(array $config, string $app): array
{
    $ids = $config['mcp'][$app]['previewAccounts'] ?? [];
    return is_array($ids) ? $ids : [];
}

function mcp_available(array $config, string $app, ?string $user = null): bool
{
    if (!$config['enabled'] || !isset(MCP_APPS[$app])) {
        return false;
    }
    if (($config['mcp'][$app]['enabled'] ?? false) === true) {
        return true;
    }
    $preview = mcp_preview_users($config, $app);
    return $user === null ? $preview !== [] : in_array($user, $preview, true);
}

function mcp_scope(string $app, bool $write): string
{
    return $app.($write ? ':write' : ':read');
}

function mcp_scopes(string $app, bool $write, bool $offline = false): string
{
    return mcp_scope($app, false).($write ? ' '.mcp_scope($app, true) : '').($offline ? ' offline_access' : '');
}

function mcp_secret(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function mcp_is_secret(mixed $value): bool
{
    return is_string($value) && preg_match('/^[A-Za-z0-9_-]{43}$/D', $value) === 1;
}

function mcp_hash(string $value): string
{
    return hash('sha256', $value, true);
}

function mcp_metadata(array $config, ?string $app): array
{
    $origin = $config['allowedOrigin'];
    if ($app !== null) {
        return [
            'resource' => mcp_resource($config, $app),
            'resource_name' => MCP_APPS[$app],
            'authorization_servers' => [$origin],
            'scopes_supported' => [mcp_scope($app, false), mcp_scope($app, true)],
            'bearer_methods_supported' => ['header'],
        ];
    }
    return [
        'issuer' => $origin,
        'authorization_endpoint' => $origin.MCP_ROOT.'/oauth/authorize',
        'token_endpoint' => $origin.MCP_ROOT.'/oauth/token',
        'response_types_supported' => ['code'],
        'grant_types_supported' => ['authorization_code', 'refresh_token'],
        'token_endpoint_auth_methods_supported' => ['none'],
        'code_challenge_methods_supported' => ['S256'],
        'client_id_metadata_document_supported' => true,
        'authorization_response_iss_parameter_supported' => true,
        'scopes_supported' => [
            mcp_scope('pokedex-binder', false), mcp_scope('pokedex-binder', true),
            mcp_scope('idle-slayer-companion', false), mcp_scope('idle-slayer-companion', true), 'offline_access',
        ],
    ];
}

function mcp_challenge(array $config, string $app, bool $needWrite = false, bool $invalid = false): never
{
    $meta = $config['allowedOrigin'].'/.well-known/oauth-protected-resource'.MCP_ROOT.'/'.$app;
    $error = $needWrite ? ', error="insufficient_scope", scope="'.mcp_scopes($app, true).'"' : ($invalid ? ', error="invalid_token"' : '');
    header('WWW-Authenticate: Bearer resource_metadata="'.$meta.'"'.$error);
    accounts_fail($needWrite ? 403 : 401, $needWrite ? 'insufficient_scope' : 'invalid_token', $needWrite ? 'Connect this assistant with permission to edit your saves.' : 'Connect your utility account to continue.');
}

function mcp_invalid_request(): never
{
    accounts_fail(400, 'invalid_request', 'The assistant authorization request is invalid.');
}

function mcp_invalid_grant(): never
{
    accounts_fail(400, 'invalid_grant', 'This assistant authorization has expired or is no longer valid.');
}

function mcp_redirect_allowed(string $client, string $uri): bool
{
    $redirect = MCP_CLIENTS[$client][1] ?? null;
    if ($redirect === null) {
        return false;
    }
    if ($redirect !== 'loopback') {
        return $uri === $redirect;
    }
    return preg_match('~^http://(?:127\.0\.0\.1|localhost)(?::([1-9][0-9]{0,4}))?/callback$~D', $uri, $match) === 1
        && (!isset($match[1]) || (int)$match[1] <= 65535);
}

function mcp_input(array $input, string $field, int $length = 2048): string
{
    $value = $input[$field] ?? '';
    if (!is_string($value) || strlen($value) > $length || preg_match('/[\x00-\x1f\x7f]/', $value)) {
        mcp_invalid_request();
    }
    return $value;
}

function mcp_parameters(string $raw): array
{
    if (strlen($raw) > 16384) {
        mcp_invalid_request();
    }
    $values = [];
    foreach (explode('&', $raw) as $field) {
        if ($field === '') {
            continue;
        }
        [$key, $value] = array_pad(explode('=', $field, 2), 2, '');
        $key = urldecode($key);
        if ($key === '' || isset($values[$key]) || str_contains($key, '[')) {
            mcp_invalid_request();
        }
        $values[$key] = urldecode($value);
    }
    return $values;
}

function mcp_authorization_request(array $config, array $input): array
{
    $client = mcp_input($input, 'client_id', 255);
    $redirect = mcp_input($input, 'redirect_uri');
    if (!mcp_redirect_allowed($client, $redirect) || mcp_input($input, 'response_type') !== 'code') {
        mcp_invalid_request();
    }
    $challenge = mcp_input($input, 'code_challenge');
    if (!mcp_is_secret($challenge) || mcp_input($input, 'code_challenge_method') !== 'S256') {
        mcp_invalid_request();
    }
    $state = mcp_input($input, 'state');
    $resource = mcp_input($input, 'resource');
    $scope = mcp_input($input, 'scope');
    $requested = $scope === '' ? [] : preg_split('/ +/', trim($scope), -1, PREG_SPLIT_NO_EMPTY);
    $app = null;
    foreach (MCP_APPS as $name => $_title) {
        if ($resource === mcp_resource($config, $name)
            || ($resource === '' && in_array(mcp_scope($name, false), $requested, true))) {
            $app = $name;
            break;
        }
    }
    if ($app === null || !mcp_available($config, $app)) {
        mcp_invalid_request();
    }
    if (array_diff($requested, [mcp_scope($app, false), mcp_scope($app, true), 'offline_access']) !== []) {
        accounts_fail(400, 'invalid_scope', 'The requested permissions do not match this utility.');
    }
    return [
        'client' => $client, 'redirect' => $redirect, 'challenge' => $challenge, 'state' => $state, 'app' => $app,
        'write' => $client !== MCP_CHATGPT_CLIENT && ($requested === [] || in_array(mcp_scope($app, true), $requested, true)),
        'offline' => in_array('offline_access', $requested, true),
    ];
}

function mcp_begin(PDO $db, array $config, array $input): never
{
    $request = mcp_authorization_request($config, $input);
    $proof = $_COOKIE[MCP_PROOF_COOKIE] ?? '';
    if (!mcp_is_secret($proof)) {
        $proof = mcp_secret();
    }
    setcookie(MCP_PROOF_COOKIE, $proof, [
        'expires' => time() + 1200, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
    ]);
    $flow = mcp_secret();
    accounts_query($db, 'DELETE FROM accounts_mcp_grants WHERE expires_at<=? LIMIT 100', [time()]);
    accounts_query($db, 'DELETE FROM accounts_mcp_tokens WHERE expires_at<=? LIMIT 200', [time()]);
    accounts_query($db, 'DELETE FROM accounts_mcp_flows WHERE expires_at<=? LIMIT 200', [time()]);
    accounts_query($db, 'INSERT INTO accounts_mcp_flows(id_hash,browser_hash,request_json,expires_at) VALUES(?,?,?,?)',
        [mcp_hash($flow), mcp_hash($proof), accounts_encode($request), time() + 1200]);
    header('Location: /account/assistant-consent/#'.$flow, true, 303);
    exit;
}

function mcp_flow(PDO $db, mixed $flow, bool $lock = false): array
{
    $proof = $_COOKIE[MCP_PROOF_COOKIE] ?? '';
    if (!mcp_is_secret($flow) || !mcp_is_secret($proof)) {
        mcp_invalid_grant();
    }
    $row = accounts_query($db, 'SELECT request_json,expires_at FROM accounts_mcp_flows WHERE id_hash=? AND browser_hash=?'.($lock ? ' FOR UPDATE' : ''),
        [mcp_hash($flow), mcp_hash($proof)])->fetch();
    if (!$row || (int)$row['expires_at'] <= time()) {
        mcp_invalid_grant();
    }
    return json_decode($row['request_json'], true, 16, JSON_THROW_ON_ERROR);
}

function mcp_consent(PDO $db, array $config, array $session, stdClass $body): array
{
    if (!accounts_fields($body, ['flow', 'decision', 'accountId']) || !in_array($body->decision, ['deny', 'read', 'write'], true)) {
        mcp_invalid_request();
    }
    accounts_csrf($session);
    return accounts_transaction($db, function () use ($db, $config, $session, $body) {
        $live = accounts_mutating_session($db, $session);
        $user = accounts_user($db, $live, false)['id'];
        if ($user !== $body->accountId) {
            accounts_fail(409, 'account_changed', 'Your account changed. Review the connection again.');
        }
        accounts_lock_user($db, $user);
        $request = mcp_flow($db, $body->flow, true);
        if (!mcp_available($config, $request['app'], $user) || ($body->decision === 'write' && !$request['write'])) {
            mcp_invalid_request();
        }
        accounts_query($db, 'DELETE FROM accounts_mcp_flows WHERE id_hash=?', [mcp_hash($body->flow)]);
        $parameters = ['iss' => $config['allowedOrigin']];
        if ($request['state'] !== '') {
            $parameters['state'] = $request['state'];
        }
        if ($body->decision === 'deny') {
            $parameters['error'] = 'access_denied';
        } else {
            $active = (int)accounts_query($db, 'SELECT COUNT(*) FROM accounts_mcp_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>?',
                [$user, time()])->fetchColumn();
            if ($active >= 50) {
                accounts_fail(409, 'connection_limit', 'Revoke an existing connection before connecting another assistant.');
            }
            $grant = accounts_uuid();
            $now = time();
            accounts_query($db, 'INSERT INTO accounts_mcp_grants(id,user_id,app,client_id,can_write,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
                [$grant, $user, $request['app'], $request['client'], (int)($body->decision === 'write'), $now, $now + MCP_GRANT_SECONDS]);
            $parameters['code'] = mcp_issue($db, $grant, 'code', $now + 300, accounts_encode([
                'redirect' => $request['redirect'], 'challenge' => $request['challenge'], 'offline' => $request['offline'],
            ]));
        }
        return ['redirect' => $request['redirect'].'?'.http_build_query($parameters, '', '&', PHP_QUERY_RFC3986)];
    });
}

function mcp_issue(PDO $db, string $grant, string $kind, int $expires, ?string $code = null): string
{
    $token = mcp_secret();
    accounts_query($db, 'INSERT INTO accounts_mcp_tokens(token_hash,grant_id,kind,expires_at,code_json) VALUES(?,?,?,?,?)',
        [mcp_hash($token), $grant, $kind, $expires, $code]);
    return $token;
}

function mcp_grant(PDO $db, string $grant, bool $lock = false): ?array
{
    $row = accounts_query($db, 'SELECT * FROM accounts_mcp_grants WHERE id=?'.($lock ? ' FOR UPDATE' : ''), [$grant])->fetch();
    return $row ?: null;
}

function mcp_live(array $config, ?array $grant): bool
{
    return $grant !== null && $grant['revoked_at'] === null && (int)$grant['expires_at'] > time()
        && mcp_available($config, $grant['app'], $grant['user_id']);
}

function mcp_token(PDO $db, string $token, string $kind, bool $lock = false): ?array
{
    $row = accounts_query($db, 'SELECT * FROM accounts_mcp_tokens WHERE token_hash=? AND kind=?'.($lock ? ' FOR UPDATE' : ''),
        [mcp_hash($token), $kind])->fetch();
    return $row ?: null;
}

function mcp_exchange(PDO $db, array $config, array $input): array
{
    $kind = match (mcp_input($input, 'grant_type')) {
        'authorization_code' => 'code',
        'refresh_token' => 'refresh',
        default => accounts_fail(400, 'unsupported_grant_type', 'Use authorization code or refresh token.'),
    };
    $client = mcp_input($input, 'client_id', 255);
    $raw = mcp_input($input, $kind === 'code' ? 'code' : 'refresh_token');
    $resource = mcp_input($input, 'resource');
    if (!isset(MCP_CLIENTS[$client]) || !mcp_is_secret($raw)) {
        mcp_invalid_grant();
    }
    $token = mcp_token($db, $raw, $kind);
    $grant = $token === null ? null : mcp_grant($db, $token['grant_id']);
    if (!mcp_live($config, $grant) || $client !== $grant['client_id']) {
        mcp_invalid_grant();
    }
    $result = accounts_transaction($db, function () use ($db, $config, $input, $kind, $raw, $resource, $grant) {
        accounts_lock_user($db, $grant['user_id']);
        $current = mcp_grant($db, $grant['id'], true);
        $token = mcp_token($db, $raw, $kind, true);
        if (!mcp_live($config, $current) || $token === null
            || ($resource !== '' && $resource !== mcp_resource($config, $current['app']))) {
            mcp_invalid_grant();
        }
        $now = time();
        if ($token['used_at'] !== null) {
            if ($kind === 'refresh') {
                accounts_query($db, 'UPDATE accounts_mcp_grants SET revoked_at=? WHERE id=?', [$now, $current['id']]);
                return null;
            }
            mcp_invalid_grant();
        }
        if ((int)$token['expires_at'] <= $now) {
            mcp_invalid_grant();
        }
        $offline = false;
        if ($kind === 'code') {
            $bound = json_decode($token['code_json'], true, 16, JSON_THROW_ON_ERROR);
            $verifier = mcp_input($input, 'code_verifier');
            $challenge = rtrim(strtr(base64_encode(mcp_hash($verifier)), '+/', '-_'), '=');
            if (mcp_input($input, 'redirect_uri') !== $bound['redirect'] || !preg_match('/^[A-Za-z0-9._~-]{43,128}$/D', $verifier)
                || !hash_equals($bound['challenge'], $challenge)) {
                mcp_invalid_grant();
            }
            $offline = $bound['offline'];
        } else {
            $offline = $token['code_json'] === 'true';
        }
        $scope = mcp_scopes($current['app'], (bool)$current['can_write'], $offline);
        $requested = mcp_input($input, 'scope');
        if ($kind === 'refresh' && $requested !== '') {
            $requestedScopes = preg_split('/ +/', trim($requested), -1, PREG_SPLIT_NO_EMPTY);
            $grantedScopes = explode(' ', $scope);
            if (array_diff($requestedScopes, $grantedScopes) || array_diff($grantedScopes, $requestedScopes)) {
                accounts_fail(400, 'invalid_scope', 'Reconnect to change the permissions for this grant.');
            }
        }
        // Keep used refresh hashes until the family expires so replay can revoke the family.
        accounts_query($db, 'UPDATE accounts_mcp_tokens SET used_at=?,expires_at=? WHERE token_hash=?',
            [$now, (int)$current['expires_at'], mcp_hash($raw)]);
        $ttl = min(MCP_ACCESS_SECONDS, (int)$current['expires_at'] - $now);
        return [
            'token_type' => 'Bearer', 'scope' => $scope, 'expires_in' => $ttl,
            'access_token' => mcp_issue($db, $current['id'], 'access', $now + $ttl),
            'refresh_token' => mcp_issue($db, $current['id'], 'refresh', min($now + MCP_REFRESH_SECONDS, (int)$current['expires_at']), $offline ? 'true' : 'false'),
        ];
    });
    if ($result === null) {
        mcp_invalid_grant();
    }
    return $result;
}

function mcp_access(PDO $db, array $config, string $app, string $authorization): array
{
    if (preg_match('/^Bearer ([A-Za-z0-9_-]{43})$/iD', $authorization, $match) !== 1) {
        mcp_challenge($config, $app, invalid: true);
    }
    $token = mcp_token($db, $match[1], 'access');
    $grant = $token === null ? null : mcp_grant($db, $token['grant_id']);
    if ($token === null || (int)$token['expires_at'] <= time() || !mcp_live($config, $grant) || $grant['app'] !== $app) {
        mcp_challenge($config, $app, invalid: true);
    }
    return $grant + ['accessExpiresAt' => (int)$token['expires_at']];
}

function mcp_revoke_user(PDO $db, string $user): void
{
    try {
        accounts_lock_user($db, $user);
        accounts_query($db, 'UPDATE accounts_mcp_grants SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [time(), $user]);
    } catch (PDOException $error) {
        // Accounts continue to operate during deployment before the additive MCP migration.
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
    }
}
