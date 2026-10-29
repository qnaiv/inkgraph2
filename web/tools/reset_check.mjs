// reset_check.mjs: D69 「記録をすべて消す」。実ブラウザ。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path';
const WEB = path.resolve(import.meta.dirname, '..');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const PORT = process.env.PORT || '4238', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  let promptAnswer = '消す', dialogs = []; page.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message().slice(0, 30)); if (d.type() === 'prompt') await d.accept(promptAnswer); else await d.accept(); });
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForFunction(() => window.inkgraph && window.inkgraph.db);
  const seed = () => page.evaluate(async () => {
    const db = window.inkgraph.db, blob = () => new Promise(res => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.toBlob(res, 'image/jpeg'); });
    for (const [i, id] of ['x#1', 'x#2'].entries()) { await db.putMatch({ id, match: i + 1, created: new Date(2026, 9, 20, 12, i).toISOString(), battle: [0, 100], squid_down: {}, own_deaths: [], own_kills: [], special: [], result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'テスト', own: { ka: 1, deaths: 1, specials: 0 } }, review: { marks: {}, added: [], fix: {} }, stills: { count: 1, bytes: 9 }, stillsState: 'kept', video: { kind: 'none' } }); await db.putSnap({ matchId: id, t: 1, reason: 't', kind: 'death', header: null, blob: await blob() }); }
    localStorage.setItem('inkgraph.weaponLib', JSON.stringify({ v: 1, items: [{ name: 'テスト' }] })); localStorage.setItem('inkgraph.retentionKeep', '5');
  });
  const state = () => page.evaluate(async () => ({ m: (await window.inkgraph.db.allMatches()).length, s: (await window.inkgraph.db.snapsOf('x#1')).length, lib: !!localStorage.getItem('inkgraph.weaponLib'), keep: localStorage.getItem('inkgraph.retentionKeep'), del: window.inkgraph.db.pendingDeletes().length }));
  const open = async () => { await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#settings`); await page.waitForSelector('#reset-all'); };
  await seed(); let st = await state(); check(st.m === 2 && st.s === 1 , '(0) 準備', JSON.stringify(st));
  await open(); promptAnswer = 'ちがう'; await page.click('#reset-all'); await page.waitForTimeout(500);
  st = await state(); check(st.m === 2, '(1) 確認の入力が違うと消えない', JSON.stringify(st));
  promptAnswer = '消す'; await page.click('#reset-all'); await page.waitForTimeout(800);
  st = await state(); check(st.m === 0 && st.s === 0 , '(2) 試合・静止画がすべて消える', JSON.stringify(st));
  check(st.lib && st.keep === '5', '(3) 「学習結果なども」にチェックしなければ、見本・設定は残る');
  check(st.del === 2, '(4) クラウドに「消した」と伝える印が付く（同期でクラウド側も消える）', String(st.del));
  await seed(); await open(); await page.check('#reset-learn'); await page.click('#reset-all'); await page.waitForTimeout(800);
  st = await state(); check(st.m === 0 && !st.lib && st.keep === null, '(5) チェックすると、見本・設定も初期化される', JSON.stringify(st));
  check(!errs.length, '(6) ページエラー無し', errs.join('|'));
} finally { await browser.close(); srv.kill?.(); }
process.exit(fails ? 1 : 0);
