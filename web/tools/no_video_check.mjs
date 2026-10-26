// #31 stage 1 check: no video recording, still-frame review. usage: node tools/no_video_check.mjs
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/no-video-stills');
fs.mkdirSync(SH, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const mss = t => { t = Math.max(0, Math.round(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

// a) static source check
{
  const src = fs.readFileSync(path.join(WEB_DIR, 'src/session.js'), 'utf8');
  check('a) session.js has no MediaRecorder', !src.includes('MediaRecorder'));
  check('a) session.js has no putVideo', !src.includes('putVideo'));
}

const PORT = 4191, U = `http://127.0.0.1:${PORT}/`;
const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  const page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(U + '#live');
  const ms = JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'test-results/web_matches.json'), 'utf8'));
  const m2 = ms[1], m3 = ms[2];
  m2.stills = { count: 2, bytes: 4096 }; m2.video = { kind: 'none' };
  const T1 = m2.battle[0] + 10, T2 = m2.battle[0] + 70;
  await page.evaluate(async ({ ms, id, T1, T2 }) => {
    await window.inkgraph.db.importAll(ms);
    const mk = t => new Promise(res => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); x.fillStyle = t < 60 ? '#2a6' : '#a42'; x.fillRect(0, 0, 320, 180); x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText('still ' + t.toFixed(0), 40, 100); c.toBlob(res, 'image/jpeg', 0.8); });
    for (const t of [T1, T2]) await window.inkgraph.db.putSnap({ matchId: id, t, reason: 'テスト', kind: t === T1 ? 'kill' : 'death', header: null, blob: await mk(t) });
  }, { ms, id: m2.id, T1, T2 });

  // live screen
  await page.goto(U + '#live'); await page.reload(); await page.waitForTimeout(800);
  const popover = page.locator('details:has(#fast)'); if (await popover.count()) await popover.first().evaluate(d => d.open = true);
  check('live: #rec checkbox removed', (await page.locator('#rec').count()) === 0);
  check('live: description shown', (await page.locator('#still-note').textContent()).includes('映像は保存しません'));
  await page.screenshot({ path: path.join(SH, '01_live.png') });

  // b) review with stills
  await page.goto(U + '#match/' + encodeURIComponent(m2.id)); await page.reload(); await page.waitForTimeout(800);
  const tg = page.locator('#review-toggle'); if (!(await tg.isChecked())) await tg.check();
  await page.waitForTimeout(400);
  const imgOk = await page.waitForFunction(() => { const i = document.querySelector('#still-img'); return i && i.style.display !== 'none' && i.naturalWidth > 0; }, null, { timeout: 5000 }).then(() => true, () => false);
  check('b) still image displayed', imgOk);
  check('b) stills summary in header', ((await page.locator('#stills-info').textContent().catch(() => '')) || '').includes('静止画 2枚・合計 4 KB（映像は保存されていません）'));
  check('b) 確認画面に動画の要素・録画ファイルを選ぶ入力が無い（D62）', (await page.locator('#rv').count()) === 0 && (await page.locator('#vf').count()) === 0);
  const rows = await page.$$eval('#etab tr.click', trs => trs.map(t => +t.dataset.t));
  const near = t => [T1, T2].reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a);
  const lo = Math.min(...rows), hi = Math.max(...rows);
  await page.locator(`#etab tr.click[data-t="${lo}"]`).first().click(); await page.waitForTimeout(300);
  const cap1 = await page.locator('#still-cap').textContent();
  await page.screenshot({ path: path.join(SH, '02_review_still.png') });
  await page.locator(`#etab tr.click[data-t="${hi}"]`).first().click(); await page.waitForTimeout(300);
  const cap2 = await page.locator('#still-cap').textContent();
  check('b) row click switches to nearest still', cap1 !== cap2 && cap1.includes(mss(near(lo))) && cap2.includes(mss(near(hi))), `${cap1} | ${cap2}`);
  const before = (await page.evaluate(id => window.inkgraph.db.getMatch(id), m2.id)).review.added.length;
  await page.locator('button.add[data-k="kill"]').click(); await page.waitForTimeout(600);
  const after = (await page.evaluate(id => window.inkgraph.db.getMatch(id), m2.id)).review.added.length;
  check('b) missed-add works without video', after === before + 1 && errors.length === 0, errors.join(';'));

  // c) match without stills
  await page.goto(U + '#match/' + encodeURIComponent(m3.id)); await page.reload(); await page.waitForTimeout(800);
  const tg3 = page.locator('#review-toggle'); if (!(await tg3.isChecked())) await tg3.check();
  await page.waitForTimeout(400);
  const emptyTxt = await page.locator('#still-empty').textContent();
  const emptyVis = await page.locator('#still-empty').isVisible();
  check('c) 「静止画なし」 shown for match without stills', emptyVis && emptyTxt.includes('静止画なし'), emptyTxt);
  await page.screenshot({ path: path.join(SH, '03_review_no_still.png') });

  // d) videos store empty
  const nVideos = await page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('inkgraph'); r.onsuccess = () => { const q = r.result.transaction('videos').objectStore('videos').count(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); }));
  check('d) IndexedDB videos store is empty', nVideos === 0, `count=${nVideos}`);
  check('no page errors', errors.length === 0, errors.join(';'));
} catch (e) {
  console.log('FAIL exception', e.message); results.push(false);
} finally {
  await browser.close(); srv.kill();
}
const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
