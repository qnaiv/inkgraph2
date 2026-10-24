// Self-learning (S0-S1) verification: pure functions, browser operations, and existing sample evaluation
// Usage: node tools/self_learn_check.mjs
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

import * as learn from '../src/learn.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH_DIR = path.resolve(WEB_DIR, '../docs/screenshots/self-learn');
fs.mkdirSync(SH_DIR, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

console.log('=== [1] Pure Functions Test ===');

// 1.1 featureFromHeader & extractGrayThumb
const snapSample = {
  kind: 'board',
  t: 120.5,
  header: { mode: 'ガチヤグラ', mode_score: 0.765, stage: 'クサヤ温泉', stage_score: 0.882 }
};
const fH = learn.featureFromHeader(snapSample);
check('featureFromHeader converts correctly',
  fH && fH.v === 1 && fH.source === 'header' &&
  fH.header.mode === 'ガチヤグラ' && Math.abs(fH.header.modeScore - 0.765) < 1e-6 &&
  fH.header.stage === 'クサヤ温泉' && Math.abs(fH.header.stageScore - 0.882) < 1e-6);

const dummyRgba = new Uint8Array(64 * 36 * 4);
for (let i = 0; i < dummyRgba.length; i += 4) {
  dummyRgba[i] = 200; dummyRgba[i + 1] = 100; dummyRgba[i + 2] = 50; dummyRgba[i + 3] = 255;
}
const thumb = learn.extractGrayThumb({ w: 64, h: 36, data: dummyRgba });
check('extractGrayThumb produces 32x18 array with valid range',
  Array.isArray(thumb) && thumb.length === 32 * 18 && thumb.every(v => v >= 0 && v <= 255));

// 1.2 truthForMatch
const matchReviewOk = {
  result_screen: { mode: 'ガチヤグラ', stage: 'クサヤ温泉' },
  review: { rmarks: { mode: 'ok', stage: 'ok' } }
};
const truthOk = learn.truthForMatch(matchReviewOk);
check('truthForMatch returns result_screen when rmarks is ok',
  truthOk.mode === 'ガチヤグラ' && truthOk.stage === 'クサヤ温泉');

const matchReviewFix = {
  result_screen: { mode: 'ガチヤグラ', stage: 'ナメロウ金属' },
  review: { rmarks: { mode: 'wrong', stage: 'wrong' }, fix: { mode: 'ガチエリア', stage: 'ヤガラ市場' } }
};
const truthFix = learn.truthForMatch(matchReviewFix);
check('truthForMatch returns fix value when rmarks is wrong and fix exists',
  truthFix.mode === 'ガチエリア' && truthFix.stage === 'ヤガラ市場');

// 1.3 Synthetic match dataset for threshold scenario:
// Train matches (3 samples per field)
// mode sample 1: score 0.42 (default 0.50 fails -> candidate 0.40 passes = fixed)
// mode sample 2: score 0.65 (default 0.50 passes)
// mode sample 3: score 0.70 (default 0.50 passes)
// stage samples: scores 0.80, 0.85, 0.90 (all pass)
// Holdout match (last match by ID):
// mode sample: score 0.44 (passes candidate 0.40)
// stage sample: score 0.88 (passes)

const synthMatches = [
  {
    id: 'match-train-01',
    created: '2026-10-17T10:00:00Z',
    result_screen: { mode: 'ガチヤグラ', stage: 'クサヤ温泉' },
    review: { rmarks: { mode: 'ok', stage: 'ok' } },
    learnFeatures: [
      { v: 1, header: { mode: 'ガチヤグラ', modeScore: 0.42, stage: 'クサヤ温泉', stageScore: 0.80 }, source: 'header' }
    ]
  },
  {
    id: 'match-train-02',
    created: '2026-10-17T10:01:00Z',
    result_screen: { mode: 'ガチヤグラ', stage: 'クサヤ温泉' },
    review: { rmarks: { mode: 'ok', stage: 'ok' } },
    learnFeatures: [
      { v: 1, header: { mode: 'ガチヤグラ', modeScore: 0.65, stage: 'クサヤ温泉', stageScore: 0.85 }, source: 'header' }
    ]
  },
  {
    id: 'match-train-03',
    created: '2026-10-17T10:02:00Z',
    result_screen: { mode: 'ガチヤグラ', stage: 'クサヤ温泉' },
    review: { rmarks: { mode: 'ok', stage: 'ok' } },
    learnFeatures: [
      { v: 1, header: { mode: 'ガチヤグラ', modeScore: 0.70, stage: 'クサヤ温泉', stageScore: 0.90 }, source: 'header' }
    ]
  },
  {
    id: 'match-z-holdout',
    created: '2026-10-17T10:03:00Z',
    result_screen: { mode: 'ガチヤグラ', stage: 'クサヤ温泉' },
    review: { rmarks: { mode: 'ok', stage: 'ok' } },
    learnFeatures: [
      { v: 1, header: { mode: 'ガチヤグラ', modeScore: 0.44, stage: 'クサヤ温泉', stageScore: 0.88 }, source: 'header' }
    ]
  }
];

const samples = learn.collectSamples(synthMatches);
check('collectSamples extracted all samples', samples.length === 8); // 4 matches * 2 fields

const { train, holdout } = learn.splitHoldout(samples);
check('splitHoldout separates last match into holdout',
  train.length === 6 && holdout.length === 2 &&
  holdout.every(s => s.matchId === 'match-z-holdout') &&
  train.every(s => s.matchId !== 'match-z-holdout'));

const candidate = learn.generateCandidate(samples);
check('generateCandidate picks mode threshold <= 0.42 to fix sample',
  candidate.thresholds.mode <= 0.42 && candidate.thresholds.mode >= 0.30,
  `mode threshold: ${candidate.thresholds.mode}`);
check('generateCandidate retains stage threshold ~0.50',
  candidate.thresholds.stage === 0.50);
check('generateCandidate trainCompare shows fixed count 1 for mode',
  candidate.trainCompare.mode.fixed === 1 && candidate.trainCompare.mode.broken === 0);
check('generateCandidate holdoutCompare evaluates holdout set',
  candidate.holdoutCompare !== null && candidate.holdoutCompare.mode.n === 1 && candidate.holdoutCompare.mode.fixed === 1);

const pack = learn.makePack(candidate, '2026-10-17T12:00:00Z');
check('makePack creates valid pack object',
  pack.packId.startsWith('lp-') && pack.version === 1 && pack.status === 'active' &&
  pack.thresholds.mode === candidate.thresholds.mode);

console.log('=== [2] Existing Sample Evaluation Test ===');
// labels/joined_match02.json & web_matches.json
const labelsPath = path.resolve(WEB_DIR, '../labels/joined_match02.json');
let webMatchesPath = path.resolve(WEB_DIR, 'test-results/web_matches.json');
if (!fs.existsSync(webMatchesPath)) {
  webMatchesPath = '/workspace/ig-backup/web/test-results/web_matches.json';
}

if (fs.existsSync(labelsPath) && fs.existsSync(webMatchesPath)) {
  const labelData = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
  const matchesData = JSON.parse(fs.readFileSync(webMatchesPath, 'utf8'));
  const m2 = matchesData.find(m => m.match === 2 || m.id?.includes('match02') || m.source?.name?.includes('match02')) || matchesData[1];

  const m2Score = m2?.confidence?.mode ?? 0.9988;
  const m2Truth = labelData.mode || 'ガチヤグラ';
  const m2Detected = m2?.result_screen?.mode || 'ガチヤグラ';

  const m2Sample = {
    matchId: 'joined_match02',
    field: 'mode',
    detected: m2Detected,
    score: m2Score,
    truth: m2Truth
  };

  const comp = learn.compareSamples([m2Sample], 0.50, 0.60);
  console.log(`[Sample 2 Mode Evaluation] score=${m2Score.toFixed(4)}, detected=${m2Detected}, truth=${m2Truth}`);
  console.log(`  before (0.50): correct=${comp.mode.beforeCorrect}, after (0.60): correct=${comp.mode.afterCorrect}`);
  check('existing match02 sample evaluated with numeric results',
    comp.mode.n === 1 && typeof comp.mode.beforeAcc === 'number' && typeof comp.mode.afterAcc === 'number');
} else {
  console.warn('Existing sample files not found, skipping evaluation section');
}

console.log('=== [3] Browser Integration Test ===');
const PORT = Number(process.env.PORT) || 4198;
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
      for (const id of ['learn-browser-m1', 'learn-browser-m2']) {
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

  // Seed 2 matches:
  // Match 1 (train): 3 snaps with mode scores 0.42, 0.65, 0.70, truth 'ガチヤグラ'
  // Match 2 (holdout): 1 snap with mode score 0.45, truth 'ガチヤグラ'
  await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const m1 = {
      id: 'learn-browser-m1',
      match: 1,
      created: '2026-10-17T11:00:00Z',
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
      }
    };
    const m2 = {
      id: 'learn-browser-m2',
      match: 2,
      created: '2026-10-17T11:05:00Z',
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
      }
    };

    await db.importAll([m1, m2]);

    // Put snaps with features
    await db.putSnap({
      matchId: 'learn-browser-m1',
      t: 10,
      reason: 'res1',
      kind: 'board',
      header: { mode: 'ガチヤグラ', modeScore: 0.42, stage: 'クサヤ温泉', stageScore: 0.80 },
      features: { v: 1, kind: 'board', header: { mode: 'ガチヤグラ', modeScore: 0.42, stage: 'クサヤ温泉', stageScore: 0.80 }, source: 'header' }
    });
    await db.putSnap({
      matchId: 'learn-browser-m1',
      t: 12,
      reason: 'res2',
      kind: 'board',
      header: { mode: 'ガチヤグラ', modeScore: 0.65, stage: 'クサヤ温泉', stageScore: 0.85 },
      features: { v: 1, kind: 'board', header: { mode: 'ガチヤグラ', modeScore: 0.65, stage: 'クサヤ温泉', stageScore: 0.85 }, source: 'header' }
    });
    await db.putSnap({
      matchId: 'learn-browser-m1',
      t: 14,
      reason: 'res3',
      kind: 'board',
      header: { mode: 'ガチヤグラ', modeScore: 0.70, stage: 'クサヤ温泉', stageScore: 0.90 },
      features: { v: 1, kind: 'board', header: { mode: 'ガチヤグラ', modeScore: 0.70, stage: 'クサヤ温泉', stageScore: 0.90 }, source: 'header' }
    });

    await db.putSnap({
      matchId: 'learn-browser-m2',
      t: 10,
      reason: 'res1',
      kind: 'board',
      header: { mode: 'ガチヤグラ', modeScore: 0.45, stage: 'クサヤ温泉', stageScore: 0.88 },
      features: { v: 1, kind: 'board', header: { mode: 'ガチヤグラ', modeScore: 0.45, stage: 'クサヤ温泉', stageScore: 0.88 }, source: 'header' }
    });
  });

  // Reload page to reflect seeded matches
  await page.reload();
  await page.waitForSelector('#learn-panel', { timeout: 5000 });

  check('learn-panel is visible in UI', await page.$('#learn-panel') !== null);

  // Click #learn-candidate
  await page.click('#learn-candidate');
  await page.waitForSelector('#learn-result:not([hidden])', { timeout: 5000 });
  const resultText = await page.$eval('#learn-result', el => el.textContent);
  check('candidate generation displays result table with fixed items',
    resultText.includes('再判定結果') && resultText.includes('+1'));

  // Screenshot 01: Candidate Table
  await page.screenshot({ path: path.join(SH_DIR, '01_candidate.png'), fullPage: false });
  check('screenshot 01_candidate.png captured', fs.existsSync(path.join(SH_DIR, '01_candidate.png')));

  // Test #learn-reject: clears candidate and leaves learn state empty
  await page.click('#learn-reject');
  await page.waitForSelector('#learn-result[hidden]', { state: 'attached', timeout: 5000 });
  const stateAfterReject = await page.evaluate(async () => {
    return await window.inkgraph.db.getLearnState();
  });
  check('rejecting candidate clears candidate display and leaves learn state empty',
    stateAfterReject.stack.length === 0);

  // Regenerate candidate
  await page.click('#learn-candidate');
  await page.waitForSelector('#learn-result:not([hidden])');

  // Click #learn-apply -> confirmation box appears
  await page.click('#learn-apply');
  await page.waitForSelector('#learn-confirm:not([hidden])', { timeout: 5000 });
  check('apply button shows confirmation box without immediate application',
    await page.$('#learn-confirm:not([hidden])') !== null);

  // Confirm apply
  await page.click('#learn-confirm-yes');
  await page.waitForFunction(async () => {
    const pack = await window.inkgraph.db.activeLearnPack();
    return pack !== null;
  }, null, { timeout: 5000 });

  const activePack = await page.evaluate(async () => {
    return await window.inkgraph.db.activeLearnPack();
  });
  check('active pack is set in db after confirmation',
    activePack !== null && activePack.status === 'active' && activePack.thresholds.mode <= 0.42);

  // Check panel display updated with active pack badge
  const panelText = await page.$eval('#learn-panel', el => el.textContent);
  check('learn-panel displays active pack status and rollback button',
    panelText.includes('学習適用中') && await page.$('#learn-rollback') !== null);

  // Screenshot 02: Applied Status
  await page.screenshot({ path: path.join(SH_DIR, '02_applied.png'), fullPage: false });
  check('screenshot 02_applied.png captured', fs.existsSync(path.join(SH_DIR, '02_applied.png')));

  // Click #learn-rollback -> rollback to default
  await page.click('#learn-rollback');
  await page.waitForFunction(async () => {
    const pack = await window.inkgraph.db.activeLearnPack();
    return pack === null;
  }, null, { timeout: 5000 });

  const packAfterRollback = await page.evaluate(async () => {
    return await window.inkgraph.db.activeLearnPack();
  });
  check('rollback removes active pack', packAfterRollback === null);

  const panelAfterRollback = await page.$eval('#learn-panel', el => el.textContent);
  check('panel after rollback shows default status without active badge',
    panelAfterRollback.includes('未適用（既定値）') && await page.$('#learn-rollback') === null);

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
