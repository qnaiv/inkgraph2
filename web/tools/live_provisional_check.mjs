import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { recountDiff } from '../src/core/live_counts.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const ROOT_DIR = path.resolve(WEB_DIR, '..');
const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

const arg = (k, def) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const videoPath = path.resolve(arg('--video', '/workspace/igc/rules/22-15-50_match03.mp4'));

// ============================================================================
// 1. 純関数の単体テスト (recountDiff)
// ============================================================================

// Case 1-1: 全て同じ（差分なし）
const sameRes = recountDiff({ k: 5, d: 3, sp: 2 }, { k: 5, d: 3, sp: 2 });
check('recountDiff: same counts returns changed: []', sameRes.changed.length === 0);
check('recountDiff: same counts text matches specification', sameRes.text === '試合後の数え直しでも同じ数でした', sameRes.text);

// Case 1-2: 1項目違い（キル違い）
const diffK = recountDiff({ k: 5, d: 3, sp: 2 }, { k: 4, d: 3, sp: 2 });
check('recountDiff: 1 item diff (kill) returns 1 changed item', diffK.changed.length === 1);
check('recountDiff: 1 item diff (kill) changed fields',
  diffK.changed[0]?.key === 'k' &&
  diffK.changed[0]?.label === 'キル' &&
  diffK.changed[0]?.from === 5 &&
  diffK.changed[0]?.to === 4);
check('recountDiff: 1 item diff (kill) text matches specification',
  diffK.text === '試合後の数え直しで キル 5→4 に直しました', diffK.text);

// Case 1-3: 1項目違い（デス違い）
const diffD = recountDiff({ k: 5, d: 3, sp: 2 }, { k: 5, d: 4, sp: 2 });
check('recountDiff: 1 item diff (death) text matches specification',
  diffD.text === '試合後の数え直しで デス 3→4 に直しました', diffD.text);

// Case 1-4: 1項目違い（スペシャル違い）
const diffSp = recountDiff({ k: 1, d: 0, sp: 0 }, { k: 1, d: 0, sp: 2 });
check('recountDiff: 1 item diff (special) text matches specification',
  diffSp.text === '試合後の数え直しで スペシャル発動 0→2 に直しました', diffSp.text);

// Case 1-5: 複数違い（キルとデス違い）
const diffKD = recountDiff({ k: 5, d: 3, sp: 2 }, { k: 4, d: 4, sp: 2 });
check('recountDiff: multiple diff (kill & death) returns 2 changed items', diffKD.changed.length === 2);
check('recountDiff: multiple diff (kill & death) text matches specification',
  diffKD.text === '試合後の数え直しで キル 5→4、デス 3→4 に直しました', diffKD.text);

// Case 1-6: 複数違い（全項目違い）
const diffAll = recountDiff({ k: 0, d: 0, sp: 0 }, { k: 1, d: 2, sp: 3 });
check('recountDiff: all 3 diff returns 3 changed items', diffAll.changed.length === 3);
check('recountDiff: all 3 diff text joins with Japanese comma',
  diffAll.text === '試合後の数え直しで キル 0→1、デス 0→2、スペシャル発動 0→3 に直しました', diffAll.text);

// ============================================================================
// 2. ブラウザ実走テスト (Playwright)
// ============================================================================

if (!fs.existsSync(videoPath)) {
  console.error(`Video file not found at ${videoPath}`);
  process.exit(1);
}

const PORT = 4236;
const U = `http://127.0.0.1:${PORT}/`;
try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: WEB_DIR,
  stdio: 'ignore',
  detached: true
});
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required']
});

let page = null;
const shotDir = path.resolve(ROOT_DIR, 'docs/screenshots/live-provisional');
fs.mkdirSync(shotDir, { recursive: true });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', r => r.abort());

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(U + '#live');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.getSession, null, { timeout: 10000 });

  // DB 初期化
  await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const ms = await db.allMatches();
    for (const m of ms) await db.deleteMatch(m.id);
  });

  // 初期状態チェック
  const initBadgeText = await page.$eval('#live-count-badge', el => el.textContent.trim());
  const initBadgeTitle = await page.$eval('#live-count-badge', el => el.getAttribute('title') || '');
  const initBadgeClass = await page.$eval('#live-count-badge', el => el.className);
  const initNoteHidden = await page.$eval('#live-recount-note', el => el.hidden);

  check('Initial state: badge shows 「速報」', initBadgeText === '速報', initBadgeText);
  check('Initial state: badge title matches spec',
    initBadgeTitle === '試合中の数字は速報です。試合後に映像全体を数え直して確定します', initBadgeTitle);
  check('Initial state: badge has is-provisional class', initBadgeClass.includes('is-provisional'));
  check('Initial state: recount note is hidden', initNoteHidden);

  // ファイル入力
  await page.locator('input[name=src][value=file]').check({ force: true });
  await page.setInputFiles('#file', videoPath);
  await page.waitForTimeout(400);

  // 高速モードが ON であることを確認
  const fastChecked = await page.$eval('#fast', el => el.checked);
  if (!fastChecked) {
    await page.$eval('#fast', el => { el.checked = true; el.dispatchEvent(new Event('change')); });
  }

  // 解析開始
  await page.click('#start');

  // 試合開始を待機し、試合中の「速報」バッジを確認
  const inBattle = await page.waitForFunction(() => {
    const s = window.inkgraph.getSession?.();
    const st = document.querySelector('#state')?.textContent || '';
    return s && s.running && (st.includes('解析中') || st.includes('0:'));
  }, null, { timeout: 40000 }).then(() => true).catch(() => false);
  check('During match: analysis running', inBattle);

  // 試合中の数字が動いた（キルかデスが 1 以上）ところで確かめる。動かなければバトル開始の行で妥協する
  const counted = await page.waitForFunction(() => (+document.querySelector('#k')?.textContent || 0) + (+document.querySelector('#d')?.textContent || 0) > 0,
    null, { timeout: 180000 }).then(() => true).catch(() => false);
  check('During match: live count moved before save', counted);
  const provisionalBadgeText = await page.$eval('#live-count-badge', el => el.textContent.trim());
  const provisionalBadgeTitle = await page.$eval('#live-count-badge', el => el.getAttribute('title') || '');
  const provisionalBadgeClass = await page.$eval('#live-count-badge', el => el.className);
  check('During match: badge shows 「速報」', provisionalBadgeText === '速報', provisionalBadgeText);
  check('During match: badge title remains provisional description',
    provisionalBadgeTitle === '試合中の数字は速報です。試合後に映像全体を数え直して確定します', provisionalBadgeTitle);
  check('During match: badge has is-provisional class', provisionalBadgeClass.includes('is-provisional'));

  // スクリーンショット 01-provisional.png
  const shot1 = path.join(shotDir, '01-provisional.png');
  await page.screenshot({ path: shot1 });
  check('Screenshot: saved 01-provisional.png', fs.existsSync(shot1));

  // 試合保存を待機
  const saved = await page.waitForFunction(() => {
    const st = document.querySelector('#state')?.textContent || '';
    return st.includes('保存しました');
  }, null, { timeout: 150000 }).then(() => true).catch(() => false);
  check('After save: state shows 「保存しました」', saved);

  // 確定後のバッジ検証
  const finalBadgeText = await page.$eval('#live-count-badge', el => el.textContent.trim());
  const finalBadgeClass = await page.$eval('#live-count-badge', el => el.className);
  check('After save: badge shows 「確定」', finalBadgeText === '確定', finalBadgeText);
  check('After save: badge has is-final class', finalBadgeClass.includes('is-final'));

  // 保存レコードの effective と表示数字の一致確認
  const matchData = await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const ms = await db.allMatches();
    if (!ms.length) return null;
    const m = ms[0];
    const ev = window.inkgraph.analysis.effective(m);
    const effK = ev.filter(x => x.kind === 'kill').length;
    const effD = ev.filter(x => x.kind === 'death').length;
    const effSp = ev.filter(x => x.kind === 'special').length;
    const dispK = Number(document.querySelector('#k')?.textContent || '0');
    const dispD = Number(document.querySelector('#d')?.textContent || '0');
    const dispSp = Number(document.querySelector('#sp')?.textContent || '0');
    const noteText = document.querySelector('#live-recount-note')?.textContent || '';
    const noteHidden = document.querySelector('#live-recount-note')?.hidden;
    const logText = document.querySelector('#log')?.textContent || '';
    return { effK, effD, effSp, dispK, dispD, dispSp, noteText, noteHidden, logText };
  });

  check('After save: DB has saved match', !!matchData);
  check('After save: displayed kills match effective',
    matchData?.dispK === matchData?.effK, `disp=${matchData?.dispK}, eff=${matchData?.effK}`);
  check('After save: displayed deaths match effective',
    matchData?.dispD === matchData?.effD, `disp=${matchData?.dispD}, eff=${matchData?.effD}`);
  check('After save: displayed specials match effective',
    matchData?.dispSp === matchData?.effSp, `disp=${matchData?.dispSp}, eff=${matchData?.effSp}`);

  // 注記が表示されていることを確認
  check('After save: recount note is visible', !matchData?.noteHidden);
  check('After save: recount note mentions 数え直し',
    matchData?.noteText.includes('数え直し'), matchData?.noteText);

  // 差分があった場合イベントログに数え直し行が追加されているか
  if (matchData?.noteText.includes('に直しました')) {
    check('After save: event log contains recount row',
      matchData?.logText.includes('数え直し：'), matchData?.logText);
  }

  // スクリーンショット 02-final.png
  const shot2 = path.join(shotDir, '02-final.png');
  await page.screenshot({ path: shot2 });
  check('Screenshot: saved 02-final.png', fs.existsSync(shot2));

  // --- 状態遷移の追加検証 ---
  // 新しい battle_start で「速報」に戻り注記が消えること
  await page.evaluate(() => {
    const s = window.inkgraph.getSession();
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: s.now() } });
  });

  const nextBadgeText = await page.$eval('#live-count-badge', el => el.textContent.trim());
  const nextBadgeClass = await page.$eval('#live-count-badge', el => el.className);
  const nextNoteHidden = await page.$eval('#live-recount-note', el => el.hidden);
  check('Next battle_start: badge returns to 「速報」', nextBadgeText === '速報', nextBadgeText);
  check('Next battle_start: badge has is-provisional class', nextBadgeClass.includes('is-provisional'));
  check('Next battle_start: recount note is hidden', nextNoteHidden);

  // discarded で「保存なし」になること
  await page.evaluate(() => {
    const s = window.inkgraph.getSession();
    s.cb.discarded?.({ rec: {}, interrupted: { reason: 'hidden' } });
  });

  const discardedBadgeText = await page.$eval('#live-count-badge', el => el.textContent.trim());
  const discardedBadgeClass = await page.$eval('#live-count-badge', el => el.className);
  check('Discarded: badge shows 「保存なし」', discardedBadgeText === '保存なし', discardedBadgeText);
  check('Discarded: badge has is-discarded class', discardedBadgeClass.includes('is-discarded'));

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
  try {
    process.kill(-srv.pid);
  } catch {}
}

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
