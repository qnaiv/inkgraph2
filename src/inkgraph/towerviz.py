"""Tower Control count / objective owner / win-probability chart with top swing events.
python -m inkgraph.towerviz out/1080p/match01  -> tower.png"""
import os, sys, json
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from inkgraph.common import setup_cjk_font
setup_cjk_font()
def plot(m,path,title=''):
    S=m.get('tower_series') or []
    if not S: return
    from .tower import wp
    from .detect import alive_at
    t0=m['battle'][0]; T=[s['t']-t0 for s in S]
    fig,(a1,a2)=plt.subplots(2,1,figsize=(14,6),sharex=True,gridspec_kw=dict(height_ratios=[2,1.3]))
    a1.plot(T,[s['own'] for s in S],color='tab:blue',lw=2,label='味方カウント'); a1.plot(T,[s['enemy'] for s in S],color='tab:red',lw=2,label='敵カウント')
    for s,t in zip(S,T):
        c={'own':'tab:blue','enemy':'tab:red'}.get(s['owner'])
        if c: a1.axvspan(t-0.5,t+0.5,color=c,alpha=.12,lw=0)
    for e in m['own_deaths']: a1.plot(e['start']-t0,2,'x',color='k',ms=9,mew=2)
    for e in m['own_kills']: a1.plot(e['start']-t0,2,'*',color='g',ms=12)
    a1.set_ylim(0,100); a1.set_ylabel('カウント (薄い帯=ヤグラ確保側)'); a1.legend(loc='upper left'); a1.grid(alpha=.3)
    W=[wp({'diff':s['own']-s['enemy'],'owner':s['owner']},s['t'],m['battle'][1],alive_at(m,s['t'])) for s in S]
    a2.plot(T,W,color='purple'); a2.axhline(.5,color='0.6',lw=.8); a2.set_ylim(0,1); a2.set_ylabel('勝率(簡易)'); a2.grid(alpha=.3)
    for sw in m.get('top_swings',[]):
        x=sw['t']-t0; a2.annotate(f"{'デス' if sw['kind']=='own_death' else 'キル'} {sw['delta']:+.0%}\n{sw['phase']} {sw['count']}",(x,0.5),xytext=(x,0.08),ha='center',fontsize=9,arrowprops=dict(arrowstyle='->'))
    a2.set_xlabel('試合時間 (s)'); a1.set_title(title+'  ×=自分のデス ★=自分のキル'); plt.tight_layout(); plt.savefig(path,dpi=80); plt.close()
if __name__=='__main__':
    d=sys.argv[1]; res=json.load(open(os.path.join(d,'timeline.json')))
    for m in res:
        rs=m.get('result_screen') or {}; plot(m,os.path.join(d,'tower.png'),' '.join(str(rs.get(k)) for k in ('mode','stage','result')))
