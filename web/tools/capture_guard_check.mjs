import { CaptureGuard, CAPTURE_GAP_SEC } from '../src/capture_guard.js';

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// 1. 通常の試合（0.2秒間隔でフレーム、裏に回らない）→ matchEnd().save===true
{
  const g = new CaptureGuard();
  let t = 1000;
  g.battleStart(t);
  let allNull = true;
  for (let i = 0; i < 20; i++) {
    t += 200;
    const r = g.frame(t);
    if (r !== null) allNull = false;
  }
  check('Case 1: frames return null', allNull);
  const end = g.matchEnd();
  check('Case 1: normal match saves', end.save === true && end.interrupted === null);
}

// 2. 試合中に visibility(true) → 戻り値が {reason:'hidden'}、matchEnd().save===false
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  g.frame(1200);
  const mark = g.visibility(true, 1300);
  check('Case 2: visibility(true) marks hidden', mark && mark.reason === 'hidden' && mark.at === 1300 && mark.gapSec === 0);
  const end = g.matchEnd();
  check('Case 2: matchEnd save is false', end.save === false && end.interrupted && end.interrupted.reason === 'hidden');
}

// 3. 2 の後、visibility(false)・フレーム再開し、次の battleStart → 通常フレーム → matchEnd().save===true（次の試合は保存）
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  g.visibility(true, 1200);
  g.matchEnd(); // 前の試合終了（save === false）

  // visibility 復帰 & 次の試合
  g.visibility(false, 2000);
  g.battleStart(3000);
  g.frame(3200);
  g.frame(3400);
  const end = g.matchEnd();
  check('Case 3: next match after hidden recovers and saves', end.save === true && end.interrupted === null);
}

// 4. 試合中にフレーム間隔 3.5秒 → frame() が {reason:'stall', gapSec≈3.5}、save===false
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  g.frame(1200);
  const mark = g.frame(4700); // 3.5秒差
  check('Case 4: frame gap 3.5s marks stall',
    mark && mark.reason === 'stall' && Math.abs(mark.gapSec - 3.5) < 0.01,
    `gapSec=${mark?.gapSec}`
  );
  const end = g.matchEnd();
  check('Case 4: matchEnd save is false', end.save === false && end.interrupted.reason === 'stall');
}

// 5. 試合中にフレーム間隔 2.9秒（閾値未満）→ save===true
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  g.frame(1200);
  const mark = g.frame(4100); // 2.9秒差
  check('Case 5: frame gap 2.9s returns null', mark === null);
  const end = g.matchEnd();
  check('Case 5: matchEnd save is true', end.save === true);
}

// 6. tick() で最終フレームから 3.1秒経過 → stall で save===false
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  g.frame(1200);
  const mark = g.tick(4300); // 3.1秒経過
  check('Case 6: tick gap 3.1s marks stall',
    mark && mark.reason === 'stall' && Math.abs(mark.gapSec - 3.1) < 0.01,
    `gapSec=${mark?.gapSec}`
  );
  const end = g.matchEnd();
  check('Case 6: matchEnd save is false', end.save === false);
}

// 7. 試合外（battleStart 前、matchEnd 後）の hidden や長いギャップ → 次の試合に影響しない（save===true）
{
  const g = new CaptureGuard();
  check('Case 7: hidden before match ignored', g.visibility(true, 500) === null);
  check('Case 7: frame before match ignored', g.frame(1000) === null);
  check('Case 7: frame gap before match ignored', g.frame(5000) === null);
  check('Case 7: tick before match ignored', g.tick(9000) === null);

  g.battleStart(10000);
  g.frame(10200);
  const end1 = g.matchEnd();
  check('Case 7: match 1 saves', end1.save === true);

  check('Case 7: hidden after match ignored', g.visibility(true, 11000) === null);
  check('Case 7: frame after match ignored', g.frame(12000) === null);
  check('Case 7: long tick after match ignored', g.tick(20000) === null);

  g.battleStart(21000);
  g.frame(21200);
  const end2 = g.matchEnd();
  check('Case 7: match 2 saves', end2.save === true);
}

// 8. battleDiscard 後は interrupted がリセットされる
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  g.visibility(true, 1200);
  check('Case 8: guard is interrupted in match', g.interrupted !== null);
  g.battleDiscard();
  check('Case 8: after discard inMatch is false and interrupted is null', g.inMatch === false && g.interrupted === null);

  g.battleStart(2000);
  g.frame(2200);
  const end = g.matchEnd();
  check('Case 8: next match saves', end.save === true);
}

// 9. mark は1回だけ（2回目の visibility(true) は null を返す）
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  const mark1 = g.visibility(true, 1200);
  check('Case 9: first mark returns object', mark1 && mark1.reason === 'hidden');
  const mark2 = g.visibility(true, 1300);
  check('Case 9: second visibility returns null', mark2 === null);
  const mark3 = g.frame(5000);
  check('Case 9: frame stall after hidden returns null (mark is once)', mark3 === null);
  check('Case 9: reason kept as first mark (hidden)', g.interrupted.reason === 'hidden');

  // stall 時の gapSec 更新確認: 最初に stall が起きて、後からより大きい gapSec になった場合
  const g2 = new CaptureGuard();
  g2.battleStart(1000);
  const s1 = g2.frame(4100); // gap 3.1
  check('Case 9b: initial stall mark', s1 && s1.reason === 'stall' && Math.abs(s1.gapSec - 3.1) < 0.01);
  const s2 = g2.tick(6000); // gap 1.9 from 4100 (not larger)
  check('Case 9b: smaller gap does not return new mark', s2 === null);
  const s3 = g2.frame(9000); // gap 4.9 from 4100
  check('Case 9b: larger gap returns null but updates gapSec', s3 === null && Math.abs(g2.interrupted.gapSec - 4.9) < 0.01);
}

// 10. リザルト画面読み取り中（battle_end 後〜matchEnd 前）の hidden も save===false
{
  const g = new CaptureGuard();
  g.battleStart(1000);
  g.frame(1200);
  // battle_end イベント相当（Guard は battle_end で inMatch を解除しない）
  g.frame(1400); // リザルト画面のフレーム
  const mark = g.visibility(true, 1500); // リザルト中に裏に回る
  check('Case 10: hidden during result reading marks hidden', mark && mark.reason === 'hidden');
  const end = g.matchEnd();
  check('Case 10: save is false', end.save === false);
}

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
