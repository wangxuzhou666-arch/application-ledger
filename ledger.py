"""Local job application history, with explicit resume approval and submission receipts."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

STAGES = set("lead hold skipped closed review approved awaiting_receipt applied paused assessment interview offer accepted rejected withdrawn".split())
OUTCOMES = set("assessment interview offer rejected withdrawn paused".split())
EDGES = {
    "lead": {"hold", "review", "skipped", "closed"},
    "hold": {"lead", "review", "skipped", "closed"},
    "review": {"hold", "skipped", "closed"},
    "approved": {"review", "hold", "withdrawn"},
    "applied": OUTCOMES, "assessment": OUTCOMES,
    "interview": OUTCOMES, "offer": {"accepted", "withdrawn", "rejected"},
    "paused": {"applied","assessment","interview","withdrawn","rejected"}, "skipped": {"lead"}, "closed": {"lead"},
}
DEFAULT_DB = Path.home()/".application-ledger"/"tracker.sqlite3"

def database(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
          employer TEXT NOT NULL COLLATE NOCASE, requisition TEXT NOT NULL COLLATE NOCASE,
          title TEXT NOT NULL, url TEXT NOT NULL, stage TEXT NOT NULL,
          digest TEXT, PRIMARY KEY(employer,requisition));
        CREATE TABLE IF NOT EXISTS events (
          seq INTEGER PRIMARY KEY, employer TEXT NOT NULL COLLATE NOCASE, requisition TEXT NOT NULL COLLATE NOCASE,
          stage TEXT NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL,
          recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          FOREIGN KEY(employer,requisition) REFERENCES jobs(employer,requisition));
    """)
    return db

def key(company, req):
    values = tuple(v.strip() for v in (company,req))
    if not all(values):
        raise ValueError("Employer and requisition are required")
    return values

def row(db,k):
    return db.execute("SELECT * FROM jobs WHERE employer=? AND requisition=?",k).fetchone()

def record(db,k,stage,source,note):
    if not note.strip() or stage not in STAGES:
        raise ValueError("A valid stage and evidence note are required")
    db.execute("UPDATE jobs SET stage=? WHERE employer=? AND requisition=?",(stage,*k))
    db.execute("INSERT INTO events(employer,requisition,stage,source,note) VALUES(?,?,?,?,?)",(*k,stage,source,note))

def add(db,k,title,url,stage="lead",source="user",note="Discovered"):
    if not title.strip(): raise ValueError("Title is required")
    db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,NULL)",(*k,title,url,stage))
    record(db,k,stage,source,note)

def fingerprint(path):
    data=Path(path).read_bytes()
    if not data.startswith(b"%PDF-"): raise ValueError("Expected a PDF")
    return hashlib.sha256(data).hexdigest()

def action(db,args):
    k=key(args.company,args.req)
    cmd=args.cmd
    if cmd=="add":
        add(db,k,args.title,args.url)
        return
    j=row(db,k)
    if j is None: raise ValueError("Unknown application")
    old=j["stage"]
    if cmd=="history":
        return [dict(r) for r in db.execute("SELECT * FROM events WHERE employer=? AND requisition=? ORDER BY seq",k)]
    if cmd=="stage":
        if args.stage not in EDGES.get(old,set()):
            raise ValueError(f"Transition {old} -> {args.stage} is unavailable")
        record(db,k,args.stage,"user",args.note)
    elif cmd=="prepare":
        if old not in {"lead","hold","review","approved"}: raise ValueError("Cannot revise this application")
        digest=fingerprint(args.pdf)
        db.execute("UPDATE jobs SET digest=? WHERE employer=? AND requisition=?",(digest,*k))
        record(db,k,"review","file",digest)
        return digest
    elif cmd in {"approve","begin"}:
        required="review" if cmd=="approve" else "approved"
        if old!=required or not j["digest"] or j["digest"]!=fingerprint(args.pdf):
            raise ValueError("Approval stage or reviewed PDF does not match")
        if cmd=="approve" and args.digest!=j["digest"]: raise ValueError("Reviewed version changed")
        record(db,k,"approved" if cmd=="approve" else "awaiting_receipt","operator",j["digest"])
    elif cmd=="receipt":
        if old!="awaiting_receipt": raise ValueError("No pending submission")
        record(db,k,"applied",args.source,args.note)
    elif cmd=="submitted-elsewhere":
        if old not in {"lead","review","approved","hold","awaiting_receipt"}: raise ValueError("Already recorded or closed")
        record(db,k,"applied",args.source,args.note)

def import_rows(db,rows):
    changed=0
    for r in rows:
        k=key(r["company"],r["req"])
        j=row(db,k)
        stage=r["stage"]
        if stage not in STAGES-{"review","approved","awaiting_receipt"}:
            raise ValueError("Unsupported imported stage")
        if j is None:
            add(db,k,r["title"],r.get("url",""),stage,"snapshot",r["note"])
        elif stage!=j["stage"]:
            if stage not in EDGES.get(j["stage"],set()) and not (stage=="applied" and j["stage"] in {"lead","review","hold","approved","awaiting_receipt"}):
                raise ValueError(f"Conflicting snapshot for {k}; review manually")
            record(db,k,stage,"snapshot",r["note"])
        else:
            continue
        changed+=1
    return changed

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db",type=Path,default=DEFAULT_DB)
    sp=p.add_subparsers(dest="cmd",required=True)
    for cmd in ("add","stage","prepare","approve","begin","receipt","submitted-elsewhere","history","list","import"):
        s=sp.add_parser(cmd)
        if cmd not in {"list","import"}:
            s.add_argument("company"); s.add_argument("req")
        if cmd=="add":
            s.add_argument("title"); s.add_argument("--url",default="")
        if cmd=="stage": s.add_argument("stage",choices=sorted(STAGES))
        if cmd in {"prepare","approve","begin"}: s.add_argument("pdf")
        if cmd=="approve": s.add_argument("digest")
        if cmd in {"receipt","submitted-elsewhere"}: s.add_argument("source",choices=["receipt","user"])
        if cmd in {"receipt","submitted-elsewhere","stage"}: s.add_argument("note")
        if cmd=="import": s.add_argument("csvfile",help="CSV path or - for stdin")
    a=p.parse_args()
    a.db.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    db=database(a.db)
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            if a.cmd=="list": result=[dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY employer,title")]
            elif a.cmd=="import":
                if a.csvfile=="-": result=import_rows(db,csv.DictReader(sys.stdin))
                else:
                    with open(a.csvfile,newline="",encoding="utf-8-sig") as f: result=import_rows(db,csv.DictReader(f))
            else: result=action(db,a)
        if result is not None: print(json.dumps(result,ensure_ascii=False,indent=2))
    finally: db.close()

if __name__=="__main__":
    os.umask(0o077)
    try: main()
    except (OSError,ValueError,KeyError,sqlite3.Error) as exc: sys.exit(str(exc))
