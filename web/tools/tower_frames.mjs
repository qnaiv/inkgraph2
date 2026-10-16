// Frame-level tower check: same decoded pixels (dumped by Python cv2) through JS towerRow vs Python marker/badge.
// Needs /tmp/tw{n}.json + /tmp/tw{n}_{mk,bd}.raw (see docs/AGY_LOG.md #3). usage: node tools/tower_frames.mjs
import fs from 'node:fs'; import path from 'node:path';
import { prepAssets } from '../src/core/assets.js'; import { towerRow } from '../src/core/tower.js';
const D = path.resolve(import.meta.dirname, '..'); const A = prepAssets(JSON.parse(fs.readFileSync(path.join(D, 'public/assets', fs.readdirSync(path.join(D, 'public/assets')).find(f => f.endsWith('.json'))))));
const W = 1280, H = 720; let T = [0, 0, 0, 0, 0];
for (const n of (process.env.TW_N||'1,2,3').split(',').map(Number)) {
  const J = JSON.parse(fs.readFileSync(`${process.env.TW_DIR || '/tmp'}/tw${n}.json`)); const mk = fs.readFileSync(`${process.env.TW_DIR || '/tmp'}/tw${n}_mk.raw`), bd = fs.readFileSync(`${process.env.TW_DIR || '/tmp'}/tw${n}_bd.raw`);
  let N = 0, ho = 0, hx = 0, cnt = 0, det = 0; const conf = {}; const t0 = Date.now();
  J.rows.forEach((row, k) => {
    const data = new Uint8ClampedArray(W * H * 4);
    const put = (buf, y0, h) => { for (let y = 0; y < h; y++) for (let x = 0; x < 620; x++) { const s = ((k * h + y) * 620 + x) * 3, o = ((y0 + y) * W + 330 + x) * 4; data[o] = buf[s]; data[o + 1] = buf[s + 1]; data[o + 2] = buf[s + 2]; data[o + 3] = 255; } };
    put(mk, 78, 50); put(bd, 122, 68);
    const r = towerRow(A, { w: W, h: H, data }, J.th, row.t); N++;
    const po = row.marker ? row.marker.owner : 'none', wo = r.marker ? r.marker.owner : 'none'; ho += po === wo; conf[po + '>' + wo] = (conf[po + '>' + wo] || 0) + 1;
    if (row.marker && r.marker) { det++; hx += Math.abs(row.marker.x - r.marker.x) <= 4; }
    cnt += r.own === row.own && r.enemy === row.enemy;
  });
  console.log(`match0${n}: owner ${ho}/${N} (${(100 * ho / N).toFixed(1)}%)  x±4 ${hx}/${det}  badges ${cnt}/${N} (${(100 * cnt / N).toFixed(1)}%)  ${((Date.now() - t0) / N).toFixed(1)}ms/frame`, JSON.stringify(conf));
  T[0] += N; T[1] += ho; T[2] += cnt;
}
console.log(`total: owner ${T[1]}/${T[0]} (${(100 * T[1] / T[0]).toFixed(1)}%)  badges ${T[2]}/${T[0]} (${(100 * T[2] / T[0]).toFixed(1)}%)`);
