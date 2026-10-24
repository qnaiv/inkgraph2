// D48: 結果画面ボードの敵ブキアイコン見本を作る／精度を測る
// 使い方: node tools/enemy_icon_lib_build.mjs [--out <path>] [--eval]
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { boardIconGray, encodeIcon, matchIcon } from '../src/core/board_icons.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };

const truthPath = path.join(root, 'labels', 'enemy_icon', 'board_icon_truth.json');
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
const matchNames = Object.keys(truth.matches);

const icons = {};
for (const v of matchNames) {
  const pngPath = path.join(root, 'labels', 'enemy_icon', 'boards', `${v}.png`);
  if (!fs.existsSync(pngPath)) { console.error(`画像が無い: ${pngPath}`); process.exit(1); }
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  if (r.error || r.status !== 0) { console.error(`ffmpeg 失敗: ${pngPath}`); process.exit(1); }
  const fr = { w: 1280, h: 720, data: new Uint8Array(1280 * 720 * 4) };
  const pw = 90, ph = 430, ox = 680, oy = 250;
  for (let y = 0; y < ph; y++) {
    fr.data.set(r.stdout.subarray(y * pw * 4, (y + 1) * pw * 4), ((oy + y) * 1280 + ox) * 4);
  }
  for (const grp of ['top', 'bot']) {
    for (let i = 0; i < 4; i++) {
      icons[`${v}_${grp}${i}`] = boardIconGray(fr, 0, 0, grp, i);
    }
  }
}

// 見本: 正解で名前が付いた敵枠
const labeled = [];
for (const [v, m] of Object.entries(truth.matches)) {
  for (const [slot, name] of Object.entries(m.slots)) {
    if (name) labeled.push({ name, video: v, slot, g: icons[`${v}_${slot}`] });
  }
}

const outPath = arg('--out') || path.join(root, 'templates', 'enemy_icon_lib.json');
const libData = {
  note: 'D48 結果画面ボードの敵ブキアイコン見本（labels/enemy_icon/board_icon_truth.json から web/tools/enemy_icon_lib_build.mjs で生成）',
  lib: labeled.map(e => ({ name: e.name, video: e.video, slot: e.slot, g: encodeIcon(e.g) }))
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(libData, null, 1) + '\n');
console.log(`wrote ${outPath} (${libData.lib.length} 件)`);

if (process.argv.includes('--eval')) {
  let ok = 0, wrong = 0, unk = 0;
  const bad = [];
  for (const item of labeled) {
    const looLib = labeled.filter(x => x.video !== item.video);
    const res = matchIcon(looLib, item.g);
    if (res.name === item.name) {
      ok++;
    } else if (res.name !== null) {
      wrong++;
      bad.push({ slot: `${item.video}_${item.slot}`, truth: item.name, pred: res.name, score: res.score, ambiguous: res.ambiguous });
    } else {
      unk++;
      if (res.ambiguous) {
        // ambiguous 含む
      }
    }
  }

  let namedCount = 0;
  for (const [v, m] of Object.entries(truth.matches)) {
    const eg = m.enemy_group;
    const looLib = labeled.filter(x => x.video !== v);
    for (let i = 0; i < 4; i++) {
      const slot = `${eg}${i}`;
      const truthName = m.slots[slot];
      const res = matchIcon(looLib, icons[`${v}_${slot}`]);
      const finalName = truthName || res.name;
      if (finalName) namedCount++;
    }
  }

  console.log(`試合ごとに外す照合 (名前付き枠 ${labeled.length} 件): 正しい ${ok}・取り違え ${wrong}・不明 ${unk} (ambiguous 含む)`);
  console.log(`全 48 敵枠で名前が付く枠数: ${namedCount}/48`);
  if (bad.length > 0) {
    console.log('取り違え一覧:');
    bad.forEach(b => console.log(`  ${b.slot}: 正解=${b.truth}, 予測=${b.pred}, score=${b.score}`));
  } else {
    console.log('取り違え: 0 件');
  }
}
