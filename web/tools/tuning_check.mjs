// tuning_check.mjs: Node-only check for D54 (cues の保存・復元と、結果画面の数に合わせたパラメータの自動調整).
import { buildMatch } from '../src/core/analyzer.js';
import { packCues, unpackCues } from '../src/core/cues_pack.js';
import { toItem, tuneDetect, getParams, setParams, evalItems } from '../src/core/tuning.js';

let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };

// 合成の試合：デス 2 回（やられた信号 0.42＝既定 0.5 に届かない）、満タン 1 回（gw 0.17＝既定 0.2 に届かない）と 20〜30 秒の通常の満タン、
// 本物のキル通知 2 回（0.85）と、キルではない通知 1 回（0.65＝既定 0.6 を超えてしまう）
const mkF = seed => {
  const F = [], on = (t, a, b) => t >= a && t < b;
  for (let t = 0; t <= 120 + 1e-6; t = +(t + 0.2).toFixed(1)) {
    const d = on(t, 30 + seed, 34 + seed) || on(t, 70, 74), ks = on(t, 10, 12) || on(t, 90, 92) ? 0.85 : on(t, 50 + seed, 52 + seed) ? 0.65 : 0;
    F.push({ t, ok: true, map: false, sig: false, sy: d ? 0.42 : 0, ks, ksc: [ks, 0, 0, 0, 0, 0], kill: false, killSlots: [false], gw: on(t, 20, 25) ? 0.9 : on(t, 100, 103) ? 0.17 : 0, go: 0, p: null, s: null, ally: null });
  }
  return F;
};
const mkMatch = i => { const F = mkF(i % 5); return { id: 'm' + i, F, cues: packCues(F), battle: [0, 120], team_hue: [0, 0], source: { height: 1080 }, own: { ka: 2, deaths: 2, specials: 2 } }; };

console.log('--- cues の保存・復元 ---');
{
  const m = mkMatch(0), a = buildMatch({ a: 0, b: 120, F: m.F, th: [0, 0], kscan: [] }, 1, 1080, {}), b = buildMatch({ a: 0, b: 120, F: unpackCues(m.cues), th: [0, 0], kscan: [] }, 1, 1080, {});
  const sum = r => JSON.stringify([r.own_deaths.map(e => [e.start, e.end]), r.special.map(e => [e.ready, e.end, e.outcome]), r.own_kills.map(e => [e.start, e.end])]);
  check(sum(a) === sum(b), '(1) 保存・復元しても検出が変わらない', sum(b));
  const bytes = JSON.stringify(m.cues).length; check(bytes < 20000, '(2) 2 分の試合で保存サイズ 20KB 未満', `${bytes} bytes`);
}

console.log('--- 自動調整 ---');
const items = [...Array(10)].map((_, i) => { const m = mkMatch(i); return toItem({ id: m.id, cues: m.cues, battle: m.battle, team_hue: m.team_hue, source: m.source }, m.own); });
const base = getParams();
{
  const e0 = evalItems(items, base);
  check(e0.err > 0, '(3) 既定値では件数がずれる', `err=${e0.err}`);
  const r = await tuneDetect(items);
  check(r.ok && r.train.after < r.train.before && r.holdout.after <= r.holdout.before, '(4) 調整で誤差が減り、取り置きの試合でも悪化しない', JSON.stringify({ train: r.train, holdout: r.holdout, changes: r.changes.map(c => `${c.key}:${c.from}->${c.to}`) }));
  const e1 = evalItems(items, r.params);
  check(e1.err === 0, '(5) 調整後は全試合で件数が一致', `err=${e1.err}`);
  check(JSON.stringify(getParams()) === JSON.stringify(base), '(6) 調整の途中経過が P / FUSE に残らない（探索後は元の値）');
}
{
  const few = await tuneDetect(items.slice(0, 3));
  check(!few.ok && few.reason === 'few', '(7) 試合が足りなければ調整しない', JSON.stringify(few));
  const good = items.map(it => ({ ...it, own: { ka: 2, deaths: 2, specials: 2 } }));
  setParams({ sig_th: 0.4, ready_th: 0.15, kill_th: 0.7 });
  const r = await tuneDetect(good);
  check(!r.ok && r.reason === 'nochange', '(8) すでに最良なら変更しない', r.reason);
  setParams(base);
}
{
  // 結果画面の数が壊れている（全試合でデス 9）なら、holdout・gain の条件で無理に動かさない
  const bad = items.map(it => ({ ...it, own: { ka: 2, deaths: 9, specials: 2 } }));
  const r = await tuneDetect(bad);
  check(!r.ok && r.reason === 'few', '(9) 結果画面との差が大きすぎる試合（読み違いの疑い）は調整に使わない', `${r.reason} dropped=${r.dropped}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
