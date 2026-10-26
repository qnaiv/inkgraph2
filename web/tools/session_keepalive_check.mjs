// Verification of session keepalive during navigation across pages
// 注: 裏タブ（document.hidden）での解析継続はヘッドレス環境で再現・保証できないため未確認。実機確認が必要。
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/session-keepalive');
fs.mkdirSync(SH, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// 1. テスト用動画の一時生成（約12秒、1280x720）
const tmpVideoPath = path.join(os.tmpdir(), `keepalive_test_${Date.now()}.mp4`);
try {
  execSync(`ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 12 -c:v libx264 -pix_fmt yuv420p "${tmpVideoPath}"`, { stdio: 'ignore' });
} catch (e) {
  console.error('Failed to create test video with ffmpeg:', e);
  process.exit(1);
}

const PORT = 4207;
const U = `http://127.0.0.1:${PORT}/`;
try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true
});

let page = null;
const SEED_MATCH_ID = 'keepalive-seed-match';

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // ライブ画面を開く
  await page.goto(U + '#live');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.getSession, null, { timeout: 10000 });

  // 詳細画面遷移検証用のシード試合を1件投入
  await page.evaluate(async (id) => {
    await window.inkgraph.db.putMatch({
      id,
      match: 1,
      created: new Date().toISOString(),
      battle: [0, 300],
      squid_down: {},
      own_deaths: [],
      own_kills: [],
      special: [],
      tower_series: [],
      result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: '海女美術大学', own: { ka: 5, deaths: 2, specials: 1 } },
      stills: { count: 0, bytes: 0 },
      video: { kind: 'none' },
      source: { kind: 'device', name: 'テスト用シード', height: 720, owner: 'self' }
    });
  }, SEED_MATCH_ID);

  // ファイル入力を設定
  await page.setInputFiles('#file', tmpVideoPath);
  await page.waitForTimeout(300);

  // #fast のチェックを外す（通常再生で解析）
  const fastChecked = await page.$eval('#fast', el => el.checked);
  if (fastChecked) {
    await page.$eval('#fast', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
  }
  const fastAfter = await page.$eval('#fast', el => el.checked);
  check('Setup: #fast unchecked for normal playback', !fastAfter);

  // 解析開始をクリック
  await page.click('#start');

  // 解析開始とフレーム増加の確認
  const started = await page.waitForFunction(() => {
    const s = window.inkgraph.getSession?.();
    return s && s.running && s.stats && s.stats.frames >= 3;
  }, null, { timeout: 10000 }).then(() => true).catch(() => false);
  check('Live: session started and frames advancing', started);

  const initialPaused = await page.evaluate(() => {
    const v = document.getElementById('v');
    return v ? v.paused : null;
  });
  check('Live: video element is playing (paused === false)', initialPaused === false);

  // 1. 試合一覧へ遷移
  await page.click('nav [data-page="list"]');
  await page.waitForTimeout(500);

  // ライブの <video id="v"> が document 内に残っていること(isConnected)
  const listVideoStatus = await page.evaluate(() => {
    const v = document.getElementById('v');
    const slotLive = document.getElementById('slot-live');
    const slotNormal = document.getElementById('slot-normal');
    return {
      exists: !!v,
      isConnected: v ? v.isConnected : false,
      slotLiveDisplay: slotLive ? getComputedStyle(slotLive).display : null,
      slotNormalDisplay: slotNormal ? getComputedStyle(slotNormal).display : null,
      paused: v ? v.paused : null,
      frames: window.inkgraph.getSession()?.stats?.frames
    };
  });
  check('List page: <video id="v"> remains connected to document', listVideoStatus.exists && listVideoStatus.isConnected);
  check('List page: #slot-live is display:none and #slot-normal is visible', listVideoStatus.slotLiveDisplay === 'none' && listVideoStatus.slotNormalDisplay !== 'none');
  check('List page: video is not paused', listVideoStatus.paused === false);

  // スクリーンショット1: 記録中に一覧を表示している画面
  // （一覧側に記録中であることを示す要素はUI仕様にないためそのまま撮影。キャプションはPR本文で説明）
  await page.screenshot({ path: path.join(SH, '01_list_while_recording.png') });

  // 1秒以上待って stats.frames が増え続けることを確認
  const listFramesBefore = listVideoStatus.frames;
  await page.waitForTimeout(1500);
  const listFramesAfter = await page.evaluate(() => window.inkgraph.getSession()?.stats?.frames);
  check('List page: stats.frames continues to advance while in list page', listFramesAfter > listFramesBefore, `before=${listFramesBefore}, after=${listFramesAfter}`);

  // 2. 傾向ページへ遷移
  await page.click('nav [data-page="trend"]');
  await page.waitForTimeout(500);
  const trendFramesBefore = await page.evaluate(() => window.inkgraph.getSession()?.stats?.frames);
  const trendPaused = await page.evaluate(() => document.getElementById('v')?.paused);
  check('Trend page: video remains playing (paused === false)', trendPaused === false);

  await page.waitForTimeout(1500);
  const trendFramesAfter = await page.evaluate(() => window.inkgraph.getSession()?.stats?.frames);
  check('Trend page: stats.frames continues to advance while in trend page', trendFramesAfter > trendFramesBefore, `before=${trendFramesBefore}, after=${trendFramesAfter}`);

  // 3. 試合詳細画面へ遷移
  await page.evaluate(id => window.inkgraph.nav('match', id), SEED_MATCH_ID);
  await page.waitForTimeout(500);
  const matchFramesBefore = await page.evaluate(() => window.inkgraph.getSession()?.stats?.frames);
  const matchPaused = await page.evaluate(() => document.getElementById('v')?.paused);
  const reviewVideoExists = await page.evaluate(() => !document.getElementById('rv')); // D62: 確認画面の動画の要素は無くなった（ライブの #v だけ）
  check('Match detail page: video remains playing (paused === false)', matchPaused === false);
  check('Match detail page: no review video #rv (D62); live video #v keeps playing', reviewVideoExists);

  await page.waitForTimeout(1500);
  const matchFramesAfter = await page.evaluate(() => window.inkgraph.getSession()?.stats?.frames);
  check('Match detail page: stats.frames continues to advance while in match page', matchFramesAfter > matchFramesBefore, `before=${matchFramesBefore}, after=${matchFramesAfter}`);

  // 4. ライブ画面へ戻る
  await page.click('nav [data-page="live"]');
  await page.waitForTimeout(500);

  const returnLiveStatus = await page.evaluate(() => {
    const v = document.getElementById('v');
    const slotLive = document.getElementById('slot-live');
    return {
      exists: !!v,
      isConnected: v ? v.isConnected : false,
      slotLiveDisplay: slotLive ? getComputedStyle(slotLive).display : null,
      videoDisplay: v ? getComputedStyle(v).display : null,
      paused: v ? v.paused : null,
      frames: window.inkgraph.getSession()?.stats?.frames
    };
  });
  check('Return to Live: #slot-live is visible again', returnLiveStatus.slotLiveDisplay !== 'none');
  check('Return to Live: <video id="v"> is visible', returnLiveStatus.videoDisplay !== 'none');
  check('Return to Live: video is still playing without user intervention', returnLiveStatus.paused === false);

  // 操作なしで stats.frames が増え続けることを確認
  const returnFramesBefore = returnLiveStatus.frames;
  await page.waitForTimeout(1500);
  const returnFramesAfter = await page.evaluate(() => window.inkgraph.getSession()?.stats?.frames);
  check('Return to Live: stats.frames continues advancing', returnFramesAfter > returnFramesBefore, `before=${returnFramesBefore}, after=${returnFramesAfter}`);

  // スクリーンショット2: ライブへ戻った直後の画面
  await page.screenshot({ path: path.join(SH, '02_live_after_return.png') });

  // セッション停止
  await page.evaluate(async () => {
    await window.inkgraph.getSession()?.stop();
  });
  const stoppedRunning = await page.evaluate(() => window.inkgraph.getSession()?.running);
  check('Cleanup: session stopped cleanly', stoppedRunning === false);

  // シードデータ削除
  await page.evaluate(async id => {
    try { await window.inkgraph.db.delMatch(id); } catch {}
  }, SEED_MATCH_ID);

  check('No uncaught page errors during test', errors.length === 0, errors.join('; '));

} catch (e) {
  console.log('FAIL exception:', e.message, e.stack);
  results.push(false);
} finally {
  await browser.close();
  srv.kill();
  try { fs.unlinkSync(tmpVideoPath); } catch {}
}

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
