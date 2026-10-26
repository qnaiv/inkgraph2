// Self-learning (S2) verification: learn pack versions, switching, rollback, deactivation, and migration
// Usage: node tools/learn_pack_check.mjs
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

import * as learn from '../src/learn.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH_DIR = path.resolve(WEB_DIR, '../docs/screenshots/learn-pack');
fs.mkdirSync(SH_DIR, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

console.log('=== [1] Pure Functions & Helper Test ===');

check('thresholdsOfPack returns pack thresholds or default',
  learn.thresholdsOfPack({ thresholds: { mode: 0.42, stage: 0.55 } }).mode === 0.42 &&
  learn.thresholdsOfPack(null).mode === 0.50);

check('packDisplayName returns packId or fallback',
  learn.packDisplayName({ packId: 'lp-test-01' }) === 'lp-test-01' &&
  learn.packDisplayName(null) === '既定（0.50）');

console.log('=== [2] Browser Integration & DB Versioning Test ===');
const PORT = Number(process.env.PORT) || 4199;
const U = `http://127.0.0.1:${PORT}/`;
const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true
});

let page = null;
const cleanup = async () => {
  if (page) {
    await page.evaluate(async () => {
      const db = window.inkgraph?.db;
      if (!db) return;
      for (const id of ['learn-pkg-m1', 'learn-pkg-m2']) {
        await db.delMatch(id).catch(() => {});
      }
      await db.putLearnState({ stack: [] }).catch(() => {});
    }).catch(() => {});
  }
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(U + '#list');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.learn && window.inkgraph.db, null, { timeout: 10000 });
  await cleanup();

  // 2.1 Test getLearnState on empty DB
  const s0 = await page.evaluate(async () => {
    return await window.inkgraph.db.getLearnState();
  });
  check('getLearnState on empty returns normalized state',
    Array.isArray(s0.stack) && s0.stack.length === 0 &&
    Array.isArray(s0.versions) && s0.versions.length === 0 &&
    s0.activePackId === null);

  // 2.2 Test migration from legacy { stack: [pack] } without versions
  const sMigrate = await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const legacyPack = {
      packId: 'lp-legacy-01',
      version: 1,
      thresholds: { mode: 0.45, stage: 0.50 },
      sourceMatchIds: ['m1'],
      created: '2026-10-17T09:00:00Z',
      status: 'active'
    };
    // Directly put legacy record without versions field
    await db.putLearnState({ stack: [legacyPack] });
    return await db.getLearnState();
  });
  check('legacy {stack} migrated to versions and activePackId',
    sMigrate.versions.length === 1 && sMigrate.versions[0].packId === 'lp-legacy-01' &&
    sMigrate.activePackId === 'lp-legacy-01');

  // Reset learn state
  await page.evaluate(async () => {
    await window.inkgraph.db.putLearnState({ stack: [] });
  });

  // 2.3 Seed matches and create 2 distinct packs: Pack A (mode 0.40) & Pack B (mode 0.70)
  const synthMatch1 = {
    id: 'learn-pkg-m1',
    match: 1,
    created: '2026-10-17T10:00:00Z',
    battle: [0, 300],
    squid_down: {},
    own_deaths: [],
    own_kills: [],
    special: [],
    tower_series: [],
    result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { deaths: 0, specials: 0 } },
    review: {
      rmarks: { mode: 'ok', stage: 'ok' },
      export: { state: 'accumulated' }
    },
    learnFeatures: [
      // Sample 1: modeScore 0.45, truth 'ガチヤグラ'
      // Default (0.50) fails. Pack A (0.40) passes. Pack B (0.70) fails.
      { v: 1, header: { mode: 'ガチヤグラ', modeScore: 0.45, stage: 'クサヤ温泉', stageScore: 0.85 }, source: 'header' }
    ]
  };

  const synthMatch2 = {
    id: 'learn-pkg-m2',
    match: 2,
    created: '2026-10-17T10:05:00Z',
    battle: [0, 300],
    squid_down: {},
    own_deaths: [],
    own_kills: [],
    special: [],
    tower_series: [],
    result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { deaths: 0, specials: 0 } },
    review: {
      rmarks: { mode: 'ok', stage: 'ok' },
      export: { state: 'accumulated' }
    },
    learnFeatures: [
      // Sample 2: modeScore 0.65, truth 'ガチヤグラ'
      // Default (0.50) passes. Pack A (0.40) passes. Pack B (0.70) fails.
      { v: 1, header: { mode: 'ガチヤグラ', modeScore: 0.65, stage: 'クサヤ温泉', stageScore: 0.90 }, source: 'header' }
    ]
  };

  await page.evaluate(async ({ m1, m2 }) => {
    const db = window.inkgraph.db;
    await db.importAll([m1, m2]);
  }, { m1: synthMatch1, m2: synthMatch2 });

  // 2.4 Apply Pack A & Pack B via db.applyLearnPack
  const packAData = {
    packId: 'lp-pack-a',
    version: 1,
    thresholds: { mode: 0.40, stage: 0.50 },
    sourceMatchIds: ['learn-pkg-m1'],
    metrics: null,
    created: '2026-10-17T10:10:00Z',
    status: 'active',
    base: 's0s1'
  };

  const packBData = {
    packId: 'lp-pack-b',
    version: 1,
    thresholds: { mode: 0.70, stage: 0.50 },
    sourceMatchIds: ['learn-pkg-m1', 'learn-pkg-m2'],
    metrics: null,
    created: '2026-10-17T10:20:00Z',
    status: 'active',
    base: 's0s1'
  };

  const savedPacks = await page.evaluate(async ({ pA, pB }) => {
    const db = window.inkgraph.db;
    const a = await db.applyLearnPack(pA);
    const b = await db.applyLearnPack(pB);
    return { a, b };
  }, { pA: packAData, pB: packBData });

  check('applyLearnPack saves 2 versions and sets top as active',
    savedPacks.a.packId === 'lp-pack-a' && savedPacks.b.packId === 'lp-pack-b');

  // Test duplicate packId auto-uniquification: apply pack B again
  const dupB = await page.evaluate(async pB => {
    return await window.inkgraph.db.applyLearnPack(pB);
  }, packBData);
  check('applyLearnPack uniquifies conflicting packId with -2',
    dupB.packId === 'lp-pack-b-2');

  const versionsList = await page.evaluate(async () => {
    return await window.inkgraph.db.listLearnPacks();
  });
  check('listLearnPacks returns versions in newest-first order',
    versionsList.length === 3 &&
    versionsList.map(p => p.packId).includes('lp-pack-a') &&
    versionsList.map(p => p.packId).includes('lp-pack-b') &&
    versionsList.map(p => p.packId).includes('lp-pack-b-2'));

  // 2.5 Rescoring accuracy changes with Pack A vs Pack B vs Default
  const rescoreResults = await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const learn = window.inkgraph.learn;
    const ms = await db.allMatches();
    const samples = learn.collectSamples(ms);

    // Active is currently lp-pack-b-2 (mode: 0.70)
    const activeB = await db.activeLearnPack();
    const cmpB = learn.compareSamples(samples, learn.DEFAULT_THRESHOLDS, activeB.thresholds);

    // Switch to Pack A (mode: 0.40)
    await db.activateLearnPack('lp-pack-a');
    const activeA = await db.activeLearnPack();
    const cmpA = learn.compareSamples(samples, learn.DEFAULT_THRESHOLDS, activeA.thresholds);

    return { cmpB, cmpA, activeAId: activeA.packId };
  });

  check('activateLearnPack switches active pack to Pack A',
    rescoreResults.activeAId === 'lp-pack-a');
  check('rescore accuracy differs between Pack A and Pack B',
    rescoreResults.cmpA.mode.afterCorrect === 2 && // 0.45 and 0.65 both pass (> 0.40)
    rescoreResults.cmpB.mode.afterCorrect === 0);   // 0.45 and 0.65 both fail (<= 0.70)

  // 2.6 Rollback returns to previous pack (lp-pack-b-2) without deleting versions
  const rollbackResult = await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const rolled = await db.rollbackLearnPack();
    const state = await db.getLearnState();
    return { rolledId: rolled?.packId, versionCount: state.versions.length };
  });
  check('rollbackLearnPack reverts to previous pack and retains all versions',
    rollbackResult.rolledId === 'lp-pack-b-2' && rollbackResult.versionCount === 3);

  // 2.7 Deactivate empties stack (reverts to default) but retains versions
  const deactResult = await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const res = await db.deactivateLearnPack();
    const active = await db.activeLearnPack();
    const state = await db.getLearnState();
    return { res, active, versionCount: state.versions.length };
  });
  check('deactivateLearnPack empties stack to default while keeping versions intact',
    deactResult.res === null && deactResult.active === null && deactResult.versionCount === 3);

  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  console.log('=== [3] UI Integration Test (Learn Panel & Pack Versions) ===');

  // Reload list page
  await page.reload();
  await page.waitForSelector('#learn-panel', { timeout: 5000 });

  // Check version table rendered
  const hasVersionTable = await page.$('.learn-versions-table') !== null;

  check('versions table is rendered in learn panel', hasVersionTable);

  const tableText = await page.$eval('.learn-versions-table', el => el.textContent);
  check('versions table contains Pack A and Pack B rows',
    tableText.includes('lp-pack-a') && tableText.includes('lp-pack-b'));

  // Verify switch button for inactive version
  const switchBtns = await page.$$('.learn-switch-btn');
  check('switch buttons exist for inactive versions', switchBtns.length >= 2);

  // Click "この版を使う" on Pack A row
  const packASwitchBtn = await page.$(`.learn-switch-btn[data-pack-id="lp-pack-a"]`);
  check('Pack A has "この版を使う" button', packASwitchBtn !== null);
  await packASwitchBtn.click();

  // Wait for switch confirm card (#learn-switch-confirm)
  await page.waitForSelector('#learn-switch-confirm', { timeout: 5000 });
  const confirmText = await page.$eval('#learn-switch-confirm', el => el.textContent);
  check('switch confirm card displays comparison table and action buttons',
    confirmText.includes('版切り替えの確認') &&
    confirmText.includes('lp-pack-a') &&
    await page.$('#learn-switch-confirm-yes') !== null &&
    await page.$('#learn-switch-confirm-no') !== null);

  // Click "確認して切り替える"
  await page.click('#learn-switch-confirm-yes');
  await page.waitForFunction(async () => {
    const pack = await window.inkgraph.db.activeLearnPack();
    return pack?.packId === 'lp-pack-a';
  }, null, { timeout: 5000 });

  const activeAfterSwitch = await page.evaluate(async () => {
    return await window.inkgraph.db.activeLearnPack();
  });
  check('confirming switch activates Pack A in db',
    activeAfterSwitch?.packId === 'lp-pack-a');

  // Verify UI reflects active state and shows "未適用に戻す" button
  await page.waitForSelector('#learn-deactivate', { timeout: 5000 });
  const panelHtml = await page.$eval('#learn-panel', el => el.innerHTML);
  check('panel displays active badge and deactivate button (#learn-deactivate)',
    panelHtml.includes('学習適用中') && await page.$('#learn-deactivate') !== null);

  // Take screenshot: docs/screenshots/learn-pack/01_versions.png
  await page.screenshot({ path: path.join(SH_DIR, '01_versions.png'), fullPage: false });
  check('screenshot 01_versions.png captured', fs.existsSync(path.join(SH_DIR, '01_versions.png')));

  // Test "未適用に戻す" button via UI
  await page.click('#learn-deactivate');
  await page.waitForFunction(async () => {
    const pack = await window.inkgraph.db.activeLearnPack();
    return pack === null;
  }, null, { timeout: 5000 });

  const activeAfterDeact = await page.evaluate(async () => {
    return await window.inkgraph.db.activeLearnPack();
  });
  check('clicking "未適用に戻す" reverts to default',
    activeAfterDeact === null);

  // Clean up
  await cleanup();
} finally {
  await browser.close();
  srv.kill('SIGTERM');
}

console.log('=== Test Summary ===');
const allPass = results.length > 0 && results.every(Boolean);
if (allPass) {
  console.log(`ALL PASS (${results.length}/${results.length})`);
  process.exit(0);
} else {
  const passed = results.filter(Boolean).length;
  console.error(`FAIL (${passed}/${results.length} passed)`);
  process.exit(1);
}
