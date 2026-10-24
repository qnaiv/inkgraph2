// D51: ライブ画面のスペシャル発動が試合中に増えること、確定時に速報と同じ数なら注記が「同じ数でした」になることをブラウザで確かめる。
// usage: node tools/live_special_browser_check.mjs [--video <mp4>]（既定 22-15-50_match03.mp4、確定のスペシャル発動 2）
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const ROOT_DIR = path.resolve(WEB_DIR, '..');
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const arg = (k, def) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const videoPath = path.resolve(arg('--video', '/workspace/igc/rules/22-15-50_match03.mp4'));
if (!fs.existsSync(videoPath)) { console.error(`Video file not found at ${videoPath}`); process.exit(1); }

const PORT = 4238;
const U = `http://127.0.0.1:${PORT}/`;
// D50 の startPreview：プロセスグループごと止める（npx の子の vite を残さない）
const srv = startPreview(PORT, WEB_DIR);
const stopSrv = () => srv.kill();
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const shotDir = path.resolve(ROOT_DIR, 'docs/screenshots/live-special');
fs.mkdirSync(shotDir, { recursive: true });
let page = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(U + '#live');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.getSession, null, { timeout: 10000 });
  await page.evaluate(async () => { const db = window.inkgraph.db; for (const m of await db.allMatches()) await db.deleteMatch(m.id); });
  await page.locator('input[name=src][value=file]').check({ force: true });
  await page.setInputFiles('#file', videoPath);
  await page.waitForTimeout(400);
  if (!(await page.$eval('#fast', el => el.checked))) await page.$eval('#fast', el => { el.checked = true; el.dispatchEvent(new Event('change')); });
  await page.click('#start');

  // 試合中（保存前）にスペシャル発動が 1 以上になるのを待つ
  const spLive = await page.waitForFunction(() => {
    const st = document.querySelector('#state')?.textContent || '';
    const sp = +document.querySelector('#sp')?.textContent || 0;
    return sp >= 1 && !st.includes('保存しました') ? sp : false;
  }, null, { timeout: 200000 }).then(h => h.jsonValue()).catch(() => 0);
  check('During match: スペシャル発動 counted live (>=1) before save', spLive >= 1, `sp=${spLive}`);
  const live = await page.evaluate(() => ({
    badge: document.querySelector('#live-count-badge')?.textContent.trim(),
    log: document.querySelector('#log')?.textContent || '' }));
  check('During match: badge still 「速報」', live.badge === '速報', live.badge);
  check('During match: event log has スペシャル発動 row', live.log.includes('スペシャル発動'), live.log.slice(0, 120));
  await page.screenshot({ path: path.join(shotDir, '01-live-special.png') });

  const saved = await page.waitForFunction(() => (document.querySelector('#state')?.textContent || '').includes('保存しました'), null, { timeout: 200000 }).then(() => true).catch(() => false);
  check('After save: state shows 「保存しました」', saved);
  const fin = await page.evaluate(async () => {
    const ms = await window.inkgraph.db.allMatches(); if (!ms.length) return null;
    const ev = window.inkgraph.analysis.effective(ms[0]);
    return { effSp: ev.filter(x => x.kind === 'special').length, dispSp: +document.querySelector('#sp').textContent,
      badge: document.querySelector('#live-count-badge')?.textContent.trim(), note: document.querySelector('#live-recount-note')?.textContent || '' };
  });
  check('After save: badge 「確定」', fin?.badge === '確定', fin?.badge);
  check('After save: displayed スペシャル発動 equals effective', fin && fin.dispSp === fin.effSp, `disp=${fin?.dispSp} eff=${fin?.effSp}`);
  check('After save: live スペシャル発動 equals final (no 0→N correction)', fin && !/スペシャル発動 \d+→/.test(fin.note), fin?.note);
  await page.screenshot({ path: path.join(shotDir, '02-final.png') });
  check('No uncaught page errors', errors.length === 0, errors.join('; '));
} catch (e) {
  console.error('FAIL exception:', e); results.push(false);
} finally {
  if (page) await page.evaluate(async () => { const s = window.inkgraph?.getSession?.(); if (s) await s.stop(); }).catch(() => {});
  await browser.close().catch(() => {});
  stopSrv();
}
const failed = results.filter(x => !x).length;
console.log(failed ? `FAIL (${results.length - failed}/${results.length} passed)` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
