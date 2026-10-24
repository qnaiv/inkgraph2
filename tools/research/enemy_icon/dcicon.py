import numpy as np,cv2,json,subprocess,sys
vids=json.load(open('/workspace/igw/videos12.json'))
truth=json.load(open('/workspace/ig-weap/labels/killer/killer_truth.json'))
B=json.load(open('boards.json'))
tpl=cv2.imread('/workspace/ig-weap/templates/tpl_deathcam_yarareta.png',0)
out=[]
for k,d in enumerate(truth):
    v=d['video']; t0=d['death_start']+1.0
    b=subprocess.run(['ffmpeg','-v','error','-ss',str(t0),'-t','7','-i',vids[v],'-vf','fps=4','-f','rawvideo','-pix_fmt','bgr24','-'],capture_output=True).stdout
    F=np.frombuffer(b,np.uint8).reshape(-1,1080,1920,3); best=[]
    for i,fr in enumerate(F):
        sm=cv2.resize(fr,(1280,720),interpolation=cv2.INTER_AREA)
        hsv=cv2.cvtColor(sm,cv2.COLOR_BGR2HSV); wb=((hsv[...,2]>190)&(hsv[...,1]<70)).astype(np.uint8)*255
        r=cv2.matchTemplate(wb,tpl,cv2.TM_CCOEFF_NORMED); _,s,_,(x,y)=cv2.minMaxLoc(r); best.append((s,i,x,y))
    best.sort(reverse=True); s,i,x,y=best[0]
    rec=dict(idx=k,video=v,death_start=d['death_start'],killer=d['killer'],yscore=round(float(s),3))
    if s>=0.6:
        # take 3 best frames
        crops=[]
        for s2,i2,x2,y2 in best[:16]:
            if s2<0.6: continue
            X=int(x2*1.5); Y=int(y2*1.5); cx=X+int(43*1.5)
            c=F[i2][max(0,Y-230):max(0,Y-40), max(0,cx-330):cx+150].copy()
            crops.append(c)
        for j,c in enumerate(crops): cv2.imwrite(f'dc/{k:02d}_{j}.png',c)
        rec['n']=len(crops)
    out.append(rec); print(rec,flush=True)
json.dump(out,open('dc.json','w'),ensure_ascii=False,indent=0)
