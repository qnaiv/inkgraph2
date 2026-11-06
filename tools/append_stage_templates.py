"""templates/res_stage の見本のうち、web/public/assets/inkgraph_assets.json の lib.stage に無いものだけを足す。
export_web_assets.py を全体で再実行すると、既存の match_type の値が環境差で変わるため（D47 の注記）、stage の足し算だけをする。
usage: python tools/append_stage_templates.py [--dry]"""
import os, sys, json, glob, base64, cv2, numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, 'src'))
from inkgraph.common import imread_unicode, TPL
def b64(a): return base64.b64encode(np.ascontiguousarray(a).astype(np.uint8).tobytes()).decode()
p = os.path.join(ROOT, 'web', 'public', 'assets', 'inkgraph_assets.json')
out = json.load(open(p, encoding='utf-8')); lib = out['lib']['stage']; added = []
for f in sorted(glob.glob(os.path.join(TPL, 'res_stage', '*.png'))):
    k = os.path.splitext(os.path.basename(f))[0]
    if k in lib: continue
    lib[k] = b64(cv2.resize(imread_unicode(f, 0), (120, 32))); added.append(k)
print('added', len(added)); [print(' ', k) for k in added]
if '--dry' not in sys.argv: json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False); print('wrote', p, os.path.getsize(p))
