// Corrections-aware views of a match + accuracy + trend aggregation
import { aliveAt } from './core/analyzer.js';
import * as T from './core/tower.js';
export const KINDS = { death: 'デス', kill: 'キル', special: 'スペシャル' };
export const SP_LABEL = { activated: '発動', lost_on_death: '溜めたままやられた', unused_at_end: '未使用のまま終了' };
export const key = (kind, t) => `${kind}@${(+t).toFixed(1)}`;
export function series(m) { return (m.tower_series || []).map(s => ({ t: s.t, count_own: s.own, count_enemy: s.enemy, diff: s.own - s.enemy, owner: s.owner })); }
export function wpAt(m, S, t) { return T.wp(S.length ? T.at(S, t) : null, t, m.battle[1], aliveAt(m, t)); }
function ctx(m, S, kind, t) { const s = S.length ? T.at(S, t - 0.5) : null; const o = { phase: T.phase(s), count: s ? `${s.count_own}-${s.count_enemy}` : null, count_diff: s ? s.diff : null };
  if (kind !== 'special') { const b = wpAt(m, S, t - 1), a = wpAt(m, S, t + 1.5); o.wp_before = b; o.wp_after = a; o.wp_delta = a - b; } return o; }
/** detected events with review status */
export function detected(m) { const r = m.review || { marks: {} }; const out = [];
  for (const e of m.own_deaths) out.push({ kind: 'death', t: e.start, end: e.end, src: e });
  for (const e of m.own_kills) out.push({ kind: 'kill', t: e.start, end: e.end, src: e });
  for (const e of m.special) out.push({ kind: 'special', t: e.ready, end: e.end, outcome: e.outcome, src: e });
  out.forEach(e => { e.key = key(e.kind, e.t); e.mark = r.marks[e.key] || null; }); return out.sort((a, b) => a.t - b.t); }
/** effective (corrected) events: detected minus ✗/deleted plus added; with phase & win-prob context */
export function effective(m) { const S = series(m), r = m.review || { added: [] };
  const ev = detected(m).filter(e => e.mark !== 'wrong' && e.mark !== 'deleted').concat((r.added || []).map(a => ({ kind: a.kind, t: a.t, end: a.t + (a.kind === 'death' ? 5 : 0.5), outcome: a.outcome || (a.kind === 'special' ? 'activated' : undefined), added: true, key: key('add-' + a.kind, a.t) })));
  ev.forEach(e => Object.assign(e, ctx(m, S, e.kind, e.t))); return ev.sort((a, b) => a.t - b.t); }
export function resultOf(m) { const rs = m.result_screen || {}, f = (m.review || {}).fix || {}; const own = rs.own || {};
  return { result: f.result ?? rs.result, mode: f.mode ?? rs.mode, stage: f.stage ?? rs.stage, ka: f.ka ?? own.ka, deaths: f.deaths ?? own.deaths, specials: f.specials ?? own.specials, count: f.count ?? finalCount(m) }; }
export function finalCount(m) { const s = m.tower_series; if (!s || !s.length) return null; const l = s[s.length - 1]; return `${l.own}-${l.enemy}`; }
export const RESULT_FIELDS = { result: '勝敗', mode: 'ルール', stage: 'ステージ', ka: 'キル+アシスト', deaths: 'デス数', specials: 'スペシャル数', count: '最終カウント' };
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
