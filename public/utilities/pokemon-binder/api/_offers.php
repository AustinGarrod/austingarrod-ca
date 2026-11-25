<?php

declare(strict_types=1);

require_once __DIR__ . '/_shopify-auth.php';

const BINDER_OFFER_STORES = [
    ['name' => '401 Games', 'host' => 'store.401games.ca', 'hosts' => ['store.401games.ca']],
    ['name' => 'Deck Out Gaming', 'host' => 'deckoutgaming.ca', 'hosts' => ['deckoutgaming.ca', 'www.deckoutgaming.ca']],
    ['name' => 'Skyfox Games', 'host' => 'skyfoxgames.com', 'hosts' => ['skyfoxgames.com', 'www.skyfoxgames.com']],
];
const BINDER_OFFER_PROFILE = 'https://austingarrod.ca/utilities/pokemon-binder/shopify-profile.json';
const BINDER_OFFER_TTL = 540;
const BINDER_OFFER_RATE_LIMIT = 24;
const BINDER_OFFER_RATE_WINDOW = 60;

function binder_offer_target(string $root, array $query): ?array
{
    $setId = $query['set'] ?? null;
    $number = $query['number'] ?? null;
    $variantId = $query['variant'] ?? null;
    if (!is_string($setId) || !preg_match('/^[a-z0-9._-]{1,40}$/D', $setId)
        || !is_string($number) || !preg_match('/^[a-zA-Z0-9._-]{1,32}$/D', $number)
        || !is_string($variantId) || !preg_match('/^[a-z0-9+=.-]{1,150}$/D', $variantId)) {
        return null;
    }

    $catalog = $root . '/utilities/pokedex-binder/catalog/master-sets';
    $sets = json_decode((string) file_get_contents($catalog . '/index.json'), true, 32, JSON_THROW_ON_ERROR);
    $set = array_find($sets, static fn(array $row): bool => $row['id'] === $setId);
    if ($set === null) {
        return null;
    }
    $cards = json_decode((string) file_get_contents($catalog . '/' . $set['id'] . '.json'), true, 32, JSON_THROW_ON_ERROR);
    $card = array_find($cards, static fn(array $row): bool => $row['number'] === $number);
    $variant = array_find($card['variants'] ?? [], static fn(array $row): bool => $row['id'] === $variantId);
    if ($variant === null) {
        return null;
    }
    return ['set' => $set, 'card' => $card, 'variant' => $variant];
}

function binder_offer_text(string $text): string
{
    $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = strtr($text, ["’" => '', "'" => '', '&' => ' and ', 'é' => 'e', 'É' => 'E', '♀' => ' female ', '♂' => ' male ']);
    if (function_exists('iconv')) {
        $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
    }
    return trim((string) preg_replace('/[^a-z0-9]+/', ' ', strtolower($text)));
}

function binder_offer_set_text(string $name): string
{
    $name = binder_offer_text($name);
    $name = (string) preg_replace('/\b(?:1st|first) edition\b|\bunlimited\b|\bshadowless\b/', '', $name);
    $name = (string) preg_replace('/^(?:pokemon\s+)?(?:swsh|sv|xy|sm|bw|me)\d*\s+/', '', $name);
    $name = trim((string) preg_replace('/\s+/', ' ', $name));
    if (!str_contains($name, 'promo')) {
        $name = (string) preg_replace('/^(?:scarlet and violet|sword and shield|sun and moon|black and white)\s+/', '', $name);
    }
    return $name;
}

function binder_offer_number(string $value): string
{
    return (string) preg_replace_callback('/\d+/', static fn(array $part): string => ltrim($part[0], '0') ?: '0', strtolower($value));
}

function binder_offer_finish(string $label): ?string
{
    $label = binder_offer_text($label);
    if (preg_match('/\breverse(?: holofoil| holo| foil)?\b/', $label)) {
        return 'reverse';
    }
    if (preg_match('/\b(?:non holo(?:foil)?|non foil|regular|normal)\b/', $label)) {
        return 'normal';
    }
    return preg_match('/\b(?:holofoil|holo|foil)\b/', $label) ? 'holo' : null;
}

function binder_offer_condition(array $variant): ?array
{
    $labels = [];
    foreach (is_array($variant['options'] ?? null) ? $variant['options'] : [] as $option) {
        if (is_array($option) && is_string($option['name'] ?? null) && is_string($option['label'] ?? null)
            && in_array(binder_offer_text($option['name']), ['condition', 'title'], true)) {
            $labels[] = binder_offer_text($option['label']);
        }
    }
    if (is_string($variant['title'] ?? null)) {
        $labels[] = binder_offer_text($variant['title']);
    }
    foreach ($labels as $label) {
        foreach ([
            'Near Mint' => [0, 'near mint|nm'],
            'Lightly Played' => [1, 'lightly played|light played|light play|lp'],
            'Slightly Played' => [1, 'slightly played|slight play|sp'],
            'Moderately Played' => [2, 'moderately played|moderate play|mp'],
            'Heavily Played' => [3, 'heavily played|heavy play|hp'],
            'Damaged' => [4, 'damaged|dmg'],
        ] as $condition => [$rank, $pattern]) {
            if (preg_match('/^(?:' . $pattern . ')(?:$| )/', $label)) {
                return ['condition' => $condition, 'conditionRank' => $rank];
            }
        }
    }
    return null;
}

function binder_offer_matches(array $target, array $product, array $variant): bool
{
    $title = $product['title'] ?? '';
    if (!is_string($title)) {
        return false;
    }
    $card = $target['card'];
    $set = $target['set'];
    $number = binder_offer_number($card['number']);
    $targetName = binder_offer_text($card['name']);
    // The first collector number belongs to the named card, before the expansion or condition.
    preg_match_all('/(?:^|[\s(#–—-])([A-Za-z]*\d+[A-Za-z]*)(?:\s*\/\s*([A-Za-z]*\d+[A-Za-z]*))?(?=[\s)\]–—-]|$)/u', $title, $numbers, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
    $match = array_find($numbers, static fn(array $candidate): bool =>
        binder_offer_text(substr($title, 0, $candidate[1][1])) === $targetName
        && binder_offer_number($candidate[1][0]) === $number);
    if ($match === null) {
        return false;
    }
    $denominator = $match[2][0] ?? '';
    if ($denominator !== '' && ctype_digit($card['number']) && isset($set['printedTotal'])
        && binder_offer_number($denominator) !== (string) $set['printedTotal']) {
        return false;
    }

    $description = $product['description']['html'] ?? $product['description']['plain'] ?? '';
    $description = is_string($description) ? $description : '';
    $descriptionText = html_entity_decode((string) preg_replace('/<[^>]+>/', ' ', $description), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $matchingSet = binder_offer_set_text($set['name']);
    $sets = [];
    preg_match_all('/\[([^\]]+)\]/u', $title, $brackets);
    array_push($sets, ...$brackets[1]);
    if (preg_match('/\bfrom ([^,]+),\s+available at\b/i', $descriptionText, $source)) {
        if (binder_offer_set_text($source[1]) !== $matchingSet) {
            return false;
        }
        if (!$sets) {
            $sets[] = $source[1];
        }
    }
    if (!$sets) {
        foreach (is_array($product['collections'] ?? null) ? $product['collections'] : [] as $collection) {
            if (is_array($collection) && is_string($collection['title'] ?? null)) {
                $sets[] = $collection['title'];
            }
        }
    }
    if (!in_array($matchingSet, array_map('binder_offer_set_text', $sets), true)) {
        return false;
    }

    $basePrinting = explode('+', $target['variant']['id']);
    $expectedFinish = array_shift($basePrinting);
    $productLabel = binder_offer_text(substr($title, $match[1][1]));
    $variantLabel = is_string($variant['title'] ?? null) ? binder_offer_text($variant['title']) : '';
    $optionLabels = [];
    $finishLabels = [$variantLabel];
    foreach (is_array($variant['options'] ?? null) ? $variant['options'] : [] as $option) {
        if (!is_array($option) || !is_string($option['name'] ?? null) || !is_string($option['label'] ?? null)) {
            continue;
        }
        $field = binder_offer_text($option['name']);
        $label = binder_offer_text($option['label']);
        if ($field === 'language' && !in_array($label, ['en', 'english'], true)) {
            return false;
        }
        if (in_array($field, ['title', 'finish', 'printing', 'edition', 'language'], true)) {
            $optionLabels[] = $label;
        }
        if (in_array($field, ['title', 'finish', 'printing'], true)) {
            $finishLabels[] = $label;
        }
    }
    if (preg_match('/\bLanguage\s*:\s*([a-z]+)/i', $descriptionText, $language)
        && !in_array(strtolower($language[1]), ['en', 'english'], true)) {
        return false;
    }
    $identifiers = implode(' ', [$productLabel, $variantLabel, ...$optionLabels]);
    if (preg_match('/\b(?:japan(?:ese)?|jpn|jp|simplified|traditional|chinese|korean|thai|indonesian|french|german|spanish|italian|portuguese|dutch|japanese version|foreign|psa|cgc|bgs|graded|jumbo|oversized|sealed|lot|bundle|proxy|orica|replica|misprint|error)\b/', $identifiers)) {
        return false;
    }

    $editionMarkers = [
        'stamp=1st-edition' => '/\b(?:first|1st) edition\b/',
        'subtype=shadowless' => '/\bshadowless\b/',
        'subtype=unlimited' => '/\bunlimited\b/',
        'subtype=1999-2000-copyright' => '/\b1999 2000\b/',
        'foil=pokeball' => '/\b(?:poke ball|pokeball)\b/',
        'foil=masterball' => '/\b(?:master ball|masterball)\b/',
        'foil=cosmos' => '/\b(?:cosmos|cosmic)\b/',
        'foil=cracked-ice' => '/\bcracked ice\b/',
        'stamp=set-logo' => '/\b(?:set logo|set stamped)\b/',
        'stamp=staff' => '/\bstaff\b/',
        'stamp=pre-release' => '/\b(?:prerelease|pre release)\b/',
        'stamp=pokemon-center' => '/\bpokemon center\b/',
        'stamp=gamestop' => '/\bgamestop\b/',
        'stamp=best-buy' => '/\bbest buy\b/',
        'stamp=eb-games' => '/\beb games\b/',
    ];
    $expectsVintageEdition = false;
    foreach ($card['variants'] as $printing) {
        if (str_contains($printing['id'], 'stamp=1st-edition')) {
            $expectsVintageEdition = true;
        }
    }
    if ($expectsVintageEdition && !$basePrinting) {
        $basePrinting[] = 'subtype=unlimited';
    }
    $seenMarkers = [];
    foreach ($editionMarkers as $marker => $pattern) {
        if (preg_match($pattern, $identifiers)) {
            $seenMarkers[] = $marker;
            $identifiers = (string) preg_replace($pattern, '', $identifiers);
        }
    }
    sort($seenMarkers);
    sort($basePrinting);
    if ($seenMarkers !== $basePrinting || preg_match('/\b(?:stamped|stamp|exclusive|league|prize pack|world championships|collector edition|alt art|celebrations classic collection|rainbow|gold foil|shiny vault|texture|textured)\b/', $identifiers)) {
        return false;
    }
    if (preg_match('/\bpromo\b/', $identifiers) && !str_contains($matchingSet, 'promo') && !$basePrinting) {
        return false;
    }

    // A reverse listing can have a Holo Rare rarity. Compare actual finish labels independently.
    $finishLabels[] = (string) preg_replace('/\bholo(?:foil)? rare\b/', ' ', $productLabel);
    if (preg_match('/\bFinish\s*:\s*([^\r\n]{1,65}?)(?=\s+(?:Artist|Card Text|Language|Rarity)\s*:|\R|$)/i', $descriptionText, $label)) {
        $finishLabels[] = $label[1];
    }
    $finishes = array_unique(array_filter(array_map('binder_offer_finish', $finishLabels)));
    if (!$finishes) {
        $finishes = array_unique(array_map(static fn(array $entry): string => explode('+', $entry['id'], 2)[0], $card['variants']));
    }
    return count($finishes) === 1 && reset($finishes) === $expectedFinish;
}

function binder_offer_rows(array $target, array $store, array $products, int $checkedAt): array
{
    $offers = [];
    foreach ($products as $product) {
        if (!is_array($product) || !is_string($product['url'] ?? null) || ($product['gift_card'] ?? false) === true) {
            continue;
        }
        $url = parse_url($product['url']);
        if (($url['scheme'] ?? '') !== 'https' || !in_array($url['host'] ?? '', $store['hosts'], true)
            || isset($url['user']) || isset($url['pass']) || isset($url['port'])
            || !preg_match('/^\/products\/[a-zA-Z0-9_-]+\/?$/D', $url['path'] ?? '')) {
            continue;
        }
        parse_str($url['query'] ?? '', $query);
        $attribution = array_filter(array_intersect_key($query, ['shcgid' => true, 'shclid' => true]), 'is_string');
        foreach (is_array($product['variants'] ?? null) ? $product['variants'] : [] as $variant) {
            if (!is_array($variant) || ($variant['availability']['available'] ?? false) !== true
                || ($variant['price']['currency'] ?? '') !== 'CAD' || !is_int($variant['price']['amount'] ?? null)
                || $variant['price']['amount'] < 1 || !binder_offer_matches($target, $product, $variant)) {
                continue;
            }
            $condition = binder_offer_condition($variant);
            if ($condition !== null) {
                $productUrl = 'https://' . $url['host'] . $url['path'];
                $parameters = $attribution;
                $variantId = $variant['id'] ?? '';
                if (is_string($variantId) && preg_match('/^gid:\/\/shopify\/ProductVariant\/([0-9]{1,20})$/D', $variantId, $id)) {
                    $parameters['variant'] = $id[1];
                }
                if ($parameters) {
                    $productUrl .= '?' . http_build_query($parameters, '', '&', PHP_QUERY_RFC3986);
                }
                $offers[] = [
                    'store' => $store['name'],
                    'priceCents' => $variant['price']['amount'],
                    'currency' => 'CAD',
                    'checkedAt' => gmdate(DATE_ATOM, $checkedAt),
                    'url' => $productUrl,
                    ...$condition,
                ];
            }
        }
    }
    return $offers;
}

function binder_offer_query(array $target): string
{
    $set = $target['set'];
    $number = $target['card']['number'];
    if (ctype_digit($number) && isset($set['printedTotal'])) {
        $number .= '/' . $set['printedTotal'];
    }
    $name = $set['id'] === 'sv03.5' ? 'Scarlet & Violet 151' : $set['name'];
    $label = $target['variant']['label'];
    return $target['card']['name'] . ' ' . $number . ' ' . $name . ' ' . $label;
}

function binder_offer_payload(string $query, string $profile): string
{
    return json_encode([
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'tools/call',
        'params' => [
            'name' => 'search_catalog',
            'arguments' => [
                'meta' => ['ucp-agent' => ['profile' => $profile]],
                'catalog' => [
                    'query' => $query,
                    'context' => ['address_country' => 'CA', 'currency' => 'CAD', 'language' => 'en'],
                    'pagination' => ['limit' => 15],
                ],
            ],
        ],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

function binder_offer_products(string $body): ?array
{
    if (!str_starts_with(ltrim($body), '{')) {
        preg_match('/^data:\s*({[^\r\n]+})\s*$/m', $body, $event);
        $body = $event[1] ?? '';
    }
    $envelope = json_decode($body, true, 64);
    if (!is_array($envelope) || isset($envelope['error']) || ($envelope['result']['isError'] ?? false)) {
        return null;
    }
    $data = $envelope['result']['structuredContent'] ?? null;
    if ($data === null && is_string($envelope['result']['content'][0]['text'] ?? null)) {
        $data = json_decode($envelope['result']['content'][0]['text'], true, 64);
    }
    return ($data['ucp']['status'] ?? null) === 'success' && is_array($data['products'] ?? null) ? $data['products'] : null;
}

function binder_offer_headers(?array $auth): array
{
    $headers = [
        'Content-Type: application/json',
        'Accept: application/json, text/event-stream',
        'MCP-Protocol-Version: 2025-11-25',
        'Mcp-Method: tools/call',
        'Mcp-Name: search_catalog',
        'User-Agent: PokemonBinderTracker/1.0 (+https://austingarrod.ca/utilities/pokemon-binder/)',
    ];
    if ($auth !== null) {
        $headers[] = 'Authorization: Bearer ' . $auth['token'];
        $headers[] = 'Shopify-Buyer-IP: ' . $auth['buyerIp'];
    }
    return $headers;
}

function binder_offer_fetch(array $stores, string $query, string $profile, ?array $auth): array
{
    if (!function_exists('curl_multi_init')) {
        return [];
    }
    $multi = curl_multi_init();
    $body = binder_offer_payload($query, $profile);
    $handles = [];
    $bodies = [];
    $retryHeaders = [];
    $headers = binder_offer_headers($auth);
    $maxBytes = 2_000_000;
    try {
        foreach ($stores as $store) {
            $host = $store['host'];
            $handle = curl_init('https://' . $host . '/api/ucp/mcp');
            if ($handle === false) {
                continue;
            }
            $handles[$host] = $handle;
            $bodies[$host] = '';
            curl_setopt_array($handle, [
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_CONNECTTIMEOUT_MS => 2500,
                CURLOPT_TIMEOUT_MS => 5000,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_ENCODING => '',
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$retryHeaders, $host): int {
                    if (str_starts_with($line, 'HTTP/')) {
                        unset($retryHeaders[$host]);
                    } elseif (strncasecmp($line, 'Retry-After:', 12) === 0 && strlen($line) <= 128) {
                        $retryHeaders[$host] = trim(substr($line, 12));
                    }
                    return strlen($line);
                },
                CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$bodies, $host, $maxBytes): int {
                    $size = strlen($chunk);
                    if (strlen($bodies[$host]) + $size > $maxBytes) {
                        return 0;
                    }
                    $bodies[$host] .= $chunk;
                    return $size;
                },
            ]);
            curl_multi_add_handle($multi, $handle);
        }
        do {
            $status = curl_multi_exec($multi, $running);
            if ($status === CURLM_OK && $running && curl_multi_select($multi, 0.25) === -1) {
                usleep(10000);
            }
        } while ($status === CURLM_OK && $running);

        $results = [];
        while ($message = curl_multi_info_read($multi)) {
            $host = array_search($message['handle'], $handles, true);
            if ($host === false) {
                continue;
            }
            $status = curl_getinfo($message['handle'], CURLINFO_RESPONSE_CODE);
            $results[$host] = [
                'status' => $status,
                'products' => $status === 200 && $message['result'] === CURLE_OK ? binder_offer_products($bodies[$host]) : null,
            ];
            if ($status === 429) {
                $now = time();
                $header = $retryHeaders[$host] ?? null;
                $delay = binder_offer_store_wait($host, $now, true, $header);
                $results[$host]['retryAt'] = $now + ($delay ?? binder_offer_retry_delay($header, $now) ?? 10);
            }
        }
        return $results;
    } finally {
        foreach ($handles as $handle) {
            curl_multi_remove_handle($multi, $handle);
        }
        curl_multi_close($multi);
    }
}

function binder_offer_state_file(string $name)
{
    $directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'austingarrod-binder-offers';
    if (is_link($directory) || (!is_dir($directory) && !@mkdir($directory, 0700) && !is_dir($directory))) {
        return false;
    }
    $file = $directory . DIRECTORY_SEPARATOR . $name;
    return is_link($file) ? false : @fopen($file, 'c+');
}

// Zero reserves a lookup. A positive delay means the window is full, while null means the limiter is unavailable.
function binder_offer_reserve(int $now): ?int
{
    $handle = binder_offer_state_file('request-rate');
    if ($handle === false) {
        return null;
    }
    try {
        if (!flock($handle, LOCK_EX)) {
            return null;
        }
        $timestamps = array_filter(
            preg_split('/\R/', trim((string) stream_get_contents($handle, 1024))) ?: [],
            static fn(string $stamp): bool => ctype_digit($stamp) && (int) $stamp > $now - BINDER_OFFER_RATE_WINDOW
        );
        if (count($timestamps) >= BINDER_OFFER_RATE_LIMIT) {
            $remaining = (int) min($timestamps) + BINDER_OFFER_RATE_WINDOW - $now;
            return max(1, min(BINDER_OFFER_RATE_WINDOW, $remaining));
        }
        $timestamps[] = (string) $now;
        $content = implode("\n", $timestamps);
        return ftruncate($handle, 0) && rewind($handle) && fwrite($handle, $content) === strlen($content) ? 0 : null;
    } finally {
        fclose($handle);
    }
}

function binder_offer_retry_delay(?string $header, int $now): ?int
{
    if ($header === null || $header === '' || str_contains($header, "\0")) {
        return null;
    }
    if (ctype_digit($header)) {
        return max(1, min((int) $header, PHP_INT_MAX - $now));
    }
    $date = DateTimeImmutable::createFromFormat(DATE_RFC7231, $header, new DateTimeZone('UTC'));
    if ($date === false || DateTimeImmutable::getLastErrors() !== false) {
        return null;
    }
    return max(1, $date->getTimestamp() - $now);
}

// The store cooldown is shared across workers and independent of the keyless request budget.
function binder_offer_store_wait(string $host, int $now, bool $throttled = false, ?string $header = null): ?int
{
    $handle = binder_offer_state_file('retry-' . hash('sha256', $host));
    if ($handle === false) {
        return null;
    }
    try {
        if (!flock($handle, $throttled ? LOCK_EX : LOCK_SH)) {
            return null;
        }
        $raw = stream_get_contents($handle, 128);
        $state = $raw === false || $raw === '' ? [] : json_decode($raw, true);
        $until = (int) ($state['until'] ?? 0);
        if (!$throttled) {
            return max(0, $until - $now);
        }
        $attempt = $until >= $now - 300 ? min(6, (int) ($state['attempt'] ?? 0) + 1) : 1;
        $delay = binder_offer_retry_delay($header, $now) ?? min(300, 10 * (2 ** ($attempt - 1)) + random_int(0, 3));
        $until = max($until, $now + $delay);
        $content = json_encode(['until' => $until, 'attempt' => $attempt], JSON_THROW_ON_ERROR);
        if (ftruncate($handle, 0) && rewind($handle) && fwrite($handle, $content) === strlen($content)) {
            return $until - $now;
        }
        return null;
    } finally {
        fclose($handle);
    }
}

function binder_offer_stores(mixed $requested): ?array
{
    if ($requested === null) {
        return BINDER_OFFER_STORES;
    }
    if (!is_string($requested) || strlen($requested) > 80) {
        return null;
    }
    $names = explode(',', $requested);
    $stores = array_values(array_filter(BINDER_OFFER_STORES, static fn(array $store): bool => in_array($store['name'], $names, true)));
    return count($stores) === count($names) ? $stores : null;
}

function binder_offer_result(array $checks, int $retryAfter = 0, array $stores = BINDER_OFFER_STORES, array $waiting = []): array
{
    $offers = [];
    $unavailable = [];
    $checked = [];
    $storeRetryAfter = [];
    $now = time();
    foreach ($stores as $store) {
        $host = $store['host'];
        $name = $store['name'];
        $check = $checks[$host] ?? null;
        if ($check === null) {
            if (isset($waiting[$host])) {
                $storeRetryAfter[$name] = max(1, min(86400, $waiting[$host] - $now));
            } elseif ($retryAfter === 0) {
                $unavailable[] = $name;
            }
            continue;
        }
        // A cache hit must report when the store was checked, including for an empty result.
        $checked[$name] = gmdate(DATE_ATOM, $check['expiresAt'] - BINDER_OFFER_TTL);
        array_push($offers, ...$check['offers']);
    }
    usort($offers, static fn(array $left, array $right): int =>
        [$left['conditionRank'], $left['priceCents'], $left['store']] <=> [$right['conditionRank'], $right['priceCents'], $right['store']]);
    return [
        'offers' => array_values(array_unique($offers, SORT_REGULAR)),
        'unavailableStores' => $unavailable,
        'checkedStores' => (object) $checked,
    ] + ($retryAfter > 0 ? ['retryAfter' => $retryAfter] : [])
        + ($storeRetryAfter === [] ? [] : ['storeRetryAfter' => (object) $storeRetryAfter]);
}

function binder_offer_lookup(array $target, string $profile = BINDER_OFFER_PROFILE, array $stores = BINDER_OFFER_STORES): array
{
    if (!preg_match('/^(?:normal|holo|reverse)(?:\+|$)/', $target['variant']['id'])) {
        return ['offers' => [], 'unavailableStores' => [], 'checkedStores' => (object) []];
    }
    $useCache = $profile === BINDER_OFFER_PROFILE && function_exists('apcu_enabled') && apcu_enabled();
    $key = hash('sha256', implode('|', [$target['set']['digest'], $target['card']['number'], $target['variant']['id']]));
    $fresh = time();
    $checks = [];
    $lookup = [];
    $waiting = [];
    foreach ($stores as $store) {
        $host = $store['host'];
        $cacheKey = 'pokemon-binder-offers:v1:' . $host . ':' . $key;
        $cached = $useCache ? apcu_fetch($cacheKey) : false;
        if (is_array($cached) && $cached['expiresAt'] > $fresh) {
            $checks[$host] = $cached;
            continue;
        }
        $delay = binder_offer_store_wait($host, $fresh);
        if ($delay === 0) {
            $lookup[$cacheKey] = $store;
        } elseif ($delay !== null) {
            $waiting[$host] = $fresh + $delay;
        }
    }
    if (!$lookup) {
        return binder_offer_result($checks, 0, $stores, $waiting);
    }
    $auth = $profile === BINDER_OFFER_PROFILE ? binder_shopify_auth() : null;
    if ($auth === null) {
        $delay = binder_offer_reserve(time());
        if ($delay !== 0) {
            return binder_offer_result($checks, $delay ?? 0, $stores, $waiting);
        }
    }
    $query = binder_offer_query($target);
    $results = binder_offer_fetch($lookup, $query, $profile, $auth);
    if ($auth !== null) {
        $rejected = array_filter($lookup, static fn(array $store): bool => ($results[$store['host']]['status'] ?? 0) === 401);
        if ($rejected && ($renewed = binder_shopify_auth($auth['token'])) !== null) {
            $retry = array_filter($rejected, static fn(array $store): bool => binder_offer_store_wait($store['host'], time()) === 0);
            if ($retry) {
                $results = array_replace($results, binder_offer_fetch($retry, $query, $profile, $renewed));
            }
        }
    }
    foreach ($lookup as $cacheKey => $store) {
        $host = $store['host'];
        $response = $results[$host] ?? [];
        if (isset($response['retryAt'])) {
            $waiting[$host] = $response['retryAt'];
            continue;
        }
        $rows = $response['products'] ?? null;
        if ($rows === null) {
            continue;
        }
        $check = ['offers' => binder_offer_rows($target, $store, $rows, $fresh), 'expiresAt' => $fresh + BINDER_OFFER_TTL];
        $checks[$host] = $check;
        if ($useCache) {
            apcu_store($cacheKey, $check, BINDER_OFFER_TTL);
        }
    }
    return binder_offer_result($checks, 0, $stores, $waiting);
}
