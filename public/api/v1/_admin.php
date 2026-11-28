<?php

declare(strict_types=1);

require_once __DIR__.'/_common.php';
require_once __DIR__.'/_validators.php';

const ADMIN_USER_PAGE_SIZE = 20;
const ADMIN_RECOVERY_PAGE_SIZE = 15;

function accounts_admin_config(string $webroot): ?array
{
    $home = getenv('HOME') ?: getenv('USERPROFILE') ?: dirname($webroot);
    $accounts = getenv('ACCOUNTS_CONFIG') ?: $home.'/private/accounts.php';
    $directory = dirname($accounts);
    $path = $directory.'/utility-admin.json';
    $auditPath = $directory.'/utility-admin-audit.jsonl';
    clearstatcache(true, $path);
    clearstatcache(true, $auditPath);
    if (!is_file($path) || !accounts_private_path($path, $webroot)) {
        return null;
    }
    $raw = @file_get_contents($path, false, null, 0, 4097);
    if (!is_string($raw) || strlen($raw) > 4096) {
        return null;
    }
    $settings = json_decode($raw, true, 8);
    $operators = $settings['operators'] ?? null;
    if (!is_array($operators) || !array_is_list($operators) || $operators === []
        || !is_file($auditPath) || is_link($auditPath) || !accounts_private_path($auditPath, $webroot)) {
        return null;
    }
    foreach ($operators as $id) {
        if (!is_string($id) || !preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $id)) {
            return null;
        }
    }
    return ['operators' => $operators, 'auditPath' => $auditPath];
}

function accounts_admin_audit(string $path, string $operator, string $action, ?string $target, ?string $record): void
{
    $event = json_encode([
        'at' => gmdate('c'), 'operator' => $operator, 'action' => $action,
        'account' => $target, 'record' => $record,
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES)."\n";
    $handle = @fopen($path, 'r+b');
    if ($handle === false) {
        accounts_fail(503, 'audit_unavailable', 'Utility admin cannot record this access. Try again later.');
    }
    try {
        if (!@flock($handle, LOCK_EX) || @fseek($handle, 0, SEEK_END) !== 0
            || @fwrite($handle, $event) !== strlen($event) || !@fflush($handle)) {
            accounts_fail(503, 'audit_unavailable', 'Utility admin cannot record this access. Try again later.');
        }
    } finally {
        fclose($handle);
    }
}

function accounts_admin_overview(PDO $db): array
{
    $since = time() - 30 * 86400;
    $timestamp = gmdate('Y-m-d H:i:s', $since);
    $accounts = accounts_query($db, 'SELECT COUNT(*) AS total, COUNT(CASE WHEN created_at>=? THEN 1 END) AS newAccounts FROM accounts_users', [$timestamp])->fetch();
    $signedIn = accounts_query($db, 'SELECT COUNT(DISTINCT user_id) FROM accounts_sessions WHERE seen_at>=? AND created_at>=?', [$since, time() - 90 * 86400])->fetchColumn();
    $rows = accounts_query($db, 'SELECT app, COUNT(DISTINCT user_id) AS accounts, COUNT(*) AS saves,
        COUNT(DISTINCT CASE WHEN updated_at>=? THEN user_id END) AS recentlySynced,
        MAX(updated_at) AS lastSavedAt FROM accounts_documents GROUP BY app', [$timestamp])->fetchAll();
    $apps = array_fill_keys(array_keys(ACCOUNTS_DOCUMENT_LIMITS), ['accounts' => 0, 'saves' => 0, 'recentlySynced' => 0, 'lastSavedAt' => null]);
    foreach ($rows as $row) {
        $apps[$row['app']] = ['accounts' => (int)$row['accounts'], 'saves' => (int)$row['saves'],
            'recentlySynced' => (int)$row['recentlySynced'], 'lastSavedAt' => accounts_admin_timestamp($row['lastSavedAt'])];
    }
    return ['accounts' => (int)$accounts['total'], 'newAccounts' => (int)$accounts['newAccounts'],
        'signedIn' => (int)$signedIn, 'saves' => array_sum(array_column($apps, 'saves')), 'apps' => $apps];
}

function accounts_admin_timestamp(?string $value): ?string
{
    return $value === null ? null : str_replace(' ', 'T', $value).'Z';
}

function accounts_admin_users(PDO $db, stdClass $body): array
{
    $search = $body->search ?? '';
    $app = $body->app ?? '';
    $after = $body->after ?? '';
    if (!is_string($search) || strlen($search) > 254 || !is_string($after) || strlen($after) > 254
        || !is_string($app) || ($app !== '' && !isset(ACCOUNTS_DOCUMENT_LIMITS[$app]))) {
        accounts_fail(422, 'invalid_filter', 'Check the account search or utility filter.');
    }
    $search = strtolower(trim($search));
    $prefix = strtr($search, ['!' => '!!', '%' => '!%', '_' => '!_']).'%';
    $rows = accounts_query($db, "SELECT u.id,u.email,u.created_at,
        (SELECT COUNT(*) FROM accounts_documents d WHERE d.user_id=u.id) AS saves,
        (SELECT MAX(d.updated_at) FROM accounts_documents d WHERE d.user_id=u.id) AS lastSavedAt
        FROM accounts_users u WHERE u.email>? AND (?='' OR u.email LIKE ? ESCAPE '!' OR u.id=?)
        AND (?='' OR EXISTS (SELECT 1 FROM accounts_documents WHERE user_id=u.id AND app=?))
        ORDER BY u.email LIMIT ".(ADMIN_USER_PAGE_SIZE + 1), [$after, $search, $prefix, $search, $app, $app])->fetchAll();
    $more = count($rows) > ADMIN_USER_PAGE_SIZE;
    if ($more) array_pop($rows);
    $users = array_map(fn (array $row) => [
        'id' => $row['id'], 'email' => $row['email'], 'createdAt' => accounts_admin_timestamp($row['created_at']),
        'saves' => (int)$row['saves'], 'lastSavedAt' => accounts_admin_timestamp($row['lastSavedAt']),
    ], $rows);
    return ['users' => $users, 'next' => $more ? end($rows)['email'] : null];
}

function accounts_admin_account(PDO $db, string $user): array
{
    $account = accounts_query($db, 'SELECT id,email,created_at FROM accounts_users WHERE id=?', [$user])->fetch();
    if (!$account) {
        accounts_fail(404, 'unknown_account', 'This account could not be found.');
    }
    $session = accounts_query($db, 'SELECT MAX(seen_at) AS lastSeen,
        COUNT(CASE WHEN seen_at>=? AND created_at>=? THEN 1 END) AS active
        FROM accounts_sessions WHERE user_id=?', [time() - 30 * 86400, time() - 90 * 86400, $user])->fetch();
    $providers = accounts_query($db, 'SELECT DISTINCT provider FROM accounts_identities WHERE user_id=? ORDER BY provider', [$user])->fetchAll(PDO::FETCH_COLUMN);
    $rows = accounts_query($db, 'SELECT d.id,d.app,d.document,d.schema_version,d.revision,d.updated_at,
        OCTET_LENGTH(d.state_json) AS bytes,
        (SELECT COUNT(*) FROM accounts_document_clients c WHERE c.resource_id=d.id) AS clients
        FROM accounts_documents d WHERE d.user_id=? ORDER BY d.app,d.document', [$user])->fetchAll();
    $account['createdAt'] = accounts_admin_timestamp($account['created_at']);
    unset($account['created_at']);
    return ['account' => $account, 'providers' => $providers,
        'lastSessionAt' => $session['lastSeen'] === null ? null : gmdate('c', (int)$session['lastSeen']),
        'activeSessions' => (int)$session['active'],
        'stockAlerts' => accounts_admin_stock_alerts($db, $user),
        'saves' => array_map(fn (array $row) => accounts_admin_save_metadata($row, false) + ['clients' => (int)$row['clients']], $rows),
        'recoveryCount' => (int)accounts_query($db, 'SELECT COUNT(*) FROM accounts_recovery WHERE user_id=?', [$user])->fetchColumn()];
}

function accounts_admin_stock_alerts(PDO $db, string $user): array
{
    try {
        $rows = accounts_query($db, 'SELECT store, minimum, enabled, last_checked_at, last_sent_at
            FROM accounts_binder_stock_alerts WHERE user_id=? ORDER BY enabled DESC, store', [$user])->fetchAll();
    } catch (PDOException $error) {
        // A host may deploy the utility before applying its optional alerts schema.
        if (($error->errorInfo[0] ?? '') === '42S02' && (int)($error->errorInfo[1] ?? 0) === 1146) return [];
        throw $error;
    }
    return array_map(static fn (array $row) => [
        'store' => $row['store'], 'minimum' => (int)$row['minimum'], 'enabled' => (bool)$row['enabled'],
        'lastCheckedAt' => $row['last_checked_at'] === null ? null : gmdate('c', (int)$row['last_checked_at']),
        'lastSendAttemptAt' => $row['last_sent_at'] === null ? null : gmdate('c', (int)$row['last_sent_at']),
    ], $rows);
}

function accounts_admin_save_metadata(array $row, bool $recovery): array
{
    return ['id' => $row['id'], 'app' => $row['app'], 'document' => $row['document'],
        'schemaVersion' => (int)$row['schema_version'], 'revision' => (int)$row['revision'], 'bytes' => (int)$row['bytes'],
        'date' => accounts_admin_timestamp($row[$recovery ? 'created_at' : 'updated_at']),
        'label' => $recovery ? $row['label'] : null];
}

function accounts_admin_recovery(PDO $db, string $user, stdClass $body): array
{
    $beforeId = ($body->beforeId ?? '') === '' ? null : accounts_id($body->beforeId);
    $beforeDate = $body->beforeDate ?? '';
    if ($beforeId !== null && (!is_string($beforeDate) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D', $beforeDate))) {
        accounts_fail(422, 'invalid_cursor', 'Refresh the recovery list before continuing.');
    }
    $values = [$user];
    $where = '';
    if ($beforeId !== null) {
        $date = str_replace('T', ' ', substr($beforeDate, 0, -1));
        $where = ' AND (created_at<? OR (created_at=? AND id<?))';
        array_push($values, $date, $date, $beforeId);
    }
    $rows = accounts_query($db, 'SELECT id,app,document,label,schema_version,revision,created_at,OCTET_LENGTH(state_json) AS bytes
        FROM accounts_recovery WHERE user_id=?'.$where.' ORDER BY created_at DESC,id DESC LIMIT '.(ADMIN_RECOVERY_PAGE_SIZE + 1), $values)->fetchAll();
    $more = count($rows) > ADMIN_RECOVERY_PAGE_SIZE;
    if ($more) array_pop($rows);
    return ['snapshots' => array_map(fn (array $row) => accounts_admin_save_metadata($row, true), $rows), 'more' => $more];
}

function accounts_admin_saved_data(PDO $db, string $user, string $id, bool $recovery): array
{
    $table = $recovery ? 'accounts_recovery' : 'accounts_documents';
    $metadata = $recovery ? 'label,created_at' : 'updated_at';
    $row = accounts_query($db, "SELECT id,app,document,schema_version,revision,$metadata,state_json,
        OCTET_LENGTH(state_json) AS bytes FROM $table WHERE user_id=? AND id=?", [$user, $id])->fetch();
    if (!$row) {
        accounts_fail(404, 'unknown_save', 'This saved version could not be found.');
    }
    return ['save' => accounts_admin_save_metadata($row, $recovery), 'json' => $row['state_json']];
}
