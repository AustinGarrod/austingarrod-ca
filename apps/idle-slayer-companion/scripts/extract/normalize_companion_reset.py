"""Normalize the independently reviewed Steam 7.3.4 Ultra Ascension facts.

Input definitions come from extract_companion.py, not player saves. The native
control-flow interpretation below must be reviewed again for another build.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal
from pathlib import Path


def integer(value):
    number = Decimal(str(value))
    if not number.is_finite() or number < 0 or number != number.to_integral_value():
        raise ValueError('Expected a nonnegative native integral quantity')
    return format(number, 'f').split('.')[0]


def normalize(definitions, ascension, bindings):
    provenance = ascension['provenance']
    if (provenance['gameVersion'], provenance['steamBuild']) != ('7.3.4', '25810322'):
        raise ValueError('Reset semantics require a fresh review for another native build')
    by_path = {row['pathId']: row for row in definitions}
    quests = [row['data'] for row in definitions if row['class'] == 'Quest']
    achievements = [row['data'] for row in definitions if row['class'] == 'Achievement']
    drops = [row['data'] for row in definitions if row['class'] == 'Drop']
    upgrades = [row['data'] for row in definitions if row['class'] == 'Upgrade']
    native_quests = []
    for quest in quests:
        event = bool(quest['mapEvent']['m_PathID'])
        collab = bool(quest['fromCollab']['m_PathID'])
        reward = quest.get('rewardUpgrade')
        if quest['unlocksUpgrade']['m_PathID'] and not reward:
            raise ValueError('Missing fully reviewed quest reward metadata')
        policy = {'id': quest['id'], 'target': integer(quest['questGoal']), 'retain': 'always' if event or collab else 'reward' if reward and reward['permanentUpgrade'] else 'never', 'countsForAchievements': not event}
        if policy['retain'] == 'reward':
            policy['rewardId'] = reward['id']
        native_quests.append(policy)
    claims = []
    for skill, quest_fields in [('SilkMaster', ['HandStingers', 'ChemicalComponents']), ('EdgeMaster', ['SilverResearch', 'YouCanNotBeIdle'])]:
        rows = [by_path[bindings[field]['m_PathID']]['data'] for field in quest_fields]
        claims.append({'upgradeId': ascension['namedSkills'][skill], 'quests': [{'id': row['id'], 'target': integer(row['questGoal']), 'rewardId': row['rewardUpgrade']['id']} for row in rows]})
    event_rewards = {quest['rewardUpgrade']['id'] for quest in quests if quest['mapEvent']['m_PathID'] and quest.get('rewardUpgrade')}
    reward_upgrades = [{'id': upgrade['id'], 'retain': bool(upgrade['permanentUpgrade'] or upgrade['storyRewardUpgrade'] or upgrade['paidUpgrade'] or upgrade['fromCollab']['m_PathID'] or upgrade['id'] in event_rewards)} for upgrade in upgrades]
    key_materials = [drop for drop in drops if drop['name'] == 'drop_astral_key']
    overflow = [item for item in achievements if item['name'] == 'achievement_carry_me']
    if len(key_materials) != 1 or key_materials[0]['maxAmount'] != 0 or len(overflow) != 1:
        raise ValueError('Reviewed material reward bindings changed')
    key_sources = [{'id': node['id'], 'quantity': integer(node['benefitParameters']['value'])} for node in ascension['upgrades'] if node.get('benefit') and node['benefit']['id'] == 'f1i8bocf6a6zkgapnl0l']
    return {
        'schemaVersion': 1, 'gameVersion': '7.3.4', 'steamBuild': '25810322',
        'quests': sorted(native_quests, key=lambda item: item['id']),
        'upgrades': sorted(reward_upgrades, key=lambda item: item['id']),
        'questClaims': claims,
        'materialReward': {'id': key_materials[0]['id'], 'maximum': '999999999', 'overflowAchievementId': overflow[0]['id'], 'upgrades': sorted(key_sources, key=lambda item: item['id'])},
        'achievementIds': sorted(item['id'] for item in achievements),
        'materialIds': sorted(item['id'] for item in drops),
        'achievements': sorted([{'id': item['id'], 'type': item['achievementType'], 'target': integer(item['target'])} for item in achievements if item['achievementType'] in (3, 10, 14, 16, 17, 25, 27)], key=lambda item: item['id']),
        'divinityActivityUpgrades': [ascension['namedSkills']['Divinities'], ascension['namedSkills']['BlessingOfCronus']],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--definitions', type=Path, required=True)
    parser.add_argument('--ascension-export', type=Path, required=True)
    parser.add_argument('--quest-bindings', type=Path, required=True)
    parser.add_argument('--logic-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = normalize(json.loads(args.definitions.read_text(encoding='utf-8')), json.loads(args.ascension_export.read_text(encoding='utf-8')), json.loads(args.quest_bindings.read_text(encoding='utf-8')))
    methods = ['AscensionManager_NestedType___c__DisplayClass59_0', 'AscensionManager', 'Quest', 'QuestManager', 'QuestManager_NestedType___c', 'Drop', 'DropsManager', 'DropsManager_NestedType___c', 'Achievement', 'AchievementManager', 'Divinities', 'PlayerInventory', 'Upgrade']
    data['evidence'] = {
        'interpretation': 'Reviewed current native Ultra Ascension callback, quest reset/claim, material limits, achievement callbacks and Divinity effect gating. No game method or player save was accessed.',
        'methods': [{'type': name, 'isilSha256': hashlib.sha256((args.logic_root / f'{name}.txt').read_bytes()).hexdigest()} for name in methods],
        'inputs': [{'kind': kind, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for kind, path in [('definitions', args.definitions), ('ascension', args.ascension_export), ('questBindings', args.quest_bindings)]],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f"Normalized {len(data['quests'])} quest policies, {len(data['upgrades'])} observed upgrade policies and {len(data['materialReward']['upgrades'])} material reward sources.")


if __name__ == '__main__':
    main()
