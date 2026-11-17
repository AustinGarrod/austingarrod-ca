<?php

declare(strict_types=1);
require_once __DIR__.'/_common.php';
function accounts_find_or_create(PDO $db, string $email): array
{
    accounts_query($db, 'INSERT INTO accounts_users(id,email) VALUES(?,?) ON DUPLICATE KEY UPDATE email=email', [accounts_uuid(), $email]);
    return accounts_query($db, 'SELECT id,email FROM accounts_users WHERE email=? FOR UPDATE', [$email])->fetch();
}

function accounts_link_google(PDO $db, string $subject, string $user): void
{
    $existing = accounts_query($db, "SELECT user_id FROM accounts_identities WHERE provider='google' AND subject=? FOR UPDATE", [$subject])->fetchColumn();
    if ($existing !== false && $existing !== $user) {
        accounts_fail(409, 'identity_already_linked', 'This Google sign-in is linked to another account. Sign into that account to use its data.');
    }

    accounts_query($db, "INSERT INTO accounts_identities(provider,subject,user_id) VALUES('google',?,?) ON DUPLICATE KEY UPDATE subject=subject", [$subject, $user]);
}

function accounts_send_code(array $config, string $webroot, string $email, string $code): void
{
    accounts_vendor($webroot);
    $smtp = $config['smtp'] ?? null;
    if (!is_array($smtp)) {
        throw new RuntimeException();
    }

    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = (string)$smtp['host'];
    $mail->Port = (int)($smtp['port'] ?? 465);
    $encryption = $smtp['encryption'] ?? 'smtps';
    if (!in_array($encryption, ['smtps', 'tls'], true) && !in_array($mail->Host, ['127.0.0.1', 'localhost', '::1'], true)) {
        throw new RuntimeException();
    }

    $mail->SMTPSecure = in_array($encryption, ['smtps', 'tls'], true) ? $encryption : '';
    $mail->SMTPAutoTLS = $mail->SMTPSecure !== '';
    $mail->SMTPAuth = ($smtp['username'] ?? '') !== '';
    $mail->Username = (string)($smtp['username'] ?? '');
    $mail->Password = (string)($smtp['password'] ?? '');
    $mail->Timeout = 10;
    $mail->SMTPDebug = 0;
    $mail->CharSet = 'UTF-8';
    $mail->setFrom((string)$smtp['from'], (string)($smtp['name'] ?? 'AustinGarrod.ca'));
    $mail->addAddress($email);
    $mail->Subject = 'Your AustinGarrod.ca sign-in code';
    $mail->Body = "Your sign-in code is: $code\n\nIt expires in 10 minutes and can be used once.\nIf you did not request it, you can ignore this email.\n";
    $mail->send();
}

function accounts_email_start(PDO $db, array $config, array $session, stdClass $body, string $webroot): array
{
    if (!accounts_fields($body, ['email'], ['returnTo'])) {
        accounts_fail(422, 'invalid_request', 'The sign-in request is invalid.');
    }

    $email = accounts_email($body->email);
    $address = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $id = accounts_uuid();
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $hash = hash_hmac('sha256', $id.'|'.$code, $config['secret'], true);
    accounts_transaction($db, function () use ($db, $config, $session, $email, $address, $id, $hash) {
        $session = accounts_mutating_session($db, $session);
        accounts_rate($db, $config, 'auth-ip', $address, 120, 60);
        accounts_rate($db, $config, 'email-resend', $email, 1, 60);
        accounts_rate($db, $config, 'email-hour', $email, 10, 3600);
        accounts_rate($db, $config, 'email-ip', $address, 30, 3600);
        $pending = accounts_query($db, 'SELECT subject,email FROM accounts_pending_google WHERE session_hash=? AND expires_at>?', [$session['token_hash'], time()])->fetch();
        $subject = is_array($pending) && $pending['email'] === $email ? $pending['subject'] : null;
        accounts_query($db, 'UPDATE accounts_challenges SET consumed_at=? WHERE session_hash=? AND email=? AND consumed_at IS NULL', [time(), $session['token_hash'], $email]);
        accounts_query($db, 'INSERT INTO accounts_challenges(id,session_hash,email,code_hash,expires_at,pending_google) VALUES(?,?,?,?,?,?)', [$id, $session['token_hash'], $email, $hash, time() + 600, $subject]);
    });
    try {
        accounts_send_code($config, $webroot, $email, $code);
    } catch (Throwable $error) {
        accounts_query($db, 'UPDATE accounts_challenges SET consumed_at=? WHERE id=?', [time(), $id]);
        throw $error;
    }

    return ['challengeId' => $id, 'expiresIn' => 600, 'retryAfter' => 60];
}

function accounts_email_verify(PDO $db, array $config, array $session, stdClass $body): array
{
    if (!accounts_fields($body, ['challengeId', 'code'])) {
        accounts_fail(422, 'invalid_request', 'The code request is invalid.');
    }
    $id = accounts_id($body->challengeId);
    if (!is_string($body->code) || !preg_match('/^[0-9]{6}$/D', $body->code)) {
        accounts_fail(422, 'invalid_code', 'Enter the six-digit code from your email.');
    }

    $result = accounts_transaction($db, function () use ($db, $config, $session, $body, $id) {
        $session = accounts_mutating_session($db, $session);
        accounts_rate($db, $config, 'auth-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 120, 60);
        accounts_rate($db, $config, 'verify-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 60, 600);
        $row = accounts_query($db, 'SELECT * FROM accounts_challenges WHERE id=? AND session_hash=? FOR UPDATE', [$id, $session['token_hash']])->fetch();
        if (!is_array($row) || $row['consumed_at'] !== null || (int)$row['expires_at'] <= time() || (int)$row['attempts'] >= 5) {
            return null;
        }

        accounts_query($db, 'UPDATE accounts_challenges SET attempts=attempts+1 WHERE id=?', [$id]);
        if (!hash_equals($row['code_hash'], hash_hmac('sha256', $id.'|'.$body->code, $config['secret'], true))) {
            return null;
        }

        $user = accounts_find_or_create($db, $row['email']);
        if ($row['pending_google'] !== null) {
            accounts_link_google($db, $row['pending_google'], $user['id']);
        }

        accounts_query($db, 'UPDATE accounts_challenges SET consumed_at=? WHERE id=?', [time(), $id]);
        accounts_query($db, 'DELETE FROM accounts_pending_google WHERE session_hash=?', [$session['token_hash']]);
        return accounts_prepare_session($db, $user['id'], $session['token_hash']);
    });
    if ($result === null) {
        accounts_fail(401, 'code_invalid_or_expired', 'The code is incorrect or expired. Request a new code if needed.');
    }
    return accounts_view($db, $config, accounts_publish_session($result));
}

function accounts_logout(PDO $db, array $config, array $session, bool $everywhere): array
{
    $prepared = accounts_transaction($db, function () use ($db, $config, $session, $everywhere) {
        $live = accounts_mutating_session($db, $session);
        accounts_rate($db, $config, 'auth-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 120, 60);
        if ($everywhere && $live['user_id'] !== null) {
            accounts_query($db, 'DELETE FROM accounts_sessions WHERE user_id=?', [$live['user_id']]);
        }
        return accounts_prepare_session($db, null, $live['token_hash']);
    });
    return accounts_view($db, $config, accounts_publish_session($prepared));
}

/** Explicit same-origin login intent only; discovery never replaces a retired
 * cookie automatically. A current cookie is revalidated and left unchanged. */
function accounts_bootstrap(PDO $db, array $config, stdClass $body): array
{
    if (!accounts_fields($body, [])) accounts_fail(422, 'invalid_request', 'The sign-in request is invalid.');
    $snapshot = accounts_session($db, false, false);
    $result = accounts_transaction($db, function () use ($db, $config, $snapshot) {
        $live = $snapshot === null ? null : accounts_mutating_session($db, $snapshot);
        accounts_rate($db, $config, 'auth-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 120, 60);
        return $live === null ? ['prepared' => accounts_prepare_session($db)] : ['live' => $live];
    });
    $live = $result['live'] ?? accounts_publish_session($result['prepared']);
    return accounts_view($db, $config, $live);
}

function accounts_google_provider(array $config, string $webroot, ?string $verifier = null): Google\Auth\OAuth2
{
    accounts_vendor($webroot);
    $google = $config['google'] ?? [];
    if (!is_string($google['clientId'] ?? null) || $google['clientId'] === '' || !is_string($google['clientSecret'] ?? null) || $google['clientSecret'] === '') {
        accounts_fail(503, 'google_unavailable', 'Google sign-in is not configured yet. You can use an emailed code.');
    }

    return new Google\Auth\OAuth2(['clientId' => $google['clientId'], 'clientSecret' => $google['clientSecret'], 'authorizationUri' => 'https://accounts.google.com/o/oauth2/v2/auth', 'tokenCredentialUri' => 'https://oauth2.googleapis.com/token', 'redirectUri' => $config['allowedOrigin'].'/api/v1/auth.php?action=google-callback', 'scope' => ['openid', 'email'], 'codeVerifier' => $verifier]);
}

function accounts_google_start(PDO $db, array $config, array $session, stdClass $body, string $webroot): array
{
    if (!accounts_fields($body, [], ['returnTo', 'link']) || (property_exists($body, 'link') && !is_bool($body->link))) {
        accounts_fail(422, 'invalid_request', 'The Google sign-in request is invalid.');
    }

    $prepared = accounts_transaction($db, function () use ($db, $config, $session, $body, $webroot) {
        $session = accounts_mutating_session($db, $session);
        accounts_rate($db, $config, 'auth-ip', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 120, 60);
        accounts_rate($db, $config, 'google-start', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 30, 600);
        $state = bin2hex(random_bytes(32));
        $nonce = bin2hex(random_bytes(32));
        $verifier = rtrim(strtr(base64_encode(random_bytes(64)), '+/', '-_'), '=');
        $link = ($body->link ?? false) ? $session['user_id'] : null;
        if (($body->link ?? false) && $link === null) {
            accounts_fail(401, 'login_required', 'Sign in before linking Google.');
        }

        $provider = accounts_google_provider($config, $webroot, $verifier);
        $provider->setState($state);
        $url = (string)$provider->buildFullAuthorizationUri(['nonce' => $nonce, 'prompt' => 'select_account', 'response_mode' => 'form_post']);
        $expires = time() + 600;
        accounts_query($db, 'INSERT INTO accounts_oauth(state_hash,session_hash,nonce,verifier,return_to,link_user,expires_at) VALUES(?,?,?,?,?,?,?)', [hash('sha256', $state, true), $session['token_hash'], $nonce, $verifier, accounts_return($body->returnTo ?? null), $link, $expires]);
        return ['url' => $url, 'proof' => accounts_google_cookie_proof($config, $state, ['session_hash' => $session['token_hash'], 'expires_at' => $expires]), 'expires' => $expires];
    });
    accounts_oauth_cookie($prepared['proof'], $prepared['expires']);
    return ['url' => $prepared['url']];
}

function accounts_google_cookie_proof(array $config, string $state, array $flow): string
{
    return hash_hmac('sha256', 'oauth-form|'.$state.'|'.bin2hex($flow['session_hash']).'|'.$flow['expires_at'], $config['secret']);
}

/** Parse a bounded form ourselves: PHP's form parser silently accepts repeated
 * keys and arrays, which must never make the callback state ambiguous. */
function accounts_google_callback_input(?string $raw = null, ?array $server = null, ?array $query = null): array
{
    $server ??= $_SERVER;
    $query ??= $_GET;
    if (($server['REQUEST_METHOD'] ?? '') !== 'POST'
        || ($server['HTTP_ORIGIN'] ?? '') !== 'https://accounts.google.com'
        || !preg_match('~^application/x-www-form-urlencoded(?:\s*;\s*charset=(?:utf-8|us-ascii))?\s*$~iD', (string)($server['CONTENT_TYPE'] ?? ''))
        || $query !== ['action' => 'google-callback']) {
        accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified. Please try again.');
    }
    $raw ??= file_get_contents('php://input', false, null, 0, 16385);
    if (!is_string($raw) || strlen($raw) > 16384) {
        accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified. Please try again.');
    }
    $pairs = explode('&', $raw);
    if (count($pairs) > 32) accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified.');
    $input = [];
    foreach ($pairs as $pair) {
        if ($pair === '') continue;
        if (preg_match('/%(?![a-f0-9]{2})/i', $pair)) accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified.');
        $parts = explode('=', $pair, 2);
        $key = rawurldecode(str_replace('+', ' ', $parts[0]));
        $value = rawurldecode(str_replace('+', ' ', $parts[1] ?? ''));
        if (!preg_match('/^[a-z_][a-z0-9_]{0,63}$/D', $key) || array_key_exists($key, $input) || strlen($value) > 8192 || preg_match('/[\x00-\x1f\x7f]/', $value)) {
            accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified.');
        }
        $input[$key] = $value;
    }
    if (!preg_match('/^[a-f0-9]{64}$/D', $input['state'] ?? '') || (isset($input['code']) === isset($input['error']))
        || (isset($input['iss']) && $input['iss'] !== 'https://accounts.google.com')) {
        accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified.');
    }
    return $input;
}

function accounts_google_claims(array $claims, array $config, string $nonce): array
{
    if (!in_array($claims['iss'] ?? null, ['accounts.google.com', 'https://accounts.google.com'], true) || ($claims['aud'] ?? null) !== ($config['google']['clientId'] ?? null) || !is_int($claims['exp'] ?? null) || $claims['exp'] <= time() || !is_string($claims['nonce'] ?? null) || !hash_equals($nonce, $claims['nonce']) || !is_string($claims['sub'] ?? null) || !preg_match('/^[\x21-\x7e]{1,255}$/D', $claims['sub']) || (isset($claims['email_verified']) && !is_bool($claims['email_verified']))) {
        accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified. Please try again.');
    }

    if (isset($claims['azp']) && $claims['azp'] !== $config['google']['clientId']) {
        accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified.');
    }

    // An unverified or non-authoritative email needs our mailed proof before
    // first linking. Existing identities continue to use their stable subject.
    return ['subject' => $claims['sub'], 'email' => accounts_email($claims['email'] ?? null), 'authoritative' => ($claims['email_verified'] ?? false) === true && (str_ends_with(strtolower((string)$claims['email']), '@gmail.com') || (is_string($claims['hd'] ?? null) && $claims['hd'] !== ''))];
}

function accounts_google_callback(PDO $db, array $config, array $input, string $webroot, ?callable $httpHandler = null): string
{
    $state = $input['state'] ?? '';
    $code = $input['code'] ?? '';
    if (!is_string($state) || !preg_match('/^[a-f0-9]{64}$/D', $state)) {
        accounts_fail(401, 'oauth_state_invalid', 'The Google sign-in expired. Please start again.');
    }

    $proof = $_COOKIE['__Host-ag-oauth'] ?? '';
    $bound = accounts_transaction($db, function () use ($db, $state, $config, $proof) {
        $hash = hash('sha256', $state, true);
        $flow = accounts_query($db, 'SELECT * FROM accounts_oauth WHERE state_hash=? FOR UPDATE', [$hash])->fetch();
        if (!is_array($flow) || (int)$flow['expires_at'] <= time() || !is_string($proof) || !preg_match('/^[a-f0-9]{64}$/D', $proof) || !hash_equals(accounts_google_cookie_proof($config, $state, $flow), $proof)) {
            accounts_fail(401, 'oauth_state_invalid', 'The Google sign-in expired. Please start again.');
        }
        $session = accounts_query($db, 'SELECT * FROM accounts_sessions WHERE token_hash=?', [$flow['session_hash']])->fetch();
        $main = $_COOKIE['__Host-ag-session'] ?? null;
        if (!is_array($session) || (int)$session['seen_at'] < time() - 30 * 86400 || (int)$session['created_at'] < time() - 90 * 86400
            || ($main !== null && (!is_string($main) || !preg_match('/^[a-f0-9]{64}$/D', $main) || !hash_equals($flow['session_hash'], hash('sha256', $main, true))))) {
            accounts_fail(401, 'oauth_state_invalid', 'The Google sign-in expired. Please start again.');
        }
        $session = accounts_mutating_session($db, $session);
        accounts_query($db, 'DELETE FROM accounts_oauth WHERE state_hash=?', [$hash]);
        return [$flow, $session];
    });
    [$flow, $session] = $bound;
    if (isset($input['error'])) {
        return $input['error'] === 'access_denied' ? '/account/?google=cancelled' : '/account/?google=failed';
    }

    if (!is_string($code) || $code === '' || strlen($code) > 4096) {
        accounts_fail(401, 'google_invalid', 'Google sign-in did not return a valid code.');
    }

    $provider = accounts_google_provider($config, $webroot, $flow['verifier']);
    $provider->setCode($code);
    $http = $httpHandler ?? Google\Auth\HttpHandler\HttpHandlerFactory::build(new GuzzleHttp\Client([
        'connect_timeout' => 3,
        'timeout' => 10,
        'allow_redirects' => false,
    ]));
    $tokens = $provider->fetchAuthToken($http);
    if (!is_string($tokens['id_token'] ?? null)) {
        accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified.');
    }

    $verifier = new Google\Auth\AccessToken($http);
    $verified = $verifier->verify($tokens['id_token'], ['audience' => $config['google']['clientId']]);
    if (!is_array($verified)) {
        accounts_fail(401, 'google_invalid', 'Google sign-in could not be verified.');
    }
    $claims = accounts_google_claims($verified, $config, $flow['nonce']);
    $result = accounts_transaction($db, function () use ($db, $flow, $claims, $session) {
        // A logout or account switch during Google's network exchange revokes
        // the original flow; it must never recreate a retired browser session.
        $session = accounts_mutating_session($db, $session);
        $user = accounts_query($db, "SELECT u.id,u.email FROM accounts_identities i JOIN accounts_users u ON u.id=i.user_id WHERE i.provider='google' AND i.subject=?", [$claims['subject']])->fetch();
        if (is_array($user)) {
            if ($flow['link_user'] !== null && $flow['link_user'] !== $user['id']) {
                accounts_fail(409, 'identity_already_linked', 'This Google sign-in is linked to another account.');
            }

            return ['location' => $flow['return_to'], 'prepared' => accounts_prepare_session($db, $user['id'], $session['token_hash'])];
        }

        if ($flow['link_user'] !== null) {
            $current = accounts_user($db, $session, false);
            if ($current['id'] !== $flow['link_user'] || $current['email'] !== $claims['email']) {
                accounts_fail(409, 'email_mismatch', 'Use Google with the same email as your account.');
            }
        }

        if (!$claims['authoritative']) {
            accounts_query($db, 'INSERT INTO accounts_pending_google(session_hash,subject,email,expires_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE subject=VALUES(subject),email=VALUES(email),expires_at=VALUES(expires_at)', [$session['token_hash'], $claims['subject'], $claims['email'], time() + 600]);
            return ['location' => '/account/?google=verify-email'];
        }

        $u = accounts_find_or_create($db, $claims['email']);
        accounts_link_google($db, $claims['subject'], $u['id']);
        return ['location' => $flow['return_to'], 'prepared' => accounts_prepare_session($db, $u['id'], $session['token_hash'])];
    });
    if (isset($result['prepared'])) accounts_publish_session($result['prepared']);
    return $result['location'];
}
