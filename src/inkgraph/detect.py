"""In-match event timeline from a recording (whole session or one split match)."""
import numpy as np, pickle, os, cv2
from scipy.ndimage import median_filter
from .common import frames, runs, MODELS
from . import cues
P=dict(icon_th=0.7,med=5,minlen=2.0,gap=2.5,cover=3.0,sig_gap=4.0,enemy_fill=False,sp_min=0.3,l0_hud_fallback=False,dead_max_sat=55)
def team_hues(crops):
    out=[]
    for side in (0,1):
        h=np.concatenate([cv2.cvtColor(c,cv2.COLOR_BGR2HSV).reshape(-1,3) for fr in crops for c in fr[side*4:side*4+4]])
        h=h[(h[:,1]>170)&(h[:,2]>150)]; out.append(int(np.argmax(np.bincount(h[:,0],minlength=180))) if len(h) else 0)
    return out
def collect(path,a,b,step=0.2):
    R={k:[] for k in ['t','timer','map','sig','kill','gw','go','crops','ally','enemy']}; imgs_map=[]
    for t,img in frames(path,step,a,b):
        R['t'].append(t); tm=cues.timer_present(img); mp=cues.map_open(img)
        R['timer'].append(tm); R['map'].append(mp); R['sig'].append(cues.own_dead_signal(img)); R['kill'].append(cues.kill_notice(img))
        w,o=cues.gauge(img); R['gw'].append(w); R['go'].append(o); R['crops'].append(cues.icon_crops(img))
        imgs_map.append(img if mp else None)
    th=team_hues([c for c,ok in zip(R['crops'],R['timer']) if ok][:60])
    for img in imgs_map:
        R['ally'].append(cues.ally_plate_crossed(img,th[0]) if img is not None else None)
        R['enemy'].append(cues.enemy_row_crossed(img,th[1]) if img is not None else None)
    cap=cv2.VideoCapture(path); R['src_h']=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)); cap.release()
    R['team_hue']=th; return R
def build(R,clf=None):
    clf=clf or pickle.load(open(os.path.join(MODELS,'icon_lr.pkl'),'rb'))
    t=np.array(R['t']); ok=np.array(R['timer']); mp=np.array(R['map']); th=R['team_hue']
    Z=np.array([[cues.icon_feat(c,th[i//4]) for i,c in enumerate(fr)] for fr in R['crops']])
    p=clf.predict_proba(Z.reshape(-1,Z.shape[-1]))[:,1].reshape(len(t),8)
    d=p>P['icon_th']
    if P['dead_max_sat']:   # 1080p: pale 'special ready' icons look gray-ish to the LR; dead icons are desaturated
        S=np.array([[np.median(cv2.cvtColor(c[4:28,4:28],cv2.COLOR_BGR2HSV)[...,1]) for c in fr] for fr in R['crops']])
    for k in range(1,len(d)):
        if not ok[k]: d[k]=d[k-1]
    d=median_filter(d.astype(int),size=(P['med'],1))>0
    slots=[('L' if i<4 else 'R')+str(i%4) for i in range(8)]
    def keep(i,a,b):
        if not P['dead_max_sat'] or R.get('src_h',720)<1000: return True   # gate tuned on 1080p only
        w=(t>=a)&(t<=b)&ok
        return (not w.any()) or np.median(S[w,i])<P['dead_max_sat']
    ev={k:[{'start':round(a,1),'end':round(b,1),'src':'hud'} for a,b in runs(t,d[:,i],P['minlen'],P['gap']) if keep(i,a,b)] for i,k in enumerate(slots)}
    sig=median_filter(np.array(R['sig']).astype(int),5)>0
    sr=runs(t,sig,1.5,P['sig_gap'])
    own=[{'start':round(a,1),'end':round(b,1),'src':'signal'} for a,b in sr]
    if P['l0_hud_fallback'] or not sr: own+=[e for e in ev['L0'] if not any(a-1<=e['end'] and e['start']<=b+1 for a,b in sr)]
    ev['L0']=sorted(own,key=lambda e:e['start'])
    for key in (('ally','enemy') if P['enemy_fill'] else ('ally',)):
        for ti,st in zip(t,R[key]):
            if not st: continue
            for k,crossed in st.items():
                if crossed and not any(e['start']-P['cover']<=ti<=e['end']+P['cover'] for e in ev[k]):
                    ev[k].append({'start':round(float(ti),1),'end':round(float(ti),1),'src':'map_'+key}); ev[k].sort(key=lambda e:e['start'])
    hidden=runs(t,~ok,1.0,0.6); maps=runs(t,mp,0.4,1.0)
    owndead=np.zeros(len(t),bool)
    for e in ev['L0']: owndead|=(t>=e['start'])&(t<=e['end'])
    gw=np.array(R['gw']); go=np.array(R['go'])
    ready=median_filter(((gw>0.2)&~owndead&ok&~mp).astype(int),3)>0; sp=[]
    for a,b in runs(t,ready,P['sp_min'],3.0):
        lost=any(a<=e['start']<=b+1.0 for e in ev['L0'])   # ready ended by own death -> gauge lost
        unused=(not lost) and b>=t[ok][-1]-1.0 if ok.any() else False   # still full when battle ends
        outcome='lost_on_death' if lost else ('unused_at_end' if unused else 'activated')
        sp.append({'ready':round(a,1),'end':round(b,1),'outcome':outcome,'activated_at':round(b,1) if outcome=='activated' else None})
    kills=[{'start':round(a,1),'end':round(b,1)} for a,b in runs(t,np.array(R['kill']),0.2,1.0)]
    dur=float(t[-1]-t[0]) if len(t) else 0
    return {'squid_down':ev,'own_deaths':ev['L0'],'special':sp,'own_kills':kills,
            'hud_hidden':[[round(a,1),round(b,1)] for a,b in hidden],'map_open':[[round(a,1),round(b,1)] for a,b in maps],
            'stats':{'duration':round(dur,1),'map_open_s':round(sum(b-a for a,b in maps),1),'hud_hidden_s':round(sum(b-a for a,b in hidden),1),
                     'kill_notices_during_map':sum(any(a<=k['start']<=b for a,b in maps) for k in kills)},
            'team_hue':th}
def alive_at(m,t):
    """players alive per team at time t from squid_down runs (own L0 included)"""
    dead=lambda k: any(e['start']<=t<=max(e['end'],e['start']+5.0) for e in m['squid_down'][k])
    return 4-sum(dead(f'L{i}') for i in range(4)), 4-sum(dead(f'R{i}') for i in range(4))
def add_context(m):
    """tag own deaths / specials / kills with players-alive just before the event (e.g. 4v3)"""
    for e in m['own_deaths']: a,b=alive_at(m,e['start']-0.5); e['alive_before']=f'{a}v{b}'
    for e in m['special']: a,b=alive_at(m,e['ready']); e['alive_at_ready']=f'{a}v{b}'
    for e in m['own_kills']: a,b=alive_at(m,e['start']-1.0); e['alive_before']=f'{a}v{b}'
    return m
def analyze(path,battles=None,step=0.2):
    if battles is None:
        import autosplit
        T,tm,sb=autosplit.scan(path,1.0); battles=[s['battle'] for s in autosplit.segments(T,tm,sb)]
    from . import result
    out=[]
    for i,(a,b) in enumerate(battles):
        m=add_context(dict(match=i+1,battle=[a,b],**build(collect(path,a,b,step))))
        nxt=battles[i+1][0] if i+1<len(battles) else None
        try:
            r,_=result.read_results(path,b,nxt)
            m['result_screen']={k:r[k] for k in ('result','mode','stage','own')}
            if r['mode']=='ガチヤグラ':
                from . import tower
                tower.tag_events(m,tower.series(tower.collect(path,a,b,m['team_hue'])))
        except Exception as e: m['result_screen']={'error':str(e)}
        out.append(m)
    return out
