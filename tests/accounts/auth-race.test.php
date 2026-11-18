<?php

declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2).'/public/api/v1/_auth.php';

function auth_race_check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
function auth_race_state(PDO $db): array {
    $result = [];
    foreach (['accounts_users', 'accounts_identities', 'accounts_sessions', 'accounts_challenges', 'accounts_oauth', 'accounts_pending_google', 'accounts_rate_limits', 'accounts_documents', 'accounts_document_clients', 'accounts_operations', 'accounts_migration_stages', 'accounts_recovery', 'accounts_legacy_claims', 'pokedex_binders', 'pokedex_binder_clients'] as $table) {
        $rows = $db->query('SELECT * FROM '.$table)->fetchAll(PDO::FETCH_ASSOC);
        $serialized = array_map(function (array $row): string { ksort($row, SORT_STRING); return serialize($row); }, $rows);
        sort($serialized, SORT_STRING);
        // Serialization is binary-safe for hashed tokens/keys; no source data or
        // authentication values ever leave this local fixture in diagnostics.
        $result[$table] = hash('sha256', serialize($serialized));
    }
    return $result;
}
function auth_race_reject(PDO $db, callable $run, string $operation): void {
    $before = auth_race_state($db);
    $rejected = false;
    try { $run(); }
    catch (AccountsError $error) {
        auth_race_check($error->status === 409 && $error->errorCode === 'session_changed', $operation.' returned the wrong stale-session failure');
        $rejected = true;
    }
    auth_race_check($rejected, $operation.' accepted a retired/mismatched session snapshot');
    auth_race_check(!$db->inTransaction(), $operation.' left a transaction open');
    auth_race_check(auth_race_state($db) === $before, $operation.' changed durable data before rejecting a stale session');
}

$webroot = dirname(__DIR__, 2).'/public';
$config = accounts_config($webroot);
$name = (string)getenv('ACCOUNTS_TEST_DATABASE');
auth_race_check($config !== null && preg_match('/^accounts_test_[a-z0-9_]+$/D', $name) === 1, 'Isolated fixture database required');
auth_race_check(preg_match('/(?:^mysql:|;)host=(?:127\.0\.0\.1|localhost|::1)(?:;|$)/', $config['dsn']) === 1, 'Loopback fixture database required');
$db = accounts_database($config);
auth_race_check($db->query('SELECT DATABASE()')->fetchColumn() === $name, 'Fixture database mismatch');
$owner = accounts_transaction($db, fn () => accounts_find_or_create($db, 'auth-race-owner@example.test'));
$other = accounts_transaction($db, fn () => accounts_find_or_create($db, 'auth-race-other@example.test'));
$old = accounts_transaction($db, fn () => accounts_new_session($db, $owner['id']));
$sibling = accounts_transaction($db, fn () => accounts_new_session($db, $owner['id']));
$otherSession = accounts_transaction($db, fn () => accounts_new_session($db, $other['id']));
$challenge = accounts_uuid();
$code = '487206';
accounts_query($db, 'INSERT INTO accounts_challenges(id,session_hash,email,code_hash,expires_at) VALUES(?,?,?,?,?)', [$challenge, $old['token_hash'], 'auth-race-target@example.test', hash_hmac('sha256', $challenge.'|'.$code, $config['secret'], true), time() + 600]);
// Fetch exactly the array a request can retain while another authentication
// response replaces its cookie and retires its session in another transaction.
$snapshot = accounts_query($db, 'SELECT * FROM accounts_sessions WHERE token_hash=?', [$old['token_hash']])->fetch();
$current = accounts_transaction($db, fn () => accounts_new_session($db, $owner['id'], $old['token_hash']));
auth_race_check(accounts_query($db, 'SELECT token_hash FROM accounts_sessions WHERE token_hash=?', [$old['token_hash']])->fetchColumn() === false, 'Fixture did not retire the original session');
$noMail = [...$config, 'smtp' => null];

auth_race_reject($db, fn () => accounts_email_start($db, $noMail, $snapshot, (object)['email' => 'auth-race-send@example.test'], $webroot), 'retired email start');
auth_race_reject($db, fn () => accounts_email_verify($db, $config, $snapshot, (object)['challengeId' => $challenge, 'code' => $code]), 'retired correct-code verification');
auth_race_reject($db, fn () => accounts_google_start($db, $config, $snapshot, (object)[], $webroot), 'retired Google sign-in start');
auth_race_reject($db, fn () => accounts_google_start($db, $config, $snapshot, (object)['link' => true], $webroot), 'retired Google link start');
auth_race_reject($db, fn () => accounts_logout($db, $config, $snapshot, false), 'retired current-device logout');
auth_race_reject($db, fn () => accounts_logout($db, $config, $snapshot, true), 'retired logout everywhere');
auth_race_check(accounts_query($db, 'SELECT id FROM accounts_users WHERE email=?', ['auth-race-target@example.test'])->fetchColumn() === false, 'Retired OTP created an account');
$savedChallenge = accounts_query($db, 'SELECT attempts,consumed_at FROM accounts_challenges WHERE id=?', [$challenge])->fetch();
auth_race_check((int)$savedChallenge['attempts'] === 0 && $savedChallenge['consumed_at'] === null, 'Retired OTP changed challenge counters');

$failedWithoutTransaction = false;
try { accounts_mutating_session($db, $current); } catch (RuntimeException) { $failedWithoutTransaction = true; }
auth_race_check($failedWithoutTransaction && !$db->inTransaction(), 'Mutation lock must require its caller transaction');
foreach ([['csrf_token' => str_repeat('0', 64)], ['user_id' => $other['id']]] as $mismatch) {
    auth_race_reject($db, fn () => accounts_transaction($db, fn () => accounts_mutating_session($db, [...$current, ...$mismatch])), 'mismatched live snapshot');
}
foreach (['seen_at' => time() - 31 * 86400, 'created_at' => time() - 91 * 86400] as $column => $expired) {
    accounts_query($db, 'UPDATE accounts_sessions SET '.$column.'=? WHERE token_hash=?', [$expired, $current['token_hash']]);
    auth_race_reject($db, fn () => accounts_transaction($db, fn () => accounts_mutating_session($db, $current)), 'expired live snapshot');
    accounts_query($db, 'UPDATE accounts_sessions SET '.$column.'=? WHERE token_hash=?', [$current[$column], $current['token_hash']]);
}

// Valid serial operations continue to work and retain their device/all-device
// distinction; stale rejection must not accidentally disable ordinary logout.
$result = accounts_logout($db, $config, $current, false);
auth_race_check(array_key_exists('user', $result) && $result['user'] === null && is_string($result['csrfToken'] ?? null), 'Current logout must return a usable signed-out session');
auth_race_check(accounts_query($db, 'SELECT token_hash FROM accounts_sessions WHERE token_hash=?', [$current['token_hash']])->fetchColumn() === false, 'Current logout retained its original session');
auth_race_check(accounts_query($db, 'SELECT user_id FROM accounts_sessions WHERE token_hash=?', [$sibling['token_hash']])->fetchColumn() === $owner['id'], 'Current logout revoked a sibling device');
$forAll = accounts_transaction($db, fn () => accounts_new_session($db, $owner['id']));
$result = accounts_logout($db, $config, $forAll, true);
auth_race_check(array_key_exists('user', $result) && $result['user'] === null, 'Logout everywhere must return signed-out state');
auth_race_check((int)accounts_query($db, 'SELECT COUNT(*) FROM accounts_sessions WHERE user_id=?', [$owner['id']])->fetchColumn() === 0, 'Logout everywhere retained an owner session');
auth_race_check(accounts_query($db, 'SELECT user_id FROM accounts_sessions WHERE token_hash=?', [$otherSession['token_hash']])->fetchColumn() === $other['id'], 'Logout everywhere revoked another account');
echo "Retired auth snapshots reject before mutation; current and all-device logout remain serially valid.\n";
