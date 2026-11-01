// match_type_fix_check.mjs: マッチタイプ（フェス・レギュラー・プライベートなど）を、確認画面で選んで訂正する。直した値が結果・AI 用の記録・集計に使われる
import { MATCH_TYPE_LABEL, MATCH_TYPE_OPTIONS, RESULT_FIELDS, resultOf, powerOf, filterTrendMatches } from '../src/analysis.js';
import { powerForMatchType } from '../src/core/result.js';
import { STAGES } from '../src/stage_lib.js';
import { toRecord } from '../src/ai_export.js';
import { aggregate } from '../src/ai_summary.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const base = (rs, fix, mt) => ({
  id: 'f1', squid_down: {}, created: '2026-11-01T10:00:00Z', battle: [1000, 1180], own_deaths: [], own_kills: [], special: [],
  result_screen: { result: 'LOSE', mode: 'ナワバリバトル', stage: 'コンブトラック', own: { ka: 3, deaths: 5, specials: 1 }, ...rs }, match_type: mt === undefined ? null : mt,
  review: { marks: {}, rmarks: {}, fix: fix || {}, added: [] }
});

const FEST = ['fest_challenge', 'fest_open', 'fest_tricolor'];
check(FEST.every(k => MATCH_TYPE_LABEL[k] && MATCH_TYPE_OPTIONS.some(o => o.value === k)), '(1) フェス（チャレンジ・オープン・トリカラ）がマッチタイプの選択肢と絞り込みにある');
check(['regular', 'private', 'other', 'x', 'bankara_open', 'bankara_challenge'].every(k => MATCH_TYPE_LABEL[k]), '(2) 既存のマッチタイプ（other など）は残っている');
check(RESULT_FIELDS.match_type === 'マッチタイプ', '(3) 確認画面の結果の項目に「マッチタイプ」がある');
check(['fest_challenge', 'fest_open', 'fest_tricolor', 'regular', 'private'].every(k => powerForMatchType(k).status === 'not_applicable') && powerForMatchType('zzz').status === 'unknown_type', '(4) フェス・レギュラー・プライベートは、パワー「対象外」（知らない値は「タイプ不明」のまま）');

{ const m = base({}, {}, null);
  check(resultOf(m).match_type === null && toRecord(m).match_type === null, '(5) 読めていないマッチタイプは、そのまま「不明」');
  m.review.rmarks.match_type = 'wrong'; m.review.fix.match_type = 'fest_challenge';
  check(resultOf(m).match_type === 'fest_challenge', '(6) 直したマッチタイプが、結果（resultOf）に使われる');
  check(toRecord(m).match_type === 'fest_challenge' && toRecord(m).rule === 'ナワバリバトル', '(7) AI 用の記録（record.match_type）にも使われる。ルール（ナワバリバトル）はそのまま', toRecord(m).match_type);
  check(powerOf(m).status === 'not_applicable', '(8) 直したマッチタイプに合わせて、パワーの扱いも変わる');
  const m2 = base({}, { match_type: 'fest_tricolor' }, 'other');
  check(resultOf(m2).match_type === 'fest_tricolor', '(9) 読めていた値（other）が誤りのときも、直した値が優先される');
  check(filterTrendMatches([m, m2, base({}, {}, 'x')], 'matchType=fest_challenge&rule=all').length === 1 && filterTrendMatches([m, m2], 'matchType=fest_tricolor&rule=all').length === 1, '(10) 傾向画面の絞り込みで、直したマッチタイプが使われる'); }

check(STAGES.includes('コンブトラック') && STAGES.includes('マンタマリア号') && STAGES.length === 25, '(11) ステージの選択肢が スプラ3 の 25 ステージ（マンタマリア号・コンブトラックを追加）', String(STAGES.length));

{ const mk = (id, mt, rule, extra = {}) => toRecord(base({ mode: rule }, {}, mt) && { ...base({ mode: rule }, {}, mt), id, ...extra });
  const recs = [mk('a', 'fest_challenge', 'ナワバリバトル'), mk('b', 'fest_challenge', 'ナワバリバトル'), mk('c', 'bankara_open', 'ガチエリア'), mk('d', null, 'ガチエリア')];
  const w = aggregate(recs, { now: Date.parse('2026-11-01T11:00:00Z') }).windows.last20, bm = Object.fromEntries(w.by_match_type.map(o => [o.name, o.n]));
  check(bm.fest_challenge === 2 && bm.bankara_open === 1 && bm['不明'] === 1, '(12) 要約に、マッチタイプ別の試合数（by_match_type）が載る', JSON.stringify(bm));
  check(w.match_tags && aggregate(recs).quality.notes.some(n => n.includes('トリカラ') && n.includes('実録画で確かめていない')), '(13) できないこと（トリカラ未確認・塗りポイント未読）が注意書きに載る'); }

console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
