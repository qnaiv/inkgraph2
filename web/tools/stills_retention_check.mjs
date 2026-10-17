// #32 stage 1 check: count-based still-frame retention. usage: node tools/stills_retention_check.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/stills-retention');
fs.mkdirSync(SH, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

const N = 35, KEEP = 30;
const ids = Array.from({ length: N }, (_, i) => `retain-test-${String(i + 1).padStart(2, '0')}`);

const PORT = 4192, U = `http://127.0.0.1:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
let page = null;
const cleanup = async () => { if (page) await page.evaluate(async ids => { for (const id of ids) await window.inkgraph.db.delMatch(id); }, ids).catch(() => {}); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(U + '#list');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db, null, { timeout: 10000 });

  // clean up leftovers, then create synthetic matches
  await cleanup();
  await page.evaluate(async ({ ids }) => {
    const db = window.inkgraph.db;
    const mk = () => new Promise(res => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.fillStyle = '#2a6'; x.fillRect(0, 0, 64, 36); c.toBlob(res, 'image/jpeg', 0.8); });
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < ids.length; i++) {
      await db.putMatch({
        id: ids[i], match: i + 1, created: new Date(base + i * 60000).toISOString(),
        battle: [0, 300], squid_down: {}, own_deaths: [{ start: 10, end: 15 }], own_kills: [{ start: 20, end: 21 }], special: [],
        tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }],
        result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'テスト', own: { deaths: 1, specials: 0 } },
        review: { marks: { 'death@10.0': 'ok' }, added: [], fix: {} },
        stills: { count: 1, bytes: 123 }, stillsState: 'kept', video: { kind: 'none' },
      });
      await db.putSnap({ matchId: ids[i], t: 10, reason: 'テスト', kind: 'death', header: null, blob: await mk() });
    }
    await db.setFavorite(ids[0], true);
  }, { ids });

  // enforce retention
  const removed = await page.evaluate(() => window.inkgraph.db.enforceRetention(30));
  const nonFav = ids.slice(1); // oldest first
  const expRemoved = nonFav.slice(0, nonFav.length - KEEP); // oldest 4 of non-favorites
  const info = await page.evaluate(async ids => {
    const db = window.inkgraph.db, o = {};
    for (const id of ids) { const m = await db.getMatch(id); o[id] = { n: (await db.snapsOf(id)).length, m }; }
    return o;
  }, ids);
  check('a) removed ids = oldest non-favorites', JSON.stringify([...removed].sort()) === JSON.stringify([...expRemoved].sort()), removed.join(','));
  const withSnaps = ids.filter(id => info[id].n > 0);
  check('a) 31 matches keep stills (30 newest + favorite)', withSnaps.length === KEEP + 1, `${withSnaps.length}`);
  check('a) newest 30 non-favorites keep stills', nonFav.slice(-KEEP).every(id => info[id].n === 1));
  check('b) favorite keeps stills and is not deleted', info[ids[0]].n === 1 && info[ids[0]].m.favorite === true && info[ids[0]].m.stillsState === 'kept');
  check('c) deleted matches: record, review.marks, stills meta kept, state=deleted',
    expRemoved.every(id => { const m = info[id].m; return m && m.review?.marks?.['death@10.0'] === 'ok' && m.stills?.count === 1 && m.stills?.bytes === 123 && m.stillsState === 'deleted' && info[id].n === 0; }));
  const total = await page.evaluate(async ids => { let t = 0; for (const id of ids) t += (await window.inkgraph.db.snapsOf(id)).length; return t; }, ids);
  check('d) total snaps = 31', total === KEEP + 1, `${total}`);
  check('d) stillsStateOf helper', await page.evaluate(async ({ a, b }) => {
    const db = window.inkgraph.db; const ma = await db.getMatch(a), mb = await db.getMatch(b);
    return db.stillsStateOf(ma, 0) === 'deleted' && db.stillsStateOf(mb, 1) === 'kept' && db.stillsStateOf({}, 0) === 'none' && db.stillsStateOf(ma) === 'deleted';
  }, { a: expRemoved[0], b: ids[0] }));

  // manual deleteStills on a kept match
  const target = ids[N - 1];
  const upd = await page.evaluate(async id => {
    const db = window.inkgraph.db; const r = await db.deleteStills(id); const m = await db.getMatch(id);
    return { ret: r?.stillsState, n: (await db.snapsOf(id)).length, state: m?.stillsState, marks: m?.review?.marks, cnt: m?.stills?.count };
  }, target);
  check('e) deleteStills: snaps 0, record+review kept, state deleted', upd.ret === 'deleted' && upd.n === 0 && upd.state === 'deleted' && upd.marks?.['death@10.0'] === 'ok' && upd.cnt === 1, JSON.stringify(upd));

  // list UI
  await page.goto(U + '#list'); await page.reload(); await page.waitForTimeout(1000);
  const favCount = await page.locator('.fav-btn').count();
  check('f) list has .fav-btn / .stills-state / 静止画だけ消す', favCount >= N && (await page.locator('.stills-state').count()) >= N && (await page.locator('.del-stills', { hasText: '静止画だけ消す' }).count()) >= N, `fav=${favCount}`);
  const texts = await page.locator('.stills-state').allTextContents();
  check('f) 削除済み and 保持中 labels shown', texts.some(t => t.includes('削除済み')) && texts.some(t => t.includes('保持中')), [...new Set(texts)].join(' | '));
  const favTxt = await page.locator(`.fav-btn[data-id="${ids[0]}"]`).textContent();
  check('f) favorite shows ★', favTxt.trim() === '★', favTxt);
  await page.screenshot({ path: path.join(SH, '01_list.png') });

  // trends
  await page.goto(U + '#trend'); await page.reload(); await page.waitForTimeout(1200);
  const title = await page.locator('.page-title').first().textContent();
  check('g) trends counts all 35 matches incl. deleted stills', title.includes(`${N}試合`), title.trim());
  check('g) no pageerror', errors.length === 0, errors.join(';'));
  await page.screenshot({ path: path.join(SH, '02_trends.png') });
} catch (e) {
  check('unexpected error', false, e.stack || String(e));
} finally {
  await cleanup();
  await browser.close();
  srv.kill();
}
const fails = results.filter(r => !r).length;
console.log(fails ? `\nFAILED ${fails}/${results.length}` : `\nALL PASS (${results.length})`);
process.exit(fails ? 1 : 0);
