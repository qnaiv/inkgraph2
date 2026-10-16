// Tower holder labeling UI check (review mode): popover screenshot, edit, count point, feedback zip export + eval_labels.py.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(WEB_DIR, '..');
const SH = path.join(ROOT, 'docs/screenshots/tower-label-ui');
const ZIP = path.join(WEB_DIR, 'test-results/tower_label_feedback.zip');
const EVAL = '/workspace/ig-eval/tools/eval_labels.py';
fs.mkdirSync(SH, { recursive: true });
fs.mkdirSync(path.dirname(ZIP), { recursive: true });

let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };

const srv = spawn('npx', ['vite', 'preview', '--port', '4182', '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ja-JP' });
  const page = await ctx.newPage();
  await page.route('https://fonts.**/**', r => r.abort());
  page.on('pageerror', e => { console.log('pageerror', e.message); });
  page.on('dialog', d => d.accept());
  const U = 'http://127.0.0.1:4182/';
  const ms = JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'test-results/web_matches.json')));
  await page.goto(U + '#live');
  await page.evaluate(async ms => { await window.inkgraph.db.importAll(ms); }, ms);
  const m2 = ms[1];
  await page.goto(U + '#match/' + encodeURIComponent(m2.id));
  await page.reload();
  await page.waitForSelector('.timeline-svg', { timeout: 8000 });
  await page.locator('label.review-toggle-label').click();
  await page.waitForSelector('.detail-body.review-on');

  const segs = page.locator('.tw-seg');
  const n = await segs.count();
  check(n > 1, 'holder segments rendered in review mode', `n=${n}`);

  // (a) open a popover on the 2nd segment (scroll the lane into view first)
  const idx = Math.min(1, n - 1);
  await segs.nth(idx).scrollIntoViewIfNeeded();
  const key = await segs.nth(idx).getAttribute('data-key');
  await segs.nth(idx).locator('.tw-fill').click({ force: true });
  await page.waitForSelector('.tw-pop');
  const det = await page.evaluate(() => document.querySelector('.tw-pop .tw-pill[aria-checked="true"]').dataset.v);
  check(['own', 'enemy', 'neutral'].includes(det), 'popover opens with detected value selected', det);
  await page.screenshot({ path: path.join(SH, '02_segment_popover.png') });

  // Esc closes, re-open
  await page.keyboard.press('Escape');
  check(await page.locator('.tw-pop').count() === 0, 'Esc closes popover');
  await segs.nth(idx).focus();
  await page.keyboard.press('Enter');
  check(await page.locator('.tw-pop').count() === 1, 'keyboard Enter opens popover');

  // (b) add count point, then change value
  await page.fill('.tw-cn-own', '37');
  await page.fill('.tw-cn-enemy', '52');
  await page.click('.tw-cn-add');
  await page.waitForSelector('.tw-pop .tw-pop-list li');
  check(await page.locator('.tw-cp').count() === 1, 'count point dots drawn');
  const newVal = det === 'own' ? 'enemy' : 'own';
  await page.click(`.tw-pop .tw-pill[data-v="${newVal}"]`);
  await page.waitForTimeout(300);
  check(await page.locator('.tw-pop').count() === 0, 'popover closes after choice');
  await page.screenshot({ path: path.join(SH, '03_after_review.png') });

  // (c) export feedback zip
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#fbone'),
  ]);
  await dl.saveAs(ZIP);
  const files = unzipSync(new Uint8Array(fs.readFileSync(ZIP)));
  const fb = JSON.parse(strFromU8(files['feedback.json']));
  check(fb.format === 1, 'feedback.json format 1');
  const rm = fb.matches.find(x => x.id === m2.id);
  const th = rm?.review?.tower_holder;
  const seg = (rm?.review?.tower_seg || {})[key];
  check(Array.isArray(th) && th.length > 0, 'review.tower_holder present');
  const sorted = th && th.every((s, i) => i === 0 || (s[0] === th[i - 1][1] && s[2] !== th[i - 1][2]));
  check(!!sorted, 'tower_holder contiguous, sorted, adjacent merged');
  const segT0 = parseFloat(key);
  check(seg === newVal && !!th?.some(s => s[0] <= segT0 + 0.11 && s[1] > segT0 + 0.5 && s[2] === newVal), 'tower_holder contains changed segment with new value', `${key} ${det}->${newVal}`);
  const cs = rm?.review?.count_series;
  check(Array.isArray(cs) && cs.some(c => c.length === 3 && c[1] === 37 && c[2] === 52 && Math.abs(c[0] - segT0) < 0.11), 'review.count_series contains the point', JSON.stringify(cs));
  const other = fb.matches.find(x => x.id !== m2.id);
  check(!other || !other.review?.tower_holder, 'unreviewed match has no tower_holder');

  // (d) eval_labels.py
  const help = spawnSync('python3', [EVAL, '--help'], { encoding: 'utf8' });
  if (help.status !== 0) check(false, 'eval_labels.py --help');
  else {
    const r = spawnSync('python3', [EVAL, ZIP, '--pred', 'web:' + path.join(WEB_DIR, 'test-results/web_matches.json')], { encoding: 'utf8', cwd: path.dirname(path.dirname(EVAL)) });
    const out = (r.stdout || '') + (r.stderr || '');
    console.log('--- eval_labels.py (ヤグラ / カウント lines) ---');
    console.log(out.split('\n').filter(l => /ヤグラ|カウント系列/.test(l)).join('\n') || out.slice(0, 1500));
    check(r.status === 0 && /ヤグラ保持\(味方\)/.test(out), 'eval_labels.py parses the zip');
    check(!/ヤグラ保持\(味方\).*ラベルなし/.test(out), 'eval tower section is labelled (not ラベルなし)');
  }
} catch (e) {
  check(false, 'script error', String(e.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  if (browser) await browser.close();
  srv.kill();
}
console.log(fails ? `FAILED (${fails})` : 'ALL PASS');
process.exit(fails ? 1 : 0);
