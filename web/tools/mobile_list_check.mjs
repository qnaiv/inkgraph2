// mobile_list_check.mjs: スマホ幅（390px）の試合一覧のレイアウト（実ブラウザ）。行が重ならず、はみ出さず、中身が全部読めること。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path'; import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'), SH = path.resolve(WEB, '../docs/screenshots/mobile-layout'); fs.mkdirSync(SH, { recursive: true });
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mk = (i, extra = {}) => ({ id: `ml#${i}`, match: i, created: new Date(2026, 9, 26, 12, i).toISOString(), updated: new Date(2026, 9, 26, 12, i).toISOString(), battle: [0, 140], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: i % 2 ? 'WIN' : 'LOSE', mode: 'ガチヤグラ', stage: i % 3 ? 'タラポートショッピングパーク' : 'ナメロウ金属', own: { ka: 12, deaths: 5, specials: 5 } },
  own_deaths: [{ start: 10, end: 12 }, { start: 50, end: 52 }, { start: 90, end: 92 }, { start: 100, end: 102 }], special: [1, 2, 3, 4, 5].map(k => ({ ready: k * 20, end: k * 20 + 5, outcome: 'activated', activated_at: k * 20 + 5 })), own_kills: [{ start: 30, end: 31.8 }, { start: 70, end: 71.8 }],
  squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 140 }, confidence: { celebration_frames: 5, personal_frames: i % 2 ? 5 : 0, board_frames: 0 }, review: { marks: {}, added: [], fix: {} },
  favorite: i === 1, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' }, recon: i === 2 ? { applied: [{ kind: 'death', action: 'added', t: 40 }], summary: {} } : undefined, remote: true, ...extra });
const PORT = process.env.PORT || '4237', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { for (const m of r) await window.inkgraph.db.putMatch(m, { keepUpdated: true }); }, [1, 2, 3, 4, 5, 6].map(i => mk(i)));
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.waitForSelector('.match-row');
  const boxes = await page.$$eval('.match-row', els => els.map(e => { const r = e.getBoundingClientRect(); const kids = [...e.children].filter(c => c.getBoundingClientRect().width > 0).map(c => { const b = c.getBoundingClientRect(); return { cls: c.className.split(' ')[0], l: b.left, r: b.right, t: b.top, b: b.bottom }; }); return { t: r.top, b: r.bottom, l: r.left, r: r.right, h: r.height, kids }; }));
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  check(boxes.every((b, i) => i === 0 || b.t >= boxes[i - 1].b - 0.5), '(1) 行どうしが重ならない（上の行の下から次の行が始まる）');
  check(boxes.every(b => b.l >= -0.5 && b.r <= vw + 0.5), '(2) 行が画面の幅からはみ出さない', `vw=${vw}`);
  check(boxes.every(b => b.kids.every(k => k.l >= b.l - 0.5 && k.r <= b.r + 0.5 && k.b <= b.b + 0.5 && k.t >= b.t - 0.5)), '(3) 行の中身が、行の枠の外に出ない');
  const overlap = boxes.every(b => { const ks = b.kids; for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const a = ks[i], c = ks[j]; if (a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1) return false; } return true; });
  check(overlap, '(4) 行の中の各ブロック（結果・ルール・キル/デス・確認の進み・メニュー）が互いに重ならない');
  check(boxes.every(b => b.h >= 80 && b.h <= 260), '(5) 行の高さが、中身に合わせて伸びている（72px 固定のままではない）', boxes.map(b => Math.round(b.h)).join(','));
  const labels = await page.$$eval('.match-row:first-child .kda-label', els => els.map(e => ({ t: e.textContent, w: e.getBoundingClientRect().width, sw: e.scrollWidth })));
  check(labels.length === 3 && labels.every(l => l.sw <= Math.ceil(l.w) + 1), '(6) 「キル」「デス」「スペシャル発動」の見出しが縦書きにつぶれない', JSON.stringify(labels));
  await page.locator('.match-list').scrollIntoViewIfNeeded(); await page.evaluate(() => document.querySelector('.match-list').scrollIntoView()); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SH, '01_mobile_list.png') });
  check(await page.$$eval('.match-row.is-remote', els => els.every(e => ['.stills-state', '.export-state', '.match-row-col-prog'].every(q => { const n = e.querySelector(q); return !n || getComputedStyle(n).display === 'none'; }))), '(7) 閲覧用の試合では、静止画・書き出し・確認の進みを出さない');
  check(errs.length === 0, '(8) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
