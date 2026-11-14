"""Generate a local offline HTML report from the application ledger."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
from html import escape
import json
from pathlib import Path
import os
from urllib.parse import urlsplit
from tempfile import NamedTemporaryFile
import flow
import ledger

GROUPS=[
 ('待你审阅',('review',),'阅读岗位摘要和简历修改后，在会话中圈选岗位。'),
 ('发现与核验',('lead','hold'),'助手核对职位原文、工作身份、薪资和入职窗口。'),
 ('投递中',('approved','awaiting_receipt'),'已批准的继续填表。待回执的先查证，避免重投。'),
 ('已投与面试',('applied','assessment','interview','offer','accepted'),'关注回执、测评、面试及录用进展。'),
 ('暂停与结束',('paused','skipped','closed','rejected','withdrawn'),'保留理由和历史，供下轮去重。')]
# Chinese text for prepare_bridge.REASONS; keys must match it and REASONS in extension/core.js.
REASON_TEXT={'file_not_shown':'附件区没有显示简历文件名','file_input_reset':'页面清空或替换了附件输入框，已按附件区显示的文件名核验',
 'file_mismatch':'附件输入框里的文件与批准版本不一致','captcha_challenge':'出现需要本人完成的验证码','page_error':'页面显示了错误提示',
 'unknown_required':'有必填题不在已审答案里','unanswered_buttons':'有必填的是/否题没有作答','field_readback_failed':'有答案填写后回读不一致',
 'combobox_unbound':'下拉框没有给出可核对的选项列表','option_not_found':'下拉选项缺失或不唯一'}
LABEL=dict(zip('review lead hold approved awaiting_receipt applied assessment interview offer accepted paused skipped closed rejected withdrawn'.split(),
               '待审阅 新线索 待核实 已批准 待核对回执 已投待反馈 测评 面试 Offer 已接受 暂停 已跳过 已关闭 已拒绝 已撤回'.split()))

def h(x):return escape(str(x or ''),quote=True)
def link(url,title):
    return f'<a href="{h(url)}">{h(title)}</a>' if urlsplit(url).scheme in ('https','file') else h(title)

def render(db, resources=(), materials=None):
    materials=materials or {}
    jobs=list(db.execute('SELECT j.* FROM jobs j LEFT JOIN hidden h USING(employer,requisition) WHERE h.reason IS NULL ORDER BY j.employer,j.title'))
    events=defaultdict(list)
    for e in db.execute('SELECT * FROM events ORDER BY seq DESC'):events[(e['employer'].casefold(),e['requisition'].casefold())].append(e)
    packets={(r['employer'].casefold(),r['requisition'].casefold()):r for r in db.execute('SELECT * FROM packets')}
    blockers={(r['employer'].casefold(),r['requisition'].casefold()):r['reason'] for r in db.execute('SELECT * FROM blockers')}
    preparations = {}
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='preparation_runs'").fetchone():
        for r in db.execute("SELECT * FROM preparation_runs ORDER BY created"):
            preparations[(r['employer'].casefold(),r['requisition'].casefold())] = r
    out=['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application Ledger · 投递工作台</title><style>*{box-sizing:border-box}body{font:16px/1.55 system-ui;color:#20363c;background:#fafbf9;margin:auto;max-width:1100px;padding:28px}h1{margin:0}h2{margin:1.8em 0 .25em}small,aside{color:#4f656a}nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}a{color:#00655d}nav a,button{padding:6px 10px;background:#edf5ef;border-radius:5px}details{border:1px solid #cedbd5;padding:8px 12px;margin:5px 0;background:white;border-radius:5px}summary{cursor:pointer}code{overflow-wrap:anywhere}input{width:min(100%,380px);padding:9px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;text-align:left;padding:6px}li{margin:4px 0}</style><main><h1>投递工作台</h1>']
    out.append('<aside>本地快照 · '+h(datetime.now().astimezone().isoformat(timespec='minutes'))+' · '+str(len(jobs))+' 条岗位记录</aside>')
    counts=Counter(j['stage'] for j in jobs)
    out.append('<nav>'+''.join(f'<a href="#s{i}">{name} {sum(counts[s] for s in stages)}</a>' for i,(name,stages,_) in enumerate(GROUPS))+'<a href="#sources">渠道记录</a></nav>')
    out.append('<p>发现 → 官方核验与去重 → JD 摘要和简历差异 → <b>你批量决定</b> → 填写与提交 → 核验回执 → 跟踪结果</p><label>筛选岗位 <input id="search" placeholder="输入公司、岗位或编号"></label>')
    for i,(name,stages,hint) in enumerate(GROUPS):
        out.append(f'<section id="s{i}"><h2>{name}</h2><aside>{hint}</aside>')
        selected=[j for j in jobs if j['stage'] in stages]
        if not selected:out.append('<p>当前没有此阶段的岗位。</p>')
        for j in selected:
            k=(j['employer'].casefold(),j['requisition'].casefold())
            out.append(f'<details class="job" data-key="{h(" ".join([*k,j["title"]]).casefold())}"><summary><b>{h(j["employer"])}</b> · {h(j["title"])} · {LABEL[j["stage"]]}</summary>')
            out.append('<p>'+link(j['url'],'官方岗位')+' · '+h(j['requisition'])+'</p>' if j['url'] else '<p>编号 '+h(j['requisition'])+'</p>')
            if j['employer'] in materials:
                out.append('<p>'+link(materials[j['employer']],'本地公司材料（含历史草稿）')+'</p>')
            if k in blockers:out.append('<p><b>待处理</b>　'+h(blockers[k])+'</p>')
            if k in packets:
                spec=json.loads(packets[k]['content'])
                for field,title in [('summary','岗位摘要'),('eligibility','资格依据'),('baseline','简历底稿'),('changes','实际改动')]:
                    out.append(f'<p><b>{title}</b>　{h(spec[field])}</p>')
                out.append('<p>'+link(Path(spec['pdf']).as_uri(),'打开本次简历 PDF')+' · 版本 <code>'+h(packets[k]['token'][:12])+'</code></p>')
            prep = preparations.get(k)
            if prep and j['stage'] == 'approved' and k in packets and prep['token'] == packets[k]['token']:
                result = json.loads(prep['report'])
                state = {'started':'填写已启动，尚未完成回读','verified':'填写回读通过','needs_attention':'填写后需检查','failed':'填写未完成'}.get(prep['status'],'待检查')
                at = datetime.fromtimestamp(prep['created']).astimezone().isoformat(timespec='minutes')
                out.append('<p><b>插件准备记录（未提交）</b>　'+h(state)+' · '+h(at)+'</p>')
                if result:
                    # v0.1 reports stored unknownRequired and no reasons.
                    unanswered = result.get('unansweredRequired', result.get('unknownRequired', 0))
                    reasons = '；'.join(REASON_TEXT[r] for r in result.get('reasons', []))
                    out.append('<p>PDF 指纹回读：'+('一致' if result.get('fileVerified') else '待核实')+
                        ' · 已核对 '+str(result.get('verified',0))+'/'+str(result.get('matched',0))+
                        ' · 未答必填 '+str(unanswered)+(' · 原因：'+h(reasons) if reasons else '')+'。这是当次页面快照，不是申请回执。</p>')
            out.append('<ul>'+''.join(f'<li>{h(e["recorded_at"][:10])} · {LABEL[e["stage"]]} · {h(e["note"])}</li>' for e in events[k])+'</ul></details>')
        out.append('</section>')
    out.append('<h2 id="sources">渠道刷新记录</h2><p>新增是待核实线索。读取失败不等于该渠道没有岗位。时间为 UTC。</p><table><tr><th>时间 / 来源</th><th>读取</th><th>标题匹配</th><th>新增</th><th>结果</th></tr>')
    for s in db.execute('SELECT * FROM scans ORDER BY seq DESC LIMIT 40'):
        out.append('<tr><td>'+h(s['at'][:16])+' '+h(s['source'])+'</td>'+''.join(f'<td>{s[n]}</td>' for n in ('scanned','matched','added'))+'<td>'+h(s['error'] or '完成')+'</td></tr>')
    out.append('</table>')
    rotation=list(db.execute('SELECT provider,board,checks FROM boards ORDER BY checks,board'))
    if rotation:out.append('<details><summary>从跨公司渠道发现的雇主板 · '+str(len(rotation))+' 个</summary><p>'+h('、'.join(r['board'] for r in rotation))+'</p></details>')
    if resources:out.append('<h2>工作资料与渠道入口</h2><ul>'+''.join('<li>'+link(u,t)+'</li>' for t,u in resources)+'</ul>')
    out.append('<p><small>历史导入的日期表示记录时间。此页面可离线查看，审批在与你的助手会话中完成。</small></p></main><script>document.querySelector("#search").oninput=e=>{for(const d of document.querySelectorAll(".job"))d.hidden=!d.dataset.key.includes(e.target.value.trim().toLowerCase())}</script></html>')
    return '\n'.join(out)

def save(db,output,resources=(),materials=None):
    output=Path(output)
    page=render(db,resources,materials)
    with NamedTemporaryFile(mode='w',encoding='utf-8',dir=output.parent,delete=False) as f:
        f.write(page)
    os.replace(f.name,output)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',type=Path,default=ledger.DEFAULT_DB)
    p.add_argument('output',type=Path)
    args=p.parse_args()
    if not args.db.is_file():p.error('Ledger does not exist')
    db=ledger.database(args.db);flow.schema(db);save(db,args.output);db.close()
