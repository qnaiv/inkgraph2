// Per-frame cues (port of src/inkgraph/cues.py). fr = {w:1280,h:720,data:RGBA}
import { crop, sub, gray, bin, hsv, hueDist, nccBin, resizeCropArea, resizeArea, median } from './img.js';
const regBin = (fr, x0, y0, x1, y1, th) => { const c = crop(fr, x0, y0, x1, y1); return { c, b: bin(gray(c), th) }; };
export function timerPresent(A, fr) { const { c, b } = regBin(fr, 614, 28, 648, 72, 180); return nccBin(b, c.w, c.h, A.tpl.tpl_colon, 0.6).score > 0.6; }
export function mapOpen(A, fr) { const { c, b } = regBin(fr, 15, 10, 130, 125, 200); return nccBin(b, c.w, c.h, A.tpl.tpl_mapx, 0.6).score > 0.6; }
export function ownDeadSignal(A, fr) { const { c, b } = regBin(fr, 15, 590, 100, 624, 215);
  const y = nccBin(b, c.w, c.h, A.tpl.tpl_signal_yarareta).score; if (y <= 0.5) return { dead: false, y };
  const k = nccBin(b, c.w, c.h, A.tpl.tpl_signal_camon).score; return { dead: y > k, y }; }
export function killNoticeSlotScores(A, fr) {
  const scores = [];
  for (let k = 0; ; k++) {
    const anchor = 247 - 44 * k;
    if (anchor < 0) break;
    const isTop = (anchor - 44 < 0);
    const topRel = isTop ? 0 : Math.max(0, anchor - 22);
    const botRel = k === 0 ? 300 : Math.min(300, anchor + 22 + 25);
    const y0 = 420 + topRel;
    const y1 = 420 + botRel;
    const { c, b } = regBin(fr, 200, y0, 1080, y1, 190);
    const res = nccBin(b, c.w, c.h, A.tpl.tpl_wotaoshita, 0.6);
    scores.push(res.score);
  }
  return scores;
}
export function killNoticeSlots(A, fr) { return killNoticeSlotScores(A, fr).map(s => s > 0.6); }
export function killNotice(A, fr) { return killNoticeSlots(A, fr).some(Boolean); }
let ANN = null;
export function gauge(fr) {
  const c = crop(fr, 1115, 10, 1260, 150), h = hsv(c);
  if (!ANN) { ANN = new Uint8Array(140 * 145); for (let y = 0; y < 140; y++) for (let x = 0; x < 145; x++) { const r = Math.hypot(x - 75, y - 72); ANN[y * 145 + x] = r > 40 && r < 62 ? 1 : 0; } }
  let n = 0, w = 0, o = 0; for (let i = 0; i < ANN.length; i++) { if (!ANN[i]) continue; n++; const H = h.H[i], S = h.S[i], V = h.V[i];
    if (S < 90 && V > 190) w++; if (H > 5 && H < 28 && S > 140 && V > 150) o++; }
  return [w / n, o / n];
}
export const SLOT_X = [0, 1, 2, 3].map(i => 352 + 59 * i).concat([0, 1, 2, 3].map(i => 700 + 59 * i));
export function iconCrops(fr) { return SLOT_X.map(x => resizeCropArea(crop(fr, x, 14, x + 58, 76), 32, 32)); }
const ds = a => resizeArea(a, 32, 32, 8, 8);
export function iconFeat(c, teamHue) {
  const h = hsv(c), n = 1024, tm = new Float32Array(n), s = new Float32Array(n), v = new Float32Array(n), g = new Float32Array(n), dk = new Float32Array(n);
  for (let i = 0; i < n; i++) { const H = h.H[i], S = h.S[i], V = h.V[i]; tm[i] = hueDist(H, teamHue) < 12 && S > 100 && V > 90 ? 1 : 0; s[i] = S / 255; v[i] = V / 255; g[i] = S < 60 && V > 110 && V < 220 ? 1 : 0; dk[i] = V < 70 ? 1 : 0; }
  const f = new Float32Array(320); [tm, s, v, g, dk].forEach((a, j) => f.set(ds(a), j * 64)); return f;
}
export function iconProb(A, f) { let z = A.icon.b; for (let i = 0; i < 320; i++) z += A.icon.coef[i] * f[i]; return 1 / (1 + Math.exp(-z)); }
export function iconSat(c) { const h = hsv(sub(c, 4, 4, 28, 28)); return median(h.S); }
export function hueHist(crops, side, hist) { for (const c of crops.slice(side * 4, side * 4 + 4)) { const h = hsv(c); for (let i = 0; i < h.H.length; i++) if (h.S[i] > 170 && h.V[i] > 150) hist[h.H[i]]++; } }
export const ALLY_PLATES = { L1: [10, 320, 310, 75], L2: [470, 20, 330, 75], L3: [935, 320, 320, 75] };
export function allyPlateCrossed(fr, teamHue) { const o = {};
  for (const [k, [x, y, w, hh]] of Object.entries(ALLY_PLATES)) { const h = hsv(crop(fr, x, y, x + w, y + hh)); let dark = 0, tc = 0; const n = h.V.length;
    for (let i = 0; i < n; i++) { if (h.V[i] < 60) dark++; if (hueDist(h.H[i], teamHue) < 15 && h.S[i] > 120 && h.V[i] > 150) tc++; }
    o[k] = dark / n > 0.35 && tc / n > 0.08; }
  return o; }
export function scoreboard(fr) {
  const h = hsv(crop(fr, 0, 0, 1280, 720)); const at = (x, y) => y * 1280 + x;
  const frac = (x0, x1, y0, y1, f) => { let c = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (f(at(x, y))) c++; } return c / n; };
  const band = (y0, y1) => frac(640, 1140, y0, y1, i => h.S[i] > 120 && h.V[i] > 120);
  if (!(band(222, 240) > 0.5 && band(458, 476) > 0.5 && frac(660, 1130, 250, 420, i => h.V[i] < 45) > 0.35)) return false;
  return frac(640, 1140, 180, 680, i => h.V[i] < 45) > 0.45 && frac(0, 450, 150, 650, i => h.V[i] < 45) < 0.6 && frac(1180, 1250, 150, 650, i => h.V[i] < 60) > 0.5;
}
