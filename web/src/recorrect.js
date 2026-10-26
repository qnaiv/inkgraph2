// D57: 結果画面の値（K+A・デス・スペシャル）を人が手入力で直したとき、その値に合わせて検出を作り直す。
// 保存してある信号（rec.cues、D54）から検出をやり直し、D52 の補正を手入力の値で、歯止め（件数の上限・確信度の下限）を外して行う。
// 手入力の値は読み違いの心配が無いので、結果画面の読み取りより強く信じる。
import { buildMatch, retag, aliveAt } from './core/analyzer.js';
import { unpackCues } from './core/cues_pack.js';
import { FORCE } from './core/reconcile.js';
import { withParams } from './core/tuning.js';
import { detected, resultOf } from './analysis.js';

const isInt = v => Number.isInteger(v) && v >= 0;
const KINDS = ['death', 'kill', 'special'];
/** 手入力があり、信号が残っている試合だけが対象。理由: 'no-cues'（信号の保存前に解析した試合）／'no-values'（直す値が無い） */
export function recorrectStatus(m) {
  if (!m || !m.cues || !m.cues.n) return { ok: false, reason: 'no-cues' };
  const r = resultOf(m);
  if (![r.ka, r.deaths, r.specials].some(isInt)) return { ok: false, reason: 'no-values' };
  return { ok: true, truth: { ka: isInt(r.ka) ? r.ka : null, deaths: isInt(r.deaths) ? r.deaths : null, specials: isInt(r.specials) ? r.specials : null } };
}
/** 手入力に合わせて直す前の検出に戻す。戻せるものが無ければ false */
export function undoRecorrect(m) {
  const p = m && m.pre_recorrect; if (!p) return false;
  m.own_deaths = p.own_deaths; m.own_kills = p.own_kills; m.special = p.special; m.recon = p.recon; m.squid_down = { ...(m.squid_down || {}), L0: m.own_deaths };
  delete m.pre_recorrect; if (m.tower_series && m.tower_series.length) retag(m); return true;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/**
 * m（保存済みの試合）を in place で直す。params は検出のしきい値（自動調整の値。省略時は現在値）。
 * 戻り値: { ok, applied, before:{death,kill,special}, after:{...}, truth } ／ 直せないとき { ok:false, reason }
 * 確認画面の ✓/✗ と「見逃し追加」は尊重する：✗（誤検出）にした検出は件数に数えず、追加した分は目標から引く。
 */
export function recorrect(m, params) {
  const st = recorrectStatus(m); if (!st.ok) return st;
  const F = unpackCues(m.cues), srcH = (m.source && m.source.height) || 1080, th = m.team_hue || [0, 0];
  const base = { a: m.battle[0], b: m.battle[1], F, th, kscan: [] };
  const eff = () => { const e = { death: 0, kill: 0, special: 0 }; for (const x of detected(m)) if (x.mark !== 'wrong' && x.mark !== 'deleted') e[x.kind]++; for (const a of (m.review && m.review.added) || []) if (e[a.kind] !== undefined) e[a.kind]++; return e; };
  const before = eff();
  return withParams(params || undefined, () => {
    // 1 回目：補正なしの検出で、✗にした検出がいくつ残っているかを数える（それらは件数に数えないので、目標に足す）
    const plain = buildMatch(base, m.match, srcH, {});
    const probe = { ...plain, review: m.review || { marks: {}, added: [] } };
    const excl = { death: 0, kill: 0, special: 0 }, added = { death: 0, kill: 0, special: 0 };
    for (const x of detected(probe)) if (x.mark === 'wrong' || x.mark === 'deleted') excl[x.kind]++;
    for (const a of (m.review && m.review.added) || []) if (added[a.kind] !== undefined) added[a.kind]++;
    const tgt = (v, k) => (v === null ? null : Math.max(0, v - added[k] + excl[k]));
    const own = { ka: tgt(st.truth.ka, 'kill'), deaths: tgt(st.truth.deaths, 'death'), specials: tgt(st.truth.specials, 'special') };
    // 2 回目：手入力の値を目標に、歯止めを外して補正
    const next = buildMatch(base, m.match, srcH, { own, frames: 1e6, lim: FORCE });
    if (!m.pre_recorrect) m.pre_recorrect = JSON.parse(JSON.stringify({ own_deaths: m.own_deaths || [], own_kills: m.own_kills || [], special: m.special || [], recon: m.recon || null })); // 最初の 1 回だけ、元の検出を取っておく（もとに戻す用）
    // 変わらない検出は元のもの（局面・倒した相手・味方の人数などを持つ）を残し、新しく出た検出だけ入れ替える
    const keepOld = (olds, news, tol, kf) => news.map(n => olds.find(o => near(o[kf], n[kf], tol)) || n);
    const deaths = keepOld(m.own_deaths || [], next.own_deaths, 0.25, 'start'), kills = keepOld(m.own_kills || [], next.own_kills, 0.25, 'start'), sp = keepOld(m.special || [], next.special, 0.25, 'ready');
    m.own_deaths = deaths; m.own_kills = kills; m.special = sp;
    m.squid_down = { ...(m.squid_down || {}), L0: deaths };
    for (const e of deaths) if (!e.alive_before || e.auto) { const [a, b] = aliveAt(m, e.start - 0.5); e.alive_before = `${a}v${b}`; }
    for (const e of sp) if (!e.alive_at_ready || e.auto) { const [a, b] = aliveAt(m, e.ready); e.alive_at_ready = `${a}v${b}`; }
    for (const e of kills) if (!e.alive_before) { const [a, b] = aliveAt(m, e.start - 1.0); e.alive_before = `${a}v${b}`; }
    m.recon = { manual: true, at: new Date().toISOString(), truth: st.truth, applied: (next.recon && next.recon.applied) || [], summary: (next.recon && next.recon.summary) || {} };
    if (m.tower_series && m.tower_series.length) retag(m);
    return { ok: true, applied: m.recon.applied, before, after: eff(), truth: st.truth };
  });
}
