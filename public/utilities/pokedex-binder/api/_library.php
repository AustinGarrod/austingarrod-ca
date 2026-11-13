<?php
declare(strict_types=1);

const POKEDEX_SCHEMA_VERSION = 1;
const POKEDEX_MAX_BODY_BYTES = 65536;

final class PokedexApiError extends RuntimeException
{
    public int $status;
    public string $errorCode;
    public array $extra;

    public function __construct(int $status, string $errorCode, string $message, array $extra = [])
    {
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->extra = $extra;
        parent::__construct($message);
    }
}

function pokedex_starts_with(string $value, string $prefix): bool
{
    return strpos($value, $prefix) === 0;
}

function pokedex_is_list(array $value): bool
{
    return $value === [] || array_keys($value) === range(0, count($value) - 1);
}

function pokedex_outside_webroot(string $path, string $webroot): bool
{
    $resolved = realpath($path);
    $root = realpath($webroot);
    if ($resolved === false || $root === false) return false;
    $resolved = str_replace('\\', '/', $resolved);
    $root = rtrim(str_replace('\\', '/', $root), '/');
    if (PHP_OS_FAMILY === 'Windows') { $resolved = strtolower($resolved); $root = strtolower($root); }
    return $resolved !== $root && !pokedex_starts_with($resolved, $root . '/');
}

function pokedex_configuration(string $webroot, ?string $explicitPath = null): array
{
    $home = getenv('HOME') ?: getenv('USERPROFILE') ?: dirname($webroot);
    $path = $explicitPath ?? (getenv('POKEDEX_CONFIG') ?: $home . '/private/pokedex-binder.php');
    if (!preg_match('~^(?:/|[A-Za-z]:[\\\\/])~', $path) || !is_file($path) || !pokedex_outside_webroot($path, $webroot)) {
        throw new PokedexApiError(503, 'sync_unavailable', 'Binder sync has not been configured. Your local collection is still available.');
    }
    $config = require $path;
    if (!is_array($config)) throw new RuntimeException('Invalid private configuration.');
    foreach (['dsn', 'username', 'password', 'rateLimitDirectory', 'rateLimitSecret'] as $name) {
        if (!isset($config[$name]) || !is_string($config[$name])) throw new RuntimeException('Invalid private configuration.');
    }
    if (!pokedex_starts_with($config['dsn'], 'mysql:') || strlen($config['rateLimitSecret']) < 32 || $config['rateLimitDirectory'] === '') {
        throw new RuntimeException('Invalid private configuration.');
    }
    $config['allowedOrigin'] ??= 'https://austingarrod.ca';
    if (!is_string($config['allowedOrigin']) || !preg_match('~^https?://[^/]+$~', $config['allowedOrigin'])) throw new RuntimeException('Invalid private configuration.');
    return $config;
}

function pokedex_database(array $config): PDO
{
    $database = new PDO($config['dsn'], $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 3,
    ]);
    $database->exec('SET NAMES utf8mb4');
    $version = $database->query('SELECT MAX(version) FROM pokedex_schema_migrations')->fetchColumn();
    if ((int) $version !== POKEDEX_SCHEMA_VERSION) throw new RuntimeException('Unsupported database schema.');
    return $database;
}

function pokedex_rate_limit(array $config, string $webroot, string $bucket, int $limit, int $seconds): void
{
    $directory = $config['rateLimitDirectory'];
    if (!preg_match('~^(?:/|[A-Za-z]:[\\\\/])~', $directory)) throw new RuntimeException('Invalid limiter directory.');
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Limiter unavailable.');
    if (!pokedex_outside_webroot($directory, $webroot)) throw new RuntimeException('Limiter directory must be private.');
    $address = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $identifier = hash_hmac('sha256', $bucket . '|' . $address, $config['rateLimitSecret']);
    $handle = @fopen(rtrim($directory, '/\\') . DIRECTORY_SEPARATOR . $identifier . '.json', 'c+');
    if ($handle === false) throw new RuntimeException('Limiter unavailable.');
    try {
        if (!flock($handle, LOCK_EX)) throw new RuntimeException('Limiter unavailable.');
        $raw = stream_get_contents($handle, 2048);
        if (!is_string($raw)) throw new RuntimeException('Limiter unavailable.');
        $stored = $raw !== '' ? json_decode($raw, true) : null;
        if ($raw !== '' && (!is_array($stored) || !is_int($stored['window'] ?? null) || !is_int($stored['count'] ?? null) || $stored['count'] < 0)) throw new RuntimeException('Limiter state is damaged.');
        $window = intdiv(time(), $seconds);
        $count = is_array($stored) && ($stored['window'] ?? null) === $window && is_int($stored['count'] ?? null) ? $stored['count'] : 0;
        if ($count >= $limit) throw new PokedexApiError(429, 'rate_limited', 'Sync is busy. Please wait a moment before trying again.', ['retryAfter' => $seconds - time() % $seconds]);
        $encoded = json_encode(['window' => $window, 'count' => $count + 1], JSON_THROW_ON_ERROR);
        rewind($handle);
        if (!ftruncate($handle, 0) || fwrite($handle, $encoded) !== strlen($encoded) || !fflush($handle)) throw new RuntimeException('Limiter unavailable.');
        @chmod(rtrim($directory, '/\\') . DIRECTORY_SEPARATOR . $identifier . '.json', 0600);
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function pokedex_key_hash($key): string
{
    if (!is_string($key) || !preg_match('/^pdx_[A-Za-z0-9_-]{43}$/D', $key)) throw new PokedexApiError(401, 'invalid_key', 'Enter a valid private sync key.');
    $encoded = substr($key, 4);
    $bytes = base64_decode(strtr($encoded, '-_', '+/') . '=', true);
    if ($bytes === false || strlen($bytes) !== 32 || rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=') !== $encoded) throw new PokedexApiError(401, 'invalid_key', 'Enter a valid private sync key.');
    return hash('sha256', $key, true);
}

function pokedex_client_id($client): string
{
    if (!is_string($client) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iD', $client)) throw new PokedexApiError(422, 'invalid_client', 'This device could not identify its sync session.');
    return strtolower($client);
}

function pokedex_request_body(): array
{
    if (!preg_match('~^application/json(?:\s*;|$)~i', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))) throw new PokedexApiError(415, 'json_required', 'Send this request as JSON.');
    $raw = file_get_contents('php://input', false, null, 0, POKEDEX_MAX_BODY_BYTES + 1);
    if (!is_string($raw) || strlen($raw) > POKEDEX_MAX_BODY_BYTES) throw new PokedexApiError(413, 'request_too_large', 'The collection exceeds the supported sync size.');
    try { $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
    catch (JsonException $error) { throw new PokedexApiError(400, 'invalid_json', 'The sync request is not valid JSON.'); }
    if (!is_array($body) || pokedex_is_list($body)) throw new PokedexApiError(422, 'invalid_request', 'The sync request has an unsupported format.');
    return $body;
}

function pokedex_allowed_ids(string $webroot): array
{
    $path = $webroot . '/utilities/pokedex-binder/catalog/index.json';
    $raw = is_file($path) ? file_get_contents($path) : false;
    $catalog = is_string($raw) ? json_decode($raw, true, 32) : null;
    if (!is_array($catalog) || ($catalog['schemaVersion'] ?? null) !== 1 || !is_array($catalog['species'] ?? null) || count($catalog['species']) === 0) throw new RuntimeException('Species catalog unavailable.');
    $ids = [];
    foreach ($catalog['species'] as $species) {
        if (!is_array($species) || !is_int($species['id'] ?? null) || $species['id'] < 1 || isset($ids[$species['id']])) throw new RuntimeException('Invalid species catalog.');
        $ids[$species['id']] = true;
    }
    return $ids;
}

function pokedex_exact_fields(array $value, array $fields): bool
{
    $actual = array_keys($value);
    sort($actual);
    sort($fields);
    return $actual === $fields;
}

function pokedex_validate_state($value, array $allowedIds): array
{
    $invalid = static fn() => new PokedexApiError(422, 'invalid_state', 'The collection contains unsupported settings or Pokémon.');
    if (!is_array($value) || !pokedex_exact_fields($value, ['schemaVersion', 'settings', 'ownedDexIds']) || $value['schemaVersion'] !== 1 || !is_array($value['settings']) || !is_array($value['ownedDexIds']) || !pokedex_is_list($value['ownedDexIds'])) throw $invalid();
    $settings = $value['settings'];
    if (!pokedex_exact_fields($settings, ['columns', 'rows', 'useBackSides', 'leadingBlankPockets'])) throw $invalid();
    foreach (['columns', 'rows'] as $dimension) if (!is_int($settings[$dimension]) || $settings[$dimension] < 1 || $settings[$dimension] > 6) throw $invalid();
    if (!is_bool($settings['useBackSides']) || !is_int($settings['leadingBlankPockets']) || $settings['leadingBlankPockets'] < 0 || $settings['leadingBlankPockets'] > 1000) throw $invalid();
    if (count($value['ownedDexIds']) > count($allowedIds)) throw $invalid();
    $seen = [];
    foreach ($value['ownedDexIds'] as $id) {
        if (!is_int($id) || !isset($allowedIds[$id]) || isset($seen[$id])) throw $invalid();
        $seen[$id] = true;
    }
    $owned = array_keys($seen);
    sort($owned, SORT_NUMERIC);
    return ['schemaVersion' => 1, 'settings' => ['columns' => $settings['columns'], 'rows' => $settings['rows'], 'useBackSides' => $settings['useBackSides'], 'leadingBlankPockets' => $settings['leadingBlankPockets']], 'ownedDexIds' => $owned];
}

function pokedex_snapshot(array $row, int $ack = 0): array
{
    $state = json_decode($row['state_json'], true, 32, JSON_THROW_ON_ERROR);
    return ['schemaVersion' => 1, 'revision' => (int) $row['revision'], 'state' => $state, 'acknowledgedSequence' => $ack];
}

function pokedex_find(PDO $database, string $keyHash, bool $lock = false, bool $includeDeleted = false): array
{
    $statement = $database->prepare('SELECT id, revision, state_json, deleted_at FROM pokedex_binders WHERE key_hash = ?' . ($includeDeleted ? '' : ' AND deleted_at IS NULL') . ($lock ? ' FOR UPDATE' : ''));
    $statement->execute([$keyHash]);
    $row = $statement->fetch();
    if (!is_array($row)) throw new PokedexApiError(404, 'binder_not_found', 'No synced binder was found for this key.');
    return $row;
}

function pokedex_handle(PDO $database, string $method, string $keyHash, ?array $body, ?string $readClient, array $allowedIds): array
{
    if ($method === 'GET') {
        $statement = $database->prepare('SELECT b.id, b.revision, b.state_json, COALESCE(c.last_applied_sequence, 0) AS acknowledged_sequence FROM pokedex_binders b LEFT JOIN pokedex_binder_clients c ON c.binder_id = b.id AND c.client_id = ? WHERE b.key_hash = ? AND b.deleted_at IS NULL');
        $statement->execute([$readClient ?? '', $keyHash]);
        $row = $statement->fetch();
        if (!is_array($row)) throw new PokedexApiError(404, 'binder_not_found', 'No synced binder was found for this key.');
        return pokedex_snapshot($row, (int) $row['acknowledged_sequence']);
    }
    if ($method === 'POST') {
        if (!pokedex_exact_fields($body ?? [], ['state'])) throw new PokedexApiError(422, 'invalid_request', 'The create request has an unsupported format.');
        $state = pokedex_validate_state($body['state'], $allowedIds);
        $statement = $database->prepare('INSERT INTO pokedex_binders (key_hash, revision, state_json) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE key_hash = key_hash');
        $statement->execute([$keyHash, json_encode($state, JSON_THROW_ON_ERROR)]);
        $row = pokedex_find($database, $keyHash, false, true);
        if ($row['deleted_at'] !== null) throw new PokedexApiError(410, 'binder_revoked', 'This private key was permanently revoked. Disconnect it and create a new key to sync again.');
        $ack = 0;
        if ($readClient !== null) {
            $statement = $database->prepare('SELECT last_applied_sequence FROM pokedex_binder_clients WHERE binder_id = ? AND client_id = ?');
            $statement->execute([$row['id'], $readClient]);
            $ack = (int) $statement->fetchColumn();
        }
        return pokedex_snapshot($row, $ack);
    }
    if ($method === 'DELETE') {
        $database->beginTransaction();
        try {
            $row = pokedex_find($database, $keyHash, true);
            $statement = $database->prepare('UPDATE pokedex_binders SET state_json = NULL, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            $statement->execute([$row['id']]);
            $statement = $database->prepare('DELETE FROM pokedex_binder_clients WHERE binder_id = ?');
            $statement->execute([$row['id']]);
            $database->commit();
            return ['deleted' => true];
        } catch (Throwable $error) {
            if ($database->inTransaction()) $database->rollBack();
            throw $error;
        }
    }
    if (!pokedex_exact_fields($body ?? [], ['clientId', 'mutationSequence', 'baseRevision', 'state'])) throw new PokedexApiError(422, 'invalid_request', 'The sync request has an unsupported format.');
    $client = pokedex_client_id($body['clientId']);
    $sequence = $body['mutationSequence'];
    $revision = $body['baseRevision'];
    if (!is_int($sequence) || $sequence < 1 || $sequence > 9007199254740991 || !is_int($revision) || $revision < 1 || $revision > 9007199254740990) throw new PokedexApiError(422, 'invalid_revision', 'The sync request has an unsupported revision.');
    $state = pokedex_validate_state($body['state'], $allowedIds);
    $database->beginTransaction();
    try {
        $row = pokedex_find($database, $keyHash, true);
        $statement = $database->prepare('INSERT INTO pokedex_binder_clients (binder_id, client_id, last_applied_sequence) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE client_id = client_id');
        $statement->execute([$row['id'], $client]);
        $statement = $database->prepare('SELECT last_applied_sequence FROM pokedex_binder_clients WHERE binder_id = ? AND client_id = ? FOR UPDATE');
        $statement->execute([$row['id'], $client]);
        $ack = (int) $statement->fetchColumn();
        if ($sequence <= $ack) { $database->commit(); return pokedex_snapshot($row, $ack); }
        if ($sequence !== $ack + 1) throw new PokedexApiError(409, 'sequence_gap', 'This device needs to recover its sync session before saving.', pokedex_snapshot($row, $ack));
        if ($revision !== (int) $row['revision']) throw new PokedexApiError(409, 'revision_conflict', 'This binder changed on another device. Review the latest version before saving.', pokedex_snapshot($row, $ack));
        $encoded = json_encode($state, JSON_THROW_ON_ERROR);
        $statement = $database->prepare('UPDATE pokedex_binders SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?');
        $statement->execute([$encoded, $row['id'], $revision]);
        if ($statement->rowCount() !== 1) throw new RuntimeException('Concurrent database change.');
        $statement = $database->prepare('UPDATE pokedex_binder_clients SET last_applied_sequence = ? WHERE binder_id = ? AND client_id = ?');
        $statement->execute([$sequence, $row['id'], $client]);
        $database->commit();
        return ['schemaVersion' => 1, 'revision' => $revision + 1, 'state' => $state, 'acknowledgedSequence' => $sequence];
    } catch (Throwable $error) {
        if ($database->inTransaction()) $database->rollBack();
        throw $error;
    }
}
