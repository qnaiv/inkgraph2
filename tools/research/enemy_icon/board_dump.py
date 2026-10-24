import sys,json,os,cv2,numpy as np
sys.path.insert(0,'/workspace/ig-weap/src')
from inkgraph import result as R
V=json.load(open('/workspace/igw/videos12.json'))
out={}
for name,p in V.items():
    cap=cv2.VideoCapture(p); n=cap.get(cv2.CAP_PROP_FRAME_COUNT); fps=cap.get(cv2.CAP_PROP_FPS); dur=n/fps
    res,S=R.read_results(p,max(0,dur-60))
    t=res['board_frame_t']; B=res['board']
    if t is None: print(name,'no board'); continue
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000); ok,img=cap.read()
    cv2.imwrite(f'board_{name}.png',img)
    off=[x for x in S['board'] if abs(x[0]-t)<0.01][0][2]
    own=[b for b in B if b['own']]
    out[name]=dict(t=t,dur=dur,result=res['result'],off=off,own_group=own[0]['group'] if own else None,h=img.shape[0])
    print(name,out[name],flush=True)
json.dump(out,open('boards.json','w'),ensure_ascii=False,indent=1)
