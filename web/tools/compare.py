"""Compare web app output (web/test-results/web_matches.json) with Python outputs + result truth."""
import json, os, sys
R=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
web=json.load(open(os.path.join(R,'web/test-results/web_matches.json'))); truth=json.load(open(os.path.join(R,'out/1080p/result_truth.json')))
def match(a,b,tol=2.0):
    used=set(); tp=0
    for x in a:
        j=min((j for j in range(len(b)) if j not in used and abs(b[j]-x)<=tol),key=lambda j:abs(b[j]-x),default=None)
        if j is not None: used.add(j); tp+=1
    return tp
tot={}; lines=[]
for m in web:
    no=int(m['source']['name'].split('match')[-1][:2]); py=json.load(open(os.path.join(R,f'out/1080p/match0{no}/timeline.json')))[0]
    lines.append(f"== match0{no}: web battle {m['battle']} / python {py['battle']}")
    for k,wk,key in (('自分のデス','own_deaths','start'),('自分のキル','own_kills','start'),('スペシャル','special','ready')):
        a=[e[key] for e in m[wk]]; b=[e[key] for e in py[wk]]; tp=match(a,b); t=tot.setdefault(k,[0,0,0]); t[0]+=tp; t[1]+=len(a); t[2]+=len(b)
        lines.append(f"  {k}: web {len(a)} / python {len(b)} 一致 {tp}")
    oa=[e['outcome'] for e in m['special']]; ob=[e['outcome'] for e in py['special']]; lines.append(f"  スペシャル結果 web {oa}\n                  py  {ob}")
    tr=truth[f'match0{no}']; rs=m.get('result_screen') or {}; own=rs.get('own') or {}
    chk={'勝敗':(rs.get('result'),tr['result']),'ルール':(rs.get('mode'),'ガチヤグラ'),'ステージ':(rs.get('stage'),truth['stage']),'K+A':(own.get('ka'),tr['own']['kills_plus_assists']),'デス':(own.get('deaths'),tr['own']['deaths']),'SP':(own.get('specials'),tr['own']['specials'])}
    if 'count' in tr: ts=m.get('tower_series') or [{}]; chk['最終カウント']=(f"{ts[-1].get('own')}-{ts[-1].get('enemy')}",tr['count'])
    for k,(w,t) in chk.items(): c=tot.setdefault('リザルト:'+k,[0,0]); c[0]+=w==t; c[1]+=1
    lines.append('  リザルト '+'  '.join(f"{k}:{w}{'✓' if w==t else '✗(正解'+str(t)+')'}" for k,(w,t) in chk.items()))
    ph=[(e.get('phase'),e.get('count')) for e in m['own_deaths']]; pp=[(e.get('phase'),e.get('count')) for e in py['own_deaths']]
    lines.append(f"  デスの局面 web {ph}\n             py  {pp}")
lines.append('== 合計（Python出力との一致）')
for k,v in tot.items(): lines.append(f"  {k}: "+(f"一致 {v[0]} / web {v[1]} / python {v[2]}" if len(v)==3 else f"{v[0]}/{v[1]}"))
print('\n'.join(lines)); open(os.path.join(R,'web/test-results/compare.txt'),'w').write('\n'.join(lines))
