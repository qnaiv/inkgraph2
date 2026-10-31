// Burst death check (D71): 「やられた」が短く途切れるデス（マップを開く・試合終了）を burstDeaths が拾う／重複させない。
import { burstDeaths } from '../src/core/analyzer.js';

let fails = 0;
const results = [];
const check = (ok, name, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) fails++;
};

console.log('--- Burst Death Unit Checks (JS) ---');
const T = Array.from({ length: 4000 }, (_, i) => +(i * 0.3).toFixed(1));
const sigAt = (...spans) => T.map(t => (spans.some(([a, b]) => t >= a && t <= b) ? 0.92 : 0));

// 1. 既存のデスから離れた 3 コマの塊は新しいデスになる（実データの見逃し 5 件と同じ形）
{
  const L = [{ start: 60, end: 65, src: 'signal' }];
  const add = burstDeaths(T, sigAt([120, 120.6]), L);
  check(add.length === 1 && add[0].start === 120 && add[0].src === 'signal_burst', 'case 1: isolated 3-frame burst => 1 new death', `got=${JSON.stringify(add)}`);
}
// 2. 1 コマだけの強い信号は雑音として採用しない
{
  const add = burstDeaths(T, sigAt([120, 120]), []);
  check(add.length === 0, 'case 2: single strong frame is ignored', `got=${JSON.stringify(add)}`);
}
// 3. 既存のデスの直前 pre 秒以内の塊は、新しいデスにせず開始を前倒しする（デス中にマップを開いて信号が途切れた形）
{
  const L = [{ start: 923.6, end: 927.6, src: 'signal' }];
  const add = burstDeaths(T, sigAt([921.9, 922.5]), L);
  check(add.length === 0 && L[0].start === 921.9, 'case 3: burst just before a death extends its start', `add=${add.length} start=${L[0].start}`);
}
// 4. 既存のデスの直後（復帰前）に出る塊は、同じデスの一部なので足さない
{
  const L = [{ start: 100, end: 104, src: 'signal' }];
  const add = burstDeaths(T, sigAt([106, 106.6]), L);
  check(add.length === 0 && L[0].start === 100, 'case 4: burst after a death is the same death', `add=${add.length} start=${L[0].start}`);
}
// 5. 5 秒以内に続く塊は 1 回のデスにまとめる（途切れ途切れの信号）
{
  const add = burstDeaths(T, sigAt([200, 200.6], [203, 203.6]), []);
  check(add.length === 1 && add[0].start < 200.5 && add[0].end > 203, 'case 5: bursts within 5s merge into one death', `got=${JSON.stringify(add)}`);
}
// 6. 十分に離れた 2 つの塊は 2 回のデス
{
  const add = burstDeaths(T, sigAt([100, 100.6], [150, 150.6]), []);
  check(add.length === 2, 'case 6: far-apart bursts => 2 deaths', `got=${add.length}`);
}
// 7. 弱い信号（sy < th）は拾わない
{
  const sy = T.map(t => (t >= 120 && t <= 121 ? 0.6 : 0));
  check(burstDeaths(T, sy, []).length === 0, 'case 7: weak signal is not a burst');
}

if (fails) {
  console.log(`\n${fails} check(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\nALL PASSED: ${results.length} checks passed`);
  process.exit(0);
}
