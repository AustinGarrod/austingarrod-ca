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
        if (!accounts_fields($b, ['id','name','setId','settings','goal','order','owned','specialties','extras'])
            || !is_string($b->id) || !preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $b->id) || isset($ids[$b->id])
            || !is_string($b->name) || trim($b->name) === '' || mb_strlen($b->name) > 100 || !is_string($b->setId) || !isset($index[$b->setId])
            || !in_array($b->goal,['numbers','variants'],true) || !in_array($b->order,['together','sections'],true)
            || !master_strings($b->owned,256) || !master_strings($b->specialties,200) || !is_array($b->extras)) accounts_invalid();
        $ids[$b->id] = true;
        $s = $b->settings;
        if (!accounts_fields($s,['columns','rows','useBackSides','leadingBlankPockets'], ['fillerThrough'])
            || (property_exists($s,'fillerThrough') && (!is_int($s->fillerThrough) || $s->fillerThrough < 1 || $s->fillerThrough > 9007199254740991))
            || !is_int($s->columns) || $s->columns < 1 || $s->columns > 6 || !is_int($s->rows) || $s->rows < 1 || $s->rows > 6
            || !is_bool($s->useBackSides) || !is_int($s->leadingBlankPockets) || $s->leadingBlankPockets < 0 || $s->leadingBlankPockets > 1000) accounts_invalid();
        if (!isset($known[$b->setId])) {
            $keys = []; $specialties = [];
            foreach (master_cards($root,$b->setId,$index) as $card) {
                $keys[$card->number.':*'] = true;
                foreach ($card->variants as $v) {
                    $keys[$card->number.':'.$v->id] = true;
                    if ($v->specialty) {
                        $specialties[$v->id] = true;
                        $specialties[$card->number.':'.$v->id] = true;
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
        foreach ($b->owned as $key) if (!isset($keys[$key])) accounts_invalid();
        foreach ($b->specialties as $key) if (!isset($specialties[$key])) accounts_invalid();
    }
}

function master_slots(stdClass $b, array $cards): array
{
    $main = []; $parallel = []; $owned = array_fill_keys($b->owned,true);
    foreach ($cards as $card) {
        $prefix = $card->number.':';
        $variants = array_values(array_filter($card->variants,fn($v)=>!$v->specialty || in_array($v->id,$b->specialties,true) || in_array($prefix.$v->id,$b->specialties,true)));
        $singleFinish = count($variants) <= 1;
        $any = $b->goal === 'numbers' || !$variants;
        if ($any) $variants = [(object)['id'=>'*','label'=>'Any finish']];
        foreach ($variants as $i=>$v) {
            $key = $prefix.$v->id;
            $present = isset($owned[$key]) || ($any && array_any($card->variants,fn($value)=>isset($owned[$prefix.$value->id])));
            $slot = ['key'=>$key,'number'=>$card->number,'name'=>$card->name,'category'=>$card->category,'finish'=>$v->label,'owned'=>$present,'required'=>true];
            if ($i && $b->order === 'sections') $parallel[] = $slot;
            else $main[] = $slot;
        }
        if (isset($b->settings->fillerThrough) && $singleFinish && preg_match('/^[0-9]+$/D', $card->number)
            && (int)$card->number >= 1 && (int)$card->number <= $b->settings->fillerThrough) $main[] = null;
    }
    $slots = array_merge($main,$parallel);
    foreach ($b->extras as $e) $slots[] = ['key'=>'extra:'.$e->id,'number'=>$e->number,'name'=>$e->name,'category'=>'Extra','finish'=>'Custom extra','owned'=>isset($owned['extra:'.$e->id]),'required'=>$e->required];
    $layout = $b->settings; $capacity = $layout->rows*$layout->columns;
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
        $slots = master_slots($binder,master_cards($root,$binder->setId,$index));
        $goal = array_filter($slots,fn($s)=>$s['required']); $extras = array_filter($slots,fn($s)=>!$s['required']);
        $summary = ['binderId'=>$binder->id,'name'=>$binder->name,'setId'=>$binder->setId,'goal'=>$binder->goal,
            'required'=>count($goal),'collected'=>count(array_filter($goal,fn($s)=>$s['owned'])),'optional'=>count($extras),'optionalCollected'=>count(array_filter($extras,fn($s)=>$s['owned']))];
        if ($tool === 'get_set_binder') {
            $status = $args['status'] ?? 'all';
            $items = array_filter($slots,fn($s)=>($status==='all' || ($status==='owned')===$s['owned']) && mcp_text_match($args['query']??'',$s['name'],$s['number'],$s['finish']));
            return $summary + mcp_page($items,$args['offset']??0,$args['limit']??20);
        }
        $matches[] = $summary;
    }
    if ($tool === 'get_set_binder') accounts_fail(404,'binder_not_found','Choose a binder from list_set_binders.');
    return mcp_page($matches,$args['offset']??0,$args['limit']??20);
}

function master_change(string $root, stdClass $state, stdClass $input): array
{
    mcp_change_fields($input,['binderId','key','owned']);
    if (!is_string($input->key) || !is_bool($input->owned)) accounts_invalid();
    foreach ($state->binders as $b) {
        if ($b->id !== $input->binderId) continue;
        $slots = array_column(master_slots($b,master_cards($root,$b->setId,master_set_index($root))),null,'key');
        $key = $input->key;
        if (!isset($slots[$key])) accounts_fail(422,'unknown_slot','Choose a printing from this binder.');
        $marks = array_fill_keys($b->owned,true);
        $prefix = substr($key,0,strpos($key,':')+1);
        if ($input->owned) {
            if (!$slots[$key]['owned']) $marks[$key] = true;
            if (!str_ends_with($key,':*')) unset($marks[$prefix.'*']);
        } else {
            unset($marks[$key]);
            if (str_ends_with($key,':*')) foreach (array_keys($marks) as $mark) if (str_starts_with($mark,$prefix)) unset($marks[$mark]);
        }
        if ($slots[$key]['owned'] !== $input->owned) {
            $b->owned = array_keys($marks); sort($b->owned,SORT_STRING);
        }
        return ['binderId'=>$b->id,'binderName'=>$b->name,'slot'=>$slots[$key],'requestedOwned'=>$input->owned];
    }
    accounts_fail(404,'binder_not_found','Choose a synced set binder.');
}
