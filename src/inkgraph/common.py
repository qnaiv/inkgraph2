import os, cv2, numpy as np
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TPL=os.path.join(ROOT,'templates'); MODELS=os.path.join(ROOT,'models')
W,H=1280,720
def tpl(name): return cv2.imread(os.path.join(TPL,name),0)
def wb(img,th=190):
    g=img if img.ndim==2 else cv2.cvtColor(np.ascontiguousarray(img),cv2.COLOR_BGR2GRAY)
    return cv2.threshold(g,th,255,cv2.THRESH_BINARY)[1]
def match(region,t,th=190):
    r=wb(region,th)
    if r.shape[0]<t.shape[0] or r.shape[1]<t.shape[1]: return 0.0
    return float(np.nan_to_num(cv2.matchTemplate(r,t,cv2.TM_CCOEFF_NORMED)).max())
def frames(path,step_s=0.2,start=0.0,end=None):
    """yield (t, bgr 1280x720) every step_s seconds using grab() for speed"""
    cap=cv2.VideoCapture(path); fps=cap.get(cv2.CAP_PROP_FPS) or 30; n=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    f0=int(start*fps); cap.set(cv2.CAP_PROP_POS_FRAMES,f0); f=f0; nxt=start
    last=n if end is None else min(n,int(end*fps))
    while f<last:
        if not cap.grab(): break
        t=f/fps
        if t+1e-6>=nxt:
            ok,img=cap.retrieve()
            if ok:
                if img.shape[1]!=W: img=cv2.resize(img,(W,H),interpolation=cv2.INTER_AREA)
                yield t,img
            nxt+=step_s
        f+=1
    cap.release()
def runs(t,mask,minlen=0.0,gap=0.0):
    r=[];i=0
    while i<len(mask):
        if mask[i]:
            j=i
            while j<len(mask) and mask[j]: j+=1
            r.append([float(t[i]),float(t[j-1])]); i=j
        else: i+=1
    o=[]
    for a,b in r:
        if o and a-o[-1][1]<=gap: o[-1][1]=b
        else: o.append([a,b])
    return [x for x in o if x[1]-x[0]>=minlen]
