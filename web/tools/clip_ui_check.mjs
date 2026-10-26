// clip_ui_check.mjs: D62 確認画面。録画ファイルを選ぶ入力が無いこと、場面クリップが 5fps（0.2 秒ごと）・コマ送り・速度・「見逃しを追加」が見ているコマの時刻に付くこと（実ブラウザ）。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import { CLIP } from '../src/clips.js';
import path from 'node:path'; import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'), SH = path.resolve(WEB, '../docs/screenshots/clip-fps'); fs.mkdirSync(SH, { recursive: true });
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
check(CLIP.STEP === 0.2 && Math.round(1 / CLIP.STEP) === 5 && CLIP.MAX_BYTES >= 12 * 1024 * 1024, '(1) クリップは 5fps（0.2 秒ごと）、1 試合の上限 12MiB 以上', JSON.stringify({ step: CLIP.STEP, max: CLIP.MAX_BYTES }));
const PORT = process.env.PORT || '4236', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForFunction(() => window.inkgraph && window.inkgraph.db);
  const N = 21, T0 = 50; // 死んだ場面（50 秒）の前後 2 秒＝21 コマ
  await page.evaluate(async ({ N, T0 }) => {
    const db = window.inkgraph.db, id = 'clip#1';
    await db.putMatch({ id, match: 1, created: new Date(2026, 9, 20, 12, 0).toISOString(), battle: [0, 140], squid_down: {}, own_deaths: [{ start: T0, end: T0 + 3 }], own_kills: [], special: [], hud_hidden: [], map_open: [], stats: { duration: 140 },
      result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { ka: 0, deaths: 1, specials: 0 } }, confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 },
      review: { marks: {}, added: [], fix: {} }, favorite: false, stillsState: 'kept', stills: { count: 0, bytes: 0 }, video: { kind: 'none' } });
    for (let i = 0; i < N; i++) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 15},70%,50%)`; x.fillRect(0, 0, 64, 36);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg'));
      await db.putSnap({ matchId: id, t: +(T0 - 2 + i * 0.2).toFixed(1), reason: '場面クリップ', kind: 'clip', header: null, event: null, blob, features: null, clip: { idx: 0, frame: i, n: N, t: T0, from: T0 - 2, to: T0 + 2, kind: 'death', kinds: ['death'], events: [{ kind: 'death', t: T0 }] } });
    }
  }, { N, T0 });
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#match/${encodeURIComponent('clip#1')}`); await page.waitForSelector('#review-toggle'); await page.check('#review-toggle', { force: true }); await page.waitForSelector('#clip-play');
  check((await page.$('#vf')) === null && (await page.$('#rv')) === null && !(await page.textContent('#review-panel')).includes('録画ファイルを選ぶ'), '(2) 確認画面に「録画ファイルを選ぶ」・動画の要素が無い');
  check((await page.textContent('.clip-box-title')).includes('5fps'), '(3) クリップの見出しが 5fps', await page.textContent('.clip-box-title'));
  const idx = async () => parseInt((await page.textContent('#clip-stat')).split('/')[0], 10);
  await page.click('#clip-next'); await page.click('#clip-next'); check((await idx()) === 3, '(4) ▶（コマ送り）で 1 コマずつ進む', String(await idx()));
  await page.click('#clip-prev'); check((await idx()) === 2, '(5) ◀ で 1 コマ戻る');
  await page.screenshot({ path: path.join(SH, '01_clip_controls.png') });
  // 等倍で再生：1 秒で約 5 コマ進む
  await page.click('.clip-chip'); await page.waitForTimeout(80); const a0 = await idx(); await page.waitForTimeout(1000); const a1 = await idx(); const adv = a1 - a0;
  check(adv >= 4 && adv <= 6, '(6) 等倍の再生は 1 秒に約 5 コマ（0.2 秒ごと）', `${adv} コマ`);
  await page.click('#clip-play'); // 一時停止
  await page.selectOption('#clip-speed', '0.25'); await page.click('.clip-chip'); await page.waitForTimeout(80); const b0 = await idx(); await page.waitForTimeout(2000); const b1 = await idx(); const advSlow = b1 - b0;
  check(advSlow >= 1 && advSlow <= 3, '(7) 1/4 速では 2 秒に約 2.5 コマ', `${advSlow} コマ`);
  await page.click('#clip-play'); await page.selectOption('#clip-speed', '1');
  // 見逃しの追加は、いま見ているコマの時刻（コマ 11 ＝ 50.0 秒）
  await page.fill('#clip-seek', '10'); await page.dispatchEvent('#clip-seek', 'input'); check((await idx()) === 11, '(8) スライダーでコマを選べる', String(await idx()));
  await page.click('button.add[data-k="kill"]'); await page.waitForTimeout(300);
  const added = await page.evaluate(async () => (await window.inkgraph.db.getMatch('clip#1')).review.added);
  check(added.length === 1 && added[0].kind === 'kill' && Math.abs(added[0].t - 50.0) < 0.05, '(9) 「見逃しを追加」は、見ているコマの時刻（50.0 秒）に付く', JSON.stringify(added));
  check(errs.length === 0, '(10) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
