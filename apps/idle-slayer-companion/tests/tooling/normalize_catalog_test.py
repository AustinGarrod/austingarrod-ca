"""Invented native-shaped inputs exercise the real CLI, never game files/saves."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY / "scripts/extract"))
from normalize_catalog import description  # noqa: E402
from private_paths import PRIVATE_ROOT, only_private_output  # noqa: E402

NAMES = ("PermanentSlayer", "UltraAscension", "AstralSlayer", "AstralBlessing",
         "StonesOfTime", "EternalRage", "RageMode", "LandLord", "VillageKey",
         "Multiverse", "PortalDominum")


def upgrade(identifier, **changes):
    result = {
        "id": identifier, "title": "Synthetic " + identifier,
        "description": "Gain {0}% and {1} points.", "descriptionKey": "",
        "benefit": {}, "benefitParameters": {
            "value": 2, "value2": 3, "minion": None, "stoneOfTime": None,
            "loadoutType": None, "map": None, "equipment": None,
        },
        "cost": "900719925474099312345678901234567890",
        "position": {"x": 12.5, "y": -7.25}, "requirements": [],
        "mandatoryRequirements": True, "ultraAscensionsRequired": False,
        "craftableItemsRequirements": [], "requiredUpgrade": None,
        "requiredAscensionUpgrade": None, "isAstral": False, "astralLock": False,
    }
    result.update(changes)
    return result


def fixture():
    # Small author-invented registry. No serialized data or native IDs copied.
    named = {name: "synthetic-" + name for name in NAMES}
    return {
        "provenance": {"gameVersion": "7.2.0", "steamBuild": "25551532"},
        "namedSkills": named,
        "upgrades": [upgrade(identifier) for identifier in named.values()],
        "milestones": [],
    }


class NormalizationCLI(unittest.TestCase):
    def setUp(self):
        PRIVATE_ROOT.mkdir(exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix="synthetic-parser-", dir=PRIVATE_ROOT)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def run_cli(self, data, *, locale=None, output=None):
        source = self.root / "synthetic-export.json"
        source.write_text(json.dumps(data), encoding="utf8")
        (self.root / "localization-en-US.json").write_text(json.dumps(locale or {}), encoding="utf8")
        target = output or self.root / "candidate.json"
        result = subprocess.run(
            [sys.executable, "-S", str(REPOSITORY / "scripts/extract/normalize_catalog.py"),
             "--export", str(source), "--output", str(target)],
            cwd=REPOSITORY, capture_output=True, text=True, check=False,
        )
        return result, target

    def test_actual_cli_preserves_independent_and_or_reveal_and_exact_values(self):
        data = fixture()
        astral = data["namedSkills"]["AstralSlayer"]
        data["upgrades"] += [
            upgrade("parent-a"), upgrade("parent-b"),
            upgrade("and", requirements=["parent-a", "parent-b"],
                    ultraAscensionsRequired=True, craftableItemsRequirements=["item"]),
            upgrade("or", requirements=["parent-a", "parent-b"], mandatoryRequirements=False,
                    ultraAscensionsRequired=True),
            upgrade("astral", isAstral=True, astralLock=True),
            upgrade("descendant", requirements=["astral"], requiredUpgrade="item",
                    requiredAscensionUpgrade="parent-b"),
        ]
        data["milestones"] = [{"id": "item", "title": "Synthetic item", "description": "",
                               "nativeClass": "PermanentCraftableItem"}]
        result, target = self.run_cli(data)
        self.assertEqual(result.returncode, 0, result.stderr)
        catalog = json.loads(target.read_text(encoding="utf8"))
        nodes = {node["id"]: node for node in catalog["upgrades"]}
        self.assertEqual(nodes["and"]["purchase"], {"kind": "all", "requirements": [
            {"kind": "all", "requirements": [{"kind": "active", "id": "parent-a"},
                                               {"kind": "active", "id": "parent-b"},
                                               {"kind": "ultra-ascended"}]},
            {"kind": "milestone", "id": "item"}]})
        # Reviewed native OR success returns before the epoch test.
        self.assertEqual(nodes["or"]["purchase"], {"kind": "any", "requirements": [
            {"kind": "active", "id": "parent-a"}, {"kind": "active", "id": "parent-b"}]})
        self.assertEqual(nodes["or"]["reveal"], {"kind": "ultra-ascended"})
        self.assertEqual(nodes[astral]["reveal"], {"kind": "ultra-ascended"})
        self.assertEqual(nodes["descendant"]["reveal"], {"kind": "all", "requirements": [
            {"kind": "any", "requirements": [{"kind": "owned", "id": astral},
                                               {"kind": "owned", "id": "descendant"}]},
            {"kind": "milestone", "id": "item"}, {"kind": "active", "id": "parent-b"}]})
        self.assertEqual((nodes["astral"]["retention"], nodes["astral"]["activation"]),
                         ("astral", "after-ultra-ascension"))
        self.assertEqual(nodes["and"]["cost"], "900719925474099312345678901234567890")
        self.assertEqual(nodes["and"]["position"], {"x": 12.5, "y": -7.25})
        self.assertEqual(catalog["connections"], [
            {"from": "parent-a", "to": "and"}, {"from": "parent-b", "to": "and"},
            {"from": "parent-a", "to": "or"}, {"from": "parent-b", "to": "or"},
            {"from": "astral", "to": "descendant"}])
        self.assertFalse(catalog["verification"]["assets"])
        self.assertEqual(catalog["milestones"][0]["reveal"], {"kind": "any", "requirements": [
            {"kind": "all", "requirements": [
                {"kind": "ultra-ascended"},
                {"kind": "any", "requirements": [
                    {"kind": "owned", "id": "and"},
                    {"kind": "all", "requirements": [{"kind": "active", "id": "parent-a"},
                                                       {"kind": "active", "id": "parent-b"},
                                                       {"kind": "ultra-ascended"}]}]}]},
            {"kind": "all", "requirements": [
                {"kind": "all", "requirements": [
                    {"kind": "any", "requirements": [{"kind": "owned", "id": astral},
                                                       {"kind": "owned", "id": "descendant"}]},
                    {"kind": "active", "id": "parent-b"}]},
                {"kind": "any", "requirements": [{"kind": "owned", "id": "descendant"},
                                                   {"kind": "active", "id": "astral"}]}]}]})
        self.assertEqual(catalog["grants"][0], {"when": {"kind": "active", "id": data["namedSkills"]["AstralBlessing"]},
                                                "ids": [data["namedSkills"]["StonesOfTime"]]})

    def test_actual_cli_dynamic_receipt_and_static_description(self):
        data = fixture()
        data["upgrades"] += [upgrade("dynamic", description="Player total: {9}",
            benefit={"descriptionKey": "benefit_increase_souls_by_lifetime_sp"},
            benefitParameters={**upgrade("base")["benefitParameters"], "value": "0.000001"})]
        result, target = self.run_cli(data)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(target.read_text(encoding="utf8"))
        self.assertEqual(output["upgrades"][-1]["description"],
            "Increase Souls gathered by +0.000001% for every total Slayer Point earned. "
            "The bonus grows with Total Slayer Points.\n\nCurrent totals or stats vary with game progress.")
        receipt = json.loads((self.root / "normalization-receipt.json").read_text(encoding="utf8"))
        self.assertEqual(receipt["dynamicDescriptionIds"], ["dynamic"])

    def test_actual_cli_rejects_build_drift_and_unresolved_substitutions_without_output(self):
        data = fixture()
        data["provenance"]["steamBuild"] = "synthetic-other-build"
        result, target = self.run_cli(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("different game build", result.stderr)
        self.assertFalse(target.exists())
        data = fixture()
        data["upgrades"][0]["description"] = "Unresolved {9}"
        result, target = self.run_cli(data)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unresolved description parameter", result.stderr)
        self.assertFalse(target.exists())

    def test_private_boundary_and_cli_reject_public_output(self):
        for invalid in [PRIVATE_ROOT, REPOSITORY / "public" / "synthetic.json",
                        PRIVATE_ROOT / ".." / "escape.json"]:
            with self.subTest(path=invalid), self.assertRaises(ValueError):
                only_private_output(invalid)
        self.assertEqual(only_private_output(self.root / "candidate.json"), self.root / "candidate.json")
        result, _ = self.run_cli(fixture(), output=REPOSITORY / "public" / "synthetic-never-written.json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("child of the repository .local-game", result.stderr)


class DescriptionTransformations(unittest.TestCase):
    def test_named_substitutions_and_rich_text(self):
        base = upgrade("synthetic")
        cases = [
            ({"description": "<b>Gain {0}</b><br>for {1}\\n<sprite name=sp>",
              "benefitParameters": {"equipment": {"title": "Synthetic sword"}}},
             "Gain 2\nfor Synthetic sword\n Slayer Points"),
            ({"description": "Open {0}", "benefitParameters": {"map": {"title": "Synthetic realm"}}},
             "Open Synthetic realm"),
            ({"description": "Gain {0} in {1}", "benefitParameters": {"map": {"title": "Synthetic realm"}}},
             "Gain 2 in Synthetic realm"),
            ({"description": "Use {0} for {1}", "benefitParameters": {"stoneOfTime": {"title": "Synthetic stone"}}},
             "Use Synthetic stone for 2"),
            ({"description": "Enable {0}", "benefitParameters": {"loadoutType": {"title": "Synthetic loadout"}}},
             "Enable Synthetic loadout"),
            ({"description": "Reduce {0} then {1}", "benefit": {"descriptionKey": "benefit_decrease_upgrades_price"}},
             "Reduce 3 then 2"),
        ]
        for changes, expected in cases:
            with self.subTest(expected=expected):
                node = copy.deepcopy(base)
                node.update({key: value for key, value in changes.items() if key != "benefitParameters"})
                node["benefitParameters"].update(changes.get("benefitParameters", {}))
                self.assertEqual(description(node, {}), (expected, False))

    def test_special_localized_and_variable_player_branches(self):
        locale = {"benefit_get_astral_key_s": "One synthetic key", "benefit_get_astral_key_p": "{0} synthetic keys",
                  "benefit_equipment_level_after_ascending_s": "Keep {0} at {1}",
                  "divinity_silver_death": "Synthetic divinity"}
        cases = [
            (upgrade("one", benefit={"pathId": 21016}, benefitParameters={**upgrade("b")["benefitParameters"], "value": 1}), "One synthetic key", False),
            (upgrade("many", benefit={"pathId": 21016}), "2 synthetic keys", False),
            (upgrade("equipment", benefit={"pathId": 21015}, benefitParameters={**upgrade("b")["benefitParameters"], "equipment": {"title": "Synthetic axe"}}), "Keep Synthetic axe at 2", False),
            (upgrade("silver", description="Use {0}", descriptionKey="ascension_upgrade_silver_spirit_description"), "Use Synthetic divinity", False),
            (upgrade("unlock", description="Unlock the {0} Minion<br><br>Stats: private-player-total", benefitParameters={**upgrade("b")["benefitParameters"], "minion": {"title": "Synthetic helper"}}), "Unlock the Synthetic helper Minion", True),
            (upgrade("bonus", description="Gain {0}% for {1}<br><br>Current bonus: private-player-total", benefitParameters={**upgrade("b")["benefitParameters"], "minion": {"title": "Synthetic helper"}}), "Gain 2% for Synthetic helper", True),
            (upgrade("spent", description="Gain {0}%<br><br>For example, private-player-total", benefit={"descriptionKey": "benefit_increase_minions_reward_by_spent_sp"}), "Gain 2%\n\nSpent Slayer Points cap: 3 Slayer Points.", True),
        ]
        for node, expected, dynamic in cases:
            with self.subTest(node=node["id"]):
                note = "\n\nCurrent totals or stats vary with game progress." if dynamic else ""
                self.assertEqual(description(node, locale), (expected + note, dynamic))


if __name__ == "__main__":
    unittest.main()
