"""Synthetic format checks for the actual bounded Village native readers."""
import struct
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/extract'))
from companion_shapes import Cursor, decimal, read_board


def text(value):
    raw=value.encode('utf8')
    result=struct.pack('<i',len(raw))+raw
    return result+b'\0'*((-len(result))%4)


def pointer(path_id):
    return struct.pack('<iq',0,path_id)


def condition(rid,name,payload=b''):
    return struct.pack('<q',rid)+text(name)+text('')+text('Assembly-CSharp' if name else '')+payload


def board(availability=-2,completion=-2,conditions=None,version=2):
    conditions=[condition(-2,'')] if conditions is None else conditions
    raw=b'\0'*28+text('Step_'+'a'*32)+text('village_board_invented')+pointer(0)+pointer(0)
    raw+=struct.pack('<qqiii',availability,completion,0,version,len(conditions))+b''.join(conditions)
    return SimpleNamespace(get_raw_data=lambda:raw)


class CompanionShapeTests(unittest.TestCase):
    def test_null_conditions_and_full_consumption(self):
        result=read_board(board(),'BoardStepSO')
        self.assertEqual(result['title'],'village_board_invented')
        self.assertEqual(result['conditions'],{'-2':None})
        self.assertEqual(result['subSteps'],[])

    def test_distinct_managed_all_and_native_targets(self):
        conditions=[condition(11,'AllOfCondition',struct.pack('<iqq',2,12,13)),condition(12,'PermanentCraftableItemCraftedCondition',pointer(42)),condition(13,'NpcDialogStateAtLeastCondition',pointer(43)+struct.pack('<i',7))]
        result=read_board(board(11,11,conditions),'BoardStepSO')
        self.assertEqual(result['conditions']['11']['conditions'],[12,13])
        self.assertEqual(result['conditions']['12']['target']['m_PathID'],42)
        self.assertEqual(result['conditions']['13']['value'],7)

    def test_missing_and_duplicate_references_fail_closed(self):
        with self.assertRaisesRegex(ValueError,'Unresolved'):
            read_board(board(99),'BoardStepSO')
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            read_board(board(conditions=[condition(-2,''),condition(-2,'')]),'BoardStepSO')

    def test_unreviewed_type_or_registry_version_fails(self):
        with self.assertRaisesRegex(ValueError,'Unreviewed'):
            read_board(board(11,11,[condition(11,'InventedCondition')]),'BoardStepSO')
        with self.assertRaisesRegex(ValueError,'Unsupported Unity'):
            read_board(board(version=3),'BoardStepSO')

    def test_trailing_bytes_and_invalid_strings_fail(self):
        item=board();raw=item.get_raw_data()+b'\0'
        with self.assertRaisesRegex(ValueError,'consume full'):
            read_board(SimpleNamespace(get_raw_data=lambda:raw),'BoardStepSO')
        for length in (-1,100):
            with self.assertRaises(ValueError):
                Cursor(struct.pack('<i',length),0).string()

    def test_exact_large_quantities_and_invalid_numbers(self):
        self.assertEqual(decimal('1e60'),'1'+'0'*60)
        self.assertEqual(decimal(0),'0')
        for value in ('-1','0.25','Infinity','NaN'):
            with self.assertRaises(ValueError):decimal(value)


if __name__=='__main__':
    unittest.main()
