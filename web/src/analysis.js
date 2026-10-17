// Corrections-aware views of a match + accuracy + trend aggregation
import { aliveAt } from './core/analyzer.js';
import * as T from './core/tower.js';
export const KINDS = { death: 'デス', kill: 'キル', special: 'スペシャル発動' };
export const SP_LABEL = { activated: '発動', lost_on_death: '未使用のままデス', unused_at_end: '未使用のまま終了' };
export const key = (kind, t) => `${kind}@${(+t).toFixed(1)}`;
export function series(m) { return (m.tower_series || []).map(s => ({ t: s.t, count_own: s.own, count_enemy: s.enemy, diff: s.own - s.enemy, owner: s.owner })); }
export function wpAt(m, S, t) { return T.wp(S.length ? T.at(S, t) : null, t, m.battle[1], aliveAt(m, t)); }
function ctx(m, S, kind, t) { const s = S.length ? T.at(S, t - 0.5) : null; const o = { phase: T.phase(s), count: s ? `${s.count_own}-${s.count_enemy}` : null, count_diff: s ? s.diff : null };
  if (kind !== 'special') { const b = wpAt(m, S, t - 1), a = wpAt(m, S, t + 1.5); o.wp_before = b; o.wp_after = a; o.wp_delta = a - b; } return o; }
/** pure interval view of m.special: [{ready, end, outcome, activated_at}] */
export function specialIntervals(m) {
  return (m.special || []).map(e => ({
    ready: e.ready,
    end: e.end,
    outcome: e.outcome,
    activated_at: e.activated_at ?? (e.outcome === 'activated' ? e.end : null)
  }));
}
/** aggregated special statistics for a match */
export function specialStats(m) {
  const intervals = specialIntervals(m);
  const readyCount = intervals.length;
  const readySeconds = +(intervals.reduce((s, e) => s + Math.max(0, e.end - e.ready), 0)).toFixed(1);
  const lost = intervals.filter(e => e.outcome === 'lost_on_death').length;
  const unusedEnd = intervals.filter(e => e.outcome === 'unused_at_end').length;
  const wastedRate = readyCount > 0 ? lost / readyCount : null;
  const activated = effective(m).filter(e => e.kind === 'special').length;
  return { activated, readyCount, readySeconds, lost, unusedEnd, wastedRate };
}
/** detected events with review status */
export function detected(m) { const r = m.review || { marks: {} }; const out = [];
  for (const e of (m.own_deaths || [])) out.push({ kind: 'death', t: e.start, end: e.end, src: e, key: key('death', e.start) });
  for (const e of (m.own_kills || [])) out.push({ kind: 'kill', t: e.start, end: e.end, src: e, key: key('kill', e.start) });
  for (const e of (m.special || [])) {
    if (e.outcome === 'activated') {
      const actT = e.activated_at ?? e.end;
      out.push({ kind: 'special', t: actT, ready: e.ready, end: e.end, activated_at: actT, outcome: e.outcome, src: e, key: key('special', e.ready) });
    }
  }
  out.forEach(e => { e.key = e.key || key(e.kind, e.t); e.mark = r.marks[e.key] || null; }); return out.sort((a, b) => a.t - b.t); }
/** effective (corrected) events: detected minus ✗/deleted plus added; with phase & win-prob context */
export function effective(m) { const S = series(m), r = m.review || { added: [] };
  const ev = detected(m).filter(e => e.mark !== 'wrong' && e.mark !== 'deleted').concat((r.added || []).map(a => ({ kind: a.kind, t: a.t, end: a.t + (a.kind === 'death' ? 5 : 0.5), outcome: a.outcome || (a.kind === 'special' ? 'activated' : undefined), added: true, key: key('add-' + a.kind, a.t) })));
  ev.forEach(e => Object.assign(e, ctx(m, S, e.kind, e.t))); return ev.sort((a, b) => a.t - b.t); }
export const RESULT_STATUS_LABEL = { read: '読み取り済み', partial: '一部未取得', missing: '未取得（試合中データのみ）' };
export function resultStatus(m) {
  const rs = m ? m.result_screen : null;
  const cf = m ? m.confidence : null;
  const res = rs ? rs.result : null;
  const hasResult = res === 'WIN' || res === 'LOSE';
  const hasMode = rs && rs.mode != null;
  const hasStage = rs && rs.stage != null;
  const own = rs ? rs.own : null;
  const hasAnyOwn = own != null && (own.ka != null || own.deaths != null || own.specials != null);
  const hasAllOwn = own != null && own.ka != null && own.deaths != null && own.specials != null;
  const hasFrames = cf != null && (((cf.celebration_frames || 0) > 0) || ((cf.personal_frames || 0) > 0) || ((cf.board_frames || 0) > 0));

  if (!hasResult && !hasMode && !hasStage && !hasAnyOwn && !hasFrames) {
    return { key: 'missing', label: RESULT_STATUS_LABEL.missing };
  }
  if (hasResult && hasMode && hasStage && hasAllOwn) {
    return { key: 'read', label: RESULT_STATUS_LABEL.read };
  }
  return { key: 'partial', label: RESULT_STATUS_LABEL.partial };
}
export function resultSourceLabel(m) {
  if (m && m.review && m.review.fix && m.review.fix.result != null) return '手動訂正';
  const src = m && m.result_screen ? m.result_screen.result_source : null;
  if (src === 'celebration') return '演出';
  if (src === 'board') return '対戦表';
  if (src === 'fix') return '手動訂正';
  return '不明';
}
export const RESULT_FRAME_STEP = 0.08;
export function frameStepForState(state, base = 0.2) {
  return state === 'result' ? RESULT_FRAME_STEP : base;
}
export function resultOf(m) { const rs = (m && m.result_screen) || {}, f = ((m && m.review) || {}).fix || {}; const own = rs.own || {};
  return { result: f.result ?? rs.result, mode: f.mode ?? rs.mode, stage: f.stage ?? rs.stage, ka: f.ka ?? own.ka, deaths: f.deaths ?? own.deaths, specials: f.specials ?? own.specials, count: f.count ?? finalCount(m), result_source: resultSourceLabel(m) }; }
export function finalCount(m) { const s = m.tower_series; if (!s || !s.length) return null; const l = s[s.length - 1]; return `${l.own}-${l.enemy}`; }
export const RESULT_FIELDS = { result: '勝敗', mode: 'ルール', stage: 'ステージ', deaths: 'デス数', specials: 'スペシャル数', count: '最終カウント' };
/** accuracy from review marks. per kind: tp=✓, fp=✗, fn=added. result fields: rmarks ok/wrong */
export function accuracy(ms) { const A = {}; for (const k of Object.keys(KINDS)) A[k] = { tp: 0, fp: 0, fn: 0, unreviewed: 0 };
  const RF = {}; for (const k of Object.keys(RESULT_FIELDS)) RF[k] = { ok: 0, wrong: 0 };
  for (const m of ms) { const r = m.review || { marks: {}, added: [] };
    for (const e of detected(m)) { if (e.mark === 'ok') A[e.kind].tp++; else if (e.mark === 'wrong') A[e.kind].fp++; else if (!e.mark) A[e.kind].unreviewed++; }
    for (const a of r.added || []) A[a.kind].fn++;
    for (const [k, v] of Object.entries(r.rmarks || {})) if (RF[k]) RF[k][v === 'ok' ? 'ok' : 'wrong']++; }
  for (const a of Object.values(A)) { a.precision = a.tp + a.fp ? a.tp / (a.tp + a.fp) : null; a.recall = a.tp + a.fn ? a.tp / (a.tp + a.fn) : null; }
  return { events: A, result: RF }; }
export function countBucket(d) { if (d === null || d === undefined) return 'カウント不明'; if (d <= -30) return '30以上負け'; if (d <= -10) return '10〜29負け'; if (d < 0) return '1〜9負け'; if (d === 0) return '同点'; if (d < 10) return '1〜9勝ち'; if (d < 30) return '10〜29勝ち'; return '30以上勝ち'; }
export const BUCKETS = ['30以上負け', '10〜29負け', '1〜9負け', '同点', '1〜9勝ち', '10〜29勝ち', '30以上勝ち', 'カウント不明'];
export const mss = t => { t = Math.max(0, Math.round(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const pct = v => v === null || v === undefined || isNaN(v) ? '—' : `${Math.round(v * 100)}%`;

// ---------------------------------------------------------------------------
// ヤグラ保持の人手ラベル（D20: review.tower_holder / review.count_series）
// 検出の保持区間（同じ保持者が続く区間）を単位に、確認済みの値を review.tower_seg
// （キー＝区間開始秒 toFixed(1)）に保存し、そこから D20 形式の review.tower_holder を再生成する。
// 方針: tower_holder には「確認済みの区間だけ」を書き出す（ポップオーバーで値を設定した区間）。
// 未確認の区間は書かない（隙間になり、eval_labels.py は区間に覆われない秒を採点しない）。
// 隣り合う確認済み区間が同じ値なら結合する。1区間も確認していなければ tower_holder は書かない
// （評価側は未ラベル扱い）。
// ---------------------------------------------------------------------------
export const HOLDER_JA = { own: '味方', enemy: '敵', neutral: '中立' };
const holderOf = o => (o === 'own' || o === 'enemy') ? o : 'neutral';
const r1 = x => Math.round(x * 10) / 10;
/** detected holder runs over the battle, with review overlay: {key,ta,tb,det,val,confirmed,changed} */
export function holderSegments(m) {
  const S = series(m); if (!S.length) return [];
  const t0 = m.battle[0], t1 = m.battle[1], lab = (m.review && m.review.tower_seg) || {}; const runs = [];
  for (let i = 0; i < S.length; i++) {
    const o = holderOf(S[i].owner), ta = i === 0 ? t0 : (S[i - 1].t + S[i].t) / 2, tb = i === S.length - 1 ? t1 : (S[i].t + S[i + 1].t) / 2;
    if (runs.length && runs[runs.length - 1].det === o) runs[runs.length - 1].tb = tb; else runs.push({ ta, tb, det: o });
  }
  return runs.filter(r => r.tb > r.ta).map(r => { const key = r.ta.toFixed(1), v = lab[key];
    return { ...r, key, val: v || r.det, confirmed: !!v, changed: !!v && v !== r.det }; });
}
/** rebuild review.tower_holder ([start,end,value] sorted, adjacent same values merged) from per-segment labels */
export function syncTowerHolder(m) {
  const r = m.review; const segs = holderSegments(m);
  if (!r || !segs.some(s => s.confirmed)) { if (r) delete r.tower_holder; return; }
  const out = [];
  for (const s of segs) {
    if (!s.confirmed) continue;
    const a = r1(s.ta), b = r1(s.tb), l = out[out.length - 1];
    if (l && l[2] === s.val && Math.abs(l[1] - a) < 0.05) l[1] = b;
    else out.push([a, b, s.val]);
  }
  r.tower_holder = out;
}
export function setHolderLabel(m, key, val) {
  m.review = m.review || {};
  m.review.tower_seg = m.review.tower_seg || {};
  m.review.tower_seg[key] = val;
  syncTowerHolder(m);
}
/** remove the confirmation of one segment (back to unconfirmed) and rebuild tower_holder */
export function clearHolderLabel(m, key) {
  if (m.review && m.review.tower_seg) {
    delete m.review.tower_seg[key];
    if (!Object.keys(m.review.tower_seg).length) delete m.review.tower_seg;
  }
  syncTowerHolder(m);
}
export function addCountPoint(m, sec, own, enemy) {
  const cs = (m.review.count_series = m.review.count_series || []); sec = r1(sec);
  const i = cs.findIndex(c => Math.abs(c[0] - sec) < 0.05); if (i >= 0) cs[i] = [sec, own, enemy]; else cs.push([sec, own, enemy]);
  cs.sort((a, b) => a[0] - b[0]);
}
export function removeCountPoint(m, sec) {
  const cs = m.review.count_series || []; const i = cs.findIndex(c => c[0] === sec); if (i >= 0) cs.splice(i, 1);
  if (!cs.length) delete m.review.count_series;
}
