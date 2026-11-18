"""Bounded native static-shape readers; standard library only."""
from __future__ import annotations

import struct
from decimal import Decimal

def decimal(value):
    value = Decimal(str(value))
    if not value.is_finite() or value < 0 or value != value.to_integral_value():
        raise ValueError('Expected a non-negative native integer')
    return format(value, 'f').split('.')[0]


class Cursor:
    def __init__(self, raw, offset=28):
        self.raw, self.offset = raw, offset

    def read(self, fmt):
        value = struct.unpack_from('<' + fmt, self.raw, self.offset)
        self.offset += struct.calcsize('<' + fmt)
        return value[0] if len(value) == 1 else value

    def string(self):
        size = self.read('i')
        if not 0 <= size <= len(self.raw) - self.offset:
            raise ValueError('Invalid native string')
        value = self.raw[self.offset:self.offset + size].decode('utf8')
        self.offset = (self.offset + size + 3) & ~3
        return value

    def pointer(self):
        file_id, path_id = self.read('iq')
        if file_id != 0:
            raise ValueError('Unexpected companion cross-file resource reference')
        return {'m_FileID': file_id, 'm_PathID': path_id}


def read_board(obj, class_name):
    """Decode Unity managed-reference registry v2 with bounded known shapes."""
    cursor = Cursor(obj.get_raw_data())
    data = {'m_Name': cursor.string(), 'title': cursor.string(), 'questNpc': cursor.pointer(), 'questMap': cursor.pointer()}
    if class_name == 'BoardStepSO':
        data['availability'] = cursor.read('q')
    data['completion'] = cursor.read('q')
    if class_name == 'BoardStepSO':
        count = cursor.read('i')
        if not 0 <= count <= 100:
            raise ValueError('Unsupported Village substep bound')
        data['subSteps'] = [cursor.pointer() for _ in range(count)]
    version, count = cursor.read('ii')
    if version != 2 or not 0 <= count <= 100:
        raise ValueError('Unsupported Unity managed reference registry')
    conditions = {}
    for _ in range(count):
        rid, name, namespace, assembly = cursor.read('q'), cursor.string(), cursor.string(), cursor.string()
        if str(rid) in conditions:
            raise ValueError('Duplicate Village condition reference')
        if rid == -2 and not name:
            conditions[str(rid)] = None
            continue
        if namespace or assembly != 'Assembly-CSharp':
            raise ValueError('Unknown Village condition assembly')
        condition = {'class': name}
        if name == 'AllOfCondition':
            length = cursor.read('i')
            if not 0 <= length <= 100:
                raise ValueError('Unsupported Village condition array')
            condition['conditions'] = [cursor.read('q') for _ in range(length)]
        elif name in ('NpcDialogStateAtLeastCondition', 'KeyArmoryItemLevelCondition'):
            condition['target'] = cursor.pointer()
            condition['value'] = cursor.read('i')
        elif name == 'ODMGearMapTimerCondition':
            condition['target'] = cursor.pointer()
            condition['value'] = cursor.read('f')
        elif name in ('UpgradeBoughtCondition', 'PermanentCraftableItemCraftedCondition', 'UpgradableBuildingBuiltCondition', 'KeyArmoryItemUnlockedCondition', 'InteractiveObjectCompletedCondition', 'ODMGearMapCompletedCondition'):
            condition['target'] = cursor.pointer()
        else:
            raise ValueError(f'Unreviewed Village condition: {name}')
        conditions[str(rid)] = condition
    if cursor.offset != len(cursor.raw):
        raise ValueError('Village condition parse did not consume full asset')
    references=[data['completion']]+([data['availability']] if 'availability' in data else [])
    references += [rid for condition in conditions.values() if condition and condition['class']=='AllOfCondition' for rid in condition['conditions']]
    if any(rid != -2 and str(rid) not in conditions for rid in references):
        raise ValueError('Unresolved Village condition reference')
    data['conditions'] = conditions
    return data
