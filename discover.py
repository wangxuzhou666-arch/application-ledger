"""Read public openings from an employer board. No candidate data is sent."""
import argparse
import json
import re
import urllib.request
from urllib.parse import urlsplit, parse_qs

def read(url):
    request = urllib.request.Request(url, headers={'User-Agent':'ApplicationLedger/1.1 (+job discovery)','Accept':'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)

def postings(provider, board):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', board):
        raise ValueError("Use the employer board slug")
    if provider == 'community':
        if board != 'simplify-new-grad': raise ValueError('Unknown community feed')
        feed=read('https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json')
        for j in feed:
            if not j.get('active') or j.get('is_visible') is False: continue
            u=urlsplit(j['url'])
            if u.scheme!='https' or not u.hostname: continue
            req='feed-'+j['id']
            if u.hostname in {'jobs.ashbyhq.com','jobs.lever.co','job-boards.greenhouse.io','boards.greenhouse.io','job-boards.eu.greenhouse.io'}:
                parts=u.path.rstrip('/').split('/')
                req=(parse_qs(u.query).get('token') or [parts[-2] if parts[-1] in ('apply','application') else parts[-1]])[0]
            elif parse_qs(u.query).get('gh_jid'): req=parse_qs(u.query)['gh_jid'][0]
            yield dict(company=j['company_name'],req=req,title=j['title'],url=j['url'],location=', '.join(j.get('locations') or []))
        return
    if provider == 'lever':
        offset=0
        while True:
            page=read(f'https://api.lever.co/v0/postings/{board}?mode=json&skip={offset}&limit=100')
            for j in page:
                yield dict(company=board,req=j['id'],title=j['text'],url=j['hostedUrl'],location=j.get('categories',{}).get('location',''))
            if len(page)<100: break
            offset+=len(page)
        return
    if provider == 'smartrecruiters':
        offset=0
        while True:
            page=read(f'https://api.smartrecruiters.com/v1/companies/{board}/postings?limit=100&offset={offset}')
            for j in page['content']:
                loc=j.get('location',{})
                yield dict(company=board,req=str(j['id']),title=j['name'],country=loc.get('country',''),url=f"https://jobs.smartrecruiters.com/{board}/{j['id']}",location=', '.join(filter(None,[loc.get('city'),loc.get('country')])))
            offset+=len(page['content'])
            if not page['content'] or offset>=page['totalFound']: break
        return
    urls = {
        'greenhouse': f'https://boards-api.greenhouse.io/v1/boards/{board}/jobs',
        'ashby': f'https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true',
    }
    for j in read(urls[provider])['jobs']:
        if j.get('isListed') is False: continue
        url = j.get('jobUrl') or j['absolute_url']
        loc = j.get('location','')
        yield dict(company=board,req=str(j.get('id') or url.rstrip('/').split('/')[-1]),title=j['title'],url=url,location=loc.get('name','') if isinstance(loc,dict) else loc)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('provider',choices=['ashby','greenhouse','lever','smartrecruiters','community'])
    p.add_argument('board')
    p.add_argument('--contains',default='')
    a=p.parse_args()
    try:
        for j in postings(a.provider,a.board):
            if a.contains.lower() in j['title'].lower(): print(json.dumps(j,ensure_ascii=False))
    except (OSError,KeyError,ValueError) as e:
        p.exit(1,f"Board unavailable: {e}. Check the official careers page.")
