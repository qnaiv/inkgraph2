// count_check_check.mjs: D77 検出した数と結果画面の数の突き合わせ（補正はしない）
import { countCheck, compareCounts, detectedCounts, mismatchText } from '../src/count_check.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mk = (o = {}) => ({ own_deaths: [{}, {}, {}], own_kills: [{}, {}], special: [{ outcome: 'activated' }, { outcome: 'lost_on_death' }], result_screen: { own: { ka: 5, deaths: 3, specials: 1 } }, confidence: { personal_frames: 10, board_frames: 5 }, ...o });
const r1 = mk(); const c1 = countCheck(r1);
check(JSON.stringify(detectedCounts(r1)) === '{"deaths":3,"specials":1,"kills":2}', '(1) 検出した数: スペシャルは「発動」だけ数える（使う前にやられたは数えない）');
check(c1.trusted && c1.mismatch.length === 0, '(2) 全部一致（キルは K+A 未満でも一致扱い＝アシストの分）', JSON.stringify(c1.mismatch));
const c2 = countCheck(mk({ own_deaths: [{}, {}, {}, {}] })); check(c2.mismatch.join() === 'death', '(3) デスが多い → デスの不一致', c2.mismatch.join());
const c3 = countCheck(mk({ own_deaths: [{}, {}] })); check(c3.mismatch.join() === 'death', '(4) デスが少ない → デスの不一致');
const c4 = countCheck(mk({ special: [] })); check(c4.mismatch.join() === 'special', '(5) スペシャルが少ない → スペシャルの不一致');
const c5 = countCheck(mk({ own_kills: [{}, {}, {}, {}, {}, {}] })); check(c5.mismatch.join() === 'kill', '(6) キルが K+A を超えたときだけキルの不一致');
const c6 = countCheck(mk({ confidence: { personal_frames: 1, board_frames: 0 } })); check(!c6.trusted && c6.mismatch.length === 0, '(7) 結果画面を読めたコマが少ないときは信用しない（不一致にしない）');
const c7 = countCheck(mk({ result_screen: { own: { ka: null, deaths: null, specials: 1 } } })); check(!c7.trusted && c7.mismatch.length === 0, '(8) デス・スペシャルのどちらかが読めていないときは信用しない');
const c8 = countCheck(mk({ result_screen: {} })); check(!c8.trusted && c8.result === null, '(9) 結果画面が読めていないとき');
check(compareCounts({ kills: 3, deaths: 2, specials: 1 }, { ka: 2, deaths: 2, specials: 0 }).join() === 'special,kill', '(10) ライブの暫定値でも使える（compareCounts）');
const c9 = countCheck(mk({ own_deaths: [{}], special: [] })); check(mismatchText(c9) === 'デス 検出 1／リザルト 3、スペシャル 検出 0／リザルト 1', '(11) 不一致の説明', mismatchText(c9));
process.exit(fails ? 1 : 0);
