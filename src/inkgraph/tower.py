"""Tower Control context from the top HUD (1280x720 frames):
 - 'のこり NN' badges (remaining count per team) under the progress track -> digit NN classifier (templates/res_digits/tc_badge_digits.npz)
 - tower marker (circle on the track, Hough) -> x position and owner (ring/disc hue: own / enemy / neutral)
Remaining counts only decrease -> per-frame reads are smoothed (needs >=3 agreeing reads, then cumulative min)."""
import os, cv2, numpy as np
from collections import Counter
from .common import frames, TPL
from . import cues
TRACK_Y=(78,128); TRACK_X=(330,950); ENDS=(341,937); CENTER=639
def hd(h,t): d=abs(h.astype(int)-t); return np.minimum(d,180-d)
def badges(img,th):
    out={}; band=img[122:190,330:950]; hsv=cv2.cvtColor(band,cv2.COLOR_BGR2HSV)
    for side,hue in (('own',th[0]),('enemy',th[1])):
        m=((hd(hsv[...,0],hue)<10)&(hsv[...,1]>150)&(hsv[...,2]>130)).astype(np.uint8)
        m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((3,3),np.uint8)); n,lab,st,_=cv2.connectedComponentsWithStats(m,8); best=None
        for i in range(1,n):
            x,y,w,h,a=st[i]
            if 28<=w<=60 and 25<=h<=70 and a>500 and (best is None or a>best[4]): best=st[i]
        if best is not None:
            x,y,w,h,a=best; out[side]=(int(x+330+w/2), band[max(0,y-4):y+h+2, max(0,x-3):x+w+3])
    return out
def glyphs(cr):
    h,w=cr.shape[:2]; r=cr[int(h*0.38):,:]; hsv=cv2.cvtColor(r,cv2.COLOR_BGR2HSV)
    m=((hsv[...,2]>200)&(hsv[...,1]<90)).astype(np.uint8); n,l,st,_=cv2.connectedComponentsWithStats(m,8)
    cs=sorted(sorted([s for s in st[1:] if s[3]>=9 and s[4]>=15],key=lambda s:-s[4])[:2],key=lambda s:s[0])
    return [m[y:y+hh,x:x+ww]*255 for x,y,ww,hh,_ in cs]
def feat(g): h,w=g.shape; return np.concatenate([cv2.resize(g,(8,12),interpolation=cv2.INTER_AREA).ravel()/255.,[w/h]])
_D=None
def read_badge(cr):
    global _D
    if _D is None: z=np.load(os.path.join(TPL,'res_digits','tc_badge_digits.npz')); _D=(z['X'],z['y'])
    gs=glyphs(cr)
    if len(gs)!=2: return None
    return int(''.join(str(_D[1][np.argmin(((_D[0]-feat(g))**2).sum(1))]) for g in gs))
def marker(img,th):
    band=img[TRACK_Y[0]:TRACK_Y[1],TRACK_X[0]:TRACK_X[1]]; g=cv2.medianBlur(cv2.cvtColor(band,cv2.COLOR_BGR2GRAY),3)
    c=cv2.HoughCircles(g,cv2.HOUGH_GRADIENT,1,30,param1=120,param2=18,minRadius=12,maxRadius=22)
    if c is None: return None
    for x,y,r in c[0]:
        X=x+TRACK_X[0]
        if min(abs(X-ENDS[0]),abs(X-ENDS[1]))<14 or not 15<=y<=37: continue
        yy,xx=np.mgrid[0:band.shape[0],0:band.shape[1]]; d=np.hypot(xx-x,yy-y); hsv=cv2.cvtColor(band,cv2.COLOR_BGR2HSV)[d<r+2]
        sat=hsv[(hsv[:,1]>140)&(hsv[:,2]>120)]
        fo=(hd(sat[:,0],th[0])<10).sum()/len(hsv); fe=(hd(sat[:,0],th[1])<10).sum()/len(hsv)
        owner='own' if fo>0.15 and fo>fe else ('enemy' if fe>0.15 else 'neutral')
        return dict(x=int(X),r=float(r),owner=owner)
    return None
def collect(path,a,b,th,step=1.0):
    rows=[]
    for t,img in frames(path,step,a,b):
        if not cues.timer_present(img): continue
        bd=badges(img,th); mk=marker(img,th)
        rows.append(dict(t=round(t,1),own=read_badge(bd['own'][1]) if 'own' in bd else None,enemy=read_badge(bd['enemy'][1]) if 'enemy' in bd else None,
                         own_x=bd.get('own',(None,))[0],enemy_x=bd.get('enemy',(None,))[0],marker=mk))
    return rows
def smooth_remaining(rows,key,win=7,need=3):
    """remaining count: value accepted when it is the mode of a window with >=need votes; then cumulative min"""
    vals=[r[key] for r in rows]; out=[]; cur=100
    for i in range(len(vals)):
        w=[v for v in vals[max(0,i-win//2):i+win//2+1] if v is not None and 0<=v<=100]
        if w:
            v,c=Counter(w).most_common(1)[0]
            if c>=need and v<cur: cur=v
        out.append(cur)
    return out
def series(rows):
    ro=smooth_remaining(rows,'own'); re=smooth_remaining(rows,'enemy'); own=[]
    win=5; owners=[ (r['marker'] or {}).get('owner') for r in rows]
    for i in range(len(rows)):
        w=[o for o in owners[max(0,i-2):i+3] if o]; own.append(Counter(w).most_common(1)[0][0] if w else 'neutral')
    return [dict(t=r['t'],count_own=100-a,count_enemy=100-b,diff=(100-a)-(100-b),owner=o,marker_x=(r['marker'] or {}).get('x')) for r,a,b,o in zip(rows,ro,re,own)]
def at(S,t):
    if not S: return None
    i=int(np.argmin([abs(s['t']-t) for s in S])); return S[i]
# ---------- phase / win probability ----------
import math
def phase(s):
    if s is None: return None
    if s['owner']=='enemy' or s['diff']<0: return '打開'
    if s['diff']>0 or s['owner']=='own': return '抑え'
    return '互角'
def wp(s,t,battle_end,alive):
    """heuristic win probability for own team: logistic on count diff (weighted up as time runs out),
    alive-player diff, and objective owner. Not fitted (3 matches); coefficients set by hand."""
    tl=max(0.0,battle_end-t); late=1+2*(1-min(tl,300)/300)
    own={'own':1,'enemy':-1}.get(s['owner'],0) if s else 0
    z=0.05*late*(s['diff'] if s else 0)+0.35*(alive[0]-alive[1])+0.5*own
    return 1/(1+math.exp(-z))
def tag_events(m,S):
    from .detect import alive_at
    end=m['battle'][1]
    def W(t): return wp(at(S,t),t,end,alive_at(m,t))
    ev=[]
    for kind,lst,key in (('own_death',m['own_deaths'],'start'),('own_kill',m['own_kills'],'start'),('special',m['special'],'ready')):
        for e in lst:
            t=e[key]; s=at(S,t-0.5)
            e['phase']=phase(s); e['count']=f"{s['count_own']}-{s['count_enemy']}" if s else None; e['count_diff']=s['diff'] if s else None
            if kind!='special':
                b,a=W(t-1.0),W(t+1.5); e['wp_before']=round(b,3); e['wp_after']=round(a,3); e['wp_delta']=round(a-b,3)
                ev.append(dict(kind=kind,t=t,delta=round(a-b,3),phase=e['phase'],count=e['count']))
    m['tower_series']=[dict(t=s['t'],own=s['count_own'],enemy=s['count_enemy'],owner=s['owner']) for s in S]
    m['top_swings']=sorted(ev,key=lambda x:-abs(x['delta']))[:3]
    return m
