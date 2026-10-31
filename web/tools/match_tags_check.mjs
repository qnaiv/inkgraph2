// match_tags_check.mjs: b12 試合全体のタグ（長さ・活躍と勝敗・ヤグラのカウント系）を record と要約に出す
import { matchTags, countTags } from '../src/match_tags.js';
import { toRecord } from '../src/ai_export.js';
import { aggregate, stats } from '../src/ai_summary.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const T0 = 1000;
const ser = pts => pts.map(([t, own, enemy]) => ({ t, own, enemy }));
const base = { rule: 'ガチエリア', result: 'WIN', battle_sec: 200, ka: 5, deaths: 3, series: [] };

check(matchTags({ ...base, battle_sec: 100 }).length === 'short' && matchTags({ ...base, battle_sec: 280 }).length === 'long' && matchTags(base).length === 'normal', '(1) 試合の長さ: 短時間決着・延長寄り・ふつう');
check(matchTags({ ...base, rule: 'ナワバリバトル', battle_sec: 180 }).length === null, '(2) ナワバリは 180 秒固定なので長さを付けない');
check(matchTags({ ...base, ka: 8, deaths: 2 }).performance === 'good_win' && matchTags({ ...base, result: 'LOSE', ka: 8, deaths: 2 }).performance === 'good_lose' && matchTags({ ...base, ka: 2, deaths: 4 }).performance === 'mid_win' && matchTags({ ...base, result: 'LOSE', ka: 1, deaths: 6 }).performance === 'poor_lose', '(3) 活躍と勝敗の組み合わせ');
check(matchTags({ ...base, result: null }).performance === null, '(4) 勝敗が不明なら、活躍の組み合わせは付けない');
check(matchTags(base).count === null, '(5) カウントの推移が無い（ヤグラ以外）なら、カウント系は付かない');

const comeback = ser([[0, 0, 0], [20, 0, 25], [40, 5, 40], [60, 30, 45], [80, 60, 50], [100, 90, 60], [120, 100, 70]]);
{ const c = countTags(comeback, 'WIN', 120);
  check(c.flow === 'comeback_win' && c.first_lead === 'enemy' && c.lead_changes === 1 && c.max_behind === 35, '(6) 逆転勝ち: 大きく離されてから勝つ', JSON.stringify(c)); }
{ const c = countTags(ser([[0, 0, 0], [20, 10, 2], [40, 30, 10], [60, 55, 20], [80, 80, 30], [100, 100, 40]]), 'WIN', 100);
  check(c.flow === 'straight_win' && c.first_lead === 'own' && c.lead_changes === 0, '(7) ストレート勝ち: 一度も逆転されない', JSON.stringify(c)); }
{ check(countTags(ser([[0, 0, 0], [20, 2, 10], [40, 5, 30], [60, 10, 55], [80, 15, 80], [100, 20, 100]]), 'LOSE', 100).flow === 'straight_lose', '(8) ストレート負け');
  check(countTags(ser([[0, 0, 0], [20, 30, 5], [40, 50, 20], [60, 55, 50], [80, 60, 80], [100, 70, 100]]), 'LOSE', 100).flow === 'comeback_lose', '(9) 逆転負け: 大きく先行してから負ける'); }
check(countTags(ser([[0, 0, 0], [10, 1, 1]]), 'WIN', 20) === null, '(10) 点が少なすぎればカウント系は付けない');
{ const c = countTags(ser([[0, 0, 0], [30, 40, 40], [60, 50, 50], [80, 60, 50], [100, 70, 50], [110, 90, 50]]), 'WIN', 110);
  check(c.endgame_delta === 30, '(11) 終盤の粘り: 残り 30 秒付近からのカウント差の変化', String(c.endgame_delta)); }

const mk = (extra = {}, rs = {}) => ({
  id: 't1', created: '2026-10-31T10:00:00Z', battle: [T0, T0 + 120], squid_down: {}, match_type: 'bankara_open',
  own_deaths: [], own_kills: [], special: [],
  tower_series: [0, 20, 40, 60, 80, 100].map((t, i) => ({ t: T0 + t, own: i * 18, enemy: i * 6, owner: 'own' })),
  result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'ナメロウ金属', own: { ka: 9, deaths: 2, specials: 1 }, ...rs }, ...extra });
{ const r = toRecord(mk());
  check(r.tags.length === 'short' && r.tags.performance === 'good_win' && r.tags.count.flow === 'straight_win' && r.tags.count.first_lead === 'own', '(12) record.tags に、長さ・活躍・カウント系が付く', JSON.stringify(r.tags));
  check(toRecord(mk({ tower_series: undefined }, { mode: 'ガチエリア' })).tags.count === null, '(13) ヤグラ以外の record は、カウント系が null'); }
{ const recs = [toRecord(mk()), toRecord(mk({ id: 't2' }, { result: 'LOSE', own: { ka: 1, deaths: 6, specials: 0 } })), { id: 'old', created: '2026-10-31T10:30:00Z', owner: 'self', fix: 'none', rule: 'ガチエリア', stage: 'x', result: 'WIN', battle_sec: 180, ka: 1, deaths: [30], kills: [], special: { ready: 0, lost: 0, activated: 0 }, first_death: 30 }];
  const s = stats(recs).match_tags;
  check(s.n === 2 && s.length.short.n === 2 && s.performance.good_win.wins === 1 && s.performance.poor_lose.losses === 1, '(14) 要約: タグ別の勝敗。古い書き出し（tags なし）は数えない', JSON.stringify(s));
  check(s.count.n === 2 && s.count.first_lead.own.n === 2, '(15) 要約: カウント系はヤグラの試合だけ数える');
  const agg = aggregate(recs, { now: Date.parse('2026-10-31T11:00:00Z') });
  check(agg.windows.last20.match_tags && agg.quality.notes.some(n => n.includes('match_tags')), '(16) aggregate に match_tags と、しきい値が案である注意が載る'); }
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
