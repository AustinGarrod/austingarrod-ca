<?php

declare(strict_types=1);

require_once __DIR__.'/_mcp-tools.php';

function mcp_change_fields(stdClass $input, array $required, array $optional = []): void
{
    if (!accounts_fields($input, $required, $optional)) {
        accounts_fail(422, 'invalid_change', 'Supply the fields for the selected operation.');
    }
}

function mcp_visible_item(array $visible, mixed $system, mixed $id): stdClass
{
    if (!is_string($system) || !accounts_safe_id($id) || !isset($visible[$system][$id])) {
        accounts_fail(404, 'unknown_entry', 'Use a visible catalog ID returned by this utility.');
    }
    return $visible[$system][$id];
}

function mcp_binder_change(string $root, stdClass $state, stdClass $input): array
{
    mcp_change_fields($input, ['dexIds', 'owned']);
    if (!is_bool($input->owned) || !is_array($input->dexIds) || count($input->dexIds) < 1 || count($input->dexIds) > 50) {
        accounts_fail(422, 'invalid_ownership', 'Supply up to 50 National Dex IDs and the desired ownership.');
    }
    $species = array_column(mcp_binder_catalog($root)->species, null, 'id');
    $owned = array_fill_keys($state->ownedDexIds, true);
    $changes = [];
    foreach ($input->dexIds as $id) {
        if (!is_int($id) || !isset($species[$id])) {
            accounts_fail(422, 'unknown_species', 'Use a National Dex ID returned by the catalog.');
        }
        if ($input->owned !== isset($owned[$id])) {
            $changes[] = ['dexId' => $id, 'name' => $species[$id]->name, 'owned' => $input->owned];
            if ($input->owned) {
                $owned[$id] = true;
            } else {
                unset($owned[$id]);
            }
        }
    }
    $state->ownedDexIds = array_keys($owned);
    sort($state->ownedDexIds, SORT_NUMERIC);
    return ['ownershipChanges' => $changes];
}

function mcp_observe(stdClass $map, stdClass $progress, array $visible, stdClass $input, string $observedAt): void
{
    mcp_change_fields($input, ['system', 'id', 'patch']);
    $item = mcp_visible_item($visible, $input->system, $input->id);
    $allowed = match ($input->system) {
        'achievement' => ($item->counterSupported ?? false) ? ['completed', 'count'] : ['completed'],
        'craft' => ($item->permanent ?? true) ? ['completed'] : [],
        'material', 'enemy' => ['discovered', 'count'],
        'quest' => $item->category === 'Quest packs' ? ['completed'] : ['count', 'completed', 'claimed'],
        'village' => array_merge([$item->category === 'Village buildings' ? 'built' : 'completed'], isset($item->target) ? ['count'] : []),
        'divinity' => ['selected'],
        default => [],
    };
    $patch = $input->patch;
    if (!accounts_fields($patch, [], $allowed) || (array)$patch === []) {
        accounts_fail(422, 'unsupported_observation', 'This catalog entry does not support those observations.');
    }
    foreach ($patch as $field => $value) {
        if ($field === 'count' ? (!is_string($value) || !preg_match('/^(0|[1-9]\d{0,1023})$/D', $value)) : !is_bool($value)) {
            accounts_fail(422, 'invalid_observation', 'Use boolean observations and decimal strings for counts.');
        }
    }
    $system = $input->system;
    $id = $item->id;
    if ($system === 'quest') {
        if (($patch->claimed ?? null) === true && ($patch->completed ?? null) === false) {
            accounts_fail(422, 'invalid_observation', 'A claimed reward requires a completed objective.');
        }
        if (($patch->claimed ?? null) === true) {
            $patch->completed = true;
        }
        if (($patch->completed ?? null) === false && in_array('claimed', $allowed, true)) {
            $patch->claimed = false;
        }
    }
    if (in_array($system, ['craft', 'village'], true) && isset($patch->completed)) {
        if ($patch->completed) {
            $progress->ascension->milestones->{$id} = true;
        } elseif (isset($progress->ascension->milestones->{$id})) {
            if (array_any($map->milestones, fn($milestone) => $milestone->id === $id)) {
                slayer_remove($map, $progress->ascension, $id, true);
            } else {
                unset($progress->ascension->milestones->{$id});
            }
        }
        $patch->completed = false;
    }
    $module = $progress->modules->{$system};
    $module->records->{$id} = (object)array_replace((array)($module->records->{$id} ?? []), (array)$patch);
    $module->tracked = true;
    $module->source = 'manual';
    $module->observedAt = $observedAt;
}

function mcp_checkpoint_name(mixed $value): string
{
    if (!is_string($value) || preg_match('/[\x00-\x1f\x7f]/', $value)) {
        accounts_fail(422, 'invalid_checkpoint_name', 'Use a checkpoint name from 1 to 64 characters.');
    }
    $normalized = Normalizer::normalize($value, Normalizer::FORM_C);
    $name = $normalized === false ? '' : trim(preg_replace('/[\x{0020}\x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]+/u', ' ', $normalized));
    if ($name === '' || strlen(mb_convert_encoding($name, 'UTF-16LE', 'UTF-8')) > 128) {
        accounts_fail(422, 'invalid_checkpoint_name', 'Use a checkpoint name from 1 to 64 characters.');
    }
    return $name;
}

function mcp_slayer_change(
    string $root, string $operation, stdClass $input, stdClass $state, stdClass $progress, stdClass $map, stdClass $catalog,
    array $visible, string $previewId, string $observedAt
): array {
    if ($operation === 'record_observation') {
        mcp_observe($map, $state, $visible, $input, $observedAt);
        $item = $visible[$input->system][$input->id];
        return ['entry' => $item->title, 'record' => slayer_record($state, $input->system, $input->id)];
    }
    if ($operation === 'ultra_ascension') {
        mcp_change_fields($input, []);
        mcp_check_portable_size($state);
        $rules = mcp_file($root, 'api/v1/_mcp-data/companion-reset-rules.json');
        return ['warnings' => slayer_reset($map, $catalog, $rules, $state)];
    }
    if (in_array($operation, ['record_purchase', 'remove_purchase', 'activate_astral', 'set_milestone'], true)) {
        mcp_change_fields($input, $operation === 'set_milestone' ? ['id', 'owned'] : ['id'], $operation === 'record_purchase' ? ['choices'] : []);
        $item = mcp_visible_item($visible, $operation === 'set_milestone' ? 'milestone' : 'ascension', $input->id);
        $profile = $state->ascension;
        $id = $item->id;
        if ($operation === 'record_purchase') {
            $choices = $input->choices ?? new stdClass();
            if (!$choices instanceof stdClass || count((array)$choices) > 50 || !array_all((array)$choices, fn($choice) => is_int($choice) && $choice >= 0)) {
                accounts_fail(422, 'invalid_choices', 'Use the choice keys and option indexes from the preview.');
            }
            slayer_purchase($map, $profile, $id, $choices, $visible);
        } elseif ($operation === 'remove_purchase') {
            if (isset($profile->purchases->{$id})) {
                slayer_remove($map, $profile, $id);
            }
        } elseif ($operation === 'activate_astral') {
            slayer_activate($item, $profile);
        } else {
            if (!is_bool($input->owned)) {
                accounts_fail(422, 'invalid_milestone', 'Supply the observed milestone ownership.');
            }
            if ($input->owned) {
                $profile->milestones->{$id} = true;
            } elseif (isset($profile->milestones->{$id})) {
                slayer_remove($map, $profile, $id, true);
            }
        }
        return ['entry' => $item->title];
    }
    if ($operation === 'set_goal') {
        mcp_change_fields($input, ['system', 'id', 'enabled'], ['mode']);
        $item = mcp_visible_item($visible, $input->system, $input->id);
        if (!is_bool($input->enabled) || $input->system === 'milestone') {
            accounts_fail(422, 'invalid_goal', 'Specify whether to pin or remove an eligible catalog goal.');
        }
        $modes = match ($input->system) {
            'ascension' => ['acquire', 'activate', 'rebuild'],
            'enemy' => ['mastery'],
            'divinity' => ['select'],
            default => ['complete'],
        };
        $mode = $input->mode ?? $modes[0];
        if (!in_array($mode, $modes, true)) {
            accounts_fail(422, 'invalid_goal_mode', 'Choose a goal mode for this entry.', ['modes' => $modes]);
        }
        $goal = (object)['ref' => (object)['system' => $input->system, 'id' => $item->id], 'mode' => $mode];
        foreach ($state->goals as $index => $existing) {
            if ($existing->ref->system === $input->system && $existing->ref->id === $item->id) {
                if ($input->enabled) {
                    $state->goals[$index] = $goal;
                } else {
                    array_splice($state->goals, $index, 1);
                }
                return ['entry' => $item->title, 'pinned' => $input->enabled, 'mode' => $input->enabled ? $mode : null];
            }
        }
        if ($input->enabled) {
            $state->goals[] = $goal;
        }
        return ['entry' => $item->title, 'pinned' => $input->enabled, 'mode' => $input->enabled ? $mode : null];
    }
    if ($operation === 'set_recipe_plan') {
        mcp_change_fields($input, ['id', 'quantity']);
        $item = mcp_visible_item($visible, 'craft', $input->id);
        if (empty($item->recipe) || !is_string($input->quantity) || !preg_match('/^(0|[1-9]\d{0,29})$/D', $input->quantity)) {
            accounts_fail(422, 'invalid_recipe_plan', 'Use a craftable recipe and a decimal quantity. Zero clears the plan.');
        }
        if ($input->quantity === '0') {
            unset($state->recipePlans->{$item->id});
        } else {
            $state->recipePlans->{$item->id} = $input->quantity;
        }
        return ['entry' => $item->title, 'quantity' => $input->quantity];
    }
    if ($operation === 'set_comparison') {
        mcp_change_fields($input, ['ids']);
        if (!is_array($input->ids) || count($input->ids) > 4 || !array_all($input->ids, fn($id) => is_string($id)) || count(array_unique($input->ids)) !== count($input->ids)) {
            accounts_fail(422, 'invalid_comparison', 'Choose up to four distinct visible upgrades.');
        }
        $items = array_map(fn($id) => mcp_visible_item($visible, 'ascension', $id)->title, $input->ids);
        $known = array_column($map->upgrades, null, 'id');
        $unknown = array_values(array_filter($state->ids, fn($id) => !isset($known[$id])));
        if (count($unknown) + count($items) > 4) {
            accounts_fail(422, 'comparison_full', 'There is insufficient capacity to retain existing references.');
        }
        $state->ids = array_merge($input->ids, $unknown);
        return ['upgrades' => $items];
    }

    mcp_change_fields($input, $operation === 'capture_checkpoint' ? ['name'] : ($operation === 'rename_checkpoint' ? ['id', 'name'] : ['id']));
    $name = $operation === 'delete_checkpoint' ? null : mcp_checkpoint_name($input->name);
    if ($operation === 'capture_checkpoint') {
        $state->entries[] = (object)['id' => $previewId, 'name' => $name, 'capturedRevision' => $map->revision, 'profile' => $progress->ascension];
        return ['id' => $previewId, 'name' => $name, 'ultraAscensions' => $progress->ascension->epoch];
    }
    foreach ($state->entries as $index => $entry) {
        if ($entry->id !== $input->id) {
            continue;
        }
        $before = $entry->name;
        if ($operation === 'delete_checkpoint') {
            array_splice($state->entries, $index, 1);
        } else {
            $entry->name = $name;
        }
        return ['id' => $entry->id, 'previousName' => $before, 'name' => $name];
    }
    accounts_fail(404, 'checkpoint_not_found', 'Use an ID returned by list_checkpoints.');
}

function mcp_operation_document(string $app, string $operation): string
{
    if ($app === 'pokedex-binder' && $operation === 'set_ownership') {
        return 'binder';
    }
    if ($app === 'idle-slayer-companion') {
        return match ($operation) {
            'record_observation', 'record_purchase', 'remove_purchase', 'activate_astral', 'set_milestone', 'ultra_ascension' => 'progress',
            'set_goal', 'set_recipe_plan' => 'intentions',
            'capture_checkpoint', 'rename_checkpoint', 'delete_checkpoint' => 'checkpoints',
            'set_comparison' => 'comparison',
            default => accounts_fail(422, 'unknown_change', 'Choose a change supported by this utility.'),
        };
    }
    accounts_fail(422, 'unknown_change', 'Choose a change supported by this utility.');
}

function mcp_progress_diff(stdClass $before, stdClass $after, array $visible, array $afterVisible): array
{
    $upgrades = ($visible['ascension'] ?? []) + ($afterVisible['ascension'] ?? []);
    $purchaseChanges = [];
    $beforePurchases = (array)$before->ascension->purchases;
    $afterPurchases = (array)$after->ascension->purchases;
    foreach ($beforePurchases + $afterPurchases as $id => $_) {
        $a = $beforePurchases[$id] ?? null;
        $b = $afterPurchases[$id] ?? null;
        if ($a != $b) {
            $purchaseChanges[] = ['title' => $upgrades[$id]->title ?? null,
                'change' => $b === null ? 'removed' : ($a === null ? 'added' : ($a->active !== $b->active ? 'activation changed' : 'purchase epoch changed'))];
        }
    }
    $records = [];
    foreach (ACCOUNTS_SYSTEMS as $system) {
        $a = (array)$before->modules->{$system}->records;
        $b = (array)$after->modules->{$system}->records;
        $count = count(array_filter(array_keys($a + $b), fn($id) => ($a[$id] ?? null) != ($b[$id] ?? null)));
        if ($count > 0) {
            $records[$system] = $count;
        }
    }
    $milestones = array_keys(array_diff_key((array)$before->ascension->milestones, (array)$after->ascension->milestones)
        + array_diff_key((array)$after->ascension->milestones, (array)$before->ascension->milestones));
    return [
        'previousUltraAscensions' => $before->ascension->epoch, 'ultraAscensions' => $after->ascension->epoch,
        'changedPurchaseCount' => count($purchaseChanges), 'purchaseChanges' => array_slice($purchaseChanges, 0, 25),
        'changedMilestoneCount' => count($milestones), 'changedModuleRecords' => (object)$records,
    ];
}

/** Match the Companion's UTF-8 portable JSON limit at two spaces per nesting level. */
function mcp_check_portable_size(stdClass $state): void
{
    $pretty = json_encode($state, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
        | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS);
    if (strlen($pretty) <= 4 * 1024 * 1024) {
        return;
    }
    preg_match_all('/^ +/m', $pretty, $matches);
    $indentBytes = array_sum(array_map('strlen', $matches[0]));
    if (strlen($pretty) - intdiv($indentBytes, 2) > 4 * 1024 * 1024) {
        accounts_fail(413, 'portable_save_too_large', 'The resulting save exceeds the Companion’s 4 MiB portable limit.');
    }
}

function mcp_plan_change(PDO $db, array $grant, string $root, string $operation, stdClass $input, string $id, int $now): array
{
    $app = $grant['app'];
    $user = $grant['user_id'];
    $snapshot = null;
    if ($operation === 'restore_recovery') {
        mcp_change_fields($input, ['id']);
        $snapshot = accounts_recovery_get($db, $user, accounts_id($input->id), true);
        if ($snapshot['app'] !== $app) {
            accounts_fail(404, 'snapshot_not_found', 'This recovery copy was not found.');
        }
        $document = $snapshot['document'];
    } else {
        $document = mcp_operation_document($app, $operation);
    }
    $row = accounts_document($db, $user, $app, $document, true);
    $primary = $app === 'pokedex-binder' ? 'binder' : 'progress';
    $primaryRow = $primary === $document ? $row : accounts_document($db, $user, $app, $primary, true);
    if ($primaryRow === null || $row === null) {
        mcp_missing_save();
    }
    $revisions = [$document => (int)$row['revision']];
    if ($document !== $primary) {
        $revisions[$primary] = (int)$primaryRow['revision'];
    }
    $state = mcp_state($row);
    if ($snapshot !== null) {
        $state = mcp_state($snapshot);
        $summary = ['recoveryCopy' => accounts_recovery_metadata($snapshot), 'replacesRevision' => (int)$row['revision']];
    } elseif ($app === 'pokedex-binder') {
        $summary = mcp_binder_change($root, $state, $input);
    } else {
        [$map, $catalog] = mcp_slayer_catalogs($root);
        $progress = mcp_slayer_progress($primaryRow, $map->revision);
        $visible = slayer_visible($map, $catalog, $progress);
        if ($document === 'progress') {
            $state = mcp_slayer_progress($row, $map->revision);
            $state->catalogRevision = $map->revision;
            $state->ascension->catalogRevision = $map->revision;
        }
        $summary = mcp_slayer_change($root, $operation, $input, $state, $progress, $map, $catalog, $visible, $id, gmdate('Y-m-d\TH:i:s\Z', $now));
        if ($document === 'progress') {
            $summary += mcp_progress_diff($progress, $state, $visible, slayer_visible($map, $catalog, $state));
        }
    }
    $json = accounts_validate($app, $document, 1, $state, $root);
    if ($app === 'idle-slayer-companion' && in_array($document, ['progress', 'checkpoints'], true)) {
        mcp_check_portable_size($state);
    }
    $changed = $json !== accounts_encode(mcp_state($row));
    $summary['hasChanges'] = $changed;
    return compact('row', 'document', 'snapshot', 'revisions', 'json', 'summary', 'changed');
}

function mcp_preview_catalog(string $root, string $app): string
{
    $files = $app === 'pokedex-binder' ? ['utilities/pokedex-binder/catalog/index.json'] : [
        'utilities/idle-slayer-companion/catalog.json', 'utilities/idle-slayer-companion/companion-catalog.json',
        'api/v1/_mcp-data/companion-reset-rules.json',
    ];
    return hash('sha256', implode('', array_map(fn($file) => hash_file('sha256', $root.'/'.$file), $files)));
}

function mcp_lock_write_grant(PDO $db, array $config, array $grant): void
{
    accounts_lock_user($db, $grant['user_id']);
    $live = mcp_grant($db, $grant['id'], true);
    if (!mcp_live($config, $live) || $grant['accessExpiresAt'] <= time() || !$live['can_write']) {
        accounts_fail(401, 'connection_expired', 'This assistant connection is no longer authorized to edit saves.');
    }
}

function mcp_preview_change(PDO $db, array $config, array $grant, string $root, string $operation, stdClass $input): array
{
    return accounts_transaction($db, function () use ($db, $config, $grant, $root, $operation, $input) {
        mcp_lock_write_grant($db, $config, $grant);
        $id = accounts_uuid();
        $now = time();
        $expires = $now + 600;
        $catalog = mcp_preview_catalog($root, $grant['app']);
        $plan = mcp_plan_change($db, $grant, $root, $operation, $input, $id, $now);
        if ($catalog !== mcp_preview_catalog($root, $grant['app'])) {
            accounts_fail(409, 'stale_preview', 'The catalog changed. Create a fresh preview.');
        }
        $digest = hash('sha256', $plan['json']);
        $revisions = $plan['revisions'];
        $payload = accounts_encode(compact('operation', 'input', 'now', 'catalog', 'digest', 'revisions'));
        accounts_query($db, 'DELETE FROM accounts_mcp_previews WHERE grant_id=? AND expires_at<=? LIMIT 100', [$grant['id'], $now]);
        accounts_query($db, 'INSERT INTO accounts_mcp_previews(id,grant_id,payload_json,expires_at) VALUES(?,?,?,?)', [$id, $grant['id'], $payload, $expires]);
        return ['previewId' => $id, 'operation' => $operation, 'revisions' => $revisions,
            'expiresAt' => gmdate(DATE_ATOM, $expires), 'effects' => $plan['summary']];
    });
}

function mcp_apply_change(PDO $db, array $config, array $grant, string $root, string $id): array
{
    $id = accounts_id($id);
    return accounts_transaction($db, function () use ($db, $config, $grant, $root, $id) {
        mcp_lock_write_grant($db, $config, $grant);
        $preview = accounts_query($db, 'SELECT * FROM accounts_mcp_previews WHERE id=? AND grant_id=? FOR UPDATE', [$id, $grant['id']])->fetch();
        if (!$preview || (int)$preview['expires_at'] <= time()) {
            accounts_fail(409, 'preview_expired', 'Create a fresh preview before applying this change.');
        }
        if ($preview['receipt_json'] !== null) {
            return json_decode($preview['receipt_json'], true, 16, JSON_THROW_ON_ERROR);
        }
        $saved = json_decode($preview['payload_json'], false, 32, JSON_THROW_ON_ERROR);
        $app = $grant['app'];
        $user = $grant['user_id'];
        foreach ($saved->revisions as $document => $revision) {
            if ((int)(accounts_document($db, $user, $app, $document, true)['revision'] ?? 0) !== $revision) {
                accounts_fail(409, 'stale_preview', 'A synced save changed. Create a fresh preview and review the new effects.');
            }
        }
        if ($saved->catalog !== mcp_preview_catalog($root, $app)) {
            accounts_fail(409, 'stale_preview', 'The catalog changed. Create a fresh preview and review the new effects.');
        }
        $plan = mcp_plan_change($db, $grant, $root, $saved->operation, $saved->input, $id, $saved->now);
        if (!hash_equals($saved->digest, hash('sha256', $plan['json']))) {
            accounts_fail(409, 'stale_preview', 'The effects changed. Create a fresh preview before applying.');
        }
        $row = $plan['row'];
        $name = $plan['document'];
        $copy = null;
        if ($plan['changed']) {
            $copy = accounts_snapshot($db, $user, $app, $name, 'Before assistant change', (int)$row['schema_version'], (int)$row['revision'], $row['state_json']);
            $row = accounts_save_document($db, $user, $app, $name, 1, $plan['json'], $row);
        }
        $receipt = ['previewId' => $id, 'operation' => $saved->operation, 'document' => $name, 'revision' => (int)$row['revision'],
            'changed' => $plan['changed'], 'recoveryCopyId' => $copy];
        accounts_query($db, 'UPDATE accounts_mcp_previews SET receipt_json=?,payload_json=?,expires_at=? WHERE id=?',
            [accounts_encode($receipt), '{}', time() + 86400, $id]);
        return $receipt;
    });
}
