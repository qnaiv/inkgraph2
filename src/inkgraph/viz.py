"""InkGraph timeline renderer (Japanese). plot(res, path, names=None)
standalone: python3 -m inkgraph.viz out/1080p/match01   (re-renders timeline.png from timeline.json)"""
import os, re, json
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch, Rectangle
from matplotlib.lines import Line2D
plt.rcParams['font.family']=['Noto Sans CJK JP','Yu Gothic','Meiryo','MS Gothic','DejaVu Sans']
plt.rcParams['hatch.linewidth']=0.8

C_OWN_DEAD='#e57373'; C_KILL='#2e7d32'; C_SP='#f9a825'; C_SPLOST='#8d6e63'; C_SPUNUSED='#bdbdbd'
C_ALLY='#90a4ae'; C_ENEMY='#d7a8a8'; C_UNK='#9e9e9e'
SP_LABEL={'activated':'発動','lost_on_death':'払い落とし','unused_at_end':'未使用'}

def mss(t):
    t=max(0,int(round(t))); return f'{t//60}:{t%60:02d}'

def _alive_diff(m,t):
    sd=m['squid_down']
    def alive(side):
        return 4-sum(any(e['start']<=t<e['end'] for e in sd.get(f'{side}{i}',[])) for i in range(4))
    return alive('L'),alive('R')

def _match_no(m,path):
    g=re.search(r'match(\d+)',os.path.dirname(os.path.abspath(path)))
    return int(g.group(1)) if g else m['match']

def _draw(fig,gs_top,gs_mid,gs_bot,m,no):
    t0,t1=m['battle']; T=t1-t0; rel=lambda t:t-t0
    xlim=(0,max(300,T)+2)
    axO=fig.add_subplot(gs_top); axS=fig.add_subplot(gs_mid,sharex=axO); axD=fig.add_subplot(gs_bot,sharex=axO)
    # uncertain bands on all axes
    bands=[tuple(b) for b in m['hud_hidden']]+[tuple(b) for b in m['map_open']]
    for ax in (axO,axS,axD):
        for a,b in bands:
            ax.axvspan(rel(a),rel(b),facecolor='#f2f2f2',edgecolor='#b0b0b0',hatch='///',lw=0,zorder=0)
        ax.set_xlim(*xlim); ax.grid(axis='x',color='#dddddd',lw=.8,zorder=0)
        for s in ('top','right'): ax.spines[s].set_visible(False)
    # ---- own lane: y=2 kills, y=1 deaths, y=0 special
    sd=m['squid_down']
    for e in sd.get('L0',[]):
        axO.add_patch(Rectangle((rel(e['start']),0.65),max(e['end']-e['start'],.5),0.7,color=C_OWN_DEAD,alpha=.35,lw=0,zorder=2))
        axO.plot(rel(e['start']),1,marker='X',color='#c62828',ms=17,mec='white',mew=1.2,zorder=4)
    for e in m['own_kills']:
        axO.plot(rel(e['start']),2,marker='*',color=C_KILL,ms=22,mec='white',mew=1,zorder=4)
    for e in m['special']:
        o=e['outcome']; a,b=rel(e['ready']),rel(e['end'])
        col={'activated':C_SP,'lost_on_death':C_SPLOST}.get(o,C_SPUNUSED)
        axO.add_patch(Rectangle((a,-0.25),max(b-a,.6),0.5,color=col,lw=0,zorder=2))
        mk={'activated':('o',C_SP),'lost_on_death':('v',C_SPLOST)}.get(o,('s',C_SPUNUSED))
        axO.plot(b,0,marker=mk[0],color=mk[1],ms=12,mec='black',mew=.8,zorder=4)
        axO.text(b,0.38,SP_LABEL.get(o,o),ha='center',va='bottom',fontsize=11,color='#5d4037' if o!='activated' else '#8d6e00',zorder=5)
    axO.set_ylim(-0.6,2.6); axO.set_yticks([2,1,0]); axO.set_yticklabels(['キル','デス','スペシャル'],fontsize=15)
    axO.set_ylabel('自分',fontsize=20,fontweight='bold',rotation=0,labelpad=40,va='center')
    axO.tick_params(axis='x',labelbottom=False)
    # ---- 人数差 strip
    import numpy as np
    ts=np.arange(t0,t1,0.2)
    for t in ts:
        a,b=_alive_diff(m,t); d=a-b
        col='#64b5f6' if d>0 else ('#ef9a9a' if d<0 else '#eeeeee')
        if d>=2: col='#1e88e5'
        if d<=-2: col='#e53935'
        axS.axvspan(rel(t),rel(t)+0.2,color=col,lw=0,zorder=1)
    axS.set_yticks([]); axS.set_ylabel('人数差',fontsize=13,rotation=0,labelpad=30,va='center')
    axS.tick_params(axis='x',labelbottom=False)
    # ---- ally/enemy compact lanes
    rows=[('L1','味方1'),('L2','味方2'),('L3','味方3'),('R0','敵1'),('R1','敵2'),('R2','敵3'),('R3','敵4')]
    for i,(k,lab) in enumerate(rows):
        col=C_ALLY if k[0]=='L' else C_ENEMY
        for e in sd.get(k,[]):
            if e['start']==e['end'] or e['src'].startswith('map'):
                axD.plot(rel(e['start']),i,marker='D',color=col,ms=6,mec='#555',mew=.6,zorder=3)
            else:
                axD.barh(i,max(e['end']-e['start'],.5),left=rel(e['start']),color=col,height=.6,zorder=2)
    axD.axhline(2.5,color='#999',lw=.8)
    axD.set_yticks(range(7)); axD.set_yticklabels([r[1] for r in rows],fontsize=11,color='#555'); axD.invert_yaxis()
    ticks=list(range(0,int(xlim[1])+1,30))
    axD.set_xticks(ticks); axD.set_xticklabels([mss(t) for t in ticks],fontsize=12)
    axD.set_xlabel('試合時間（バトル開始からの経過）',fontsize=13)
    # ---- title
    rs=m.get('result_screen') or {}; own=rs.get('own') or {}
    res=rs.get('result') or '?'
    head=f"第{no}試合　{rs.get('mode') or 'ルール不明'}　{rs.get('stage') or 'ステージ不明'}　{res}"
    if own: head+=f"　｜　キル+アシスト {own.get('ka')}　デス {own.get('deaths')}　スペシャル {own.get('specials')}"
    axO.set_title(head,fontsize=19,fontweight='bold',loc='left',pad=12,
                  color='#1565c0' if res=='WIN' else ('#c62828' if res=='LOSE' else 'black'))
    return axD

def _legend(fig,y):
    h=[Line2D([],[],ls='',marker='*',color=C_KILL,ms=16,label='自分のキル'),
       Line2D([],[],ls='',marker='X',color='#c62828',ms=13,label='自分のデス'),
       Patch(color=C_OWN_DEAD,alpha=.35,label='復活待ち'),
       Patch(color=C_SP,label='スペシャル溜まり中→●発動'),
       Patch(color=C_SPLOST,label='▼払い落とし（溜めたままやられた）'),
       Patch(color=C_SPUNUSED,label='■未使用のまま試合終了'),
       Patch(color=C_ALLY,label='味方 やられ中'),Patch(color=C_ENEMY,label='敵 やられ中'),
       Line2D([],[],ls='',marker='D',color='#888',ms=7,label='マップで確認したやられ'),
       Patch(color='#1e88e5',label='人数差: 有利'),Patch(color='#e53935',label='人数差: 不利'),Patch(color='#eeeeee',label='人数差: 同数'),
       Patch(facecolor='#f2f2f2',edgecolor='#b0b0b0',hatch='///',label='判定不可（マップ表示中など）')]
    fig.legend(handles=h,loc='lower center',bbox_to_anchor=(0.5,y),ncol=5,fontsize=12,frameon=False,handlelength=1.6,columnspacing=1.6)

def plot(res,path,names=None):
    n=len(res); fig=plt.figure(figsize=(16,7.6*n+1.4),dpi=100)
    gs=fig.add_gridspec(4*n,1,height_ratios=([5,0.55,4,1.4]*n)[:-1]+[0.1],hspace=0.12 if n==1 else 0.35,left=0.12,right=0.98,top=1-0.45/(7.6*n+1.4),bottom=1.55/(7.6*n+1.4))
    for j,m in enumerate(res):
        _draw(fig,gs[4*j],gs[4*j+1],gs[4*j+2],m,_match_no(m,path) if n==1 else m['match'])
    _legend(fig,0.005)
    fig.savefig(path); plt.close(fig)

if __name__=='__main__':
    import sys
    for d in sys.argv[1:]:
        plot(json.load(open(os.path.join(d,'timeline.json'))),os.path.join(d,'timeline.png')); print('wrote',d)
