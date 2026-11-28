<?php

declare(strict_types=1);

require_once __DIR__.'/_sync.php';
require_once dirname(__DIR__, 2).'/utilities/pokemon-binder/api/_offers.php';

function binder_stock_rows(PDO $db, string $user): array
{
    return accounts_query($db, 'SELECT * FROM accounts_binder_stock_alerts WHERE user_id=? ORDER BY store', [$user])->fetchAll();
}

function binder_stock_revision(array $rows): string
{
    return hash('sha256', implode(',', array_column($rows, 'revision')));
}

function binder_stock_settings(PDO $db, string $user): array
{
    $rows = array_values(array_filter(binder_stock_rows($db, $user), static fn(array $row): bool => (bool)$row['enabled']));
    return [
        'revision' => binder_stock_revision($rows),
        'hasSyncedBinders' => (int)accounts_query($db, "SELECT JSON_LENGTH(state_json, '$.binders') FROM accounts_documents
            WHERE user_id=? AND app='pokedex-binder' AND document='master-sets'", [$user])->fetchColumn() > 0,
        'alerts' => array_map(static fn(array $row): array => [
            'store' => $row['store'], 'minimum' => (int)$row['minimum'],
            'lastCheckedAt' => $row['last_checked_at'] === null ? null : gmdate(DATE_ATOM, (int)$row['last_checked_at']),
        ], $rows),
    ];
}

function binder_stock_save(PDO $db, string $user, array $session, stdClass $body): array
{
    $stores = array_column(BINDER_OFFER_STORES, 'name');
    if (!accounts_fields($body, ['revision', 'alerts']) || !is_string($body->revision)
        || !preg_match('/^[a-f0-9]{64}$/D', $body->revision)
        || !is_array($body->alerts) || count($body->alerts) > count($stores)) {
        accounts_fail(422, 'invalid_alerts', 'Choose known stores and a minimum from 1 to 100.');
    }
    $requested = [];
    foreach ($body->alerts as $alert) {
        if (!accounts_fields($alert, ['store', 'minimum']) || !in_array($alert->store, $stores, true)
            || isset($requested[$alert->store]) || !is_int($alert->minimum) || $alert->minimum < 1 || $alert->minimum > 100) {
            accounts_fail(422, 'invalid_alerts', 'Choose known stores and a minimum from 1 to 100.');
        }
        $requested[$alert->store] = $alert->minimum;
    }

    return accounts_transaction($db, static function () use ($db, $user, $session, $body, $requested): array {
        accounts_mutating_session($db, $session);
        accounts_lock_user($db, $user);
        $rows = binder_stock_rows($db, $user);
        $active = array_filter($rows, static fn(array $row): bool => (bool)$row['enabled']);
        if (!hash_equals(binder_stock_revision($active), $body->revision)) {
            accounts_fail(409, 'alerts_changed', 'Stock alerts changed on another device.');
        }

        $existing = array_column($rows, null, 'store');
        foreach (array_diff_key(array_column($active, null, 'store'), $requested) as $store => $row) {
            accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET enabled=0, revision=? WHERE user_id=? AND store=?',
                [accounts_uuid(), $user, $store]);
        }
        foreach ($requested as $store => $minimum) {
            if (!isset($existing[$store])) {
                accounts_query($db, "INSERT INTO accounts_binder_stock_alerts (user_id, store, minimum, revision, notified_json)
                    VALUES (?, ?, ?, ?, '{}')", [$user, $store, $minimum, accounts_uuid()]);
            } elseif (!$existing[$store]['enabled'] || (int)$existing[$store]['minimum'] !== $minimum) {
                accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET enabled=1, minimum=?, revision=?, next_check_at=0 WHERE user_id=? AND store=?',
                    [$minimum, accounts_uuid(), $user, $store]);
            }
        }
        return binder_stock_settings($db, $user);
    });
}
