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

console.log('--- D78 採用しなかった候補（rec.cands） ---');
{
  // 強い信号の 10〜14 秒は採用。弱い信号（0.40）の 100〜103 秒、HUD だけの 130〜133 秒は採用されず、候補に残る
  const F = mkF(150, t => ({ sy: (t >= 10 && t < 14) ? 0.8 : (t >= 100 && t < 103 ? 0.4 : 0), sig: t >= 10 && t < 14,
    p: Array(8).fill(0).map((_, i) => i === 0 && (t >= 130 && t < 133) ? 0.95 : 0.0), s: Array(8).fill(20) }));
  const r = buildMatch({ a: 0, b: 150, F, th: [0, 0], kscan: [] }, 1, 1080, {});
  const c = r.cands;
  check(r.own_deaths.length === 1 && c.death.some(x => x.start >= 100 && x.start < 101) && c.death.some(x => x.start >= 130 && x.start < 131), '(22) 採用しなかったデスの候補（弱い信号・HUD だけ）が残る', JSON.stringify(c.death.map(x => [x.start, x.conf, x.src])));
  check(!c.death.some(x => x.start >= 10 && x.start < 14) && c.death.every(x => x.conf >= 0.1 && Array.isArray(x.sigs)), '(23) 採用したデスは候補に入らない。候補には確信度と信号がある');
}
{
  // スペシャル: 20〜30 秒に満タン（採用）。80 秒に短い満タン（0.16）は採用されず候補に残る
  const F = mkF(150, t => ({ gw: t >= 20 && t < 30 ? 0.9 : (t >= 80 && t < 80.6 ? 0.16 : 0) }));
  const r = buildMatch({ a: 0, b: 150, F, th: [0, 0], kscan: [] }, 1, 1080, {});
  check(r.special.filter(e => e.outcome === 'activated').length === 1 && r.cands.special.some(x => x.ready >= 79 && x.ready < 81) && !r.cands.special.some(x => x.ready >= 19 && x.ready < 31), '(24) 採用しなかったスペシャルの候補が残る（採用したものは入らない）', JSON.stringify(r.cands.special));
}
{
  // キル: 10〜12 秒は強い通知（採用）。30〜32 秒は弱い通知（0.4、採用されない）→ 候補
  const F = mkF(60, t => ({ killSlots: [(t >= 10 && t < 12)], kill: false, ks: (t >= 10 && t < 12) ? 0.9 : (t >= 30 && t < 32) ? 0.4 : 0 }));
  const r = buildMatch({ a: 0, b: 60, F, th: [0, 0], kscan: [] }, 1, 1080, {});
  check(r.own_kills.length === 1 && r.cands.kill.length === 1 && r.cands.kill[0].start >= 30 && r.cands.kill[0].start < 31, '(25) 採用しなかったキルの候補（弱い通知）が残る', JSON.stringify(r.cands.kill));
}
const cap = (() => { const F = mkF(400, t => ({ sy: ((t % 20) >= 10 && (t % 20) < 13) ? 0.4 : 0 })); const r = buildMatch({ a: 0, b: 400, F, th: [0, 0], kscan: [] }, 1, 1080, {}); return r.cands.death.length; })();
check(cap <= 15 && cap >= 10, '(26) 候補は種類ごとに上限（15）まで', String(cap));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
