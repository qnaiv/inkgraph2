// cloud_ui_check.mjs: D58 クラウド同期パネル（未ログイン）と、スマホ幅の閲覧表示・閲覧用の試合（実ブラウザ。Supabase にはつながない）。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path'; import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'), SH = path.resolve(WEB, '../docs/screenshots/cloud-sync'); fs.mkdirSync(SH, { recursive: true });
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mk = (id, i, extra = {}) => ({ id, match: i, created: new Date(2026, 9, 20, 12, i).toISOString(), updated: new Date(2026, 9, 20, 12, i).toISOString(), battle: [0, 140], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: i % 2 ? 'WIN' : 'LOSE', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { ka: 7, deaths: 3, specials: 2 } }, own_deaths: [{ start: 10, end: 12 }, { start: 50, end: 52 }, { start: 90, end: 92 }], special: [{ ready: 20, end: 28, outcome: 'activated', activated_at: 28 }, { ready: 60, end: 66, outcome: 'activated', activated_at: 66 }],
  own_kills: [{ start: 30, end: 31.8 }, { start: 70, end: 71.8 }], squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 140 }, confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 },
  review: { marks: {}, added: [], fix: {} }, favorite: false, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' }, ...extra });
const PORT = process.env.PORT || '4234', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { for (const m of r) await window.inkgraph.db.putMatch(m, { keepUpdated: true }); }, [mk('own#1', 1), mk('own#2', 2), mk('cloud#3', 3, { remote: true })]);
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.waitForTimeout(500);
  check(new URL(page.url()).hash === '#list', '(1) スマホ幅では、ライブ分析ではなく試合一覧が開く', page.url());
  await page.waitForSelector('#cloud-panel .learn-panel-title');
  const panel = await page.textContent('#cloud-panel'); check(/未ログイン/.test(panel) && /Google でログイン/.test(panel) && /メールでログイン/.test(panel) && /数値と時刻だけ/.test(panel), '(2) 未ログインのパネル：Google／メールでログインと、「数値と時刻だけ」の説明');
  check(!(await page.isVisible('.sidenav a[data-page="live"]')) && await page.isVisible('.sidenav a[data-page="list"]'), '(3) スマホ幅ではメニューの「ライブ分析」が隠れる');
  const rows = await page.$$eval('.match-row', els => els.map(e => e.dataset.id)); check(rows[0] === 'cloud#3' && rows.length === 3, '(4) 一覧は新しい順（最新が一番上）', rows.join(','));
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(over <= 1, '(5) スマホ幅でページ全体が横にはみ出さない（一覧）', `はみ出し ${over}px`);
  await page.screenshot({ path: path.join(SH, '01_mobile_list.png'), fullPage: false });
  await page.click('.match-row[data-id="cloud#3"]'); await page.waitForSelector('#hdr-d');
  check((await page.isVisible('#remote-note')) && !(await page.$('#review-toggle')), '(6) クラウドから取り込んだ試合：閲覧のみの案内が出て、レビューモードの切り替えは無い');
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(over2 <= 1, '(7) スマホ幅でページ全体が横にはみ出さない（詳細）', `はみ出し ${over2}px`);
  await page.screenshot({ path: path.join(SH, '02_mobile_detail.png'), fullPage: false });
  await page.goto(`http://127.0.0.1:${PORT}/#match/${encodeURIComponent('own#1')}`); await page.waitForSelector('#hdr-d');
  check(!!(await page.$('#review-toggle')) && !(await page.$('#remote-note')), '(8) 自分で記録した試合は、今までどおり確認の修正ができる');
  await page.goto(`http://127.0.0.1:${PORT}/#trend`); await page.waitForTimeout(800);
  const over3 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(over3 <= 1, '(9) スマホ幅でページ全体が横にはみ出さない（傾向分析）', `はみ出し ${over3}px`);
  await page.screenshot({ path: path.join(SH, '03_mobile_trend.png'), fullPage: false });
  const d = await browser.newPage({ viewport: { width: 1280, height: 900 } }); await d.goto(`http://127.0.0.1:${PORT}/#live`); await d.waitForTimeout(800);
  check(await d.isVisible('.sidenav a[data-page="live"]') && new URL(d.url()).hash === '#live', '(10) PC 幅では今までどおりライブ分析が最初に開く');
  check(errs.length === 0, '(11) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
