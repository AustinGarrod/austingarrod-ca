<?php
declare(strict_types=1);

function master_set_index(string $root): array
{
    return array_column(json_decode(file_get_contents($root.'/utilities/pokedex-binder/catalog/master-sets/index.json'), false, 32, JSON_THROW_ON_ERROR), null, 'id');
}

function master_cards(string $root, string $id, array $index): array
{
    if (!isset($index[$id])) accounts_invalid();
    return json_decode(file_get_contents($root.'/utilities/pokedex-binder/catalog/master-sets/'.$id.'.json'), false, 32, JSON_THROW_ON_ERROR);
}

function master_related_sets(string $root, string $id): array
{
    static $catalogs = [];
    if (!isset($catalogs[$root])) {
        $path = $root.'/utilities/pokedex-binder/binder-expansions.json';
        $catalogs[$root] = is_file($path) ? json_decode(file_get_contents($path), true, 16, JSON_THROW_ON_ERROR) : [];
    }
    return $catalogs[$root][$id] ?? [];
}

function master_binder_cards(string $root, string $id, array $index, bool $includeRelated): array
{
    $cards = master_cards($root, $id, $index);
    if (!$includeRelated) return $cards;
    foreach (master_related_sets($root, $id) as $group) {
        foreach (master_cards($root, $group['setId'], $index) as $card) {
            if (isset($group['numbers']) && !in_array($card->number, $group['numbers'], true)) continue;
            if (isset($group['variantId'])) {
                $card->variants = array_values(array_filter($card->variants, fn($v) => $v->id === $group['variantId']));
            }
            if (!$card->variants) continue;
            $card->sourceSetId = $group['setId'];
            $cards[] = $card;
        }
    }
    return $cards;
}

function master_card_prefix(stdClass $card): string
{
    return (isset($card->sourceSetId) ? $card->sourceSetId.'/' : '').$card->number.':';
}

function master_strings(mixed $list, int $max): bool
{
    if (!is_array($list)) return false;
    foreach ($list as $value) {
        if (!is_string($value) || $value === '' || mb_strlen($value) > $max) return false;
    }
    return count($list) === count(array_unique($list));
}

function master_validate(mixed $state, string $root): void
{
    if (!accounts_fields($state, ['schemaVersion','binders']) || $state->schemaVersion !== 1 || !is_array($state->binders)) accounts_invalid();
    $index = master_set_index($root);
    $ids = [];
    $known = [];
    foreach ($state->binders as $b) {
        if (!accounts_fields($b, ['id','name','setId','settings','goal','order','owned','specialties','extras'], ['ordered'])
            || !is_string($b->id) || !preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $b->id) || isset($ids[$b->id])
            || !is_string($b->name) || trim($b->name) === '' || mb_strlen($b->name) > 100 || !is_string($b->setId) || !isset($index[$b->setId])
            || !in_array($b->goal,['numbers','variants'],true) || !in_array($b->order,['together','sections'],true)
            || !master_strings($b->owned,256) || !master_strings($b->specialties,200) || !is_array($b->extras)
            || (property_exists($b,'ordered') && (!master_strings($b->ordered,256) || array_intersect($b->owned,$b->ordered)))) accounts_invalid();
        $ids[$b->id] = true;
        $s = $b->settings;
        if (!accounts_fields($s,['columns','rows','useBackSides','leadingBlankPockets'], ['fillerThrough','includeRelated','sectionLayout'])
            || (property_exists($s,'fillerThrough') && (!is_int($s->fillerThrough) || $s->fillerThrough < 1 || $s->fillerThrough > 9007199254740991))
            || (property_exists($s,'includeRelated') && ($s->includeRelated !== true || !master_related_sets($root,$b->setId)))
            || !is_int($s->columns) || $s->columns < 1 || $s->columns > 6 || !is_int($s->rows) || $s->rows < 1 || $s->rows > 6
            || !is_bool($s->useBackSides) || !is_int($s->leadingBlankPockets) || $s->leadingBlankPockets < 0 || $s->leadingBlankPockets > 1000) accounts_invalid();
        if (property_exists($s,'sectionLayout')) {
            $related = master_related_sets($root,$b->setId);
            if (!$related || !is_array($s->sectionLayout) || !$s->sectionLayout) accounts_invalid();
            $remaining = array_fill_keys([$b->setId,'@extras',...array_column($related,'setId')],true);
            foreach ($s->sectionLayout as $section) {
                if (!accounts_fields($section,['id'],['newPage']) || !is_string($section->id) || !isset($remaining[$section->id])
                    || (property_exists($section,'newPage') && $section->newPage !== true)) accounts_invalid();
                unset($remaining[$section->id]);
            }
        }
        if (!isset($known[$b->setId])) {
            $keys = []; $specialties = [];
            // A disabled checklist can still contain saved marks from its related sets.
            foreach (master_binder_cards($root,$b->setId,$index,true) as $card) {
                $prefix = master_card_prefix($card);
                $keys[$prefix.'*'] = true;
                foreach ($card->variants as $v) {
                    $keys[$prefix.$v->id] = true;
                    if ($v->specialty) {
                        $specialties[$v->id] = true;
                        $specialties[$prefix.$v->id] = true;
                    }
                }
            }
            $known[$b->setId] = [$keys,$specialties];
        }
        [$keys,$specialties] = $known[$b->setId];
        foreach ($b->extras as $e) {
            if (!accounts_fields($e,['id','name','number','required']) || !is_string($e->id) || !preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D',$e->id)
                || isset($keys['extra:'.$e->id]) || !is_string($e->name) || trim($e->name) === '' || mb_strlen($e->name)>100
                || !is_string($e->number) || mb_strlen($e->number)>32 || !is_bool($e->required)) accounts_invalid();
            $keys['extra:'.$e->id] = true;
        }
        foreach (array_merge($b->owned,$b->ordered ?? []) as $key) if (!isset($keys[$key])) accounts_invalid();
        foreach ($b->specialties as $key) if (!isset($specialties[$key])) accounts_invalid();
    }
}

function binder_card_status(bool $owned, bool $ordered): string
{
    return $owned ? 'owned' : ($ordered ? 'ordered' : 'missing');
}

function master_slots(stdClass $b, array $cards): array
{
    $main = []; $parallel = []; $related = []; $owned = array_fill_keys($b->owned,true);
    $ordered = array_fill_keys($b->ordered ?? [],true);
    foreach ($cards as $card) {
        $prefix = master_card_prefix($card);
        $singleRelatedPrinting = isset($card->sourceSetId) && count($card->variants) === 1;
        $variants = array_values(array_filter($card->variants,fn($v)=>$singleRelatedPrinting || !$v->specialty || in_array($v->id,$b->specialties,true) || in_array($prefix.$v->id,$b->specialties,true)));
        $singleFinish = count($variants) <= 1;
        $any = $b->goal === 'numbers' || !$variants;
        if ($any) $variants = [(object)['id'=>'*','label'=>'Any finish']];
        foreach ($variants as $i=>$v) {
            $key = $prefix.$v->id;
            $has = fn($marks) => isset($marks[$key]) || ($any && array_any($card->variants,fn($value)=>isset($marks[$prefix.$value->id])));
            $present = $has($owned);
            $pending = !$present && $has($ordered);
            $slot = ['key'=>$key,'number'=>$card->number,'name'=>$card->name,'category'=>$card->category,'finish'=>$v->label,
                'owned'=>$present,'ordered'=>$pending,'status'=>binder_card_status($present,$pending),'required'=>true];
            if (isset($card->sourceSetId)) {
                $slot['sourceSetId'] = $card->sourceSetId;
                $related[$card->sourceSetId][] = $slot;
            } elseif ($i && $b->order === 'sections') $parallel[] = $slot;
            else $main[] = $slot;
        }
        if (!isset($card->sourceSetId) && isset($b->settings->fillerThrough) && $singleFinish && preg_match('/^[0-9]+$/D', $card->number)
            && (int)$card->number >= 1 && (int)$card->number <= $b->settings->fillerThrough) $main[] = null;
    }
    $extras = [];
    foreach ($b->extras as $e) {
        $key = 'extra:'.$e->id;
        $present = isset($owned[$key]); $pending = isset($ordered[$key]);
        $extras[] = ['key'=>$key,'number'=>$e->number,'name'=>$e->name,'category'=>'Extra','finish'=>'Custom extra',
            'owned'=>$present,'ordered'=>$pending,'status'=>binder_card_status($present,$pending),'required'=>$e->required];
    }
    $layout = $b->settings; $capacity = $layout->rows*$layout->columns;
    $sections = [$b->setId=>array_merge($main,$parallel),'@extras'=>$extras] + $related;
    $placements = [];
    if ($layout->includeRelated ?? false) {
        foreach ($layout->sectionLayout ?? [] as $section) $placements[$section->id] = $section->newPage ?? false;
    }
    $placements += array_fill_keys(array_keys($sections),false);
    $slots = [];
    foreach ($placements as $id=>$newPage) {
        if (empty($sections[$id])) continue;
        $offset = (count($slots)+$layout->leadingBlankPockets) % $capacity;
        if ($newPage && $offset) array_push($slots,...array_fill(0,$capacity-$offset,null));
        foreach ($sections[$id] as $slot) $slots[] = $slot;
    }
    foreach ($slots as $i=>&$slot) {
        if ($slot === null) continue;
        $index = $i+$layout->leadingBlankPockets; $page = intdiv($index,$capacity)+1; $pocket = $index % $capacity;
        $slot += ['page'=>$page,'pocket'=>$pocket+1,'sheet'=>$layout->useBackSides ? intdiv($page+1,2) : $page,
            'side'=>$layout->useBackSides && $page%2===0 ? 'back' : 'front','row'=>intdiv($pocket,$layout->columns)+1,'column'=>$pocket%$layout->columns+1];
    }
    return array_values(array_filter($slots, static fn($slot) => $slot !== null));
}

function master_read(string $tool, string $root, ?array $row, array $args): array
{
    $state = mcp_state($row); $index = master_set_index($root); $matches = [];
    foreach ($state->binders ?? [] as $binder) {
        if ($tool === 'get_set_binder' && $binder->id !== ($args['binderId'] ?? null)) continue;
        if ($tool === 'list_set_binders' && !mcp_text_match($args['query'] ?? '',$binder->name,$binder->setId,$index[$binder->setId]->name)) continue;
        $slots = master_slots($binder,master_binder_cards($root,$binder->setId,$index,$binder->settings->includeRelated ?? false));
        $goal = array_filter($slots,fn($s)=>$s['required']); $extras = array_filter($slots,fn($s)=>!$s['required']);
        $summary = ['binderId'=>$binder->id,'name'=>$binder->name,'setId'=>$binder->setId,'goal'=>$binder->goal,
            'required'=>count($goal),'collected'=>count(array_filter($goal,fn($s)=>$s['owned'])),'ordered'=>count(array_filter($goal,fn($s)=>$s['ordered'])),
            'missing'=>count(array_filter($goal,fn($s)=>$s['status']==='missing')),
            'optional'=>count($extras),'optionalCollected'=>count(array_filter($extras,fn($s)=>$s['owned'])),
            'optionalOrdered'=>count(array_filter($extras,fn($s)=>$s['ordered']))];
        if ($tool === 'get_set_binder') {
            $status = $args['status'] ?? 'all';
            $items = array_filter($slots,fn($s)=>($status==='all' || $status===$s['status']) && mcp_text_match($args['query']??'',$s['name'],$s['number'],$s['finish']));
            return $summary + mcp_page($items,$args['offset']??0,$args['limit']??20);
        }
        $matches[] = $summary;
    }
    if ($tool === 'get_set_binder') accounts_fail(404,'binder_not_found','Choose a binder from list_set_binders.');
    return mcp_page($matches,$args['offset']??0,$args['limit']??20);
}

function master_change(string $root, stdClass $state, stdClass $input, bool $useStatus = false): array
{
    mcp_change_fields($input,['binderId','key',$useStatus ? 'status' : 'owned']);
    if (!is_string($input->key) || (!$useStatus && !is_bool($input->owned))) accounts_invalid();
    $status = $useStatus ? $input->status : ($input->owned ? 'owned' : 'missing');
    if (!in_array($status,['owned','ordered','missing'],true)) accounts_invalid();
    foreach ($state->binders as $b) {
        if ($b->id !== $input->binderId) continue;
        $cards = master_binder_cards($root,$b->setId,master_set_index($root),$b->settings->includeRelated ?? false);
        $slots = array_column(master_slots($b,$cards),null,'key');
        $key = $input->key;
        if (!isset($slots[$key])) accounts_fail(422,'unknown_slot','Choose a printing from this binder.');
        $slot = $slots[$key];
        $summary = ['binderId'=>$b->id,'binderName'=>$b->name,'slot'=>$slot,'requestedStatus'=>$status];
        if (!$useStatus) $summary['requestedOwned'] = $input->owned;
        if ($useStatus ? $slot['status'] === $status : $slot['owned'] === $input->owned) return $summary;
        $marks = array_fill_keys($b->owned,true);
        $orders = array_fill_keys($b->ordered ?? [],true);
        $prefix = substr($key,0,strpos($key,':')+1);
        $any = str_ends_with($key,':*');
        if ($any) {
            if ($status !== 'owned') foreach (array_keys($marks) as $mark) if (str_starts_with($mark,$prefix)) unset($marks[$mark]);
            foreach (array_keys($orders) as $mark) if (str_starts_with($mark,$prefix)) unset($orders[$mark]);
        }
        if ($status === 'owned') {
            $marks[$key] = true;
            if (!$any) unset($marks[$prefix.'*'],$orders[$prefix.'*']);
        } else unset($marks[$key]);
        if ($status === 'ordered') $orders[$key] = true;
        else unset($orders[$key]);
        $b->owned = array_keys($marks); sort($b->owned,SORT_STRING);
        if ($orders) {
            $b->ordered = array_keys($orders); sort($b->ordered,SORT_STRING);
        } else unset($b->ordered);
        return $summary;
    }
    accounts_fail(404,'binder_not_found','Choose a synced set binder.');
}
