"""Independently compare a catalog against the reviewed native tree rules.

Inputs are a private asset export, normalized catalog and native-method receipt.
The optional output contains only source hashes, coverage and comparison counts;
it is safe to commit. This does not execute native code or read player saves.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from functools import lru_cache
from pathlib import Path


RETENTION_PAIRS = (
    ("AstralBlessing", "StonesOfTime"),
    ("EternalRage", "RageMode"),
    ("LandLord", "VillageKey"),
    ("Multiverse", "PortalDominum"),
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluate(ast, owned, active, milestones, ultra):
    kind = ast["kind"]
    if kind == "always":
        return True
    if kind == "ultra-ascended":
        return ultra
    if kind == "owned":
        return ast["id"] in owned
    if kind == "active":
        return ast["id"] in active
    if kind == "milestone":
        return ast["id"] in milestones
    if kind in ("all", "any"):
        values = (evaluate(child, owned, active, milestones, ultra) for child in ast["requirements"])
        return (all if kind == "all" else any)(values)
    raise ValueError(f"Unrecognized requirement kind: {kind}")


def validate(export, catalog, receipt):
    require(export["provenance"]["steamBuild"] == catalog["steamBuild"] == receipt["steamBuild"], "Steam build differs from reviewed native receipt")
    require(export["provenance"]["gameVersion"] == catalog["gameVersion"] == receipt["gameVersion"], "Game version differs from reviewed native receipt")
    source_hashes = {source["name"]: source["sha256"] for source in export["provenance"]["sourceFiles"]}
    require(source_hashes["GameAssembly.dll"] == receipt["gameAssemblySha256"], "Native assembly differs from reviewed source")
    require(source_hashes["global-metadata.dat"] == receipt["metadataSha256"], "Native metadata differs from reviewed source")

    native = {node["id"]: node for node in export["upgrades"]}
    normalized = {node["id"]: node for node in catalog["upgrades"]}
    require(len(native) == len(export["upgrades"]), "Duplicate native IDs in export")
    require(len(normalized) == len(catalog["upgrades"]), "Duplicate normalized native IDs")
    require(set(normalized) == set(native), "Catalog IDs differ from full asset registry")
    require(len(native) == export["provenance"]["coverage"]["registryCount"], "Registry coverage is incomplete")
    astral = export["namedSkills"]["AstralSlayer"]
    purchase_cases = reveal_cases = 0

    visiting = set()

    @lru_cache(maxsize=None)
    def ancestor(id):
        require(id not in visiting, f"Cyclic native prerequisite at {id}")
        visiting.add(id)
        found = False
        for parent in native[id]["requirements"]:
            require(parent in native, f"Missing native prerequisite {parent}")
            found = native[parent]["isAstral"] or ancestor(parent) or found
        visiting.remove(id)
        return found

    for id, node in native.items():
        expected_retention = "astral" if node["isAstral"] else "repeat"
        expected_activation = "after-ultra-ascension" if node["isAstral"] and node["astralLock"] else "immediate"
        require(normalized[id]["retention"] == expected_retention, f"Retention differs at {id}")
        require(normalized[id]["activation"] == expected_activation, f"Activation differs at {id}")
        parents = node["requirements"]
        crafted = node["craftableItemsRequirements"]
        for states in itertools.product((False, True), repeat=len(parents) + len(crafted) + 1):
            active = {parent for parent, state in zip(parents, states) if state}
            milestones = {item for item, state in zip(crafted, states[len(parents):]) if state}
            ultra = states[-1]
            expected = all(item in milestones for item in crafted)
            if expected:
                # Native CanBeBought returns from an active OR parent before
                # applying its final Ultra Ascension check. Empty lists start
                # with a true accumulator, including empty OR lists.
                accumulator = True
                returned = False
                for parent in parents:
                    if parent in active:
                        if not node["mandatoryRequirements"]:
                            returned = True
                            break
                    else:
                        accumulator = False
                expected = returned or (accumulator and (ultra or not node["ultraAscensionsRequired"]))
            actual = evaluate(normalized[id]["purchase"], active, active, milestones, ultra)
            require(expected == actual, f"Purchase differs at {id} for {states}: expected {expected}, got {actual}")
            purchase_cases += 1

        has_astral_ancestor = ancestor(id)
        for states in itertools.product((False, True), repeat=5):
            self_owned, astral_owned, ultra, required_upgrade, required_ascension = states
            # Astral Slayer's self and Astral ownership are the same flag.
            if id == astral and self_owned != astral_owned:
                continue
            owned = ({id} if self_owned else set()) | ({astral} if astral_owned else set())
            active = {node["requiredAscensionUpgrade"]} if required_ascension and node["requiredAscensionUpgrade"] else set()
            milestones = {node["requiredUpgrade"]} if required_upgrade and node["requiredUpgrade"] else set()
            if id == astral:
                tree = ultra
            elif node["isAstral"] or has_astral_ancestor:
                tree = astral_owned or self_owned
            else:
                tree = ultra or not node["ultraAscensionsRequired"]
            expected = tree and (required_upgrade or not node["requiredUpgrade"]) and (required_ascension or not node["requiredAscensionUpgrade"])
            actual = evaluate(normalized[id]["reveal"], owned, active, milestones, ultra)
            require(expected == actual, f"Reveal differs at {id} for {states}: expected {expected}, got {actual}")
            reveal_cases += 1

    expected_edges = {(parent, node["id"]) for node in native.values() for parent in node["requirements"]}
    actual_edges = {(edge["from"], edge["to"]) for edge in catalog["connections"]}
    require(expected_edges == actual_edges, "Connections differ from native prerequisite references")
    require(len(catalog["connections"]) == len(expected_edges), "Duplicate catalog connections")
    require(catalog["ultraAscension"] == {"kind": "active", "id": export["namedSkills"]["UltraAscension"]}, "Ultra Ascension condition differs")
    expected_grants = {(export["namedSkills"][source], export["namedSkills"][target]) for source, target in RETENTION_PAIRS}
    require(len(catalog["grants"]) == len(expected_grants), "Conditional retention count differs")
    require(all(grant["when"]["kind"] == "active" and len(grant["ids"]) == 1 for grant in catalog["grants"]), "Conditional retention must use one active source and one target")
    actual_grants = {(grant["when"]["id"], grant["ids"][0]) for grant in catalog["grants"]}
    require(expected_grants == actual_grants, "Conditional retention mappings differ")

    registry_order = {node["id"]: index for index, node in enumerate(export["upgrades"])}
    for source, target in expected_grants:
        require(native[source]["isAstral"], "Conditional retention source is not Astral")
        require(registry_order[source] < registry_order[target], "Activation-before-retention equivalence needs a renewed order review")

    return {
        "nativeNodes": len(native),
        "connections": len(expected_edges),
        "purchaseTruthTableCases": purchase_cases,
        "revealTruthTableCases": reveal_cases,
        "conditionalRetentionPairs": len(expected_grants),
        "coverageMatches": True,
        "purchasePredicatesMatch": True,
        "revealPredicatesMatch": True,
        "retentionAndActivationMatch": True,
        "ultraAscensionConditionMatches": True,
        "activationBeforeRetentionOrderMatches": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--native-receipt", type=Path, default=Path(__file__).with_name("native-method-receipt.json"))
    parser.add_argument("--receipt", type=Path, help="Optional sanitized JSON output; no raw exports are copied")
    args = parser.parse_args()
    export, catalog, native_receipt = map(read_json, (args.export, args.catalog, args.native_receipt))
    checks = validate(export, catalog, native_receipt)
    receipt = {
        "schemaVersion": 1,
        "method": "Independent exhaustive boolean evaluation of reviewed native purchase and reveal control flow; no native method execution",
        "steamBuild": catalog["steamBuild"],
        "gameVersion": catalog["gameVersion"],
        "catalogRevision": catalog["revision"],
        "catalogSha256": sha256(args.catalog),
        "assetExportSha256": sha256(args.export),
        "nativeMethodReceiptSha256": sha256(args.native_receipt),
        "validatorSha256": sha256(Path(__file__)),
        "checks": checks,
        "limits": [
            "This comparison relies on the separately reviewed native method interpretation; it does not infer semantics automatically.",
            "Manual milestone control visibility, removal, undo and storage are app policies tested separately.",
            "Descriptions and icons are reviewed by the separate asset-extraction workflow.",
        ],
    }
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8", newline="\n")
    cases = checks["purchaseTruthTableCases"] + checks["revealTruthTableCases"]
    print(f"PASS: {checks['nativeNodes']} exact native nodes, {checks['connections']} connections, {cases} exhaustive purchase/reveal cases; retention, activation, UA and four conditional mappings match.")


if __name__ == "__main__":
    main()
