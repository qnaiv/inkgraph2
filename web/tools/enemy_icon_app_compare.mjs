// D48: killer_app_check.mjs でアプリ本体に動画を流した結果（rec.enemy_icons）を、正解（labels/enemy_icon/board_icon_truth.json）と見本照合で比べる
// 使い方: node tools/enemy_icon_app_compare.mjs [test-results/killer_app_matches.json]
import fs from 'node:fs'; import path from 'node:path';
import { matchIcon, decodeIcon, iconSimSym } from '../src/core/board_icons.js';
const ROOT = path.resolve(import.meta.dirname, '../..');
const src = process.argv[2] || path.join(ROOT, 'web/test-results/killer_app_matches.json');
const got = JSON.parse(fs.readFileSync(src, 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'labels/enemy_icon/board_icon_truth.json'), 'utf8')).matches;
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/enemy_icon_lib.json'), 'utf8')).lib.map(e => ({ ...e, g: decodeIcon(e.g) }));
let saved = 0, slots = 0, slotOk = 0, full = { ok: 0, wrong: 0, unk: 0 }, loo = { ok: 0, wrong: 0, unk: 0 }, named = 0; const bad = [];
for (const [v, tm] of Object.entries(truth)) {
  const m = (got[v] || [])[0]; if (!m) { console.log(v, '試合なし'); continue; }
  const ei = m.enemy_icons || []; if (ei.length) saved++;
  const slotsGot = ei.map(e => e.slot).join(',');
  if (slotsGot !== [0, 1, 2, 3].map(i => tm.enemy_group + i).join(',')) console.log(v, '敵枠の並びが違う', slotsGot, '正解', tm.enemy_group);
  for (const e of ei) {
    slots++; const g = decodeIcon(e.icon); const t = tm.slots[e.slot];
    const rf = matchIcon(lib, g), rl = matchIcon(lib.filter(x => x.video !== v), g);
    const self = lib.find(x => x.video === v && x.slot === e.slot); if (self) { const s = iconSimSym(self.g, g); if (s >= 0.93) slotOk++; else bad.push(`${v} ${e.slot} オフライン見本との類似 ${s.toFixed(3)}`); }
    if (rf.name || rl.name || t) named++;
    for (const [acc, r] of [[full, rf], [loo, rl]]) if (t) { if (r.name === t) acc.ok++; else if (r.name) { acc.wrong++; bad.push(`${v} ${e.slot} 正解 ${t} → ${r.name}`); } else acc.unk++; }
  }
}
console.log(`enemy_icons を保存した試合 ${saved}/${Object.keys(truth).length}、敵枠 ${slots}`);
console.log(`名前付き枠がオフラインの見本と同じ絵（0.93 以上）: ${slotOk}/${lib.length}`);
console.log(`見本すべてで照合（名前付き枠）: 正しい ${full.ok}・取り違え ${full.wrong}・不明 ${full.unk}`);
console.log(`その試合を外して照合: 正しい ${loo.ok}・取り違え ${loo.wrong}・不明 ${loo.unk}`);
bad.forEach(b => console.log('  ', b));
