"""Result-screen reading (no OCR): celebration WIN!/LOSE, results panel header (mode/stage),
personal stats row (K+A / deaths / specials), 8-player scoreboard. All coords on 1280x720 frames."""
import os, glob, cv2, numpy as np
from .common import tpl, TPL, frames, imread_unicode
_T={}
def T(n):
    if n not in _T: _T[n]=tpl(n)
    return _T[n]
def _wb(img,th=170):
    g=img if img.ndim==2 else cv2.cvtColor(img,cv2.COLOR_BGR2GRAY); return cv2.threshold(g,th,255,0)[1]
def _loc(region,t,th=170):
    r=_wb(region,th); tb=_wb(t,th)
    if r.shape[0]<tb.shape[0] or r.shape[1]<tb.shape[1]: return 0.0,(0,0)
    res=np.nan_to_num(cv2.matchTemplate(r,tb,cv2.TM_CCOEFF_NORMED)); _,mx,_,ml=cv2.minMaxLoc(res); return float(mx),ml
# ---------- screen classification ----------
def celebration(img):
    w,_=_loc(img[0:130,0:260],T('tpl_res_cel_win.png'),200); l,_=_loc(img[0:130,0:260],T('tpl_res_cel_lose.png'),200)
    if max(w,l)<0.6: return None
    return 'WIN' if w>l else 'LOSE'
LOBBY_XY=(550,25)
def panel_offset(img):
    s,(x,y)=_loc(img[0:110,450:800],T('tpl_res_lobby.png'),170)
    return (s, x+450-LOBBY_XY[0], y-LOBBY_XY[1])
BANNER_XY={'top':(625,215),'bot':(625,455)}
def classify(img):
    c=celebration(img)
    if c: return ('celebration',c,(0,0))
    s,dx,dy=panel_offset(img)
    if s<0.6: return (None,None,(0,0))
    bw=_banner_score(img,dx,dy)
    return ('board' if bw>0.5 else 'personal',None,(dx,dy))
def _banner_score(img,dx,dy):
    def sc(name,x,y):
        reg=img[max(0,y+dy-15):y+dy+45,max(0,x+dx-15):x+dx+125]; t=imread_unicode(os.path.join(TPL,name))
        if reg.shape[0]<t.shape[0] or reg.shape[1]<t.shape[1]: return 0
        g=lambda a: cv2.cvtColor(a,cv2.COLOR_BGR2HSV)[...,2]
        return float(cv2.matchTemplate(g(reg),g(t),cv2.TM_CCOEFF_NORMED).max())
    return min(sc('tpl_res_board_win.png',625,215),sc('tpl_res_board_lose.png',625,455))
# ---------- header (mode / stage) ----------
MODE_BOX=(552,50,650,84); STAGE_BOX=(655,52,800,84)
def _crop(img,box,dx,dy): x0,y0,x1,y1=box; return img[y0+dy:y1+dy,x0+dx:x1+dx]
def _lib(kind):
    return {os.path.splitext(os.path.basename(p))[0]:imread_unicode(p,0) for p in glob.glob(os.path.join(TPL,'res_'+kind,'*.png'))}
def _norm_text(c): return cv2.resize(_wb(c,170),(120,32),interpolation=cv2.INTER_AREA).astype(np.float32)
def header_crops(img,dx,dy): return _crop(img,MODE_BOX,dx,dy),_crop(img,STAGE_BOX,dx,dy)
def _best(c,lib):
    if not lib: return None,0.0
    v=_norm_text(c); best=(None,-1)
    for k,t in lib.items():
        tt=cv2.resize(t,(120,32)).astype(np.float32)
        a=v-v.mean(); b=tt-tt.mean(); s=float((a*b).sum()/(np.sqrt((a*a).sum()*(b*b).sum())+1e-6))
        if s>best[1]: best=(k,s)
    return best
def read_header(img,dx,dy,exclude=None):
    m,s=header_crops(img,dx,dy); lm=_lib('mode'); ls=_lib('stage')
    if exclude: lm={k:v for k,v in lm.items() if exclude not in k}; ls={k:v for k,v in ls.items() if exclude not in k}
    mk,ms=_best(m,lm); sk,ss=_best(s,ls)
    strip=lambda k: k.split('__')[0] if k else None
    return {'mode':strip(mk) if ms>0.5 else None,'mode_score':round(ms,2),'stage':strip(sk) if ss>0.5 else None,'stage_score':round(ss,2)}
# ---------- digits ----------
def _white(img): h=cv2.cvtColor(img,cv2.COLOR_BGR2HSV); return ((h[...,2]>165)&(h[...,1]<80)).astype(np.uint8)
def stat_glyphs(img,y0,y1,x0,x1):
    """returns 3 groups (K+A, D, SP), each a list of digit binary crops, found right of the small 'x' glyphs"""
    m=_white(img[y0:y1,x0:x1]); n,lab,st,_=cv2.connectedComponentsWithStats(m,8)
    comps=[tuple(int(v) for v in s[:4]) for s in st[1:] if s[4]>=5]
    digs=[c for c in comps if 8<=c[3]<=16 and c[2]<=10 and c[1]>=5]
    xs=[c for c in comps if 4<=c[3]<=10 and 3<=c[2]<=7 and c[1]>=7 and any(abs((c[1]+c[3])-(d[1]+d[3]))<=2 and d[3]>=c[3]+3 and 0<d[0]-c[0]<=12 for d in digs)]
    xs=sorted(xs); groups=[]
    for xc in xs:
        g=sorted([d for d in digs if 0<d[0]-xc[0]<=26 and d[3]>=xc[3]+3 and abs((xc[1]+xc[3])-(d[1]+d[3]))<=2])
        if g and not any(g[0] in gg for gg in groups): groups.append(g)
    out=[]
    for g in groups:
        out.append([(m[y:y+h,x:x+w]*255).astype(np.uint8) for x,y,w,h in g])
    return out
def dfeat(b):
    h,w=b.shape; f=cv2.resize(b,(8,12),interpolation=cv2.INTER_AREA).astype(np.float32).ravel()/255.
    return np.concatenate([f,[w/h*2]])
_D=None
def _digits_model():
    global _D
    if _D is None:
        p=os.path.join(TPL,'res_digits','digits.npz')
        if os.path.exists(p): z=np.load(p); _D=(z['X'],z['y'],z['src'] if 'src' in z else np.array(['']*len(z['y'])))
        else: _D=(np.zeros((0,97)),np.zeros(0,int),np.zeros(0))
    return _D
def read_number(glyphs,exclude_src=None):
    X,y,src=_digits_model()
    if exclude_src is not None: keep=src!=exclude_src; X,y=X[keep],y[keep]
    if not len(glyphs) or not len(y): return None
    s=''
    for g in glyphs:
        d=((X-dfeat(g))**2).sum(1); s+=str(int(y[int(np.argmin(d))]))
    return int(s)
PERSONAL_ROW=(178,212,985,1165)
def read_personal(img,dx,dy,exclude_src=None):
    y0,y1,x0,x1=PERSONAL_ROW; gs=stat_glyphs(img,y0+dy,y1+dy,x0+dx,x1+dx)
    if len(gs)!=3: return None
    v=[read_number(g,exclude_src) for g in gs]; return {'ka':v[0],'deaths':v[1],'specials':v[2]}
ROW_Y={'top':[262,306,350,394],'bot':[499,543,587,631]}
def board_rows(img,dx,dy):
    rows=[]
    for grp in ('top','bot'):
        for i,y in enumerate(ROW_Y[grp]):
            y+=dy; band=img[y:y+34,600+dx:1160+dx]
            hsv=cv2.cvtColor(img[y:y+34,612+dx:650+dx],cv2.COLOR_BGR2HSV)
            own=float(((hsv[...,0]>22)&(hsv[...,0]<38)&(hsv[...,1]>150)&(hsv[...,2]>180)).mean())>0.08
            rows.append(dict(group=grp,idx=i,y=y,own=own,weapon=img[y+2:y+32,700+dx:748+dx].copy(),name=img[y+6:y+30,752+dx:880+dx].copy()))
    return rows
def read_board(img,dx,dy,exclude_src=None):
    rows=board_rows(img,dx,dy); out=[]
    for r in rows:
        gs=stat_glyphs(img,r['y']+2,r['y']+34,965+dx,1160+dx)
        v=[read_number(g,exclude_src) for g in gs] if len(gs)==3 else [None]*3
        out.append(dict(group=r['group'],idx=r['idx'],own=r['own'],ka=v[0],deaths=v[1],specials=v[2]))
    return out,rows
# ---------- scan tail of a match ----------
def scan(path,start,end=None,step=0.25):
    S={'celebration':[], 'personal':[], 'board':[]}
    for t,img in frames(path,step,start,end):
        k,v,off=classify(img)
        if k: S[k].append((t,v,off,img))
    return S
def _pick(lst,k=5):
    """middle frames of the last stable run (panels slide in)"""
    if not lst: return []
    ts=[x[0] for x in lst]; runs=[[0]]
    for i in range(1,len(ts)):
        if ts[i]-ts[i-1]<=0.6: runs[-1].append(i)
        else: runs.append([i])
    r=max(runs,key=len); mid=r[len(r)//4:len(r)*3//4+1] or r
    sel=mid[::max(1,len(mid)//k)][:k]; return [lst[i] for i in sel]
def _vote(vals):
    vals=[v for v in vals if v is not None]
    if not vals: return None
    u,c=np.unique(np.array(vals,dtype=object).astype(str),return_counts=True); return vals[[str(v) for v in vals].index(u[np.argmax(c)])]
def read_results(path,start,end=None,exclude_src=None,exclude_hdr=None,S=None):
    S=S or scan(path,start,end)
    res={'result':_vote([v for _,v,_,_ in S['celebration']]),'mode':None,'stage':None,'own':None,'board':None,'board_frame_t':None}
    hdr_src=_pick(S['board'])+_pick(S['personal'])
    hs=[read_header(img,*off,exclude=exclude_hdr) for _,_,off,img in hdr_src]
    res['mode']=_vote([h['mode'] for h in hs]); res['stage']=_vote([h['stage'] for h in hs])
    pers=[read_personal(img,*off,exclude_src=exclude_src) for _,_,off,img in _pick(S['personal'])]
    own=None
    if any(pers): own={k:_vote([p[k] for p in pers if p]) for k in ('ka','deaths','specials')}
    bsel=_pick(S['board'])
    if bsel:
        boards=[read_board(img,*off,exclude_src=exclude_src) for _,_,off,img in bsel]
        B=[dict(boards[0][0][i],**{k:_vote([b[0][i][k] for b in boards]) for k in ('ka','deaths','specials')}) for i in range(8)]
        ownrow=[b for b in B if b['own']]
        res['board']=B; res['board_frame_t']=round(bsel[len(bsel)//2][0],2); res['_board_rows']=boards[len(boards)//2][1]
        if ownrow:
            if own is None: own={k:ownrow[0][k] for k in ('ka','deaths','specials')}
            if res['result'] is None: res['result']='WIN' if ownrow[0]['group']=='top' else 'LOSE'
            res['result_from_board']='WIN' if ownrow[0]['group']=='top' else 'LOSE'
    res['own']=own
    return res,S
