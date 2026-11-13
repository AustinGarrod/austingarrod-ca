"""Index selected offline Cpp2IL methods and hash their original native bytes.

No game code is loaded or executed. This script reads files, parses the PE
section table, and emits local evidence. It does not infer semantic verification
from a successful tool run: the human-readable native rules require review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from pathlib import Path

TARGETS = {
    'AscensionSkill': ['Init', 'HasAstralAncestor', 'CanBeBought', 'IsActive', 'IsUnlocked', 'Reset', 'Unlock', 'GetDescription'],
    'AscensionSkillObject': ['CheckRequirements', 'CheckUltraOrAstral', 'CheckRequiredUpgrade', 'CheckRequiredAscensionUpgrade', 'SetActive', 'RefreshLinesColors', '<Start>b__17_0'],
    'AscensionManager': ['Ascend', 'GetAstralKeys', 'UltraAscendPopup', '<Ascend>b__0'],
    'PlayerInventory': ['Awake', 'CalculateValues'],
    'PermanentCraftableItem': ['AdditionalInit', 'IsActive'],
    'TemporaryCraftableItem': ['IsActive'],
    'SkillTreeManager': ['BuyAscensionSkill', 'AutoSizeContent'],
    'BenefitReferences': ['GetDescription'],
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pe_image(data: bytes) -> tuple[int, list[tuple[int, int, int]]]:
    pe = struct.unpack_from('<I', data, 0x3C)[0]
    if data[pe:pe + 4] != b'PE\0\0':
        raise ValueError('Not a PE image')
    count = struct.unpack_from('<H', data, pe + 6)[0]
    optional_size = struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    if struct.unpack_from('<H', data, optional)[0] != 0x20B:
        raise ValueError('Expected x64 PE32+ image')
    image_base = struct.unpack_from('<Q', data, optional + 24)[0]
    sections = []
    for index in range(count):
        entry = optional + optional_size + index * 40
        virtual_size, rva, raw_size, raw_start = struct.unpack_from('<IIII', data, entry + 8)
        sections.append((rva, max(virtual_size, raw_size), raw_start))
    return image_base, sections


def raw_offset(rva: int, sections: list[tuple[int, int, int]]) -> int:
    for start, size, raw in sections:
        if start <= rva < start + size:
            return raw + rva - start
    raise ValueError(f'RVA 0x{rva:X} lies outside PE sections')


def methods(cs: str) -> dict[str, tuple[int, int, str]]:
    # Attributes are Cpp2IL-derived mappings, never actual managed method bodies.
    expression = re.compile(r'\[Address\(RVA = "(0x[0-9A-Fa-f]+)", Offset = "0x[0-9A-Fa-f]+", Length = "(0x[0-9A-Fa-f]+)"\)\](.*?)\n\s*(?:public|private|protected|internal)[^\n]*?\s+([^\s(]+)\([^\n]*\)\s*\{', re.S)
    return {match[4]: (int(match[1], 16), int(match[2], 16), match[3]) for match in expression.finditer(cs)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--game-path', required=True, type=Path)
    parser.add_argument('--logic-root', default=Path('.local-game/logic'), type=Path)
    parser.add_argument('--check-receipt', type=Path, help='Fail when native inputs or selected bodies differ from this reviewed receipt.')
    args = parser.parse_args()
    local_root = args.logic_root.resolve()
    # Prevent accidental raw reconstructions being written into public/dist.
    if '.local-game' not in local_root.parts:
        raise ValueError('logic-root must be inside ignored .local-game')
    native = (args.game_path / 'GameAssembly.dll').read_bytes()
    metadata = (args.game_path / 'Idle Slayer_Data/il2cpp_data/Metadata/global-metadata.dat').read_bytes()
    image_base, sections = pe_image(native)
    cs_root = local_root / 'cs/DiffableCs/Assembly-CSharp'
    isil_root = local_root / 'isil/IsilDump/Assembly-CSharp'
    evidence_root = local_root / 'evidence'
    evidence_root.mkdir(parents=True, exist_ok=True)
    records = []
    for type_name, wanted in TARGETS.items():
        available = methods((cs_root / f'{type_name}.cs').read_text(encoding='utf-8-sig'))
        for text_path in sorted(isil_root.glob(f'{type_name}*.txt')):
            text = text_path.read_text(encoding='utf-8-sig')
            for block in text.split('\nMethod: ')[1:]:
                signature = block.split('\n', 1)[0]
                method_name = signature.split('(', 1)[0].rsplit(' ', 1)[-1]
                if method_name not in wanted or method_name not in available:
                    continue
                rva, length, _ = available[method_name]
                offset = raw_offset(rva, sections)
                body = native[offset:offset + length]
                if len(body) != length:
                    raise ValueError(f'Truncated native body: {type_name}.{method_name}')
                file_name = re.sub(r'[^A-Za-z0-9_.-]', '_', f'{type_name}.{method_name}') + '.txt'
                excerpt = f'Type: {type_name}\nRVA: 0x{rva:X}\nNative body SHA256: {sha256(body)}\nMethod: {block}'
                (evidence_root / file_name).write_text(excerpt, encoding='utf-8', newline="\n")
                records.append({'type': type_name, 'method': method_name, 'signature': signature, 'rva': f'0x{rva:X}', 'length': length, 'nativeBodySha256': sha256(body), 'evidenceFile': file_name})
    receipt = {
        'tool': 'Cpp2IL 2022.1.0-pre-release.21+58fc404ac503f4e512055cafc48c03088fc6e224',
        'toolUrl': 'https://github.com/SamboyCoding/Cpp2IL/releases/tag/2022.1.0-pre-release.21',
        'method': 'Offline PE/IL2CPP metadata interpretation; no game launch or method invocation',
        'gameAssemblySha256': sha256(native),
        'metadataSha256': sha256(metadata),
        'metadataVersion': struct.unpack_from('<I', metadata, 4)[0],
        'peImageBase': f'0x{image_base:X}',
        'semanticVerificationAutomatic': False,
        'methods': records,
    }
    (evidence_root / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8', newline="\n")
    print(f'Indexed {len(records)} native methods; local evidence: {evidence_root}')
    if args.check_receipt:
        reviewed = json.loads(args.check_receipt.read_text(encoding='utf-8'))
        for key in ['gameAssemblySha256', 'metadataSha256', 'metadataVersion']:
            if receipt[key] != reviewed[key]:
                raise ValueError(f'{key} differs from reviewed native-rule evidence; review this build before normalizing rules.')
        indexed = {(item['type'], item['method']): item for item in records}
        for method in reviewed['methods']:
            current = indexed.get((method['type'], method['method']))
            if current is None or any(current[key] != method[key] for key in ['rva', 'length', 'nativeBodySha256']):
                raise ValueError(f"Reviewed method differs or is missing: {method['type']}.{method['method']}")
        print('Reviewed native-input and method hashes match. Semantic changes still require manual review.')


if __name__ == '__main__':
    main()
