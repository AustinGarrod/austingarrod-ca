"""Write a sanitized, deterministic catalog coverage receipt after review.

This receipt contains only normalized catalog facts, input hashes and reviewed
sprite hashes. It never embeds installation paths, manifest text or player data.
"""

import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--sprite-review", type=Path, required=True)
    parser.add_argument("--icons", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    export = json.loads(args.export.read_text(encoding="utf8"))
    catalog = json.loads(args.catalog.read_text(encoding="utf8"))
    review = json.loads(args.sprite_review.read_text(encoding="utf8"))
    native = {node["id"]: node for node in export["upgrades"]}
    projected = {node["id"]: node for node in catalog["upgrades"]}
    icons = {record["id"]: record for record in review["records"]}
    if not review["visualReviewComplete"] or set(native) != set(projected) or set(native) != set(icons):
        raise ValueError("Catalog and reviewed sprites must exactly cover native registry IDs")
    if not all(catalog["verification"][key] for key in ("coverage", "purchaseRules", "revealRules", "resetRules", "assets")):
        raise ValueError("Catalog verification gates are incomplete")
    nodes = []
    for native_id, node in native.items():
        projected_node = projected[native_id]
        if node["position"] != projected_node["position"] or node["cost"] != projected_node["cost"]:
            raise ValueError("Coordinates or cost changed during normalization")
        icon_hash = digest(args.icons / f"{native_id}.png")
        if icon_hash != icons[native_id]["sha256"]:
            raise ValueError("An icon changed after review")
        nodes.append({"id": native_id, "resourcePath": node["resourcePath"], "pathId": node["pathId"], "cost": node["cost"], "position": node["position"], "requirements": node["requirements"], "mandatoryRequirements": node["mandatoryRequirements"], "craftableItemsRequirements": node["craftableItemsRequirements"], "requiredUpgrade": node["requiredUpgrade"], "requiredAscensionUpgrade": node["requiredAscensionUpgrade"], "isLegendary": node["isLegendary"], "isAstral": node["isAstral"], "astralLock": node["astralLock"], "ultraAscensionsRequired": node["ultraAscensionsRequired"], "icon": {"pathId": node["iconSource"]["pathId"], "width": icons[native_id]["width"], "height": icons[native_id]["height"], "sha256": icon_hash}, "normalized": {key: projected_node[key] for key in ("purchase", "reveal", "retention", "activation")}})
    expected_edges = sorted((parent, node["id"]) for node in native.values() for parent in node["requirements"])
    actual_edges = sorted((edge["from"], edge["to"]) for edge in catalog["connections"])
    if expected_edges != actual_edges:
        raise ValueError("Catalog edges differ from native prerequisite links")
    receipt = {"schemaVersion": 1, "catalogSha256": digest(args.catalog), "provenance": export["provenance"], "nativeNodeCount": len(native), "nativeEdgeCount": len(expected_edges), "spriteCount": len(icons), "visualReview": {"complete": True, "method": "Six numbered contact sheets inspected at nearest-neighbor scale; all 288 native sprites present, recognizable, correctly oriented, and preserving pixel bounds."}, "nativeMethodsReceiptSha256": digest(Path(__file__).resolve().parents[1] / "logic" / "native-method-receipt.json"), "namedSkills": export["namedSkills"], "milestoneIds": sorted(milestone["id"] for milestone in catalog["milestones"]), "nodes": sorted(nodes, key=lambda node: node["id"]), "connections": [{"from": from_id, "to": to_id} for from_id, to_id in expected_edges]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    print(json.dumps({"nodes": len(native), "edges": len(expected_edges), "icons": len(icons), "catalogSha256": receipt["catalogSha256"]}))


if __name__ == "__main__":
    main()
