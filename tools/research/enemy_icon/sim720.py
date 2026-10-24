import cv2,json,numpy as np,itertools
B=json.load(open('boards.json')); E=json.load(open('evalx.json')); L=E['label']
RY={'top':[262,306,350,394],'bot':[499,543,587,631]}
ic={}
for v in B:
    F=cv2.resize(cv2.imread(f'board_{v}.png'),(1280,720),interpolation=cv2.INTER_AREA)
    for g in RY:
        for i,y in enumerate(RY[g]): ic[f'{v}_{g}{i}']=cv2.cvtColor(F[y:y+34,696:752],cv2.COLOR_BGR2GRAY).astype(np.float32)
def sim(a,b):
    r=cv2.matchTemplate(b,a[2:32,7:49],cv2.TM_CCOEFF_NORMED); return float(r.max())
names=list(ic); n=len(names); S=np.zeros((n,n))
for i in range(n):
    for j in range(n): S[i,j]=sim(ic[names[i]],ic[names[j]])
S=np.minimum(S,S.T); np.save('S720.npy',S); json.dump(names,open('names720.json','w'))
ix={k:i for i,k in enumerate(names)}
same=[];diff=[]
for a,b in itertools.combinations(L,2):
    if a.rsplit('_',1)[0]==b.rsplit('_',1)[0]: continue
    (same if L[a]==L[b] else diff).append((S[ix[a],ix[b]],L[a],L[b]))
print('same',sorted(round(x[0],3) for x in same)); print('diff top',sorted(diff,reverse=True)[:5])
v=np.sort(S[np.triu_indices(n,1)])[::-1]; print(np.histogram(v,bins=[0,.5,.7,.8,.85,.9,.93,.95,1]))
