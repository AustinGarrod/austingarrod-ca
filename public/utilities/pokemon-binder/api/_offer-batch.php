<?php

declare(strict_types=1);

const BINDER_OFFER_BATCH_SIZE = 10;
const BINDER_OFFER_BATCH_BUDGET = 50.0;

function binder_offer_batch_targets(string $root, mixed $payload): ?array
{
    $raw = $payload['targets'] ?? null;
    if (!is_array($raw) || !array_is_list($raw) || !$raw || count($raw) > BINDER_OFFER_BATCH_SIZE) {
        return null;
    }
    $accepted = [];
    $seen = [];
    $storeNames = array_column(BINDER_OFFER_STORES, 'name');
    foreach ($raw as $item) {
        if (!is_array($item) || ($target = binder_offer_target($root, $item)) === null) {
            return null;
        }
        $names = $item['stores'] ?? null;
        if ($names !== null && (!is_array($names) || !array_is_list($names) || !$names
            || array_any($names, static fn($name): bool => !in_array($name, $storeNames, true)))) {
            return null;
        }
        $stores = binder_offer_stores($names === null ? null : implode(',', $names));
        $key = binder_offer_printing_key($target);
        if ($stores === null || isset($seen[$key])) {
            return null;
        }
        $accepted[] = ['target' => $target, 'stores' => $stores];
        $seen[$key] = true;
    }
    return $accepted;
}

function binder_offer_available_stores(array &$item, array $stores, bool $useCache): array
{
    $ready = [];
    $now = time();
    foreach ($stores as $host => $store) {
        $cached = $useCache ? binder_offer_cache_get(binder_offer_cache_key($item['key'], $host), $now) : null;
        if ($cached !== null) {
            $item['checks'][$host] = $cached;
            continue;
        }
        $delay = binder_offer_store_wait($host, $now);
        if ($delay === 0) {
            $ready[$host] = $store;
        } elseif ($delay !== null) {
            $item['waiting'][$host] = $now + $delay;
        }
    }
    return $ready;
}

function binder_offer_references(array $target, array $store, array $products): array
{
    $references = [];
    foreach (binder_offer_matching_variants($target, $store, $products) as [$variant, $url]) {
        $id = $variant['id'] ?? null;
        $link = binder_offer_product_link($url);
        if (binder_offer_variant_number($id) === null || strlen($link) > 2048) {
            return [];
        }
        $references[$id] = $link;
    }
    return count($references) <= BINDER_OFFER_BATCH_SIZE ? $references : [];
}

function binder_offer_lookup_products(array $target, array $store, array $products, array $references): ?array
{
    $checked = [];
    $matched = [];
    foreach ($products as $product) {
        if (!is_array($product) || !is_array($product['variants'] ?? null)) {
            continue;
        }
        foreach ($product['variants'] as $variant) {
            $id = $variant['id'] ?? null;
            if (!is_string($id) || !isset($references[$id]) || !is_array($variant['inputs'] ?? null)
                || !array_any($variant['inputs'], static fn($input): bool => ($input['id'] ?? null) === $id)) {
                continue;
            }
            $row = $product;
            $row['url'] ??= $references[$id];
            $row['variants'] = [$variant];
            $available = $variant['availability']['available'] ?? null;
            if (!is_bool($available) || ($available && (($variant['price']['currency'] ?? '') !== 'CAD'
                || !is_int($variant['price']['amount'] ?? null) || $variant['price']['amount'] < 1))
                || binder_offer_listing_url($row, $store) === null || !binder_offer_matches($target, $row, $variant)
                || binder_offer_condition($variant) === null) {
                continue;
            }
            $checked[$id] = true;
            $matched[] = $row;
        }
    }
    // An unresolved or changed condition calls for a fresh search of the entire printing.
    return count($checked) === count($references) ? $matched : null;
}

function binder_offer_lookup_waves(array $items): array
{
    $waves = [];
    $now = time();
    foreach ($items as $index => $item) {
        foreach ($item['pending'] as $host => $store) {
            $key = binder_offer_cache_key($item['key'], $host, true);
            $refs = binder_offer_cache_get($key, $now)['refs'] ?? [];
            if (!is_array($refs) || !$refs || count($refs) > BINDER_OFFER_BATCH_SIZE) {
                continue;
            }
            $wave = 0;
            while (count(($waves[$wave][$host]['refs'] ?? []) + $refs) > BINDER_OFFER_BATCH_SIZE) {
                $wave++;
            }
            $waves[$wave][$host]['refs'] = ($waves[$wave][$host]['refs'] ?? []) + $refs;
            $waves[$wave][$host]['items'][$index] = $refs;
        }
    }
    return $waves;
}

function binder_offer_dispatch(
    array $queries,
    string $tool,
    string $profile,
    ?array &$auth,
    bool &$renewed,
    callable $fetch,
    callable $authenticate,
    float $deadline
): array {
    $responses = [];
    foreach ($queries as $host => $value) {
        $now = time();
        $delay = binder_offer_store_wait($host, $now);
        if ($delay !== 0) {
            unset($queries[$host]);
            if ($delay !== null) {
                $responses[$host] = ['retryAt' => $now + $delay];
            }
        }
    }
    if (!$queries) {
        return $responses;
    }
    $responses += $fetch($queries, $tool, $profile, $auth);
    if ($auth === null || $renewed || microtime(true) + 10 > $deadline) {
        return $responses;
    }
    $retry = array_filter($queries, static fn(string $host): bool =>
        ($responses[$host]['status'] ?? 0) === 401, ARRAY_FILTER_USE_KEY);
    if ($retry) {
        $renewed = true;
        $replacement = $authenticate($auth['token']);
        if ($replacement !== null) {
            $auth = $replacement;
            $responses = array_replace($responses, binder_offer_dispatch($retry, $tool, $profile, $auth, $renewed, $fetch,
                $authenticate, $deadline));
        }
    }
    return $responses;
}

function binder_offer_save_check(array &$item, array $store, array $products, int $checkedAt, bool $cache): void
{
    $host = $store['host'];
    $check = [
        'offers' => binder_offer_rows($item['target'], $store, $products, $checkedAt),
        'expiresAt' => $checkedAt + BINDER_OFFER_TTL,
    ];
    $item['checks'][$host] = $check;
    if ($cache) {
        binder_offer_cache_set(binder_offer_cache_key($item['key'], $host), $check);
    }
}

function binder_offer_refresh_known(
    array &$items,
    string $profile,
    ?array &$auth,
    bool &$renewed,
    callable $fetch,
    callable $authenticate,
    float $deadline
): void {
    foreach (binder_offer_lookup_waves($items) as $wave) {
        if (microtime(true) + 5 > $deadline) {
            return;
        }
        $queries = [];
        foreach ($wave as $host => $group) {
            // Give a concurrent request's newly cached results a chance to satisfy this batch.
            $references = [];
            foreach ($group['items'] as $index => $refs) {
                $item = &$items[$index];
                $store = $item['pending'][$host];
                if (binder_offer_available_stores($item, [$host => $store], true)) {
                    $references += $refs;
                } else {
                    unset($item['pending'][$host], $wave[$host]['items'][$index]);
                }
                unset($item);
            }
            if ($references) {
                $queries[$host] = array_keys($references);
            }
        }
        $checkedAt = time();
        $responses = binder_offer_dispatch($queries, 'lookup_catalog', $profile, $auth, $renewed, $fetch, $authenticate, $deadline);
        foreach ($wave as $host => $group) {
            $response = $responses[$host] ?? [];
            foreach ($group['items'] as $index => $refs) {
                $item = &$items[$index];
                if (isset($response['retryAt'])) {
                    $item['waiting'][$host] = $response['retryAt'];
                    unset($item['pending'][$host]);
                } else {
                    $store = $item['pending'][$host];
                    $products = $response['products'] ?? null;
                    $matched = $products === null ? null : binder_offer_lookup_products($item['target'], $store, $products, $refs);
                    if ($matched !== null) {
                        binder_offer_save_check($item, $store, $matched, $checkedAt, true);
                        unset($item['pending'][$host]);
                    } elseif (in_array($response['status'] ?? 0, [0, 401, 429, 500, 502, 503, 504], true)) {
                        // Keep the existing reference on temporary transport failures.
                        unset($item['pending'][$host]);
                    }
                }
                unset($item);
            }
        }
    }
}

function binder_offer_lookups(
    array $items,
    string $profile = BINDER_OFFER_PROFILE,
    ?callable $fetch = null,
    ?callable $authenticate = null
): array {
    $fetch ??= 'binder_offer_fetch';
    $authenticate ??= 'binder_shopify_auth';
    $useCache = $profile === BINDER_OFFER_PROFILE;
    $deadline = microtime(true) + BINDER_OFFER_BATCH_BUDGET;
    $hasPending = false;
    foreach ($items as &$item) {
        $item += ['checks' => [], 'waiting' => [], 'pending' => [], 'retryAfter' => 0];
        if (!preg_match('/^(?:normal|holo|reverse)(?:\+|$)/', $item['target']['variant']['id'])) {
            $item['stores'] = [];
            continue;
        }
        $item['key'] = binder_offer_printing_key($item['target']);
        $item['pending'] = binder_offer_available_stores($item, array_column($item['stores'], null, 'host'), $useCache);
        $hasPending = $hasPending || (bool) $item['pending'];
    }
    unset($item);
    $auth = $useCache && $hasPending ? $authenticate() : null;
    $renewed = false;
    if ($auth !== null && count($items) > 1) {
        binder_offer_refresh_known($items, $profile, $auth, $renewed, $fetch, $authenticate, $deadline);
    }

    // Search once per unresolved printing, in parallel across its retailers. Every later printing sees a prior 429.
    foreach ($items as &$item) {
        $stores = binder_offer_available_stores($item, $item['pending'], $useCache);
        if (!$stores) {
            continue;
        }
        if (microtime(true) + 5 > $deadline) {
            $item['retryAfter'] = 1;
            continue;
        }
        if ($auth === null && ($delay = binder_offer_reserve(time())) !== 0) {
            $item['retryAfter'] = $delay ?? 0;
            continue;
        }
        $checkedAt = time();
        $queries = array_fill_keys(array_keys($stores), binder_offer_query($item['target']));
        $responses = binder_offer_dispatch($queries, 'search_catalog', $profile, $auth, $renewed, $fetch, $authenticate, $deadline);
        foreach ($stores as $host => $store) {
            $response = $responses[$host] ?? [];
            if (isset($response['retryAt'])) {
                $item['waiting'][$host] = $response['retryAt'];
                continue;
            }
            $products = $response['products'] ?? null;
            if ($products === null) {
                continue;
            }
            binder_offer_save_check($item, $store, $products, $checkedAt, $useCache);
            if ($useCache) {
                $refs = binder_offer_references($item['target'], $store, $products);
                binder_offer_cache_set(binder_offer_cache_key($item['key'], $host, true), [
                    'refs' => $refs, 'expiresAt' => $checkedAt + BINDER_OFFER_REFERENCE_TTL,
                ]);
            }
        }
    }
    unset($item);
    return array_map(static fn(array $item): array =>
        binder_offer_result($item['checks'], $item['retryAfter'], $item['stores'], $item['waiting']), $items);
}
