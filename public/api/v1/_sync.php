<?php

declare(strict_types=1);
require_once __DIR__.'/_validators.php';
require_once __DIR__.'/_binder-shares.php';
function accounts_lock_user(PDO $db, string $user): void
{
    accounts_query($db, 'SELECT id FROM accounts_users WHERE id=? FOR UPDATE', [$user])->fetch();
}

function accounts_document(PDO $db, string $user, string $app, string $document, bool $lock = false): ?array
{
    $row = accounts_query($db, 'SELECT * FROM accounts_documents WHERE user_id=? AND app=? AND document=?'.($lock ? ' FOR UPDATE' : ''), [$user, $app, $document])->fetch();
    return is_array($row) ? $row : null;
}

function accounts_remote(PDO $db, ?array $row, string $client): ?array
{
    if ($row === null) {
        return null;
    }
    $ack = accounts_query($db, 'SELECT acknowledged_sequence FROM accounts_document_clients WHERE resource_id=? AND client_id=?', [$row['id'], $client])->fetchColumn();
    return ['resourceId' => $row['id'], 'app' => $row['app'], 'document' => $row['document'], 'schemaVersion' => (int)$row['schema_version'], 'revision' => (int)$row['revision'], 'state' => json_decode($row['state_json'], false, 64, JSON_THROW_ON_ERROR), 'acknowledgedSequence' => $ack === false ? 0 : (int)$ack];
}

function accounts_snapshot(PDO $db, string $user, string $app, string $document, string $label, int $version, int $revision, string $json, ?string $createdAt = null): string
{
    $id = accounts_uuid();
    accounts_query($db, 'INSERT INTO accounts_recovery(id,user_id,app,document,label,schema_version,revision,state_json,created_at) VALUES(?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))', [$id, $user, $app, $document, $label, $version, $revision, $json, $createdAt]);
    return $id;
}

// The caller holds the account lock. Keep the state before the first synced change on each UTC date.
function accounts_daily_checkpoint(PDO $db, array $row): void
{
    $scope = [$row['user_id'], $row['app'], $row['document'], 'Before sync'];
    $createdAt = gmdate('Y-m-d H:i:s');
    $today = substr($createdAt, 0, 10);
    $days = accounts_query($db, 'SELECT DATE(created_at) FROM accounts_recovery
        WHERE user_id=? AND app=? AND document=? AND label=? ORDER BY created_at DESC LIMIT 4', $scope)->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array($today, $days, true)) {
        accounts_snapshot($db, $row['user_id'], $row['app'], $row['document'], 'Before sync', (int)$row['schema_version'], (int)$row['revision'], $row['state_json'], $createdAt);
        $days[] = $today;
    }
    if (count($days) <= 3 && count(array_unique($days)) === count($days)) {
        return;
    }

    $keepers = accounts_query($db, 'SELECT id FROM (
        SELECT id, DATE(created_at) AS checkpoint_day,
            ROW_NUMBER() OVER (PARTITION BY DATE(created_at) ORDER BY created_at, revision, id) AS day_position
        FROM accounts_recovery WHERE user_id=? AND app=? AND document=? AND label=?
    ) AS checkpoints WHERE day_position=1 ORDER BY checkpoint_day DESC LIMIT 3', $scope)->fetchAll(PDO::FETCH_COLUMN);
    $placeholders = implode(',', array_fill(0, count($keepers), '?'));
    accounts_query($db, 'DELETE FROM accounts_recovery WHERE user_id=? AND app=? AND document=? AND label=? AND id NOT IN ('.$placeholders.')', [...$scope, ...$keepers]);
}

function accounts_precondition(PDO $db, ?array $row, int $revision, string $client): void
{
    if (($row === null ? 0 : (int)$row['revision']) !== $revision) {
        accounts_fail(409, 'revision_conflict', 'This document changed on another device. Review both copies before saving.', ['remote' => accounts_remote($db, $row, $client)]);
    }

}

function accounts_operation(PDO $db, string $user, string $id, string $kind, string $hash): ?array
{
    $row = accounts_query($db, 'SELECT * FROM accounts_operations WHERE user_id=? AND operation_id=?', [$user, $id])->fetch();
    if (!is_array($row)) {
        return null;
    }

    if ($row['kind'] !== $kind || !hash_equals($row['payload_hash'], $hash)) {
        accounts_fail(409, 'operation_reused', 'This operation identifier was already used for different data.');
    }
    return json_decode($row['result_json'], true, 64, JSON_THROW_ON_ERROR);
}

function accounts_record_operation(PDO $db, string $user, string $id, string $kind, string $hash, array $result): void
{
    accounts_query($db, 'INSERT INTO accounts_operations(user_id,operation_id,kind,payload_hash,result_json) VALUES(?,?,?,?,?)', [$user, $id, $kind, $hash, json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}

function accounts_save_document(PDO $db, string $user, string $app, string $document, int $version, string $json, ?array $row): array
{
    if ($row === null) {
        $id = accounts_uuid();
        accounts_query($db, 'INSERT INTO accounts_documents(id,user_id,app,document,schema_version,revision,state_json) VALUES(?,?,?,?,?,1,?)', [$id, $user, $app, $document, $version, $json]);
    } else {
        if ($app === 'pokedex-binder') {
            binder_shares_revoke_removed($db, $user, $document, $row['state_json'], $json);
        }
        accounts_query($db, 'UPDATE accounts_documents SET schema_version=?,revision=revision+1,state_json=? WHERE id=?', [$version, $json, $row['id']]);
    }

    return accounts_document($db, $user, $app, $document, true);
}

function accounts_document_pair(mixed $app, mixed $document): array
{
    if (!is_string($app) || !is_string($document)) {
        accounts_fail(422, 'invalid_document', 'The application document is invalid.');
    }
    accounts_registry($app, $document);
    return [$app, $document];
}

function accounts_keep_legacy_binder_fields(string $app, string $document, string $json, ?array $row, bool $keepOrders = false): string
{
    if ($app !== 'pokedex-binder' || $document !== 'binder' || $row === null) return $json;
    $state = json_decode($json, false, 64, JSON_THROW_ON_ERROR);
    $current = json_decode($row['state_json'], false, 64, JSON_THROW_ON_ERROR);
    if (!property_exists($state, 'enabled') && property_exists($current, 'enabled')) {
        $state->enabled = $current->enabled;
    }
    // A legacy tab can still mark arrivals but cannot deliberately clear an order.
    if ($keepOrders && !property_exists($state, 'orderedDexIds') && !empty($current->orderedDexIds)) {
        $state->orderedDexIds = array_values(array_diff($current->orderedDexIds, $state->ownedDexIds));
    }
    return accounts_encode($state);
}

function accounts_write(PDO $db, string $user, stdClass $body, string $webroot): array
{
    if (!accounts_fields($body, ['app', 'document', 'schemaVersion', 'state', 'baseRevision', 'clientId', 'mutationSequence', 'operationId'], ['preservePrevious'])
        || (property_exists($body, 'preservePrevious') && $body->preservePrevious !== true)) {
        accounts_fail(422, 'invalid_request', 'The sync request is invalid.');
    }

    [$app,$document] = accounts_document_pair($body->app, $body->document);
    $json = accounts_validate($app, $document, $body->schemaVersion, $body->state, $webroot);
    $base = accounts_number($body->baseRevision);
    $sequence = accounts_number($body->mutationSequence);
    if ($sequence < 1) {
        accounts_fail(422, 'invalid_sequence', 'The mutation sequence is invalid.');
    }
    $client = accounts_id($body->clientId);
    $operation = accounts_id($body->operationId);
    $hash = accounts_hash($body);
    $preservePrevious = $body->preservePrevious ?? false;
    return accounts_transaction($db, function () use ($db, $user, $app, $document, $json, $base, $sequence, $client, $operation, $hash, $preservePrevious) {
        accounts_lock_user($db, $user);
        $row = accounts_document($db, $user, $app, $document, true);
        if (accounts_operation($db, $user, $operation, 'write', $hash) !== null) {
            return ['document' => accounts_remote($db, $row, $client)];
        }

        $ack = $row === null ? 0 : (accounts_remote($db, $row, $client)['acknowledgedSequence']);
        if ($sequence <= $ack) {
            return ['document' => accounts_remote($db, $row, $client)];
        }

        if ($sequence !== $ack + 1) {
            accounts_fail(409, 'sequence_gap', 'This device needs to recover its sync session.', ['remote' => accounts_remote($db, $row, $client)]);
        }

        accounts_precondition($db, $row, $base, $client);
        $json = accounts_keep_legacy_binder_fields($app, $document, $json, $row, !$preservePrevious);
        if ($row === null || $row['state_json'] !== $json) {
            if ($row !== null) {
                if ($preservePrevious) {
                    accounts_snapshot($db, $user, $app, $document, 'Before replacement', (int)$row['schema_version'], (int)$row['revision'], $row['state_json']);
                } else {
                    accounts_daily_checkpoint($db, $row);
                }
            }
            $row = accounts_save_document($db, $user, $app, $document, 1, $json, $row);
        }

        accounts_query($db, 'INSERT INTO accounts_document_clients(resource_id,client_id,acknowledged_sequence) VALUES(?,?,?) ON DUPLICATE KEY UPDATE acknowledged_sequence=VALUES(acknowledged_sequence)', [$row['id'], $client, $sequence]);
        $result = ['document' => accounts_remote($db, $row, $client)];
        // A replay reads the current document. The operation only needs its identity and payload hash.
        accounts_record_operation($db, $user, $operation, 'write', $hash, []);
        return $result;
    });
}

function accounts_migration_stage(PDO $db, string $user, stdClass $body, string $webroot): array
{
    if (!accounts_fields($body, ['migrationId', 'app', 'document', 'variant', 'schemaVersion', 'state', 'baseRevision']) || !in_array($body->variant, ['selected', 'device'], true)) {
        accounts_fail(422, 'invalid_request', 'The migration stage is invalid.');
    }

    $migration = accounts_id($body->migrationId);
    [$app,$document] = accounts_document_pair($body->app, $body->document);
    if ($app === 'pokedex-binder' && $document === 'preferences') {
        accounts_fail(422, 'invalid_request', 'Retailer preferences are saved independently of collection migration.');
    }
    $json = accounts_validate($app, $document, $body->schemaVersion, $body->state, $webroot);
    $revision = accounts_number($body->baseRevision);
    $hash = accounts_hash($body);
    return accounts_transaction($db, function () use ($db, $user, $migration, $app, $document, $json, $revision, $hash, $body) {
        accounts_lock_user($db, $user);
        $old = accounts_query($db, 'SELECT payload_hash FROM accounts_migration_stages WHERE user_id=? AND migration_id=? AND app=? AND document=? AND variant=?', [$user, $migration, $app, $document, $body->variant])->fetchColumn();
        if ($old !== false) {
            if (!hash_equals($old, $hash)) {
                accounts_fail(409, 'migration_stage_reused', 'The migration preview changed. Review it again before continuing.');
            }
            return ['staged' => true];
        }

        if (accounts_query($db, 'SELECT operation_id FROM accounts_operations WHERE user_id=? AND operation_id=?', [$user, $migration])->fetchColumn() !== false) {
            accounts_fail(409, 'migration_completed', 'This migration was already completed.');
        }

        // Stages are durable recovery material, never silently expired.
        accounts_query($db, 'INSERT INTO accounts_migration_stages(user_id,migration_id,app,document,variant,schema_version,base_revision,state_json,payload_hash) VALUES(?,?,?,?,?,1,?,?,?)', [$user, $migration, $app, $document, $body->variant, $revision, $json, $hash]);
        return ['staged' => true];
    });
}

function accounts_migration_commit(PDO $db, string $user, stdClass $body, string $webroot, ?string $legacyKey): array
{
    if (!accounts_fields($body, ['migrationId', 'app', 'clientId', 'documents'], ['legacy', 'purpose']) || !is_string($body->app) || !is_array($body->documents)) {
        accounts_fail(422, 'invalid_request', 'The migration request is invalid.');
    }

    $app = $body->app;
    $expected = $app === 'pokedex-binder' ? ['binder', 'master-sets'] : array_keys(ACCOUNTS_DOCUMENT_LIMITS[$app] ?? []);
    sort($expected, SORT_STRING);
    if ($expected === []) {
        accounts_fail(422, 'unknown_document', 'This application is not registered.');
    }

    $migration = accounts_id($body->migrationId);
    $client = accounts_id($body->clientId);
    $conflict = property_exists($body, 'purpose');
    if ($conflict && $body->purpose !== 'conflict') {
        accounts_fail(422, 'invalid_request', 'The migration purpose is invalid.');
    }
    $manifest = [];
    foreach ($body->documents as $entry) {
        if (!accounts_fields($entry, ['document', 'baseRevision']) || !is_string($entry->document) || isset($manifest[$entry->document])) {
            accounts_fail(422, 'invalid_request', 'The document manifest is invalid.');
        }
        accounts_registry($app, $entry->document);
        $manifest[$entry->document] = accounts_number($entry->baseRevision);
    }

    ksort($manifest);
    // Earlier Binder clients only know the National Dex document. Their writes leave set collections intact.
    $dexOnly = $app === 'pokedex-binder' && array_keys($manifest) === ['binder'];
    if ($manifest === [] || (!$conflict && !$dexOnly && array_keys($manifest) !== $expected)) {
        accounts_fail(422, 'invalid_request', 'Review every application document before first adoption.');
    }

    if (property_exists($body, 'legacy') || $legacyKey !== null) {
        accounts_fail(410, 'key_sync_retired', 'Private-key sync has retired. Review the saved device copy.');
    }

    // Preserve operation identity for replay of existing device-only migrations.
    $hash = hash('sha256', accounts_encode($body).'|', true);
    return accounts_transaction($db, function () use ($db, $user, $app, $migration, $client, $manifest, $conflict, $hash) {
        accounts_lock_user($db, $user);
        $previous = accounts_operation($db, $user, $migration, 'migration', $hash);
        if ($previous !== null) {
            $documents = [];
            foreach (array_keys($manifest) as $name) {
                $documents[] = accounts_remote($db, accounts_document($db, $user, $app, $name, true), $client);
            }
            return ['documents' => $documents];
        }

        if ($conflict) {
            foreach (array_keys($manifest) as $name) {
                if (accounts_document($db, $user, $app, $name, true) === null) {
                    accounts_fail(422, 'conflict_document_missing', 'An account document must exist before resolving its conflict.');
                }
            }
        }

        $stages = accounts_query($db, 'SELECT * FROM accounts_migration_stages WHERE user_id=? AND migration_id=? ORDER BY app,document,variant', [$user, $migration])->fetchAll();
        $selected = [];
        $device = [];
        foreach ($stages as $stage) {
            if ($stage['app'] !== $app || !array_key_exists($stage['document'], $manifest) || (int)$stage['base_revision'] !== $manifest[$stage['document']]) {
                accounts_fail(409, 'migration_preview_changed', 'The migration preview no longer matches. Review it again.');
            }
            if ($stage['variant'] === 'selected') {
                $selected[$stage['document']] = $stage;
            } else {
                $device[$stage['document']] = $stage;
            }

        }

        ksort($selected);
        if (array_keys($selected) !== array_keys($manifest)) {
            accounts_fail(409, 'migration_incomplete', 'Upload and verify every selected document before finishing migration.');
        }
        ksort($device);
        if (array_keys($device) !== array_keys($manifest)) {
            accounts_fail(409, 'migration_incomplete', 'Preserve each device copy before finishing migration.');
        }

        $documents = [];
        foreach ($manifest as $name => $base) {
            $row = accounts_document($db, $user, $app, $name, true);
            accounts_precondition($db, $row, $base, $client);
            if ($row !== null) {
                accounts_snapshot($db, $user, $app, $name, 'Before migration', 1, (int)$row['revision'], $row['state_json']);
            }

            if (isset($device[$name])) {
                accounts_snapshot($db, $user, $app, $name, 'Device before migration', 1, 0, $device[$name]['state_json']);
            }

            $json = accounts_keep_legacy_binder_fields($app, $name, $selected[$name]['state_json'], $row);
            accounts_snapshot($db, $user, $app, $name, 'Migration selection', 1, 0, $json);
            $row = accounts_save_document($db, $user, $app, $name, 1, $json, $row);
            $documents[] = accounts_remote($db, $row, $client);
        }

        $result = ['documents' => $documents];
        accounts_record_operation($db, $user, $migration, 'migration', $hash, $result);
        return $result;
    });
}

function accounts_recovery_metadata(array $row): array
{
    return ['id' => $row['id'], 'app' => $row['app'], 'document' => $row['document'], 'label' => $row['label'], 'schemaVersion' => (int)$row['schema_version'], 'revision' => (int)$row['revision'], 'createdAt' => gmdate('Y-m-d\TH:i:s\Z', strtotime($row['created_at'].' UTC'))];
}

function accounts_recovery_get(PDO $db, string $user, string $id, bool $lock = false): array
{
    $row = accounts_query($db, 'SELECT * FROM accounts_recovery WHERE id=? AND user_id=?'.($lock ? ' FOR UPDATE' : ''), [$id, $user])->fetch();
    if (!is_array($row)) {
        accounts_fail(404, 'snapshot_not_found', 'This recovery copy was not found.');
    }
    return $row;
}

function accounts_recovery_restore(PDO $db, string $user, stdClass $body, string $webroot): array
{
    if (!accounts_fields($body, ['id', 'baseRevision', 'clientId', 'operationId'])) {
        accounts_fail(422, 'invalid_request', 'The restore request is invalid.');
    }

    $id = accounts_id($body->id);
    $client = accounts_id($body->clientId);
    $operation = accounts_id($body->operationId);
    $revision = accounts_number($body->baseRevision);
    $hash = accounts_hash($body);
    return accounts_transaction($db, function () use ($db, $user, $id, $client, $operation, $revision, $hash, $webroot) {
        accounts_lock_user($db, $user);
        $previous = accounts_operation($db, $user, $operation, 'restore', $hash);
        if ($previous !== null) {
            $old = $previous['document'];
            return ['document' => accounts_remote($db, accounts_document($db, $user, $old['app'], $old['document'], true), $client)];
        }

        $snapshot = accounts_recovery_get($db, $user, $id, true);
        $app = $snapshot['app'];
        $name = $snapshot['document'];
        $state = json_decode($snapshot['state_json'], false, 64, JSON_THROW_ON_ERROR);
        $json = accounts_validate($app, $name, (int)$snapshot['schema_version'], $state, $webroot);
        $row = accounts_document($db, $user, $app, $name, true);
        accounts_precondition($db, $row, $revision, $client);
        if ($row !== null) {
            accounts_snapshot($db, $user, $app, $name, 'Before restore', 1, (int)$row['revision'], $row['state_json']);
        }

        accounts_snapshot($db, $user, $app, $name, 'Restored copy', 1, (int)$snapshot['revision'], $json);
        $row = accounts_save_document($db, $user, $app, $name, 1, $json, $row);
        $result = ['document' => accounts_remote($db,$row,$client)];
        accounts_record_operation($db,$user,$operation,'restore',$hash,$result);
        return $result;
    });
}
