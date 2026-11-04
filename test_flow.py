import unittest
from unittest.mock import patch
import board
import flow
import ledger

class WorkflowTest(unittest.TestCase):
    def setUp(self):
        self.db=ledger.database(':memory:');flow.schema(self.db)
        self.addCleanup(self.db.close)
    def test_batch_version_and_rollback(self):
        specs=[]
        for req in ('A','B'):
            ledger.add(self.db,('Example',req),'Product Engineer','https://example.org/'+req)
            spec=dict(company='Example',req=req,summary='evaluation work',baseline='Engineering',
                      changes='clarified evaluation bullet',eligibility='verified from posting',pdf=__file__)
            specs.append(spec)
        with patch.object(ledger,'fingerprint',return_value='fixture'):
            with self.db: tokens=[flow.packet(self.db,s) for s in specs]
            with self.db: revised=flow.packet(self.db,dict(specs[1],summary='Revised scope'))
            with self.assertRaises(ValueError), self.db:flow.approve(self.db,tokens)
            self.assertEqual(ledger.row(self.db,('Example','A'))['stage'],'review')
            with self.db:flow.approve(self.db,[tokens[0],revised])
            self.assertEqual(ledger.row(self.db,('Example','B'))['stage'],'approved')
            self.assertIn('Revised scope',board.render(self.db))
    def test_geography(self):
        for location in ('Remote','London, UK','Remote in Germany, Remote in Russia','Toronto, ON, Canada','LA'):
            self.assertEqual(flow.us_location(location),'')
        self.assertEqual(flow.us_location('Toronto, ON, Canada, Hollywood, FL'),'Hollywood, FL')
        self.assertTrue(flow.us_location('Remote in USA'))
        self.assertFalse(flow.us_location('New York, NY','ca'))
    def test_discovery_repeat_rotation_and_exclusions(self):
        config=dict(include='product',country='US',sources=[dict(provider='community',board='simplify-new-grad')])
        rows=[dict(title='Product engineer',req='E1',company='Example',url='https://jobs.lever.co/example/E1',location='Boston, MA'),
              dict(title='Product engineer',req='E2',company='Example',url='https://jobs.lever.co/example/E2',location='London, UK')]
        with patch('discover.postings',return_value=rows):
            self.assertEqual(flow.scan(self.db,config)[0][4],1)
            second=flow.scan(self.db,config)
            self.assertEqual(len(second),2)
            self.assertEqual(sum(s[4] for s in second),0)
        self.assertEqual(self.db.execute('select count(*) from jobs').fetchone()[0],1)
