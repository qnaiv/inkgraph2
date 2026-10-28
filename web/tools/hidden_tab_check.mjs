import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { startPreview } from './lib/preview_server.mjs';
import { fakeDevice } from './lib/fake_device.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};


const PORT = 4219;
const U = `http://127.0.0.1:${PORT}/`;
try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true
});

let page = null;

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(U + '#live');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.getSession, null, { timeout: 10000 });

  // DB を初期化
  await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const ms = await db.allMatches();
    for (const m of ms) await db.deleteMatch(m.id);
  });

  // キャプチャーボードの代わりに、canvas の映像を使う
  await fakeDevice(page);

  // 解析開始
  await page.click('#start');
  const started = await page.waitForFunction(() => {
    const s = window.inkgraph.getSession?.();
    return s && s.running && s.stats && s.stats.frames >= 3;
  }, null, { timeout: 10000 }).then(() => true).catch(() => false);
  check('Setup: session started and running in normal mode', started);

  const initialCount = await page.evaluate(async () => (await window.inkgraph.db.allMatches()).length);
  check('Setup: initial DB match count is 0', initialCount === 0);

  // --- Case 1: 試合中に hidden になり破棄されるケース ---
  const rec1 = {
    match: 1,
    battle: [0, 300],
    squid_down: {},
    own_deaths: [],
    own_kills: [],
    special: [],
    tower_series: [],
    result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: '海女美術大学', own: { ka: 5, deaths: 2, specials: 1 } },
    review: { marks: {}, added: [], fix: {} }
  };

  await page.evaluate(async (rec) => {
    const s = window.inkgraph.getSession();
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: s.now() } });

    // document.visibilityState を 'hidden' に見せかけて visibilitychange
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));

    // 'visible' に戻して再度 dispatch
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    // 試合終了レコードを受信
    s.onMsg({ type: 'match', rec });
    await s.saving;
  }, rec1);

  const countAfterDiscard = await page.evaluate(async () => (await window.inkgraph.db.allMatches()).length);
  check('Hidden discard: db match count did not increase', countAfterDiscard === 0);

  const warnVisible = await page.$eval('#live-capture-warn', el => !el.hidden && getComputedStyle(el).display !== 'none');
  check('Hidden discard: #live-capture-warn is visible', warnVisible);

  const reasonText = await page.$eval('#live-capture-warn-reason', el => el.textContent);
  check('Hidden discard: warn reason mentions 裏に回り', reasonText.includes('裏に回り'), reasonText);

  const stateText = await page.$eval('#state', el => el.textContent);
  check('Hidden discard: #state mentions 保存しませんでした', stateText.includes('保存しませんでした'), stateText);

  const savedText = await page.$eval('#saved', el => el.textContent);
  check('Hidden discard: #saved shows 0件', savedText.includes('0') || savedText === '', savedText);

  const isVoid = await page.$eval('.live-stats-row', el => el.classList.contains('is-void'));
  check('Hidden discard: .live-stats-row has is-void class', isVoid);

  // スクリーンショット撮影
  const screenshotPath = path.resolve(WEB_DIR, '../docs/screenshots/hidden-tab-discard.png');
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath });
  check('Hidden discard screenshot: saved hidden-tab-discard.png', fs.existsSync(screenshotPath));

  // --- Case 2: 続けて次の試合（通常保存される） ---
  const rec2 = {
    match: 2,
    battle: [310, 610],
    squid_down: {},
    own_deaths: [],
    own_kills: [],
    special: [],
    tower_series: [],
    result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: '海女美術大学', own: { ka: 3, deaths: 1, specials: 2 } },
    review: { marks: {}, added: [], fix: {} }
  };

  await page.evaluate(async () => {
    const s = window.inkgraph.getSession();
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: s.now() } });
  });

  const warnHiddenNext = await page.$eval('#live-capture-warn', el => el.hidden);
  check('Next match: #live-capture-warn reset to hidden', warnHiddenNext);

  const isVoidRemoved = await page.$eval('.live-stats-row', el => !el.classList.contains('is-void'));
  check('Next match: is-void removed from .live-stats-row', isVoidRemoved);

  await page.evaluate(async (rec) => {
    const s = window.inkgraph.getSession();
    s.onMsg({ type: 'match', rec });
    await s.saving;
  }, rec2);

  const countAfterSaved = await page.evaluate(async () => (await window.inkgraph.db.allMatches()).length);
  check('Next match: db match count increased to 1', countAfterSaved === 1);

  const stateSavedText = await page.$eval('#state', el => el.textContent);
  check('Next match: #state shows 保存しました', stateSavedText.includes('保存しました'), stateSavedText);

  const savedCountAfter = await page.$eval('#saved', el => el.textContent);
  check('Next match: #saved shows 1件', savedCountAfter.includes('1'), savedCountAfter);

  // --- Case 3: stall（フレーム間隔停止）で破棄されるケース ---
  const rec3 = {
    match: 3,
    battle: [620, 920],
    squid_down: {},
    own_deaths: [],
    own_kills: [],
    special: [],
    tower_series: [],
    result_screen: { result: 'LOSE', mode: 'ガチヤグラ', stage: '海女美術大学', own: { ka: 1, deaths: 4, specials: 0 } },
    review: { marks: {}, added: [], fix: {} }
  };

  await page.evaluate(async (rec) => {
    const s = window.inkgraph.getSession();
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: s.now() } });

    // 4秒間隔のフレームギャップをシミュレート
    const mark = s.guard.frame(performance.now() + 4000);
    if (mark) s._notifyInterrupted(mark);

    s.onMsg({ type: 'match', rec });
    await s.saving;
  }, rec3);

  const countAfterStall = await page.evaluate(async () => (await window.inkgraph.db.allMatches()).length);
  check('Stall discard: db match count did not increase (still 1)', countAfterStall === 1);

  const stateStallText = await page.$eval('#state', el => el.textContent);
  check('Stall discard: #state mentions 保存しませんでした', stateStallText.includes('保存しませんでした'), stateStallText);

  const stallReasonText = await page.$eval('#live-capture-warn-reason', el => el.textContent);
  check('Stall discard: reason mentions 映像の取り込みが約', stallReasonText.includes('映像の取り込みが約') || stallReasonText.includes('秒止まったため'), stallReasonText);

  check('No uncaught page errors', errors.length === 0, errors.join('; '));
} catch (e) {
  console.error('FAIL exception:', e);
  results.push(false);
} finally {
  try {
    if (page) {
      await page.evaluate(async () => {
        const s = window.inkgraph?.getSession?.();
        if (s) await s.stop();
      }).catch(() => {});
    }
  } catch {}
  await browser.close().catch(() => {});
  srv.kill();
}

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
