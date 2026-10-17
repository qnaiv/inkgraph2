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

// #33: 書き出しは試合一覧のダイアログ経由。詳細の #fbone → 一覧 → 全件モードで書き出し → 詳細へ戻る。
async function exportViaDialog(page) {
  await page.click('#fbone');
  try { await page.waitForSelector('.fb-dialog', { timeout: 1500 }); } catch { await page.click('#fbbar'); await page.waitForSelector('.fb-dialog'); }
  await page.check('input[name="fbmode"][value="full"]');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#fbd-go')]);
  await page.waitForTimeout(300);
  await page.click('[data-page="match"]');
  await page.waitForSelector('#fbone');
  return dl;
}

let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };

const PORT = Number(process.env.PORT) || 4215;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ja-JP' });
  const page = await ctx.newPage();
  await page.route('https://fonts.**/**', r => r.abort());
  page.on('pageerror', e => { console.log('pageerror', e.message); });
  page.on('dialog', d => d.accept());
  const U = `http://127.0.0.1:${PORT}/`;
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
  check(n > 3, 'holder segments rendered in review mode', `n=${n}`);

  // (a) open a popover on the 2nd segment (scroll the lane into view first)
  const idx = Math.min(1, n - 1);
  await segs.nth(idx).scrollIntoViewIfNeeded();
  const key = await segs.nth(idx).getAttribute('data-key');
  await segs.nth(idx).locator('.tw-fill').click({ force: true });
  await page.waitForSelector('.tw-pop');
  const tipVis = await page.locator('.tl-tooltip').isVisible();
  check(!tipVis, 'no visible tooltip while popover is open');
  const det = await page.evaluate(() => document.querySelector('.tw-pop .tw-pill[aria-checked="true"]').dataset.v);
  check(['own', 'enemy', 'neutral'].includes(det), 'popover opens with detected value selected', det);
  const popW = await page.evaluate(() => document.querySelector('.tw-pop').offsetWidth);
  check(popW === 280, 'popover width is 280px', `w=${popW}`);
  const hasArrow = await page.locator('.tw-pop .tw-pop-arrow').count();
  check(hasArrow === 1, 'popover has downward arrow');
  const choicesText = await page.locator('.tw-pop-choices').innerText();
  check(choicesText.includes('味方') && choicesText.includes('敵') && choicesText.includes('中立'), 'choices labels are 味方／敵／中立', choicesText.replace(/\n/g, ' '));
  await page.screenshot({ path: path.join(SH, '02_segment_popover.png') });

  // Esc closes, re-open with keyboard Enter
  await page.keyboard.press('Escape');
  check(await page.locator('.tw-pop').count() === 0, 'Esc closes popover');
  await segs.nth(idx).focus();
  await page.keyboard.press('Enter');
  check(await page.locator('.tw-pop').count() === 1, 'keyboard Enter opens popover');

  // (b) add count point, change 1st segment value, confirm a 2nd segment with its detected value
  await page.fill('.tw-cn-own', '37');
  await page.fill('.tw-cn-enemy', '52');
  await page.click('.tw-cn-add');
  await page.waitForSelector('.tw-pop .tw-pop-list li');
  check(await page.locator('.tw-cp').count() === 1, 'count point dots drawn');
  const newVal = det === 'own' ? 'enemy' : 'own';
  await page.click(`.tw-pop .tw-pill[data-v="${newVal}"]`);
  await page.waitForTimeout(300);
  check(await page.locator('.tw-pop').count() === 0, 'popover closes after choice');

  const cpDot = page.locator('.tw-cp circle').first();
  await cpDot.hover();
  await page.waitForSelector('.tl-tooltip', { state: 'visible' });
  const cpTip = (await page.locator('.tl-tooltip').innerText()).trim();
  check(cpTip === '味方 37 ／ 敵 52', 'count point hover tooltip matches 味方 37 ／ 敵 52', cpTip);
  const dotBox = await cpDot.boundingBox();
  const dotSizeOk = dotBox && dotBox.width >= 6 && dotBox.height >= 6;
  check(dotSizeOk, 'count point dot rendered size is >=6px', `w=${dotBox?.width?.toFixed(1)}, h=${dotBox?.height?.toFixed(1)}`);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);

  // Confirm a 2nd segment with its detected value
  const idx2 = 3;
  const key2 = await segs.nth(idx2).getAttribute('data-key');
  await segs.nth(idx2).locator('.tw-fill').click({ force: true });
  await page.waitForSelector('.tw-pop');
  const det2 = await page.evaluate(() => document.querySelector('.tw-pop .tw-pill[aria-checked="true"]').dataset.v);
  await page.click(`.tw-pop .tw-pill[data-v="${det2}"]`);
  await page.waitForTimeout(300);
  check(await page.locator('.tw-pop').count() === 0, 'popover closes after confirming 2nd segment');
  await page.screenshot({ path: path.join(SH, '03_after_review.png') });

  // 05_neutral_and_corrected.png: hover on the corrected segment to show its tooltip
  await segs.nth(idx).hover();
  await page.waitForSelector('.tl-tooltip', { state: 'visible' });
  const tipTxt = await page.locator('.tl-tooltip').innerText();
  check(tipTxt.includes('修正済み'), 'corrected segment hover tooltip shows 修正済み', tipTxt);
  await page.screenshot({ path: path.join(SH, '05_neutral_and_corrected.png') });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);

  // (c) export feedback zip and assert tower_holder contains only confirmed segments
  const dl = await exportViaDialog(page);
  await dl.saveAs(ZIP);
  const files = unzipSync(new Uint8Array(fs.readFileSync(ZIP)));
  const fb = JSON.parse(strFromU8(files['feedback.json']));
  check(fb.format === 2, 'feedback.json format 2');
  const rm = fb.matches.find(x => x.id === m2.id);
  const th = rm?.review?.tower_holder;
  check(Array.isArray(th) && th.length === 2, 'review.tower_holder contains exactly 2 confirmed segments', JSON.stringify(th));
  const segT0 = parseFloat(key);
  const segT1 = parseFloat(key2);
  check(th?.some(s => Math.abs(s[0] - segT0) < 0.15 && s[2] === newVal), 'tower_holder contains changed segment with new value', `${key}->${newVal}`);
  check(th?.some(s => Math.abs(s[0] - segT1) < 0.15 && s[2] === det2), 'tower_holder contains second segment with detected value', `${key2}->${det2}`);
  const coveredSec = (th || []).reduce((acc, s) => acc + (s[1] - s[0]), 0);
  check(coveredSec < 50, 'tower_holder does NOT cover unconfirmed time', `covered=${coveredSec.toFixed(1)}s`);
  check(!th?.some(s => Math.abs(s[0] - 21.6) < 0.15), 'unconfirmed segment 0 omitted from tower_holder');
  const cs = rm?.review?.count_series;
  check(Array.isArray(cs) && cs.some(c => c.length === 3 && c[1] === 37 && c[2] === 52 && Math.abs(c[0] - segT0) < 0.15), 'review.count_series contains the point', JSON.stringify(cs));
  const other = fb.matches.find(x => x.id !== m2.id);
  check(!other || !other.review?.tower_holder, 'unreviewed match has no tower_holder');

  // (d) open 2nd segment popover, assert 「未確認に戻す」 visible, screenshot 04, click it, export again
  await segs.nth(idx2).locator('.tw-fill').click({ force: true });
  await page.waitForSelector('.tw-pop');
  check(!await page.locator('.tl-tooltip').isVisible(), 'no visible tooltip while confirmed popover is open');
  const ucBtn = page.locator('.tw-unconfirm');
  check(await ucBtn.isVisible(), '未確認に戻す button visible on confirmed segment');
  check((await ucBtn.textContent()).trim() === '未確認に戻す', '未確認に戻す label text correct');
  await page.screenshot({ path: path.join(SH, '04_popover_confirmed.png') });
  await ucBtn.click();
  await page.waitForTimeout(300);
  check(await page.locator('.tw-pop').count() === 0, 'popover closes after 未確認に戻す');

  const dl2 = await exportViaDialog(page);
  await dl2.saveAs(ZIP);
  const files2 = unzipSync(new Uint8Array(fs.readFileSync(ZIP)));
  const fb2 = JSON.parse(strFromU8(files2['feedback.json']));
  check(fb2.format === 2, 'feedback.json 2 format 2');
  const rm2 = fb2.matches.find(x => x.id === m2.id);
  const th2 = rm2?.review?.tower_holder;
  check(Array.isArray(th2) && th2.length === 1, 'tower_holder contains exactly 1 segment after unconfirm', JSON.stringify(th2));
  check(!th2?.some(s => Math.abs(s[0] - segT1) < 0.15), 'unconfirmed segment is gone from tower_holder');
  check(th2?.some(s => Math.abs(s[0] - segT0) < 0.15 && s[2] === newVal), 'first segment remains in tower_holder');

  // (e) run eval_labels.py on the zip and print the tower rows
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
