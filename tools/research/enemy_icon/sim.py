import cv2,json,numpy as np,glob,os
fs=sorted(glob.glob('ic/*.png')); names=[os.path.basename(f)[:-4] for f in fs]
ims=[cv2.imread(f) for f in fs]
def feat(im):  # inner crop, gray
    return im[3:48,10:82]
def sim(a,b,sh=4):
    A=cv2.cvtColor(feat(a),cv2.COLOR_BGR2GRAY).astype(np.float32)
    Bb=cv2.cvtColor(b,cv2.COLOR_BGR2GRAY).astype(np.float32)
    r=cv2.matchTemplate(Bb,A,cv2.TM_CCOEFF_NORMED); return float(r.max())
def simc(a,b):
    A=feat(a).astype(np.float32); r=cv2.matchTemplate(b.astype(np.float32),A,cv2.TM_CCOEFF_NORMED); return float(r.max())
n=len(ims); S=np.zeros((n,n)); C=np.zeros((n,n))
for i in range(n):
    for j in range(n):
        S[i,j]=sim(ims[i],ims[j]); C[i,j]=simc(ims[i],ims[j])
S=np.minimum(S,S.T); C=np.minimum(C,C.T)
np.save('S.npy',S); np.save('C.npy',C); json.dump(names,open('names.json','w'))
v=np.sort(S[np.triu_indices(n,1)])[::-1]; print(np.round(v[:80],2)); print(np.histogram(v,bins=[0,.3,.4,.5,.6,.7,.8,.85,.9,.95,1]))
