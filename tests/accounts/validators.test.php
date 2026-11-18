<?php

declare(strict_types=1);
require_once dirname(__DIR__, 2).'/public/api/v1/_validators.php';
require_once dirname(__DIR__, 2).'/public/api/v1/_auth.php';
function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }

}

function reject(callable $fn, string $message): void
{
    try {
        $fn();
    } catch (AccountsError) {
        return;
    }
    throw new RuntimeException($message);
}

$webroot = dirname(__DIR__, 2).'/public';
$profile = (object)['version' => 1, 'catalogRevision' => 'fixture', 'epoch' => 0, 'purchases' => new stdClass(), 'milestones' => new stdClass(), 'showSpoilers' => false];
$modules = new stdClass();
foreach (ACCOUNTS_SYSTEMS as $system) {
    $modules->{$system}
 = (object)['tracked' => false, 'records' => new stdClass()];
}

$progress = (object)['format' => 'idle-slayer-companion-progress', 'version' => 1, 'catalogRevision' => 'fixture', 'ascension' => $profile, 'modules' => $modules];
check(str_contains(accounts_validate('idle-slayer-companion', 'progress', 1, $progress, $webroot), '"records":{}'), 'Empty maps must remain objects');
$progress->modules->material->records->{'unknown-item'}
 = (object)['count' => str_repeat('9', 1024), 'active' => false];
accounts_validate('idle-slayer-companion', 'progress', 1, $progress, $webroot);
$progress->modules->material->records->{'unknown-item'}
->count = '01';
reject(fn () => accounts_validate('idle-slayer-companion', 'progress', 1, $progress, $webroot), 'Noncanonical counts accepted');
$workspace = json_decode('{"format":"idle-slayer-companion-workspace","version":1,"goals":[],"recipePlans":{}}');
accounts_validate('idle-slayer-companion', 'intentions', 1, $workspace, $webroot);
$workspace->privateSave = 'secret';
reject(fn () => accounts_validate('idle-slayer-companion', 'intentions', 1, $workspace, $webroot), 'Unexpected fields accepted');
$comparison = json_decode('{"kind":"upgrade-comparison","version":1,"ids":["unknown-hidden"]}');
accounts_validate('idle-slayer-companion', 'comparison', 1, $comparison, $webroot);
$comparison->ids[] = 'unknown-hidden';
reject(fn () => accounts_validate('idle-slayer-companion', 'comparison', 1, $comparison, $webroot), 'Duplicate comparison IDs accepted');
$checkpoint = (object)['kind' => 'progress-checkpoints', 'version' => 1, 'entries' => [(object)['id' => 'fixture', 'name' => 'A snapshot', 'capturedRevision' => 'old-revision', 'profile' => $profile]]];
accounts_validate('idle-slayer-companion', 'checkpoints', 1, $checkpoint, $webroot);
$profile->purchases->{'unknown'}
 = (object)['epoch' => 1, 'active' => true];
reject(fn () => accounts_profile($profile), 'Future epochs accepted');
check(accounts_registry('radius-map', 'measurements') === 4 * 1024 * 1024, 'Radius Map sync limit differs from its browser adapter');
check(accounts_validate('radius-map', 'measurements', 1, (object)['version' => 1, 'measurements' => []], $webroot)
    === '{"measurements":[],"version":1}', 'An explicitly empty Radius Map library must be valid');
reject(fn () => accounts_validate('radius-map', 'measurements', 1, (object)['version' => 1], $webroot), 'Missing Radius Map state accepted');
check(accounts_return('/utilities/radius-map/') === '/utilities/radius-map/', 'Radius Map return route must be allowed');
check(accounts_return('//external.example/') === '/account/', 'External return accepted');
check(accounts_return('/\\external/') === '/account/', 'Backslash return accepted');
$config = ['google' => ['clientId' => 'local-client']];
$claims = ['iss' => 'https://accounts.google.com', 'aud' => 'local-client', 'exp' => time() + 600, 'nonce' => 'nonce', 'sub' => 'subject', 'email_verified' => true, 'email' => 'person@gmail.com'];
check(accounts_google_claims($claims, $config, 'nonce')['authoritative'], 'Gmail authority not recognized');
reject(fn () => accounts_google_claims($claims, $config, 'wrong'), 'Nonce mismatch accepted');
$claims['email_verified'] = false;
check(!accounts_google_claims($claims, $config, 'nonce')['authoritative'], 'Unverified Google email must require mailed proof');
unset($claims['email_verified']);
check(!accounts_google_claims($claims, $config, 'nonce')['authoritative'], 'Missing Google email verification must require mailed proof');
$claims['email_verified'] = 'true';
reject(fn () => accounts_google_claims($claims, $config, 'nonce'), 'Malformed Google verification claim accepted');
$claims['email_verified'] = true;
$claims['email'] = 'person@external.example';
check(!accounts_google_claims($claims, $config, 'nonce')['authoritative'], 'External-domain Google must require verification');
accounts_vendor($webroot);
// Real RSA signing and the production Google library verifier; keys never leave this process.
$private = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
check($private !== false, 'RSA key generation failed');
$details = openssl_pkey_get_details($private);
$b64 = fn (string $v) => rtrim(strtr(base64_encode($v), '+/', '-_'), '=');
$jwk = ['keys' => [['kid' => 'local-fixture', 'alg' => 'RS256', 'kty' => 'RSA', 'use' => 'sig', 'n' => $b64($details['rsa']['n']), 'e' => $b64($details['rsa']['e'])]]];
$handler = fn ($request) => new GuzzleHttp\Psr7\Response(200, ['Cache-Control' => 'max-age=3600'], json_encode($jwk));
$verifier = new Google\Auth\AccessToken($handler);
$claims['iat'] = time();
$token = Firebase\JWT\JWT::encode($claims, $private, 'RS256', 'local-fixture');
$verified = $verifier->verify($token, ['audience' => 'local-client']);
check(is_array($verified), 'Valid local signature rejected');
check($verifier->verify($token, ['audience' => 'wrong-client']) === false, 'Wrong audience accepted');
$wrong = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
$tampered = Firebase\JWT\JWT::encode($claims, $wrong, 'RS256', 'local-fixture');
check($verifier->verify($tampered, ['audience' => 'local-client']) === false, 'Invalid signature accepted');
$claims['exp'] = time() - 3600;
$expired = Firebase\JWT\JWT::encode($claims, $private, 'RS256', 'local-fixture');
check($verifier->verify($expired, ['audience' => 'local-client']) === false, 'Expired token accepted');
echo "Account validators and local signed-token checks passed.\n";
