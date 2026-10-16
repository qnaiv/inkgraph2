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
const cvRound = x => { const r = Math.round(x); return Math.abs(x - r) === 0.5 ? (r & ~1) : r; };
let _w = 0, _h = 0, _g0, _g, _dx, _dy, _mag, _map, _st, _acc, _ex, _ey;
const _bins = new Int32Array(100);
/** OpenCV cv2.HoughCircles(cv2.medianBlur(cv2.cvtColor(band, COLOR_BGR2GRAY), 3), HOUGH_GRADIENT, 1, 30, param1=120, param2=18, minRadius=12, maxRadius=22) */
export function findCircle(c) {
  const w = c.w, h = c.h, n = w * h, mw = w + 2;
  if (w !== _w || h !== _h) {
    _w = w; _h = h; _g0 = new Uint8Array(n); _g = new Uint8Array(n); _dx = new Int16Array(n); _dy = new Int16Array(n);
    _mag = new Int32Array((h + 2) * mw); _map = new Uint8Array(n); _st = new Int32Array(n); _acc = new Int32Array((h + 2) * mw); _ex = new Int32Array(n); _ey = new Int32Array(n);
  }
  const g0 = _g0, g = _g, dx = _dx, dy = _dy, mag = _mag, map = _map, st = _st, accum = _acc, ex = _ex, ey = _ey;
  for (let i = 0; i < n; i++) g0[i] = (c.r[i] * 9798 + c.g[i] * 19235 + c.b[i] * 3735 + 16384) >> 15;
  for (let y = 0; y < h; y++) {
    const y0 = (y > 0 ? y - 1 : 0) * w, y1 = y * w, y2 = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0, x2 = x < w - 1 ? x + 1 : w - 1;
      let p0 = g0[y0 + x0], p1 = g0[y0 + x], p2 = g0[y0 + x2], p3 = g0[y1 + x0], p4 = g0[y1 + x], p5 = g0[y1 + x2], p6 = g0[y2 + x0], p7 = g0[y2 + x], p8 = g0[y2 + x2], t;
      if (p1 > p2) { t = p1; p1 = p2; p2 = t; } if (p4 > p5) { t = p4; p4 = p5; p5 = t; } if (p7 > p8) { t = p7; p7 = p8; p8 = t; }
      if (p0 > p1) { t = p0; p0 = p1; p1 = t; } if (p3 > p4) { t = p3; p3 = p4; p4 = t; } if (p6 > p7) { t = p6; p6 = p7; p7 = t; }
      if (p1 > p2) { t = p1; p1 = p2; p2 = t; } if (p4 > p5) { t = p4; p4 = p5; p5 = t; } if (p7 > p8) { t = p7; p7 = p8; p8 = t; }
      if (p0 > p3) p3 = p0; if (p3 > p6) p6 = p3;
      if (p5 < p2) p2 = p5; if (p8 < p2) p2 = p8;
      if (p1 > p4) { t = p1; p1 = p4; p4 = t; } if (p4 > p7) { t = p4; p4 = p7; p7 = t; } if (p1 > p4) { t = p1; p1 = p4; p4 = t; }
      if (p4 > p2) { t = p4; p4 = p2; p2 = t; } if (p6 > p4) p4 = p6; if (p4 > p2) p4 = p2;
      g[y1 + x] = p4;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = (y > 0 ? y - 1 : 0) * w, y1 = y * w, y2 = (y < h - 1 ? y + 1 : h - 1) * w, mo = (y + 1) * mw + 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0, x2 = x < w - 1 ? x + 1 : w - 1, i = y1 + x;
      const a = g[y0 + x0], b = g[y0 + x], cc = g[y0 + x2], d = g[y1 + x0], f = g[y1 + x2], gg = g[y2 + x0], hh = g[y2 + x], ii = g[y2 + x2];
      const gx = (cc + 2 * f + ii) - (a + 2 * d + gg), gy = (gg + 2 * hh + ii) - (a + 2 * b + cc);
      dx[i] = gx; dy[i] = gy; mag[mo + x] = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
    }
  }
  map.fill(0); let sp = 0;
  for (let y = 0; y < h; y++) {
    const y1 = y * w, mo = (y + 1) * mw + 1;
    for (let x = 0; x < w; x++) {
      const m = mag[mo + x]; if (m <= 60) continue;
      const i = y1 + x, xs = dx[i], ys = dy[i], xa = xs < 0 ? -xs : xs, ya = (ys < 0 ? -ys : ys) << 15, tg22 = xa * 13573;
      let ok = false;
      if (ya < tg22) ok = m > mag[mo + x - 1] && m >= mag[mo + x + 1];
      else {
        const tg67 = tg22 + (xa << 16);
        if (ya > tg67) ok = m > mag[mo + x - mw] && m >= mag[mo + x + mw];
        else { const s = (xs ^ ys) < 0 ? -1 : 1; ok = m > mag[mo + x - mw - s] && m > mag[mo + x + mw + s]; }
      }
      if (ok) { if (m > 120) { map[i] = 2; st[sp++] = i; } else map[i] = 1; }
    }
  }
  while (sp > 0) {
    const i = st[--sp], x = i % w, y = (i - x) / w;
    for (let dy0 = -1; dy0 <= 1; dy0++) {
      const ny = y + dy0; if (ny < 0 || ny >= h) continue;
      for (let dx0 = -1; dx0 <= 1; dx0++) {
        const nx = x + dx0; if (nx < 0 || nx >= w) continue;
        const ni = ny * w + nx; if (map[ni] === 1) { map[ni] = 2; st[sp++] = ni; }
      }
    }
  }
  const astep = mw; accum.fill(0); let nz = 0;
  for (let y = 0; y < h; y++) {
    const y1 = y * w;
    for (let x = 0; x < w; x++) {
      const i = y1 + x; if (map[i] !== 2) continue;
      ex[nz] = x; ey[nz] = y; nz++;
      const vx = dx[i], vy = dy[i]; if (vx === 0 && vy === 0) continue;
      const mg = Math.fround(Math.sqrt(vx * vx + vy * vy));
      let sx = cvRound(Math.fround(vx * 1024 / mg)), sy = cvRound(Math.fround(vy * 1024 / mg));
      const x0 = x << 10, y0 = y << 10;
      for (let k1 = 0; k1 < 2; k1++) {
        let x1 = x0 + 12 * sx, y1 = y0 + 12 * sy;
        for (let r = 12; r <= 22; r++, x1 += sx, y1 += sy) {
          const x2 = x1 >> 10, y2 = y1 >> 10;
          if (x2 < 0 || x2 >= w || y2 < 0 || y2 >= h) break;
          accum[(y2 + 1) * astep + x2 + 1]++;
        }
        sx = -sx; sy = -sy;
      }
    }
  }
  if (!nz) return [];
  const centers = [];
  for (let y = 0; y < h; y++) {
    const yo = (y + 1) * astep;
    for (let x = 0; x < w; x++) {
      const b = yo + x + 1, v = accum[b];
      if (v > 18 && v > accum[b - 1] && v >= accum[b + 1] && v > accum[b - astep] && v >= accum[b + astep]) centers.push(b);
    }
  }
  centers.sort((a, b) => accum[b] - accum[a] || a - b);
  const est = [], bins = _bins;
  for (const b of centers) {
    const cy = Math.floor(b / astep) - 1 + 0.5, cx = (b % astep) - 1 + 0.5;
    bins.fill(0);
    for (let k = 0; k < nz; k++) {
      const vx = cx - ex[k], vy = cy - ey[k], r2 = vx * vx + vy * vy;
      if (r2 >= 144 && r2 <= 484) {
        const d = Math.fround(Math.sqrt(r2));
        let bi = cvRound(Math.fround((d - 12) * 10));
        if (bi < 0) bi = 0; else if (bi > 99) bi = 99;
        bins[bi]++;
      }
    }
    let maxCount = 0, rBest = 0;
    for (let i = 99; i > 0; i--) {
      if (bins[i] > 0) {
        const upbin = i; let curCount = 0;
        for (; i > upbin - 10 && i >= 0; i--) curCount += bins[i];
        const rCur = Math.fround(12 + Math.fround(Math.fround((upbin + i) * 0.5) / 10));
        if (Math.fround(curCount * rBest) >= Math.fround(maxCount * rCur) || (curCount >= maxCount && Math.abs(rBest - rCur) < 1e-5)) { rBest = rCur; maxCount = curCount; }
      }
    }
    if (maxCount > 18) est.push({ cx, cy, r: rBest, acc: maxCount });
  }
  est.sort((a, b) => b.acc - a.acc || b.r - a.r || a.cx - b.cx || a.cy - b.cy);
  const res = [];
  for (const c0 of est) {
    let ok = true;
    for (const r0 of res) if ((c0.cx - r0.cx) * (c0.cx - r0.cx) + (c0.cy - r0.cy) * (c0.cy - r0.cy) < 900) { ok = false; break; }
    if (ok) res.push(c0);
  }
  return res;
}
export const MARKER_MIN = 0.5;
export function markerFromBand(c, th) {
  const cs = findCircle(c); if (!cs || !cs.length) return null;
  for (const b of cs) {
    const X = b.cx + 330;
    if (Math.min(Math.abs(X - ENDS[0]), Math.abs(X - ENDS[1])) < 14 || !(b.cy >= 15 && b.cy <= 37)) continue;
    const h = hsv(c); let n = 0, fo = 0, fe = 0;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { if (Math.hypot(x - b.cx, y - b.cy) >= b.r + 2) continue; n++; const i = y * c.w + x; if (h.S[i] > 140 && h.V[i] > 120) { if (hueDist(h.H[i], th[0]) < 10) fo++; if (hueDist(h.H[i], th[1]) < 10) fe++; } }
    fo /= n; fe /= n; return { x: Math.trunc(b.cx) + 330, r: b.r, score: 1, owner: fo > 0.15 && fo > fe ? 'own' : fe > 0.15 ? 'enemy' : 'neutral' };
  }
  return null;
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
export function series(rows, opts = {}) {
  const { dense = true, win = 3, hold = 3.0 } = opts;
  const grid = rows.filter(r => r.grid === undefined || r.grid);
  const ro = smoothRemaining(grid, 'own'), re = smoothRemaining(grid, 'enemy');
  if (!dense) { const owners = grid.map(r => r.marker ? r.marker.owner : null);
    return grid.map((r, i) => { const w = owners.slice(Math.max(0, i - win), i + win + 1).filter(Boolean); let o = 'neutral';
      if (w.length) { const c = {}; w.forEach(x => c[x] = (c[x] || 0) + 1); o = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; }
      return { t: r.t, count_own: 100 - ro[i], count_enemy: 100 - re[i], diff: re[i] - ro[i], owner: o }; }); }
  const mk = rows.filter(r => r.marker && r.marker.owner); let prev = 'neutral';
  return grid.map((r, i) => { const w = mk.filter(x => Math.abs(x.t - r.t) <= win + 1e-9); let o = null;
    if (w.length) { const c = {}; w.forEach(x => c[x.marker.owner] = (c[x.marker.owner] || 0) + 1); const mx = Math.max(...Object.values(c));
      let best = null, bd = Infinity; for (const x of w) if (c[x.marker.owner] === mx) { const d = Math.abs(x.t - r.t); if (d < bd) { bd = d; best = x; } } o = best.marker.owner; }
    else if (hold > 0) { let last = null; for (const x of mk) if (x.t <= r.t) last = x; else break; if (last && r.t - last.t <= hold) o = prev; }
    if (!o) o = 'neutral'; prev = o;
    return { t: r.t, count_own: 100 - ro[i], count_enemy: 100 - re[i], diff: re[i] - ro[i], owner: o }; });
}
export function at(S, t) { if (!S.length) return null; let b = S[0]; for (const s of S) if (Math.abs(s.t - t) < Math.abs(b.t - t)) b = s; return b; }
export function phase(s) { if (!s) return null; if (s.owner === 'enemy' || s.diff < 0) return '打開'; if (s.diff > 0 || s.owner === 'own') return '抑え'; return '互角'; }
export function wp(s, t, end, alive) { const tl = Math.max(0, end - t), late = 1 + 2 * (1 - Math.min(tl, 300) / 300);
  const own = s ? ({ own: 1, enemy: -1 }[s.owner] || 0) : 0; const z = 0.05 * late * (s ? s.diff : 0) + 0.35 * (alive[0] - alive[1]) + 0.5 * own; return 1 / (1 + Math.exp(-z)); }
