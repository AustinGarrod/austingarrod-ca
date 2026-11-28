<?php

declare(strict_types=1);
require_once __DIR__.'/_common.php';
require_once __DIR__.'/_master-sets.php';

function binder_share_key(mixed $value): string
{
    if ($value === 'national') return $value;
    if (!is_string($value) || !preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $value)) {
        accounts_fail(422, 'invalid_binder', 'Choose a binder to share.');
    }
    return $value;
}

function binder_share_unavailable(): never
{
    accounts_fail(404, 'binder_unavailable', 'This shared binder is unavailable.');
}

function binder_share_national_enabled(stdClass $state): bool
{
    $s = $state->settings;
    return $state->enabled ?? (!empty($state->ownedDexIds) || !empty($state->orderedDexIds)
        || $s->columns !== 4 || $s->rows !== 4 || !$s->useBackSides || $s->leadingBlankPockets !== 0);
}

function binder_share_target(?array $row, string $key): ?stdClass
{
    if ($row === null || (int)$row['schema_version'] !== 1) return null;
    $state = json_decode($row['state_json'], false, 64, JSON_THROW_ON_ERROR);
    if ($key === 'national') return binder_share_national_enabled($state) ? $state : null;
    foreach ($state->binders as $binder) {
        if ($binder->id === $key) return $binder;
    }
    return null;
}

function binder_share_owner_state(PDO $db, string $user, string $key): array
{
    $share = accounts_query($db, 'SELECT version, token FROM accounts_binder_shares WHERE user_id=? AND binder_key=?', [$user, $key])->fetch();
    return ['version' => (int)($share['version'] ?? 0), 'token' => $share['token'] ?? null];
}

function binder_share_manage(PDO $db, string $user, array $session, ?stdClass $body): array
{
    $key = binder_share_key($body === null ? ($_GET['binder'] ?? null) : ($body->binder ?? null));
    if ($body === null) return binder_share_owner_state($db, $user, $key);
    $action = $body->action ?? null;
    if (!in_array($action, ['publish', 'revoke'], true) ||
        !accounts_fields($body, $action === 'publish'
            ? ['binder', 'action', 'version', 'documentRevision'] : ['binder', 'action', 'version'])) {
        accounts_fail(422, 'invalid_share_request', 'The sharing request is invalid.');
    }
    $version = accounts_number($body->version);
    $revision = $action === 'publish' ? accounts_number($body->documentRevision) : null;
    return accounts_transaction($db, static function () use ($db, $user, $session, $key, $action, $version, $revision) {
        accounts_mutating_session($db, $session);
        accounts_lock_user($db, $user);
        $share = binder_share_owner_state($db, $user, $key);
        if ($share['version'] !== $version) {
            accounts_fail(409, 'share_changed', 'Sharing changed on another device. Review the current status and try again.');
        }
        if ($action === 'revoke' && $share['token'] === null) return $share;
        if ($action === 'publish') {
            $row = accounts_document($db, $user, 'pokedex-binder', $key === 'national' ? 'binder' : 'master-sets', true);
            if (binder_share_target($row, $key) === null) {
                accounts_fail(409, 'binder_not_synced', 'Sync this binder to your account before sharing it.');
            }
            if ((int)$row['revision'] !== $revision) {
                accounts_fail(409, 'binder_changed', 'The synced binder changed. Review it and try again.');
            }
            if ($share['token'] !== null) return $share;
        }
        $token = $action === 'publish' ? 'pbs_'.bin2hex(random_bytes(32)) : null;
        $next = $version + 1;
        accounts_query($db, 'INSERT INTO accounts_binder_shares(user_id,binder_key,version,token) VALUES(?,?,?,?)
            ON DUPLICATE KEY UPDATE version=VALUES(version),token=VALUES(token)', [$user, $key, $next, $token]);
        return ['version' => $next, 'token' => $token];
    });
}

// Document writes, restores and migrations already hold the account lock.
// Keep the version even when a later restore brings the binder back.
function binder_shares_revoke_removed(PDO $db, string $user, string $document, string $before, string $after): void
{
    $previous = json_decode($before, false, 64, JSON_THROW_ON_ERROR);
    $next = json_decode($after, false, 64, JSON_THROW_ON_ERROR);
    $removed = $document === 'binder'
        ? (binder_share_national_enabled($previous) && !binder_share_national_enabled($next) ? ['national'] : [])
        : array_diff(array_column($previous->binders, 'id'), array_column($next->binders, 'id'));
    if (!$removed) return;
    $parameters = implode(',', array_fill(0, count($removed), '?'));
    accounts_query($db, "UPDATE accounts_binder_shares SET token=NULL,version=version+1 WHERE user_id=? AND token IS NOT NULL AND binder_key IN ($parameters)", [$user, ...array_values($removed)]);
}

function binder_share_pick(stdClass $data, array $fields): array
{
    return array_intersect_key(get_object_vars($data), array_fill_keys($fields, true));
}

function binder_share_read(PDO $db, string $token, string $webroot): array
{
    // Resolve the link and the live document in one database snapshot.
    $row = accounts_query($db, "SELECT shares.binder_key, docs.schema_version, docs.state_json
        FROM accounts_binder_shares shares JOIN accounts_documents docs
        ON docs.user_id=shares.user_id AND docs.app='pokedex-binder'
        AND docs.document=IF(shares.binder_key='national','binder','master-sets')
        WHERE shares.token=?", [$token])->fetch();
    if (!is_array($row)) binder_share_unavailable();
    $key = $row['binder_key'];
    $binder = binder_share_target($row, $key);
    if ($binder === null) binder_share_unavailable();
    $settings = binder_share_pick($binder->settings, ['columns', 'rows', 'useBackSides', 'leadingBlankPockets']);
    if ($key === 'national') {
        return ['kind' => 'national', 'settings' => $settings, 'ownedDexIds' => $binder->ownedDexIds,
            'orderedDexIds' => $binder->orderedDexIds ?? []];
    }
    $settings += binder_share_pick($binder->settings, ['fillerThrough', 'includeRelated']);
    $includeRelated = $binder->settings->includeRelated ?? false;
    if ($includeRelated && isset($binder->settings->sectionLayout)) {
        $settings['sectionLayout'] = array_map(static fn(stdClass $section) => binder_share_pick($section, ['id', 'newPage']), $binder->settings->sectionLayout);
    }
    // Extra identities are local to this view. Translate their matching marks too.
    $keys = [];
    $extras = [];
    foreach ($binder->extras as $index => $extra) {
        $id = (string)($index + 1);
        $keys['extra:'.$extra->id] = 'extra:'.$id;
        $extras[] = ['id' => $id] + binder_share_pick($extra, ['name', 'number', 'required']);
    }
    $cards = master_binder_cards($webroot, $binder->setId, master_set_index($webroot), $includeRelated);
    $owned = [];
    $ordered = [];
    foreach (master_slots($binder, $cards) as $slot) {
        $mark = $keys[$slot['key']] ?? $slot['key'];
        if ($slot['owned']) $owned[] = $mark;
        elseif ($slot['ordered']) $ordered[] = $mark;
    }
    $visibleSpecialties = [];
    foreach ($cards as $card) {
        foreach ($card->variants as $variant) {
            if (!$variant->specialty) continue;
            $visibleSpecialties[$variant->id] = true;
            $visibleSpecialties[master_card_prefix($card).$variant->id] = true;
        }
    }
    return ['kind' => 'set', 'settings' => $settings, 'extras' => $extras,
        'owned' => $owned, 'ordered' => $ordered, 'specialties' => array_values(array_intersect($binder->specialties, array_keys($visibleSpecialties)))]
        + binder_share_pick($binder, ['name', 'setId', 'goal', 'order']);
}
