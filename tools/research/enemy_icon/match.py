import cv2,json,numpy as np,glob,sys
B=json.load(open('boards.json')); D=json.load(open('dc.json'))
opp={'top':'bot','bot':'top'}
def tpl(name,g,i):
    im=cv2.imread(f'ic/{name}_{g}{i}.png')[3:48,6:84]
    hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV)
    m=((hsv[...,2]>60)).astype(np.uint8)*255
    return im,m
SC=np.arange(1.9,2.75,0.05)
res=[]
for d in D:
    v=d['video']; 
    if v not in B or d.get('n',0)==0: continue
    eg=opp[B[v]['own_group']]
    T=[tpl(v,eg,i) for i in range(4)]
    fr=sorted(glob.glob(f"dc/{d['idx']:02d}_*.png"))
    best=np.full(4,-1.0)
    for f in fr:
        F=cv2.imread(f)
        for i,(t,m) in enumerate(T):
            for s in SC:
                t2=cv2.resize(t,None,fx=s,fy=s); m2=cv2.resize(m,None,fx=s,fy=s,interpolation=cv2.INTER_NEAREST)
                if t2.shape[0]>F.shape[0] or t2.shape[1]>F.shape[1]: continue
                r=cv2.matchTemplate(F,t2,cv2.TM_CCOEFF_NORMED)
                r[~np.isfinite(r)]=-1
                best[i]=max(best[i],r.max())
    o=np.argsort(-best)
    res.append(dict(idx=d['idx'],video=v,killer=d['killer'],slot=f'{eg}{o[0]}',score=float(best[o[0]]),margin=float(best[o[0]]-best[o[1]]),all=best.round(3).tolist()))
    print(res[-1],flush=True)
json.dump(res,open('match.json','w'),ensure_ascii=False,indent=1)
