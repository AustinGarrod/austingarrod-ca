<?php

declare(strict_types=1);

require_once __DIR__.'/_binder-stock-alerts.php';
require_once __DIR__.'/_auth.php';

const BINDER_STOCK_FRESH_SECONDS = 4 * 3600;
const BINDER_STOCK_EMAIL_INTERVAL = 86400;

/**
 * A required finish has one target. An any-finish slot can be filled by any of its
 * checkable alternatives and counts once, even when several alternatives are in stock.
 */
function binder_stock_targets(string $root, ?array $document): array
{
    if ($document === null) return [[], []];
    $state = json_decode($document['state_json'], false, 64, JSON_THROW_ON_ERROR);
    $sets = master_set_index($root);
    $groups = [];
    $targets = [];
    $catalog = [];
    $relatedPrintings = [];
    foreach ($state->binders as $binder) {
        if (!isset($sets[$binder->setId])) continue;
        $related = $binder->settings->includeRelated ?? false;
        $layoutKey = $binder->setId.':'.(int)$related;
        $cards = $catalog[$layoutKey] ??= master_binder_cards($root, $binder->setId, $sets, $related);
        $byKey = [];
        foreach ($cards as $card) $byKey[master_card_prefix($card)] = $card;

        foreach (master_slots($binder, $cards) as $slot) {
            if (!$slot['required'] || $slot['status'] !== 'missing' || str_starts_with($slot['key'], 'extra:')) continue;
            [$prefix, $finish] = explode(':', $slot['key'], 2);
            $card = $byKey[$prefix.':'];
            $setId = $card->sourceSetId ?? $binder->setId;
            $cardKey = $setId.'/'.$card->number;
            $fullCard = $card;
            if (isset($card->sourceSetId)) {
                $relatedPrintings[$setId] ??= array_column(master_cards($root, $setId, $sets), null, 'number');
                $fullCard = $relatedPrintings[$setId][$card->number];
            }
            $offerCard = array_replace((array)$fullCard, ['variants' => array_map(static fn($v) => (array)$v, $fullCard->variants)]);
            foreach ($card->variants as $variant) {
                if (($finish !== '*' && $finish !== $variant->id)
                    || !preg_match('/^(?:normal|holo|reverse)(?:\+|$)/', $variant->id)) continue;
                $target = ['set' => (array)$sets[$setId], 'card' => $offerCard, 'variant' => (array)$variant];
                $key = binder_offer_printing_key($target);
                $targets[$key] = $target;
                $groups[$cardKey][$finish][$key] = true;
            }
        }
    }
    return [$groups, $targets];
}

function binder_stock_observations(PDO $db, string $store, array $keys): array
{
    $observations = [];
    foreach (array_chunk($keys, 500) as $chunk) {
        $parameters = implode(',', array_fill(0, count($chunk), '?'));
        $rows = accounts_query($db, "SELECT * FROM accounts_binder_stock_observations WHERE store=? AND printing IN ($parameters)",
            [$store, ...$chunk])->fetchAll();
        $observations += array_column($rows, null, 'printing');
    }
    return $observations;
}

function binder_stock_refresh(PDO $db, array $store, array $due, array &$observations, callable $lookup): void
{
    if (!$due) return;
    $requests = array_map(static fn(array $target): array => ['target' => $target, 'stores' => [$store]], array_values($due));
    $results = $lookup($requests);
    $name = $store['name'];
    $now = time();
    foreach (array_keys($due) as $index => $key) {
        $result = $results[$index];
        $checked = $result['checkedStores']->{$name} ?? null;
        $at = $checked === null ? null : strtotime($checked);
        $offer = $result['offers'][0] ?? null;
        $delay = max($result['retryAfter'] ?? 0, $result['storeRetryAfter']->{$name} ?? 0);
        $next = $at === null ? $now + max(900, $delay) : max($now + 60, $at + ($offer ? 3600 : 4 * 3600));
        $encoded = $offer === null ? null : json_encode($offer, JSON_THROW_ON_ERROR);
        accounts_query($db, 'INSERT INTO accounts_binder_stock_observations (store, printing, next_check_at, checked_at, offer_json)
            VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE next_check_at=?, checked_at=?, offer_json=?',
            [$name, $key, $next, $at, $encoded, $next, $at, $encoded]);
        $observations[$key] = ['next_check_at' => $next, 'checked_at' => $at, 'offer_json' => $encoded];
    }
}

function binder_stock_matches(array $groups, array $targets, array $observations, int $now): array
{
    $matches = [];
    $possiblePrintings = [];
    $possibleWildcards = [];
    foreach ($groups as $card => $finishes) {
        $used = [];
        // Count required finishes first, then use a different printing for any-finish slots.
        $any = $finishes['*'] ?? [];
        unset($finishes['*']);
        if ($any) $finishes['*'] = $any;
        foreach ($finishes as $finish => $keys) {
            $slot = $card.':'.$finish;
            foreach ($keys as $key => $_) {
                $row = $observations[$key] ?? null;
                $printing = $card.':'.$targets[$key]['variant']['id'];
                $fresh = ($row['checked_at'] ?? 0) >= $now - BINDER_STOCK_FRESH_SECONDS;
                $offer = $fresh ? $row['offer_json'] : null;
                if (!$fresh || $offer !== null) {
                    $possiblePrintings[$printing] = true;
                    if ($finish === '*') $possibleWildcards[$slot] = true;
                }
                if ($offer !== null && !isset($used[$key]) && !isset($matches[$slot])) {
                    $matches[$slot] = ['key' => $key, 'printing' => $printing,
                        'offer' => json_decode($offer, true, 8, JSON_THROW_ON_ERROR)];
                    $used[$key] = true;
                }
            }
        }
    }
    return [$matches, $possiblePrintings, $possibleWildcards];
}

function binder_stock_batch(array $due, array $observations): array
{
    $cold = array_diff_key($due, $observations);
    $overdue = array_intersect_key($due, $observations);
    uksort($overdue, static fn(string $a, string $b): int =>
        $observations[$a]['next_check_at'] <=> $observations[$b]['next_check_at']);
    // Reserve half the batch for discoveries when retries and refreshes are also due.
    $first = array_slice($cold, 0, intdiv(BINDER_OFFER_BATCH_SIZE, 2), true);
    return array_slice($first + $overdue + $cold, 0, BINDER_OFFER_BATCH_SIZE, true);
}

function binder_stock_email(array $config, string $root, string $email, string $store, int $minimum, array $matches, array $targets): void
{
    $count = count($matches);
    $plural = $count === 1 ? 'card' : 'cards';
    $lines = ["$count missing $plural from your set binders matched in-stock listings at $store.", ''];
    $linkCount = max(12, $minimum);
    foreach (array_slice($matches, 0, $linkCount) as $match) {
        $target = $targets[$match['key']];
        $offer = $match['offer'];
        $price = number_format($offer['priceCents'] / 100, 2);
        $lines[] = sprintf('%s — %s #%s, %s — $%s CAD (%s)', $target['card']['name'], $target['set']['name'],
            $target['card']['number'], $target['variant']['label'], $price, $offer['condition']);
        $lines[] = $offer['url'];
        $lines[] = '';
    }
    if ($count > $linkCount) $lines[] = 'And '.($count - $linkCount).' more matches in this check.';
    $lines[] = 'Store availability and prices can change.';
    $lines[] = 'Manage or turn off your alerts: '.$config['allowedOrigin'].BINDER_STOCK_ALERTS_PATH;
    $mail = accounts_mailer($config, $root, $email);
    $mail->Subject = "$count missing $plural in stock at $store";
    $mail->Body = implode("\n", $lines);
    $mail->send();
}

function binder_stock_run(PDO $db, array $config, string $root, ?callable $lookup = null, ?callable $send = null): string
{
    $lookup ??= 'binder_offer_lookups';
    $send ??= 'binder_stock_email';
    $now = time();
    accounts_query($db, 'DELETE FROM accounts_binder_stock_observations WHERE next_check_at<? ORDER BY next_check_at LIMIT 500',
        [$now - 2 * 86400]);
    $alert = accounts_query($db, 'SELECT * FROM accounts_binder_stock_alerts WHERE enabled=1 AND next_check_at<=?
        ORDER BY next_check_at, user_id, store LIMIT 1', [$now])->fetch();
    if ($alert === false) return 'idle';
    $user = $alert['user_id'];
    $store = binder_offer_stores($alert['store']);
    if (!$store) {
        accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET next_check_at=? WHERE user_id=? AND store=? AND revision=?',
            [$now + 86400, $user, $alert['store'], $alert['revision']]);
        return 'unsupported-store';
    }

    // Move this subscription to the back of the queue even if the retailer or SMTP later fails.
    accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET next_check_at=? WHERE user_id=? AND store=? AND revision=?',
        [$now + 900, $user, $alert['store'], $alert['revision']]);
    $document = accounts_document($db, $user, 'pokedex-binder', 'master-sets');
    [$groups, $targets] = binder_stock_targets($root, $document);
    $observations = binder_stock_observations($db, $alert['store'], array_keys($targets));
    $due = array_filter($targets, static fn(string $key): bool => ($observations[$key]['next_check_at'] ?? 0) <= $now, ARRAY_FILTER_USE_KEY);
    binder_stock_refresh($db, $store[0], binder_stock_batch($due, $observations), $observations, $lookup);
    $now = time();
    [$matches, $possiblePrintings, $possibleWildcards] = binder_stock_matches($groups, $targets, $observations, $now);
    $lastChecked = max(0, (int)$alert['last_checked_at'], ...array_map(
        static fn(array $row): int => (int)$row['checked_at'], array_values($observations)));
    $next = count($due) > BINDER_OFFER_BATCH_SIZE ? $now + 60 : $now + 900;

    $delivery = accounts_transaction($db, static function () use ($db, $alert, $user, $document,
        $matches, $possiblePrintings, $possibleWildcards, $lastChecked, $next, $now): string|array {
        accounts_lock_user($db, $user);
        $current = accounts_query($db, 'SELECT * FROM accounts_binder_stock_alerts WHERE user_id=? AND store=? FOR UPDATE',
            [$user, $alert['store']])->fetch();
        if (!$current || !$current['enabled'] || $current['revision'] !== $alert['revision']) return 'settings-changed';
        $live = accounts_document($db, $user, 'pokedex-binder', 'master-sets', true);
        if (($live['revision'] ?? null) !== ($document['revision'] ?? null)) {
            accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET next_check_at=? WHERE user_id=? AND store=?',
                [$now + 60, $user, $alert['store']]);
            return 'binder-changed';
        }

        $previous = json_decode($current['notified_json'], true, 8, JSON_THROW_ON_ERROR);
        $printings = array_intersect_key(array_fill_keys($previous['printings'] ?? [], true), $possiblePrintings);
        $wildcards = array_intersect_key(array_fill_keys($previous['wildcards'] ?? [], true), $possibleWildcards);
        $new = array_filter($matches, static fn(array $match, string $slot): bool =>
            !isset($printings[$match['printing']]) && !isset($wildcards[$slot]), ARRAY_FILTER_USE_BOTH);
        $priorSentAt = $current['last_sent_at'];
        $email = accounts_query($db, 'SELECT email FROM accounts_users WHERE id=?', [$user])->fetchColumn();
        $minimum = (int)$current['minimum'];
        $ready = $email !== false && $new && count($matches) >= $minimum
            && ($priorSentAt === null || (int)$priorSentAt <= $now - BINDER_STOCK_EMAIL_INTERVAL);
        $notified = ['printings' => array_keys($printings), 'wildcards' => array_keys($wildcards)];
        // Reserve the cooldown before SMTP and release the account locks. If transport fails
        // ambiguously, the unconfirmed matches remain eligible after the cooldown.
        accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET next_check_at=?, last_checked_at=?, last_sent_at=?, notified_json=?
            WHERE user_id=? AND store=?', [$next, $lastChecked ?: null, $ready ? $now : $priorSentAt, json_encode($notified, JSON_THROW_ON_ERROR),
            $user, $alert['store']]);
        if (!$ready) return 'checked';
        $printings += array_fill_keys(array_column($matches, 'printing'), true);
        $wildcards += array_filter($matches, static fn(string $slot): bool => str_ends_with($slot, ':*'), ARRAY_FILTER_USE_KEY);
        return ['email' => $email, 'minimum' => $minimum, 'matches' => $new + $matches, 'priorSentAt' => $priorSentAt,
            'notified' => ['printings' => array_keys($printings), 'wildcards' => array_keys($wildcards)]];
    });
    if (is_string($delivery)) return $delivery;

    $current = accounts_query($db, "SELECT a.revision, a.enabled, d.revision AS binder_revision
        FROM accounts_binder_stock_alerts a LEFT JOIN accounts_documents d
            ON d.user_id=a.user_id AND d.app='pokedex-binder' AND d.document='master-sets'
        WHERE a.user_id=? AND a.store=?", [$user, $alert['store']])->fetch();
    if (!$current || !$current['enabled'] || $current['revision'] !== $alert['revision']
        || $current['binder_revision'] !== ($document['revision'] ?? null)) {
        accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET last_sent_at=? WHERE user_id=? AND store=? AND last_sent_at=?',
            [$delivery['priorSentAt'], $user, $alert['store'], $now]);
        return 'delivery-cancelled';
    }
    $send($config, $root, $delivery['email'], $alert['store'], $delivery['minimum'], $delivery['matches'], $targets);
    accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET notified_json=? WHERE user_id=? AND store=? AND last_sent_at=?',
        [json_encode($delivery['notified'], JSON_THROW_ON_ERROR), $user, $alert['store'], $now]);
    return 'sent';
}
