// やられた相手のブキ名（デスカメの吹き出し「<ブキ名> で / やられた!」）の読み取り（D47）
// 吹き出しは倒した相手の画面位置に追従して動くので、固定文言「やられた!」を探してから、その直上の 1 行を切り出す。
// 名前は文字認識せず、行の白文字を 16x128 に縮めた形を、目視で名前を付けた見本（assets.killer.lib）と照合する。
import { crop, hsv, nccBin, resizeArea } from './img.js';
export const KP = { from: 1.0, to: 8.0, step: 0.5, yar_th: 0.65, match_th: 0.75, ar_tol: 0.18, fh: 16, fw: 128 };
const SX0 = 80, SY0 = 60, SX1 = 1200, SY1 = 640;
export function whiteBin(c) { const h = hsv(c), n = c.w * c.h, o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = h.V[i] > 190 && h.S[i] < 70 ? 1 : 0; return o; }
/** 「やられた!」の位置 {score,x,y,w,h}（1280x720 座標） */
export function findYarareta(A, fr) {
  const t = A.killer && A.killer.tpl; if (!t) return { score: 0, x: 0, y: 0 };
  const c = crop(fr, SX0, SY0, SX1, SY1), b = whiteBin(c), r = nccBin(b, c.w, c.h, t, 0.6);
  return { score: r.score, x: r.x + SX0, y: r.y + SY0, w: t.w, h: t.h };
}
/** 「やられた!」の直上の行（ブキ名＋「で」）を白文字の 2 値で切り出し、詰めた矩形を返す。無ければ null */
export function nameLine(fr, loc) {
  const cx = Math.round(loc.x + loc.w / 2), y0 = loc.y - 48, y1 = loc.y - 2, x0 = cx - 240, x1 = cx + 240;
  if (y0 < 0) return null; const c = crop(fr, x0, y0, x1, y1), b = whiteBin(c), W = c.w, H = c.h;
  const col = new Int32Array(W); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) col[x] += b[y * W + x];
  const on = x => col[x] >= 2; const segs = []; let x = 0;
  while (x < W) { if (on(x)) { let e = x; while (e < W && on(e)) e++; segs.push([x, e]); x = e; } else x++; }
  if (!segs.length) return null;
  const mid = cx - x0; let k = 0, bd = Infinity; segs.forEach((s, i) => { const d = s[1] <= mid ? mid - s[1] : s[0] >= mid ? s[0] - mid : 0; if (d < bd) { bd = d; k = i; } });
  if (bd > 40) return null; let a = k, z = k; const GAP = 16;
  while (a > 0 && segs[a][0] - segs[a - 1][1] <= GAP) a--; while (z < segs.length - 1 && segs[z + 1][0] - segs[z][1] <= GAP) z++;
  const lx = segs[a][0], rx = segs[z][1]; let ty = -1, by = -1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x2 = lx; x2 < rx; x2++) s += b[y * W + x2]; if (s >= 2) { if (ty < 0) ty = y; by = y + 1; } }
  if (ty < 0 || by - ty < 10 || rx - lx < 20) return null;
  const w = rx - lx, h = by - ty, o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x2 = 0; x2 < w; x2++) o[y * w + x2] = b[(ty + y) * W + lx + x2];
  return { w, h, bits: o, ar: w / h };
}
export function lineFeat(L) { const f = resizeArea(L.bits, L.w, L.h, KP.fw, KP.fh); let m = 0; for (const v of f) m += v; m /= f.length; let s = 0; for (let i = 0; i < f.length; i++) { f[i] -= m; s += f[i] * f[i]; } s = Math.sqrt(s) || 1; for (let i = 0; i < f.length; i++) f[i] /= s; return f; }
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/** 見本と照合 → {name, kind, score}。どれにも十分似ていなければ name=null（未登録） */
export function matchName(A, f, ar) {
  let best = null; for (const e of (A.killer && A.killer.lib) || []) { if (Math.abs(Math.log(ar / e.ar)) > KP.ar_tol) continue; const s = dot(f, e.f); if (!best || s > best.score) best = { name: e.name, kind: e.kind, score: s }; }
  if (!best || best.score < KP.match_th) return { name: null, kind: null, score: best ? +best.score.toFixed(3) : 0 };
  return { name: best.name, kind: best.kind, score: +best.score.toFixed(3) };
}
/** 1 フレームを読む。吹き出しが無ければ null */
export function readKiller(A, fr) {
  const loc = findYarareta(A, fr); if (loc.score < KP.yar_th) return null;
  const L = nameLine(fr, loc); if (!L) return null; const f = lineFeat(L);
  return { ...matchName(A, f, L.ar), yar: +loc.score.toFixed(3), ar: +L.ar.toFixed(3), f };
}
/** 特徴（単位ベクトル）を int8 の base64 に（見本と、見本に無いブキの見た目を保存する用） */
export function encodeFeat(f) { const q = new Int8Array(f.length); for (let i = 0; i < f.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(f[i] * 2048))); let s = ''; const u = new Uint8Array(q.buffer); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
export function decodeFeat(b64) { const bin = atob(b64), q = new Int8Array(bin.length); for (let i = 0; i < bin.length; i++) q[i] = (bin.charCodeAt(i) << 24) >> 24; const f = new Float32Array(q.length); let s = 0; for (let i = 0; i < q.length; i++) { f[i] = q[i]; s += f[i] * f[i]; } s = Math.sqrt(s) || 1; for (let i = 0; i < f.length; i++) f[i] /= s; return f; }
export const featSim = (a, b) => dot(a, b);
/** 1 回のデスで読めた全フレームから 1 つに決める。見本と合ったものがあれば最も似たもの、無ければ一番はっきり読めたフレームの見た目を「未登録」として残す */
export function decideKiller(reads) {
  if (!reads || !reads.length) return null;
  let best = null; for (const r of reads) if (r.name && (!best || r.score > best.score)) best = r;
  if (best) return { name: best.name, kind: best.kind || null, score: best.score, frames: reads.length };
  const c = reads.reduce((a, b) => (b.yar > a.yar ? b : a));
  return { name: null, kind: null, score: c.score, ar: c.ar, sig: encodeFeat(c.f), frames: reads.length };
}
/** assets の killer ブロック（tpl は 2 値画像、lib は見本）を照合用に展開 */
export function prepKiller(j, b64bytes) {
  if (!j) return null;
  return { tpl: { w: j.tpl.w, h: j.tpl.h, bits: b64bytes(j.tpl.data) }, lib: (j.lib || []).map(e => ({ name: e.name, kind: e.kind, ar: e.ar, f: decodeFeat(e.f) })) };
}
// 吹き出しにはメインブキのほか、スペシャルやサブの名前も出る（相手のメインブキは分からない）ので種類を分ける
export const SPECIAL_NAMES = ['ウルトラショット', 'グレートバリア', 'ショクワンダー', 'マルチミサイル', 'アメフラシ', 'ナイスダマ', 'ホップソナー', 'キューインキ', 'メガホンレーザー5.1ch', 'ジェットパック', 'ウルトラハンコ', 'カニタンク', 'サメライド', 'トリプルトルネード', 'エナジースタンド', 'デコイチラシ', 'テイオウイカ', 'ウルトラチャクチ', 'スミナガシート'];
export const SUB_NAMES = ['スプラッシュボム', 'キューバンボム', 'クイックボム', 'スプリンクラー', 'スプラッシュシールド', 'タンサンボム', 'カーリングボム', 'ロボットボム', 'ジャンプビーコン', 'ポイントセンサー', 'トラップ', 'ポイズンミスト', 'ラインマーカー', 'トーピード'];
export const killerKind = name => (!name ? null : SPECIAL_NAMES.includes(name) ? 'special' : SUB_NAMES.includes(name) ? 'sub' : 'main');
