"""Hash reviewed companion/import native methods without loading game code."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

MODULE_PATH=Path(__file__).with_name('inspect-methods.py')
SPEC=importlib.util.spec_from_file_location('native_method_index',MODULE_PATH)
NATIVE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)

TARGETS={
    'Achievement':['Init','GetDescription'],
    'AchievementManager':['AchievementCells','ShowAchievement'],
    'CraftableItem':['HasAllMaterialsUnlocked','HasAtLeastOneMaterialUnlocked','HasRequiredAscensionUpgrades','HasRequiredItems','HasRequiredUpgrades','HasRequiredCharacterSkins'],
    'PermanentCraftableItem':['AdditionalInit','IsActive','TabVisible'],
    'TemporaryCraftableItem':['AdditionalInit','GetRequirements','TabVisible','ExtraCondition'],
    'Drop':['Init','AddDrop'],
    'Quest':['Init','IsCompleted','CanBeClaimed','BundleBought','ResetProgress'],
    'Divinity':['Init','IsAvailable'],
    'Divinities':['CheckUnlocked'],
    'DivinityObject':['Open'],
    'Enemy':['Init','GetTotalKillCount'],
    'BestiaryManager':['GetEnemyBestiaryTier','GetTierKillCountTargets'],
    'UpgradableBuilding':['Init','CanBeBuilt'],
    'BoardStepSO':['IsAvailable','IsCompleted'],
    'BoardSubStepSO':['IsCompleted'],
    'SaveManager':['GetInt','GetString'],
    'PlayerInventory':['CalculateValues'],
}
FIRSTPASS={'FileBasedPrefs':['GetCurrentSaveBytes','GetSaveFile','DataScrambler','GetInt','GetString','CreateNewSaveFile'],'FileBasedPrefsSaveFileModel':['FileBasedPrefsSaveFileModel']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-path',type=Path,required=True)
    parser.add_argument('--logic-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    native=(args.game_path/'GameAssembly.dll').read_bytes()
    metadata=(args.game_path/'Idle Slayer_Data/il2cpp_data/Metadata/global-metadata.dat').read_bytes()
    _,sections=NATIVE.pe_image(native)
    records=[]
    for assembly,targets in (('Assembly-CSharp',TARGETS),('Assembly-CSharp-firstpass',FIRSTPASS)):
        for class_name,wanted in targets.items():
            source=args.logic_root/'cs/DiffableCs'/assembly/(class_name+'.cs')
            methods=NATIVE.methods(source.read_text(encoding='utf-8-sig'))
            for name in wanted:
                if name not in methods:
                    raise ValueError('Missing reviewed native method: '+class_name+'.'+name)
                rva,length,_=methods[name]
                offset=NATIVE.raw_offset(rva,sections)
                body=native[offset:offset+length]
                if len(body)!=length:raise ValueError('Truncated native method body')
                records.append({'assembly':assembly,'type':class_name,'method':name,'rva':f'0x{rva:X}','length':length,'nativeBodySha256':hashlib.sha256(body).hexdigest()})
    receipt={'schemaVersion':1,'gameVersion':'7.3.4','steamBuild':'25810322','reviewDate':'2026-10-16','method':'Read-only PE and IL2CPP metadata interpretation with Cpp2IL 2022.1.0-pre-release.21; no game launch, native invocation or player-save access','gameAssemblySha256':hashlib.sha256(native).hexdigest(),'metadataSha256':hashlib.sha256(metadata).hexdigest(),'semanticVerificationAutomatic':False,'reviewedSemantics':'docs/companion-native-review.md','methods':records}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8',newline='\n')
    print(json.dumps({'reviewedMethodBodies':len(records)}))


if __name__=='__main__':
    main()
