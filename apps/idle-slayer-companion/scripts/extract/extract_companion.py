"""Extract the reviewed Windows Steam 7.3.4 companion definitions offline.

Reads installation assets and reconstructed declarations only; never launches
the game or reads saves. Raw inspection output is restricted to .local-game.
Public promotion is a separate step after reviewing the receipt and sprites.
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import io
import json
import math
import re
import struct
from decimal import Decimal
from pathlib import Path

from private_paths import only_private_output
from companion_shapes import decimal, Cursor, read_board
from normalize_catalog import plain_text, number, description as tree_description

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator
from UnityPy.helpers.TypeTreeNode import TypeTreeNode

CLASSES = {
    'Achievement': 'achievement', 'PermanentCraftableItem': 'craft',
    'TemporaryCraftableItem': 'craft', 'Drop': 'material', 'Quest': 'quest',
    'Enemy': 'enemy', 'Divinity': 'divinity', 'UpgradableBuilding': 'village',
    'BoardStepSO': 'village', 'BoardSubStepSO': 'village',
}
ALWAYS = {'kind': 'always'}
UNKNOWN = {'kind': 'unknown'}




def combine(kind, values):
    if kind == 'all':
        values = [v for v in values if v != ALWAYS]
    if not values:
        return ALWAYS if kind == 'all' else UNKNOWN
    return values[0] if len(values) == 1 else {'kind': kind, 'requirements': values}


def entity_condition(system, native_id, field='completed', value=True):
    return {'kind': 'entity', 'ref': {'system': system, 'id': native_id}, 'field': field, 'value': value}






def install_addressable_tree(generator):
    """Cpp2IL generic AssetReferenceT lacks inherited serialized fields.

    Its native declaration has exactly these three [SerializeField] strings.
    The augmented tree must consume every Enemy asset completely.
    """
    nodes = []
    for node in generator.get_nodes('Assembly-CSharp', 'Enemy'):
        nodes.append(TypeTreeNode(node.m_Level, node.m_Type, node.m_Name, 0, 0, m_MetaFlag=node.m_MetaFlag))
        if node.m_Type == 'AssetReferenceT`1':
            for name in ('m_AssetGUID', 'm_SubObjectName', 'm_SubObjectType'):
                nodes.extend([
                    TypeTreeNode(2, 'string', name, 0, 0),
                    TypeTreeNode(3, 'Array', 'Array', 0, 0, m_MetaFlag=16384),
                    TypeTreeNode(4, 'int', 'size', 0, 0),
                    TypeTreeNode(4, 'char', 'data', 0, 0),
                ])
    generator.cache[('Assembly-CSharp', 'Enemy')] = TypeTreeNode.from_list(nodes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--dummy-assemblies', type=Path, required=True)
    parser.add_argument('--declarations', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sprite-review', type=Path)
    args = parser.parse_args()
    output = only_private_output(args.output)
    if output.is_relative_to(args.game_root.resolve()):
        raise ValueError('Never write inside the installation')
    output.mkdir(parents=True, exist_ok=True)
    icons = output / 'icons'
    icons.mkdir(exist_ok=True)
    data_root = args.game_root / 'Idle Slayer_Data'
    manifest = args.manifest.read_text(encoding='utf8')
    steam = {key: re.search(r'"' + key + r'"\s+"(\d+)"', manifest)[1] for key in ('appid', 'buildid')}
    globals_env = UnityPy.load(str(data_root / 'globalgamemanagers'))
    version = next(o for o in globals_env.objects if o.type.name == 'PlayerSettings').parse_as_dict(check_read=False)['bundleVersion']
    if steam != {'appid': '1353300', 'buildid': '25810322'} or version != '7.3.4':
        raise ValueError('Review new native schemas/rules before extracting another build')
    registry = next(o for o in globals_env.objects if o.type.name == 'ResourceManager').parse_as_dict()['m_Container']
    paths = {pointer['m_PathID']: path for path, pointer in registry if pointer['m_FileID'] == 2}
    scripts_env = UnityPy.load(str(data_root / 'globalgamemanagers.assets'))
    scripts = {o.path_id: o.parse_as_dict() for o in scripts_env.objects if o.type.name == 'MonoScript'}
    env = UnityPy.load(str(data_root / 'resources.assets'))
    unity_version = next(iter(env.objects)).assets_file.unity_version
    generator = TypeTreeGenerator(unity_version)
    generator.load_local_dll_folder(str(args.dummy_assemblies))
    install_addressable_tree(generator)
    env.typetree_generator = generator
    objects = env.file.objects

    def class_of(obj):
        if obj.type.name != 'MonoBehaviour':
            return obj.type.name
        file_id, path_id = struct.unpack_from('<iq', obj.get_raw_data(), 16)
        return scripts.get(path_id, {}).get('m_ClassName', '?') if file_id == 1 else '?'

    locale = dict(csv.reader(io.StringIO(next(o for o in env.objects if o.type.name == 'TextAsset' and o.peek_name() == 'en-US').parse_as_dict()['m_Script'])))
    names = {}
    for obj in env.objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        cursor = Cursor(obj.get_raw_data())
        asset_name = cursor.string()
        name = {'m_Name': asset_name, 'class': class_of(obj)}
        try:
            native_id, label_key = cursor.string(), cursor.string()
            if re.fullmatch(r'[a-z0-9]{20}', native_id):
                name.update({'id': native_id, 'name': label_key})
        except (ValueError, struct.error, UnicodeDecodeError):
            pass
        names[obj.path_id] = name

    rows = {}
    for obj in env.objects:
        kind = class_of(obj)
        if kind in CLASSES:
            data = read_board(obj, kind) if kind in ('BoardStepSO', 'BoardSubStepSO') else obj.parse_as_dict()
            if kind in ('BoardStepSO', 'BoardSubStepSO'):
                match = re.fullmatch(r'(Step|Sub)_([a-f0-9]{32})(_\d+)?', data['m_Name'])
                if not match:
                    raise ValueError('Village board asset lacks its stable editor GUID')
                data['id'] = 'board-' + match[2] + (match[3] or '')
                names[obj.path_id]['id'] = data['id']
            if not re.fullmatch(r'[a-z0-9_-]+', data['id']):
                raise ValueError('Unsafe native entity ID')
            rows[obj.path_id] = {'class': kind, 'pathId': obj.path_id, 'resourcePath': paths.get(obj.path_id), 'data': data}

    for row in rows.values():
        if row['class']=='Quest' and row['data']['unlocksUpgrade']['m_PathID']:
            reward=objects[row['data']['unlocksUpgrade']['m_PathID']].parse_as_dict()
            row['data']['rewardUpgrade']={key:reward[key] for key in ('id','permanentUpgrade','storyRewardUpgrade')}
    quest_packs = {row['data']['bundleRequired']['m_PathID'] for row in rows.values() if row['class']=='Quest' and not row['data']['fromCollab']['m_PathID'] and not row['data']['mapEvent']['m_PathID']}
    external_unlocks = {p['m_PathID'] for row in rows.values() if row['class'] in ('PermanentCraftableItem','TemporaryCraftableItem') for p in row['data']['upgradesRequired']}
    external_unlocks |= {row['data']['unlocksUpgrade']['m_PathID'] for row in rows.values() if row['class']=='Quest' and row['data'].get('rewardUpgrade',{}).get('permanentUpgrade')}
    for pid in sorted((quest_packs|external_unlocks)-{0}):
        if names[pid]['class']!='Upgrade':
            raise ValueError('A quest pack or item upgrade gate is not an Upgrade')
        data=objects[pid].parse_as_dict()
        system='quest' if pid in quest_packs else 'village'
        rows[pid]={'class':'Upgrade','system':system,'pathId':pid,'resourcePath':paths.get(pid),'data':data}
        names[pid]['companionSystem']=system
    expected={'Achievement':662,'PermanentCraftableItem':73,'TemporaryCraftableItem':33,'Drop':25,'Quest':229,'Enemy':82,'Divinity':71,'UpgradableBuilding':8,'BoardStepSO':62,'BoardSubStepSO':16}
    counts=collections.Counter(row['class'] for row in rows.values())
    if any(counts[kind]!=count for kind,count in expected.items()):
        raise ValueError('Native companion registry coverage changed; review before promotion')
    if any(not row['resourcePath'] for row in rows.values() if row['class'] not in ('BoardStepSO','BoardSubStepSO')):
        raise ValueError('An extracted resource definition is absent from ResourceManager')
    definitions=[obj.parse_as_dict() for obj in env.objects if class_of(obj)=='BoardDefinitionSO']
    if len(definitions)!=1 or {p['m_PathID'] for p in definitions[0]['steps']} != {pid for pid,row in rows.items() if row['class']=='BoardStepSO'}:
        raise ValueError('Village board registry does not cover every native step')
    if {p['m_PathID'] for row in rows.values() if row['class']=='BoardStepSO' for p in row['data']['subSteps']} != {pid for pid,row in rows.items() if row['class']=='BoardSubStepSO'}:
        raise ValueError('Village board references do not cover every native substep')

    def ref(pointer):
        if not pointer or not pointer['m_PathID']:
            return None
        if pointer['m_FileID'] != 0:
            raise ValueError('Unexpected cross-file companion reference')
        return names[pointer['m_PathID']]

    def label(pointer, plural=False):
        entry = ref(pointer)
        if not entry:
            return ''
        if plural and pointer['m_PathID'] in rows:
            key = rows[pointer['m_PathID']]['data'].get('pluralName', entry.get('name'))
        else:
            key = entry.get('name')
        return locale.get(key, entry['m_Name'])

    def cross_ref(pointer):
        entry = ref(pointer)
        if not entry or 'id' not in entry:
            return None
        system = entry.get('companionSystem') or CLASSES.get(entry['class']) or ('ascension' if entry['class'] == 'AscensionSkill' else None)
        return {'system': system, 'id': entry['id']} if system else None

    def condition(pointer, field='completed', active=False):
        entry = ref(pointer)
        if not entry:
            return ALWAYS
        if entry['class'] == 'AscensionSkill':
            return {'kind': 'ascension', 'requirement': {'kind': 'active' if active else 'owned', 'id': entry['id']}}
        system = entry.get('companionSystem') or CLASSES.get(entry['class'])
        return entity_condition(system, entry['id'], field) if system else UNKNOWN

    def enum(name):
        source = (args.declarations / (name + '.cs')).read_text(encoding='utf-8-sig')
        return {int(value): key for key, value in re.findall(r'^\s*(\w+) = (\d+),', source, re.M)}

    achievement_types, quest_types = enum('AchievementType'), enum('QuestType')
    ach_keys = {
        8:'enemies_slayed',1:'pick_up_coins',3:'cps_amount',2:'coins_amount',7:'equipment_level_p',10:'total_sp',5:'random_boxes',6:'days',4:'boost',9:'ascensions',11:'portals',13:'watch_ads',14:'achievements',499:'pick_up_ruby',16:'total_upgrades',17:'total_quests',18:'enemies_slayed_with_arrows',19:'buy_all_upgrades',20:'visit_places',21:'minions_level',22:'minions_quest',500:'pick_up_sapphire',501:'pick_up_emerald',502:'pick_up_diamond',503:'pick_up_zynium',23:'bonus_stage_sections',24:'bonus_stage_completed',25:'materials_discovered',26:'buy_levels_at_once',27:'ultra_ascensions',28:'select_characters',29:'buy_ascension_upgrades',30:'open_chests_in_a_row',31:'craft_temporary_items',32:'rage_mode',33:'daily_quests',34:'active_random_events',35:'extend_multiplier_minutes',36:'divinities',37:'dark_divinities',38:'double_offline_earnings',39:'spirit_boosts',40:'break_armory_items',41:'find_armory_items',42:'armory_item_level',43:'equipment_level_record',44:'chest_hunts',45:'perfect_chest_hunts',46:'chest_hunt_multiplier',47:'mimics_slayed',48:'weekly_quests',49:'buy_ascension_upgrade',50:'key_armory_items_equipped',51:'kill_enemies_with_one_arrow',52:'kill_enemies_wind_dash',53:'casino_roulette_win',54:'casino_roulette_lose',55:'casino_spend_chips',56:'defeat_boss',57:'unspent_silver_random_boxes',58:'equip_excellent_armory_items',59:'bestiary_entries',60:'bestiary_mastery',61:'ascending_heights_completed',62:'bestiary_mastery_total_gold',63:'bestiary_mastery_total_diamond',64:'key_armory_items_upgraded',65:'evolve_minion',66:'refine_materials',
    }
    quest_keys = {
        0:'kill_enemies',1:'pick_up_coins',2:'pick_up_rubies',3:'kill_enemies_with_arrows',4:'pick_up_sapphires',5:'kill_flyers',6:'pick_up_emeralds',7:'land_criticals',8:'hit_random_boxes',9:'hit_silver_random_boxes',10:'kill_giants',11:'kill_with_rage_mode',12:'boost',13:'craft_temporary_items',14:'chest_hunt_chests',15:'complete_bonus_stage',16:'complete_bonus_stage_sections',17:'get_materials',18:'pick_up_gemstones',19:'kill_enemies_with_character',20:'kill_enemies_of_type',21:'find_armory_items',22:'get_coins_from_random_box',23:'take_portal',24:'complete_daily_quests',25:'kill_shinies',26:'pick_up_diamonds',27:'wind_dash_kills',28:'digdig_piles',29:'use_rage_mode',30:'complete_ascending_heights',31:'pick_up_zyniums',32:'hit_golden_random_boxes',33:'complete_grapple_runs',
    }

    def formatted(template, values):
        for index, value in enumerate(values):
            template = template.replace('{' + str(index) + '}', str(value))
        if re.search(r'\{\d+\}', template):
            raise ValueError('Unresolved native English substitution: ' + template)
        return plain_text(template)

    def benefit_description(data):
        if data.get('unlocksUpgrade', {}).get('m_PathID'):
            return 'Unlocks the ' + label(data['unlocksUpgrade']) + ' upgrade.'
        benefit = data.get('newBenefit', {})
        target = ref(benefit.get('benefit'))
        target_data = objects[benefit['benefit']['m_PathID']].parse_as_dict() if target else {}
        params = {key: benefit.get(key, 0) for key in ('value', 'value2')}
        for key in ('minion','map','equipment','enemy','enemyType','character','stoneOfTime','npc','craftableItem','drop','loadoutType'):
            entry = ref(benefit.get(key))
            params[key] = {'title': label(benefit[key])} if entry else None
        record = {'id':data['id'],'title':locale.get(data['name'],data['m_Name']),'descriptionKey':data.get('description',''),'description':locale.get(data.get('description',''),''),'benefit':{'id':target_data.get('id'),'descriptionKey':target_data.get('description',''),'description':locale.get(target_data.get('description',''),''),'pathId':benefit.get('benefit',{}).get('m_PathID',0)},'benefitParameters':params}
        try:
            return tree_description(record,locale)[0]
        except ValueError:
            template = record['description'] or record['benefit']['description']
            values = [number(params['value']), number(params['value2'])]
            references = [(key, params[key]['title']) for key in ('enemy','enemyType','character','npc','craftableItem','drop') if params[key]]
            if references:
                values = [references[0][1]] if '{1}' not in template else [number(params['value']),references[0][1]]
            return formatted(template,values)

    (output/'raw-definitions.json').write_text(json.dumps(list(rows.values()),ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    import_kinds={'Achievement':'achievement','PermanentCraftableItem':'permanentCraft','TemporaryCraftableItem':'temporaryCraft','Drop':'material','Quest':'quest','Upgrade':'upgrade','Enemy':'enemy','Divinity':'divinity','UpgradableBuilding':'building'}
    native_rules={'gameVersion':version,'steamBuild':steam['buildid'],'imports':[{'system':row.get('system',CLASSES.get(row['class'])),'id':row['data']['id'],'key':row['data']['id'],'kind':import_kinds[row['class']],**({'target':str(row['data']['questGoal'])} if row['class']=='Quest' else {}),**({'counterKey':'Ultra Ascensions'} if row['class']=='Achievement' and row['data']['achievementType']==27 else {})} for row in rows.values() if row['class'] in import_kinds and not (row['class']=='Quest' and (row['data']['fromCollab']['m_PathID'] or row['data']['mapEvent']['m_PathID']))]}
    (output/'companion-native-rules.json').write_text(json.dumps(native_rules,indent=2)+'\n',encoding='utf8',newline='\n')
    source = {'label':'Installed Idle Slayer 7.3.4 · Steam build 25810322','url':'https://store.steampowered.com/app/1353300/Idle_Slayer/','evidence':'Read-only ResourceManager registry, native English localization and current IL2CPP declarations; data/companion-catalog-receipt.json'}
    entities, icon_records, excluded_quests = [], [], []
    board_parents = {p['m_PathID']: pid for pid,row in rows.items() if row['class']=='BoardStepSO' for p in row['data']['subSteps']}

    def board_condition(data,rid,seen=None):
        seen = set() if seen is None else seen
        if rid == -2:
            return ALWAYS
        if rid in seen:
            raise ValueError('Village condition reference cycle')
        c = data['conditions'].get(str(rid))
        if c is None:
            return ALWAYS
        if c['class']=='AllOfCondition':
            return combine('all',[board_condition(data,r,seen|{rid}) for r in c['conditions']])
        if c['class']=='PermanentCraftableItemCraftedCondition':
            return condition(c['target'])
        if c['class']=='UpgradableBuildingBuiltCondition':
            return condition(c['target'],'built')
        return UNKNOWN

    for pid,row in rows.items():
        kind,data = row['class'],row['data']
        system = row.get('system',CLASSES.get(kind))
        if kind=='Quest' and (data['fromCollab']['m_PathID'] or data['mapEvent']['m_PathID']):
            excluded_quests.append(data['id'])
            continue
        title_key = data.get('name',data.get('title',''))
        title = plain_text(locale.get(title_key,data['m_Name']))
        entity = {'system':system,'id':data['id'],'title':title,'description':'','category':kind,'reveal':UNKNOWN,'provenance':[source]}
        related = []
        icon = data.get('icon', data.get('sprite',data.get('image')))
        if icon and icon['m_PathID']:
            sprite = objects[icon['m_PathID']]
            if sprite.type.name != 'Sprite':
                raise ValueError('Companion icon is not a Sprite')
            image = sprite.parse_as_object().image
            if image.convert('RGBA').getchannel('A').getbbox() is None:
                raise ValueError('Fully transparent companion sprite')
            name = system + '-' + data['id'] + '.png'
            image.save(icons / name)
            entity['icon'] = 'assets/companion/' + name
            icon_records.append({'system':system,'id':data['id'],'spritePathId':sprite.path_id,'width':image.width,'height':image.height,'sha256':hashlib.sha256((icons/name).read_bytes()).hexdigest()})
        if kind=='Achievement':
            t=data['achievementType'];entity['category']=achievement_types[t]
            entity['target']=decimal(data['target'])
            entity['counterSupported']=t==27
            entity['steam']=not bool(data['excludeFromSteam'])
            entity['platforms']=['Windows Steam'] if entity['steam'] else ['In-game']
            if data['isInIOSGameCenter']:entity['platforms'].append('iOS Game Center')
            if data['googlePlayID']:entity['platforms'].append('Google Play Games')
            template=locale.get(data['description'],'') or locale.get('achievement_type_'+ach_keys.get(t,''),'')
            values=[number(data['target'])]
            if t==7:values=[label(data['power']),number(data['target'])]
            elif t==20:values=[label(data['visitPlace'])]
            elif t==49:values=[label(data['unlockedAfterBuying'])]
            elif t==56:values=[label(data['boss'])]
            entity['description']=formatted(template,values)
            entity['secret']=True
            entity['reveal']=entity_condition('achievement',data['id'])
            related=[cross_ref(data[key]) for key in ('unlockedAfterBuying','unlockedAfterCrafting')]
        elif kind in ('PermanentCraftableItem','TemporaryCraftableItem'):
            entity['category']='Permanent items' if kind=='PermanentCraftableItem' else 'Temporary recipes'
            entity['permanent']=kind=='PermanentCraftableItem'
            entity['description']=benefit_description(data)
            entity['cost']=decimal(data['coinsRequired'])
            entity['costUnit']='Coins'
            entity['recipe']=[{'materialId':ref(r['material'])['id'],'quantity':decimal(r['amount'])} for r in data['requirements'] if r['material']['m_PathID'] and not r['divinityPoints']]
            gates=[condition(p,active=True) for p in data['ascensionSkillsRequired']]+[condition(p) for p in data['craftableItemsRequired']]+[condition(p) for p in data['upgradesRequired']]+[UNKNOWN for p in data['characterSkinRequired']]
            material_gates=[condition(r['material'],'discovered') for r in data['requirements'] if r['material']['m_PathID']]
            # Native material discovery controls recipe reveal; prerequisite
            # crafting/upgrade conditions remain separate from the shopping cost.
            discovered=combine('all' if data['needAllMaterialsDiscoveredToShow'] else 'any',material_gates) if material_gates else ALWAYS
            entity['purchase']=combine('all',gates)
            entity['reveal']=combine('any',[entity_condition('craft',data['id']),combine('all',gates+[discovered])])
            related=[cross_ref(p) for key in ('ascensionSkillsRequired','craftableItemsRequired') for p in data[key]]
        elif kind=='Drop':
            category=ref(data['category']);entity['category']=locale.get(category.get('name'),category['m_Name'])
            entity['description']='Native material. Recorded inventory is an observation; planning does not spend it.'
            entity['reveal']=entity_condition('material',data['id'],'discovered')
            entity['sources']=[{'system':'enemy','id':r['data']['id']} for r in rows.values() if r['class']=='Enemy' and r['data']['drop']['m_PathID']==pid and not r['data']['hideInBestiary']]
        elif kind=='Quest':
            t=data['questType'];entity['category']=label(data['bundleRequired']) or 'Initial quests'
            entity['target']=str(data['questGoal'])
            template=locale.get(data['description'],'') or locale.get('quest_type_'+quest_keys[t],'')
            values=[str(data['questGoal']),label(data['enemyToKill'],plural=True) or locale.get('ui_enemies','enemies'),label(data['characterRequired'])]
            if t==20:values=[str(data['questGoal']),label(data['enemyType'])]
            entity['description']=formatted(template,values)
            entity['reveal']=combine('all',[condition(data['bundleRequired']),UNKNOWN if data['characterRequired']['m_PathID'] else ALWAYS])
            related=[cross_ref(data['enemyToKill'])]
        elif kind=='Enemy':
            entity['category']='Giants' if data['isGiant'] else 'Flying enemies' if data['isFlying'] else 'Ground enemies'
            entity['description']=plain_text(locale.get(data['bestiaryDescription'],'')) or 'No native Bestiary description is defined for this enemy.'
            entity['reveal']=entity_condition('enemy',data['id'],'discovered')
            related=[cross_ref(data[key]) for key in ('evolutionForward','evolutionBackward','drop')]
            base=pid;seen=set()
            while rows[base]['data']['evolutionBackward']['m_PathID']:
                if base in seen:raise ValueError('Enemy evolution cycle')
                seen.add(base);base=rows[base]['data']['evolutionBackward']['m_PathID']
            entity['familyId']=rows[base]['data']['id']
            family=[];current=base;seen=set()
            while current:
                if current in seen:raise ValueError('Enemy evolution forward cycle')
                seen.add(current);family.append(rows[current]['data']['id'])
                current=rows[current]['data']['evolutionForward']['m_PathID']
            entity['masteryCountIds']=family
            divisor=max(1,float(data['bestiaryCustomMasteryRatesDivider'])) if data['bestiaryCustomMasteryRates'] else 10 if data['isGiant'] else 1
            entity['tiers']=['1']+[str(math.ceil(threshold/divisor)) for threshold in (50000,100000,250000)]
            if data['hideInBestiary']:entity['category']='Excluded from native Bestiary';entity['reveal']=UNKNOWN
        elif kind=='Divinity':
            entity['category']='Elemental Divinities' if data['isElemental'] else 'Dark Divinities' if data['isDark'] else 'Divinities'
            entity['cost']=decimal(data['cost'])
            entity['costUnit']='Divinity Points'
            entity['description']=benefit_description(data)
            gates=[condition(data['ascensionUpgradeRequired'],active=True)]
            if data['isDark']:gates.append(entity_condition('craft','nnbcwhliklxqxvhhot4b'))
            if data['bossDefeatedRequired']['m_PathID']:
                gates += [{'kind':'ascension','requirement':{'kind':'active','id':'hnwbnrfi94f0vbcqebgc'}},UNKNOWN]
            entity['purchase']=combine('all',gates)
            entity['reveal']=combine('any',[entity_condition('divinity',data['id'],'selected'),entity['purchase']])
            related=[cross_ref(data['ascensionUpgradeRequired'])]
        elif kind=='UpgradableBuilding':
            entity['category']='Village buildings'
            entity['description']='Record this building once construction is complete.'
            entity['recipe']=[{'materialId':ref(r['material'])['id'],'quantity':decimal(r['amount'])} for r in data['requirements'] if r['material']['m_PathID'] and not r['divinityPoints']]
            entity['reveal']=entity_condition('village',data['id'],'built')
        elif kind=='Upgrade':
            entity['category']='Quest packs' if system=='quest' else 'Unlock milestones'
            entity['description']='Record this '+('quest pack' if system=='quest' else 'upgrade')+' after it has been purchased or received.'
            entity['permanent']=bool(data['permanentUpgrade'] or data['storyRewardUpgrade'])
            gates=[condition(r['ascensionSkill'],active=True) for r in data['ascensionSkillsRequired']]
            gates += [condition(r['upgrade']) for r in data['upgradesRequired']]
            if data['powersRequired'] or data['bestiaryRequirement'] or data['disabled'] or data['fromCollab']['m_PathID']:gates.append(UNKNOWN)
            entity['purchase']=combine('all',gates)
            entity['reveal']=combine('any',[entity_condition(system,data['id']),entity['purchase']])
        else:
            entity['category']='Village board' if kind=='BoardStepSO' else 'Village board subtasks'
            entity['description']='Record this Village board task once it is complete.'
            timers=[c['value'] for c in data['conditions'].values() if c and c['class']=='ODMGearMapTimerCondition']
            if timers:
                if len(timers)!=1:raise ValueError('Ambiguous Village board timer title')
                entity['title']=formatted(entity['title'],[number(timers[0])+' seconds'])
            if kind=='BoardStepSO':
                entity['reveal']=combine('any',[entity_condition('village',data['id']),board_condition(data,data['availability'])])
                related=[cross_ref(p) for p in data['subSteps']]
            else:
                parent=rows[board_parents[pid]]['data']
                entity['reveal']=combine('any',[entity_condition('village',data['id']),board_condition(parent,parent['availability'])])
        other_cost=sum(r['amount'] for r in data.get('requirements',[]) if isinstance(r,dict) and r.get('divinityPoints'))
        if other_cost:entity['otherCosts']=[{'unit':'Divinity Points','quantity':decimal(other_cost)}]
        if not entity['description']:
            raise ValueError('Missing native description: '+kind+' '+title)
        entity['related']=[r for r in related if r]
        entities.append(entity)
    identities=[(e['system'],e['id']) for e in entities]
    if len(identities)!=len(set(identities)):
        raise ValueError('Duplicate companion identity')
    assets_reviewed=False
    if args.sprite_review:
        review=json.loads(args.sprite_review.read_text(encoding='utf8'))
        reviewed={(r['system'],r['id']):r for r in review['records']}
        actual={(r['system'],r['id']):r for r in icon_records}
        assets_reviewed=review['visualReviewComplete'] is True and set(reviewed)==set(actual) and all(reviewed[k]['sha256']==r['sha256'] for k,r in actual.items())
        if not assets_reviewed:raise ValueError('Companion sprite review is incomplete or stale')
    catalog={'schemaVersion':1,'revision':'steam-25810322-companion-v1','gameVersion':version,'steamBuild':steam['buildid'],'entities':entities,'verification':{'coverage':True,'rules':True,'assets':assets_reviewed,'evidence':['Complete native resource registries decoded offline; no game launch or player save access.','All generic Enemy addressable fields and Village managed-reference registries consumed exactly.','Native achievement titles and icons require earned state; the spoiler option is explicit.','Untracked external dialog, boss, character and upgrade predicates are unknown and fail closed.','All 1205 referenced individual sprites reviewed in eleven numbered nearest-neighbor contact sheets.' if assets_reviewed else 'Individual sprite visual review is required before public asset promotion.']}}
    candidate=output/'companion-catalog.json';candidate.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    (output/'raw-definitions.json').write_text(json.dumps(list(rows.values()),ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    receipt={'gameVersion':version,'steamBuild':steam['buildid'],'unityVersion':unity_version,'method':'Offline asset decoding with Cpp2IL dummy assemblies; no player saves, game launch or method invocation','inputHashes':{name:hashlib.sha256((data_root/name).read_bytes()).hexdigest() for name in ('resources.assets','globalgamemanagers','globalgamemanagers.assets')},'catalogSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'counts':dict(collections.Counter(e['system'] for e in entities)),'nativeClassCounts':dict(collections.Counter(r['class'] for r in rows.values())),'excludedCollaborationOrEventQuestIds':excluded_quests,'entities':[{'system':r.get('system',CLASSES.get(r['class'])),'id':r['data']['id'],'nativeClass':r['class'],'pathId':r['pathId'],'resourcePath':r['resourcePath']} for r in rows.values()],'catalogEntities':[{'system':e['system'],'id':e['id']} for e in entities],'icons':icon_records,'visualReviewComplete':assets_reviewed}
    (output/'companion-catalog-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8',newline='\n')
    print(json.dumps({'counts':receipt['counts'],'icons':len(icon_records),'excludedEventAndCollaborationQuests':len(excluded_quests)}))


if __name__=='__main__':
    main()
