<?php

declare(strict_types=1);

final class AccountsError extends RuntimeException
{
    public function __construct(public int $status, public string $errorCode, string $message, public array $extra = [])
    {
        parent::__construct($message);
    }

}

function accounts_fail(int $status, string $code, string $message, array $extra = []): never
{
    throw new AccountsError($status, $code, $message, $extra);
}

function accounts_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
}

function accounts_json(mixed $data): void
{
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function accounts_error(Throwable $error): void
{
    if ($error instanceof AccountsError) {
        http_response_code($error->status);
        if (isset($error->extra['retryAfter'])) {
            header('Retry-After: '.(int) $error->extra['retryAfter']);
        }

        accounts_json(['error' => ['code' => $error->errorCode, 'message' => $error->getMessage()]] + $error->extra);
    } else {
        http_response_code(503);
        // Exception strings, request bodies, auth headers and URLs are never logged.
        error_log('Accounts service unavailable; request_id='.bin2hex(random_bytes(8)));
        accounts_json(['error' => ['code' => 'service_unavailable', 'message' => 'Accounts are temporarily unavailable. Your saved data has been kept.']]);
    }

}

function accounts_uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 15) | 64);
    $bytes[8] = chr((ord($bytes[8]) & 63) | 128);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20);
}

function accounts_id(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iD', $value)) {
        accounts_fail(422, 'invalid_id', 'The request identifier is invalid.');
    }

    return strtolower($value);
}

function accounts_number(mixed $value): int
{
    if (!is_int($value) || $value < 0 || $value > 9007199254740990) {
        accounts_fail(422, 'invalid_revision', 'The saved revision is invalid.');
    }

    return $value;
}

function accounts_object(mixed $value): bool
{
    return $value instanceof stdClass;
}

function accounts_fields(mixed $value, array $required, array $optional = []): bool
{
    if (!accounts_object($value)) {
        return false;
    }

    $keys = array_keys(get_object_vars($value));
    return count(array_diff($required, $keys)) === 0 && count(array_diff($keys, array_merge($required, $optional))) === 0;
}

function accounts_canonical(mixed $value): mixed
{
    if ($value instanceof stdClass) {
        $vars = get_object_vars($value);
        ksort($vars, SORT_STRING);
        $out = new stdClass();
        foreach ($vars as $k => $v) {
            $out->{$k}
 = accounts_canonical($v);
        }
        return $out;
    }

    if (is_array($value)) {
        return array_map('accounts_canonical', $value);
    }

    return $value;
}

function accounts_encode(mixed $value): string
{
    return json_encode(accounts_canonical($value), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function accounts_hash(mixed $value): string
{
    return hash('sha256', accounts_encode($value), true);
}

function accounts_body(): stdClass
{
    if (!preg_match('~^application/json(?:\s*;|$)~i', (string)($_SERVER['CONTENT_TYPE'] ?? ''))) {
        accounts_fail(415, 'json_required', 'Send the request as JSON.');
    }

    $raw = file_get_contents('php://input', false, null, 0, 4 * 1024 * 1024 + 65537);
    if (!is_string($raw) || strlen($raw) > 4 * 1024 * 1024 + 65536) {
        accounts_fail(413, 'request_too_large', 'The document exceeds the supported size.');
    }

    try {
        $body = json_decode($raw, false, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        accounts_fail(400, 'invalid_json', 'The request is not valid JSON.');
    }

    if (!$body instanceof stdClass) {
        accounts_fail(422, 'invalid_request', 'The request format is unsupported.');
    }

    return $body;
}

function accounts_private_path(string $path, string $webroot): bool
{
    $real = realpath($path);
    $root = realpath($webroot);
    if ($real === false || $root === false) {
        return false;
    }

    $real = str_replace('\\', '/', $real);
    $root = rtrim(str_replace('\\', '/', $root), '/');
    if (PHP_OS_FAMILY === 'Windows') {
        $real = strtolower($real);
        $root = strtolower($root);
    }

    return $real !== $root && !str_starts_with($real, $root.'/');
}

function accounts_config(string $webroot, ?string $explicit = null): ?array
{
    $home = getenv('HOME') ?: getenv('USERPROFILE') ?: dirname($webroot);
    $path = $explicit ?? (getenv('ACCOUNTS_CONFIG') ?: $home.'/private/accounts.php');
    if (!is_file($path)) {
        return null;
    }

    if (!accounts_private_path($path, $webroot)) {
        throw new RuntimeException('Private configuration required.');
    }

    $c = require $path;
    if (!is_array($c)) {
        throw new RuntimeException();
    }

    foreach (['dsn', 'username', 'password', 'secret'] as $key) {
        if (!isset($c[$key]) || !is_string($c[$key])) {
            throw new RuntimeException();
        }

    }

    if (!str_starts_with($c['dsn'], 'mysql:') || strlen($c['secret']) < 32) {
        throw new RuntimeException();
    }

    $c['enabled'] = ($c['enabled'] ?? false) === true;
    $c['migrationEnabled'] = ($c['migrationEnabled'] ?? false) === true;
    $c['allowedOrigin'] = $c['allowedOrigin'] ?? 'https://austingarrod.ca';
    if (!is_string($c['allowedOrigin']) || !preg_match('~^https://[^/?#]+$~D', $c['allowedOrigin'])) {
        // Loopback HTTP is solely for a local instance, never inferred from a request Host.
        if (!is_string($c['allowedOrigin']) || !preg_match('~^http://(?:127\.0\.0\.1|localhost):[0-9]+$~D', $c['allowedOrigin'])) {
            throw new RuntimeException();
        }

    }

    return $c;
}

function accounts_database(array $config, bool $check = true): PDO
{
    $db = new PDO($config['dsn'], $config['username'], $config['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 3]);
    $db->exec('SET NAMES utf8mb4');
    if ($check && (int)$db->query('SELECT MAX(version) FROM accounts_schema_migrations')->fetchColumn() !== 1) {
        throw new RuntimeException();
    }

    return $db;
}

function accounts_query(PDO $db, string $sql, array $values = []): PDOStatement
{
    $q = $db->prepare($sql);
    $q->execute($values);
    return $q;
}

function accounts_transaction(PDO $db, callable $fn): mixed
{
    $db->beginTransaction();
    try {
        $result = $fn();
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }

}

function accounts_origin(array $c, bool $mutation): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if (($origin !== null && $origin !== $c['allowedOrigin']) || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site' || ($mutation && $origin !== $c['allowedOrigin'])) {
        accounts_fail(403, 'origin_not_allowed', 'Open accounts on this website.');
    }

}

function accounts_rate(PDO $db, array $config, string $bucket, string $subject, int $limit, int $seconds): void
{
    $key = hash_hmac('sha256', $bucket.'|'.$subject, $config['secret'], true);
    $window = time();
    accounts_transaction($db, function () use ($db, $key, $window, $limit, $seconds) {
        // An exclusive upsert avoids concurrent INSERT IGNORE shared-lock upgrades.
        accounts_query($db, 'INSERT INTO accounts_rate_limits(bucket,window_start,request_count) VALUES(?,?,0) ON DUPLICATE KEY UPDATE bucket=VALUES(bucket)', [$key, $window]);
        $row = accounts_query($db, 'SELECT window_start,request_count FROM accounts_rate_limits WHERE bucket=? FOR UPDATE', [$key])->fetch();
        $active = (int)$row['window_start'] + $seconds > $window;
        $count = $active ? (int)$row['request_count'] : 0;
        $start = $active ? (int)$row['window_start'] : $window;
        if ($count >= $limit) {
            accounts_fail(429, 'rate_limited', 'Please wait before trying again.', ['retryAfter' => $start + $seconds - $window]);
        }

        accounts_query($db, 'UPDATE accounts_rate_limits SET window_start=?,request_count=? WHERE bucket=?', [$start, $count + 1, $key]);
    });
}

function accounts_cookie(string $token, int $expires): void
{
    setcookie('__Host-ag-session', $token, ['expires' => $expires, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
}

function accounts_new_session(PDO $db, ?string $user = null, ?string $old = null): array
{
    $token = bin2hex(random_bytes(32));
    $hash = hash('sha256', $token, true);
    $now = time();
    $csrf = bin2hex(random_bytes(32));
    accounts_query($db, 'INSERT INTO accounts_sessions(token_hash,user_id,csrf_token,created_at,seen_at) VALUES(?,?,?,?,?)', [$hash, $user, $csrf, $now, $now]);
    if ($old !== null) {
        accounts_query($db, 'DELETE FROM accounts_sessions WHERE token_hash=?', [$old]);
    }

    accounts_cookie($token, $now + 90 * 86400);
    return ['token_hash' => $hash, 'user_id' => $user, 'csrf_token' => $csrf, 'created_at' => $now, 'seen_at' => $now];
}

function accounts_session(PDO $db, bool $create = true): ?array
{
    $token = $_COOKIE['__Host-ag-session'] ?? '';
    $row = false;
    if (is_string($token) && preg_match('/^[a-f0-9]{64}$/D', $token)) {
        $row = accounts_query($db, 'SELECT * FROM accounts_sessions WHERE token_hash=?', [hash('sha256', $token, true)])->fetch();
    }

    if (is_array($row)) {
        if ((int)$row['seen_at'] < time() - 30 * 86400 || (int)$row['created_at'] < time() - 90 * 86400) {
            accounts_query($db, 'DELETE FROM accounts_sessions WHERE token_hash=?', [$row['token_hash']]);
        } else {
            if ((int)$row['seen_at'] < time() - 300) {
                accounts_query($db, 'UPDATE accounts_sessions SET seen_at=? WHERE token_hash=?', [time(), $row['token_hash']]);
            }
            return $row;
        }

    }

    return $create ? accounts_new_session($db) : null;
}

function accounts_csrf(?array $session): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($session === null || !is_string($token) || !hash_equals($session['csrf_token'], $token)) {
        accounts_fail(403, 'csrf_failed', 'Refresh this page before trying again.');
    }

}

function accounts_user(PDO $db, array $session, bool $fence = true): array
{
    if ($session['user_id'] === null) {
        accounts_fail(401, 'login_required', 'Sign in to sync your saved data.');
    }

    if ($fence && ($_SERVER['HTTP_X_ACCOUNT_ID'] ?? '') !== $session['user_id']) {
        accounts_fail(409, 'account_changed', 'The signed-in account changed. Your pending data has been kept.');
    }

    $user = accounts_query($db, 'SELECT id,email FROM accounts_users WHERE id=?', [$session['user_id']])->fetch();
    if (!is_array($user)) {
        accounts_fail(401, 'login_required', 'Sign in again.');
    }
    return $user;
}

function accounts_view(PDO $db, array $config, array $session): array
{
    $user = $session['user_id'] === null ? null : accounts_query($db, 'SELECT id,email FROM accounts_users WHERE id=?', [$session['user_id']])->fetch();
    $result = ['enabled' => $config['enabled'], 'migrationEnabled' => $config['migrationEnabled'], 'user' => $user ?: null, 'csrfToken' => $session['csrf_token']];
    $pending = accounts_query($db, 'SELECT email FROM accounts_pending_google WHERE session_hash=? AND expires_at>?', [$session['token_hash'], time()])->fetchColumn();
    if (is_string($pending)) {
        $result['pendingGoogleEmail'] = $pending;
    }
    return $result;
}

function accounts_email(mixed $value): string
{
    if (!is_string($value)) {
        accounts_fail(422, 'invalid_email', 'Enter a valid email address.');
    }
    $value = strtolower(trim($value));
    if (strlen($value) > 254 || !filter_var($value, FILTER_VALIDATE_EMAIL) || preg_match('/[^\x20-\x7e]/', $value)) {
        accounts_fail(422, 'invalid_email', 'Enter a valid email address.');
    }
    return $value;
}

function accounts_return(mixed $value): string
{
    if (!is_string($value) || !str_starts_with($value, '/') || str_starts_with($value, '//') || str_contains($value, '\\') || preg_match('/[\x00-\x20\x7f?#%]/', $value) || strlen($value) > 1024) {
        return '/account/';
    }
    return $value;
}

function accounts_vendor(string $webroot): void
{
    $path = $webroot.'/reporting/vendor/autoload.php';
    if (!is_file($path)) {
        throw new RuntimeException();
    }
    require_once $path;
}
