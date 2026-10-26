import assert from 'node:assert/strict';
import { enemyWeaponRows, key } from '../src/analysis.js';
import { encodeFeat, KP } from '../src/core/killer.js';
import { attachKillers } from '../src/core/analyzer.js';

// 特徴ベクトルの作成ヘルパー
function makeSig(dominantIdx = 0, len = KP.fh * KP.fw) {
  const f = new Float32Array(len);
  f[dominantIdx] = 1.0;
  return encodeFeat(f);
}

function makeMatch({ id = 'm1', result = 'WIN', deaths = [], review = { marks: {} } }) {
  return {
    id,
    battle: [10, 310],
    squid_down: {},
    result_screen: { result },
    own_deaths: deaths,
    review
  };
}

// -------------------------------------------------------------
// Test 1: matches が配列でない場合
// -------------------------------------------------------------
{
  const res1 = enemyWeaponRows(null);
  assert.deepEqual(res1, {
    rows: [],
    totalDeaths: 0,
    readDeaths: 0,
    unreadDeaths: 0,
    nMatches: 0,
    overallWinRate: null
  });
  const res2 = enemyWeaponRows({});
  assert.deepEqual(res2, {
    rows: [],
    totalDeaths: 0,
    readDeaths: 0,
    unreadDeaths: 0,
    nMatches: 0,
    overallWinRate: null
  });
}

// -------------------------------------------------------------
// Test 2: 名前ありの集計（勝敗・回数・試合数） + 1 試合に同じブキで 2 回やられても試合数は 1
// -------------------------------------------------------------
{
  // 試合1: WIN。スシコラに1回、シャプマに2回デス。
  // 試合2: LOSE。スシコラに1回デス。
  const m1 = makeMatch({
    id: 'm1',
    result: 'WIN',
    deaths: [
      { start: 20, end: 25, killed_by: { name: 'スプラシューターコラボ', kind: 'main', score: 0.95 } },
      { start: 50, end: 55, killed_by: { name: 'シャープマーカー', kind: 'main', score: 0.9 } },
      { start: 80, end: 85, killed_by: { name: 'シャープマーカー', kind: 'main', score: 0.9 } }
    ]
  });
  const m2 = makeMatch({
    id: 'm2',
    result: 'LOSE',
    deaths: [
      { start: 30, end: 35, killed_by: { name: 'スプラシューターコラボ', kind: 'main', score: 0.95 } }
    ]
  });

  const res = enemyWeaponRows([m1, m2]);
  assert.equal(res.nMatches, 2);
  assert.equal(res.totalDeaths, 4);
  assert.equal(res.readDeaths, 4);
  assert.equal(res.unreadDeaths, 0);
  assert.equal(res.overallWinRate, 0.5); // 1勝1敗

  // rows の並び: シャプマ (killed 2, matches 1), スシコラ (killed 2, matches 2)
  // killed が同じ(2)なら matches 降順なので スシコラ(2) が シャプマ(1) より先
  assert.equal(res.rows.length, 2);

  const sushi = res.rows.find(r => r.name === 'スプラシューターコラボ');
  assert.ok(sushi);
  assert.equal(sushi.kind, 'main');
  assert.equal(sushi.matches, 2);
  assert.equal(sushi.wins, 1);
  assert.equal(sushi.losses, 1);
  assert.equal(sushi.winRate, 0.5);
  assert.equal(sushi.killed, 2);
  assert.equal(sushi.low, true);

  const sharp = res.rows.find(r => r.name === 'シャープマーカー');
  assert.ok(sharp);
  assert.equal(sharp.kind, 'main');
  assert.equal(sharp.matches, 1); // 1試合で2回やられても試合数は1
  assert.equal(sharp.wins, 1);
  assert.equal(sharp.losses, 0);
  assert.equal(sharp.winRate, 1.0);
  assert.equal(sharp.killed, 2); // 回数は2
  assert.equal(sharp.low, true);
}

// -------------------------------------------------------------
// Test 3: ✗（review.marks で 'wrong'）にしたデスは除外
//         killed_by が無いデスは unreadDeaths に数える
// -------------------------------------------------------------
{
  const dStartWrong = 40.5;
  const dWrongKey = key('death', dStartWrong);
  assert.equal(dWrongKey, 'death@40.5');

  const m = makeMatch({
    id: 'm1',
    result: 'WIN',
    deaths: [
      { start: 20, end: 25, killed_by: { name: 'リッター4K', kind: 'main' } },
      // wrong にするデス
      { start: dStartWrong, end: 45.5, killed_by: { name: 'ハイドラント', kind: 'main' } },
      // killed_by が無いデス
      { start: 60, end: 65 }
    ],
    review: {
      marks: {
        [dWrongKey]: 'wrong'
      }
    }
  });

  const res = enemyWeaponRows([m]);
  assert.equal(res.totalDeaths, 2); // 3件中1件はwrongで除外されるのでeffectiveは2件
  assert.equal(res.readDeaths, 1);
  assert.equal(res.unreadDeaths, 1);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].name, 'リッター4K');
  assert.equal(res.rows[0].killed, 1);
}

// -------------------------------------------------------------
// Test 4: 未登録の sig が似ていれば同じグループ・違えば別グループ
// -------------------------------------------------------------
{
  const sigA1 = makeSig(0);
  const sigA2 = makeSig(0); // 同一特徴
  const sigB = makeSig(10); // 別特徴 (内積 0.0)

  // ar: KP.ar_tol = 0.18
  // ar=5.0 vs ar=5.2 -> |log(5.2/5.0)| = 0.039 <= 0.18 (合致)
  // ar=5.0 vs ar=7.0 -> |log(7.0/5.0)| = 0.336 > 0.18 (ar違いで別グループ)
  const m = makeMatch({
    id: 'm1',
    result: 'LOSE',
    deaths: [
      // 1つ目: 新規グループ「未登録のブキA」
      { start: 10, end: 15, killed_by: { name: null, kind: null, sig: sigA1, ar: 5.0 } },
      // 2つ目: sigAと同一特徴、arも近い -> 「未登録のブキA」に合流
      { start: 20, end: 25, killed_by: { name: null, kind: null, sig: sigA2, ar: 5.2 } },
      // 3つ目: sigB（特徴が異なる）-> 新規グループ「未登録のブキB」
      { start: 30, end: 35, killed_by: { name: null, kind: null, sig: sigB, ar: 5.0 } },
      // 4つ目: sigAと同じ特徴だが、arが離れている -> 新規グループ「未登録のブキC」
      { start: 40, end: 45, killed_by: { name: null, kind: null, sig: sigA1, ar: 7.0 } }
    ]
  });

  const res = enemyWeaponRows([m]);
  assert.equal(res.totalDeaths, 4);
  assert.equal(res.readDeaths, 4);
  assert.equal(res.rows.length, 3);

  const groupA = res.rows.find(r => r.name === '未登録のブキA');
  assert.ok(groupA);
  assert.equal(groupA.kind, 'unknown');
  assert.equal(groupA.killed, 2);
  assert.equal(groupA.matches, 1);
  assert.equal(groupA.wins, 0);
  assert.equal(groupA.losses, 1);
  assert.equal(groupA.winRate, 0.0);

  const groupB = res.rows.find(r => r.name === '未登録のブキB');
  assert.ok(groupB);
  assert.equal(groupB.kind, 'unknown');
  assert.equal(groupB.killed, 1);

  const groupC = res.rows.find(r => r.name === '未登録のブキC');
  assert.ok(groupC);
  assert.equal(groupC.kind, 'unknown');
  assert.equal(groupC.killed, 1);
}

// -------------------------------------------------------------
// Test 5: low フラグ（matches < 5 なら true）
// -------------------------------------------------------------
{
  const ms = [1, 2, 3, 4, 5].map(i => makeMatch({
    id: `m${i}`,
    result: 'WIN',
    deaths: [
      { start: 10, end: 15, killed_by: { name: 'スプラシューター', kind: 'main' } }
    ]
  }));
  const res5 = enemyWeaponRows(ms);
  assert.equal(res5.rows[0].matches, 5);
  assert.equal(res5.rows[0].low, false);

  const res4 = enemyWeaponRows(ms.slice(0, 4));
  assert.equal(res4.rows[0].matches, 4);
  assert.equal(res4.rows[0].low, true);
}

// -------------------------------------------------------------
// Test 6: 並び順（killed 降順 → matches 降順 → name 昇順）
// -------------------------------------------------------------
{
  const m1 = makeMatch({
    id: 'm1',
    result: 'WIN',
    deaths: [
      { start: 10, end: 15, killed_by: { name: 'ブキD' } },
      { start: 20, end: 25, killed_by: { name: 'ブキD' } },
      { start: 30, end: 35, killed_by: { name: 'ブキD' } },
      { start: 40, end: 45, killed_by: { name: 'ブキD' } },
      { start: 50, end: 55, killed_by: { name: 'ブキC' } },
      { start: 60, end: 65, killed_by: { name: 'ブキA' } },
      { start: 70, end: 75, killed_by: { name: 'ブキB' } }
    ]
  });
  const m2 = makeMatch({
    id: 'm2',
    result: 'WIN',
    deaths: [
      { start: 10, end: 15, killed_by: { name: 'ブキC' } },
      { start: 20, end: 25, killed_by: { name: 'ブキA' } },
      { start: 30, end: 35, killed_by: { name: 'ブキA' } },
      { start: 40, end: 45, killed_by: { name: 'ブキB' } },
      { start: 50, end: 55, killed_by: { name: 'ブキB' } }
    ]
  });
  const m3 = makeMatch({
    id: 'm3',
    result: 'WIN',
    deaths: [
      { start: 10, end: 15, killed_by: { name: 'ブキC' } }
    ]
  });

  const res = enemyWeaponRows([m1, m2, m3]);
  const names = res.rows.map(r => r.name);
  assert.deepEqual(names, ['ブキD', 'ブキC', 'ブキA', 'ブキB']);
}

// -------------------------------------------------------------
// Test 7: 勝敗不明の試合は wins/losses に入らない
// -------------------------------------------------------------
{
  const m1 = makeMatch({
    id: 'm1',
    result: 'UNKNOWN',
    deaths: [
      { start: 10, end: 15, killed_by: { name: 'パブロ', kind: 'main' } }
    ]
  });
  const m2 = makeMatch({
    id: 'm2',
    result: null,
    deaths: [
      { start: 20, end: 25, killed_by: { name: 'パブロ', kind: 'main' } }
    ]
  });

  const res = enemyWeaponRows([m1, m2]);
  assert.equal(res.nMatches, 2);
  assert.equal(res.overallWinRate, null);
  assert.equal(res.rows.length, 1);
  const pablo = res.rows[0];
  assert.equal(pablo.matches, 2);
  assert.equal(pablo.wins, 0);
  assert.equal(pablo.losses, 0);
  assert.equal(pablo.winRate, null);
  assert.equal(pablo.killed, 2);
}

// -------------------------------------------------------------
// Test 8: 手で追加したデス（src が無いデス）は読めなかった扱い
// -------------------------------------------------------------
{
  const m = {
    id: 'm1',
    battle: [10, 310],
    squid_down: {},
    result_screen: { result: 'WIN' },
    own_deaths: [],
    review: {
      marks: {},
      added: [
        { kind: 'death', t: 50 }
      ]
    }
  };
  const res = enemyWeaponRows([m]);
  assert.equal(res.totalDeaths, 1);
  assert.equal(res.readDeaths, 0);
  assert.equal(res.unreadDeaths, 1);
  assert.equal(res.rows.length, 0);
}

// -------------------------------------------------------------
// attachKillers: 1 回のデスでデス検知が 2 回出ても、読み取りをまとめて名前の読めたものを採る（23-23-22_match02 292.2 の実例）
// -------------------------------------------------------------
{
  const deaths = [{ start: 292, end: 296 }, { start: 313, end: 319 }];
  attachKillers(deaths, [
    { t0: 290.2, reads: [{ name: null, score: 0, yar: 0.9, ar: 2.4, f: new Float32Array(KP.fh * KP.fw) }] },
    { t0: 292, reads: [{ name: 'ダイナモローラー', kind: 'main', score: 0.91, yar: 0.8 }] },
    { t0: 330, reads: [{ name: 'ホクサイ', kind: 'main', score: 0.95, yar: 0.8 }] } // どのデスからも 3 秒より遠い
  ]);
  assert.equal(deaths[0].killed_by.name, 'ダイナモローラー');
  assert.equal(deaths[0].killed_by.frames, 2);
  assert.equal(deaths[1].killed_by, undefined);
}

console.log('enemy_weapon_check: OK');
