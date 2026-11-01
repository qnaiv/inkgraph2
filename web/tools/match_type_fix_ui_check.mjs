// match_type_fix_ui_check.mjs: 確認画面（結果の確認）で、マッチタイプ（フェス・レギュラーなど）を選んで訂正できる（実ブラウザ）。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const WEB = path.resolve(import.meta.dirname, '..');
const mk = (id, rs, mt = null) => ({ id, match: 1, match_type: mt, created: new Date(2026, 9, 31, 12, 0).toISOString(), updated: new Date(2026, 9, 31, 12, 0).toISOString(), battle: [0, 140], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: 'WIN', stage: 'ナメロウ金属', own: { ka: 5, deaths: 2, specials: 2 }, ...rs },
  own_deaths: [{ start: 10, end: 12 }, { start: 50, end: 52 }], special: [], own_kills: [], squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 140 },
  confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 }, review: { marks: {}, rmarks: {}, added: [], fix: {} }, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' } });
const PORT = process.env.PORT || '4238', srv = process.env.NO_SERVER ? { kill() {} } : startPreview(PORT, WEB); await new Promise(r => setTimeout(r, process.env.NO_SERVER ? 0 : 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { for (const m of r) await window.inkgraph.db.putMatch(m, { keepUpdated: true }); }, [mk('mt#1', { mode: 'ナワバリバトル' }), mk('mt#2', { mode: 'ガチエリア' }, 'bankara_open')]);
  const open = async id => { await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#match/${encodeURIComponent(id)}`); await page.waitForSelector('#review-toggle', { state: 'attached' }); await page.check('#review-toggle', { force: true }); await page.waitForSelector('#rtab tbody tr'); };
  const row = label => page.locator('#rtab tbody tr', { has: page.locator(`td:first-child:text-is("${label}")`) });

  await open('mt#1');
  const sel = row('マッチタイプ').locator('select[data-mt-sel]');
  check(await sel.count() === 1, '(1) マッチタイプが読めていない試合では、✗ を押さなくても、選ぶ欄が出る');
  const opts = await sel.locator('option').allTextContents();
  check(opts.includes('フェスマッチ（チャレンジ）') && opts.includes('フェスマッチ（オープン）') && opts.includes('トリカラマッチ') && opts.includes('プライベートマッチ'), '(2) 選択肢に、フェス（チャレンジ・オープン・トリカラ）とプライベートがある', opts.join('|'));
  check(await row('マッチタイプ').locator('input[data-fix]').count() === 0, '(3) 自由入力の欄は出ない');
  await sel.selectOption('fest_challenge'); await page.waitForTimeout(400);
  const saved = await page.evaluate(async () => { const m = await window.inkgraph.db.getMatch('mt#1'); return { fix: m.review.fix.match_type, mark: m.review.rmarks.match_type }; });
  check(saved.fix === 'fest_challenge' && saved.mark === 'wrong', '(4) 選ぶと、直した値と ✗ が保存される', JSON.stringify(saved));
  check(await row('マッチタイプ').locator('select[data-mt-sel]').evaluate(e => e.value) === 'fest_challenge', '(5) 選んだ値が、欄に残る');

  await open('mt#2');
  check(await row('マッチタイプ').locator('select[data-mt-sel]').count() === 0, '(6) 読めている値は、✗ を押すまで選ぶ欄を出さない');
  await row('マッチタイプ').locator('button[data-v="wrong"]').click(); await page.waitForTimeout(300);
  await row('マッチタイプ').locator('select[data-mt-sel]').selectOption('fest_tricolor'); await page.waitForTimeout(400);
  const saved2 = await page.evaluate(async () => (await window.inkgraph.db.getMatch('mt#2')).review.fix.match_type);
  check(saved2 === 'fest_tricolor', '(7) 読めていた値の誤りも、選んで直せる', saved2);
  check(errs.length === 0, '(8) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
