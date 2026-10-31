// death_tags_check.mjs: b03 デスのタグ（スペシャル溜め・序盤/終盤・連続デス・相打ち・人数・局面）を、record と要約に出す
import { effective } from '../src/analysis.js';
import { toRecord } from '../src/ai_export.js';
import { aggregate, stats } from '../src/ai_summary.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const T0 = 1000, rng = (s, e) => [{ start: T0 + s, end: T0 + e }];
// 自チーム L0〜L3、敵 R0〜R3。10 秒に 1 回目、18 秒に 2 回目（連続）、100 秒に 3 回目（スペシャル溜め中・L1 ダウン中で不利）、170 秒に 4 回目（終盤）
const squid_down = { L0: [], L1: rng(95, 120), L2: [], L3: [], R0: [], R1: [], R2: [], R3: [] };
const mk = (extra = {}) => ({
  id: 't1', created: '2026-10-31T10:00:00Z', battle: [T0, T0 + 180], squid_down, match_type: 'bankara_open',
  own_deaths: [10, 18, 100, 170].map(s => ({ start: T0 + s, end: T0 + s + 3 })), own_kills: [{ start: T0 + 99, end: T0 + 100 }],
  special: [{ ready: T0 + 60, end: T0 + 100, outcome: 'lost_on_death', activated_at: null }],
  result_screen: { result: 'LOSE', mode: 'ガチエリア', stage: 'ナメロウ金属', own: { ka: 3, deaths: 4, specials: 0 } }, ...extra
});
const tg = m => effective(m).filter(e => e.kind === 'death').map(e => e.tags);

{ const t = tg(mk());
  check(t[0].join() === 'early', '(1) 開始30秒以内のデス', t[0].join());
  check(t[1].join() === 'early,redeath', '(2) 直前のデスから15秒以内なら連続デス', t[1].join());
  check(t[2].join() === 'sp_lost,trade,down', '(3) スペシャルを溜めたまま・直前にキル・人数不利', t[2].join());
  check(t[3].join() === 'late', '(4) 残り30秒以内のデス', t[3].join()); }
{ const m = mk({ review: { marks: { 'death@1018.0': 'wrong' }, added: [] } }); const t = tg(m);
  check(t.length === 3 && t[1].join() === 'sp_lost,trade,down', '(5) 人が✗にしたデスは数えず、連続デス判定にも使わない', JSON.stringify(t)); }
{ const r = toRecord(mk());
  check(r.death_ctx.every(c => Array.isArray(c.tags)) && r.death_ctx[2].tags.join() === 'sp_lost,trade,down' && r.deaths.length === 4, '(6) record の death_ctx に tags が付き、従来の項目は変わらない'); }
{ const recs = [toRecord(mk()), toRecord(mk({ id: 't2' })), { id: 'old', created: '2026-10-31T10:30:00Z', owner: 'self', fix: 'none', rule: 'ガチエリア', stage: 'x', result: 'WIN', battle_sec: 180, ka: 1, deaths: [30], death_ctx: [{ t: 30, alive: '4v4', man: 'even', phase: null }], kills: [], special: { ready: 0, lost: 0, activated: 0 }, first_death: 30 }];
  const ds = stats(recs).death_situation;
  check(ds.n_tagged === 8 && ds.by_tag.sp_lost.count === 2 && ds.by_tag.early.count === 4 && ds.by_tag.redeath.count === 2, '(7) 要約: タグ別の回数（tags の無い古い記録は n_tagged に入らない）', JSON.stringify(ds.by_tag.sp_lost) + ds.n_tagged);
  check(ds.by_tag.sp_lost.share.value === 0.25 && ds.by_tag.sp_lost.share.n === 8, '(8) タグの割合に信頼区間が付く');
  const agg = aggregate(recs, { now: Date.parse('2026-10-31T11:00:00Z') });
  check(agg.quality.notes.some(n => n.includes('位置・敵ブキ別は取れていない')), '(9) できないことの注意が載る'); }
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
