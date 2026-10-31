// ガチホコバトルの「のこり」カウント。トラックの下に、しずく形のバッジ（チーム色。白い数字）が 2 つ出る。数字の見本は、エリアと同じもの（area_digits.js）を使う。
import { crop, hsv, hueDist, components, morphOpen3, resizeArea } from './img.js';
import { classify } from './area_count.js';
// 1280x720 座標。バッジはトラックの下（y≈118〜185）、x は 330〜950 の間を動く
export const HOKO_BAND = [330, 110, 950, 200];
/** しずく形（チーム色の塊）を探し、その中の白い数字（1〜3 桁）を読む。読めなければ null。塊が複数あれば、数字らしい塊のうち一番大きいもの */
export function readBadge(band, hue) {
  const h = hsv(band), m = new Uint8Array(band.w * band.h);
  for (let i = 0; i < m.length; i++) m[i] = hueDist(h.H[i], hue) < 10 && h.S[i] > 150 && h.V[i] > 130 ? 1 : 0;
  const { comps } = components(morphOpen3(m, band.w, band.h), band.w, band.h);
  for (const b of comps.filter(c => c.w >= 28 && c.w <= 70 && c.h >= 30 && c.h <= 85 && c.a > 600).sort((a, c) => c.a - a.a)) {
    // 数字は、しずくの下の 65%（上の尖った部分と「のこり」の文字を除く）にある白い塊。高さ約 21px、上端がそろう
    const y0 = b.y + Math.floor(b.h * 0.35), w = b.w, hh = b.h - Math.floor(b.h * 0.35), dm = new Uint8Array(w * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const s = (y0 + y) * band.w + b.x + x; dm[y * w + x] = h.V[s] > 200 && h.S[s] < 90 ? 1 : 0; }
    const cs = components(dm, w, hh).comps.filter(c => c.a >= 30 && c.h >= 17 && c.h <= 25 && c.w <= 16).sort((a, c) => a.x - c.x);
    if (cs.length < 1 || cs.length > 3 || cs.some(c => Math.abs(c.y - cs[0].y) > 3)) continue;
    const txt = cs.map(s => { const g = new Float32Array(s.w * s.h); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) g[y * s.w + x] = dm[(s.y + y) * w + s.x + x] * 255;
      const f = resizeArea(g, s.w, s.h, 8, 12), o = new Float32Array(97); for (let i = 0; i < 96; i++) o[i] = f[i] / 255; o[96] = s.w / s.h; return classify(o).y; }).join('');
    const v = parseInt(txt); return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  }
  return null;
}
/** th = [自チームの色相, 敵チームの色相]（試合の最初に決まる） */
export function hokoRow(fr, t, th) {
  const band = crop(fr, ...HOKO_BAND);
  return { t: Math.round(t * 10) / 10, own: readBadge(band, th[0]), enemy: readBadge(band, th[1]), marker: null };
}
/**
 * のこりは減る一方（その時までの最短）。読み違い（地図を開いたときの塗りなど）は短く散発するので、
 * 「減る一方」に最も多く合う読みの並び（最長の非増加列。誤差 1 まで許す）だけを採り、その他は捨てる。
 * 採った読みの時刻から、次の読みまで同じ値を保つ。最初の読みまでは 100。ルールが分かる試合の最後にまとめて作る（先の読みも使う）。
 */
export function hokoSeries(rows) {
  const grid = rows.filter(r => r.grid === undefined || r.grid);
  const chain = key => { const pts = grid.map((r, i) => [i, r[key]]).filter(p => p[1] !== null && p[1] >= 0 && p[1] <= 100), n = pts.length, best = new Int32Array(n), prev = new Int32Array(n).fill(-1);
    for (let j = 0; j < n; j++) { best[j] = 1; for (let i = 0; i < j; i++) if (pts[j][1] <= pts[i][1] + 1 && best[i] + 1 > best[j]) { best[j] = best[i] + 1; prev[j] = i; } }
    let e = 0; for (let j = 1; j < n; j++) if (best[j] >= best[e]) e = j; const pick = new Map(); for (let j = n ? e : -1; j >= 0; j = prev[j]) pick.set(pts[j][0], pts[j][1]);
    let cur = 100; return grid.map((_, i) => { if (pick.has(i) && pick.get(i) < cur) cur = pick.get(i); return cur; }); };
  const ro = chain('own'), re = chain('enemy');
  return grid.map((r, i) => ({ t: r.t, count_own: 100 - ro[i], count_enemy: 100 - re[i], diff: re[i] - ro[i], owner: 'neutral' }));
}
