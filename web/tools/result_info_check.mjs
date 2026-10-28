// result_info_check.mjs: D74 結果画面を読めた分から、勝敗・ルール・ステージ・成績の暫定値（result_info）を出す。実フレーム（個人成績の画面）で確認。
import fs from 'node:fs'; import path from 'node:path';
import { prepAssets } from '../src/core/assets.js';
import { Analyzer } from '../src/core/analyzer.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const web = path.resolve(import.meta.dirname, '..');
const A = prepAssets(JSON.parse(fs.readFileSync(path.join(web, 'public/assets/inkgraph_assets.json'), 'utf8')));
const hdr = (mode, stage) => ({ mode, mode_guess: null, mode_score: 0.9, stage, stage_score: 0.9, match_type: 'x', match_type_score: 0.9 });
const ev = []; const an = new Analyzer(A, { srcH: 720, onMatch: () => {}, onEvent: e => ev.push(e) });
an.newBattle(0); an.state = 'result'; const m = an.cur;
// 勝敗 → ルール・ステージ → 個人成績 と、結果画面を読めるものが増えていく
m.RS.celebration.push({ t: 100, value: 'WIN' }); m.RS.celebration.push({ t: 100.2, value: 'WIN' }); an.emitResultInfo(100.2);
an.emitResultInfo(100.4); // 同じ内容は出さない
m.RS.personal.push({ t: 103, header: hdr('ガチエリア', 'ヒラメが丘団地'), personal: null }); an.emitResultInfo(103);
m.RS.personal.push({ t: 103.2, header: hdr('ガチエリア', 'ヒラメが丘団地'), personal: { ka: 5, deaths: 2, specials: 1 } }); an.emitResultInfo(103.2);
const infos = ev.filter(e => e.type === 'result_info');
check(infos.length === 3, '(1) 値が増えたときだけ result_info が出る（勝敗 → ルール・ステージ → 成績。同じ内容は重ねない）', infos.length + ' 件');
check(infos[0].result === 'WIN' && !infos[0].mode, '(2) 最初は勝敗だけ', JSON.stringify(infos[0]));
check(infos[1].mode === 'ガチエリア' && infos[1].stage === 'ヒラメが丘団地' && infos[1].match_type === 'x', '(3) 次にルール・ステージ・マッチ種別', JSON.stringify(infos[1]));
check(infos[2].own && infos[2].own.ka === 5 && infos[2].own.deaths === 2 && infos[2].own.specials === 1 && infos[2].result === 'WIN', '(4) 最後に個人成績（K+A・デス・スペシャル）', JSON.stringify(infos[2].own));
// ルールが読めないとき（見本に無いルール）は mode を出さず、近い見本は mode_guess に分けて出す（ライブ画面には誤ったルールを出さない）
const ev2 = []; const an2 = new Analyzer(A, { srcH: 720, onMatch: () => {}, onEvent: e => ev2.push(e) }); an2.newBattle(0); an2.state = 'result';
an2.cur.RS.personal.push({ t: 1, header: { mode: null, mode_guess: 'ガチホコバトル', mode_score: 0.6, stage: 'オヒョウ海運', stage_score: 0.9, match_type: 'x', match_type_score: 0.9 }, personal: null }); an2.emitResultInfo(1);
const i2 = ev2.find(e => e.type === 'result_info'); check(i2 && i2.mode === null && i2.mode_guess === 'ガチホコバトル' && i2.stage === 'オヒョウ海運', '(5) ルールが読めないときは mode を null にし、近い見本は mode_guess に分ける', JSON.stringify(i2));
process.exit(fails ? 1 : 0);
