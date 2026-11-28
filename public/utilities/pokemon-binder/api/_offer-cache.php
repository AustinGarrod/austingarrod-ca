<?php

declare(strict_types=1);

const BINDER_OFFER_REFERENCE_TTL = 86_400;
const BINDER_OFFER_CACHE_FILE_LIMIT = 32_768;

function binder_offer_printing_key(array $target): string
{
    return hash('sha256', implode('|', [$target['set']['digest'], $target['card']['number'], $target['variant']['id']]));
}

function binder_offer_cache_key(string $printing, string $host, bool $reference = false): string
{
    return ($reference ? 'pokemon-binder-references:v2:' : 'pokemon-binder-offers:v2:') . $host . ':' . $printing;
}

// Fixed slots bound disk usage on hosts without a shared APCu cache. Each slot verifies its full key before reuse.
function binder_offer_cache_file(string $key, string $mode)
{
    return binder_offer_state_file('cache-v1-' . substr(hash('sha256', $key), 0, 3), $mode);
}

function binder_offer_cache_get(string $key, int $now): ?array
{
    if (function_exists('apcu_enabled') && apcu_enabled()) {
        $entry = apcu_fetch($key);
        if (is_array($entry) && ($entry['expiresAt'] ?? 0) > $now) {
            return $entry;
        }
    }
    $handle = binder_offer_cache_file($key, 'r');
    if ($handle === false) {
        return null;
    }
    try {
        if (!flock($handle, LOCK_SH)) {
            return null;
        }
        $raw = stream_get_contents($handle, BINDER_OFFER_CACHE_FILE_LIMIT);
        $slot = json_decode($raw === false ? '' : $raw, true);
        $entry = $slot['entry'] ?? null;
        return ($slot['key'] ?? null) === $key && is_array($entry) && ($entry['expiresAt'] ?? 0) > $now ? $entry : null;
    } finally {
        fclose($handle);
    }
}

function binder_offer_cache_set(string $key, array $entry): void
{
    $ttl = $entry['expiresAt'] - time();
    if ($ttl <= 0) {
        return;
    }
    if (function_exists('apcu_enabled') && apcu_enabled()) {
        $current = apcu_fetch($key);
        if (($current['expiresAt'] ?? 0) > $entry['expiresAt'] || apcu_store($key, $entry, $ttl)) {
            return;
        }
    }
    $content = json_encode(['key' => $key, 'entry' => $entry]);
    if ($content === false || strlen($content) > BINDER_OFFER_CACHE_FILE_LIMIT) {
        return;
    }
    $handle = binder_offer_cache_file($key, 'c+');
    if ($handle === false) {
        return;
    }
    try {
        if (!flock($handle, LOCK_EX)) {
            return;
        }
        $raw = stream_get_contents($handle, BINDER_OFFER_CACHE_FILE_LIMIT);
        $current = json_decode($raw === false ? '' : $raw, true);
        if (($current['key'] ?? null) === $key && ($current['entry']['expiresAt'] ?? 0) > $entry['expiresAt']) {
            return;
        }
        if (ftruncate($handle, 0) && rewind($handle)) {
            fwrite($handle, $content);
        }
    } finally {
        fclose($handle);
    }
}
