// Result-screen reading (port of src/inkgraph/result.py)
import { crop, gray, bin, hsv, nccBin, nccGray, resizeArea, components } from './img.js';
import { nn } from './assets.js';
import { boardIconGray, encodeIcon } from './board_icons.js';
const loc = (fr, x0, y0, x1, y1, t, th) => { const c = crop(fr, x0, y0, x1, y1); return nccBin(bin(gray(c), th), c.w, c.h, t); };
export function celebration(A, fr) {
  const w = loc(fr, 0, 0, 260, 130, A.tpl.tpl_res_cel_win, 200).score, l = loc(fr, 0, 0, 260, 130, A.tpl.tpl_res_cel_lose, 200).score;
  if (Math.max(w, l) < 0.6) return null; return w > l ? 'WIN' : 'LOSE';
}
export function panelOffset(A, fr) {
  const rb = loc(fr, 450, 0, 800, 110, A.tpl.tpl_res_lobby, 170);
  if (A.tpl.tpl_res_lobby_x) {
    const rx = loc(fr, 450, 0, 800, 110, A.tpl.tpl_res_lobby_x, 170);
    if (rx.score > rb.score) return [rx.score, rx.x + 450 - 550, rx.y - 25, 'x'];
  }
  return [rb.score, rb.x + 450 - 550, rb.y - 25, 'bankara'];
}
function bannerScore(A, fr, dx, dy) {
  const sc = (n, x, y) => { const c = crop(fr, x + dx - 15, y + dy - 15, x + dx + 125, y + dy + 45); const t = A.gray[n]; return nccGray(hsv(c).V, c.w, c.h, t.data, t.w, t.h); };
  return Math.min(sc('tpl_res_board_win', 625, 215), sc('tpl_res_board_lose', 625, 455));
}
export function classify(A, fr) {
  const c = celebration(A, fr); if (c) return { kind: 'celebration', value: c, off: [0, 0] };
  const [s, dx, dy, panel] = panelOffset(A, fr); if (s < 0.6) return null;
  return { kind: bannerScore(A, fr, dx, dy) > 0.5 ? 'board' : 'personal', value: null, off: [dx, dy], panel };
}
const MODE_BOX = [552, 50, 650, 84], STAGE_BOX = [655, 52, 800, 84];
export const MATCH_TYPE_BOX = [546, 26, 706, 50];
export const MATCH_TYPE_BY_LABEL = {
  'バンカラ・オープン': 'bankara_open',
  'バンカラ・チャレンジ': 'bankara_challenge',
  'Xマッチ': 'x',
  'レギュラーマッチ': 'other',
  'フェスマッチ': 'other'
};
export const MODE_MARGIN = 0.1;
// ステージ名の開始位置オフセット（実測：ホコはルール名が長いため+38px右にずれる。ガチエリア/ガチアサリ等は未計測のため今回追加しない）
export const STAGE_DX_BY_MODE = { 'ガチホコバトル': 38 };
function normText(c) { const b = bin(gray(c), 170); for (let i = 0; i < b.length; i++) b[i] *= 255; return resizeArea(b, c.w, c.h, 120, 32); }
function pearson(a, b) { let ma = 0, mb = 0; const n = a.length; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; } return s / (Math.sqrt(sa * sb) + 1e-6); }
function best(c, lib) { const v = normText(c); let bk = null, bs = -1; for (const [k, t] of Object.entries(lib)) { const s = pearson(v, t); if (s > bs) { bs = s; bk = k; } } return [bk, bs]; }
function bestMode(c, lib) {
  if (!lib || !Object.keys(lib).length) return [null, 0.0, null];
  const v = normText(c);
  const classScores = new Map();
  for (const [k, t] of Object.entries(lib)) {
    const cls = k.split('__')[0];
    const s = pearson(v, t);
    const cur = classScores.get(cls);
    if (cur === undefined || s > cur) {
      classScores.set(cls, s);
    }
  }
  if (!classScores.size) return [null, 0.0, null];
  const sorted = [...classScores.entries()].sort((a, b) => b[1] - a[1]);
  const [bestRule, bestScore] = sorted[0];
  const margin = sorted.length > 1 ? bestScore - sorted[1][1] : null;
  return [bestRule, bestScore, margin];
}
export const DEFAULT_HEADER_THR = { mode: 0.5, stage: 0.5 };
export function readHeader(A, fr, dx, dy, thr = DEFAULT_HEADER_THR, panel = null) {
  const bx = b => crop(fr, b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy);
  const mc = bx(MODE_BOX);
  const [bestRule, ms, margin] = bestMode(mc, A.lib.mode);
  const mThr = (thr && typeof thr.mode === 'number') ? thr.mode : 0.5;
  const sThr = (thr && typeof thr.stage === 'number') ? thr.stage : 0.5;
  const mode = (ms > mThr && (margin === null || margin >= MODE_MARGIN)) ? bestRule : null;

  const stageDx = STAGE_DX_BY_MODE[mode] || 0;
  const stageBox = [STAGE_BOX[0] + stageDx, STAGE_BOX[1], STAGE_BOX[2] + stageDx, STAGE_BOX[3]];
  const sc = bx(stageBox);
  const [sk, ss] = best(sc, A.lib.stage);
  const strip = k => k ? k.split('__')[0] : null;

  let match_type = null, match_type_score = 0;
  if (A.lib?.match_type && Object.keys(A.lib.match_type).length > 0) {
    const mtc = bx(MATCH_TYPE_BOX);
    const [mtk, mts] = best(mtc, A.lib.match_type);
    match_type_score = mts;
    if (mts > 0.85) { // labels share a long prefix (e.g. バンカラマッチ), so only near-identical matches count; otherwise stay null (safe side)
      const raw = strip(mtk);
      match_type = (raw && MATCH_TYPE_BY_LABEL[raw]) ? MATCH_TYPE_BY_LABEL[raw] : null;
    }
  }
  if (panel === 'x') {
    match_type = 'x';
  }
  return {
    mode,
    mode_score: ms,
    mode_margin: margin !== null ? Math.round(margin * 100) / 100 : null,
    stage: ss > sThr ? strip(sk) : null,
    stage_score: ss,
    match_type,
    match_type_score
  };
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
    out.push({ group: grp, idx: i, own: c / h.H.length > 0.08, ka: v[0], deaths: v[1], specials: v[2], icon: encodeIcon(boardIconGray(fr, dx, dy, grp, i)) }); });
  return out; }
// ---- voting over collected result frames (streaming version of read_results) ----
function pick(lst, k = 5) { if (!lst.length) return []; const rs = [[0]]; for (let i = 1; i < lst.length; i++) { if (lst[i].t - lst[i - 1].t <= 0.6) rs[rs.length - 1].push(i); else rs.push([i]); }
  const r = rs.reduce((a, b) => b.length > a.length ? b : a); let mid = r.slice(Math.floor(r.length / 4), Math.floor(r.length * 3 / 4) + 1); if (!mid.length) mid = r;
  const st = Math.max(1, Math.floor(mid.length / k)); return mid.filter((_, i) => i % st === 0).slice(0, k).map(i => lst[i]); }
function vote(vals) { vals = vals.filter(v => v !== null && v !== undefined); if (!vals.length) return null; const c = new Map(); for (const v of vals) { const k = JSON.stringify(v); c.set(k, (c.get(k) || 0) + 1); }
  let bk = null, bc = -1; for (const [k, n] of [...c.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) if (n > bc) { bc = n; bk = k; } return JSON.parse(bk); }
/** S: {celebration:[{t,value}], personal:[{t,header,personal}], board:[{t,header,board}]} -> result_screen */
export function finalizeResult(S) {
  const celResult = vote((S.celebration || []).map(x => x.value));
  let resultSource = null;
  const res = { result: celResult, mode: null, stage: null, match_type: null, own: null };
  if (celResult) resultSource = 'celebration';
  const hs = [...pick(S.board || []), ...pick(S.personal || [])].map(x => x.header);
  res.mode = vote(hs.map(h => h.mode)); res.stage = vote(hs.map(h => h.stage));
  res.match_type = vote(hs.map(h => h.match_type));
  res.confidence = { mode: Math.max(0, ...hs.map(h => h.mode_score)), stage: Math.max(0, ...hs.map(h => h.stage_score)), match_type: hs.length ? Math.max(0, ...hs.map(h => h.match_type_score ?? 0)) : 0 };
  const pers = pick(S.personal || []).map(x => x.personal).filter(Boolean);
  if (pers.length) res.own = Object.fromEntries(['ka', 'deaths', 'specials'].map(k => [k, vote(pers.map(p => p[k]))]));
  const bs = pick(S.board || []);
  if (bs.length) { const B = bs[0].board.map((r, i) => ({ ...r, ...Object.fromEntries(['ka', 'deaths', 'specials'].map(k => [k, vote(bs.map(b => b.board[i][k]))])) }));
    const own = B.find(b => b.own); res.board = B;
    if (own) {
      if (!res.own) res.own = { ka: own.ka, deaths: own.deaths, specials: own.specials };
      if (!res.result) {
        res.result = own.group === 'top' ? 'WIN' : 'LOSE';
        if (res.result) resultSource = 'board';
      }
    }
  }
  res.result_source = resultSource;
  return res;
}

/**
 * Power status vocabulary (5 types):
 * - 'acquired': Power value read successfully (reserved for future X-match reading)
 * - 'not_applicable': Mode does not track power (bankara, regular, fest)
 * - 'not_shown': Mode tracks power but not visible on this screen (e.g. X-match before reading)
 * - 'read_failed': Power expected but reading failed (reserved for future)
 * - 'unknown_type': Match type is null or unrecognized
 * Note: Never read ink points (p) as power.
 */
export function powerForMatchType(matchType) {
  if (matchType === 'x') {
    return { value: null, status: 'not_shown', confidence: 0 };
  }
  if (matchType === 'bankara_open' || matchType === 'bankara_challenge' || matchType === 'other') {
    return { value: null, status: 'not_applicable', confidence: 0 };
  }
  return { value: null, status: 'unknown_type', confidence: 0 };
}

export const SERIES_BOX = { win: [[564,385],[636,385],[712,385]], lose: [[567,455],[620,455],[667,455]], winR: 24, loseR: 16, dark: [350,170,920,550] };

export function readSeriesBox(fr) {
  const [dx0, dy0, dx1, dy1] = SERIES_BOX.dark;
  const darkCrop = crop(fr, dx0, dy0, dx1, dy1);
  let darkCount = 0;
  let totalDark = 0;
  for (let y = 0; y < darkCrop.h; y += 4) {
    for (let x = 0; x < darkCrop.w; x += 4) {
      const idx = y * darkCrop.w + x;
      if (Math.max(darkCrop.r[idx], darkCrop.g[idx], darkCrop.b[idx]) < 45) {
        darkCount++;
      }
      totalDark++;
    }
  }
  if (!totalDark || (darkCount / totalDark) < 0.85) return null;

  const winYellow = [];
  for (let i = 0; i < 3; i++) {
    const [cx, cy] = SERIES_BOX.win[i];
    const c = crop(fr, cx - SERIES_BOX.winR, cy - SERIES_BOX.winR, cx + SERIES_BOX.winR, cy + SERIES_BOX.winR);
    const h = hsv(c);
    let yellowCount = 0;
    const n = h.H.length;
    for (let k = 0; k < n; k++) {
      if (h.H[k] >= 21 && h.H[k] <= 38 && h.S[k] > 120 && h.V[k] > 150) {
        yellowCount++;
      }
    }
    winYellow.push(n > 0 ? yellowCount / n : 0);
  }

  const loseOrange = [];
  const loseGray = [];
  for (let j = 0; j < 3; j++) {
    const [cx, cy] = SERIES_BOX.lose[j];
    const c = crop(fr, cx - SERIES_BOX.loseR, cy - SERIES_BOX.loseR, cx + SERIES_BOX.loseR, cy + SERIES_BOX.loseR);
    const h = hsv(c);
    let orangeCount = 0;
    let grayCount = 0;
    const n = h.H.length;
    for (let k = 0; k < n; k++) {
      const H = h.H[k], S = h.S[k], V = h.V[k];
      if (H >= 2 && H <= 18 && S > 150 && V > 150) orangeCount++;
      if (S < 60 && V > 50 && V < 200) grayCount++;
    }
    loseOrange.push(n > 0 ? orangeCount / n : 0);
    loseGray.push(n > 0 ? grayCount / n : 0);
  }

  const winStates = [];
  for (let i = 0; i < 3; i++) {
    const y = winYellow[i];
    if (y >= 0.4) winStates.push('win');
    else if (y <= 0.15) winStates.push('empty');
    else return null;
  }

  const loseStates = [];
  for (let j = 0; j < 3; j++) {
    const o = loseOrange[j], g = loseGray[j];
    if (o >= 0.4 && g < 0.2) loseStates.push('remain');
    else if (g >= 0.4 && o < 0.2) loseStates.push('lose');
    else return null;
  }

  let win = 0;
  if (winStates[0] === 'empty' && winStates[1] === 'empty' && winStates[2] === 'empty') win = 0;
  else if (winStates[0] === 'win' && winStates[1] === 'empty' && winStates[2] === 'empty') win = 1;
  else if (winStates[0] === 'win' && winStates[1] === 'win' && winStates[2] === 'empty') win = 2;
  else if (winStates[0] === 'win' && winStates[1] === 'win' && winStates[2] === 'win') win = 3;
  else return null;

  let lose = 0;
  if (loseStates[0] === 'remain' && loseStates[1] === 'remain' && loseStates[2] === 'remain') lose = 0;
  else if (loseStates[0] === 'remain' && loseStates[1] === 'remain' && loseStates[2] === 'lose') lose = 1;
  else if (loseStates[0] === 'remain' && loseStates[1] === 'lose' && loseStates[2] === 'lose') lose = 2;
  else if (loseStates[0] === 'lose' && loseStates[1] === 'lose' && loseStates[2] === 'lose') lose = 3;
  else return null;

  const r2 = v => Math.round(v * 100) / 100;
  return {
    win,
    lose,
    yellow: winYellow.map(r2),
    orange: loseOrange.map(r2),
    gray: loseGray.map(r2)
  };
}

export function finalizeSeries(reads) {
  if (!reads || !reads.length) return null;
  const groups = [[reads[0]]];
  for (let i = 1; i < reads.length; i++) {
    if (reads[i].t - reads[i - 1].t <= 0.6) {
      groups[groups.length - 1].push(reads[i]);
    } else {
      groups.push([reads[i]]);
    }
  }
  const lastGroup = groups[groups.length - 1];

  const runs = [];
  for (const r of lastGroup) {
    if (runs.length && runs[runs.length - 1].win === r.win && runs[runs.length - 1].lose === r.lose) {
      runs[runs.length - 1].count++;
    } else {
      runs.push({ win: r.win, lose: r.lose, count: 1 });
    }
  }
  const stable = runs.filter(r => r.count >= 3).map(r => ({ win: r.win, lose: r.lose }));
  if (!stable.length) return null;

  // 計測の箱は「前の状態 → 今回の結果」と動く。前の状態が3フレーム以上
  // 安定して映らなかった（今回の結果だけ読めた）場合、before は不明（null）とし、
  // 一瞬だけのフレームから推測しない（D53）。
  const after = stable[stable.length - 1];
  const before = stable.length >= 2 ? stable[0] : null;

  if (before) {
    const diff = (after.win + after.lose) - (before.win + before.lose);
    if ((diff !== 0 && diff !== 1) || after.win < before.win || after.lose < before.lose) {
      return {
        state: 'unknown',
        win: null,
        lose: null,
        before: { win: before.win, lose: before.lose },
        after: { win: after.win, lose: after.lose },
        frames: reads.length
      };
    }
  }

  const state = (after.win >= 3 || after.lose >= 3) ? 'finished' : 'in_progress';
  return {
    state,
    win: after.win,
    lose: after.lose,
    before: before ? { win: before.win, lose: before.lose } : null,
    frames: reads.length
  };
}

/**
 * 計測終了の画面が映った録画が届くまでの差し込み口。
 * 録画待ち・推測で画面を作らない（D53）
 */
export function readXPower(A, fr) {
  return null;
}

export function finalizeXPower(reads) {
  if (!reads || !reads.length) return null;
  const counts = new Map();
  for (const r of reads) {
    if (r && r.value !== null && r.value !== undefined) {
      counts.set(r.value, (counts.get(r.value) || 0) + 1);
    }
  }
  if (!counts.size) return null;
  let bestVal = null;
  let maxCount = -1;
  for (const [val, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestVal = val;
    }
  }
  const matching = reads.filter(r => r && r.value === bestVal);
  const maxConf = Math.max(...matching.map(r => r.confidence ?? 0));
  if (maxConf < 0.9) return null;
  return { value: bestVal, confidence: maxConf };
}

/**
 * Compute power record for a match according to series progression (D53 Strategy B).
 *
 * State transitions:
 * - Non-X matches (matchType !== 'x') -> delegated to powerForMatchType(matchType)
 * - X match:
 *   - series is null or state === 'unknown' -> { value: null, status: 'not_shown', confidence: 0, reason: 'series_unknown' }
 *   - series.state === 'in_progress' -> { value: null, status: 'not_shown', confidence: 0, reason: 'series_in_progress' }
 *   - series.state === 'finished':
 *     - xp with numeric value and confidence -> { value: xp.value, status: 'acquired', confidence: xp.confidence, reason: 'series_finished' }
 *     - otherwise (no xp or non-numeric value) -> { value: null, status: 'read_failed', confidence: 0, reason: 'series_finished' }
 *
 * Note: Never read ink points (p) as power.
 */
export function powerForSeries(matchType, series, xp) {
  if (matchType !== 'x') {
    return powerForMatchType(matchType);
  }
  if (!series || series.state === 'unknown') {
    return { value: null, status: 'not_shown', confidence: 0, reason: 'series_unknown' };
  }
  if (series.state === 'in_progress') {
    return { value: null, status: 'not_shown', confidence: 0, reason: 'series_in_progress' };
  }
  if (series.state === 'finished') {
    if (xp && typeof xp.value === 'number' && !Number.isNaN(xp.value)) {
      return { value: xp.value, status: 'acquired', confidence: xp.confidence ?? 0, reason: 'series_finished' };
    }
    return { value: null, status: 'read_failed', confidence: 0, reason: 'series_finished' };
  }
  return { value: null, status: 'not_shown', confidence: 0, reason: 'series_unknown' };
}
