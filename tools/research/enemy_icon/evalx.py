import json,collections,numpy as np
R=json.load(open('match.json')); B=json.load(open('boards.json'))
names=json.load(open('names.json')); S=np.load('S.npy'); ix={n:i for i,n in enumerate(names)}
TH_S,TH_M,TH_X=0.68,0.15,0.93
opp={'top':'bot','bot':'top'}
# 1) link deathcam -> slot
lab=collections.defaultdict(collections.Counter)
conf=0
for r in R:
    if r['score']>=TH_S and r['margin']>=TH_M:
        conf+=1; lab[f"{r['video']}_{r['slot']}"][r['killer']]+=1
conflict=[k for k,c in lab.items() if len(c)>1]
label={k:c.most_common(1)[0][0] for k,c in lab.items()}
# slot-level conflict: same name -> 2 slots in a match
print('deaths',len(R),'confident',conf,'labeled slots',len(label),'conflict slots',conflict)
# 2) enemy slots across all matches
enemy=[f"{v}_{opp[b['own_group']]}{i}" for v,b in B.items() for i in range(4)]
# leave-one-match-out
ok=ng=unk=0; rows=[]; amb=[]
for s in enemy:
    v=s.rsplit('_',1)[0]
    cands=[(S[ix[s],ix[t]],label[t]) for t in label if t.rsplit('_',1)[0]!=v]
    cands.sort(reverse=True)
    hi={n for sc,n in cands if sc>=TH_X}
    pred=(hi.pop() if len(hi)==1 else None)
    if len(hi)>1: amb.append((s,sorted(hi)))
    sc=cands[0][0] if cands else 0
    truth=label.get(s)
    if truth:
        if pred is None: unk+=1
        elif pred==truth: ok+=1
        else: ng+=1
    rows.append(dict(slot=s,truth=truth,loo_pred=pred,score=round(float(sc),3)))
print('ambiguous',amb); print('LOO on labeled: ok',ok,'wrong',ng,'unknown',unk)
# 3) full library coverage (named via own-match link or other-match library)
named=0
for r in rows:
    s=r['slot']; v=s.rsplit('_',1)[0]
    full=label.get(s) or r['loo_pred']
    r['final']=full; named+=full is not None
print('enemy slots',len(enemy),'named',named)
json.dump(dict(label=label,rows=rows),open('evalx.json','w'),ensure_ascii=False,indent=1)
for r in rows: print(r)
