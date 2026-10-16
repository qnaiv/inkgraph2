// Loads test-results/web_matches.json into the app and captures screenshots + exercises review & feedback export.
import { chromium } from 'playwright-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'); const SH = path.join(ROOT, 'web/screenshots'); fs.mkdirSync(SH, { recursive: true });
const srv = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { cwd: path.join(ROOT, 'web'), stdio: 'ignore' }); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true }); const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, locale: 'ja-JP' });
const page = await ctx.newPage(); page.on('pageerror', e => console.log('pageerror', e.message));
const U = 'http://127.0.0.1:4174/';
await page.goto(U + '#list'); const ms = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/test-results/web_matches.json')));
await page.evaluate(async ms => { await window.inkgraph.db.importAll(ms); }, ms); await page.goto(U + '#trend'); await page.reload(); await page.waitForTimeout(800);
await page.screenshot({ path: path.join(SH, 'trends.png'), fullPage: true });
await page.click('nav button[data-page=list]'); await page.waitForTimeout(500); await page.screenshot({ path: path.join(SH, 'match_list.png'), fullPage: true });
for (let i = 0; i < ms.length; i++) { await page.goto(U + '#match/' + encodeURIComponent(ms[i].id)); await page.reload(); await page.waitForTimeout(800);
  if (i === 1) { // review demo on match 2: load video, mark events, add a missed death
    await page.setInputFiles('#vf', path.join(ROOT, 'raw/1080p/joined_match02.mp4')); await page.waitForTimeout(1500);
    for (let j = 0; j < 6; j++) { await page.locator('#etab button.mk[data-v=ok]:not(.on-ok)').first().click(); await page.waitForTimeout(200); }
    await page.evaluate(() => { const v = document.querySelector('#rv'); v.currentTime = 68.2; }); await page.waitForTimeout(800); await page.click('button.add[data-k=death]'); await page.waitForTimeout(2500);
    for (const f of ['result', 'mode', 'stage', 'ka', 'deaths', 'specials']) { await page.click(`#rtab button[data-f=${f}][data-v=ok]`); await page.waitForTimeout(100); }
    await page.evaluate(() => { const v = document.querySelector('#rv'); v.pause(); v.currentTime = 68.2; }); await page.waitForTimeout(800);
    const dl = page.waitForEvent('download'); await page.click('#fbone'); const d = await dl; await d.saveAs(path.join(ROOT, 'web/test-results/feedback_sample.zip')); console.log('feedback zip', d.suggestedFilename()); }
  await page.screenshot({ path: path.join(SH, `timeline_match0${i + 1}.png`), fullPage: true }); }
await page.goto(U + '#trend'); await page.reload(); await page.waitForTimeout(800); await page.screenshot({ path: path.join(SH, 'trends.png'), fullPage: true });
await page.goto(U + '#live'); await page.reload(); await page.waitForTimeout(800); await page.screenshot({ path: path.join(SH, 'live.png') });
await browser.close(); srv.kill(); console.log('screenshots in', SH);
