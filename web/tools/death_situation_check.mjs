// death_situation_check.mjs: b15 デスごとの人数差・局面を、record と要約に出す
import { manState, effective } from '../src/analysis.js';
import { toRecord } from '../src/ai_export.js';
import { aggregate, stats } from '../src/ai_summary.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const T0 = 1000;
// 自チーム L0〜L3、敵 R0〜R3。1 回目のデス(T0+20)は 4v4、2 回目(T0+80)は味方 1 人ダウンで 3v4、3 回目(T0+140)は敵 2 人ダウンで 4v2
const down = (s, e) => [{ start: T0 + s, end: T0 + e }];
const squid_down = { L0: [], L1: down(60, 100), L2: [], L3: [], R0: down(120, 160), R1: down(125, 165), R2: [], R3: [] };
const mk = (extra = {}) => ({
  id: 'd1', created: '2026-10-31T10:00:00Z', battle: [T0, T0 + 200], squid_down, match_type: 'bankara_open',
  own_deaths: [20, 80, 140].map(s => ({ start: T0 + s, end: T0 + s + 3 })), own_kills: [{ start: T0 + 130, end: T0 + 131 }], special: [],
  result_screen: { result: 'LOSE', mode: 'ガチエリア', stage: 'ナメロウ金属', own: { ka: 3, deaths: 3, specials: 0 } }, ...extra
});

check(manState(4, 4) === 'even' && manState(3, 4) === 'down' && manState(4, 2) === 'up', '(1) 人数差の区分（有利・同数・不利）');
{ const eff = effective(mk()).filter(e => e.kind === 'death');
  check(eff.map(e => e.alive).join() === '4v4,3v4,4v2' && eff.map(e => e.man).join() === 'even,down,up', '(2) デスごとに、直前の生存人数と人数差が付く', eff.map(e => e.alive).join()); }
{ const r = toRecord(mk());
  check(r.death_ctx.length === 3 && r.death_ctx[1].t === 80 && r.death_ctx[1].man === 'down' && r.death_ctx[1].alive === '3v4' && r.death_ctx[1].phase === null, '(3) record の death_ctx: 秒・人数・人数差。カウントが無い（エリア）なら局面は null', JSON.stringify(r.death_ctx[1]));
  check(r.deaths.join() === '20,80,140', '(4) 従来の deaths は変わらない'); }
{ // ヤグラ: カウントがあれば局面が付く
  const m = mk({ tower_series: [{ t: T0, own: 50, enemy: 50, owner: null }, { t: T0 + 70, own: 40, enemy: 60, owner: 'enemy' }], result_screen: { result: 'LOSE', mode: 'ガチヤグラ', stage: 'ナメロウ金属', own: { ka: 3, deaths: 3, specials: 0 } } });
  const r = toRecord(m);
  check(r.death_ctx[1].phase === '打開', '(5) ヤグラでカウントがあれば、局面（打開など）が付く', r.death_ctx[1].phase); }
{ // 人が ✗ にしたデスは含まれない／追加したデスは含まれる
  const r = toRecord(mk({ review: { marks: { 'death@1020.0': 'wrong' }, added: [{ kind: 'death', t: T0 + 170 }] } }));
  check(r.death_ctx.map(c => c.t).join() === '80,140,170', '(6) 人が直した後のデスで数える（✗ は除き、追加は入る）', r.death_ctx.map(c => c.t).join()); }
{ const recs = [toRecord(mk()), toRecord(mk({ id: 'd2' })), { id: 'old', created: '2026-10-31T10:30:00Z', owner: 'self', fix: 'none', rule: 'ガチエリア', stage: 'x', result: 'WIN', battle_sec: 180, ka: 1, deaths: [30, 90], kills: [], special: { ready: 0, lost: 0, activated: 0 }, first_death: 30 }];
  const s = stats(recs), ds = s.death_situation;
  check(ds.n === 6 && ds.of_deaths === 8 && ds.by_man.even === 2 && ds.by_man.down === 2 && ds.by_man.up === 2, '(7) 要約: 状況の分かるデスだけ数える（古い書き出しの分は n に入らない）', JSON.stringify(ds));
  check(ds.down_share && ds.down_share.value === 0.333 && ds.down_share.n === 6, '(8) 不利で死んだ割合に、幅（信頼区間）が付く', JSON.stringify(ds.down_share));
  check(ds.by_phase.n === 0, '(9) 局面は、読めた試合が無ければ 0 件');
  const agg = aggregate(recs, { now: Date.parse('2026-10-31T11:00:00Z') });
  check(agg.windows.last20.death_situation && agg.quality.notes.some(n => n.includes('前線か後ろかは分からない')), '(10) aggregate に death_situation と、できないことの注意が載る'); }
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
