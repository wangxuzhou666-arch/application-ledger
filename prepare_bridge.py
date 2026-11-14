"""Native messaging bridge: approved resume preparation only, never submission.
All paths come from a private config, never from browser requests.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import struct
import sys
import time
from urllib.parse import parse_qs, urlsplit

MAX_PDF = 8 * 1024 * 1024
CHUNK = 256 * 1024
MAX_MESSAGE = 64 * 1024
HOST_NAME = "org.application_ledger.prepare"
STATES = {"verified", "needs_attention", "failed"}
PROTECTED = re.compile(r"privacy|consent|agree|signature|certif|attest|captcha|race|ethnic|gender|disab|veteran", re.I)

class Refused(ValueError):
    pass

def identity(url):
    u = urlsplit(url)
    if u.scheme != "https" or u.username or u.password or u.port or u.fragment:
        raise Refused("Unsupported job URL")
    parts = u.path.strip("/").split("/")
    if u.hostname == "jobs.ashbyhq.com":
        if len(parts) not in (2, 3) or (len(parts) == 3 and parts[2] != "application"):
            raise Refused("Open the official Ashby job/application")
        board, req = parts[:2]
        if not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", req):
            raise Refused("Invalid Ashby job")
        provider = "ashby"
    elif u.hostname in {"boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"}:
        if parts == ["embed", "job_app"]:
            q = parse_qs(u.query)
            if len(q.get("for", [])) != 1 or len(q.get("token", [])) != 1:
                raise Refused("Ambiguous embedded job")
            board, req = q["for"][0], q["token"][0]
        elif len(parts) == 3 and parts[1] == "jobs":
            board, req = parts[0], parts[2]
        else:
            raise Refused("Open the official Greenhouse application")
        if not req.isdigit():
            raise Refused("Invalid Greenhouse job")
        provider = "greenhouse-eu" if u.hostname == "job-boards.eu.greenhouse.io" else "greenhouse"
    else:
        raise Refused("Only Greenhouse and Ashby are supported")
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", board):
        raise Refused("Invalid board")
    return "/".join((provider, board.lower(), req.lower()))

def bounded_json(path, limit=512 * 1024):
    path = Path(path)
    with path.open("rb") as stream:
        data = stream.read(limit+1)
    if len(data) > limit:
        raise Refused("Configuration/packet too large")
    return json.loads(data.decode("utf-8"))

def inside(path, root):
    p = Path(path).expanduser().resolve(strict=True)
    if root not in p.parents:
        raise Refused("File outside the configured resume root")
    return p

def schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS preparation_runs (
      run TEXT PRIMARY KEY, employer TEXT, requisition TEXT, token TEXT, digest TEXT,
      identity TEXT, fields_digest TEXT, created REAL, status TEXT DEFAULT 'started', report TEXT DEFAULT '{}');
    """)
    if "fields_digest" not in {r[1] for r in db.execute("PRAGMA table_info(preparation_runs)")}:
        db.execute("ALTER TABLE preparation_runs ADD COLUMN fields_digest TEXT")

def fields_digest(fields):
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()

def norm(v):
    return re.sub(r"[^\w]+", "", str(v or "").casefold())

def master_duplicates(path, company, title, req):
    # Read-only check against the same authoritative sheet as the private CLI.
    from openpyxl import load_workbook
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        rows = iter(book["投递去重统计"].values)
        hdr = next((r for r in rows if r and r[0] == "去重键"), None)
        if not hdr or not {"公司", "准确岗位", "岗位编号／标识", "计入累计"} <= set(hdr):
            raise Refused("Master tracker structure changed")
        checked = 0
        for row in rows:
            d = dict(zip(hdr, row))
            if str(d["计入累计"]) != "1":
                continue
            checked += 1
            if norm(d["岗位编号／标识"]) == norm(req) or (
                norm(d["公司"]) == norm(company) and norm(d["准确岗位"]) == norm(title)
            ):
                raise Refused("Already present in the authoritative applied tracker")
        if not checked:
            raise Refused("No applied rows found in the master tracker")
    finally:
        book.close()

def reviewed_fields(config, job_id):
    data = bounded_json(config["answers"])
    # A local maintained map, not model-generated guesses. Job-specific answers override
    # common answers by exact label. Values never appear in logs or the dashboard.
    selected = {}
    for f in data.get("common", []) + data.get("jobs", {}).get(job_id, []):
        if not isinstance(f, dict) or f.get("confirmed") is not True:
            raise Refused("Unconfirmed answer")
        label, value, kind = f.get("label"), f.get("value"), f.get("kind")
        if not isinstance(label, str) or not label.strip() or len(label) > 400:
            raise Refused("Invalid field label")
        if not isinstance(value, str) or not value.strip() or len(value) > 10000:
            raise Refused("Invalid reviewed value")
        if kind not in {"text", "select", "radio", "combobox"} or PROTECTED.search(label):
            raise Refused("Protected/unsupported field must be handled manually")
        selected[label] = {"label": label, "value": value, "kind": kind}
    if len(selected) > 100:
        raise Refused("Too many reviewed fields")
    return list(selected.values())

class Bridge:
    def __init__(self, config):
        self.config = config
        self.root = Path(config["resume_root"]).resolve(strict=True)
        path = Path(config["db"]).resolve(strict=True)
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        schema(self.db)
        self.db.commit()

    def close(self):
        self.db.close()

    def find(self, url):
        jid = identity(url)
        matches = []
        for r in self.db.execute("SELECT * FROM jobs WHERE stage='approved'"):
            try:
                if identity(r["url"]) == jid:
                    matches.append(r)
            except Refused:
                continue
        if len(matches) != 1:
            raise Refused("No unique approved job for this page; applied/held jobs are excluded")
        return matches[0]

    def validate(self, url):
        j = self.find(url)
        k = (j["employer"], j["requisition"])
        if identity(url).rsplit("/", 1)[1] != k[1].lower():
            raise Refused("Requisition mismatch")
        for table in ("blockers", "hidden"):
            if self.db.execute(f"SELECT 1 FROM {table} WHERE employer=? AND requisition=?", k).fetchone():
                raise Refused("Job is blocked or hidden")
        rec = self.db.execute("SELECT * FROM packets WHERE employer=? AND requisition=?", k).fetchone()
        if not rec or hashlib.sha256(rec["content"].encode()).hexdigest() != rec["token"]:
            raise Refused("Ledger packet missing or modified")
        approved = self.db.execute("SELECT note FROM events WHERE employer=? AND requisition=? AND stage='approved' ORDER BY seq DESC LIMIT 1", k).fetchone()
        if not approved or approved["note"] != rec["token"]:
            raise Refused("Current packet has no matching approval event")
        spec = json.loads(rec["content"])
        if identity(spec["url"]) != identity(url):
            raise Refused("Ledger URL mismatch")
        pdf = inside(spec["pdf"], self.root)
        if pdf.suffix.lower() != ".pdf" or pdf.stat().st_size > MAX_PDF:
            raise Refused("Expected PDF no larger than 8 MiB")
        # Only bounded searches beneath the known company directory.
        company_dir = self.root / pdf.relative_to(self.root).parts[0]
        candidates = [company_dir / "application_packet.json", company_dir / "_source/application_packet.json"]
        packets = []
        for p in candidates:
            if p.is_file():
                p = inside(p, self.root)
                s = bounded_json(p)
                if str(s.get("req", "")).lower() == k[1].lower() and str(s.get("company", "")).casefold() == k[0].casefold():
                    packets.append(s)
        if len(packets) != 1:
            raise Refused("No unique application_packet.json for this job")
        packet = packets[0]
        if packet.get("status") != "approved_pending_submission" or packet.get("submission_authorized") is not True:
            raise Refused("Disk packet has not been approved, or is already submitted")
        if inside(packet["pdf"], self.root) != pdf or identity(packet["url"]) != identity(url):
            raise Refused("Disk packet does not match approved ledger packet")
        with pdf.open("rb") as stream:
            data = stream.read(MAX_PDF+1)
        if len(data) > MAX_PDF:
            raise Refused("PDF exceeds size limit")
        digest = hashlib.sha256(data).hexdigest()
        if not data.startswith(b"%PDF-") or not all(d == digest for d in (packet.get("sha256"), spec.get("digest"), j["digest"])):
            raise Refused("PDF SHA256 mismatch; reapproval required")
        master_duplicates(self.config["master"], *[j[n] for n in ("employer", "title", "requisition")])
        fields = reviewed_fields(self.config, identity(url))
        return j, rec, pdf, data, digest, fields

    def session(self, request):
        r = self.db.execute("SELECT * FROM preparation_runs WHERE run=?", (request.get("run", ""),)).fetchone()
        if not r or r["status"] != "started" or time.time() - r["created"] > 600:
            raise Refused("Preparation expired or already completed; inspect page before restarting")
        v = self.validate(request["url"])
        if r["identity"] != identity(request["url"]) or r["token"] != v[1]["token"] or r["digest"] != v[4] or r["fields_digest"] != fields_digest(v[5]):
            raise Refused("Approved packet changed during preparation")
        return r, v

    def handle(self, request):
        if not isinstance(request, dict):
            raise Refused("Invalid request")
        op = request.get("op")
        if op == "prepare":
            j, rec, pdf, data, digest, fields = self.validate(request["url"])
            run = secrets.token_hex(24)
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                active = self.db.execute("SELECT 1 FROM preparation_runs WHERE identity=? AND status='started' AND created>?",
                                         (identity(request["url"]), time.time()-600)).fetchone()
                if active:
                    raise Refused("This job is already being prepared; inspect that tab before retrying")
                self.db.execute("INSERT INTO preparation_runs(run,employer,requisition,token,digest,identity,fields_digest,created) VALUES(?,?,?,?,?,?,?,?)",
                                (run, j["employer"], j["requisition"], rec["token"], digest, identity(request["url"]), fields_digest(fields), time.time()))
            return {"run": run, "identity": identity(request["url"]), "company": j["employer"], "title": j["title"],
                    "filename": pdf.name, "sha256": digest, "size": len(data), "chunkSize": CHUNK, "fields": fields}
        if op == "chunk":
            _, v = self.session(request)
            offset = request.get("offset")
            if type(offset) is not int or offset < 0 or offset % CHUNK or offset >= len(v[3]):
                raise Refused("Invalid chunk offset")
            return {"offset": offset, "base64": base64.b64encode(v[3][offset:offset + CHUNK]).decode()}
        if op == "check":
            self.session(request)
            return {"valid": True}
        if op == "report":
            r, v = self.session(request)
            report = request.get("report", {})
            if report.get("status") not in STATES:
                raise Refused("Invalid preparation result")
            # Persist counts and fixed reason codes only. Never trust arbitrary browser text.
            clean = {"status": report["status"], "fileVerified": report.get("fileVerified") is True}
            for key in ("matched", "verified", "pending", "unknownRequired"):
                value = report.get(key)
                if type(value) is not int or not 0 <= value <= 500:
                    raise Refused("Invalid report counts")
                clean[key] = value
            if clean["verified"] > clean["matched"]:
                raise Refused("Invalid verification count")
            if clean["status"] == "verified" and (not clean["fileVerified"] or clean["pending"] or clean["unknownRequired"] or clean["matched"] != clean["verified"]):
                raise Refused("Cannot claim verification with unresolved fields")
            with self.db:
                self.db.execute("UPDATE preparation_runs SET status=?,report=? WHERE run=? AND status='started'",
                                (clean["status"], json.dumps(clean), r["run"]))
            # Rendering is optional and configured locally; never accept a browser command/path.
            refreshed = self.refresh_board()
            return {"recorded": True, "boardRefreshed": refreshed, "submission": "not_attempted"}
        raise Refused("Unsupported operation; this bridge has no submit API")

    def refresh_board(self):
        if not self.config.get("board_output"):
            return False
        import board
        try:
            materials = {}
            for r in self.db.execute("SELECT DISTINCT employer FROM jobs"):
                p = self.root / r[0]
                if p.is_dir():
                    materials[r[0]] = p.as_uri()
            resources = [("投递主表", Path(self.config["master"]).as_uri()), ("简历文件夹", self.root.as_uri())]
            board.save(self.db, self.config["board_output"], self.config.get("board_resources", resources), materials)
            return True
        except (OSError, sqlite3.Error, ValueError):
            # Report persisted; never replay filling just because dashboard export failed.
            return False

def read_message(stream):
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise Refused("Truncated native message")
    size = struct.unpack("=I", header)[0]
    if not 0 < size <= MAX_MESSAGE:
        raise Refused("Native request too large")
    raw = stream.read(size)
    if len(raw) != size:
        raise Refused("Truncated native message")
    return json.loads(raw)

def serve(config, source, sink):
    bridge = Bridge(config)
    try:
        while True:
            try:
                request = read_message(source)
                if request is None:
                    return
                response = {"ok": True, "data": bridge.handle(request)}
            except Refused as e:
                response = {"ok": False, "error": str(e)}
            except Exception:
                response = {"ok": False, "error": "Local configuration or ledger read failed; inspect locally"}
            raw = json.dumps(response, ensure_ascii=False).encode()
            sink.write(struct.pack("=I", len(raw)) + raw)
            sink.flush()
            # sendNativeMessage processes one request per host invocation.
            return
    finally:
        bridge.close()

if __name__ == "__main__":
    os.umask(0o077)
    p = argparse.ArgumentParser()
    p.add_argument("--config", required=True, type=Path)
    p.add_argument("origin")
    args = p.parse_args()
    config = bounded_json(args.config)
    if args.origin != config["extension_origin"] or not re.fullmatch(r"chrome-extension://[a-p]{32}/", args.origin):
        sys.exit("Extension origin not authorized")
    serve(config, sys.stdin.buffer, sys.stdout.buffer)
