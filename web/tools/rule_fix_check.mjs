// rule_fix_check.mjs: ルールを、確認画面で選んで訂正する（選択肢・直した値が結果／AI 用の記録／ステージの見本登録に使われる）
import { RULE_NAMES, resultOf } from '../src/analysis.js';
import { toRecord } from '../src/ai_export.js';
import { addFromMatch, loadLib } from '../src/stage_lib.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mem = () => { const o = {}; return { getItem: k => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); } }; };
const base = (rs, fix) => ({
  id: 'r1', squid_down: {}, created: '2026-10-31T10:00:00Z', battle: [1000, 1180], own_deaths: [], own_kills: [], special: [],
  result_screen: { result: 'WIN', stage: 'ナメロウ金属', own: { ka: 3, deaths: 1, specials: 1 }, ...rs }, match_type: 'bankara_open',
  stage_feats: [{ 0: 'AAAA', 38: 'BBBB' }], review: { marks: {}, rmarks: {}, fix: fix || {}, added: [] }
});

check(RULE_NAMES.join() === 'ガチエリア,ガチヤグラ,ガチホコバトル,ガチアサリ,ナワバリバトル', '(1) 選択肢は スプラ3 の 5 ルール', RULE_NAMES.join());

{ const m = base({ mode: undefined });
  check(resultOf(m).mode === undefined, '(2) 読めていないルールは、そのまま「読めず」');
  m.review.rmarks.mode = 'wrong'; m.review.fix.mode = 'ガチヤグラ';
  check(resultOf(m).mode === 'ガチヤグラ', '(3) 直したルールが、結果（resultOf）に使われる');
  check(toRecord(m).rule === 'ガチヤグラ', '(4) AI 用の記録（record.rule）にも、直したルールが使われる', toRecord(m).rule);
  const m2 = base({ mode: 'ガチエリア' }, { mode: 'ガチホコバトル' });
  check(resultOf(m2).mode === 'ガチホコバトル' && toRecord(m2).rule === 'ガチホコバトル', '(5) 読めていたルールが誤りのときも、直した値が優先される'); }

{ // ステージの見本登録: ルール不明なら登録できず、ルールを直せば登録できる
  const st = mem(), m = base({ mode: undefined });
  const before = addFromMatch('ナメロウ金属', m, resultOf(m).mode, st);
  check(!before.ok && before.reason === 'no-mode', '(6) ルール不明のままだと、ステージの見本にできない', before.reason);
  m.review.fix.mode = 'ガチホコバトル';
  const after = addFromMatch('ナメロウ金属', m, resultOf(m).mode, st);
  check(after.ok && loadLib(st).items[0].feat === 'BBBB', '(7) ルールを直すと、そのルールの位置（ホコは +38）で見本になる', JSON.stringify(after)); }

console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
