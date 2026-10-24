// D48: 結果画面敵ブキアイコン照合のテスト
// 使い方: node tools/enemy_icon_check.mjs
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { BI, AMBIG, boardIconGray, encodeIcon, decodeIcon, iconSim, iconSimSlow, iconSimSym, iconSimSymSlow, matchIcon, prepEnemyIconLib } from '../src/core/board_icons.js';
import { enemyPresenceRows } from '../src/analysis.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
let testCount = 0;
const pass = name => { testCount++; console.log(`✓ [${testCount}] ${name}`); };

// -------------------------------------------------------------
// 1. iconSim の基本（同じ画像=1.0 付近、平坦=0）
// -------------------------------------------------------------
{
  const flat = new Uint8Array(BI.w * BI.h).fill(128);
  assert.equal(iconSim(flat, flat), 0, '平坦な画像どうしの iconSim は 0');
  assert.equal(iconSimSym(flat, flat), 0, '平坦な画像どうしの iconSimSym は 0');

  const patA = new Uint8Array(BI.w * BI.h);
  for (let i = 0; i < patA.length; i++) patA[i] = (i * 37 + 13) % 256;
  const simSelf = iconSim(patA, patA);
  assert(Math.abs(simSelf - 1.0) < 1e-4, `同じ画像で 1.0 付近 (got ${simSelf})`);
  assert(Math.abs(iconSimSym(patA, patA) - 1.0) < 1e-4, 'iconSimSym も 1.0 付近');

  // 平坦画像とパターン画像
  assert.equal(iconSim(flat, patA), 0, '平坦 template は 0');
  assert.equal(iconSim(patA, flat), 0, '平坦 target は 0');
  assert.equal(iconSimSym(flat, patA), 0, 'iconSimSym with flat は 0');

  // encodeIcon / decodeIcon の可逆性
  const b64 = encodeIcon(patA);
  assert.deepEqual(decodeIcon(b64), patA, 'encodeIcon / decodeIcon のラウンドトリップ');

  pass('iconSim の基本（同一画像 1.0 付近、平坦 0、encode/decode 可逆性）');
}

// -------------------------------------------------------------
// 2. labels の 12 試合で試合ごとに外す照合：取り違え 0 を必須、正しい ≥ 8 を必須
// -------------------------------------------------------------
const truthPath = path.join(root, 'labels', 'enemy_icon', 'board_icon_truth.json');
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
const matchNames = Object.keys(truth.matches);
const icons = {};

for (const v of matchNames) {
  const pngPath = path.join(root, 'labels', 'enemy_icon', 'boards', `${v}.png`);
  assert(fs.existsSync(pngPath), `素材画像が存在すること: ${pngPath}`);
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  assert.equal(r.status, 0, `ffmpeg 正常終了: ${v}`);
  const fr = { w: 1280, h: 720, data: new Uint8Array(1280 * 720 * 4) };
  const pw = 90, ph = 430, ox = 680, oy = 250;
  for (let y = 0; y < ph; y++) fr.data.set(r.stdout.subarray(y * pw * 4, (y + 1) * pw * 4), ((oy + y) * 1280 + ox) * 4);
  for (const grp of ['top', 'bot']) {
    for (let i = 0; i < 4; i++) icons[`${v}_${grp}${i}`] = boardIconGray(fr, 0, 0, grp, i);
  }
}

// -------------------------------------------------------------
// 2. labels 12 試合 96 枠の全組（96x96=9216 組）で新旧 iconSimSym の一致確認
//    - 「0.93 以上かどうか」が全組一致すること
//    - 旧実装で 0.6 以上の組で新旧の値の差が 1e-6 未満であること
// -------------------------------------------------------------
{
  const iconList = Object.entries(icons).map(([id, g]) => ({ id, g }));
  assert.equal(iconList.length, 96, '12 試合 x 8 枠 = 96 枠');
  let ge06Count = 0;
  for (let i = 0; i < iconList.length; i++) {
    for (let j = 0; j < iconList.length; j++) {
      const slow = iconSimSymSlow(iconList[i].g, iconList[j].g);
      const fast = iconSimSym(iconList[i].g, iconList[j].g);
      assert.equal(fast >= 0.93, slow >= 0.93, `0.93 判定一致: ${iconList[i].id} vs ${iconList[j].id}`);
      if (slow >= 0.6) {
        ge06Count++;
        assert(Math.abs(fast - slow) < 1e-6, `0.6 以上の組で新旧差 < 1e-6 (slow=${slow}, fast=${fast})`);
      }
    }
  }
  pass(`labels 12 試合 96 枠の全 9216 組照合: 0.93 判定全組一致、旧 0.6 以上の ${ge06Count} 組で差 < 1e-6`);
}

const labeledSlots = [];
for (const [v, m] of Object.entries(truth.matches)) {
  for (const [slot, name] of Object.entries(m.slots)) {
    if (name) labeledSlots.push({ name, video: v, slot, g: icons[`${v}_${slot}`] });
  }
}
assert.equal(labeledSlots.length, 23, '正解で名前が付いた枠は 23 件');

{
  let ok = 0, wrong = 0, unk = 0;
  const bad = [];
  for (const item of labeledSlots) {
    const looLib = labeledSlots.filter(x => x.video !== item.video);
    const res = matchIcon(looLib, item.g);
    if (res.name === item.name) {
      ok++;
    } else if (res.name !== null) {
      wrong++;
      bad.push({ slot: `${item.video}_${item.slot}`, truth: item.name, pred: res.name, score: res.score });
    } else {
      unk++;
    }
  }

  assert.equal(wrong, 0, `試合ごとに外す照合で取り違え 0 であること (got ${wrong})`);
  assert(ok >= 8, `試合ごとに外す照合で正しい >= 8 であること (got ${ok})`);
  pass(`labels 12 試合の LOO 照合（正しい ${ok} >= 8, 取り違え ${wrong} === 0, 不明 ${unk}）`);
}

// -------------------------------------------------------------
// 3. 全見本（自分の試合も含む）で名前付き枠を当てると全部正しい（4K の組は ambiguous で OK）
// -------------------------------------------------------------
{
  const allLib = labeledSlots.map(x => ({ name: x.name, g: x.g }));
  const ambigNames = new Set(AMBIG.flat());

  for (const item of labeledSlots) {
    const res = matchIcon(allLib, item.g);
    if (ambigNames.has(item.name)) {
      assert.equal(res.name, null, `${item.name} は曖昧判定で name=null`);
      assert(res.ambiguous && res.ambiguous.includes(item.name), `${item.name} は ambiguous に含まれる`);
    } else {
      assert.equal(res.name, item.name, `${item.name} が完全に一致すること`);
    }
  }
  pass(`全見本照合: 名前付き枠 ${labeledSlots.length} 件がすべて正解（4K の組は ambiguous で OK）`);
}

// -------------------------------------------------------------
// 4. enemyPresenceRows の合成データ
// -------------------------------------------------------------
{
  // テスト用のアイコン画像
  const makeIcon = seed => {
    const a = new Uint8Array(BI.w * BI.h);
    for (let i = 0; i < a.length; i++) a[i] = (i * seed + seed * 17) % 256;
    return a;
  };

  const iconA = makeIcon(41);
  const iconB = makeIcon(79);
  const iconX = makeIcon(113); // 見本に無いアイコン

  const testLib = [
    { name: 'スプラシューター', g: iconA },
    { name: 'ダイナモローラー', g: iconB }
  ];

  // 4.1 3 試合（WIN, LOSE, WIN）に同じ見本アイコンが 1 回ずつ → matches 3・wins 2・winRate 2/3
  const m1 = { result_screen: { result: 'WIN' }, enemy_icons: [{ slot: 'top0', icon: encodeIcon(iconA) }] };
  const m2 = { result_screen: { result: 'LOSE' }, enemy_icons: [{ slot: 'top0', icon: encodeIcon(iconA) }] };
  const m3 = { result_screen: { result: 'WIN' }, enemy_icons: [{ slot: 'top0', icon: encodeIcon(iconA) }] };

  const res1 = enemyPresenceRows([m1, m2, m3], testLib);
  assert.equal(res1.nMatches, 3, 'nMatches は 3');
  assert.equal(res1.withIcons, 3, 'withIcons は 3');
  assert.equal(res1.rows.length, 1, 'ブキは 1 種類');
  assert.equal(res1.rows[0].name, 'スプラシューター');
  assert.equal(res1.rows[0].kind, 'main');
  assert.equal(res1.rows[0].matches, 3, 'matches は 3');
  assert.equal(res1.rows[0].wins, 2, 'wins は 2');
  assert.equal(res1.rows[0].losses, 1, 'losses は 1');
  assert(Math.abs(res1.rows[0].winRate - 2 / 3) < 1e-6, 'winRate は 2/3');
  assert.equal(res1.rows[0].low, true, '3試合なので low=true');
  assert(Math.abs(res1.overallWinRate - 2 / 3) < 1e-6, 'overallWinRate は 2/3');
  pass('合成データ 4.1: 3 試合 (WIN, LOSE, WIN) に同じアイコン → matches 3, wins 2, winRate 2/3');

  // 4.2 同じ試合に同名 2 枠 → 1 試合
  const mDouble = {
    result_screen: { result: 'WIN' },
    enemy_icons: [
      { slot: 'top0', icon: encodeIcon(iconA) },
      { slot: 'top1', icon: encodeIcon(iconA) }
    ]
  };
  const res2 = enemyPresenceRows([mDouble], testLib);
  assert.equal(res2.nMatches, 1);
  assert.equal(res2.withIcons, 1);
  assert.equal(res2.totalSlots, 2);
  assert.equal(res2.namedSlots, 2);
  assert.equal(res2.rows.length, 1);
  assert.equal(res2.rows[0].matches, 1, '同名 2 枠でも 1 試合と数える');
  assert.equal(res2.rows[0].wins, 1);
  pass('合成データ 4.2: 同じ試合に同名 2 枠 → matches 1');

  // 4.3 見本に無い同じアイコンが 2 試合 → 「未登録のアイコンA」matches 2
  const mUnk1 = { result_screen: { result: 'WIN' }, enemy_icons: [{ slot: 'top0', icon: encodeIcon(iconX) }] };
  const mUnk2 = { result_screen: { result: 'LOSE' }, enemy_icons: [{ slot: 'top0', icon: encodeIcon(iconX) }] };
  const res3 = enemyPresenceRows([mUnk1, mUnk2], testLib);
  assert.equal(res3.rows.length, 1);
  assert.equal(res3.rows[0].name, '未登録のアイコンA', '見本に無いアイコンは 未登録のアイコンA');
  assert.equal(res3.rows[0].kind, 'unknown');
  assert.equal(res3.rows[0].matches, 2);
  assert.equal(res3.rows[0].wins, 1);
  assert.equal(res3.rows[0].losses, 1);
  pass('合成データ 4.3: 見本に無い同じアイコンが 2 試合 → 未登録のアイコンA matches 2');

  // 4.4 enemy_icons の無い試合は withIcons に入らない
  const mNoIcons1 = { result_screen: { result: 'WIN' }, enemy_icons: [] };
  const mNoIcons2 = { result_screen: { result: 'WIN' } };
  const res4 = enemyPresenceRows([m1, mNoIcons1, mNoIcons2], testLib);
  assert.equal(res4.nMatches, 3, 'WIN の試合は 3');
  assert.equal(res4.withIcons, 1, 'enemy_icons がある試合は 1 のみ');
  pass('合成データ 4.4: enemy_icons の無い試合は withIcons に入らない');
}

// -------------------------------------------------------------
// 5. enemyPresenceRows の合成 200 試合性能テスト (< 3000 ms)
// -------------------------------------------------------------
{
  const libPath = path.join(root, 'templates', 'enemy_icon_lib.json');
  const libData = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  const L = prepEnemyIconLib(libData, decodeIcon);

  const ms = [];
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 200; k++) {
    ms.push({
      id: 'm' + k,
      result_screen: { result: k % 2 ? 'WIN' : 'LOSE' },
      enemy_icons: [0, 1, 2, 3].map(i => {
        const src = libData.lib[Math.floor(rnd() * libData.lib.length)];
        const g = decodeIcon(src.g).slice();
        if (i >= 2) for (let p = 0; p < g.length; p++) g[p] = Math.floor(rnd() * 255) * (rnd() < 0.3);
        return { slot: 'top' + i, icon: encodeIcon(g) };
      })
    });
  }

  const t0 = performance.now();
  const r = enemyPresenceRows(ms, L);
  const elapsed = Math.round(performance.now() - t0);
  console.log(`  (実測: ${elapsed} ms, rows: ${r.rows.length}, namedSlots: ${r.namedSlots})`);
  assert(elapsed < 3000, `enemyPresenceRows 合成 200 試合が 3000 ms 未満であること (got ${elapsed} ms)`);
  pass(`合成 200 試合の性能: ${elapsed} ms < 3000 ms (namedSlots: ${r.namedSlots})`);
}

console.log(`\nenemy_icon_check: ${testCount} 項目 ALL PASS`);
process.exit(0);
