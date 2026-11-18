<?php

declare(strict_types=1);

require_once __DIR__.'/_mcp-auth.php';
require_once __DIR__.'/_mcp-slayer-reset.php';

function mcp_file(string $root, string $path): mixed
{
    $json = file_get_contents($root.'/'.$path);
    if ($json === false) {
        throw new RuntimeException('Catalog unavailable.');
    }
    return json_decode($json, false, 64, JSON_THROW_ON_ERROR);
}

function mcp_state(?array $row): ?stdClass
{
    return $row === null ? null : json_decode($row['state_json'], false, 64, JSON_THROW_ON_ERROR);
}

function mcp_page(array $items, int $offset, int $limit): array
{
    $next = $offset + $limit;
    return [
        'items' => array_values(array_slice($items, $offset, $limit)),
        'total' => count($items),
        'nextOffset' => $next < count($items) ? $next : null,
    ];
}

function mcp_text_match(string $query, string ...$values): bool
{
    return $query === '' || array_any($values, fn($value) => mb_stripos($value, $query, 0, 'UTF-8') !== false);
}

function mcp_missing_save(): never
{
    accounts_fail(409, 'save_not_synced', 'Open this utility and adopt account sync to make your save available.');
}

function mcp_binder_catalog(string $root): stdClass
{
    return mcp_file($root, 'utilities/pokedex-binder/catalog/index.json');
}

function mcp_binder_read(string $tool, string $root, ?array $row, array $args): array
{
    $catalog = mcp_binder_catalog($root);
    $species = array_column($catalog->species, null, 'id');
    $offset = $args['offset'] ?? 0;
    $limit = $args['limit'] ?? 20;
    $query = trim($args['query'] ?? '');
    $set = $args['setId'] ?? null;
    if ($set !== null && !isset($catalog->sets->{$set})) {
        accounts_fail(404, 'set_not_found', 'Use a set ID returned by search_catalog.');
    }
    if ($tool === 'search_catalog' && ($args['kind'] ?? 'species') === 'sets') {
        $matches = array_filter((array)$catalog->sets, fn($item) => mcp_text_match($query, $item->id, $item->name, $item->code ?? ''));
        return mcp_page($matches, $offset, $limit);
    }
    if ($tool === 'list_printings') {
        $id = $args['dexId'];
        if (!isset($species[$id])) {
            accounts_fail(404, 'species_not_found', 'Use a National Dex ID returned by search_catalog.');
        }
        $items = mcp_file($root, 'utilities/pokedex-binder/catalog/printings/'.$id.'.json');
        if ($set !== null) {
            $items = array_filter($items, fn($item) => $item->setId === $set);
        }
        return ['species' => $species[$id]] + mcp_page($items, $offset, $limit);
    }
    $state = $tool === 'get_collection' ? mcp_state($row) : null;
    if ($tool === 'get_collection' && $state === null) {
        mcp_missing_save();
    }
    $owned = array_fill_keys($state->ownedDexIds ?? [], true);
    $status = $args['status'] ?? 'all';
    $eligible = $set === null ? null : array_fill_keys($catalog->setSpecies->{$set} ?? [], true);
    $matches = [];
    $ownedCount = 0;
    $matchingSpeciesCount = 0;
    foreach ($species as $id => $item) {
        if (($eligible !== null && !isset($eligible[$id])) || !mcp_text_match($query, $item->name, (string)$id)) {
            continue;
        }
        if ($state === null) {
            $matches[] = $item;
            continue;
        }
        ++$matchingSpeciesCount;
        $present = isset($owned[$id]);
        $ownedCount += (int)$present;
        if ($status === 'all' || ($status === 'owned') === $present) {
            $matches[] = (array)$item + ['owned' => $present];
        }
    }
    return ($state === null ? [] : [
        'revision' => (int)$row['revision'], 'ownedCount' => $ownedCount,
        'missingCount' => $matchingSpeciesCount - $ownedCount,
        'scope' => $set ?? 'national-dex',
    ]) + mcp_page($matches, $offset, $limit);
}

function mcp_slayer_catalogs(string $root): array
{
    return [
        mcp_file($root, 'utilities/idle-slayer-companion/catalog.json'),
        mcp_file($root, 'utilities/idle-slayer-companion/companion-catalog.json'),
    ];
}

function mcp_slayer_progress(?array $row, string $revision): stdClass
{
    $progress = mcp_state($row);
    if ($progress !== null) {
        slayer_normalize_shared($progress);
        return $progress;
    }
    return (object)[
        'format' => 'idle-slayer-companion-progress', 'version' => 1, 'catalogRevision' => $revision,
        'ascension' => (object)['version' => 1, 'catalogRevision' => $revision, 'epoch' => 0,
            'purchases' => new stdClass(), 'milestones' => new stdClass(), 'showSpoilers' => false],
        'modules' => (object)array_combine(ACCOUNTS_SYSTEMS, array_map(fn() => (object)['tracked' => false, 'records' => new stdClass()], ACCOUNTS_SYSTEMS)),
    ];
}

function mcp_slayer_item(string $system, stdClass $item, stdClass $progress, array $visible, bool $withProgress): array
{
    $result = ['id' => $item->id, 'title' => $item->title, 'system' => $system, 'description' => $item->description];
    foreach (['category', 'cost', 'costUnit', 'target', 'retention', 'activation', 'tiers'] as $field) {
        if (isset($item->{$field})) {
            $result[$field] = $item->{$field};
        }
    }
    if ($system === 'ascension') {
        $result['requires'] = slayer_describe_gate($item->purchase, $visible);
    }
    if ($withProgress) {
        $result['record'] = match ($system) {
            'ascension' => $progress->ascension->purchases->{$item->id} ?? null,
            'milestone' => ['owned' => isset($progress->ascension->milestones->{$item->id})],
            default => slayer_record($progress, $system, $item->id),
        };
    }
    return $result;
}

function mcp_slayer_read(PDO $db, string $user, string $root, string $tool, array $args): array
{
    [$map, $catalog] = mcp_slayer_catalogs($root);
    $app = 'idle-slayer-companion';
    $row = accounts_document($db, $user, $app, 'progress');
    if ($row === null && $tool !== 'search_catalog') {
        mcp_missing_save();
    }
    $progress = mcp_slayer_progress($row, $map->revision);
    $visible = slayer_visible($map, $catalog, $progress);
    $profile = $progress->ascension;
    if ($tool === 'get_checkpoint') {
        $saved = accounts_document($db, $user, $app, 'checkpoints');
        $id = $args['id'];
        foreach (mcp_state($saved)->entries ?? [] as $entry) {
            if ($entry->id !== $id) {
                continue;
            }
            $items = [];
            foreach ($visible['ascension'] ?? [] as $upgrade) {
                $before = $entry->profile->purchases->{$upgrade->id} ?? null;
                $current = $profile->purchases->{$upgrade->id} ?? null;
                if ($before != $current) {
                    $items[] = ['id' => $upgrade->id, 'title' => $upgrade->title, 'checkpoint' => $before, 'current' => $current];
                }
            }
            return ['checkpoint' => ['id' => $id, 'name' => $entry->name, 'catalogRevision' => $entry->capturedRevision,
                'ultraAscensions' => $entry->profile->epoch], 'currentUltraAscensions' => $profile->epoch,
                'currentProgressRevision' => (int)$row['revision']] + mcp_page($items, $args['offset'] ?? 0, $args['limit'] ?? 20);
        }
        accounts_fail(404, 'checkpoint_not_found', 'Use an ID returned by list_checkpoints.');
    }
    if ($tool === 'recommend_upgrades') {
        $priorities = mcp_file($root, 'api/v1/_mcp-data/wiki-priorities.json');
        return ['revision' => (int)$row['revision']] + slayer_recommend($map, $profile, $priorities, $visible['ascension'] ?? [], $args['limit'] ?? 5);
    }
    if (in_array($tool, ['get_workspace', 'list_checkpoints', 'get_saved_comparison'], true)) {
        $document = match ($tool) {
            'get_workspace' => 'intentions',
            'list_checkpoints' => 'checkpoints',
            default => 'comparison',
        };
        $saved = accounts_document($db, $user, $app, $document);
        $state = mcp_state($saved);
        $revision = $saved === null ? null : (int)$saved['revision'];
        if ($tool === 'get_workspace') {
            $goals = [];
            foreach ($state->goals ?? [] as $goal) {
                $item = $visible[$goal->ref->system][$goal->ref->id] ?? null;
                if ($item !== null) {
                    $goals[] = (array)$goal + ['title' => $item->title];
                }
            }
            $plans = array_intersect_key((array)($state->recipePlans ?? []), $visible['craft'] ?? []);
            return ['revision' => $revision, 'goals' => $goals, 'recipePlans' => (object)$plans];
        }
        if ($tool === 'list_checkpoints') {
            $items = array_map(fn($entry) => [
                'id' => $entry->id, 'name' => $entry->name,
                'catalogRevision' => $entry->capturedRevision, 'ultraAscensions' => $entry->profile->epoch,
            ], $state->entries ?? []);
            return ['revision' => $revision, 'checkpoints' => $items];
        }
        $items = [];
        foreach ($state->ids ?? [] as $id) {
            if (isset($visible['ascension'][$id])) {
                $items[] = mcp_slayer_item('ascension', $visible['ascension'][$id], $progress, $visible, true);
            }
        }
        return ['revision' => $revision, 'upgrades' => $items];
    }
    $systemFilter = $args['system'] ?? 'all';
    $term = trim($args['query'] ?? '');
    $items = [];
    foreach ($visible as $system => $entries) {
        if ($systemFilter !== 'all' && $systemFilter !== $system) {
            continue;
        }
        foreach ($entries as $item) {
            if (mcp_text_match($term, $item->title, $item->id, $item->description)) {
                $items[] = [$system, $item];
            }
        }
    }
    $page = mcp_page($items, $args['offset'] ?? 0, $args['limit'] ?? 20);
    $page['items'] = array_map(fn($entry) => mcp_slayer_item($entry[0], $entry[1], $progress, $visible, $tool === 'get_progress'), $page['items']);
    if ($tool === 'get_progress') {
        $page += [
            'revision' => (int)$row['revision'],
            'ultraAscensions' => $profile->epoch,
            'modules' => array_map(fn($module) => ['tracked' => $module->tracked, 'observedAt' => $module->observedAt ?? null], (array)$progress->modules),
            'visibleUpgrades' => count($visible['ascension'] ?? []),
            'ownedVisibleUpgrades' => count(array_intersect_key((array)$profile->purchases, $visible['ascension'] ?? [])),
        ];
    }
    return ['gameVersion' => $map->gameVersion, 'catalogRevision' => $map->revision] + $page;
}

function mcp_recovery_list(PDO $db, string $user, string $app, int $offset, int $limit): array
{
    $count = (int)accounts_query($db, 'SELECT COUNT(*) FROM accounts_recovery WHERE user_id=? AND app=?', [$user, $app])->fetchColumn();
    $rows = accounts_query($db, 'SELECT id,app,document,label,schema_version,revision,created_at FROM accounts_recovery WHERE user_id=? AND app=? ORDER BY created_at DESC,id DESC LIMIT '.(int)$limit.' OFFSET '.(int)$offset,
        [$user, $app])->fetchAll();
    return [
        'items' => array_map('accounts_recovery_metadata', $rows),
        'total' => $count, 'nextOffset' => $offset + $limit < $count ? $offset + $limit : null,
    ];
}
