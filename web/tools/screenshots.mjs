// Loads test-results/web_matches.json into the app and captures redesigned UI screenshots + exercises review & feedback export.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runUiChecks } from './ui_check.mjs';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(WEB_DIR, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/ui-redesign');
fs.mkdirSync(SH, { recursive: true });

const srv = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ja-JP' });
const page = await ctx.newPage();
await page.route('https://fonts.**/**', route => route.abort());
page.on('pageerror', e => console.log('pageerror', e.message));

const U = 'http://127.0.0.1:4174/';
await page.goto(U + '#live');
const ms = JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'test-results/web_matches.json')));
await page.evaluate(async ms => { await window.inkgraph.db.importAll(ms); }, ms);

// 01_live.png
await page.goto(U + '#live');
await page.reload();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(SH, '01_live.png') });

// 05_live_analyzing.png (analyze a recorded file via the file source)
{
  const rec = path.resolve(WEB_DIR, '../raw/1080p/joined_match02.mp4');
  if (fs.existsSync(rec)) {
    await page.locator('input[name="src"][value="file"]').check({ force: true });
    await page.setInputFiles('#file', rec);
    await page.click('#start');
    await page.waitForFunction(() => document.querySelector('#state')?.textContent.includes('解析中') && getComputedStyle(document.querySelector('#stop')).display !== 'none', null, { timeout: 30000 });
    await page.waitForSelector('#stop', { state: 'visible', timeout: 30000 });
    // the badge shows 「解析中 · m:ss / m:ss」 once a match has started; wait for it (pre-match shows 「試合の開始を待っています」)
    await page.waitForFunction(() => /^解析中 · \d+:\d\d \/ \d+:\d\d$/.test(document.querySelector('#state')?.textContent || ''), null, { timeout: 120000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SH, '05_live_analyzing.png') });
    await page.click('#stop');
    await page.waitForTimeout(800);
  } else {
    console.log('SKIP 05: missing', rec);
  }
}

// 02_match_list.png
await page.click('.sidenav a[data-page="list"]');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(SH, '02_match_list.png') });

// 03_match_detail.png (match 2 with review mode ON, fullPage)
const match2 = ms[1] || ms[0];
await page.goto(U + '#match/' + encodeURIComponent(match2.id));
await page.reload();
await page.waitForTimeout(800);

// Turn on review mode toggle
const reviewToggle = page.locator('#review-toggle');
if (!(await reviewToggle.isChecked())) {
  await reviewToggle.check();
  await page.waitForTimeout(300);
}

const videoPath = path.resolve(WEB_DIR, '../raw/1080p/joined_match02.mp4');
if (fs.existsSync(videoPath)) {
  await page.setInputFiles('#vf', videoPath);
  await page.waitForTimeout(1500);
}

for (let j = 0; j < 6; j++) {
  const btn = page.locator('#etab button.mk[data-v="ok"]:not(.on-ok)').first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(150);
  }
}

await page.evaluate(() => {
  const v = document.querySelector('#rv');
  if (v) v.currentTime = 68.2;
});
await page.waitForTimeout(500);
await page.click('button.add[data-k="death"]');
await page.waitForTimeout(1500);

for (const f of ['result', 'mode', 'stage', 'deaths', 'specials']) {
  const btn = page.locator(`#rtab button[data-f="${f}"][data-v="ok"]`);
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(100);
  }
}

await page.evaluate(() => {
  const v = document.querySelector('#rv');
  if (v && v.src) { v.pause(); v.currentTime = 68.2; }
});
await page.waitForTimeout(500);

const dl = page.waitForEvent('download');
await page.click('#fbone');
const d = await dl;
await d.saveAs(path.join(WEB_DIR, 'test-results/feedback_sample.zip'));
console.log('feedback zip', d.suggestedFilename());

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SH, '03_match_detail.png'), fullPage: true });

// 04_trends.png (fullPage)
await page.goto(U + '#trend');
await page.reload();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(SH, '04_trends.png'), fullPage: true });

// 06 / 07 / 08: empty states with a fresh browser context (empty IndexedDB)
{
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  const p2 = await ctx2.newPage();
  await p2.route('https://fonts.**/**', route => route.abort());
  p2.on('pageerror', e => console.log('pageerror', e.message));
  await p2.goto(U + '#live');
  await p2.waitForTimeout(800);
  await p2.screenshot({ path: path.join(SH, '06_live_idle_empty.png') });
  await p2.goto(U + '#list');
  await p2.reload();
  await p2.waitForTimeout(800);
  await p2.screenshot({ path: path.join(SH, '07_match_list_empty.png') });
  await p2.goto(U + '#trend');
  await p2.reload();
  await p2.waitForTimeout(800);
  await p2.screenshot({ path: path.join(SH, '08_trends_empty.png') });
  await ctx2.close();
}

const uiFailed = await runUiChecks(browser, U, ms);

await browser.close();
srv.kill();
console.log('screenshots in', SH);
process.exit(uiFailed ? 1 : 0);
