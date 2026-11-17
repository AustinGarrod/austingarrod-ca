<?php

declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2).'/public/api/v1/_auth.php';
function oauth_check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
function oauth_reject(callable $run, string $message): void {
    try { $run(); } catch (AccountsError) { return; }
    throw new RuntimeException($message);
}

$server = ['REQUEST_METHOD' => 'POST', 'HTTP_ORIGIN' => 'https://accounts.google.com', 'CONTENT_TYPE' => 'application/x-www-form-urlencoded'];
$query = ['action' => 'google-callback'];
$state = str_repeat('a', 64);
$valid = 'state='.$state.'&code=local-code&scope=openid+email&authuser=0&prompt=consent&hd=example.test&iss=https%3A%2F%2Faccounts.google.com';
oauth_check(accounts_google_callback_input($valid, $server, $query)['code'] === 'local-code', 'Valid Google form and harmless extra fields rejected');
foreach ([
    [$valid, $server, ['action' => 'google-callback', 'code' => 'query-code']],
    [$valid, [...$server, 'REQUEST_METHOD' => 'GET'], $query],
    [$valid, [...$server, 'HTTP_ORIGIN' => 'https://attacker.example'], $query],
    [$valid, [...$server, 'HTTP_ORIGIN' => ''], $query],
    [$valid, [...$server, 'CONTENT_TYPE' => 'application/json'], $query],
    [$valid.'&state='.$state, $server, $query],
    ['state%5B%5D='.$state.'&code=local-code', $server, $query],
    ['state='.$state.'&code=local-code&error=access_denied', $server, $query],
    ['state='.$state.'&code=bad%ZZ', $server, $query],
    ['state='.$state.'&code=bad%0Avalue', $server, $query],
    ['state='.$state.'&code=local-code&iss=https%3A%2F%2Fattacker.example', $server, $query],
    [str_repeat('a', 16385), $server, $query],
] as [$body, $headers, $parameters]) {
    oauth_reject(fn () => accounts_google_callback_input($body, $headers, $parameters), 'Malformed or unbound callback form accepted');
}

// This CLI-only transport seam exercises the real production code and Google's
// real RSA verifier; it cannot be selected through a production request/config.
$webroot = dirname(__DIR__, 2).'/public';
$config = accounts_config($webroot);
$name = (string)getenv('ACCOUNTS_TEST_DATABASE');
oauth_check($config !== null && preg_match('/^accounts_test_[a-z0-9_]+$/D', $name) === 1, 'Isolated fixture database required');
oauth_check(preg_match('/(?:^mysql:|;)host=(?:127\.0\.0\.1|localhost|::1)(?:;|$)/', $config['dsn']) === 1, 'Loopback fixture database required');
$db = accounts_database($config);
oauth_check($db->query('SELECT DATABASE()')->fetchColumn() === $name, 'Fixture database mismatch');
accounts_vendor($webroot);
$private = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
oauth_check($private !== false, 'RSA fixture generation failed');
$details = openssl_pkey_get_details($private);
$b64 = fn (string $value) => rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
$jwk = ['keys' => [['kid' => 'form-fixture', 'alg' => 'RS256', 'kty' => 'RSA', 'use' => 'sig', 'n' => $b64($details['rsa']['n']), 'e' => $b64($details['rsa']['e'])]]];
$make = function (?array $session = null, bool $link = false) use ($db, $config, $webroot): array {
    $session ??= accounts_new_session($db);
    $result = accounts_google_start($db, $config, $session, (object)['returnTo' => '/utilities/pokedex-binder/', 'link' => $link], $webroot);
    parse_str((string)parse_url($result['url'], PHP_URL_QUERY), $parameters);
    oauth_check(($parameters['response_mode'] ?? '') === 'form_post' && ($parameters['code_challenge_method'] ?? '') === 'S256', 'Code flow must retain PKCE and form POST');
    $flow = accounts_query($db, 'SELECT * FROM accounts_oauth WHERE state_hash=?', [hash('sha256', $parameters['state'], true)])->fetch();
    $_COOKIE = ['__Host-ag-oauth' => accounts_google_cookie_proof($config, $parameters['state'], $flow)];
    return [$session, $flow, ['state' => $parameters['state'], 'code' => 'local-code']];
};
$handler = function (array $flow, string $subject, string $email, ?callable $duringToken = null) use ($db, $config, $private, $jwk): callable {
    return function ($request) use ($db, $config, $private, $jwk, $flow, $subject, $email, $duringToken) {
        $uri = (string)$request->getUri();
        if ($uri === 'https://oauth2.googleapis.com/token') {
            parse_str((string)$request->getBody(), $parameters);
            oauth_check($request->getMethod() === 'POST' && ($parameters['code'] ?? '') === 'local-code' && ($parameters['code_verifier'] ?? '') === $flow['verifier'], 'Actual token exchange must use the original PKCE verifier');
            if ($duringToken) $duringToken();
            $claims = ['iss' => 'https://accounts.google.com', 'aud' => $config['google']['clientId'], 'iat' => time(), 'exp' => time() + 600, 'sub' => $subject, 'nonce' => $flow['nonce'], 'email' => $email, 'email_verified' => true];
            $token = Firebase\JWT\JWT::encode($claims, $private, 'RS256', 'form-fixture');
            return new GuzzleHttp\Psr7\Response(200, ['Content-Type' => 'application/json'], json_encode(['access_token' => 'unused-local-token', 'token_type' => 'Bearer', 'expires_in' => 600, 'id_token' => $token]));
        }
        oauth_check($uri === 'https://www.googleapis.com/oauth2/v3/certs', 'Unexpected outbound OAuth request');
        return new GuzzleHttp\Psr7\Response(200, ['Cache-Control' => 'max-age=3600'], json_encode($jwk));
    };
};
[$session, $flow, $input] = $make();
$location = accounts_google_callback($db, $config, $input, $webroot, $handler($flow, 'local-form-first', 'oauth-form-fixture@gmail.com'));
oauth_check($location === '/utilities/pokedex-binder/', 'Successful code flow return destination changed');
$owner = accounts_query($db, "SELECT user_id FROM accounts_identities WHERE provider='google' AND subject=?", ['local-form-first'])->fetchColumn();
oauth_check(is_string($owner), 'Verified form POST did not link an immutable account');
oauth_check(accounts_query($db, 'SELECT token_hash FROM accounts_sessions WHERE token_hash=?', [$session['token_hash']])->fetchColumn() === false, 'Successful callback must retire its original preauth session');
oauth_reject(fn () => accounts_google_callback($db, $config, $input, $webroot, $handler($flow, 'local-form-first', 'oauth-form-fixture@gmail.com')), 'Successful OAuth state replay accepted');

[$session, $flow, $input] = $make();
accounts_google_callback($db, $config, $input, $webroot, $handler($flow, 'local-form-first', 'changed-google-address@gmail.com'));
oauth_check(accounts_query($db, "SELECT user_id FROM accounts_identities WHERE provider='google' AND subject=?", ['local-form-first'])->fetchColumn() === $owner, 'Changing a Google address changed its account identity');
oauth_check(accounts_query($db, 'SELECT id FROM accounts_users WHERE email=?', ['changed-google-address@gmail.com'])->fetchColumn() === false, 'Existing Google identity must not create/merge another email account');

$other = accounts_transaction($db, fn () => accounts_find_or_create($db, 'other-oauth@example.test'));
[$session, $flow, $input] = $make(accounts_new_session($db, $other['id']), true);
oauth_reject(fn () => accounts_google_callback($db, $config, $input, $webroot, $handler($flow, 'local-form-first', 'other-oauth@example.test')), 'Google identity already linked elsewhere was merged');
oauth_check(accounts_query($db, 'SELECT user_id FROM accounts_sessions WHERE token_hash=?', [$session['token_hash']])->fetchColumn() === $other['id'], 'Rejected linking changed the signed-in account');

[$session, $flow, $input] = $make();
oauth_check(accounts_google_callback($db, $config, $input, $webroot, $handler($flow, 'local-form-external', 'pending-form@example.test')) === '/account/?google=verify-email', 'External email must require current mailbox proof');
oauth_check(accounts_query($db, 'SELECT subject FROM accounts_pending_google WHERE session_hash=?', [$session['token_hash']])->fetchColumn() === 'local-form-external', 'Mailbox proof was not bound to the original session');
oauth_check(accounts_query($db, 'SELECT id FROM accounts_users WHERE email=?', ['pending-form@example.test'])->fetchColumn() === false, 'An unproven external address created an account');

[$session, $flow, $input] = $make();
oauth_reject(fn () => accounts_google_callback($db, $config, $input, $webroot, $handler([...$flow, 'nonce' => str_repeat('0', 64)], 'local-form-wrong-nonce', 'nonce-form@gmail.com')), 'A correctly signed token with another flow nonce was accepted');
oauth_check(accounts_query($db, "SELECT user_id FROM accounts_identities WHERE provider='google' AND subject=?", ['local-form-wrong-nonce'])->fetchColumn() === false, 'Wrong-nonce token linked an identity');

[$session, $flow, $input] = $make();
$revoke = fn () => accounts_query($db, 'DELETE FROM accounts_sessions WHERE token_hash=?', [$session['token_hash']]);
oauth_reject(fn () => accounts_google_callback($db, $config, $input, $webroot, $handler($flow, 'local-form-revoked', 'revoked-form@gmail.com', $revoke)), 'A flow revoked during token exchange recreated a session');
oauth_check(accounts_query($db, "SELECT user_id FROM accounts_identities WHERE provider='google' AND subject=?", ['local-form-revoked'])->fetchColumn() === false, 'Revoked flow linked an identity');
oauth_check(accounts_query($db, 'SELECT id FROM accounts_users WHERE email=?', ['revoked-form@gmail.com'])->fetchColumn() === false, 'Revoked flow created a user');
echo "Bound form-post OAuth parser, real signed-token callback, linking and revocation checks passed.\n";
