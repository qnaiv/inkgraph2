// D54: 検出パラメータの自動調整（純粋関数）。結果画面の数（デス数・スペシャル回数・K+A）を正解にして、
// 保存済みの試合の信号（cues）から検出をやり直し、件数の誤差が減るしきい値を探す。手動ラベルは要らない。
import { buildMatch, P } from './analyzer.js';
import { FUSE } from './fusion.js';
import { unpackCues } from './cues_pack.js';

/** 調整するパラメータ。target は P か FUSE、grid は試す値（先頭に既定値を含める） */
export const TUNABLE = [
  { key: 'sig_th', target: 'P', grid: [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7], label: 'やられた信号のしきい値' },
  { key: 'accept', target: 'FUSE', grid: [0.6, 0.7, 0.75, 0.85, 0.95, 1.1], label: '合議で自動採用するしきい値（1.1 は採用しない）' },
  { key: 'ready_th', target: 'P', grid: [0.15, 0.2, 0.25, 0.3, 0.35], label: 'スペシャル満タンのしきい値' },
  { key: 'sp_gap', target: 'P', grid: [2.0, 2.5, 3.0, 4.0, 5.0], label: 'スペシャル区間をつなぐ隙間（秒）' },
  { key: 'sp_min', target: 'P', grid: [0.2, 0.3, 0.4, 0.6], label: 'スペシャル満タンの最短（秒）' },
  { key: 'kill_th', target: 'P', grid: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8], label: 'キル通知のしきい値' },
];
const obj = t => (t === 'P' ? P : FUSE);

export const getParams = () => Object.fromEntries(TUNABLE.map(d => [d.key, obj(d.target)[d.key]]));
export function setParams(params) { for (const d of TUNABLE) if (params && typeof params[d.key] === 'number') obj(d.target)[d.key] = params[d.key]; }
/** 一時的に params を当てて fn を実行し、元に戻す */
export function withParams(params, fn) { const keep = getParams(); setParams(params); try { return fn(); } finally { setParams(keep); } }

/** 結果画面の数が全部読めた試合だけを、調整の対象にする。m は保存済みの試合。own は review の修正を反映した値 */
export function toItem(m, own) {
  if (!m || !m.cues || !m.cues.n || !own || !Number.isInteger(own.deaths) || !Number.isInteger(own.specials) || !Number.isInteger(own.ka)) return null;
  return { id: m.id, cues: m.cues, srcH: (m.source && m.source.height) || 1080, battle: m.battle, th: m.team_hue || [0, 0], own };
}
const cache = new Map();
const framesOf = it => { let F = cache.get(it.id); if (!F) { if (cache.size >= 80) cache.clear(); F = unpackCues(it.cues); cache.set(it.id, F); } return F; };

/** 1 試合の検出（補正なしの素の検出）と結果画面の差 */
export function evalItem(it) {
  const F = framesOf(it), rec = buildMatch({ a: it.battle[0], b: it.battle[1], F, th: it.th, kscan: [] }, 1, it.srcH, {});
  const d = rec.own_deaths.length, s = rec.special.filter(e => e.outcome === 'activated').length, k = rec.own_kills.length;
  const ed = Math.abs(d - it.own.deaths), es = Math.abs(s - it.own.specials), ek = Math.max(0, k - it.own.ka);
  return { id: it.id, deaths: d, specials: s, kills: k, err: ed + es + ek, ed, es, ek };
}
export function evalItems(items, params) {
  return withParams(params || getParams(), () => { const per = items.map(it => evalItem(it)); return { err: per.reduce((a, r) => a + r.err, 0), per }; });
}
const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * 座標降下で探す。items のうち holdoutEvery 番目ごとを評価用に取り置き、残りで探す。
 * 採用の条件：学習側の誤差が minGain 件以上減り、評価側の誤差が増えていないこと。
 * onProgress(i, total) で進み具合を返す（UI を固めないよう試合ごとに待ちを入れる）。
 */
export async function tuneDetect(items, opts = {}) {
  const { holdoutEvery = 4, minItems = 6, minGain = 2, passes = 2, onProgress } = opts, base = opts.base || getParams();
  if (items.length < minItems) return { ok: false, reason: 'few', need: minItems, have: items.length };
  // 検出と結果画面の差が大きすぎる試合は、結果画面の読み違い（数字 0/1/6/9 など）の可能性が高いので調整に使わない
  const sane = items.filter(it => evalItems([it], base).err <= (opts.maxItemErr ?? 6));
  if (sane.length < minItems) return { ok: false, reason: 'few', need: minItems, have: sane.length, dropped: items.length - sane.length };
  items = sane;
  const train = items.filter((_, i) => i % holdoutEvery !== holdoutEvery - 1), hold = items.filter((_, i) => i % holdoutEvery === holdoutEvery - 1);
  let cur = { ...base }, done = 0; const total = passes * TUNABLE.reduce((a, d) => a + d.grid.length, 0) * train.length;
  const score = async (params, set) => { let err = 0; for (const it of set) { err += withParams(params, () => evalItem(it)).err; done++; if (onProgress && done % 5 === 0) { onProgress(done, total); await tick(); } } return err; };
  let curErr = await score(cur, train); const baseTrain = curErr;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const d of TUNABLE) {
      let best = { v: cur[d.key], err: curErr };
      for (const v of d.grid) { if (v === cur[d.key]) continue; const e = await score({ ...cur, [d.key]: v }, train); if (e < best.err - 1e-9) best = { v, err: e }; }
      if (best.v !== cur[d.key]) { cur[d.key] = best.v; curErr = best.err; moved = true; }
    }
    if (!moved) break;
  }
  const baseHold = await score(base, hold), candHold = await score(cur, hold); cache.clear();
  const changes = TUNABLE.filter(d => cur[d.key] !== base[d.key]).map(d => ({ key: d.key, label: d.label, from: base[d.key], to: cur[d.key] }));
  const gain = baseTrain - curErr;
  const ok = changes.length > 0 && gain >= minGain && candHold <= baseHold;
  return { ok, reason: ok ? null : (!changes.length ? 'nochange' : gain < minGain ? 'smallgain' : 'holdout'), params: cur, base, changes,
    train: { n: train.length, before: baseTrain, after: curErr }, holdout: { n: hold.length, before: baseHold, after: candHold } };
}
