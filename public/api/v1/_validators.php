<?php

declare(strict_types=1);
require_once __DIR__.'/_common.php';
require_once __DIR__.'/_master-sets.php';
const ACCOUNTS_SYSTEMS = ['achievement', 'craft', 'material', 'quest', 'village', 'enemy', 'divinity'];
// The registry also defines complete migration manifests for each application.
const ACCOUNTS_DOCUMENT_LIMITS = [
    'pokedex-binder' => ['binder' => 65536, 'master-sets' => 4194304],
    'idle-slayer-companion' => ['progress' => 4194304, 'intentions' => 65536, 'checkpoints' => 4194304, 'comparison' => 4096],
    'radius-map' => ['measurements' => 4194304],
];
function accounts_invalid(): never
{
    accounts_fail(422, 'invalid_state', 'The document has an unsupported format. Your saved data was not replaced.');
}

function accounts_safe_id(mixed $value, ?string $pattern = null): bool
{
    return is_string($value) && strlen($value) <= 4096 && trim($value) !== '' && strlen(mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')) / 2 <= 1024 && !in_array($value, ['__proto__', 'prototype', 'constructor'], true) && ($pattern === null || preg_match($pattern, $value) === 1);
}

function accounts_bool_map(mixed $map): bool
{
    if (!$map instanceof stdClass) {
        return false;
    }
    foreach ($map as $id => $value) {
        if (!accounts_safe_id((string)$id) || $value !== true) {
            return false;
        }

    }
    return true;
}

function accounts_profile(mixed $p): void
{
    if (!accounts_fields($p, ['version', 'catalogRevision', 'epoch', 'purchases', 'milestones', 'showSpoilers']) || $p->version !== 1 || !accounts_safe_id($p->catalogRevision) || !is_int($p->epoch) || $p->epoch < 0 || $p->epoch > 9007199254740991 || !is_bool($p->showSpoilers) || !$p->purchases instanceof stdClass || !accounts_bool_map($p->milestones)) {
        accounts_invalid();
    }

    foreach ($p->purchases as $id => $purchase) {
        if (!accounts_safe_id((string)$id) || !accounts_fields($purchase, ['epoch', 'active']) || !is_bool($purchase->active) || !is_int($purchase->epoch) || $purchase->epoch < 0 || $purchase->epoch > $p->epoch) {
            accounts_invalid();
        }

    }

}

function accounts_registry(string $app, string $document): int
{
    if (!isset(ACCOUNTS_DOCUMENT_LIMITS[$app][$document])) {
        accounts_fail(422, 'unknown_document', 'This application document is not registered.');
    }
    return ACCOUNTS_DOCUMENT_LIMITS[$app][$document];
}

function accounts_radius_text(mixed $value, int $limit): bool
{
    // Match the browser's String.trim() character set.
    $space = '[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';
    return is_string($value) && $value !== '' && preg_match('/^'.$space.'|'.$space.'$/uD', $value) === 0
        && strlen(mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')) <= 2 * $limit;
}

function accounts_radius_timestamp(mixed $value): bool
{
    if (!is_string($value) || !preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/D', $value)) {
        return false;
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s.v\Z', $value, new DateTimeZone('UTC'));
    return $date !== false && $date->format('Y-m-d\TH:i:s.v\Z') === $value;
}

function accounts_radius_number(mixed $value): bool
{
    return (is_int($value) || is_float($value)) && is_finite((float)$value);
}

function accounts_radius_measurements(mixed $state): void
{
    if (!accounts_fields($state, ['version', 'measurements']) || $state->version !== 1 || !is_array($state->measurements)) {
        accounts_invalid();
    }

    $ids = [];
    foreach ($state->measurements as $item) {
        if (!accounts_fields($item, ['id', 'name', 'locationLabel', 'center', 'value', 'kind', 'unit', 'visible', 'createdAt', 'updatedAt'])
            || !accounts_radius_text($item->id, 128) || isset($ids[$item->id])
            || !accounts_radius_text($item->name, 80) || !accounts_radius_text($item->locationLabel, 240)
            || !accounts_fields($item->center, ['lat', 'lng'])
            || !accounts_radius_number($item->center->lat) || abs($item->center->lat) > 90
            || !accounts_radius_number($item->center->lng) || abs($item->center->lng) > 180
            || !accounts_radius_number($item->value) || $item->value <= 0
            || !in_array($item->kind, ['radius', 'diameter'], true) || !in_array($item->unit, ['mi', 'km'], true)
            || !is_bool($item->visible) || !accounts_radius_timestamp($item->createdAt) || !accounts_radius_timestamp($item->updatedAt)) {
            accounts_invalid();
        }
        $radius = $item->value * ($item->unit === 'km' ? 1000 : 1609.344) / ($item->kind === 'diameter' ? 2 : 1);
        if ($radius > 20000000) {
            accounts_invalid();
        }
        $ids[$item->id] = true;
    }
}

function accounts_validate(string $app, string $document, mixed $version, mixed $state, string $webroot): string
{
    $limit = accounts_registry($app, $document);
    if ($version !== 1) {
        accounts_invalid();
    }

    $encoded = accounts_encode($state);
    if (strlen($encoded) > $limit) {
        accounts_fail(413, 'document_too_large', 'The document exceeds its supported size.');
    }

    if ($app === 'pokedex-binder' && $document === 'master-sets') {
        master_validate($state, $webroot);
        return $encoded;
    }

    if ($app === 'radius-map') {
        accounts_radius_measurements($state);
        return $encoded;
    }

    if ($app === 'pokedex-binder') {
        if (!accounts_fields($state, ['schemaVersion', 'settings', 'ownedDexIds'], ['enabled', 'orderedDexIds']) || $state->schemaVersion !== 1
            || (property_exists($state, 'enabled') && !is_bool($state->enabled))
            || (property_exists($state, 'orderedDexIds') && !is_array($state->orderedDexIds))
            || !accounts_fields($state->settings, ['columns', 'rows', 'useBackSides', 'leadingBlankPockets']) || !is_array($state->ownedDexIds)) {
            accounts_invalid();
        }

        $s = $state->settings;
        if (!is_int($s->columns) || $s->columns < 1 || $s->columns > 6 || !is_int($s->rows) || $s->rows < 1 || $s->rows > 6 || !is_bool($s->useBackSides) || !is_int($s->leadingBlankPockets) || $s->leadingBlankPockets < 0 || $s->leadingBlankPockets > 1000) {
            accounts_invalid();
        }

        $raw = file_get_contents($webroot.'/utilities/pokedex-binder/catalog/index.json');
        $catalog = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        if (($catalog['schemaVersion'] ?? null) !== 1 || !isset($catalog['species']) || !is_array($catalog['species'])) {
            throw new RuntimeException();
        }

        $allowed = [];
        foreach ($catalog['species'] as $species) {
            $allowed[$species['id']] = true;
        }
        $seen = [];
        foreach (array_merge($state->ownedDexIds, $state->orderedDexIds ?? []) as $id) {
            if (!is_int($id) || !isset($allowed[$id]) || isset($seen[$id])) {
                accounts_invalid();
            }
            $seen[$id] = true;
        }

        return $encoded;
    }

    if ($document === 'progress') {
        if (!accounts_fields($state, ['format', 'version', 'catalogRevision', 'ascension', 'modules']) || $state->format !== 'idle-slayer-companion-progress' || $state->version !== 1 || !accounts_safe_id($state->catalogRevision) || !accounts_fields($state->modules, ACCOUNTS_SYSTEMS)) {
            accounts_invalid();
        }

        accounts_profile($state->ascension);
        foreach (ACCOUNTS_SYSTEMS as $system) {
            $m = $state->modules->{$system};
            if (!accounts_fields($m, ['tracked', 'records'], ['observedAt', 'source']) || !is_bool($m->tracked) || !$m->records instanceof stdClass) {
                accounts_invalid();
            }

            if (property_exists($m, 'source') && !in_array($m->source, ['manual', 'save', 'legacy', 'reset'], true)) {
                accounts_invalid();
            }

            if (property_exists($m, 'observedAt') && (!is_string($m->observedAt) || strlen($m->observedAt) > 64 || !preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/D', $m->observedAt) || strtotime($m->observedAt) === false)) {
                accounts_invalid();
            }

            foreach ($m->records as $id => $record) {
                if (!accounts_safe_id((string)$id) || !accounts_fields($record, [], ['completed', 'active', 'discovered', 'claimed', 'selected', 'built', 'count', 'stage'])) {
                    accounts_invalid();
                }

                foreach (['completed', 'active', 'discovered', 'claimed', 'selected', 'built'] as $field) {
                    if (property_exists($record, $field) && !is_bool($record->{$field})) {
                        accounts_invalid();
                    }

                }

                foreach (['count', 'stage'] as $field) {
                    if (property_exists($record, $field) && (!is_string($record->{$field}) || !preg_match('/^(0|[1-9]\d{0,1023})$/D', $record->{$field}))) {
                        accounts_invalid();
                    }

                }

            }

        }

    } elseif ($document === 'intentions') {
        if (!accounts_fields($state, ['format', 'version', 'goals', 'recipePlans']) || $state->format !== 'idle-slayer-companion-workspace' || $state->version !== 1 || !is_array($state->goals) || count($state->goals) > 20 || !$state->recipePlans instanceof stdClass || count(get_object_vars($state->recipePlans)) > 100) {
            accounts_invalid();
        }
        $seen = [];
        foreach ($state->goals as $g) {
            if (!accounts_fields($g, ['ref', 'mode']) || !accounts_fields($g->ref, ['system', 'id']) || !in_array($g->ref->system, array_merge(['ascension'], ACCOUNTS_SYSTEMS), true) || !accounts_safe_id($g->ref->id, '/^[a-zA-Z0-9._:-]{1,128}$/D')) {
                accounts_invalid();
            }

            $key = $g->ref->system.':'.$g->ref->id;
            $modes = match($g->ref->system) {
                'ascension' => ['acquire', 'activate', 'rebuild'],'enemy' => ['mastery'],'divinity' => ['select'],default => ['complete']
            };
            if (isset($seen[$key]) || !in_array($g->mode, $modes, true)) {
                accounts_invalid();
            }
            $seen[$key] = true;
        }

        foreach ($state->recipePlans as $id => $count) {
            if (!accounts_safe_id((string)$id, '/^[a-zA-Z0-9._:-]{1,128}$/D') || !is_string($count) || !preg_match('/^[1-9]\d{0,29}$/D', $count)) {
                accounts_invalid();
            }

        }

    } elseif ($document === 'checkpoints') {
        if (!accounts_fields($state, ['kind', 'version', 'entries']) || $state->kind !== 'progress-checkpoints' || $state->version !== 1 || !is_array($state->entries) || count($state->entries) > 4) {
            accounts_invalid();
        }
        $seen = [];
        foreach ($state->entries as $entry) {
            if (!accounts_fields($entry, ['id', 'name', 'capturedRevision', 'profile']) || !accounts_safe_id($entry->id, '/^[a-zA-Z0-9_-]{1,128}$/D') || isset($seen[$entry->id]) || !is_string($entry->name) || trim($entry->name) === '' || mb_strlen($entry->name, 'UTF-8') > 64 || preg_match('/[\x00-\x1f\x7f]/', $entry->name) || !accounts_safe_id($entry->capturedRevision)) {
                accounts_invalid();
            }
            $seen[$entry->id] = true;
            accounts_profile($entry->profile);
        }

    } elseif ($document === 'comparison') {
        if (!accounts_fields($state, ['kind', 'version', 'ids']) || $state->kind !== 'upgrade-comparison' || $state->version !== 1 || !is_array($state->ids) || count($state->ids) > 4) {
            accounts_invalid();
        }
        $seen = [];
        foreach ($state->ids as $id) {
            if (!accounts_safe_id($id, '/^[a-zA-Z0-9_-]{1,128}$/D') || isset($seen[$id])) {
                accounts_invalid();
            }
            $seen[$id] = true;
        }

    }

    return $encoded;
}
