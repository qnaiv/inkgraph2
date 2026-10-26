// recorrect_check.mjs: D57 手入力した K+A・デス・スペシャルに合わせた検出の作り直し（Node のみ）
import { buildMatch } from '../src/core/analyzer.js';
import { packCues } from '../src/core/cues_pack.js';
import { recorrect, recorrectStatus, undoRecorrect } from '../src/recorrect.js';
import { effective } from '../src/analysis.js';
let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const on = (t, a, b) => t >= a && t < b;
// 強い信号のデス 2 回（10・60 秒）、弱い信号のデス（100 秒・0.42＝既定では拾えない）、満タン 1 回（20〜30 秒）、弱い満タン（80 秒・gw 0.17）、キル通知 3 回
const mkF = () => { const F = []; for (let t = 0; t <= 140 + 1e-6; t = +(t + 0.2).toFixed(1)) { const strong = on(t, 10, 14) || on(t, 60, 64), weak = on(t, 100, 104), ks = on(t, 30, 32) || on(t, 90, 92) || on(t, 120, 122) ? 0.85 : 0;
  F.push({ t, ok: true, map: false, sig: false, sy: strong ? 0.8 : weak ? 0.42 : 0, ks, ksc: [ks, 0, 0, 0, 0, 0], kill: false, killSlots: [false], gw: on(t, 20, 30) ? 0.9 : on(t, 80, 80.6) ? 0.16 : 0, go: 0, p: null, s: null, ally: null }); } return F; };
const F = mkF(), cues = packCues(F);
const fresh = () => { const rec = buildMatch({ a: 0, b: 140, F: JSON.parse(JSON.stringify(F)), th: [0, 0], kscan: [] }, 1, 1080, {});
  return { ...rec, match: 1, id: 'x', battle: [0, 140], source: { height: 1080 }, cues, review: { marks: {}, added: [], fix: {} }, result_screen: { own: { ka: 5, deaths: 2, specials: 1 } } }; };
const count = m => { const e = effective(m); return { death: e.filter(x => x.kind === 'death').length, kill: e.filter(x => x.kind === 'kill').length, special: e.filter(x => x.kind === 'special').length }; };

{ const m = fresh(); check(JSON.stringify(count(m)) === '{"death":2,"kill":3,"special":1}', '(0) 前提: 素の検出はデス 2・キル 3・発動 1', JSON.stringify(count(m))); }
{ const m = fresh(); check(recorrectStatus({ ...m, cues: null }).reason === 'no-cues' && recorrectStatus({ ...m, result_screen: {}, review: {} }).reason === 'no-values' && recorrectStatus(m).ok, '(1) 信号が無い試合・直す値が無い試合は対象外'); }
{ // 手入力: デス 3・スペシャル 2 → 弱い信号(100 秒)のデスと、弱いゲージ(80 秒)の発動が足される
  const m = fresh(); m.review.rmarks = { deaths: 'wrong', specials: 'wrong' }; m.review.fix = { deaths: 3, specials: 2 };
  const r = recorrect(m);
  check(r.ok && JSON.stringify(count(m)) === '{"death":3,"kill":3,"special":2}', '(2) 手入力のデス 3・スペシャル 2 に合わせて検出が増える', JSON.stringify([r.before, r.after, r.applied.map(a => a.kind + ':' + a.action + '@' + a.t)]));
  check(m.own_deaths.some(e => e.start >= 100 && e.start < 101 && e.auto === 'added') && m.recon.manual === true && m.recon.truth.deaths === 3, '(3) 足したデスは 100 秒付近で「自動補正」の印が付き、recon に手入力の印が残る');
  check(m.own_deaths.filter(e => e.start < 15).length === 1 && m.own_deaths.every(e => e.alive_before), '(4) 元からあった検出は残り、人数（alive_before）が全部入っている');
}
{ // 手入力: K+A 2（キルは検出 3 → 超えている）→ キルが 2 に減る
  const m = fresh(); m.review.rmarks = { ka: 'wrong' }; m.review.fix = { ka: 2 };
  const r = recorrect(m); check(r.ok && count(m).kill === 2, '(5) K+A を 2 にすると、確信度の低いキルが落ちて 2 になる', JSON.stringify(r.after));
}
{ // 歯止めを外す：デス 6 を手入力 → 通常の上限（2 件）を超えて足す…が、候補が無ければ足せる分まで
  const m = fresh(); m.review.fix = { deaths: 6 }; const r = recorrect(m); check(r.ok && count(m).death >= 3 && count(m).death <= 6, '(6) 候補の範囲で上限を超えて足せる', `death=${count(m).death}`);
}
{ // ✗にした検出は件数に数えない：10 秒のデスを✗にすると有効なデスは 1 件。手入力のデス 2 に合わせると、弱い信号（100 秒）の候補が足されて有効 2 件になる
  const m = fresh(); const first = m.own_deaths[0].start; m.review.marks = { [`death@${first.toFixed(1)}`]: 'wrong' }; m.review.fix = { deaths: 2 };
  check(count(m).death === 1, '(7a) 前提: ✗にすると有効なデスは 1 件');
  const r = recorrect(m); check(r.ok && count(m).death === 2 && m.own_deaths.some(e => e.start >= 100 && e.auto === 'added') && m.own_deaths.length === 3, '(7b) ✗にした検出は件数に数えず、足りない分を候補から足す（検出 3 件・有効 2 件）', JSON.stringify([r.after, m.own_deaths.map(e => e.start)]));
}
{ // 見逃し追加した分は目標から引く：追加 1 件 ＋ 手入力のデス 3 → 検出側は 2（追加を足して 3）
  const m = fresh(); m.review.added = [{ kind: 'death', t: 100.4 }]; m.review.fix = { deaths: 3 };
  const r = recorrect(m); check(r.ok && count(m).death === 3, '(8) 見逃し追加の分は重ねて足さない', JSON.stringify(r.after));
}
{ // もとに戻す
  const m = fresh(); const orig = JSON.stringify(count(m)); m.review.fix = { deaths: 3, specials: 2 }; recorrect(m); check(JSON.stringify(count(m)) !== orig, '(9a) 直したあとは件数が変わっている');
  check(undoRecorrect(m) && JSON.stringify(count(m)) === orig && !m.pre_recorrect && m.squid_down.L0 === m.own_deaths, '(9b) 「もとに戻す」で元の検出に戻る');
  check(undoRecorrect(m) === false, '(9c) 戻すものが無ければ何もしない');
  const m2 = fresh(); m2.review.fix = { deaths: 3 }; recorrect(m2); const snap = JSON.stringify(m2.pre_recorrect); m2.review.fix = { deaths: 4 }; recorrect(m2); check(JSON.stringify(m2.pre_recorrect) === snap, '(9d) 何度直しても、戻す先は最初の検出のまま');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
