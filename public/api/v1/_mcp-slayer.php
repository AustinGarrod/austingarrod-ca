<?php

declare(strict_types=1);

function mcp_decimal_cmp(string $a, string $b): int
{
    return strlen($a) <=> strlen($b) ?: strcmp($a, $b);
}

/** Arbitrary precision unsigned decimal addition without relying on a host PHP extension. */
function mcp_decimal_add(string $a, string $b): string
{
    $result = '';
    $carry = 0;
    for ($i = strlen($a) - 1, $j = strlen($b) - 1; $i >= 0 || $j >= 0 || $carry; --$i, --$j) {
        $sum = ($i < 0 ? 0 : (int)$a[$i]) + ($j < 0 ? 0 : (int)$b[$j]) + $carry;
        $result .= (string)($sum % 10);
        $carry = intdiv($sum, 10);
    }
    return strrev($result);
}

function slayer_gate(stdClass $rule, stdClass $profile): bool
{
    return match ($rule->kind) {
        'always' => true,
        'ultra-ascended' => $profile->epoch > 0,
        'all' => array_all($rule->requirements, fn($child) => slayer_gate($child, $profile)),
        'any' => array_any($rule->requirements, fn($child) => slayer_gate($child, $profile)),
        'owned' => isset($profile->purchases->{$rule->id}),
        'active' => ($profile->purchases->{$rule->id}->active ?? null) === true,
        'milestone' => ($profile->milestones->{$rule->id} ?? null) === true,
        default => throw new RuntimeException('Unsupported Ascension rule.'),
    };
}

function slayer_record(stdClass $progress, string $system, string $id): stdClass
{
    $record = clone ($progress->modules->{$system}->records->{$id} ?? new stdClass());
    if (in_array($system, ['craft', 'village'], true)) {
        if (isset($progress->ascension->milestones->{$id})) {
            $record->completed = true;
        } elseif (property_exists($record, 'completed')) {
            $record->completed = false;
        }
    }
    return $record;
}

function slayer_normalize_shared(stdClass $progress): void
{
    foreach (['craft', 'village'] as $system) {
        foreach ($progress->modules->{$system}->records as $id => $record) {
            if (($record->completed ?? null) === true) {
                $progress->ascension->milestones->{$id} = true;
                $record->completed = false;
            }
        }
    }
}

function slayer_companion_gate(stdClass $rule, stdClass $progress): ?bool
{
    if (in_array($rule->kind, ['all', 'any'], true)) {
        $children = array_map(fn($child) => slayer_companion_gate($child, $progress), $rule->requirements);
        $target = $rule->kind === 'any';
        return in_array($target, $children, true) ? $target : (in_array(null, $children, true) ? null : !$target);
    }
    if ($rule->kind === 'always') {
        return true;
    }
    if ($rule->kind === 'ascension') {
        return slayer_gate($rule->requirement, $progress->ascension);
    }
    if ($rule->kind !== 'entity') {
        return null;
    }
    $id = $rule->ref->id;
    if ($rule->ref->system === 'ascension') {
        $purchase = $progress->ascension->purchases->{$id} ?? null;
        $result = $rule->field === 'active' ? ($purchase->active ?? false) : ($purchase !== null || isset($progress->ascension->milestones->{$id}));
        return $result === ($rule->value ?? true);
    }
    $actual = slayer_record($progress, $rule->ref->system, $id)->{$rule->field} ?? null;
    if ($actual === null) {
        return null;
    }
    $target = $rule->value ?? true;
    return is_string($target) ? is_string($actual) && mcp_decimal_cmp($actual, $target) >= 0 : $actual === $target;
}

function slayer_visible(stdClass $map, stdClass $catalog, stdClass $progress): array
{
    $profile = $progress->ascension;
    $entries = [];
    foreach ($map->upgrades as $item) {
        if ($profile->showSpoilers || slayer_gate($item->reveal, $profile)) {
            $entries['ascension'][$item->id] = $item;
        }
    }
    foreach ($map->milestones as $item) {
        if ($profile->showSpoilers || slayer_gate($item->reveal, $profile)) {
            $entries['milestone'][$item->id] = $item;
        }
    }
    foreach ($catalog->entities as $item) {
        if ($profile->showSpoilers || slayer_companion_gate($item->reveal, $progress) === true) {
            $entries[$item->system][$item->id] = $item;
        }
    }
    return $entries;
}

function slayer_purchase(stdClass $map, stdClass $profile, string $id, stdClass $choices, array $visible): void
{
    $nodes = array_column($map->upgrades, null, 'id');
    $visiting = [];
    $purchase = function (string $target) use (&$purchase, &$requirement, &$visiting, $nodes, $profile) {
        if (isset($profile->purchases->{$target})) {
            return;
        }
        $node = $nodes[$target] ?? null;
        if ($node === null || isset($visiting[$target])) {
            accounts_fail(422, 'blocked', 'The catalog has an unresolved prerequisite.');
        }
        $visiting[$target] = true;
        $requirement($node->purchase, $target.'/purchase');
        if (!slayer_gate($node->reveal, $profile)) {
            accounts_fail(422, 'blocked', 'Record the required item or activation before continuing.');
        }
        $profile->purchases->{$target} = (object)['epoch' => $profile->epoch, 'active' => $node->activation === 'immediate'];
        unset($visiting[$target]);
    };
    $requirement = function (stdClass $rule, string $path) use (&$requirement, $purchase, $profile, $choices, $visible) {
        if (slayer_gate($rule, $profile)) {
            return;
        }
        switch ($rule->kind) {
            case 'all':
                foreach ($rule->requirements as $index => $child) {
                    $requirement($child, $path.'/'.$index);
                }
                return;
            case 'any':
                $choiceKey = hash('sha256', $path);
                $choice = $choices->{$choiceKey} ?? null;
                if (!is_int($choice) || !isset($rule->requirements[$choice])) {
                    accounts_fail(422, 'prerequisite_choice', 'Choose an alternative prerequisite before previewing the purchase.',
                        ['choiceKey' => $choiceKey, 'options' => array_map(fn($child) => slayer_describe_gate($child, $visible), $rule->requirements)]);
                }
                $requirement($rule->requirements[$choice], $path.'/'.$choice);
                return;
            case 'owned':
                $purchase($rule->id);
                return;
            case 'active':
                $purchase($rule->id);
                if (slayer_gate($rule, $profile)) {
                    return;
                }
                accounts_fail(422, 'blocked', 'Record this upgrade’s activation explicitly before continuing.');
            case 'ultra-ascended':
                accounts_fail(422, 'blocked', 'Record an Ultra Ascension before continuing.');
            default:
                accounts_fail(422, 'blocked', 'Record the required item in Milestones before continuing.');
        }
    };
    $purchase($id);
}

function slayer_describe_gate(stdClass $rule, array $visible): string
{
    return match ($rule->kind) {
        'all', 'any' => '('.implode($rule->kind === 'all' ? ' and ' : ' or ', array_map(fn($item) => slayer_describe_gate($item, $visible), $rule->requirements)).')',
        'owned', 'active' => ($rule->kind === 'active' ? 'Activate ' : 'Own ').($visible['ascension'][$rule->id]->title ?? 'an unrevealed upgrade'),
        'milestone' => 'Record '.($visible['milestone'][$rule->id]->title ?? 'an unrevealed milestone'),
        'ultra-ascended' => 'Complete an Ultra Ascension',
        default => 'No additional requirement',
    };
}

function slayer_remove(stdClass $map, stdClass $profile, string $id, bool $milestone = false): void
{
    $retentionTargets = [];
    foreach ($map->grants as $grant) {
        foreach ($grant->ids as $target) {
            $retentionTargets[$target] = true;
        }
    }
    if ($milestone) {
        unset($profile->milestones->{$id});
    } else {
        unset($profile->purchases->{$id});
    }
    do {
        $changed = false;
        foreach ($map->upgrades as $node) {
            $purchase = $profile->purchases->{$node->id} ?? null;
            if ($purchase === null || ($purchase->epoch < $profile->epoch && ($node->retention !== 'repeat' || isset($retentionTargets[$node->id])))) {
                continue;
            }
            if (!slayer_gate($node->purchase, $profile)) {
                unset($profile->purchases->{$node->id});
                $changed = true;
            }
        }
    } while ($changed);
}

function slayer_activate(stdClass $node, stdClass $profile): void
{
    $purchase = $profile->purchases->{$node->id} ?? null;
    if ($purchase === null || $node->activation !== 'after-ultra-ascension' || $node->retention === 'repeat' || $purchase->active || $profile->epoch === 0) {
        accounts_fail(422, 'blocked', 'Only a recorded, inactive Astral lock can be activated after a previous Ultra Ascension.');
    }
    $purchase->epoch = min($purchase->epoch, $profile->epoch - 1);
    $purchase->active = true;
}

function slayer_reset_tree(stdClass $map, stdClass $profile): void
{
    if ($profile->epoch >= 9007199254740991 || !slayer_gate($map->ultraAscension, $profile)) {
        accounts_fail(422, 'blocked', 'The recorded profile does not meet the requirements for another Ultra Ascension.');
    }
    foreach ($map->upgrades as $node) {
        if (isset($profile->purchases->{$node->id}) && $node->retention !== 'repeat' && $node->activation === 'after-ultra-ascension') {
            $profile->purchases->{$node->id}->active = true;
        }
    }
    $retained = [];
    foreach ($map->grants as $grant) {
        if (slayer_gate($grant->when, $profile)) {
            foreach ($grant->ids as $id) {
                $retained[$id] = true;
            }
        }
    }
    foreach ($map->upgrades as $node) {
        if ($node->retention === 'repeat' && !isset($retained[$node->id])) {
            unset($profile->purchases->{$node->id});
        }
    }
    ++$profile->epoch;
}

function slayer_recommend(stdClass $map, stdClass $profile, stdClass $priorities, array $visible, int $limit): array
{
    $rows = [];
    foreach ($priorities->rows as $row) {
        if ($row->priority >= 0 && (!isset($rows[$row->id]) || $row->priority < $rows[$row->id]->priority)) {
            $rows[$row->id] = $row;
        }
    }
    $remaining = array_filter($visible, fn($item) => !isset($profile->purchases->{$item->id}));
    $ready = array_filter($remaining, fn($item) => slayer_gate($item->reveal, $profile) && slayer_gate($item->purchase, $profile));
    $ranked = array_filter($ready, fn($item) => isset($rows[$item->id]));
    $pool = $ranked ?: $ready;
    usort($pool, function ($a, $b) use ($rows, $ranked) {
        return ($ranked ? ($rows[$a->id]->priority <=> $rows[$b->id]->priority) : 0)
            ?: mcp_decimal_cmp($a->cost, $b->cost) ?: strcmp($a->id, $b->id);
    });
    return [
        'status' => $ranked ? 'wiki' : ($ready ? 'fallback' : (($remaining || !$visible) ? 'blocked' : 'all-owned')),
        'suggestions' => array_map(function ($item) use ($rows) {
            $row = $rows[$item->id] ?? null;
            return ['id' => $item->id, 'title' => $item->title, 'cost' => $item->cost, 'activation' => $item->activation,
                'basis' => $row === null ? 'catalog-cost-fallback' : 'wiki', 'priority' => $row->priority ?? null,
                'tier' => $row->tier ?? null, 'sourceUrl' => $row->url ?? null];
        }, array_slice($pool, 0, $limit)),
        'visibleUnownedCount' => count($remaining),
        'readyCount' => count($ready),
        'wikiReadyCount' => count($ranked),
        'unrankedReadyCount' => count($ready) - count($ranked),
        'guideGameVersion' => $priorities->source->gameVersion,
        'gameVersion' => $map->gameVersion,
        'note' => 'Suggestions use recorded prerequisites. Affordability and optimal routes depend on player resources and goals.',
    ];
}
