"""Print public jobs from a company's Greenhouse or Ashby board as JSON lines."""
import argparse
import json
import re
import urllib.request

def postings(provider, board):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', board):
        raise ValueError("Use the employer board slug")
    urls = {
        'greenhouse': f'https://boards-api.greenhouse.io/v1/boards/{board}/jobs',
        'ashby': f'https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true',
    }
    with urllib.request.urlopen(urls[provider], timeout=20) as response:
        jobs = json.load(response)['jobs']
    for j in jobs:
        if j.get('isListed') is False:
            continue
        url = j.get('jobUrl') or j['absolute_url']
        location = j.get('location', '')
        yield dict(company=board, req=str(j.get('id') or url.rstrip('/').split('/')[-1]),
                   title=j['title'], url=url, location=location.get('name','') if isinstance(location,dict) else location)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('provider',choices=['ashby','greenhouse'])
    p.add_argument('board')
    p.add_argument('--contains',default='')
    a=p.parse_args()
    try:
        for j in postings(a.provider,a.board):
            if a.contains.lower() in j['title'].lower(): print(json.dumps(j,ensure_ascii=False))
    except (OSError,KeyError,ValueError) as e:
        p.exit(1,f"Board unavailable: {e}. Check the official careers page.\n")
