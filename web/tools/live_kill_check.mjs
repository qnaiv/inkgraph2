// live_kill_check.mjs: D82 速報のキル数（通知の繰り上がり・ちらつきで増やさない）
import { LiveKillCounter } from '../src/core/live_counts.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const run = frames => { const c = new LiveKillCounter(); return frames.reduce((a, f) => a + c.step(f), 0); };
const T = true, F = false;
check(run([[F,F,F],[T,F,F],[T,F,F],[T,F,F],[F,F,F],[F,F,F]]) === 1, '(1) 1 つの通知は 1 キル');
check(run([[F,F,F],[T,F,F],[F,F,F],[T,F,F],[F,F,F]]) === 0, '(2) 1 フレームだけのちらつきは数えない');
check(run([[F,F,F],[T,F,F],[T,F,F],[F,T,F],[F,T,F],[F,F,T],[F,F,T],[F,F,F],[F,F,F]]) === 1, '(3) 通知が上の段へ繰り上がっても増やさない');
check(run([[T,F,F],[T,F,F],[T,T,F],[T,T,F],[T,T,F],[F,T,T],[F,T,T]]) === 2, '(4) 前の通知が残っているうちの 2 つ目は数える（2 キル）');
check(run([[F,F,F],[T,F,F],[T,F,F],[F,F,F],[F,F,F],[T,F,F],[T,F,F],[F,F,F],[F,F,F]]) === 2, '(5) 消えてから出た通知は別のキル');
check(run([[F,F,F],[T,F,F],[T,T,F],[T,T,F],[T,T,F]]) === 2, '(6) 1 フレームだけ 1 本→2 本のとき、確定したら増えた分だけ数える');
console.log(fails ? `FAIL ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
