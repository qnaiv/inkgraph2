// suspect_ui_check.mjs: b04 確認画面で、怪しい検出に❗が付き、前後にジャンプでき、✓ を付けると外れる（実ブラウザ）。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const WEB = path.resolve(import.meta.dirname, '..');
const m = { id: 'su#1', match: 1, created: new Date(2026, 9, 31, 12, 0).toISOString(), updated: new Date(2026, 9, 31, 12, 0).toISOString(), battle: [0, 140], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'ナメロウ金属', own: { ka: 1, deaths: 3, specials: 0 } },
  own_deaths: [{ start: 10, end: 12, src: 'signal', conf: 0.9 }, { start: 50, end: 52, src: 'signal', conf: 0.2 }, { start: 90, end: 92, src: 'signal_soft', conf: 0.8, auto: 'fused' }], special: [], own_kills: [], squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 140 },
  confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 }, review: { marks: {}, rmarks: {}, added: [], fix: {} }, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' } };
const PORT = process.env.PORT || '4241', srv = process.env.NO_SERVER ? { kill() {} } : startPreview(PORT, WEB); await new Promise(r => setTimeout(r, process.env.NO_SERVER ? 0 : 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { await window.inkgraph.db.putMatch(r, { keepUpdated: true }); }, m);
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#match/${encodeURIComponent(m.id)}`);
  await page.waitForSelector('#etab tbody tr', { state: 'attached' });
  check(await page.locator('#etab tr.suspect').count() === 2, '(1) 怪しい 2 件に印が付く（確信度が低い・自動採用）');
  check(await page.locator('#etab tr.suspect .suspect-badge').count() === 2 && (await page.locator('#etab .suspect-bar').innerText()).includes('2 件'), '(2) ❗ バッジと件数の帯が出る');
  await page.locator('#etab button[data-suspect="1"]').click(); await page.waitForTimeout(200);
  const cur1 = await page.locator('#etab tr.suspect-cur').getAttribute('data-t');
  await page.locator('#etab button[data-suspect="1"]').click(); await page.waitForTimeout(200);
  const cur2 = await page.locator('#etab tr.suspect-cur').getAttribute('data-t');
  await page.locator('#etab button[data-suspect="1"]').click(); await page.waitForTimeout(200);
  const cur3 = await page.locator('#etab tr.suspect-cur').getAttribute('data-t');
  check(cur1 === '50' && cur2 === '90' && cur3 === '50', '(3) 「次の❗」で順に移り、最後からは先頭に戻る', [cur1, cur2, cur3].join());
  await page.evaluate(() => document.querySelector('#review-toggle').click());
  await page.check('#review-toggle', { force: true }).catch(() => {});
  await page.locator('#etab tr.suspect .mk[data-v="ok"]').first().click({ force: true }); await page.waitForTimeout(400);
  check(await page.locator('#etab tr.suspect').count() === 1, '(4) ✓ を付けた検出は、印が外れる');
  const marks = await page.evaluate(async () => (await window.inkgraph.db.getMatch('su#1')).review.marks);
  check(Object.values(marks).join() === 'ok', '(5) ✓ は既存の保存先(review.marks)に入る', JSON.stringify(marks));
  check(errs.length === 0, '(6) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
