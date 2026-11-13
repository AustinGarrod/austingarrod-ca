"""Read installed Unity assets without launching the game or accessing player saves.

Only writes an inspection export and individual tree sprites inside .local-game.
The export preserves serialized rule fields; it does not infer runtime rules.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import struct
from decimal import Decimal
from pathlib import Path

from private_paths import PRIVATE_ROOT, REPOSITORY, only_private_output

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else _hash(stream)


def _hash(stream) -> str:
    digest = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
    return digest.hexdigest()


def decimal_string(value: float) -> str:
    """Expand Python's shortest round-trip representation of a native double.

    This records the game's serialized double value, not a guessed higher-
    precision cost. Decimal strings avoid a further JavaScript number conversion.
    """
    if not value >= 0 or not value < float("inf"):
        raise ValueError("Cost must be finite and non-negative")
    return format(Decimal(str(value)), "f").split(".")[0]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--dummy-assemblies", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=REPOSITORY / ".local-game" / "asset-export")
    args = parser.parse_args()
    output = only_private_output(args.output)
    data_root = args.game_root / "Idle Slayer_Data"
    if not (data_root / "resources.assets").is_file():
        raise ValueError("Missing Idle Slayer_Data/resources.assets")
    if output.is_relative_to(args.game_root.resolve()):
        raise ValueError("Never write inside the installed game")
    output.mkdir(parents=True, exist_ok=True)
    icons = output / "icons"
    icons.mkdir(exist_ok=True)

    manifest = args.manifest.read_text(encoding="utf8")
    # Explicit allowlist: no Steam user IDs, timestamps, paths or player state.
    steam = {}
    for field in ("appid", "buildid"):
        match = re.search(r'"' + field + r'"\s+"(\d+)"', manifest)
        if not match:
            raise ValueError(f"Steam manifest is missing {field}")
        steam[field] = match.group(1)
    if steam["appid"] != "1353300":
        raise ValueError("The manifest is not for Idle Slayer")

    globals_env = UnityPy.load(str(data_root / "globalgamemanagers"))
    resource_manager = next(obj for obj in globals_env.objects if obj.type.name == "ResourceManager")
    registry = resource_manager.parse_as_dict()["m_Container"]
    tree_registry = [(path, pointer) for path, pointer in registry if path.startswith("ascension skills/")]
    player_settings = next(obj for obj in globals_env.objects if obj.type.name == "PlayerSettings")
    # UnityPy's built-in PlayerSettings definition misses four unrelated trailing
    # bytes in Unity 6000.3.14f1; bundleVersion is earlier in the record.
    version = player_settings.parse_as_dict(check_read=False)["bundleVersion"]

    scripts_env = UnityPy.load(str(data_root / "globalgamemanagers.assets"))
    scripts = {obj.path_id: obj.parse_as_dict() for obj in scripts_env.objects if obj.type.name == "MonoScript"}
    resources_env = UnityPy.load(str(data_root / "resources.assets"))
    unity_version = next(iter(resources_env.objects)).assets_file.unity_version
    generator = TypeTreeGenerator(unity_version)
    generator.load_local_dll_folder(str(args.dummy_assemblies))
    resources_env.typetree_generator = generator
    resources_objects = resources_env.file.objects

    def class_name(obj) -> str:
        if obj.type.name != "MonoBehaviour":
            return obj.type.name
        # The generated root type tree misaligns m_Enabled/m_Script, whereas
        # custom serialized fields parse correctly. Read only the fixed native
        # MonoBehaviour header here and discard all generated base fields.
        file_id, path_id = struct.unpack_from("<iq", obj.get_raw_data(), 16)
        if file_id != 1 or path_id not in scripts:
            # Unrelated missing/built-in scripts are not catalog inputs.
            return "UnresolvedMonoBehaviour"
        return scripts[path_id]["m_ClassName"]

    def read_local(pointer):
        if pointer["m_PathID"] == 0:
            return None
        if pointer["m_FileID"] != 0:
            raise ValueError("Unexpected cross-file reference")
        obj = resources_objects[pointer["m_PathID"]]
        return obj, obj.parse_as_dict()

    localization_obj = next(obj for obj in resources_env.objects if obj.type.name == "TextAsset" and obj.peek_name() == "en-US")
    localization = dict(csv.reader(io.StringIO(localization_obj.parse_as_dict()["m_Script"])))
    def title(data):
        return localization.get(data.get("name", ""), data.get("m_Name", ""))

    decoded = {}
    paths = {}
    for resource_path, pointer in tree_registry:
        if pointer["m_FileID"] != 2:
            raise ValueError("Unexpected registry resources file index")
        obj = resources_objects[pointer["m_PathID"]]
        if class_name(obj) != "AscensionSkill":
            raise ValueError("Registry contains a non-AscensionSkill object")
        decoded[obj.path_id] = obj.parse_as_dict()
        paths[obj.path_id] = resource_path
    all_ascension_objects = {obj.path_id for obj in resources_env.objects if obj.type.name == "MonoBehaviour" and class_name(obj) == "AscensionSkill"}
    if set(decoded) != all_ascension_objects:
        raise ValueError("Registry does not cover all AscensionSkill assets")
    native_ids = {path_id: data["id"] for path_id, data in decoded.items()}
    if len(set(native_ids.values())) != len(native_ids):
        raise ValueError("Duplicate native upgrade ID")

    def node_reference(pointer):
        if pointer["m_PathID"] == 0:
            return None
        if pointer["m_FileID"] != 0 or pointer["m_PathID"] not in native_ids:
            raise ValueError("An AscensionSkill requirement is absent from the catalog")
        return native_ids[pointer["m_PathID"]]

    milestones = {}
    references = {}
    def describe_reference(pointer, milestone=False):
        if pointer["m_PathID"] == 0:
            return None
        if pointer["m_FileID"] != 0:
            raise ValueError("Unexpected cross-file description reference")
        obj = resources_objects[pointer["m_PathID"]]
        parsed_completely = True
        if milestone or class_name(obj) == "NewBenefit":
            data = obj.parse_as_dict()
        else:
            # Only leading ID/label fields of supplementary description targets
            # are needed. Do not deserialize unverified unrelated type trees:
            # misaligned array counts may allocate excessively before failing.
            raw = obj.get_raw_data()
            def string_at(offset):
                length = struct.unpack_from("<i", raw, offset)[0]
                if not 0 <= length <= len(raw) - offset - 4:
                    raise ValueError("Invalid leading reference label")
                end = offset + 4 + length
                return raw[offset + 4:end].decode("utf8"), (end + 3) & ~3
            asset_name, offset = string_at(28)
            data = {"m_Name": asset_name}
            try:
                native_id, offset = string_at(offset)
                name_key, offset = string_at(offset)
                if re.fullmatch(r"[a-z0-9]{20}", native_id) and name_key in localization:
                    data.update({"id": native_id, "name": name_key})
            except (ValueError, EOFError):
                pass
            parsed_completely = False
        record = {
            "id": data.get("id"), "title": title(data), "nativeClass": class_name(obj),
            "pathId": obj.path_id, "descriptionKey": data.get("description", ""),
            "description": localization.get(data.get("description", ""), ""),
            "fullyParsed": parsed_completely,
        }
        if milestone:
            milestones[record["id"]] = record
        references[obj.path_id] = record
        return record

    upgrades = []
    for path_id, data in decoded.items():
        if not re.fullmatch(r"[a-z0-9]+", data["id"]):
            raise ValueError("Unsafe native ID for exported sprite filename")
        icon_obj, icon_data = read_local(data["icon"])
        if icon_obj.type.name != "Sprite":
            raise ValueError("Upgrade icon is not a Sprite")
        image = icon_obj.parse_as_object().image
        image.save(icons / f"{data['id']}.png")
        benefit = data["newBenefit"]
        benefit_ref = describe_reference(benefit["benefit"])
        parameters = {key: benefit[key] for key in ("value", "value2")}
        for key in ("minion", "map", "equipment", "enemy", "enemyType", "character", "stoneOfTime", "npc", "craftableItem", "drop", "loadoutType"):
            parameters[key] = describe_reference(benefit[key])
        upgrades.append({
            "id": data["id"], "title": title(data), "titleKey": data["name"],
            "descriptionKey": data["description"],
            "description": localization.get(data["description"], ""),
            "benefit": benefit_ref, "benefitParameters": parameters,
            "cost": decimal_string(data["cost"]), "position": data["position"],
            "requirements": [node_reference(pointer) for pointer in data["requirements"]],
            "mandatoryRequirements": bool(data["mandatoryRequirements"]),
            "craftableItemsRequirements": [describe_reference(pointer, True)["id"] for pointer in data["craftableItemsRequirements"]],
            "requiredUpgrade": (describe_reference(data["requiredUpgrade"], True) or {}).get("id"),
            "requiredAscensionUpgrade": node_reference(data["requiredAscensionUpgrade"]),
            "isLegendary": bool(data["isLegendary"]), "isAstral": bool(data["isAstral"]),
            "astralLock": bool(data["astralLock"]), "ultraAscensionsRequired": data["ultraAscensionsRequired"],
            "icon": f"icons/{data['id']}.png", "iconSource": {"pathId": icon_obj.path_id, "name": icon_data["m_Name"], "width": image.width, "height": image.height},
            "resourcePath": paths[path_id], "pathId": path_id,
        })

    scene = UnityPy.load(str(data_root / "level2"))
    scene.typetree_generator = generator
    singleton_objects = [obj for obj in scene.objects if obj.type.name == "MonoBehaviour" and class_name(obj) == "AscensionSkills"]
    if len(singleton_objects) != 1:
        raise ValueError("Expected one AscensionSkills singleton")
    singleton = singleton_objects[0].parse_as_dict()
    named_skills = {key: native_ids[pointer["m_PathID"]] for key, pointer in singleton.items() if not key.startswith("m_") and pointer["m_PathID"] != 0}
    provenance = {
        "appid": steam["appid"], "steamBuild": steam["buildid"], "gameVersion": version,
        "unityVersion": unity_version, "unityPyVersion": UnityPy.__version__, "typeTreeGeneratorApiVersion": "0.0.10",
        "coverage": {"registryCount": len(tree_registry), "assetCount": len(decoded), "uniqueNativeIds": len(set(native_ids.values())), "registryPrefix": "ascension skills/"},
        "sourceFiles": [{"name": path.name, "sha256": sha256(path)} for path in (data_root / "globalgamemanagers", data_root / "globalgamemanagers.assets", data_root / "resources.assets", data_root / "level2", args.game_root / "GameAssembly.dll", data_root / "il2cpp_data" / "Metadata" / "global-metadata.dat")],
        "sources": ["https://github.com/K0lb3/UnityPy", "https://github.com/SamboyCoding/Cpp2IL", "https://store.steampowered.com/app/1353300/Idle_Slayer/"],
        "costRepresentation": "Decimal expansion of shortest round-trip native serialized double; never imported as JavaScript number.",
        "limitations": ["Serialized field extraction establishes coverage, references, coordinates and icons; runtime rule verification and description formatting are separate.", "Generated MonoBehaviour base header fields are discarded; fixed native script pointers select the generated custom type tree.", "PlayerSettings bundleVersion parsed with a four-byte unrelated tail mismatch tolerated.", "No player saves or game state were read."],
    }
    export = {"provenance": provenance, "upgrades": upgrades, "milestones": sorted(milestones.values(), key=lambda record: record["id"]), "namedSkills": named_skills, "references": list(references.values())}
    (output / "asset-export.json").write_text(json.dumps(export, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    (output / "localization-en-US.json").write_text(json.dumps(localization, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    print(json.dumps({"gameVersion": version, "steamBuild": steam["buildid"], "upgrades": len(upgrades), "milestones": len(milestones), "icons": len(upgrades), "legendary": sum(upgrade["isLegendary"] for upgrade in upgrades), "astral": sum(upgrade["isAstral"] for upgrade in upgrades)}, indent=2))


if __name__ == "__main__":
    main()
