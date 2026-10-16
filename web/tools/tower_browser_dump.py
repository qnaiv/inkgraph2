"""Downscale browser dumps (1.5x, INTER_AREA) into tower_frames.mjs format (/tmp/br)."""
import numpy as np, cv2, shutil
for n in [1,2,3]:
    a=np.fromfile(f'/tmp/br/tw{n}_full.raw',np.uint8).reshape(-1,168,930,4)[...,:3]
    s=np.stack([cv2.resize(f,(620,112),interpolation=cv2.INTER_AREA) for f in a])
    s[:,0:50].tofile(f'/tmp/br/tw{n}_mk.raw'); s[:,44:112].tofile(f'/tmp/br/tw{n}_bd.raw'); shutil.copy(f'/tmp/tw{n}.json','/tmp/br/')
