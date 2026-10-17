"""Per-frame screen cues on a 1280x720 BGR frame."""
import cv2, numpy as np
from .common import tpl, match, wb
_T={}
def T(n):
    if n not in _T: _T[n]=tpl(n)
    return _T[n]
SLOT_X=[352+59*i for i in range(4)]+[700+59*i for i in range(4)]
def timer_present(img):           # HUD visible (battle running, map closed)
    return match(img[28:72,614:648],T('tpl_colon.png'),180)>0.6
def map_open(img):                # map overlay (X close button top-left)
    t=T('tpl_mapx.png'); t=cv2.threshold(t[15:75,15:75],200,255,0)[1]
    return match(img[10:125,15:130],t,200)>0.6
def own_dead_signal(img):         # D-pad signal label 'やられた' (vs 'カモン')
    r=img[590:624,15:100]; y=match(r,T('tpl_signal_yarareta.png'),215); k=match(r,T('tpl_signal_camon.png'),215)
    return y>0.5 and y>k
KILL_ANCHORS=[247-44*k for k in range(247//44+1) if 247-44*k>=0]
def kill_notice_slot_scores(img):
    t=T('tpl_wotaoshita.png'); reg=img[420:720,200:1080]; n_slots=len(KILL_ANCHORS)
    if reg.shape[0]<t.shape[0] or reg.shape[1]<t.shape[1]: return [0.0]*n_slots
    r=wb(reg,190); res=np.nan_to_num(cv2.matchTemplate(r,t,cv2.TM_CCOEFF_NORMED))
    row_max=res.max(axis=1); ys=np.arange(res.shape[0])
    slot_ids=np.clip(np.floor((247-ys)/44.0+0.5).astype(int),0,n_slots-1)
    return [float(row_max[slot_ids==s].max()) if (slot_ids==s).any() else -1.0 for s in range(n_slots)]
def kill_notice_slots(img):
    return [bool(s>0.6) for s in kill_notice_slot_scores(img)]
def kill_notice(img):             # '〇〇をたおした!' bottom center (renders over map too)
    return any(kill_notice_slots(img))
def gauge(img):                   # special gauge ring: (white_frac, orange_frac)
    g=img[10:150,1115:1260]; yy,xx=np.mgrid[0:140,0:145]; r=np.hypot(xx-75,yy-72); ann=(r>40)&(r<62)
    h=cv2.cvtColor(g,cv2.COLOR_BGR2HSV)[ann]
    return float(((h[:,1]<90)&(h[:,2]>190)).mean()), float(((h[:,0]>5)&(h[:,0]<28)&(h[:,1]>140)&(h[:,2]>150)).mean())
def icon_crops(img):
    return [cv2.resize(img[14:76,x:x+58],(32,32),interpolation=cv2.INTER_AREA) for x in SLOT_X]
def hue_dist(h,th): h=h.astype(int); d=abs(h-th); return np.minimum(d,180-d)
def icon_feat(crop,team_hue):
    hsv=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV)
    tm=((hue_dist(hsv[...,0],team_hue)<12)&(hsv[...,1]>100)&(hsv[...,2]>90)).astype(np.float32)
    s=hsv[...,1]/255.; v=hsv[...,2]/255.
    gray=((hsv[...,1]<60)&(hsv[...,2]>110)&(hsv[...,2]<220)).astype(np.float32); dk=(hsv[...,2]<70).astype(np.float32)
    ds=lambda a: cv2.resize(a.astype(np.float32),(8,8),interpolation=cv2.INTER_AREA).ravel()
    return np.concatenate([ds(tm),ds(s),ds(v),ds(gray),ds(dk)])
ALLY_PLATES={'L1':(10,320,310,75),'L2':(470,20,330,75),'L3':(935,320,320,75)}
ENEMY_ROWS={'R0':37,'R1':82,'R2':125,'R3':167}
def ally_plate_crossed(img,team_hue):
    out={}
    for k,(x,y,w,h) in ALLY_PLATES.items():
        hsv=cv2.cvtColor(img[y:y+h,x:x+w],cv2.COLOR_BGR2HSV)
        dark=(hsv[...,2]<60).mean(); tc=((hue_dist(hsv[...,0],team_hue)<15)&(hsv[...,1]>120)&(hsv[...,2]>150)).mean()
        out[k]=bool(dark>0.35 and tc>0.08)
    return out
def enemy_row_crossed(img,team_hue):
    out={}
    for k,y in ENEMY_ROWS.items():
        hsv=cv2.cvtColor(img[y:y+38,1025:1240],cv2.COLOR_BGR2HSV)
        m=((hue_dist(hsv[...,0],team_hue)<12)&(hsv[...,1]>120)&(hsv[...,2]>150)).astype(np.uint8)*255
        L=cv2.HoughLinesP(m,1,np.pi/180,30,minLineLength=70,maxLineGap=8); n=0
        if L is not None:
            for x1,y1,x2,y2 in L.reshape(-1,4):
                ang=abs(np.degrees(np.arctan2(y2-y1,x2-x1)))%180; ang=min(ang,180-ang)
                if 5<ang<35: n+=1
        out[k]=n>=2
    return out
def scoreboard(img):
    """result table: big dark panel right, non-dark character left"""
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV); v=hsv[...,2]; sat=hsv[...,1]
    band=lambda y0,y1: ((sat[y0:y1,640:1140]>120)&(v[y0:y1,640:1140]>120)).mean()
    if not (band(222,240)>0.5 and band(458,476)>0.5 and (v[250:420,660:1130]<45).mean()>0.35): return False
    return (v[180:680,640:1140]<45).mean()>0.45 and (v[150:650,0:450]<45).mean()<0.6 and (v[150:650,1180:1250]<60).mean()>0.5
