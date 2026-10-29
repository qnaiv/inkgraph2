// reconcile_check.mjs: Node-only check for D52 (結果画面の数に合わせた自動補正).
import { reconcileCounts } from '../src/core/reconcile.js';
import { buildMatch } from '../src/core/analyzer.js';

let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mk = (o = {}) => ({ own_deaths: [], special: [], own_kills: [], ...o });
const own = (ka, deaths, specials) => ({ ka, deaths, specials });

console.log('--- reconcileCounts unit checks ---');

// デス: 足りない → 確信度の高い候補を戻す。重なる候補は足さない
{
  const rec = mk({ own_deaths: [{ start: 10, end: 14, conf: 0.8 }, { start: 50, end: 54, conf: 0.7 }] });
  const r = reconcileCounts(rec, { own: own(0, 3, null), frames: 10, deathCands: [{ start: 30, end: 33, src: 'signal_soft', conf: 0.42 }, { start: 11, end: 13, src: 'signal_soft', conf: 0.45 }, { start: 80, end: 82, src: 'hud_soft', conf: 0.2 }] });
  check(rec.own_deaths.length === 3 && rec.own_deaths[1].start === 30 && rec.own_deaths[1].auto === 'added', '(1) デス不足 → 重ならない最良候補(30秒)を足す', JSON.stringify(r.summary.deaths));
}
// デス: 多い → 確信度の最も低い検出を落とす
{
  const rec = mk({ own_deaths: [{ start: 10, end: 14, conf: 0.8 }, { start: 30, end: 33, conf: 0.52 }, { start: 50, end: 54, conf: 0.7 }] });
  const r = reconcileCounts(rec, { own: own(0, 2, null), frames: 10 });
  check(rec.own_deaths.length === 2 && !rec.own_deaths.some(e => e.start === 30) && r.applied[0].action === 'dropped', '(2) デス過多 → conf 最低(30秒)を落とす');
}
// デス: ずれが大きい（上限 2 件）なら 2 件までしか直さない
{
  const rec = mk({ own_deaths: [{ start: 10, end: 14, conf: 0.8 }] });
  const cands = [20, 40, 60, 80].map((s, i) => ({ start: s, end: s + 2, src: 'signal_soft', conf: 0.4 - i * 0.01 }));
  reconcileCounts(rec, { own: own(0, 9, null), frames: 10, deathCands: cands });
  check(rec.own_deaths.length === 3, '(3) 差が大きくても最大 2 件までしか足さない', `n=${rec.own_deaths.length}`);
}
// 候補が floor 未満なら足さない
{
  const rec = mk({ own_deaths: [] });
  reconcileCounts(rec, { own: own(0, 1, null), frames: 10, deathCands: [{ start: 5, end: 7, src: 'hud_soft', conf: 0.05 }] });
  check(rec.own_deaths.length === 0, '(4) 確信度が floor 未満の候補は足さない');
}
// 結果画面が読めていない・フレーム不足・null は何もしない
{
  const rec = mk({ own_deaths: [{ start: 10, end: 14, conf: 0.8 }] });
  const a = reconcileCounts(rec, { own: null, frames: 10 }), b = reconcileCounts(rec, { own: own(0, 5, null), frames: 1, deathCands: [{ start: 30, end: 33, conf: 0.9 }] }), c = reconcileCounts(rec, { own: own(null, null, null), frames: 10 });
  check(!a.applied.length && !b.applied.length && !c.applied.length && rec.own_deaths.length === 1, '(5) 結果画面なし／フレーム不足／値 null は何もしない');
}
// スペシャル: 不足 → デスで消失判定のうち「途中デス＋橙あり」を発動に戻す
{
  const rec = mk({ special: [{ ready: 10, end: 20, outcome: 'activated', activated_at: 20, conf: 0.8 }, { ready: 40, end: 50, outcome: 'lost_on_death', mid_death: true, drain: 0.1 }, { ready: 70, end: 75, outcome: 'lost_on_death' }] });
  const r = reconcileCounts(rec, { own: own(null, null, 2), frames: 10, drainAt: b => (b === 50 ? 0.12 : 0) });
  const e = rec.special[1];
  check(e.outcome === 'activated' && e.activated_at === 50 && e.auto === 'promoted' && rec.special[2].outcome === 'lost_on_death', '(6) スペシャル不足 → 途中デス＋橙ありの区間を発動に戻す', JSON.stringify(r.summary.specials));
}
// スペシャル: 不足でデス消失の候補がなければゲージ候補を足す
{
  const rec = mk({ special: [{ ready: 10, end: 20, outcome: 'activated', activated_at: 20, conf: 0.8 }] });
  reconcileCounts(rec, { own: own(null, null, 2), frames: 10, spCands: [{ ready: 11, end: 12, conf: 0.35 }, { ready: 60, end: 60.4, conf: 0.3 }] });
  check(rec.special.length === 2 && rec.special[1].ready === 60 && rec.special[1].auto === 'added', '(7) 既存区間と重なる候補は足さず、重ならない候補(60秒)を足す');
}
// スペシャル: 過多 → 確信度の低い発動を落とす（lost_on_death は数えない）
{
  const rec = mk({ special: [{ ready: 10, end: 20, outcome: 'activated', activated_at: 20, conf: 0.8 }, { ready: 30, end: 31, outcome: 'activated', activated_at: 31, conf: 0.3 }, { ready: 40, end: 45, outcome: 'lost_on_death' }] });
  reconcileCounts(rec, { own: own(null, null, 1), frames: 10 });
  check(rec.special.length === 2 && rec.special.filter(e => e.outcome === 'activated').length === 1 && rec.special[0].ready === 10, '(8) スペシャル過多 → conf 低い発動を落とす');
}
// キル: K+A を超えた分だけ落とす。足りない分は足さない
{
  const rec = mk({ own_kills: [{ start: 5, end: 7, conf: 0.9 }, { start: 15, end: 17, conf: 0.62 }, { start: 25, end: 27, conf: 0.8 }] });
  reconcileCounts(rec, { own: own(2, null, null), frames: 10 });
  check(rec.own_kills.length === 2 && !rec.own_kills.some(e => e.start === 15), '(9) キルが K+A を超えたら conf 最低を落とす');
  reconcileCounts(rec, { own: own(9, null, null), frames: 10 });
  check(rec.own_kills.length === 2, '(10) キルが K+A 未満でも足さない（アシストが含まれるため）');
}

console.log('--- buildMatch 統合チェック（合成フレーム） ---');
const mkF = (sec, fn) => { const F = []; for (let t = 0; t <= sec + 1e-6; t = +(t + 0.2).toFixed(1)) F.push({ t, ok: true, map: false, sig: false, sy: 0, ks: 0, kill: false, killSlots: [false], gw: 0, go: 0, p: null, s: null, ally: null, ...fn(t) }); return F; };
const run = (F, ctx) => buildMatch({ a: 0, b: F[F.length - 1].t, F, th: [0, 0], kscan: [] }, 1, 1080, ctx);
{
  // 10–14 秒と 60–64 秒は強い信号（採用）、100–103 秒は弱い信号（0.40、採用されない）
  const F = mkF(150, t => ({ sig: (t >= 10 && t < 14) || (t >= 60 && t < 64), sy: (t >= 10 && t < 14) || (t >= 60 && t < 64) ? 0.8 : (t >= 100 && t < 103 ? 0.4 : 0) }));
  const base = run(F, {});
  check(base.own_deaths.length === 2 && base.recon === null, '(11) 結果画面なしなら補正しない（従来と同じ 2 件）', `n=${base.own_deaths.length}`);
  const fix = run(F, { own: own(null, 3, null), frames: 20, reconcile: true });
  const added = fix.own_deaths.find(e => e.auto === 'added');
  check(fix.own_deaths.length === 3 && added && added.start >= 100 && added.start < 101 && fix.recon.summary.deaths.after === 3, '(12) 結果画面デス3 → 弱い信号(100秒)の候補を戻して 3 件', JSON.stringify(fix.recon && fix.recon.summary));
  check(fix.own_deaths.every(e => typeof e.conf === 'number'), '(13) 全デスに conf が付く');
  // D77: 結果画面の数があっても、既定では件数合わせの補正をしない（reconcile を明示した手入力の再補正だけが使う）
  const noFix = run(F, { own: own(null, 3, null), frames: 20 });
  check(noFix.own_deaths.length === 2 && noFix.recon === null && !noFix.own_deaths.some(e => e.auto), '(12b) 結果画面デス3 でも、既定では補正しない（2 件のまま・auto 印なし・recon なし）', `n=${noFix.own_deaths.length}`);
  const same = run(F, { own: own(null, 2, null), frames: 20, reconcile: true });
  check(same.own_deaths.length === 2 && same.recon.applied.length === 0, '(14) 結果画面と一致していれば何も直さない');
}
{
  // 発動 1 本（20〜30 秒に満タン）＋ 短い満タン（0.2 秒ぶん gw=0.15）が 80 秒に 1 回
  const F = mkF(150, t => ({ gw: t >= 20 && t < 30 ? 0.9 : (t >= 80 && t < 80.6 ? 0.16 : 0) }));
  const base = run(F, {});
  check(base.special.filter(e => e.outcome === 'activated').length === 1, '(15) 補正前は発動 1');
  const fix = run(F, { own: own(null, null, 2), frames: 20, reconcile: true });
  const a = fix.special.filter(e => e.outcome === 'activated');
  check(a.length === 2 && a.some(e => e.auto === 'added' && e.ready >= 79 && e.ready < 81), '(16) 結果画面スペシャル2 → 弱いゲージ(80秒)を発動として足す', JSON.stringify(fix.recon && fix.recon.summary));
}
{
  const F = mkF(60, t => ({ killSlots: [(t >= 10 && t < 12) || (t >= 30 && t < 32) || (t >= 45 && t < 47)], kill: false, ks: (t >= 10 && t < 12) ? 0.9 : (t >= 30 && t < 32) ? 0.65 : (t >= 45 && t < 47) ? 0.8 : 0 }));
  const r = run(F, { own: own(2, null, null), frames: 20, reconcile: true });
  check(r.own_kills.length === 2 && !r.own_kills.some(e => e.start === 30), '(17) キル 3 → K+A=2 で conf 最低(30秒)を落とす', JSON.stringify(r.own_kills));
}

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
