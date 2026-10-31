// suspect_check.mjs: b04 怪しい検出を項目単位で見つける（判定条件・確認済みの除外・差分への流れ）
import { suspectReasons, suspectList, SUSPECT_CONF } from '../src/suspect.js';
import { diffOf } from '../src/fix_pack.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mk = (review = {}) => ({ id: 's1', battle: [100, 300], created: '2026-10-31T10:00:00Z', squid_down: {},
  own_deaths: [{ start: 110, end: 113, src: 'signal', conf: 0.9 }, { start: 150, end: 153, src: 'signal', conf: 0.3 }, { start: 190, end: 193, src: 'signal_soft', conf: 0.8, auto: 'fused' }, { start: 230, end: 233, src: 'hud' }, { start: 260, end: 263, src: 'signal', conf: 0.2, auto: 'added' }],
  own_kills: [{ start: 120, end: 121, conf: 0.9 }, { start: 170, end: 171, conf: 0.1 }], special: [], result_screen: {}, review: { marks: {}, added: [], fix: {}, rmarks: {}, ...review } });
const ev = (m, k, s) => ({ kind: k, src: (k === 'death' ? m.own_deaths : m.own_kills).find(x => x.start === s) });

{ const m = mk();
  check(suspectReasons(ev(m, 'death', 110)).length === 0, '(1) 確信度が高く、通常の信号で拾ったデスは怪しくない');
  check(suspectReasons(ev(m, 'death', 150)).join() === '確信度が低い', '(2) 確信度が低い(< ' + SUSPECT_CONF + ')デスは怪しい');
  check(suspectReasons(ev(m, 'death', 190)).join() === '複数の弱い信号の一致で自動採用', '(3) 自動採用(fused)のデスは怪しい');
  check(suspectReasons(ev(m, 'death', 230)).length === 1 && suspectReasons(ev(m, 'death', 230))[0].startsWith('HUD'), '(4) HUD だけで拾ったデスは怪しい');
  check(suspectReasons(ev(m, 'death', 260)).length === 0, '(5) 結果画面の数に合わせて足した(auto:added)ものは対象外');
  check(suspectReasons(ev(m, 'kill', 170)).join() === '確信度が低い' && suspectReasons(ev(m, 'kill', 120)).length === 0, '(6) キルも確信度で判定する');
  check(suspectReasons({ kind: 'special', src: { conf: 0.1 } }).length === 0, '(7) スペシャルは対象外'); }

{ const m = mk();
  check(suspectList(m).map(x => x.t).join() === '150,170,190,230', '(8) 怪しい検出が時刻順に並ぶ', suspectList(m).map(x => x.t).join());
  const k = suspectList(m)[0].key; m.review.marks[k] = 'ok';
  check(suspectList(m).map(x => x.t).join() === '170,190,230', '(9) ✓/✗ を付けた検出は一覧から外れる');
  m.review.marks[suspectList(m)[0].key] = 'wrong';
  const d = diffOf(m);
  check(d.confirmed.length === 1 && d.false_positives.length === 1 && d.unreviewed === 5, '(10) ✓/✗ は既存の差分(diffOf)にそのまま流れる', JSON.stringify([d.confirmed.length, d.false_positives.length, d.unreviewed])); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
