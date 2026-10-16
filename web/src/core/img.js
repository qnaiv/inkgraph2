// Low-level image ops on RGBA frames (1280x720) mirroring the OpenCV calls used in the Python prototype.
export const W = 1280, H = 720;
/** crop RGBA frame -> {w,h,r,g,b} planes (Uint8Array) */
export function crop(fr, x0, y0, x1, y1) {
  if (fr.w !== W) return cropScaled(fr, x0, y0, x1, y1);
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(fr.w, x1); y1 = Math.min(fr.h, y1);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), n = w * h;
  const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n), d = fr.data;
  for (let y = 0; y < h; y++) { let s = ((y0 + y) * fr.w + x0) * 4, o = y * w;
    for (let x = 0; x < w; x++, s += 4, o++) { r[o] = d[s]; g[o] = d[s + 1]; b[o] = d[s + 2]; } }
  return { w, h, r, g, b };
}
export function sub(c, x0, y0, x1, y1) { // crop of a crop
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(c.w, x1); y1 = Math.min(c.h, y1);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0); const o = { w, h, r: new Uint8Array(w * h), g: new Uint8Array(w * h), b: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y0 + y) * c.w + x0 + x, t = y * w + x; o.r[t] = c.r[s]; o.g[t] = c.g[s]; o.b[t] = c.b[s]; }
  return o;
}
export function gray(c) { const n = c.w * c.h, o = new Uint8Array(n);
  for (let i = 0; i < n; i++) o[i] = (c.r[i] * 4899 + c.g[i] * 9617 + c.b[i] * 1868 + 8192) >> 14; return o; }
export function bin(g, th) { const o = new Uint8Array(g.length); for (let i = 0; i < g.length; i++) o[i] = g[i] > th ? 1 : 0; return o; }
/** OpenCV 8-bit HSV: H 0..179, S,V 0..255 */
export function hsv(c) {
  const n = c.w * c.h, H = new Uint8Array(n), S = new Uint8Array(n), V = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = c.r[i], g = c.g[i], b = c.b[i]; const v = r > g ? (r > b ? r : b) : (g > b ? g : b); const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d = v - mn; V[i] = v; S[i] = v ? Math.round(255 * d / v) : 0;
    let h = 0; if (d) { if (v === r) h = 60 * (g - b) / d; else if (v === g) h = 120 + 60 * (b - r) / d; else h = 240 + 60 * (r - g) / d; if (h < 0) h += 360; }
    let hh = Math.round(h / 2); if (hh >= 180) hh -= 180; H[i] = hh;
  }
  return { w: c.w, h: c.h, H, S, V };
}
export const hueDist = (h, t) => { const d = Math.abs(h - t); return Math.min(d, 180 - d); };
/** INTER_AREA style resize of a single float/uint plane */
export function resizeArea(src, sw, sh, dw, dh) {
  const o = new Float32Array(dw * dh), fx = sw / dw, fy = sh / dh;
  for (let dy = 0; dy < dh; dy++) { const y0 = dy * fy, y1 = y0 + fy;
    for (let dx = 0; dx < dw; dx++) { const x0 = dx * fx, x1 = x0 + fx; let s = 0, a = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1 - 1e-9); y++) { const wy = Math.min(y + 1, y1) - Math.max(y, y0); if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.ceil(x1 - 1e-9); x++) { const wx = Math.min(x + 1, x1) - Math.max(x, x0); if (wx <= 0) continue; s += src[y * sw + x] * wx * wy; a += wx * wy; } }
      o[dy * dw + dx] = s / a; } }
  return o;
}
export function resizeCropArea(c, dw, dh) { // color crop -> resized color crop (uint8, rounded)
  const f = p => Uint8Array.from(resizeArea(p, c.w, c.h, dw, dh), v => Math.round(v));
  return { w: dw, h: dh, r: f(c.r), g: f(c.g), b: f(c.b) };
}
/** TM_CCOEFF_NORMED max for binary region (0/1) vs binary template {w,h,bits}. Returns {score,x,y}.
 * minScore enables pruning of positions whose upper bound is below it. */
export function nccBin(reg, rw, rh, t, minScore = -1) {
  const tw = t.w, th = t.h; if (rw < tw || rh < th) return { score: 0, x: 0, y: 0 };
  if (!t.runs) { // horizontal runs of on pixels
    t.runs = []; t.k = 0;
    for (let y = 0; y < th; y++) { let x = 0; while (x < tw) { if (t.bits[y * tw + x]) { let e = x; while (e < tw && t.bits[y * tw + e]) e++; t.runs.push(y, x, e); t.k += e - x; x = e; } else x++; } }
  }
  const n = tw * th, k = t.k; const tvar = k - k * k / n; if (tvar <= 0) return { score: 0, x: 0, y: 0 };
  const iw = rw + 1, I = new Int32Array(iw * (rh + 1)), P = new Int32Array(iw * rh); // integral, row prefix
  for (let y = 0; y < rh; y++) { let rs = 0; for (let x = 0; x < rw; x++) { rs += reg[y * rw + x]; P[y * iw + x + 1] = rs; I[(y + 1) * iw + x + 1] = I[y * iw + x + 1] + rs; } }
  let best = 0, bx = 0, by = 0; const R = t.runs, NR = R.length; const thr = Math.max(best, minScore);
  for (let y = 0; y + th <= rh; y++) for (let x = 0; x + tw <= rw; x++) {
    const S = I[(y + th) * iw + x + tw] - I[y * iw + x + tw] - I[(y + th) * iw + x] + I[y * iw + x];
    const rvar = S - S * S / n; if (rvar <= 0) continue; const den = Math.sqrt(rvar * tvar);
    const ub = (Math.min(k, S) - S * k / n) / den; if (ub <= best || ub < thr) continue;
    let on = 0; for (let i = 0; i < NR; i += 3) { const row = (y + R[i]) * iw + x; on += P[row + R[i + 2]] - P[row + R[i + 1]]; }
    const sc = (on - S * k / n) / den; if (sc > best) { best = sc; bx = x; by = y; }
  }
  return { score: best, x: bx, y: by };
}
/** dense TM_CCOEFF_NORMED for gray planes, returns max */
export function nccGray(reg, rw, rh, t, tw, th) {
  if (rw < tw || rh < th) return 0; const n = tw * th; let tm = 0; for (let i = 0; i < n; i++) tm += t[i]; tm /= n;
  let tv = 0; const tc = new Float32Array(n); for (let i = 0; i < n; i++) { tc[i] = t[i] - tm; tv += tc[i] * tc[i]; }
  let best = -1;
  for (let y = 0; y + th <= rh; y++) for (let x = 0; x + tw <= rw; x++) { let s = 0, s2 = 0, sp = 0;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) { const v = reg[(y + j) * rw + x + i]; s += v; s2 += v * v; sp += v * tc[j * tw + i]; }
    const rv = s2 - s * s / n; if (rv <= 0) continue; const sc = sp / Math.sqrt(rv * tv); if (sc > best) best = sc; }
  return best;
}
/** connected components (8-conn) on 0/1 mask -> [{x,y,w,h,a}] */
export function components(m, w, h) {
  const lab = new Int32Array(w * h), out = [], st = []; let L = 0;
  for (let i = 0; i < w * h; i++) { if (!m[i] || lab[i]) continue; L++; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, a = 0; st.push(i); lab[i] = L;
    while (st.length) { const p = st.pop(), px = p % w, py = (p - px) / w; a++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; const q = qy * w + qx; if (m[q] && !lab[q]) { lab[q] = L; st.push(q); } } }
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, a, label: L }); }
  return { comps: out, lab };
}
export function morphOpen3(m, w, h) {
  const er = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1; for (let dy = -1; dy <= 1 && v; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; if (!m[qy * w + qx]) { v = 0; break; } } er[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; if (er[qy * w + qx]) { v = 1; break; } } o[y * w + x] = v; }
  return o;
}
export function median(a) { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
/** scipy.ndimage.median_filter 1D on 0/1 array, mode reflect */
export function medfilt(a, size) { const n = a.length, r = size >> 1, o = new Array(n);
  const at = i => { if (i < 0) i = -i - 1; if (i >= n) i = 2 * n - i - 1; return a[Math.max(0, Math.min(n - 1, i))]; };
  for (let i = 0; i < n; i++) { const w = []; for (let j = -r; j <= r; j++) w.push(at(i + j) ? 1 : 0); w.sort(); o[i] = w[r]; } return o; }
export function runs(t, mask, minlen = 0, gap = 0) {
  const r = []; let i = 0; while (i < mask.length) { if (mask[i]) { let j = i; while (j < mask.length && mask[j]) j++; r.push([t[i], t[j - 1]]); i = j; } else i++; }
  const o = []; for (const [a, b] of r) { if (o.length && a - o[o.length - 1][1] <= gap) o[o.length - 1][1] = b; else o.push([a, b]); }
  return o.filter(x => x[1] - x[0] >= minlen);
}
export const r1 = v => Math.round(v * 10) / 10;
export function b64bytes(s) { const bin = atob(s); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }

/** crop from a non-1280 frame with exact INTER_AREA semantics (same as resizing the whole frame to 1280x720 first) */
function cropScaled(fr, x0, y0, x1, y1) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), fx = fr.w / W, fy = fr.h / H, d = fr.data;
  const o = { w, h, r: new Uint8Array(w * h), g: new Uint8Array(w * h), b: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) { const sy0 = (y0 + y) * fy, sy1 = sy0 + fy;
    for (let x = 0; x < w; x++) { const sx0 = (x0 + x) * fx, sx1 = sx0 + fx; let r = 0, g = 0, b = 0, a = 0;
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy1 - 1e-9); yy++) { const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0); if (wy <= 0) continue;
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx1 - 1e-9); xx++) { const wx = Math.min(xx + 1, sx1) - Math.max(xx, sx0); if (wx <= 0) continue; const k = wx * wy, p = (yy * fr.w + xx) * 4; r += d[p] * k; g += d[p + 1] * k; b += d[p + 2] * k; a += k; } }
      const t = y * w + x; o.r[t] = Math.round(r / a); o.g[t] = Math.round(g / a); o.b[t] = Math.round(b / a); } }
  return o;
}
