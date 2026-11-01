// fest_rule_check.mjs: D108 フェスの結果画面を YOLO が「ガチホコ」などと読み違えたとき、試合中の「のこり」の読み取り（count_evidence）で、ナワバリに直す
// 数値は、手元の録画（2026-11-01 のフェスオープン 3 試合、2026-10-30 の本物のホコ 2 試合、2026-10-31 のエリア 1 試合）を解析して得た実測値
import { turfByEvidence, mergeYoloHeader, TURF_SEC, MIN_COUNT_SHARE } from '../src/core/yolo_header.js';
import { countEvidence } from '../src/core/analyzer.js';
import { powerForMatchType } from '../src/core/result.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const frac = (n, ok) => ({ n, ok, share: n ? Math.round(ok / n * 100) / 100 : 0 });
const ev = (t, a, h) => ({ tower: t, area: a, hoko: h });
const read = (rule, type = 'bankara_challenge', stage = 'オヒョウ海運') => [{ type, rule, stage, conf: { type: 0.89, rule: 0.85, stage: 0.94 } }];
const rec = (sec, e, extra = {}) => ({ battle: [100, 100 + sec], count_evidence: e, match_type: 'x', result_screen: { mode: null, stage: null, mode_unknown: true, mode_guess: 'ガチヤグラ' }, ...extra });

// 実測
const FEST = ev(frac(160, 0), frac(160, 0), frac(160, 0));      // フェスオープン（183 秒）
const HOKO = ev(frac(270, 54), frac(270, 0), frac(270, 46));     // 本物のホコ（303 秒）。読めた割合 17%
const HOKO2 = ev(frac(278, 88), frac(278, 2), frac(278, 109));   // 本物のホコ（317 秒）。39%
const AREA = ev(frac(228, 0), frac(228, 218), frac(228, 0));     // 本物のエリア（256 秒）。96%

check(turfByEvidence(rec(183, FEST), 'ガチホコバトル'), '(1) フェスオープン（183 秒・のこりが 3 種とも 0）をホコと読んだら、ナワバリと見なす');
check(!turfByEvidence(rec(303, HOKO), 'ガチホコバトル') && !turfByEvidence(rec(317, HOKO2), 'ガチホコバトル'), '(2) 本物のホコ（のこりが読めている）は、そのまま');
check(!turfByEvidence(rec(256, AREA), 'ガチエリア'), '(3) 本物のエリアも、そのまま');
check(!turfByEvidence(rec(300, FEST), 'ガチホコバトル') && !turfByEvidence(rec(120, FEST), 'ガチヤグラ'), '(4) のこりが読めなくても、時間がナワバリと違えば（延長・短い試合）直さない', `${TURF_SEC}`);
check(!turfByEvidence(rec(183, FEST), 'ガチアサリ') && !turfByEvidence(rec(183, FEST), 'ナワバリバトル'), '(5) アサリ（のこりを読んでいない）は対象外。ナワバリと読めていれば何もしない');
check(!turfByEvidence(rec(183, ev(frac(30, 0), frac(30, 0), frac(30, 0))), 'ガチホコバトル'), '(6) 読んだ行が少なすぎる（60 行未満）ときは決めない');
check(!turfByEvidence(rec(183, ev(frac(160, 0), frac(160, 0), frac(160, 9))), 'ガチホコバトル') && MIN_COUNT_SHARE === 0.05, '(7) どれかのルールで 5% 以上読めていれば、直さない（9/160=5.6%）');
check(!turfByEvidence({ battle: [0, 183] }, 'ガチホコバトル') && !turfByEvidence({ count_evidence: FEST }, 'ガチホコバトル'), '(8) 古い記録（count_evidence や battle が無い）は触らない');

{ const r = rec(183, FEST); const filled = mergeYoloHeader(r, read('ガチホコバトル'), powerForMatchType);
  check(r.result_screen.mode === 'ナワバリバトル' && r.result_screen.mode_source === 'count_evidence' && r.result_screen.mode_guess === undefined && filled.includes('mode'), '(9) 結果: ルールがナワバリバトルになり、由来が記録される');
  check(r.result_screen.yolo_disagree.mode.yolo === 'ガチホコバトル' && r.result_screen.yolo.rule === 'ガチホコバトル', '(10) YOLO の元の読み（ガチホコ）は記録に残る');
  check(r.match_type === null && r.power.status === 'unknown_type' && r.result_screen.yolo_disagree.match_type.template === 'x', '(11) 当てにならない x（や bankara_*）は外し、マッチタイプは人が選ぶ');
  check(r.result_screen.stage === 'オヒョウ海運', '(12) ステージは読み取りのまま使う'); }
{ const r = rec(183, FEST, { match_type: 'fest_open' }); mergeYoloHeader(r, read('ガチホコバトル', 'bankara_open'), powerForMatchType);
  check(r.match_type === 'fest_open' && r.result_screen.mode === 'ナワバリバトル', '(13) すでにフェスと分かっているマッチタイプは消さない'); }
{ const r = rec(303, HOKO, { match_type: null }); mergeYoloHeader(r, read('ガチホコバトル', 'bankara_challenge'), powerForMatchType);
  check(r.result_screen.mode === 'ガチホコバトル' && r.match_type === 'bankara_challenge', '(14) 本物のホコは、これまでどおり YOLO のルールとマッチタイプが入る'); }
{ const r = rec(183, FEST, { result_screen: { mode: 'ガチヤグラ', stage: 'クサヤ温泉' } }); mergeYoloHeader(r, read('ガチホコバトル'), powerForMatchType);
  check(r.result_screen.mode === 'ガチヤグラ', '(15) テンプレートで読めているルールは、この判定で書き換えない'); }
{ const e = countEvidence({ tower: [{ grid: true, own: 5, enemy: 6 }, { grid: true, own: null, enemy: 6 }, { grid: false, own: 1, enemy: 1 }], area: [{ own: 50, enemy: 40 }], hoko: [] });
  check(e.tower.n === 2 && e.tower.ok === 1 && e.tower.share === 0.5 && e.area.share === 1 && e.hoko.n === 0 && e.hoko.share === 0, '(16) countEvidence: ヤグラは毎秒の行（grid）だけ数え、両チーム読めた行を数える', JSON.stringify(e)); }

console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
