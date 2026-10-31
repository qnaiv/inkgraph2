// ガチエリアの「のこり」カウント（画面上部中央の左右 2 枚のパネル。左=自チーム、右=敵）。ヤグラのバッジ読み（tower.js）と同じ数字の辞書を使う。
import { crop, hsv, components, resizeArea, b64bytes } from './img.js';
import { AREA_DIGITS } from './area_digits.js';
// 1280x720 座標。パネルは左 x≈533-600、右 x≈680-750。「のこり」の文字は上、数字は下の段
export const AREA_PANELS = { own: [528, 100, 606, 142], enemy: [676, 100, 756, 142] };
// パネルが暗い(まだ減っていない側)と、数字は明るい点。色付き(エリアを持っている側)は、彩度の低い点が数字。どちらの塗りか分からないので両方試し、数字らしい塊(縦長で 1〜3 個)になったほうを使う
const RULES = [(V, S) => V > 140, (V, S) => S < 70 && V > 180];
export function digitGlyphs(cr) {
  const h = hsv(cr);
  for (const rule of RULES) {
    const m = new Uint8Array(cr.w * cr.h); for (let i = 0; i < m.length; i++) m[i] = rule(h.V[i], h.S[i]) ? 1 : 0;
    const { comps } = components(m, cr.w, cr.h);
    // 数字は高さが約 26px（パネルの高さの 0.55〜0.76 倍）で、上端が 6〜9px の位置にそろう。パネルの縁や背景の明るい塊は、この条件で除く
    const cs = comps.filter(s => s.h >= cr.h * 0.55 && s.h <= cr.h * 0.76 && s.y >= cr.h * 0.08 && s.y <= cr.h * 0.28 && s.a >= 20).sort((a, b) => a.x - b.x);
    if (cs.length >= 1 && cs.length <= 3 && cs.every(s => s.w <= s.h * 0.9)) return { m, w: cr.w, cs };
  }
  return null;
}
let _dict = null;
const dict = () => _dict || (_dict = AREA_DIGITS.map(([y, ar, b64]) => { const f = Float32Array.from(b64bytes(b64), v => v / 255), x = new Float32Array(97); x.set(f); x[96] = ar; return { y, x }; }));
/** 数字 1 つ（8x12 + 幅/高さ）に一番近い見本の数字 */
export function classify(f) { let by = null, bd = Infinity; for (const { y, x } of dict()) { let d = 0; for (let j = 0; j < 97; j++) { const e = x[j] - f[j]; d += e * e; } if (d < bd) { bd = d; by = y; } } return { y: by, d: bd }; }
function readPanel(cr) {
  const d = digitGlyphs(cr); if (!d) return null;
  const txt = d.cs.map(s => { const g = new Float32Array(s.w * s.h); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) g[y * s.w + x] = d.m[(s.y + y) * d.w + s.x + x] * 255;
    const f = resizeArea(g, s.w, s.h, 8, 12), o = new Float32Array(97); for (let i = 0; i < 96; i++) o[i] = f[i] / 255; o[96] = s.w / s.h; return classify(o).y; }).join('');
  const v = parseInt(txt); return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}
export function areaRow(fr, t) {
  const o = AREA_PANELS.own, e = AREA_PANELS.enemy;
  return { t: Math.round(t * 10) / 10, own: readPanel(crop(fr, ...o)), enemy: readPanel(crop(fr, ...e)), marker: null };
}
/**
 * 毎秒の読み取り → 推移。のこりは減る一方なので、前後 2 秒の読み取りの中央値から 4 以上離れた読み（読み違い）は中央値に置き換え、それが今までの最小値より小さくなったときだけ更新する。
 * ヤグラ用の smoothRemaining は「同じ値が 7 回中 3 回」を求めるが、エリアは毎秒 1 ほど動くので同じ値が続かない。
 * 保持チーム（owner）は読まないので 'neutral'。局面（抑え/打開/互角）は、のこりの差だけで決まる。
 */
export function areaSeries(rows, win = 5) {
  const half = win >> 1, grid = rows.filter(r => r.grid === undefined || r.grid);
  const rem = key => { let cur = 100; return grid.map((_, i) => { const w = grid.slice(Math.max(0, i - half), i + half + 1).map(r => r[key]).filter(v => v !== null && v >= 0 && v <= 100).sort((a, b) => a - b);
    if (w.length >= 2) { const med = w[w.length >> 1], v = grid[i][key], c = v !== null && Math.abs(v - med) <= 4 ? v : med; if (c < cur) cur = c; } return cur; }); };
  const ro = rem('own'), re = rem('enemy');
  return grid.map((r, i) => ({ t: r.t, count_own: 100 - ro[i], count_enemy: 100 - re[i], diff: re[i] - ro[i], owner: 'neutral' }));
}
