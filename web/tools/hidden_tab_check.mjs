import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// 1. テスト用動画の一時生成（約30秒、1280x720）および短い動画（約6秒）
const tmpVideoPath = path.join(os.tmpdir(), `hidden_tab_test_${Date.now()}.mp4`);
const tmpShortVideoPath = path.join(os.tmpdir(), `hidden_tab_test_short_${Date.now()}.mp4`);
try {
  execSync(`ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 30 -c:v libx264 -pix_fmt yuv420p "${tmpVideoPath}"`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 6 -c:v libx264 -pix_fmt yuv420p "${tmpShortVideoPath}"`, { stdio: 'ignore' });
} catch (e) {
  console.error('Failed to create test video with ffmpeg:', e);
  process.exit(1);
}

const PORT = 4219;
const U = `http://127.0.0.1:${PORT}/`;
try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
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

  // ファイル入力を設定
  await page.setInputFiles('#file', tmpVideoPath);
  await page.waitForTimeout(300);

  // #fast のチェックを外す（通常再生で解析）
  const fastChecked = await page.$eval('#fast', el => el.checked);
  if (fastChecked) {
    await page.$eval('#fast', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
  }

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

  // --- Case 4: ファイル通常再生で動画末尾まで再生 → 自動停止・先頭に戻らない・interruptedなし ---
  // 前のセッションを停止
  await page.evaluate(async () => {
    const s = window.inkgraph.getSession?.();
    if (s && s.running) await s.stop();
  });
  await page.waitForFunction(() => {
    const s = window.inkgraph.getSession?.();
    return !s || !s.running;
  }, null, { timeout: 5000 });

  // 警告表示をリセット
  await page.evaluate(() => {
    const warn = document.getElementById('live-capture-warn');
    if (warn) warn.hidden = true;
  });

  // 6秒のテスト用動画を設定
  await page.setInputFiles('#file', tmpShortVideoPath);
  await page.waitForTimeout(300);

  // #fast がオフであることを確認
  const isFastNow = await page.$eval('#fast', el => el.checked);
  if (isFastNow) {
    await page.$eval('#fast', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
  }

  // 開始
  await page.click('#start');
  await page.waitForFunction(() => {
    const s = window.inkgraph.getSession?.();
    return s && s.running && s.stats && s.stats.frames >= 1;
  }, null, { timeout: 10000 });

  // interrupted 監視と、試合中状態（battle_start）を設定
  await page.evaluate(() => {
    window.__case4Interrupted = [];
    const s = window.inkgraph.getSession();
    const origInterrupted = s.cb.interrupted;
    s.cb.interrupted = (info) => {
      window.__case4Interrupted.push(info);
      if (origInterrupted) origInterrupted(info);
    };
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: s.now() } });
  });

  // 動画末尾（約6秒）に達してセッションが自動停止するのを待つ
  const stoppedAuto = await page.waitForFunction(() => {
    const s = window.inkgraph.getSession?.();
    return s && !s.running;
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  check('Case 4 Video end: session stopped automatically (running is false)', stoppedAuto);

  // 少し待っても再生が先頭に戻らないか確認（ウォッチドッグや遅延 resume が play() しないか確認）
  await page.waitForTimeout(1000);

  const videoState = await page.evaluate(() => {
    const v = document.getElementById('v');
    const s = window.inkgraph.getSession?.();
    return {
      currentTime: v.currentTime,
      duration: v.duration,
      ended: v.ended,
      running: s?.running,
      guardInterrupted: s?.guard?.interrupted,
      interruptedCalls: window.__case4Interrupted?.length || 0
    };
  });

  check('Case 4 Video end: currentTime is near duration (not reset to beginning)',
    videoState.currentTime >= videoState.duration - 0.5 && videoState.currentTime >= 5.0,
    `currentTime=${videoState.currentTime}, duration=${videoState.duration}`);

  check('Case 4 Video end: interrupted was not notified',
    videoState.interruptedCalls === 0 && !videoState.guardInterrupted,
    `calls=${videoState.interruptedCalls}, guardInterrupted=${JSON.stringify(videoState.guardInterrupted)}`);

  const warnHiddenCase4 = await page.$eval('#live-capture-warn', el => el.hidden);
  check('Case 4 Video end: #live-capture-warn remained hidden', warnHiddenCase4);

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
  try { fs.unlinkSync(tmpVideoPath); } catch {}
  try { fs.unlinkSync(tmpShortVideoPath); } catch {}
}

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
