import base64
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import os
import tempfile
import unittest
from unittest.mock import patch
import board
import flow
import ledger
import prepare_bridge as bridge

class PrepareTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.resumes=self.root/"resumes";self.company=self.resumes/"Example"
        (self.company/"_source").mkdir(parents=True)
        self.pdf=self.company/"approved.pdf";self.pdf.write_bytes(b"%PDF-1.4\nsynthetic test only\n%%EOF")
        self.url="https://job-boards.greenhouse.io/example/jobs/123"
        self.dbpath=self.root/"db.sqlite3"
        self.db=ledger.database(self.dbpath);flow.schema(self.db)
        self.addCleanup(self.db.close)
        self.spec=dict(company="Example",req="123",summary="synthetic",baseline="fixture",
            changes="none",eligibility="fixture",pdf=str(self.pdf),url=self.url)
        with self.db:
            ledger.add(self.db,("Example","123"),"Example Engineer",self.url)
            self.token=flow.packet(self.db,self.spec);flow.approve(self.db,[self.token])
        self.disk=self.company/"_source/application_packet.json"
        self.disk.write_text(json.dumps(dict(self.spec,status="approved_pending_submission",
            submission_authorized=True,sha256=ledger.fingerprint(self.pdf))))
        self.answers=self.root/"answers.json"
        self.answers.write_text(json.dumps(dict(common=[dict(label="First Name",kind="text",value="Test",confirmed=True)],jobs={})))
        self.config=dict(db=str(self.dbpath),resume_root=str(self.resumes),answers=str(self.answers),
            master=str(self.root/"master.xlsx"),board_output=str(self.root/"board.html"))
        self.guard=patch.object(bridge,"master_duplicates")
        self.guard.start();self.addCleanup(self.guard.stop)
        self.b=bridge.Bridge(self.config);self.addCleanup(self.b.close)

    def prepare(self):
        return self.b.handle(dict(op="prepare",url=self.url))
    def test_end_to_end_without_submission(self):
        meta=self.prepare()
        chunk=self.b.handle(dict(op="chunk",url=self.url,run=meta["run"],offset=0))
        self.assertEqual(base64.b64decode(chunk["base64"]),self.pdf.read_bytes())
        report=dict(status="verified",fileVerified=True,matched=1,verified=1,pending=0,unknownRequired=0)
        result=self.b.handle(dict(op="report",url=self.url,run=meta["run"],report=report))
        self.assertTrue(result["recorded"]);self.assertTrue(result["boardRefreshed"])
        self.assertEqual(ledger.row(self.db,("Example","123"))["stage"],"approved")
        self.assertIn("未提交",Path(self.config["board_output"]).read_text())
        self.assertNotIn('"Test"',Path(self.config["board_output"]).read_text())
        with self.assertRaises(bridge.Refused):
            self.b.handle(dict(op="chunk",url=self.url,run=meta["run"],offset=0))

    def test_unapproved_and_applied(self):
        for stage in ("review","applied","awaiting_receipt","skipped"):
            with self.db:self.db.execute("UPDATE jobs SET stage=?",(stage,))
            with self.assertRaises(bridge.Refused):self.prepare()
    def test_wrong_company_and_job(self):
        for url in (self.url.replace("example","other"),self.url.replace("123","124")):
            with self.assertRaises(bridge.Refused):self.b.handle(dict(op="prepare",url=url))
    def test_changed_pdf_and_path_escape(self):
        self.pdf.write_bytes(b"%PDF-1.4\nchanged")
        with self.assertRaises(bridge.Refused):self.prepare()
        with self.assertRaises(bridge.Refused):bridge.inside(self.answers,self.resumes)
    def test_symlink_escape(self):
        p=self.company/"escape.pdf";p.symlink_to(self.answers)
        with self.assertRaises(bridge.Refused):bridge.inside(p,self.resumes)
    def test_disk_revoke_and_digest_mismatch(self):
        s=json.loads(self.disk.read_text());s["submission_authorized"]=False;self.disk.write_text(json.dumps(s))
        with self.assertRaises(bridge.Refused):self.prepare()
        s["submission_authorized"]=True;s["sha256"]="0"*64;self.disk.write_text(json.dumps(s))
        with self.assertRaises(bridge.Refused):self.prepare()
    def test_ledger_packet_changed(self):
        with self.db:self.db.execute("UPDATE packets SET content=content||' '")
        with self.assertRaises(bridge.Refused):self.prepare()
    def test_dedup_guard_fails_closed(self):
        with patch.object(bridge,"master_duplicates",side_effect=bridge.Refused("already applied")):
            with self.assertRaises(bridge.Refused):self.prepare()
    def test_revocation_between_chunks(self):
        meta=self.prepare()
        with self.db:self.db.execute("UPDATE jobs SET stage='applied'")
        with self.assertRaises(bridge.Refused):
            self.b.handle(dict(op="chunk",url=self.url,run=meta["run"],offset=0))
    def test_no_submit_or_arbitrary_read(self):
        for op in ("submit","read","shell","receipt","approve"):
            with self.assertRaises(bridge.Refused):self.b.handle(dict(op=op,path="/etc/passwd"))
    def test_expiration_and_report_validation(self):
        meta=self.prepare()
        invalid=dict(status="verified",fileVerified=False,matched=1,verified=1,pending=0,unknownRequired=0)
        with self.assertRaises(bridge.Refused):
            self.b.handle(dict(op="report",url=self.url,run=meta["run"],report=invalid))
        with self.b.db:self.b.db.execute("UPDATE preparation_runs SET created=0")
        with self.assertRaises(bridge.Refused):
            self.b.handle(dict(op="chunk",url=self.url,run=meta["run"],offset=0))
    def test_consent_never_automatic(self):
        self.answers.write_text(json.dumps(dict(common=[dict(label="Privacy consent",value="Yes",kind="radio",confirmed=True)])))
        with self.assertRaises(bridge.Refused):self.prepare()
    def test_duplicate_run_blocked(self):
        self.prepare()
        with self.assertRaises(bridge.Refused):self.prepare()
    def test_answers_change_invalidates_active_run(self):
        meta=self.prepare()
        self.answers.write_text(json.dumps(dict(common=[dict(label="First Name",kind="text",value="Revised",confirmed=True)])))
        with self.assertRaises(bridge.Refused):
            self.b.handle(dict(op="chunk",url=self.url,run=meta["run"],offset=0))
    def test_missing_matching_approval_event(self):
        with self.db:self.db.execute("UPDATE events SET note='different' WHERE stage='approved'")
        with self.assertRaises(bridge.Refused):self.prepare()
    def test_native_protocol(self):
        body=json.dumps(dict(op="prepare",url=self.url)).encode()
        out=io.BytesIO()
        bridge.serve(self.config,io.BytesIO(struct.pack("=I",len(body))+body),out)
        raw=out.getvalue();size=struct.unpack("=I",raw[:4])[0]
        result=json.loads(raw[4:]);self.assertEqual(size,len(raw)-4);self.assertTrue(result["ok"])
        for raw in (b"x",struct.pack("=I",999999),struct.pack("=I",10)+b"{}"):
            with self.assertRaises(bridge.Refused):bridge.read_message(io.BytesIO(raw))
    def test_install_and_real_native_subprocess(self):
        from openpyxl import Workbook
        master=Path(self.config["master"])
        book=Workbook(); sheet=book.active;sheet.title="投递去重统计"
        sheet.append(["去重键","公司","准确岗位","岗位编号／标识","计入累计"])
        sheet.append(["fixture","Other","Other","999",1]);book.save(master)
        config=self.root/"private-config.json";config.write_text(json.dumps(self.config))
        origin="chrome-extension://"+"a"*32+"/"
        install=self.root/"native with spaces"
        hosts=self.root/"hosts"
        env={"PATH":"/usr/bin:/bin","PYTHON_DOTENV_DISABLED":"1","PYTHONDONTWRITEBYTECODE":"1"}
        subprocess.run([sys.executable,"-B",str(Path(__file__).parent/"extension/install_host.py"),
                        "--extension-id","a"*32,"--config",str(config),
                        "--install-dir",str(install),"--host-dir",str(hosts)],
                       check=True,capture_output=True,env=env)
        manifest=json.loads((hosts/"org.application_ledger.prepare.json").read_text())
        self.assertEqual(manifest["allowed_origins"],[origin])
        self.assertEqual((install/"config.json").stat().st_mode & 0o777,0o600)
        body=json.dumps(dict(op="prepare",url=self.url)).encode()
        framed=struct.pack("=I",len(body))+body
        result=subprocess.run([str(install/"prepare-host"),origin],input=framed,capture_output=True,check=True,env=env)
        data=json.loads(result.stdout[4:])
        self.assertTrue(data["ok"]);self.assertEqual(data["data"]["sha256"],ledger.fingerprint(self.pdf))
        bad=subprocess.run([str(install/"prepare-host"),"chrome-extension://"+"b"*32+"/"],input=framed,capture_output=True,env=env)
        self.assertNotEqual(bad.returncode,0);self.assertEqual(bad.stdout,b"")
    def test_chunk_bounds(self):
        meta=self.prepare()
        for offset in (-1,1,True,999999,"0"):
            with self.assertRaises(bridge.Refused):
                self.b.handle(dict(op="chunk",url=self.url,run=meta["run"],offset=offset))
    def test_url_rules(self):
        self.assertEqual(bridge.identity(self.url+"?gh_src=x"),"greenhouse/example/123")
        self.assertEqual(bridge.identity("https://boards.greenhouse.io/embed/job_app?for=example&token=123"),"greenhouse/example/123")
        self.assertEqual(bridge.identity("https://jobs.ashbyhq.com/demo/12345678-1234-1234-1234-123456789abc/application"),"ashby/demo/12345678-1234-1234-1234-123456789abc")
        for url in ("https://evil.example/example/jobs/123","http://job-boards.greenhouse.io/example/jobs/123",
            self.url+"#other","https://boards.greenhouse.io/embed/job_app?for=a&for=b&token=123"):
            with self.assertRaises(bridge.Refused):bridge.identity(url)

class MasterTest(unittest.TestCase):
    def test_real_workbook_read_only_and_duplicate(self):
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"master.xlsx"
            w=Workbook();s=w.active;s.title="投递去重统计"
            s.append(["去重键","公司","准确岗位","岗位编号／标识","计入累计"])
            s.append(["x","Applied Co","Engineer","999",1]);w.save(path)
            before=path.read_bytes()
            bridge.master_duplicates(path,"Example","Engineer","123")
            with self.assertRaises(bridge.Refused):bridge.master_duplicates(path,"Example","Engineer","999")
            self.assertEqual(path.read_bytes(),before)

if __name__=="__main__":unittest.main()
