// fusion_check.mjs: D53 複数信号の合議（fusion）と、結果画面なしでの採用。Node のみ。
import { buildMatch } from '../src/core/analyzer.js';

let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };

const mkF = (sec, fn) => { const F = []; for (let t = 0; t <= sec + 1e-6; t = +(t + 0.2).toFixed(1)) F.push({ t, ok: true, map: false, sig: false, sy: 0, ks: 0, kill: false, killSlots: [false], gw: 0, go: 0, p: null, s: null, ally: null, ...fn(t) }); return F; };
const run = (F, ctx) => buildMatch({ a: 0, b: F[F.length - 1].t, F, th: [0, 0], kscan: [] }, 1, 1080, ctx);

console.log('--- D53 合議（fusion） ---');
import { fuseDeath, fusedAccept, fuseKill } from '../src/core/fusion.js';
{
  const a = fuseDeath({ sy: 0.5 }), b = fuseDeath({ sy: 0.5, hud: 1 }), c = fuseDeath({ sy: 0.5, hud: 1, killer: true }), d = fuseDeath({ sy: 0, hud: 1 });
  check(a.conf < b.conf && b.conf < c.conf && a.signals.length === 1 && b.signals.length === 2 && d.signals.length === 1, '(18) 信号が増えるほど確信度が上がる', `${a.conf}/${b.conf}/${c.conf}/${d.conf}`);
  check(!fusedAccept(fuseDeath({ sy: 0.45 })) && fusedAccept(fuseDeath({ sy: 0.45, hud: 1 })) && !fusedAccept(fuseDeath({ hud: 1 })), '(19) 弱い信号＋HUD の一致は採用、HUD だけ・弱い信号だけは採用しない');
  check(fuseKill({ notice: 0.9, enemy: true }).conf > fuseKill({ notice: 0.9 }).conf && fuseKill({ notice: 0.6 }).conf < fuseKill({ notice: 0.9 }).conf, '(20) キルは通知が強く敵アイコンも×なら確信度が高い');
}
{
  // 結果画面なしでも、弱い信号（0.45）と HUD の自分アイコン×が一致する 100〜103 秒は採用される。HUD だけの 130〜133 秒は採用されない
  const F = mkF(150, t => ({ sy: (t >= 10 && t < 14) ? 0.8 : (t >= 100 && t < 103 ? 0.45 : 0), sig: t >= 10 && t < 14,
    p: Array(8).fill(0).map((_, i) => i === 0 && ((t >= 10 && t < 14) || (t >= 100 && t < 103) || (t >= 130 && t < 133)) ? 0.95 : 0.0), s: Array(8).fill(20) }));
  const r = run(F, {});
  const fused = r.own_deaths.filter(e => e.auto === 'fused');
  check(r.own_deaths.length === 2 && fused.length === 1 && fused[0].start >= 100 && fused[0].start < 101 && fused[0].sigs.includes('sig') && fused[0].sigs.includes('hud'), '(21) 結果画面なしでも 2 信号が一致した弱いデスは採用する', JSON.stringify(r.own_deaths.map(e => [e.start, e.auto, e.conf])));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
