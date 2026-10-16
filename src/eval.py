"""Evaluate detections vs result-screen truth for raw/full.mp4 (2 matches).
usage: python eval.py [VIDEO] [--cache out/full/timeline.json]"""
import argparse, json, os, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from inkgraph.truth import TRUTH
def report(res):
    rows=[];tot=dict(exact=0,n=0,abs=0)
    for m in res:
        tr=TRUTH[m['match']]
        for k,v in m['squid_down'].items():
            d,g=len(v),tr['deaths'][k]; tot['n']+=1; tot['exact']+=d==g; tot['abs']+=abs(d-g)
            rows.append((m['match'],'deaths '+k+' '+tr['names'][k],d,g))
        sp=sum(e['outcome']=='activated' for e in m['special']); rows.append((m['match'],'own special used',sp,tr['own_sp']))
        rows.append((m['match'],'own kill notices (<= K+A)',len(m['own_kills']),f"<= {tr['own_ka']}"))
        L=sum(len(m['squid_down'][f'L{i}']) for i in range(4)); R=sum(len(m['squid_down'][f'R{i}']) for i in range(4))
        rows.append((m['match'],'team deaths ally',L,sum(tr['deaths'][f'L{i}'] for i in range(4))))
        rows.append((m['match'],'team deaths enemy',R,sum(tr['deaths'][f'R{i}'] for i in range(4))))
        s=m['stats']; rows.append((m['match'],'map open s / HUD hidden s / kill notices during map',f"{s['map_open_s']} / {s['hud_hidden_s']} / {s['kill_notices_during_map']}",'-'))
    for r in rows: print(f"M{r[0]}  {r[1]:<48} det={r[2]!s:<14} truth={r[3]}")
    print(f"per-player deaths exact {tot['exact']}/{tot['n']}, abs err {tot['abs']}")
    return rows,tot
if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('video',nargs='?',default=os.path.join(os.path.dirname(__file__),'..','raw','full.mp4'))
    ap.add_argument('--cache'); ap.add_argument('-o','--out',default=os.path.join(os.path.dirname(__file__),'..','out','full')); a=ap.parse_args()
    if a.cache: res=json.load(open(a.cache))
    else:
        from inkgraph.detect import analyze; from analyze import write
        res=analyze(a.video); write(res,a.out,{m:TRUTH[m]['names'] for m in TRUTH})
    report(res)
