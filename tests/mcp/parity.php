<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2).'/public/api/v1/_mcp-write.php';

$cases = json_decode(stream_get_contents(STDIN), false, 64, JSON_THROW_ON_ERROR);
$map = $cases->map;
$catalog = $cases->catalog;
$result = [];
foreach ($cases->scenarios as $scenario) {
    $profile = $scenario->progress->ascension;
    $visible = slayer_visible($map, $catalog, $scenario->progress);
    try {
        $actual = match ($scenario->action) {
            'visible' => array_map('array_keys', $visible),
            'recommend' => slayer_recommend($map, $profile, $cases->priorities, $visible['ascension'] ?? [], 12),
            'buy' => slayer_purchase($map, $profile, $scenario->id, $scenario->choices, $visible),
            'remove' => slayer_remove($map, $profile, $scenario->id, $scenario->milestone ?? false),
            'activate' => slayer_activate(array_column($map->upgrades, null, 'id')[$scenario->id], $profile),
            'portable' => mcp_check_portable_size($scenario->progress),
            'reset' => slayer_reset($map, $catalog, $cases->rules, $scenario->progress),
            'observe' => mcp_observe($map, $scenario->progress, $visible, $scenario->input, $scenario->observedAt),
        };
        $result[] = match ($scenario->action) {
            'buy', 'remove', 'activate' => ['kind' => 'ready', 'profile' => $profile],
            'portable' => ['ok' => true],
            'reset' => ['ok' => true, 'progress' => $scenario->progress, 'warnings' => $actual],
            'observe' => ['ok' => true, 'progress' => $scenario->progress],
            'visible' => (object)$actual,
            'recommend' => array_intersect_key($actual, array_fill_keys(['status', 'suggestions', 'visibleUnownedCount', 'readyCount', 'wikiReadyCount', 'unrankedReadyCount'], true)),
        };
    } catch (AccountsError $error) {
        $result[] = match ($scenario->action) {
            'reset', 'portable' => ['ok' => false],
            default => $error->errorCode === 'prerequisite_choice' ? ['kind' => 'choice', 'key' => $error->extra['choiceKey'], 'options' => count($error->extra['options'])] : ['kind' => 'blocked'],
        };
    }
}

echo accounts_encode($result);
