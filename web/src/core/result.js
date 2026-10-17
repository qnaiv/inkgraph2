// Result-screen reading (port of src/inkgraph/result.py)
import { crop, gray, bin, hsv, nccBin, nccGray, resizeArea, components } from './img.js';
import { nn } from './assets.js';
const loc = (fr, x0, y0, x1, y1, t, th) => { const c = crop(fr, x0, y0, x1, y1); return nccBin(bin(gray(c), th), c.w, c.h, t); };
export function celebration(A, fr) {
  const w = loc(fr, 0, 0, 260, 130, A.tpl.tpl_res_cel_win, 200).score, l = loc(fr, 0, 0, 260, 130, A.tpl.tpl_res_cel_lose, 200).score;
  if (Math.max(w, l) < 0.6) return null; return w > l ? 'WIN' : 'LOSE';
}
export function panelOffset(A, fr) { const r = loc(fr, 450, 0, 800, 110, A.tpl.tpl_res_lobby, 170); return [r.score, r.x + 450 - 550, r.y - 25]; }
function bannerScore(A, fr, dx, dy) {
  const sc = (n, x, y) => { const c = crop(fr, x + dx - 15, y + dy - 15, x + dx + 125, y + dy + 45); const t = A.gray[n]; return nccGray(hsv(c).V, c.w, c.h, t.data, t.w, t.h); };
  return Math.min(sc('tpl_res_board_win', 625, 215), sc('tpl_res_board_lose', 625, 455));
}
export function classify(A, fr) {
  const c = celebration(A, fr); if (c) return { kind: 'celebration', value: c, off: [0, 0] };
  const [s, dx, dy] = panelOffset(A, fr); if (s < 0.6) return null;
  return { kind: bannerScore(A, fr, dx, dy) > 0.5 ? 'board' : 'personal', value: null, off: [dx, dy] };
}
const MODE_BOX = [552, 50, 650, 84], STAGE_BOX = [655, 52, 800, 84];
function normText(c) { const b = bin(gray(c), 170); for (let i = 0; i < b.length; i++) b[i] *= 255; return resizeArea(b, c.w, c.h, 120, 32); }
function pearson(a, b) { let ma = 0, mb = 0; const n = a.length; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; } return s / (Math.sqrt(sa * sb) + 1e-6); }
function best(c, lib) { const v = normText(c); let bk = null, bs = -1; for (const [k, t] of Object.entries(lib)) { const s = pearson(v, t); if (s > bs) { bs = s; bk = k; } } return [bk, bs]; }
export const DEFAULT_HEADER_THR = { mode: 0.5, stage: 0.5 };
export function readHeader(A, fr, dx, dy, thr = DEFAULT_HEADER_THR) {
  const bx = b => crop(fr, b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy);
  const mc = bx(MODE_BOX), sc = bx(STAGE_BOX); const [mk, ms] = best(mc, A.lib.mode), [sk, ss] = best(sc, A.lib.stage);
  const strip = k => k ? k.split('__')[0] : null;
  const mThr = (thr && typeof thr.mode === 'number') ? thr.mode : 0.5;
  const sThr = (thr && typeof thr.stage === 'number') ? thr.stage : 0.5;
  return { mode: ms > mThr ? strip(mk) : null, mode_score: ms, stage: ss > sThr ? strip(sk) : null, stage_score: ss };
}
function white(c) { const h = hsv(c), m = new Uint8Array(h.V.length); for (let i = 0; i < m.length; i++) m[i] = h.V[i] > 165 && h.S[i] < 80 ? 1 : 0; return m; }
function statGlyphs(fr, y0, y1, x0, x1) {
  const c = crop(fr, x0, y0, x1, y1), m = white(c), { comps } = components(m, c.w, c.h); const cs = comps.filter(s => s.a >= 5);
  const digs = cs.filter(c => c.h >= 8 && c.h <= 16 && c.w <= 10 && c.y >= 5);
  const xs = cs.filter(c => c.h >= 4 && c.h <= 10 && c.w >= 3 && c.w <= 7 && c.y >= 7 && digs.some(d => Math.abs((c.y + c.h) - (d.y + d.h)) <= 2 && d.h >= c.h + 3 && d.x - c.x > 0 && d.x - c.x <= 12)).sort((a, b) => a.x - b.x || a.y - b.y);
  const groups = [];
  for (const xc of xs) { const g = digs.filter(d => d.x - xc.x > 0 && d.x - xc.x <= 26 && d.h >= xc.h + 3 && Math.abs((xc.y + xc.h) - (d.y + d.h)) <= 2).sort((a, b) => a.x - b.x || a.y - b.y);
    if (g.length && !groups.some(gg => gg.includes(g[0]))) groups.push(g); }
  return groups.map(g => g.map(d => { const b = new Float32Array(d.w * d.h); for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) b[y * d.w + x] = m[(d.y + y) * c.w + d.x + x] * 255; return { b, w: d.w, h: d.h }; }));
}
function dfeat(g) { const f = resizeArea(g.b, g.w, g.h, 8, 12); const o = new Float32Array(97); for (let i = 0; i < 96; i++) o[i] = f[i] / 255; o[96] = g.w / g.h * 2; return o; }
const readNumber = (A, gs) => gs.length ? parseInt(gs.map(g => nn(A.digits, dfeat(g)).y).join('')) : null;
export function readPersonal(A, fr, dx, dy) { const gs = statGlyphs(fr, 178 + dy, 212 + dy, 985 + dx, 1165 + dx); if (gs.length !== 3) return null;
  const v = gs.map(g => readNumber(A, g)); return { ka: v[0], deaths: v[1], specials: v[2] }; }
const ROW_Y = { top: [262, 306, 350, 394], bot: [499, 543, 587, 631] };
export function readBoard(A, fr, dx, dy) { const out = [];
  for (const grp of ['top', 'bot']) ROW_Y[grp].forEach((y0, i) => { const y = y0 + dy; const h = hsv(crop(fr, 612 + dx, y, 650 + dx, y + 34)); let c = 0; for (let j = 0; j < h.H.length; j++) if (h.H[j] > 22 && h.H[j] < 38 && h.S[j] > 150 && h.V[j] > 180) c++;
    const gs = statGlyphs(fr, y + 2, y + 34, 965 + dx, 1160 + dx); const v = gs.length === 3 ? gs.map(g => readNumber(A, g)) : [null, null, null];
    out.push({ group: grp, idx: i, own: c / h.H.length > 0.08, ka: v[0], deaths: v[1], specials: v[2] }); });
  return out; }
// ---- voting over collected result frames (streaming version of read_results) ----
function pick(lst, k = 5) { if (!lst.length) return []; const rs = [[0]]; for (let i = 1; i < lst.length; i++) { if (lst[i].t - lst[i - 1].t <= 0.6) rs[rs.length - 1].push(i); else rs.push([i]); }
  const r = rs.reduce((a, b) => b.length > a.length ? b : a); let mid = r.slice(Math.floor(r.length / 4), Math.floor(r.length * 3 / 4) + 1); if (!mid.length) mid = r;
  const st = Math.max(1, Math.floor(mid.length / k)); return mid.filter((_, i) => i % st === 0).slice(0, k).map(i => lst[i]); }
function vote(vals) { vals = vals.filter(v => v !== null && v !== undefined); if (!vals.length) return null; const c = new Map(); for (const v of vals) { const k = JSON.stringify(v); c.set(k, (c.get(k) || 0) + 1); }
  let bk = null, bc = -1; for (const [k, n] of [...c.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) if (n > bc) { bc = n; bk = k; } return JSON.parse(bk); }
/** S: {celebration:[{t,value}], personal:[{t,header,personal}], board:[{t,header,board}]} -> result_screen */
export function finalizeResult(S) {
  const res = { result: vote(S.celebration.map(x => x.value)), mode: null, stage: null, own: null };
  const hs = [...pick(S.board), ...pick(S.personal)].map(x => x.header);
  res.mode = vote(hs.map(h => h.mode)); res.stage = vote(hs.map(h => h.stage));
  res.confidence = { mode: Math.max(0, ...hs.map(h => h.mode_score)), stage: Math.max(0, ...hs.map(h => h.stage_score)) };
  const pers = pick(S.personal).map(x => x.personal).filter(Boolean);
  if (pers.length) res.own = Object.fromEntries(['ka', 'deaths', 'specials'].map(k => [k, vote(pers.map(p => p[k]))]));
  const bs = pick(S.board);
  if (bs.length) { const B = bs[0].board.map((r, i) => ({ ...r, ...Object.fromEntries(['ka', 'deaths', 'specials'].map(k => [k, vote(bs.map(b => b.board[i][k]))])) }));
    const own = B.find(b => b.own); res.board = B;
    if (own) { if (!res.own) res.own = { ka: own.ka, deaths: own.deaths, specials: own.specials }; if (!res.result) res.result = own.group === 'top' ? 'WIN' : 'LOSE'; } }
  return res;
}
