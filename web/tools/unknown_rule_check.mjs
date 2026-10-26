// unknown_rule_check.mjs: D55 見本に無いルール（ガチアサリなど）を別ルールと読み違えない歯止め（Node のみ）
import { acceptMode, stageDxCandidates, MODE_MIN_SCORE, finalizeResult } from '../src/core/result.js';
import { isTowerRule } from '../src/core/analyzer.js';
let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };

// D43 の実測：正解クラス 0.83〜1.0（マージン最小 0.15）、別ルールの見本を当てると 0.61〜0.72
check(acceptMode('ガチヤグラ', 0.83, 0.15) && acceptMode('ガチホコバトル', 1.0, null), '(1) 正解クラスの実測値（0.83〜1.0）は採用する');
check(!acceptMode('ガチホコバトル', 0.72, 0.2) && !acceptMode('ガチヤグラ', 0.61, 0.3), '(2) 別ルールの見本に当てた値（0.61〜0.72）は、マージンが十分あっても採用しない（見本に無いルール）');
check(!acceptMode('ガチヤグラ', 0.9, 0.05), '(3) 2位との差が小さいものは従来どおり採用しない');
check(!acceptMode(null, 0.9, null) && !acceptMode('ガチヤグラ', 0.75, null), '(4) 見本なし・下限ちょうどは採用しない', `MODE_MIN_SCORE=${MODE_MIN_SCORE}`);
check(!acceptMode('ガチヤグラ', 0.6, 0.3, 0.5) && acceptMode('ガチヤグラ', 0.8, 0.3, 0.3), '(5) 自己学習で閾値を下げても下限は効く（0.8 は採用、0.6 は不採用）');
check(!isTowerRule(null) && !isTowerRule('ガチアサリ'), '(6) ルール不明・ガチアサリではヤグラ用の処理を使わない');
check(JSON.stringify(stageDxCandidates('ガチホコバトル')) === '[38]' && JSON.stringify(stageDxCandidates('ガチヤグラ')) === '[0]' && JSON.stringify(stageDxCandidates('ガチエリア')) === '[0]', '(7) 実測済みルールのステージ位置は従来のまま');
check(JSON.stringify(stageDxCandidates('ガチアサリ')) === '[0,19,38]' && JSON.stringify(stageDxCandidates(null)) === '[0,19,38]', '(8) ガチアサリ・ルール不明は 0/19/38 を試す');
{
  const rs = finalizeResult({ celebration: [{ t: 1, value: 'WIN' }], personal: [1, 2, 3, 4, 5].map(i => ({ t: i, header: { mode: null, mode_guess: 'ガチホコバトル', mode_score: 0.7, stage: null, stage_score: 0.2, match_type: null }, personal: { ka: 5, deaths: 3, specials: 1 } })), board: [] });
  check(rs.mode === null && rs.mode_guess === 'ガチホコバトル' && rs.own.deaths === 3, '(9) ルールが読めなくても最良の見本（mode_guess）と個人成績は残る', JSON.stringify([rs.mode, rs.mode_guess]));
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
