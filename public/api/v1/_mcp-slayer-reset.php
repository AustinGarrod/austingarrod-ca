<?php

declare(strict_types=1);

require_once __DIR__.'/_mcp-slayer.php';

/** Mirrors planCompanionUltraAscension. The PHP/TypeScript parity suite guards both projections. */
function slayer_reset(stdClass $map, stdClass $catalog, stdClass $rules, stdClass $progress): array
{
    if ($map->gameVersion !== $rules->gameVersion || $map->steamBuild !== $rules->steamBuild
        || $catalog->gameVersion !== $rules->gameVersion || $catalog->steamBuild !== $rules->steamBuild
        || !$map->verification->resetRules) {
        accounts_fail(422, 'reset_unavailable', 'These catalogs do not have reviewed Ultra Ascension rules.');
    }
    $before = clone $progress->ascension;
    $before->purchases = clone $before->purchases;
    slayer_reset_tree($map, $progress->ascension);
    $known = [];
    foreach ($catalog->entities as $item) {
        $known[$item->system][$item->id] = true;
    }
    $quests = array_column($rules->quests, null, 'id');
    $shop = array_column($rules->upgrades, null, 'id');
    if (array_diff_key($known['quest'] ?? [], $quests, $shop)) {
        accounts_fail(422, 'reset_unavailable', 'A quest reset rule requires review for this catalog.');
    }

    $warnings = [];
    $changed = [];
    $record = function (string $system, string $id, array $patch) use ($progress, $known, &$changed) {
        $module = $progress->modules->{$system};
        if ($module->tracked && isset($known[$system][$id])) {
            $module->records->{$id} = (object)array_replace((array)($module->records->{$id} ?? []), $patch);
            $changed[$system] = true;
        }
    };
    $forget = function (string $system, string $id, array $fields) use ($progress, $known, &$changed) {
        $module = $progress->modules->{$system};
        if ($module->tracked && isset($known[$system][$id], $module->records->{$id})) {
            foreach ($fields as $field) {
                unset($module->records->{$id}->{$field});
            }
            $changed[$system] = true;
        }
    };
    $receipt = function (string $id, bool $owned) use ($record, $progress, $known, $shop) {
        if (isset($known['quest'][$id], $shop[$id])) {
            $record('quest', $id, ['completed' => $owned]);
            return;
        }
        if ($owned) {
            $progress->ascension->milestones->{$id} = true;
        } else {
            unset($progress->ascension->milestones->{$id});
        }
        $record('village', $id, ['completed' => false]);
    };

    foreach ($rules->upgrades as $rule) {
        if (!$rule->retain && (isset($known['village'][$rule->id]) || isset($known['quest'][$rule->id]))) {
            $receipt($rule->id, false);
        }
    }
    if ($progress->modules->quest->tracked) {
        foreach ($rules->quests as $rule) {
            if (!isset($known['quest'][$rule->id]) || $rule->retain === 'always') {
                continue;
            }
            if ($rule->retain === 'reward') {
                $reward = isset($rule->rewardId) ? (slayer_record($progress, 'village', $rule->rewardId)->completed ?? null) : null;
                if ($reward === true) {
                    continue;
                }
                if ($reward === null) {
                    $forget('quest', $rule->id, ['count', 'completed', 'claimed']);
                    $warnings[] = 'Some quest outcomes depend on unrecorded reward ownership. Their progress needs a fresh save or manual observation.';
                    continue;
                }
            }
            $record('quest', $rule->id, ['count' => '0', 'completed' => false, 'claimed' => false]);
        }
    }
    $claimedByReset = false;
    foreach ($rules->questClaims as $rule) {
        if (($progress->ascension->purchases->{$rule->upgradeId}->active ?? null) !== true) {
            continue;
        }
        foreach ($rule->quests as $quest) {
            if (isset($known['village'][$quest->rewardId]) || isset($known['quest'][$quest->rewardId])) {
                $receipt($quest->rewardId, true);
            }
            $record('quest', $quest->id, ['count' => $quest->target, 'completed' => true, 'claimed' => true]);
            $claimedByReset = true;
        }
    }

    $reward = $rules->materialReward;
    $quantity = '0';
    foreach ($reward->upgrades as $source) {
        if (isset($before->purchases->{$source->id})) {
            $quantity = mcp_decimal_add($quantity, $source->quantity);
        }
    }
    $materialAdded = false;
    $overflow = false;
    if ($quantity !== '0') {
        $materialAdded = null;
        if ($progress->modules->material->tracked && isset($known['material'][$reward->id])) {
            $count = slayer_record($progress, 'material', $reward->id)->count ?? null;
            $record('material', $reward->id, ['discovered' => true]);
            if ($count === null) {
                $forget('material', $reward->id, ['count']);
                $warnings[] = 'A material reward has an unrecorded starting quantity. Its resulting quantity needs a fresh save or manual observation.';
            } else {
                $sum = mcp_decimal_add($count, $quantity);
                $aboveMaximum = mcp_decimal_cmp($count, $reward->maximum) > 0;
                $overflow = !$aboveMaximum && mcp_decimal_cmp($sum, $reward->maximum) > 0;
                $next = $aboveMaximum ? $count : ($overflow ? $reward->maximum : $sum);
                $record('material', $reward->id, ['count' => $next]);
                $materialAdded = mcp_decimal_cmp($next, $count) > 0;
            }
        }
    }

    $awarded = false;
    $award = function (string $id) use ($progress, $known, $record, &$awarded) {
        if ($progress->modules->achievement->tracked && isset($known['achievement'][$id])) {
            $previous = slayer_record($progress, 'achievement', $id)->completed ?? null;
            $record('achievement', $id, ['completed' => true]);
            $awarded = $awarded || $previous !== true;
        }
    };
    if ($overflow) {
        $award($reward->overflowAchievementId);
    }
    if ($progress->modules->achievement->tracked) {
        foreach ($rules->achievements as $rule) {
            $previous = slayer_record($progress, 'achievement', $rule->id);
            if ($rule->type === 27) {
                $epoch = (string)$progress->ascension->epoch;
                $record('achievement', $rule->id, ['count' => $epoch]);
                if (mcp_decimal_cmp($epoch, $rule->target) >= 0) {
                    $award($rule->id);
                }
            } elseif ($rule->type === 10 && isset($previous->count)) {
                $record('achievement', $rule->id, ['count' => '0']);
            } elseif ($rule->type === 3 || ($rule->type === 16 && $claimedByReset)) {
                $incomplete = ($previous->completed ?? null) === false;
                $forget('achievement', $rule->id, $incomplete ? ['count', 'completed'] : ['count']);
                if ($incomplete) {
                    $warnings[] = 'Some achievement results depend on game state this companion does not record. Refresh those observations after the reset.';
                }
            }
        }
        $questIds = array_column(array_filter($rules->quests, fn($rule) => $rule->countsForAchievements), 'id');
        $questTotal = slayer_observed_total($progress, 'quest', $questIds, 'claimed');
        $materialTotal = slayer_observed_total($progress, 'material', $rules->materialIds, 'discovered');
        foreach ($rules->achievements as $rule) {
            if ($rule->type !== 17 && $rule->type !== 25) {
                continue;
            }
            $value = $rule->type === 17 ? $questTotal : $materialTotal;
            $event = $rule->type === 17 ? $claimedByReset : $materialAdded;
            if ($value !== null) {
                $record('achievement', $rule->id, ['count' => $value]);
                if ($event === true && mcp_decimal_cmp($value, $rule->target) >= 0) {
                    $award($rule->id);
                }
            } else {
                $incomplete = $event !== false && (slayer_record($progress, 'achievement', $rule->id)->completed ?? null) === false;
                $forget('achievement', $rule->id, $incomplete ? ['count', 'completed'] : ['count']);
                if ($incomplete) {
                    $warnings[] = 'Some achievement results depend on unrecorded quest or material observations. Refresh those observations after the reset.';
                }
            }
        }
        if ($awarded) {
            $total = slayer_observed_total($progress, 'achievement', $rules->achievementIds, 'completed');
            $meta = array_filter($rules->achievements, fn($rule) => $rule->type === 14);
            if ($total === null) {
                foreach ($meta as $rule) {
                    $incomplete = (slayer_record($progress, 'achievement', $rule->id)->completed ?? null) === false;
                    $forget('achievement', $rule->id, $incomplete ? ['count', 'completed'] : ['count']);
                }
                $warnings[] = 'Achievement totals are incomplete. Dependent achievement observations need a fresh save or manual observation.';
            } else {
                do {
                    $previous = $total;
                    foreach ($meta as $rule) {
                        $record('achievement', $rule->id, ['count' => $total]);
                        if (mcp_decimal_cmp($total, $rule->target) >= 0 && (slayer_record($progress, 'achievement', $rule->id)->completed ?? null) !== true) {
                            $award($rule->id);
                            $total = mcp_decimal_add($total, '1');
                        }
                    }
                } while ($total !== $previous && (int)$total <= count($rules->achievementIds));
            }
        }
    }
    foreach (array_keys($known['divinity'] ?? []) as $id) {
        $forget('divinity', $id, ['active']);
    }
    foreach (array_keys($changed) as $system) {
        $progress->modules->{$system}->source = 'reset';
        unset($progress->modules->{$system}->observedAt);
    }
    return array_values(array_unique($warnings));
}

function slayer_observed_total(stdClass $progress, string $system, array $ids, string $field): ?string
{
    if (!$progress->modules->{$system}->tracked) {
        return null;
    }
    $total = 0;
    foreach ($ids as $id) {
        $value = slayer_record($progress, $system, $id)->{$field} ?? null;
        if ($value === null) {
            return null;
        }
        $total += (int)$value;
    }
    return (string)$total;
}
