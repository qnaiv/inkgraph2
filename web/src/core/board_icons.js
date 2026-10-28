// Board enemy weapon icon reading and matching (720p result screen)
import { b64bytes } from './img.js';

export const BI = { x0: 696, w: 56, h: 34, ix0: 7, ix1: 49, iy0: 2, iy1: 32, match_th: 0.93, group_th: 0.93 };
export const ROW_Y = { top: [262, 306, 350, 394], bot: [499, 543, 587, 631] };
export const AMBIG = [['リッター4K', '4Kスコープ']];

/** 1280x720 RGBA fr から 56x34 の枠を切り出し、グレー Uint8Array を返す */
export function boardIconGray(fr, dx, dy, group, idx) {
  const x0 = BI.x0 + dx, y0 = ROW_Y[group][idx] + dy, w = BI.w, h = BI.h, o = new Uint8Array(w * h), d = fr.data, fw = fr.w, fh = fr.h;
  for (let y = 0; y < h; y++) {
    const fy = y0 + y;
    for (let x = 0; x < w; x++) {
      const fx = x0 + x;
      if (fx >= 0 && fx < fw && fy >= 0 && fy < fh) {
        const p = (fy * fw + fx) * 4;
        o[y * w + x] = Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
      }
    }
  }
  return o;
}

/** D69: ブキの絵が写っているか。ボード以外を切り出した無地・なだらかな色むらには、くっきりした輪郭（内側の横方向で隣との差が 16 以上）がほとんど無い。
 *  実測（ラベル付きの 96 枠）のブキの絵は 5.6% 以上、記録の無地・色むらは 0〜0.5% なので、間の 3% を下限にする */
export const ICON_EDGE_DIFF = 16, ICON_DETAIL_MIN = 0.03;
export function iconDetail(g) {
  const b = typeof g === 'string' ? decodeIcon(g) : g; if (!b || b.length < BI.w * BI.h) return 0;
  let k = 0, n = 0;
  for (let y = BI.iy0; y < BI.iy1; y++) for (let x = BI.ix0; x < BI.ix1 - 1; x++) { if (Math.abs(b[y * BI.w + x + 1] - b[y * BI.w + x]) >= ICON_EDGE_DIFF) k++; n++; }
  return k / n;
}
export const iconHasDetail = g => iconDetail(g) >= ICON_DETAIL_MIN;

export function encodeIcon(g) { let s = ''; for (let i = 0; i < g.length; i++) s += String.fromCharCode(g[i]); return btoa(s); }
export function decodeIcon(s) { return b64bytes(s); }

// LRU cache for preprocessed icons (max ~5000)
const iconCache = new Map();
const MAX_ICON_CACHE = 5000;

/** アイコンの前処理：内側テンプレート（mean 引いた値と分散）、粗い特徴（14x10 L2正規化）、積分画像 */
export function prepIcon(g) {
  if (!g) return null;
  if (g.tc && g.coarse) return g; // already prepped

  const cached = iconCache.get(g);
  if (cached) {
    iconCache.delete(g);
    iconCache.set(g, cached);
    return cached;
  }

  const strKey = typeof g === 'string' ? g : null;
  const bytes = strKey ? decodeIcon(strKey) : g;

  const bw = BI.w, bh = BI.h; // 56, 34
  const tw = BI.ix1 - BI.ix0, th = BI.iy1 - BI.iy0; // 42, 30
  const n = tw * th; // 1260

  // 1. 内側テンプレート
  let tm = 0;
  for (let y = 0; y < th; y++) {
    const r = (BI.iy0 + y) * bw + BI.ix0;
    for (let x = 0; x < tw; x++) tm += bytes[r + x];
  }
  tm /= n;
  let tv = 0;
  const tc = new Float32Array(n);
  for (let y = 0; y < th; y++) {
    const r = (BI.iy0 + y) * bw + BI.ix0;
    for (let x = 0; x < tw; x++) {
      const v = bytes[r + x] - tm;
      tc[y * tw + x] = v;
      tv += v * v;
    }
  }

  // 2. 粗い特徴（内側 42x30 を 3x3 の面積平均で 14x10 にし、平均を引いて L2 正規化）
  const coarse = new Float32Array(140);
  let cmean = 0;
  for (let by = 0; by < 10; by++) {
    for (let bx = 0; bx < 14; bx++) {
      let s = 0;
      for (let dy = 0; dy < 3; dy++) {
        const y = BI.iy0 + by * 3 + dy;
        for (let dx = 0; dx < 3; dx++) {
          s += bytes[y * bw + (BI.ix0 + bx * 3 + dx)];
        }
      }
      const v = s / 9;
      coarse[by * 14 + bx] = v;
      cmean += v;
    }
  }
  cmean /= 140;
  let cnorm = 0;
  for (let i = 0; i < 140; i++) {
    coarse[i] -= cmean;
    cnorm += coarse[i] * coarse[i];
  }
  cnorm = Math.sqrt(cnorm);
  if (cnorm > 0) {
    for (let i = 0; i < 140; i++) coarse[i] /= cnorm;
  }

  // 3. 積分画像（窓の和・二乗和の高速化用）
  const satW = bw + 1, satH = bh + 1; // 57, 35
  const sat = new Int32Array(satW * satH);
  const sat2 = new Float64Array(satW * satH);
  for (let y = 0; y < bh; y++) {
    let rowS = 0, rowS2 = 0;
    const rPrev = y * satW, rCurr = (y + 1) * satW, rBytes = y * bw;
    for (let x = 0; x < bw; x++) {
      const v = bytes[rBytes + x];
      rowS += v;
      rowS2 += v * v;
      sat[rCurr + x + 1] = sat[rPrev + x + 1] + rowS;
      sat2[rCurr + x + 1] = sat2[rPrev + x + 1] + rowS2;
    }
  }

  const res = { g: bytes, tc, tv, coarse, sat, sat2 };
  if (strKey) {
    iconCache.set(strKey, res);
    if (iconCache.size > MAX_ICON_CACHE) iconCache.delete(iconCache.keys().next().value);
  }
  iconCache.set(bytes, res);
  if (iconCache.size > MAX_ICON_CACHE) iconCache.delete(iconCache.keys().next().value);

  return res;
}

/** 旧実装（全探索）：テストでの一致確認用として残す */
export function iconSimSlow(a, b) {
  const gA = a instanceof Uint8Array ? a : (a && a.g ? a.g : decodeIcon(a));
  const gB = b instanceof Uint8Array ? b : (b && b.g ? b.g : decodeIcon(b));
  const tw = BI.ix1 - BI.ix0, th = BI.iy1 - BI.iy0, bw = BI.w, bh = BI.h, n = tw * th;
  let tm = 0;
  for (let y = 0; y < th; y++) { const r = (BI.iy0 + y) * bw + BI.ix0; for (let x = 0; x < tw; x++) tm += gA[r + x]; }
  tm /= n;
  let tv = 0; const tc = new Float32Array(n);
  for (let y = 0; y < th; y++) {
    const r = (BI.iy0 + y) * bw + BI.ix0;
    for (let x = 0; x < tw; x++) { const v = gA[r + x] - tm; tc[y * tw + x] = v; tv += v * v; }
  }
  if (tv <= 0) return 0;
  let best = 0;
  for (let y = 0; y + th <= bh; y++) for (let x = 0; x + tw <= bw; x++) {
    let s = 0, s2 = 0, sp = 0;
    for (let j = 0; j < th; j++) {
      const br = (y + j) * bw + x, tr = j * tw;
      for (let i = 0; i < tw; i++) { const v = gB[br + i]; s += v; s2 += v * v; sp += v * tc[tr + i]; }
    }
    const rv = s2 - s * s / n; if (rv <= 0) continue;
    const sc = sp / Math.sqrt(rv * tv); if (sc > best) best = sc;
  }
  return best;
}

export const iconSimSymSlow = (a, b) => Math.min(iconSimSlow(a, b), iconSimSlow(b, a));

/** 積分画像を用いた全探索 */
function fullSearch(pa, pb) {
  if (pa.tv <= 0) return 0;
  const tw = BI.ix1 - BI.ix0, th = BI.iy1 - BI.iy0, bw = BI.w, bh = BI.h, n = tw * th, satW = bw + 1;
  let best = 0;
  for (let y = 0; y + th <= bh; y++) {
    const y0 = y * satW, y1 = (y + th) * satW;
    for (let x = 0; x + tw <= bw; x++) {
      const x0 = x, x1 = x + tw;
      const s = pb.sat[y1 + x1] - pb.sat[y0 + x1] - pb.sat[y1 + x0] + pb.sat[y0 + x0];
      const s2 = pb.sat2[y1 + x1] - pb.sat2[y0 + x1] - pb.sat2[y1 + x0] + pb.sat2[y0 + x0];
      const rv = s2 - s * s / n;
      if (rv <= 0) continue;
      let sp = 0;
      for (let j = 0; j < th; j++) {
        const br = (y + j) * bw + x, tr = j * tw;
        for (let i = 0; i < tw; i++) {
          sp += pb.g[br + i] * pa.tc[tr + i];
        }
      }
      const sc = sp / Math.sqrt(rv * pa.tv);
      if (sc > best) best = sc;
    }
  }
  return best;
}

/** a の内側 [iy0:iy1, ix0:ix1]（30x42）を template にして b（56x34）の中をスライドした TM_CCOEFF_NORMED 最大値 */
export function iconSim(a, b) {
  const pa = prepIcon(a), pb = prepIcon(b);
  if (!pa || !pb) return 0;
  return fullSearch(pa, pb);
}

/** 粗い特徴どうしの ±1 ずらし（3x3 通り）の相関最大値 */
function coarseCorr(ca, cb) {
  let best = -1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let s = 0;
      for (let y = 0; y < 10; y++) {
        const ny = y + dy; if (ny < 0 || ny >= 10) continue;
        const r1 = y * 14, r2 = ny * 14;
        for (let x = 0; x < 14; x++) {
          const nx = x + dx; if (nx < 0 || nx >= 14) continue;
          s += ca[r1 + x] * cb[r2 + nx];
        }
      }
      if (s > best) best = s;
    }
  }
  return best;
}

/** iconSimSym の高速版：まず粗い特徴どうしで ±1 ずらしの相関 c < 0.6 なら全探索スキップ */
export function iconSimSym(a, b) {
  const pa = prepIcon(a), pb = prepIcon(b);
  if (!pa || !pb) return 0;
  if (pa.tv <= 0 || pb.tv <= 0) return 0;
  // ±1 ずらしによる重複セル数減少（117/140 ≈ 0.835）を補正するため 1.2 倍
  const c = Math.min(1.0, coarseCorr(pa.coarse, pb.coarse) * 1.2);
  if (c < 0.6) return c;
  return Math.min(fullSearch(pa, pb), fullSearch(pb, pa));
}

// matchIcon の結果メモ (WeakMap<lib配列, Map<string, 結果>>)
const matchMemo = new WeakMap();

/** 見本 lib=[{name, g}] と照合。1 種類ならその名前、2 種類以上 or AMBIG を含むなら name:null・ambiguous:[...名前]、無ければ name:null */
export function matchIcon(lib, g) {
  const items = Array.isArray(lib) ? lib : (lib && lib.lib ? lib.lib : null);
  if (!items || !items.length) return { name: null, score: 0, ambiguous: null };

  const strKey = typeof g === 'string' ? g : null;
  if (strKey) {
    let memo = matchMemo.get(items);
    if (!memo) {
      memo = new Map();
      matchMemo.set(items, memo);
    }
    const cached = memo.get(strKey);
    if (cached) return cached;
  }

  const pg = prepIcon(g);
  let maxScore = 0; const hi = new Set();
  for (const item of items) {
    if (!item.prep) item.prep = prepIcon(item.g);
    const s = iconSimSym(item.prep, pg);
    if (s > maxScore) maxScore = s;
    if (s >= BI.match_th) hi.add(item.name);
  }

  let res;
  for (const pair of AMBIG) {
    if (pair.some(n => hi.has(n))) {
      res = { name: null, score: +maxScore.toFixed(3), ambiguous: [...pair] };
      break;
    }
  }
  if (!res) {
    if (hi.size > 1) res = { name: null, score: +maxScore.toFixed(3), ambiguous: [...hi].sort() };
    else if (hi.size === 1) res = { name: [...hi][0], score: +maxScore.toFixed(3), ambiguous: null };
    else res = { name: null, score: +maxScore.toFixed(3), ambiguous: null };
  }

  if (strKey) {
    let memo = matchMemo.get(items);
    if (!memo) {
      memo = new Map();
      matchMemo.set(items, memo);
    }
    memo.set(strKey, res);
  }

  return res;
}

/** assets の enemy_icon（{lib:[{name, g: base64}]}）を展開 */
export function prepEnemyIconLib(j, b64fn = b64bytes) {
  if (!j || !Array.isArray(j.lib)) return { lib: [] };
  return {
    lib: j.lib.map(e => {
      const g = b64fn(e.g);
      return { name: e.name, video: e.video, slot: e.slot, g, prep: prepIcon(g) };
    })
  };
}
