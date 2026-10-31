// rule_fix_ui_check.mjs: 確認画面（結果の確認）で、ルールを選んで訂正できる（実ブラウザ）。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const WEB = path.resolve(import.meta.dirname, '..');
const mk = (id, rs) => ({ id, match: 1, created: new Date(2026, 9, 31, 12, 0).toISOString(), updated: new Date(2026, 9, 31, 12, 0).toISOString(), battle: [0, 140], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: 'WIN', stage: 'ナメロウ金属', own: { ka: 5, deaths: 2, specials: 2 }, ...rs },
  own_deaths: [{ start: 10, end: 12 }, { start: 50, end: 52 }], special: [], own_kills: [], squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 140 },
  confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 }, review: { marks: {}, rmarks: {}, added: [], fix: {} }, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' } });
const PORT = process.env.PORT || '4238', srv = process.env.NO_SERVER ? { kill() {} } : startPreview(PORT, WEB); await new Promise(r => setTimeout(r, process.env.NO_SERVER ? 0 : 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { for (const m of r) await window.inkgraph.db.putMatch(m, { keepUpdated: true }); }, [mk('rf#1', { mode: undefined }), mk('rf#2', { mode: 'ガチエリア' })]);
  const open = async id => { await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#match/${encodeURIComponent(id)}`); await page.waitForSelector('#review-toggle', { state: 'attached' }); await page.check('#review-toggle', { force: true }); await page.waitForSelector('#rtab tbody tr'); };
  const row = label => page.locator('#rtab tbody tr', { has: page.locator(`td:first-child:text-is("${label}")`) });

  await open('rf#1');
  const sel = row('ルール').locator('select[data-mode-sel]');
  check(await sel.count() === 1, '(1) ルールが読めていない試合では、✗ を押さなくても、ルールを選ぶ欄が出る');
  const opts = await sel.locator('option').allTextContents();
  check(opts.join('|') === 'ルールを選ぶ…|ガチエリア|ガチヤグラ|ガチホコバトル|ガチアサリ|ナワバリバトル', '(2) 選択肢は スプラ3 の 5 ルール', opts.join('|'));
  await sel.selectOption('ガチヤグラ'); await page.waitForTimeout(400);
  const saved = await page.evaluate(async () => { const m = await window.inkgraph.db.getMatch('rf#1'); return { fix: m.review.fix.mode, mark: m.review.rmarks.mode }; });
  check(saved.fix === 'ガチヤグラ' && saved.mark === 'wrong', '(3) 選ぶと、直した値と ✗ が保存される', JSON.stringify(saved));
  check(await row('ルール').locator('select[data-mode-sel]').evaluate(e => e.value) === 'ガチヤグラ', '(4) 選んだルールが、欄に残る');

  await open('rf#2');
  check(await row('ルール').locator('select[data-mode-sel]').count() === 0, '(5) 読めているルールは、✗ を押すまで選ぶ欄を出さない');
  await row('ルール').locator('button[data-v="wrong"]').click(); await page.waitForTimeout(300);
  check(await row('ルール').locator('select[data-mode-sel]').count() === 1, '(6) ✗ を押すと、選ぶ欄が出る');
  await row('ルール').locator('select[data-mode-sel]').selectOption('ガチアサリ'); await page.waitForTimeout(400);
  const saved2 = await page.evaluate(async () => (await window.inkgraph.db.getMatch('rf#2')).review.fix.mode);
  check(saved2 === 'ガチアサリ', '(7) 読めていたルールの誤りも、選んで直せる', saved2);
  check(errs.length === 0, '(8) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
