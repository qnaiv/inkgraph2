"""Tower series agreement web vs Python (holder / count per ~1s sample). usage: python web/tools/tower_agree.py [web_matches.json]"""
import json, os, sys
R=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
web=json.load(open(sys.argv[1] if len(sys.argv)>1 else os.path.join(R,'web/test-results/web_matches.json')))
T=[0,0,0,0]
for m in sorted(web,key=lambda m:m['source']['name']):
    no=int(m['source']['name'].split('match')[-1][:2]); py=json.load(open(os.path.join(R,f'out/1080p/match0{no}/timeline.json')))[0]
    ws=m.get('tower_series') or []; n=ho=co=0
    for s in py['tower_series']:
        w=min(ws,key=lambda x:abs(x['t']-s['t']),default=None)
        if not w or abs(w['t']-s['t'])>0.7: continue
        n+=1; ho+=w['owner']==s['owner']; co+=(w['own'],w['enemy'])==(s['own'],s['enemy'])
    print(f"match0{no}: holder {ho}/{n} ({ho/max(n,1):.1%})  count {co}/{n} ({co/max(n,1):.1%})"); T=[T[0]+n,T[1]+ho,T[2]+co,0]
print(f"total: holder {T[1]}/{T[0]} ({T[1]/T[0]:.1%})  count {T[2]}/{T[0]} ({T[2]/T[0]:.1%})")
