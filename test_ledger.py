import argparse
import sqlite3
import unittest
from unittest.mock import patch
import ledger

class ApplicationTest(unittest.TestCase):
    def setUp(self):
        self.db=ledger.database(":memory:")
        self.k=("Example","r1")
        with self.db: ledger.add(self.db,self.k,"Engineer","https://example.org/jobs/r1")
    def act(self,cmd,**kwargs):
        with self.db:
            return ledger.action(self.db,argparse.Namespace(cmd=cmd,company=self.k[0],req=self.k[1],**kwargs))
    def test_receipt_then_interview(self):
        with patch.object(ledger,'fingerprint',return_value='one'):
            self.act('prepare',pdf='sample.pdf')
            self.act('approve',pdf='sample.pdf',digest='one')
            with patch.object(ledger,'fingerprint',return_value='two'), self.assertRaises(ValueError): self.act('begin',pdf='sample.pdf')
            self.act('begin',pdf='sample.pdf')
            with self.assertRaises(ValueError): self.act('begin',pdf='sample.pdf')
        self.act('receipt',source='receipt',note='Confirmation page')
        self.act('stage',stage='interview',note='Invitation for round one')
        self.act('stage',stage='interview',note='Second round')
        self.assertEqual(len(self.act('history')),7)
    def test_manual_submission_and_import(self):
        self.act('submitted-elsewhere',source='user',note='Applicant confirmed')
        r=dict(company='Example',req='r1',title='Engineer',stage='rejected',note='Employer update')
        with self.db:
            self.assertEqual(ledger.import_rows(self.db,[r]),1)
            self.assertEqual(ledger.import_rows(self.db,[r]),0)
        with self.db, self.assertRaises(ValueError):
            ledger.import_rows(self.db,[dict(r,stage='applied')])
    def test_two_distinct_positions(self):
        with self.db: ledger.add(self.db,("Example","r2"),"Engineer","")
        with self.assertRaises(sqlite3.IntegrityError), self.db: ledger.add(self.db,("EXAMPLE","R1"),"Engineer","")
        self.assertEqual(self.db.execute('select count(*) from jobs').fetchone()[0],2)
    def tearDown(self): self.db.close()
