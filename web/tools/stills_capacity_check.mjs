// #32 stage 2 check: stills capacity (250MB). usage: node tools/stills_capacity_check.mjs
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/stills-capacity');
fs.mkdirSync(SH, { recursive: true });

try { execSync('fuser -k 4193/tcp 2>/dev/null'); } catch {}

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

const ids = Array.from({ length: 12 }, (_, i) => `cap-test-${String(i + 1).padStart(2, '0')}`);
const PORT = 4193, U = `http://127.0.0.1:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
let page = null;

const cleanup = async () => {
  if (page) {
    await page.evaluate(async ids => {
      try {
        localStorage.removeItem('inkgraph.testCapBytes');
        for (const id of ids) await window.inkgraph.db.delMatch(id);
      } catch {}
    }, ids).catch(() => {});
  }
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(U + '#list');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.capacity, null, { timeout: 10000 });

  // 1. Initial cleanup
  await cleanup();

  // Helper to create synthetic matches
  const createMatches = async (matchConfigs) => {
    await page.evaluate(async (configs) => {
      const db = window.inkgraph.db;
      const mk = () => new Promise(res => {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 36;
        const x = c.getContext('2d');
        x.fillStyle = '#2a6';
        x.fillRect(0, 0, 64, 36);
        c.toBlob(res, 'image/jpeg', 0.8);
      });
      const base = Date.parse('2026-01-01T00:00:00Z');
      for (let i = 0; i < configs.length; i++) {
        const cfg = configs[i];
        await db.putMatch({
          id: cfg.id,
          match: i + 1,
          created: new Date(base + i * 60000).toISOString(),
          battle: [0, 300],
          squid_down: {},
          own_deaths: [{ start: 10, end: 15 }],
          own_kills: [{ start: 20, end: 21 }],
          special: [],
          tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }],
          result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'テスト', own: { deaths: 1, specials: 0 } },
          review: { marks: { 'death@10.0': 'ok' }, added: [], fix: {} },
          stills: { count: 1, bytes: cfg.bytes ?? 100 },
          stillsState: 'kept',
          favorite: !!cfg.favorite,
          video: { kind: 'none' }
        });
        await db.putSnap({ matchId: cfg.id, t: 10, reason: 'テスト', kind: 'death', header: null, blob: await mk() });
      }
    }, matchConfigs);
  };

  // --------------------------------------------------------------------------
  // a) summarize/plan pure via db: cap=1000, 12 matches * 100 bytes = 1200 > cap.
  // ids[0] is favorite. enforceCapacity(1000) should delete oldest non-fav until <= 900.
  // --------------------------------------------------------------------------
  const initialConfigs = ids.map((id, i) => ({ id, bytes: 100, favorite: i === 0 }));
  await createMatches(initialConfigs);

  const usageBefore = await page.evaluate(() => window.inkgraph.db.stillsUsage(1000));
  check('a) stillsUsage before cleanup', usageBefore.usedBytes === 1200 && usageBefore.ratio === 1.2 && usageBefore.level === 'block', `used=${usageBefore.usedBytes}`);

  const enforceRes = await page.evaluate(() => window.inkgraph.db.enforceCapacity(1000));
  check('a) enforceCapacity deletes oldest 3 non-favorites',
    JSON.stringify(enforceRes.removed) === JSON.stringify([ids[1], ids[2], ids[3]]),
    `removed=${enforceRes.removed.join(',')}`
  );
  check('a) enforceCapacity summaryAfter is <= 90%', enforceRes.summaryAfter.usedBytes === 900 && enforceRes.summaryAfter.ratio === 0.9, `after=${enforceRes.summaryAfter.usedBytes}`);

  const match0 = await page.evaluate(id => window.inkgraph.db.getMatch(id), ids[0]);
  const match0Snaps = await page.evaluate(id => window.inkgraph.db.snapsOf(id), ids[0]);
  check('a) oldest favorite match NOT removed', match0.favorite === true && match0.stillsState === 'kept' && match0Snaps.length === 1);

  const removedMatch = await page.evaluate(id => window.inkgraph.db.getMatch(id), ids[1]);
  const removedSnaps = await page.evaluate(id => window.inkgraph.db.snapsOf(id), ids[1]);
  check('a) removed match: record/review/meta kept, state=deleted, snaps=0',
    removedMatch.stillsState === 'deleted' && removedMatch.stills?.count === 1 && removedMatch.stills?.bytes === 100 &&
    removedMatch.review?.marks?.['death@10.0'] === 'ok' && removedSnaps.length === 0
  );

  // --------------------------------------------------------------------------
  // b) favOnlyOver: all favorites, total > cap => enforceCapacity removes 0, favOnlyOver true
  // --------------------------------------------------------------------------
  await cleanup();
  const allFavConfigs = ids.map(id => ({ id, bytes: 100, favorite: true }));
  await createMatches(allFavConfigs);

  const favOverRes = await page.evaluate(() => window.inkgraph.db.enforceCapacity(1000));
  check('b) favOnlyOver: removes 0 matches', favOverRes.removed.length === 0, `removed=${favOverRes.removed.length}`);
  check('b) favOnlyOver flag is true', favOverRes.favOnlyOver === true);

  // --------------------------------------------------------------------------
  // c) UI 80% warn: ratio 80-94% (e.g. used 850 / cap 1000)
  // --------------------------------------------------------------------------
  await cleanup();
  // 8 matches * 100 + 1 match * 50 = 850 bytes
  const warnConfigs = [
    { id: ids[0], bytes: 100, favorite: false },
    { id: ids[1], bytes: 100, favorite: false },
    { id: ids[2], bytes: 100, favorite: false },
    { id: ids[3], bytes: 100, favorite: false },
    { id: ids[4], bytes: 100, favorite: false },
    { id: ids[5], bytes: 100, favorite: false },
    { id: ids[6], bytes: 100, favorite: false },
    { id: ids[7], bytes: 100, favorite: false },
    { id: ids[8], bytes: 50, favorite: false }
  ];
  await createMatches(warnConfigs);

  await page.evaluate(() => localStorage.setItem('inkgraph.testCapBytes', '1000'));
  await page.goto(U + '#list');
  await page.reload();
  await page.waitForSelector('.capacity-banner');

  const bannerVisibleList = await page.isVisible('.capacity-banner');
  check('c) list page: .capacity-banner visible at 85%', bannerVisibleList);

  const bannerTextList = await page.locator('.capacity-banner').textContent();
  const warnRegex = /使用量\s*85%\s*（あと約\d+試合分）/;
  check('c) list page: banner text matches 使用量85%（あと約◯試合分）', warnRegex.test(bannerTextList), bannerTextList.trim());

  const cleanupBtnPresent = await page.locator('.capacity-cleanup-btn').count();
  check('c) list page: .capacity-cleanup-btn present in banner', cleanupBtnPresent >= 1);

  const statusCountList = await page.locator('.capacity-status').count();
  check('c) list page: .capacity-status hidden when banner shown', statusCountList === 0);

  await page.screenshot({ path: path.join(SH, '01_list_warn.png') });

  // Test live page at 80% warn
  await page.goto(U + '#live');
  await page.reload();
  await page.waitForSelector('.capacity-banner');

  const bannerVisibleLive = await page.isVisible('.capacity-banner');
  check('c) live page: .capacity-banner visible at 85%', bannerVisibleLive);

  const statusCountLive = await page.locator('.capacity-status').count();
  check('c) live page: .capacity-status hidden when banner shown', statusCountLive === 0);

  const startDisabledWarn = await page.isDisabled('#start');
  check('c) live page: #start is NOT disabled at 85% warn', startDisabledWarn === false);

  const blockReasonCountWarn = await page.locator('.capacity-block-reason').count();
  check('c) live page: .capacity-block-reason not present at 85% warn', blockReasonCountWarn === 0);

  // --------------------------------------------------------------------------
  // d) UI 95% block: ratio >= 95% (used 850 / cap 880 = 97% block)
  // --------------------------------------------------------------------------
  await page.evaluate(() => localStorage.setItem('inkgraph.testCapBytes', '880'));
  await page.goto(U + '#live');
  await page.reload();
  await page.waitForSelector('.capacity-block-reason');

  const startDisabledBlock = await page.isDisabled('#start');
  check('d) live page: #start IS disabled at >=95% block', startDisabledBlock === true);

  const blockReasonVisible = await page.isVisible('.capacity-block-reason');
  check('d) live page: .capacity-block-reason is visible', blockReasonVisible);

  const reasonText = await page.locator('.capacity-block-reason').textContent();
  check('d) live page: reason text explains block and remedies',
    reasonText.includes('解析を始められる上限（95%）を超えています') && reasonText.includes('古い試合の静止画を消すと始められます'),
    reasonText.trim()
  );

  const notInsideActions = await page.evaluate(() => document.querySelector('.capacity-block-reason')?.closest('.live-source-actions') === null);
  check('d) live page: .capacity-block-reason is NOT inside .live-source-actions', notInsideActions === true);

  // Test guard on #start onclick (even if button somehow enabled)
  const dialogPromise = page.waitForEvent('dialog');
  await page.evaluate(() => {
    const btn = document.querySelector('#start');
    btn.removeAttribute('disabled');
    btn.click();
  });
  const dialog = await dialogPromise;
  const alertMsg = dialog.message();
  await dialog.dismiss();
  check('d) live page: #start onclick blocked with alert', alertMsg.includes('上限（95%）'), alertMsg);

  await page.screenshot({ path: path.join(SH, '02_live_block.png') });

  // --------------------------------------------------------------------------
  // e) Cleanup via UI banner button [古い試合の静止画を整理する]
  // Setup: 12 matches of 100 bytes = 1200 bytes, cap 1000 (ratio 120% > 100%)
  // --------------------------------------------------------------------------
  await cleanup();
  const cleanupConfigs = ids.map((id, i) => ({ id, bytes: 100, favorite: i === 0 }));
  await createMatches(cleanupConfigs);

  await page.evaluate(() => localStorage.setItem('inkgraph.testCapBytes', '1000'));
  await page.goto(U + '#live');
  await page.reload();
  await page.waitForSelector('.capacity-cleanup-btn');

  const btnText = await page.locator('.capacity-cleanup-btn').textContent();
  check('e) banner button text is 古い試合の静止画を整理する', btnText.includes('古い試合の静止画を整理する'), btnText);

  await page.click('.capacity-cleanup-btn');
  await page.waitForSelector('.capacity-dialog');

  const dialogVisible = await page.isVisible('.capacity-dialog');
  check('e) cleanup dialog visible', dialogVisible);

  const targetText = await page.locator('.capacity-dialog-target').textContent();
  check('e) target text matches /古い順の\\d+試合/', /古い順の\d+試合/.test(targetText), targetText);

  const dialogText = await page.locator('.capacity-dialog').textContent();
  check('e) dialog notes contain 戻せない and 記録と正解データ', dialogText.includes('戻せない') && (dialogText.includes('記録と正解データ') || dialogText.includes('記録は残ります')));

  const backupBtnCount = await page.locator('.capacity-dialog-backup').count();
  const feedbackBtnCount = await page.locator('.capacity-dialog-feedback').count();
  check('e) shortcut buttons present', backupBtnCount >= 1 && feedbackBtnCount >= 1);

  const execBtnText = await page.locator('.capacity-dialog-execute').textContent();
  check('e) execute button text exact', execBtnText.trim() === '静止画だけを消す（記録は残ります）', execBtnText);

  await page.click('.capacity-dialog-execute');
  await page.waitForSelector('.capacity-cleanup-result');

  const resultText = await page.locator('.capacity-cleanup-result').textContent();
  check('e) result text matches format', /\d+試合分の静止画を消しました。使用量は\d+%です/.test(resultText), resultText);

  const usageAfterCleanup = await page.evaluate(() => window.inkgraph.db.stillsUsage(1000));
  check('e) cleanup button: usage drops to <= 75%', usageAfterCleanup.usedBytes <= 750 && usageAfterCleanup.ratio <= 0.75, `after=${usageAfterCleanup.usedBytes}`);

  await page.click('.capacity-dialog-close-result');
  await page.waitForSelector('.capacity-dialog', { state: 'detached' });
  await page.waitForSelector('#start:not([disabled])', { timeout: 5000 });

  const startDisabledAfter = await page.isDisabled('#start');
  check('e) cleanup button: #start is re-enabled after dropping below 95%', startDisabledAfter === false);

  await page.screenshot({ path: path.join(SH, '03_live_warn_or_list_after_cleanup.png') });

  // --------------------------------------------------------------------------
  // f) Label contains no "MB" anywhere in .capacity-status or .capacity-banner
  // --------------------------------------------------------------------------
  const allStatusTexts = await page.locator('.capacity-status').allTextContents();
  const allBannerTexts = await page.locator('.capacity-banner').allTextContents();
  const allCapTexts = [...allStatusTexts, ...allBannerTexts];
  const containsMb = allCapTexts.some(t => /mb/i.test(t));
  check('f) capacity UI labels contain no "MB"', !containsMb, allCapTexts.join(' | '));

  // --------------------------------------------------------------------------
  // g) fav-only UI: all favorites totalling >cap (e.g. 12x100, cap1000)
  // --------------------------------------------------------------------------
  await cleanup();
  const favOnlyConfigs = ids.map(id => ({ id, bytes: 100, favorite: true }));
  await createMatches(favOnlyConfigs);

  await page.evaluate(() => localStorage.setItem('inkgraph.testCapBytes', '1000'));
  await page.goto(U + '#list');
  await page.reload();
  await page.waitForSelector('.capacity-banner');

  const favBannerText = await page.locator('.capacity-banner').textContent();
  check('g) fav-only UI: banner text contains お気に入りの試合だけで容量がいっぱいです',
    favBannerText.includes('お気に入りの試合だけで容量がいっぱいです'),
    favBannerText.trim()
  );

  const favCleanupBtnCount = await page.locator('.capacity-cleanup-btn').count();
  check('g) fav-only UI: no cleanup button in banner', favCleanupBtnCount === 0);

  const favStatusCount = await page.locator('.capacity-status').count();
  check('g) fav-only UI: .capacity-status hidden', favStatusCount === 0);

  check('f) no pageerror during test', errors.length === 0, errors.join('; '));

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
