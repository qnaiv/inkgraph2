// board_guard_check.mjs: D69 ボードの読み違い対策（個人成績の画面を「ボード」にしない／絵の無いアイコンを名前付けの候補に出さない）
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
import { prepAssets } from '../src/core/assets.js';
import * as R from '../src/core/result.js';
import { boardIconGray, encodeIcon, iconDetail, iconHasDetail } from '../src/core/board_icons.js';
import { unknownIconGroups } from '../src/analysis.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const root = path.resolve(import.meta.dirname, '../..'), web = path.resolve(import.meta.dirname, '..');
const dec = f => { const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 }); return r.stdout; };
const A = prepAssets(JSON.parse(fs.readFileSync(path.join(web, 'public/assets/inkgraph_assets.json'), 'utf8')));
// (1) 個人成績の画面（実フレーム）を無理にボードとして読むと、数が読めない → 捨てる
const fr = { w: 1280, h: 720, data: new Uint8ClampedArray(dec(path.join(web, 'tools/fixtures/asari_x_result_720p.jpg'))) };
const c = R.classify(A, fr), rows = R.readBoard(A, fr, ...c.off);
check(c.kind === 'personal', '(1) 実フレームは個人成績と分類される');
check(!R.boardReadable(rows), '(2) 個人成績の画面をボードとして読んでも「読めたボード」にならない（数が読めない）', rows.filter(r => r.ka !== null).length + ' 行');
check(R.boardReadable(Array.from({ length: 8 }, () => ({ ka: 3, deaths: 2, specials: 1 }))) && !R.boardReadable(Array.from({ length: 8 }, (_, i) => i < 5 ? { ka: 1, deaths: 1, specials: 0 } : { ka: null, deaths: null, specials: null })), '(3) 8 行のうち 6 行以上で 3 つの数が読めれば本物のボード');
// (4) 絵のあるアイコン（ラベル付きの実測）と、絵の無いアイコン
const truth = JSON.parse(fs.readFileSync(path.join(root, 'labels/enemy_icon/board_icon_truth.json'), 'utf8')); let min = 1e9, n = 0;
for (const v of Object.keys(truth.matches)) {
  const raw = dec(path.join(root, 'labels/enemy_icon/boards', v + '.png')), f = { w: 1280, h: 720, data: new Uint8Array(1280 * 720 * 4) };
  for (let y = 0; y < 430; y++) f.data.set(raw.subarray(y * 90 * 4, (y + 1) * 90 * 4), ((250 + y) * 1280 + 680) * 4);
  for (const g of ['top', 'bot']) for (let i = 0; i < 4; i++) { const d = iconDetail(boardIconGray(f, 0, 0, g, i)); min = Math.min(min, d); n++; }
}
check(n >= 90 && min >= 0.05, '(4) 実測のブキのアイコン ' + n + ' 枠は、すべて輪郭の割合が 5% 以上', 'min=' + (min * 100).toFixed(1) + '%');
const flat = new Uint8Array(56 * 34).fill(62), grad = new Uint8Array(56 * 34).map((_, i) => Math.max(40, 200 - (i % 56) * 3 - Math.floor(i / 56) * 2));
check(!iconHasDetail(flat) && !iconHasDetail(grad), '(5) 無地・なだらかな色むらは「絵なし」', iconDetail(flat) + ' / ' + iconDetail(grad));
const personalIcons = rows.map(r => r.icon);

// (7) 名前付けの候補から、絵の無いアイコンは出ない
const withIcon = encodeIcon(boardIconGray((() => { const raw = dec(path.join(root, 'labels/enemy_icon/boards', Object.keys(truth.matches)[0] + '.png')), f = { w: 1280, h: 720, data: new Uint8Array(1280 * 720 * 4) }; for (let y = 0; y < 430; y++) f.data.set(raw.subarray(y * 90 * 4, (y + 1) * 90 * 4), ((250 + y) * 1280 + 680) * 4); return f; })(), 0, 0, 'top', 0));
const groups = unknownIconGroups([{ id: 'm1', enemy_icons: [{ slot: 'top0', icon: withIcon }, { slot: 'top1', icon: encodeIcon(flat) }, { slot: 'top2', icon: encodeIcon(grad) }], ally_icons: [] }], []);
check(groups.length === 1 && groups[0].slots === 1, '(7) 名前付けの候補には、絵のあるアイコンだけが出る（無地・色むらは出ない）', groups.length + ' 種類');
process.exit(fails ? 1 : 0);
