"""Synthetic inputs for the reviewed reset normalizer; no installed game required."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/extract'))
from normalize_companion_reset import integer, normalize


def fixtures():
    quests = []
    for index in range(1, 5):
        quests.append({'class': 'Quest', 'pathId': index, 'data': {'id': f'quest-{index}', 'questGoal': index * 10, 'mapEvent': {'m_PathID': 0}, 'fromCollab': {'m_PathID': 0}, 'unlocksUpgrade': {'m_PathID': index + 10}, 'rewardUpgrade': {'id': f'reward-{index}', 'permanentUpgrade': False, 'storyRewardUpgrade': False}}})
    upgrades = [{'class': 'Upgrade', 'pathId': index + 10, 'data': {'id': f'reward-{index}', 'permanentUpgrade': False, 'storyRewardUpgrade': False, 'paidUpgrade': False, 'fromCollab': {'m_PathID': 0}}} for index in range(1, 5)]
    definitions = quests + upgrades + [
        {'class': 'Drop', 'pathId': 20, 'data': {'id': 'key-material', 'name': 'drop_astral_key', 'maxAmount': 0}},
        {'class': 'Achievement', 'pathId': 21, 'data': {'id': 'overflow', 'name': 'achievement_carry_me', 'achievementType': 999, 'target': 1}},
        {'class': 'Achievement', 'pathId': 22, 'data': {'id': 'ua-achievement', 'name': 'synthetic', 'achievementType': 27, 'target': 3}},
    ]
    ascension = {'provenance': {'gameVersion': '7.3.4', 'steamBuild': '25810322'}, 'namedSkills': {'SilkMaster': 'silk', 'EdgeMaster': 'edge', 'Divinities': 'divinities', 'BlessingOfCronus': 'cronus'}, 'upgrades': [{'id': 'keys', 'benefit': {'id': 'f1i8bocf6a6zkgapnl0l'}, 'benefitParameters': {'value': 2}}, {'id': 'empty-benefit', 'benefit': None}]}
    bindings = {field: {'m_PathID': index} for index, field in enumerate(['HandStingers', 'ChemicalComponents', 'SilverResearch', 'YouCanNotBeIdle'], 1)}
    return definitions, ascension, bindings


class CompanionResetNormalizerTests(unittest.TestCase):
    def test_native_phase_bindings_and_integer_rewards(self):
        result = normalize(*fixtures())
        self.assertEqual(result['questClaims'][0], {'upgradeId': 'silk', 'quests': [{'id': 'quest-1', 'target': '10', 'rewardId': 'reward-1'}, {'id': 'quest-2', 'target': '20', 'rewardId': 'reward-2'}]})
        self.assertEqual(result['materialReward'], {'id': 'key-material', 'maximum': '999999999', 'overflowAchievementId': 'overflow', 'upgrades': [{'id': 'keys', 'quantity': '2'}]})
        self.assertEqual(result['achievements'], [{'id': 'ua-achievement', 'type': 27, 'target': '3'}])

    def test_event_and_permanent_reward_policies_stay_distinct(self):
        definitions, ascension, bindings = fixtures()
        definitions[0]['data']['mapEvent']['m_PathID'] = 99
        definitions[1]['data']['rewardUpgrade']['permanentUpgrade'] = True
        definitions[5]['data']['permanentUpgrade'] = True
        result = normalize(definitions, ascension, bindings)
        self.assertEqual(result['quests'][0]['retain'], 'always')
        self.assertFalse(result['quests'][0]['countsForAchievements'])
        self.assertEqual(result['quests'][1]['retain'], 'reward')
        self.assertEqual(result['quests'][1]['rewardId'], 'reward-2')
        self.assertEqual(result['quests'][2]['retain'], 'never')
        self.assertTrue(result['upgrades'][0]['retain'])
        self.assertTrue(result['upgrades'][1]['retain'])
        self.assertFalse(result['upgrades'][2]['retain'])

    def test_missing_reward_metadata_and_unreviewed_builds_fail_closed(self):
        definitions, ascension, bindings = fixtures()
        del definitions[0]['data']['rewardUpgrade']
        with self.assertRaisesRegex(ValueError, 'reward metadata'):
            normalize(definitions, ascension, bindings)
        definitions, ascension, bindings = fixtures()
        ascension['provenance']['steamBuild'] = 'future'
        with self.assertRaisesRegex(ValueError, 'fresh review'):
            normalize(definitions, ascension, bindings)

    def test_changed_material_maximum_or_ambiguous_binding_requires_review(self):
        definitions, ascension, bindings = fixtures()
        drop = next(row for row in definitions if row['class'] == 'Drop')
        definitions.append(copy.deepcopy(drop))
        with self.assertRaisesRegex(ValueError, 'bindings changed'):
            normalize(definitions, ascension, bindings)
        definitions.pop()
        drop['data']['maxAmount'] = 100
        with self.assertRaisesRegex(ValueError, 'bindings changed'):
            normalize(definitions, ascension, bindings)

    def test_unsupported_quantities_are_not_rounded_or_coerced(self):
        for value in [-1, 'NaN', 'Infinity', '0.1']:
            with self.assertRaises(ValueError):
                integer(value)
        self.assertEqual(integer('2E+20'), '200000000000000000000')


if __name__ == '__main__':
    unittest.main()
