// Tower Control context (port of src/inkgraph/tower.py). Hough circle replaced by colour-blob search.
import { crop, gray, hsv, hueDist, morphOpen3, components, resizeArea } from './img.js';
import { nn } from './assets.js';
const ENDS = [341, 937];
function badgeCrop(fr, band, h, hue) {
  const w = band.w, m = new Uint8Array(w * band.h); for (let i = 0; i < m.length; i++) m[i] = hueDist(h.H[i], hue) < 10 && h.S[i] > 150 && h.V[i] > 130 ? 1 : 0;
  const { comps } = components(morphOpen3(m, w, band.h), w, band.h); let b = null;
  for (const c of comps) if (c.w >= 28 && c.w <= 60 && c.h >= 25 && c.h <= 70 && c.a > 500 && (!b || c.a > b.a)) b = c;
  if (!b) return null; return { x: Math.round(b.x + 330 + b.w / 2), c: crop(fr, 330 + b.x - 3, 122 + b.y - 4, 330 + b.x + b.w + 3, 122 + b.y + b.h + 2) };
}
function readBadge(A, cr) {
  const y0 = Math.floor(cr.h * 0.38), c = { w: cr.w, h: cr.h - y0, r: cr.r.subarray(y0 * cr.w), g: cr.g.subarray(y0 * cr.w), b: cr.b.subarray(y0 * cr.w) };
  const h = hsv(c), m = new Uint8Array(c.w * c.h); for (let i = 0; i < m.length; i++) m[i] = h.V[i] > 200 && h.S[i] < 90 ? 1 : 0;
  const { comps } = components(m, c.w, c.h); const cs = comps.filter(s => s.h >= 9 && s.a >= 15).sort((a, b) => b.a - a.a).slice(0, 2).sort((a, b) => a.x - b.x);
  if (cs.length !== 2) return null;
  return parseInt(cs.map(s => { const g = new Float32Array(s.w * s.h); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) g[y * s.w + x] = m[(s.y + y) * c.w + s.x + x] * 255;
    const f = resizeArea(g, s.w, s.h, 8, 12), o = new Float32Array(97); for (let i = 0; i < 96; i++) o[i] = f[i] / 255; o[96] = s.w / s.h; return nn(A.tc_digits, o).y; }).join(''));
}
const PER = [...Array(48)].map((_, i) => [Math.cos(i * Math.PI / 24), Math.sin(i * Math.PI / 24)]);
/** circle search (replaces cv2.HoughCircles): fraction of perimeter samples with a strong, radial gradient */
export function findCircle(c) {
  const w = c.w, h = c.h, g0 = gray(c), g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx)); v.push(g0[yy * w + xx]); } v.sort((a, b) => a - b); g[y * w + x] = v[4]; }
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const a = g[i - w - 1], b = g[i - w], cc = g[i - w + 1], d = g[i - 1], f = g[i + 1], gg = g[i + w - 1], hh = g[i + w], ii = g[i + w + 1];
    gx[i] = (cc + 2 * f + ii) - (a + 2 * d + gg); gy[i] = (gg + 2 * hh + ii) - (a + 2 * b + cc); mag[i] = Math.hypot(gx[i], gy[i]); }
  const score = (cx, cy, r) => { let n = 0; for (const [co, si] of PER) { const x = Math.round(cx + r * co), y = Math.round(cy + r * si); if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue; const i = y * w + x, m = mag[i]; if (m < 120) continue; if (Math.abs(gx[i] * co + gy[i] * si) / m > 0.8) n++; } return n / PER.length; };
  const ok = cx => Math.min(Math.abs(cx + 330 - ENDS[0]), Math.abs(cx + 330 - ENDS[1])) >= 14;
  let best = null;
  for (let cy = 15; cy <= 37; cy += 2) for (let cx = 12; cx < w - 12; cx += 2) { if (!ok(cx)) continue; for (let r = 12; r <= 22; r += 2) { const sc = score(cx, cy, r); if (!best || sc > best.sc) best = { sc, cx, cy, r }; } }
  if (best) { const b0 = { ...best }; for (let cy = b0.cy - 1; cy <= b0.cy + 1; cy++) for (let cx = b0.cx - 1; cx <= b0.cx + 1; cx++) for (let r = b0.r - 1; r <= b0.r + 1; r++) { if (cy < 15 || cy > 37 || r < 12 || r > 22 || !ok(cx)) continue; const sc = score(cx, cy, r); if (sc > best.sc) best = { sc, cx, cy, r }; } }
  return best;
}
export const MARKER_MIN = 0.5;
export function markerFromBand(c, th) {
  const b = findCircle(c); if (!b || b.sc < MARKER_MIN) return null; const h = hsv(c); let n = 0, fo = 0, fe = 0;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { if (Math.hypot(x - b.cx, y - b.cy) >= b.r + 2) continue; n++; const i = y * c.w + x; if (h.S[i] > 140 && h.V[i] > 120) { if (hueDist(h.H[i], th[0]) < 10) fo++; if (hueDist(h.H[i], th[1]) < 10) fe++; } }
  fo /= n; fe /= n; return { x: b.cx + 330, r: b.r, score: b.sc, owner: fo > 0.15 && fo > fe ? 'own' : fe > 0.15 ? 'enemy' : 'neutral' };
}
function marker(fr, th) { return markerFromBand(crop(fr, 330, 78, 950, 128), th); }
export function towerRow(A, fr, th, t) {
  const band = crop(fr, 330, 122, 950, 190), h = hsv(band); const o = badgeCrop(fr, band, h, th[0]), e = badgeCrop(fr, band, h, th[1]);
  return { t: Math.round(t * 10) / 10, own: o ? readBadge(A, o.c) : null, enemy: e ? readBadge(A, e.c) : null, marker: marker(fr, th) };
}
function smoothRemaining(rows, key, win = 7, need = 3) { const v = rows.map(r => r[key]); const out = []; let cur = 100;
  for (let i = 0; i < v.length; i++) { const w = v.slice(Math.max(0, i - (win >> 1)), i + (win >> 1) + 1).filter(x => x !== null && x >= 0 && x <= 100);
    if (w.length) { const c = new Map(); w.forEach(x => c.set(x, (c.get(x) || 0) + 1)); let bv = null, bc = 0; for (const [x, n] of c) if (n > bc) { bc = n; bv = x; } if (bc >= need && bv < cur) cur = bv; }
    out.push(cur); } return out; }
export function series(rows) {
  const ro = smoothRemaining(rows, 'own'), re = smoothRemaining(rows, 'enemy'); const owners = rows.map(r => r.marker ? r.marker.owner : null);
  return rows.map((r, i) => { const w = owners.slice(Math.max(0, i - 2), i + 3).filter(Boolean); let o = 'neutral';
    if (w.length) { const c = {}; w.forEach(x => c[x] = (c[x] || 0) + 1); o = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; }
    return { t: r.t, count_own: 100 - ro[i], count_enemy: 100 - re[i], diff: re[i] - ro[i], owner: o }; });
}
export function at(S, t) { if (!S.length) return null; let b = S[0]; for (const s of S) if (Math.abs(s.t - t) < Math.abs(b.t - t)) b = s; return b; }
export function phase(s) { if (!s) return null; if (s.owner === 'enemy' || s.diff < 0) return '打開'; if (s.diff > 0 || s.owner === 'own') return '抑え'; return '互角'; }
export function wp(s, t, end, alive) { const tl = Math.max(0, end - t), late = 1 + 2 * (1 - Math.min(tl, 300) / 300);
  const own = s ? ({ own: 1, enemy: -1 }[s.owner] || 0) : 0; const z = 0.05 * late * (s ? s.diff : 0) + 0.35 * (alive[0] - alive[1]) + 0.5 * own; return 1 / (1 + Math.exp(-z)); }
