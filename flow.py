"""Scan employer boards, assemble review packets and approve a batch atomically."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit
import discover
import ledger

def schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS scans (seq INTEGER PRIMARY KEY, at TEXT, source TEXT, scanned INTEGER, matched INTEGER, added INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS boards (provider TEXT, board TEXT COLLATE NOCASE, company TEXT, checks INTEGER DEFAULT 0, PRIMARY KEY(provider,board));
    CREATE TABLE IF NOT EXISTS hidden (employer TEXT COLLATE NOCASE, requisition TEXT COLLATE NOCASE, reason TEXT, PRIMARY KEY(employer,requisition));
    CREATE TABLE IF NOT EXISTS blockers (employer TEXT COLLATE NOCASE, requisition TEXT COLLATE NOCASE, reason TEXT NOT NULL, PRIMARY KEY(employer,requisition));
    CREATE TABLE IF NOT EXISTS packets (employer TEXT COLLATE NOCASE, requisition TEXT COLLATE NOCASE, token TEXT UNIQUE NOT NULL, content TEXT NOT NULL, PRIMARY KEY(employer,requisition), FOREIGN KEY(employer,requisition) REFERENCES jobs(employer,requisition));
    """)

US_STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.replace(' ','|')
def us_location(location, country=''):
    if country and country.lower() not in ('us','usa','united states','united states of america'): return ''
    if country: return location
    cities = re.findall(r"(?:^|[,;/|] )([A-Z][a-zA-Z .’'-]+, (?:" + US_STATES + r"))(?=$|[,; /|])",location)
    places=list(dict.fromkeys(cities))
    if re.search(r'\b(?:USA|United States(?: of America)?|US)\b',location,re.I):
        places.append('United States')
    if 'Washington, D.C.' in location: places.append('Washington, DC')
    return ', '.join(places)

def learn_board(db, company, url):
    parts=urlsplit(url)
    hosts={'jobs.ashbyhq.com':'ashby','jobs.lever.co':'lever','job-boards.greenhouse.io':'greenhouse','boards.greenhouse.io':'greenhouse'}
    slug=parts.path.strip('/').split('/')[0]
    if parts.scheme=='https' and parts.hostname in hosts and slug!='embed' and re.fullmatch('[a-zA-Z0-9_-]+',slug):
        db.execute('INSERT OR IGNORE INTO boards(provider,board,company) VALUES(?,?,?)',(hosts[parts.hostname],slug,company))

def scan(db,config):
    matcher=re.compile(config['include'],re.I)
    exclude=re.compile(config['exclude'],re.I) if config.get('exclude') else None
    geography=re.compile(config['location'],re.I) if config.get('location') else None
    community_match=re.compile(config.get('community_include',config['include']),re.I)
    def fetch(source):
        try:
            jobs=list(discover.postings(source['provider'],source['board']))
            return source,jobs,''
        except (OSError,ValueError,KeyError) as e: return source,[],str(e)
    sources=list(config['sources'])
    known={(s['provider'],s['board'].casefold()) for s in sources}
    for candidate in db.execute('SELECT * FROM boards ORDER BY checks,provider,board'):
        if len(sources)>=len(config['sources'])+config.get('rotation',3): break
        if (candidate['provider'],candidate['board'].casefold()) not in known:
            sources.append(dict(candidate))
    result=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for source,jobs,error in pool.map(fetch,sources):
            name=source['provider']+'/'+source['board']
            hits=new=0
            with db:
                db.execute('BEGIN IMMEDIATE')
                for j in jobs:
                    pattern=community_match if source['provider']=='community' else matcher
                    if not pattern.search(j['title']) or (exclude and exclude.search(j['title'])): continue
                    if config.get('country')=='US':
                        j=dict(j,location=us_location(j['location'],j.get('country','')))
                        if not j['location']: continue
                    elif geography and not geography.search(j['location']): continue
                    hits+=1
                    k=ledger.key(source.get('company') or j['company'],j['req'])
                    # Same title on another requisition can be a repost. Keep it a lead for review.
                    if source['provider']=='community': learn_board(db,k[0],j['url'])
                    if ledger.row(db,k): continue
                    if re.fullmatch('[0-9a-fA-F-]{36}',k[1]) and db.execute('SELECT 1 FROM jobs WHERE requisition=?',(k[1],)).fetchone(): continue
                    ledger.add(db,k,j['title'],j['url'],'lead','board',name+' · '+j['location'])
                    new+=1
                result.append((datetime.now(timezone.utc).isoformat(timespec='seconds'),name,len(jobs),hits,new,error))
                db.execute('INSERT INTO scans(at,source,scanned,matched,added,error) VALUES(?,?,?,?,?,?)',result[-1])
                db.execute('UPDATE boards SET checks=checks+1 WHERE provider=? AND board=?',(source['provider'],source['board']))
    return result

def packet(db, spec):
    fields=('company','req','summary','baseline','changes','eligibility','pdf')
    if any(not isinstance(spec.get(x),str) or not spec[x].strip() for x in fields): raise ValueError('Incomplete review packet')
    k=ledger.key(spec['company'],spec['req'])
    j=ledger.row(db,k)
    if not j or j['stage'] not in ('lead','hold','review','approved'): raise ValueError('Job cannot be prepared')
    if urlsplit(j['url']).scheme!='https': raise ValueError('Official posting required')
    p=Path(spec['pdf']).expanduser().resolve(strict=True)
    data={x:spec[x] for x in fields}
    data.update(pdf=str(p),digest=ledger.fingerprint(p),title=j['title'],url=j['url'])
    content=json.dumps(data,sort_keys=True,ensure_ascii=False)
    token=hashlib.sha256(content.encode()).hexdigest()
    if j['stage']=='review' and db.execute('SELECT 1 FROM packets WHERE token=?',(token,)).fetchone(): return token
    db.execute('INSERT INTO packets VALUES(?,?,?,?) ON CONFLICT(employer,requisition) DO UPDATE SET token=excluded.token,content=excluded.content',(*k,token,content))
    db.execute('UPDATE jobs SET digest=? WHERE employer=? AND requisition=?',(data['digest'],*k))
    ledger.record(db,k,'review','packet',token)
    return token

def approve(db,tokens):
    if not tokens or len(set(tokens))!=len(tokens): raise ValueError('Select distinct reviewed packets')
    for token in tokens:
        rec=db.execute('SELECT * FROM packets WHERE token=?',(token,)).fetchone()
        if not rec: raise ValueError('Packet has changed or is unknown')
        data=json.loads(rec['content'])
        k=(rec['employer'],rec['requisition'])
        j=ledger.row(db,k)
        if j['stage']!='review' or j['digest']!=data['digest'] or ledger.fingerprint(data['pdf'])!=data['digest']:
            raise ValueError('Review stage or PDF changed')
        ledger.record(db,k,'approved','packet',token)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',type=Path,default=ledger.DEFAULT_DB)
    sub=p.add_subparsers(dest='action',required=True)
    for cmd in ('scan','packet'):
        sub.add_parser(cmd).add_argument('jsonfile',type=Path)
    sub.add_parser('approve').add_argument('tokens',nargs='+')
    args=p.parse_args(); args.db.parent.mkdir(parents=True,exist_ok=True)
    db=ledger.database(args.db); schema(db)
    try:
        if args.action=='scan':
            rows=scan(db,json.loads(args.jsonfile.read_text()))
            print(json.dumps(rows,ensure_ascii=False)); return int(any(r[-1] for r in rows))
        with db:
            db.execute('BEGIN IMMEDIATE')
            if args.action=='packet':print(packet(db,json.loads(args.jsonfile.read_text())))
            else: approve(db,args.tokens)
    finally:db.close()
if __name__=='__main__':
    os.umask(0o077)
    try:sys.exit(main())
    except (ValueError,OSError,sqlite3.Error,KeyError) as exc: sys.exit(str(exc))
