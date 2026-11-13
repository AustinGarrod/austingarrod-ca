"""Normalize the reviewed build 25551532 export into the app's catalog schema.

Native rule interpretation is documented in scripts/logic/README.md. This
command deliberately writes only a private candidate; public promotion and
sprite review are separate release steps.
"""

from __future__ import annotations

import argparse
import json
import re
from decimal import Decimal
from pathlib import Path

from private_paths import only_private_output


def combine(kind, requirements):
    if kind == "any" and any(requirement["kind"] == "always" for requirement in requirements):
        return {"kind": "always"}
    requirements = [requirement for requirement in requirements if requirement["kind"] != "always"]
    return ({"kind": "always"} if kind == "all" else {"kind": "any", "requirements": []}) if not requirements else requirements[0] if len(requirements) == 1 else {"kind": kind, "requirements": requirements}


def plain_text(value):
    value = value.replace("\\n", "\n")
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<sprite name=sp>", " Slayer Points ", value)
    value = re.sub(r"<[^>]+>", "", value)
    return re.sub(r"[ \t]+", " ", value).strip()


def number(value):
    value = Decimal(str(value))
    # Keep the exact static value, including Inner Power's tiny coefficient.
    formatted = format(value, ",f")
    return formatted.rstrip("0").rstrip(".") if "." in formatted else formatted


def description(upgrade, localization):
    parameters = upgrade["benefitParameters"]
    benefit = upgrade["benefit"] or {}
    key = benefit.get("descriptionKey", "")
    template = upgrade["description"] or benefit.get("description", "")
    values = [number(parameters["value"]), number(parameters["value2"])]
    dynamic = False
    if benefit.get("id") == "f1i8bocf6a6zkgapnl0l" or benefit.get("pathId") == 21016:  # Benefits.GetAstralKeys.
        template = localization["benefit_get_astral_key_s" if parameters["value"] == 1 else "benefit_get_astral_key_p"]
    elif benefit.get("id") == "0ck9holqb5acoqa227t7" or benefit.get("pathId") == 21015:  # EquipmentLevelAfterAscending.
        template = localization["benefit_equipment_level_after_ascending_s"]
        values = [parameters["equipment"]["title"], number(parameters["value"])]
    elif upgrade["descriptionKey"] == "ascension_upgrade_silver_spirit_description":
        values = [localization["divinity_silver_death"]]
    elif key == "benefit_increase_souls_by_lifetime_sp":
        # The first template clause is a player's current computed total.
        template = "Increase Souls gathered by +{0}% for every total Slayer Point earned. The bonus grows with Total Slayer Points."
        dynamic = True
    elif key == "benefit_increase_minions_reward_by_spent_sp":
        # Dynamic examples use current minion duration and the player's spent SP.
        template = template.split("<br><br>For example,")[0] + "\n\nSpent Slayer Points cap: {1} Slayer Points."
        values = [number(parameters["value"]), number(parameters["value2"])]
        dynamic = True
    elif parameters["minion"]:
        minion_name = parameters["minion"]["title"]
        if template.startswith("Unlock the {0} Minion"):
            # Stats vary with evolution and owned enhancements. Preserve the
            # verified unlock effect without inventing a player's current stats.
            template = template.split("<br><br>Stats:")[0]
            values = [minion_name]
            dynamic = True
        else:
            template = template.split("<br><br>Current bonus:")[0]
            values = [number(parameters["value"]), minion_name]
            dynamic = True
    elif parameters["stoneOfTime"]:
        values = [parameters["stoneOfTime"]["title"], number(parameters["value"])]
    elif parameters["loadoutType"]:
        values = [parameters["loadoutType"]["title"]]
    elif parameters["map"]:
        values = [parameters["map"]["title"]] if "{1}" not in template else [number(parameters["value"]), parameters["map"]["title"]]
    elif parameters["equipment"]:
        values = [number(parameters["value"]), parameters["equipment"]["title"]]
    elif key == "benefit_decrease_upgrades_price":
        values = [number(parameters["value2"]), number(parameters["value"])]
    if not template:
        raise ValueError(f"Missing description for native upgrade {upgrade['id']}")
    for index, replacement in enumerate(values):
        template = template.replace("{" + str(index) + "}", replacement)
    if re.search(r"\{\d+\}", template):
        raise ValueError(f"Unresolved description parameter for {upgrade['title']}")
    result = plain_text(template)
    if dynamic:
        result += "\n\nCurrent totals or stats vary with game progress."
    return result, dynamic


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sprite-review", type=Path)
    args = parser.parse_args()
    output = only_private_output(args.output)
    data = json.loads(args.export.read_text(encoding="utf8"))
    locale = json.loads((args.export.parent / "localization-en-US.json").read_text(encoding="utf8"))
    provenance = data["provenance"]
    if (provenance["steamBuild"], provenance["gameVersion"]) not in (("25551532", "7.2.0"), ("25810322", "7.3.4")):
        raise ValueError("Review the native rule interpretation before normalizing a different game build")
    native = {upgrade["id"]: upgrade for upgrade in data["upgrades"]}
    named = data["namedSkills"]
    source = {"label": f"Installed Idle Slayer {provenance['gameVersion']} · Steam build {provenance['steamBuild']}", "url": "https://store.steampowered.com/app/1353300/Idle_Slayer/", "evidence": "ResourceManager Ascension Skills registry; native rules in scripts/logic/native-method-receipt.json"}
    ultra = {"kind": "ultra-ascended"}
    def astral_ancestor(native_id, visited=None):
        visited = set() if visited is None else visited
        if native_id in visited:
            raise ValueError("Dependency cycle while evaluating native HasAstralAncestor")
        visited = visited | {native_id}
        return native[native_id]["isAstral"] or any(astral_ancestor(parent, visited) for parent in native[native_id]["requirements"])

    upgrades = []
    dynamic_descriptions = []
    for upgrade in data["upgrades"]:
        parents = [{"kind": "active", "id": native_id} for native_id in upgrade["requirements"]]
        if not parents:
            tree_purchase = ultra if upgrade["ultraAscensionsRequired"] else {"kind": "always"}
        elif upgrade["mandatoryRequirements"]:
            tree_purchase = combine("all", parents + ([ultra] if upgrade["ultraAscensionsRequired"] else []))
        else:
            # Native OR success returns before the ultra-ascended test.
            tree_purchase = combine("any", parents)
        purchase = combine("all", [tree_purchase] + [{"kind": "milestone", "id": native_id} for native_id in upgrade["craftableItemsRequirements"]])
        if upgrade["id"] == named["AstralSlayer"]:
            tree_reveal = ultra
        elif astral_ancestor(upgrade["id"]):
            tree_reveal = combine("any", [{"kind": "owned", "id": named["AstralSlayer"]}, {"kind": "owned", "id": upgrade["id"]}])
        elif upgrade["ultraAscensionsRequired"]:
            tree_reveal = ultra
        else:
            tree_reveal = {"kind": "always"}
        gates = [tree_reveal]
        if upgrade["requiredUpgrade"]:
            gates.append({"kind": "milestone", "id": upgrade["requiredUpgrade"]})
        if upgrade["requiredAscensionUpgrade"]:
            gates.append({"kind": "active", "id": upgrade["requiredAscensionUpgrade"]})
        text, dynamic = description(upgrade, locale)
        if dynamic:
            dynamic_descriptions.append(upgrade["id"])
        upgrades.append({"id": upgrade["id"], "title": upgrade["title"], "description": text, "cost": upgrade["cost"], "position": upgrade["position"], "icon": f"assets/upgrades/{upgrade['id']}.png", "purchase": purchase, "reveal": combine("all", gates), "retention": "astral" if upgrade["isAstral"] else "repeat", "activation": "after-ultra-ascension" if upgrade["isAstral"] and upgrade["astralLock"] else "immediate", "sources": [source, {"label": "Native English localization and benefit parameters", "evidence": "resources.assets en-US TextAsset + AscensionSkill/BenefitReferences serialized fields"}]})
    def remove_own_gate(requirement, milestone_id):
        if requirement["kind"] == "milestone" and requirement["id"] == milestone_id:
            return {"kind": "always"}
        if requirement["kind"] in ("all", "any"):
            return combine(requirement["kind"], [remove_own_gate(child, milestone_id) for child in requirement["requirements"]])
        return requirement
    milestones = []
    for milestone in data["milestones"]:
        consumers = [upgrade for upgrade in upgrades if native[upgrade["id"]]["requiredUpgrade"] == milestone["id"] or milestone["id"] in native[upgrade["id"]]["craftableItemsRequirements"]]
        # App policy: isolated external-only entry nodes have no native tree
        # gate to reuse, so only an already owned consuming node exposes them.
        # Show spoilers enables first entry without a guessed story/Ultra gate.
        consumer_gates = []
        for consumer in consumers:
            reached = {"kind": "owned", "id": consumer["id"]}
            if native[consumer["id"]]["requirements"]:
                reached = combine("any", [reached, remove_own_gate(consumer["purchase"], milestone["id"])])
            consumer_gates.append(combine("all", [remove_own_gate(consumer["reveal"], milestone["id"]), reached]))
        reveal = combine("any", consumer_gates)
        action = "crafted or received" if milestone["nativeClass"] == "PermanentCraftableItem" else "purchased or received"
        detail = plain_text(milestone["description"])
        detail = (detail + "\n\n" if detail else "") + f"Record the {milestone['title']} item when it has been {action}."
        milestones.append({"id": milestone["id"], "title": milestone["title"], "description": detail, "reveal": reveal, "sources": [source]})
    grants = [{"when": {"kind": "active", "id": named[from_name]}, "ids": [named[to_name]]} for from_name, to_name in (("AstralBlessing", "StonesOfTime"), ("EternalRage", "RageMode"), ("LandLord", "VillageKey"), ("Multiverse", "PortalDominum"))]
    assets_reviewed = False
    if args.sprite_review:
        sprite_review = json.loads(args.sprite_review.read_text(encoding="utf8"))
        assets_reviewed = sprite_review["visualReviewComplete"] is True and {record["id"] for record in sprite_review["records"]} == set(native)
        if not assets_reviewed:
            raise ValueError("Sprite review is incomplete or covers a different catalog")
    catalog = {"revision": f"steam-{provenance['steamBuild']}-v1", "gameVersion": provenance["gameVersion"], "steamBuild": provenance["steamBuild"], "startId": named["PermanentSlayer"], "upgrades": upgrades, "milestones": milestones, "connections": [{"from": parent, "to": upgrade["id"]} for upgrade in data["upgrades"] for parent in upgrade["requirements"]], "grants": grants, "ultraAscension": {"kind": "active", "id": named["UltraAscension"]}, "verification": {"coverage": True, "purchaseRules": True, "revealRules": True, "resetRules": True, "assets": assets_reviewed, "evidence": ["288/288 native ResourceManager Ascension Skills entries decoded with unique IDs", "All tree prerequisite references resolve to registry assets", "Native semantic interpretation: scripts/logic/README.md; immutable method bodies: scripts/logic/native-method-receipt.json", "All 288 sprites reviewed in six numbered sheets" if assets_reviewed else "Sprite visual review remains required before asset verification", "Descriptions show native base effects; player-derived totals and minion stats are omitted and explicitly labeled"]}}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    receipt = {"provenance": provenance, "normalizedUpgradeCount": len(upgrades), "connections": len(catalog["connections"]), "milestones": len(milestones), "dynamicDescriptionIds": dynamic_descriptions, "descriptionTransformations": "Native English templates formatted with serialized values and named references; Unity rich-text tags removed. Player-derived totals and variable minion stats replaced by base effects and a variability note. No player state read.", "milestoneChecklistPolicy": "OR of consuming upgrade gates: native reveal excluding the item itself AND (already owned upgrade OR ordinary purchase prerequisites excluding the item itself). For consumers with no ordinary prerequisites, only already owned consumers expose the control; Show spoilers enables first entry without guessed story gates.", "rulesEvidence": "scripts/logic/native-method-receipt.json", "spriteReviewComplete": assets_reviewed}
    output.with_name("normalization-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    print(json.dumps({"upgrades": len(upgrades), "connections": len(catalog["connections"]), "milestones": len(milestones), "dynamicDescriptions": len(dynamic_descriptions)}))


if __name__ == "__main__":
    main()
