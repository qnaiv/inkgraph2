"""Build digit/header templates from result screens and evaluate own-result reading (leave-one-match-out).
usage: python eval_results.py [--build]"""
import sys,os,json,pickle,cv2,numpy as np
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from inkgraph import result as R
from inkgraph.common import TPL
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J=lambda *p: os.path.join(ROOT,*p)
# (id, video, tail start, end, truth)
MATCHES=[('old1',J('raw','full.mp4'),200,280,dict(result='LOSE',mode='ガチヤグラ',stage='リュウグウターミナル',ka=2,deaths=5,specials=1)),
         ('old2',J('raw','full.mp4'),745,800,dict(result='WIN',mode='ガチヤグラ',stage='ザトウマーケット',ka=5,deaths=7,specials=4)),
         ('m1',J('raw','1080p','joined_match01.mp4'),330,None,dict(result='LOSE',mode='ガチヤグラ',stage='クサヤ温泉',ka=8,deaths=8,specials=5)),
         ('m2',J('raw','1080p','joined_match02.mp4'),330,None,dict(result='WIN',mode='ガチヤグラ',stage='クサヤ温泉',ka=4,deaths=6,specials=3)),
         ('m3',J('raw','1080p','joined_match03.mp4'),330,None,dict(result='LOSE',mode='ガチヤグラ',stage='クサヤ温泉',ka=4,deaths=6,specials=5))]
def scans():
    p=J('work','res_scans.pkl')
    if os.path.exists(p): return pickle.load(open(p,'rb'))
    S={mid:R.scan(v,a,b) for mid,v,a,b,_ in MATCHES}
    for s in S.values():   # keep only picked frames to save space
        for k in s: s[k]=R._pick(s[k],7) if k!='celebration' else s[k][::4]
    pickle.dump(S,open(p,'wb')); return S
BOARDS={'old1':[(9,2,3),(7,2,2),(6,3,3),(6,4,1),(5,4,1),(2,5,1),(4,5,2),(2,5,1)],
        'old2':[(7,7,4),(16,11,2),(5,7,4),(13,10,3),(10,10,4),(8,2,2),(14,10,3),(11,9,4)],
        'm3':[(12,7,5),(11,3,4),(11,4,6),(9,7,1),(10,10,4),(4,5,2),(5,11,3),(4,6,5)]}   # read by eye; used only as extra digit samples
def build(S):
    X=[];y=[];src=[]
    for mid,vals in BOARDS.items():
        for _,_,off,img in S[mid]['board']:
            for r,tv in zip(R.board_rows(img,*off),vals):
                gs=R.stat_glyphs(img,r['y']+2,r['y']+34,965+off[0],1160+off[0])
                if len(gs)!=3: continue
                for g,val in zip(gs,tv):
                    ds=f'{val:0{len(g)}d}'
                    if len(ds)==len(g):
                        for b,d in zip(g,ds): X.append(R.dfeat(b)); y.append(int(d)); src.append(mid)
    for mid,_,_,_,tr in MATCHES:
        for _,_,off,img in S[mid]['personal']:
            y0,y1,x0,x1=R.PERSONAL_ROW; gs=R.stat_glyphs(img,y0+off[1],y1+off[1],x0+off[0],x1+off[0])
            if len(gs)!=3: continue
            for g,val in zip(gs,[tr['ka'],tr['deaths'],tr['specials']]):
                ds=f'{val:0{len(g)}d}'
                if len(ds)!=len(g): continue
                for b,d in zip(g,ds): X.append(R.dfeat(b)); y.append(int(d)); src.append(mid)
        fr=(S[mid]['personal'] or S[mid]['board'])
        if fr:
            _,_,off,img=fr[len(fr)//2]; m,s=R.header_crops(img,*off)
            cv2.imwrite(os.path.join(TPL,'res_mode',f"{tr['mode']}__{mid}.png"),R._wb(m)); cv2.imwrite(os.path.join(TPL,'res_stage',f"{tr['stage']}__{mid}.png"),R._wb(s))
    np.savez(os.path.join(TPL,'res_digits','digits.npz'),X=np.array(X),y=np.array(y),src=np.array(src)); R._D=None
    print('digit samples',len(y),'classes',sorted(set(y)))
def evaluate(S):
    keys=['result','mode','stage','ka','deaths','specials']; ok={k:0 for k in keys}; rows=[]
    for mid,v,a,b,tr in MATCHES:
        res,_=R.read_results(v,a,b,exclude_src=mid,exclude_hdr='__'+mid,S=S[mid])
        det=dict(result=res['result'],mode=res['mode'],stage=res['stage'],**(res['own'] or {}))
        for k in keys: ok[k]+=det.get(k)==tr[k]
        rows.append((mid,det,tr))
        print(mid,{k:(det.get(k),tr[k]) for k in keys if det.get(k)!=tr[k]} or 'all correct', det)
    n=len(MATCHES); print('accuracy (leave-one-match-out):',{k:f'{ok[k]}/{n}' for k in keys})
    return ok
if __name__=='__main__':
    S=scans()
    if '--build' in sys.argv or not os.path.exists(os.path.join(TPL,'res_digits','digits.npz')): build(S)
    evaluate(S)
