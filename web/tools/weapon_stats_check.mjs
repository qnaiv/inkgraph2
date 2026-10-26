// weapon_stats_check.mjs: D65 敵・味方・自分のブキ別「いた試合の勝率」と、未登録アイコンに名前を付ける流れ（純関数＋実ブラウザ）。
import { enemyPresenceRows, unknownIconGroups } from '../src/analysis.js';
import { encodeIcon } from '../src/core/board_icons.js';
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path'; import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'), SH = path.resolve(WEB, '../docs/screenshots/weapon-stats'); fs.mkdirSync(SH, { recursive: true });
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
// 絵（56x34 のグレー）：シードごとに別のノイズ。同じシードなら同じ絵（類似度 1.0）、別シードなら無相関
const pic = seed => { let x = seed * 2654435761 >>> 0; const g = new Uint8Array(56 * 34); for (let i = 0; i < g.length; i++) { x = (x * 1664525 + 1013904223) >>> 0; g[i] = 40 + ((x >>> 24) % 180); } return g; };
const ico = seed => encodeIcon(pic(seed));
const lib = { lib: [{ name: 'テストX', g: pic(1) }, { name: 'テストY', g: pic(2) }, { name: 'テストZ', g: pic(3) }] };
const res = ['LOSE', 'LOSE', 'WIN', 'WIN', 'WIN', 'LOSE'];
const mkm = (i, enemy, ally, own) => ({ id: `w#${i}`, match: i, created: new Date(2026, 9, 26, 12, i).toISOString(), updated: new Date(2026, 9, 26, 12, i).toISOString(), battle: [0, 140], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: res[i - 1], mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { ka: 5, deaths: 3, specials: 2 } }, own_deaths: [], special: [], own_kills: [], squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 140 }, confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 1 },
  review: { marks: {}, added: [], fix: {} }, favorite: false, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' },
  enemy_icons: enemy.map((s, k) => ({ slot: `top${k}`, icon: ico(s) })), ally_icons: [...ally.map((s, k) => ({ slot: `bot${k}`, icon: ico(s) })), { slot: 'bot3', icon: ico(own), own: true }] });
// 敵：X が m1〜m3（2 敗 1 勝）。未登録の絵 99 が m2・m4、絵 98 が m5。味方：Y が m1・m2・m3。自分：Z が全試合。
const ms = [mkm(1, [1, 11, 12, 13], [2, 21, 22], 3), mkm(2, [1, 99, 12, 13], [2, 21, 22], 3), mkm(3, [1, 14, 15, 16], [2, 21, 22], 3), mkm(4, [99, 17, 18, 19], [31, 32, 33], 3), mkm(5, [98, 17, 18, 19], [31, 32, 33], 3), mkm(6, [41, 42, 43, 44], [31, 32, 33], 3)];
{
  const e = enemyPresenceRows(ms, lib), x = e.rows.find(r => r.name === 'テストX');
  check(x && x.matches === 3 && x.wins === 1 && x.losses === 2 && Math.abs(x.winRate - 1 / 3) < 1e-9, '(1) 敵：テストX がいた 3 試合は 1 勝 2 敗', JSON.stringify(x));
  check(x && Math.abs(x.delta - (1 / 3 - 0.5)) < 1e-9 && x.low === true, '(2) 全体の勝率（50%）との差は −17pt、3 試合なので「少数」', x && x.delta);
  const a = enemyPresenceRows(ms, lib, { field: 'ally_icons', pick: it => !it.own }), y = a.rows.find(r => r.name === 'テストY');
  check(y && y.matches === 3 && y.losses === 2 && !a.rows.some(r => r.name === 'テストZ'), '(3) 味方：自分を除く。テストY がいた 3 試合は 1 勝 2 敗で、自分のブキ（Z）は入らない');
  const o = enemyPresenceRows(ms, lib, { field: 'ally_icons', pick: it => !!it.own }), z = o.rows.find(r => r.name === 'テストZ');
  check(z && z.matches === 6 && z.wins === 3 && z.losses === 3 && o.rows.length === 1, '(4) 自分：テストZ を使った 6 試合は 3 勝 3 敗');
  const old = ms.map(m => { const c = { ...m }; delete c.ally_icons; return c; });
  check(enemyPresenceRows(old, lib, { field: 'ally_icons' }).withIcons === 0 && enemyPresenceRows(old, lib).withIcons === 6, '(5) 味方のアイコンを保存する前の試合は、味方の集計に入らず、敵の集計は今までどおり');
  const g = unknownIconGroups(ms, lib);
  const g99 = g.find(x => x.rep === ico(99));
  check(g99 && g99.slots === 2 && g99.matches === 2 && g99.side.enemy === 2 && g.every((x, i) => i === 0 || g[i - 1].slots >= x.slots), '(6) 未登録のアイコンは、同じ絵どうしにまとめる（99 は 2 枠・2 試合）。枠の多い順', JSON.stringify(g99 && [g99.slots, g99.matches]));
  check(!g.some(x => x.rep === ico(1)), '(7) 名前が付いた絵（テストX）は未登録の一覧に出ない');
}
console.log('--- 実ブラウザ ---');
const PORT = process.env.PORT || '4239', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForFunction(() => window.inkgraph && window.inkgraph.db);
  // 静的な見本に無い絵（シード 1000 番台）を使う
  const ms2 = [1, 2, 3, 4, 5, 6].map(i => mkm(i, [1001, 1011 + i, 1012 + i, 1013 + i], [1002, 1021, 1022], 1003));
  await page.evaluate(async r => { localStorage.removeItem('inkgraph.weaponLib'); for (const m of r) await window.inkgraph.db.putMatch(m, { keepUpdated: true }); }, ms2);
  await page.goto(`http://127.0.0.1:${PORT}/#trend`); await page.reload(); await page.waitForSelector('#weapon-naming', { state: 'visible' });
  const t0 = await page.textContent('#weapon-naming');
  check(/未登録のブキアイコンに名前を付ける/.test(t0) && (await page.$$('.weapon-naming-row')).length >= 1, '(8) 傾向分析に「未登録のブキアイコンに名前を付ける」が出る', t0.slice(0, 60));
  check((await page.$$eval('.weapon-icon-canvas', cs => cs.every(c => c.width === 112 && c.getContext('2d').getImageData(10, 10, 1, 1).data[3] === 255))), '(9) アイコンの絵が描かれる');
  const first = await page.$eval('.weapon-naming-row', r => r.querySelector('.weapon-icon-canvas').dataset.icon.length > 100 && r.textContent);
  await page.screenshot({ path: path.join(SH, '01_naming.png'), fullPage: false });
  await page.fill('.weapon-naming-row:first-child .weapon-name-input', 'わかばシューター'); await page.click('.weapon-naming-row:first-child .weapon-name-save'); await page.waitForTimeout(800);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('inkgraph.weaponLib')));
  check(stored && stored.items.length === 1 && stored.items[0].name === 'わかばシューター', '(10) 名前を付けると、この端末の見本に登録される', JSON.stringify(stored && stored.items.map(i => i.name)));
  const tables = await page.$$eval('.trend-presence-card', cs => cs.map(c => ({ title: c.querySelector('.card-title').textContent, rows: [...c.querySelectorAll('tbody tr')].map(r => r.cells[0].textContent) })));
  const allNames = tables.flatMap(t => t.rows);
  check(allNames.includes('わかばシューター') && tables.length === 3, '(11) 登録した名前が、いた敵ブキ／味方ブキの表に出る（過去の試合にも反映）。表は 敵・味方・自分 の 3 つ', JSON.stringify(tables.map(t => t.title)));
  await page.screenshot({ path: path.join(SH, '02_tables.png'), fullPage: false });
  check(errs.length === 0, '(12) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
