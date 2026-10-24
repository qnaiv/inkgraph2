"""Export templates / classifiers for the browser app -> web/public/assets/inkgraph_assets.json
usage: python tools/export_web_assets.py"""
import os, sys, json, glob, base64, pickle, cv2, numpy as np
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0,os.path.join(ROOT,'src'))
from inkgraph.common import imread_unicode, TPL, MODELS
def b64(a): return base64.b64encode(np.ascontiguousarray(a).astype(np.uint8).tobytes()).decode()
def binimg(a,th): b=(a>th).astype(np.uint8); return dict(w=int(b.shape[1]),h=int(b.shape[0]),data=b64(b))
def gray(name): return imread_unicode(os.path.join(TPL,name),0)
out={'version':1,'tpl':{},'gray':{},'lib':{'mode':{},'stage':{},'match_type':{}}}
for n,th in [('tpl_colon.png',127),('tpl_signal_yarareta.png',127),('tpl_signal_camon.png',127),('tpl_wotaoshita.png',127)]:
    out['tpl'][n[:-4]]=binimg(gray(n),th)
mx=gray('tpl_mapx.png')[15:75,15:75]; out['tpl']['tpl_mapx']=binimg(mx,200)
for n in ('tpl_res_cel_win','tpl_res_cel_lose'): out['tpl'][n]=binimg(gray(n+'.png'),200)
out['tpl']['tpl_res_lobby']=binimg(gray('tpl_res_lobby.png'),170)
out['tpl']['tpl_res_lobby_x']=binimg(gray('tpl_res_lobby_x.png'),170)
for n in ('tpl_res_board_win','tpl_res_board_lose'):
    v=cv2.cvtColor(imread_unicode(os.path.join(TPL,n+'.png')),cv2.COLOR_BGR2HSV)[...,2]
    out['gray'][n]=dict(w=int(v.shape[1]),h=int(v.shape[0]),data=b64(v))
for kind, folder in (('mode', 'res_mode'), ('stage', 'res_stage'), ('match_type', 'res_matchtype')):
    for p in sorted(glob.glob(os.path.join(TPL,folder,'*.png'))):
        k=os.path.splitext(os.path.basename(p))[0]; t=cv2.resize(imread_unicode(p,0),(120,32))
        if kind=='match_type': t=((t>170)*255).astype('uint8')  # small label: binarize like normText crops so Pearson stays high
        out['lib'][kind][k]=b64(t)
clf=pickle.load(open(os.path.join(MODELS,'icon_lr.pkl'),'rb'))
out['icon_lr']=dict(coef=[round(float(x),6) for x in clf.coef_.ravel()],intercept=float(clf.intercept_[0]))
for key,f in (('digits','digits.npz'),('tc_digits','tc_badge_digits.npz')):
    z=np.load(os.path.join(TPL,'res_digits',f)); out[key]=dict(X=[[round(float(v),4) for v in r] for r in z['X']],y=[int(v) for v in z['y']])
# D47: デスカメ吹き出しの「やられた!」（720p の 2 値）と、やられた相手のブキ名の見本（web/tools/killer_lib_build.mjs が作る）
kl=os.path.join(TPL,'killer_lib.json')
out['killer']=dict(tpl=binimg(gray('tpl_deathcam_yarareta.png'),127),lib=json.load(open(kl,encoding='utf-8'))['lib'] if os.path.exists(kl) else [])
p=os.path.join(ROOT,'web','public','assets','inkgraph_assets.json'); json.dump(out,open(p,'w'),ensure_ascii=False)
print('wrote',p,os.path.getsize(p))
