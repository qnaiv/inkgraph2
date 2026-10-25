// #133 match_type & power check tool
// Usage: node tools/match_type_power_check.mjs
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { finalizeResult, powerForMatchType } from '../src/core/result.js';
import { powerDetailText } from '../src/analysis.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/match-type-power');
fs.mkdirSync(SH, { recursive: true });
const XP_SH = path.resolve(WEB_DIR, '../docs/screenshots/x_power');
fs.mkdirSync(XP_SH, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// ---------------------------------------------------------------------------
// 1. Pure function tests (Node side)
// ---------------------------------------------------------------------------
console.log('--- Pure Function Tests ---');

// (a) header群からオープンが投票される
const S_vote = {
  celebration: [{ t: 1.0, value: 'WIN' }],
  personal: [
    { t: 2.0, header: { mode: 'ガチヤグラ', mode_score: 0.9, stage: 'ユノハナ大渓谷', stage_score: 0.85, match_type: 'bankara_open', match_type_score: 0.88 } }
  ],
  board: [
    { t: 2.5, header: { mode: 'ガチヤグラ', mode_score: 0.92, stage: 'ユノハナ大渓谷', stage_score: 0.87, match_type: 'bankara_open', match_type_score: 0.84 }, board: [] }
  ]
};
const res_vote = finalizeResult(S_vote);
check(
  'pure: (a) match_type bankara_open voted from headers',
  res_vote.match_type === 'bankara_open' && res_vote.confidence.match_type === 0.88,
  `match_type=${res_vote.match_type}, conf=${res_vote.confidence.match_type}`
);

// (b) 空なら match_type null
const S_empty = { celebration: [], personal: [], board: [] };
const res_empty = finalizeResult(S_empty);
check(
  'pure: (b) empty headers give match_type null and confidence 0',
  res_empty.match_type === null && res_empty.confidence.match_type === 0,
  `match_type=${res_empty.match_type}, conf=${res_empty.confidence.match_type}`
);

// (c) powerForMatchType の3分岐
const p_x = powerForMatchType('x');
const p_open = powerForMatchType('bankara_open');
const p_challenge = powerForMatchType('bankara_challenge');
const p_other = powerForMatchType('other');
const p_null = powerForMatchType(null);
const p_unknown = powerForMatchType('unrecognized_type');

check(
  'pure: (c1) powerForMatchType("x") -> not_shown',
  p_x.value === null && p_x.status === 'not_shown' && p_x.confidence === 0,
  JSON.stringify(p_x)
);
check(
  'pure: (c2) powerForMatchType(bankara_open/challenge/other) -> not_applicable',
  p_open.value === null && p_open.status === 'not_applicable' && p_open.confidence === 0 &&
  p_challenge.value === null && p_challenge.status === 'not_applicable' && p_challenge.confidence === 0 &&
  p_other.value === null && p_other.status === 'not_applicable' && p_other.confidence === 0,
  `open=${p_open.status}, challenge=${p_challenge.status}, other=${p_other.status}`
);
check(
  'pure: (c3) powerForMatchType(null/unknown) -> unknown_type',
  p_null.value === null && p_null.status === 'unknown_type' && p_null.confidence === 0 &&
  p_unknown.value === null && p_unknown.status === 'unknown_type' && p_unknown.confidence === 0,
  `null=${p_null.status}, unknown=${p_unknown.status}`
);

// (d) finalizeResult の既存 mode/stage/result が従来通り
const S_legacy = {
  celebration: [{ t: 1.0, value: 'LOSE' }],
  personal: [
    { t: 2.0, header: { mode: 'ガチホコバトル', mode_score: 0.93, stage: 'マテガイ放水路', stage_score: 0.89, match_type: null, match_type_score: 0 }, personal: { ka: 7, deaths: 3, specials: 2 } }
  ],
  board: []
};
const res_legacy = finalizeResult(S_legacy);
check(
  'pure: (d) finalizeResult preserves existing mode, stage, result, own',
  res_legacy.result === 'LOSE' &&
  res_legacy.mode === 'ガチホコバトル' &&
  res_legacy.stage === 'マテガイ放水路' &&
  res_legacy.own.ka === 7 &&
  res_legacy.own.deaths === 3 &&
  res_legacy.own.specials === 2 &&
  res_legacy.confidence.mode === 0.93 &&
  res_legacy.confidence.stage === 0.89,
  `result=${res_legacy.result}, mode=${res_legacy.mode}, stage=${res_legacy.stage}`
);

// (e) powerDetailText (D53)
check(
  'pure: (e1) powerDetailText not_shown + series_in_progress with x_series -> "計測中 2勝1敗"',
  powerDetailText({
    match_type: 'x',
    power: { status: 'not_shown', reason: 'series_in_progress', value: null },
    x_series: { state: 'in_progress', win: 2, lose: 1 }
  }) === '計測中 2勝1敗'
);
check(
  'pure: (e2) powerDetailText not_shown + series_in_progress without win/lose -> "計測中"',
  powerDetailText({
    match_type: 'x',
    power: { status: 'not_shown', reason: 'series_in_progress', value: null }
  }) === '計測中'
);
check(
  'pure: (e3) powerDetailText not_shown + series_unknown -> "計測の進み不明"',
  powerDetailText({
    match_type: 'x',
    power: { status: 'not_shown', reason: 'series_unknown', value: null }
  }) === '計測の進み不明'
);
check(
  'pure: (e4) powerDetailText read_failed + series_finished with x_series -> "計測終了 3勝1敗・画面から読めず"',
  powerDetailText({
    match_type: 'x',
    power: { status: 'read_failed', reason: 'series_finished', value: null },
    x_series: { state: 'finished', win: 3, lose: 1 }
  }) === '計測終了 3勝1敗・画面から読めず'
);
check(
  'pure: (e5) powerDetailText read_failed + series_finished without win/lose -> "計測終了・画面から読めず"',
  powerDetailText({
    match_type: 'x',
    power: { status: 'read_failed', reason: 'series_finished', value: null }
  }) === '計測終了・画面から読めず'
);
check(
  'pure: (e6) powerDetailText other status/reason -> ""',
  powerDetailText({
    match_type: 'x',
    power: { status: 'acquired', reason: 'series_finished', value: 2150 }
  }) === '' &&
  powerDetailText({
    match_type: 'bankara_open',
    power: { status: 'not_applicable', value: null }
  }) === '' &&
  powerDetailText(null) === ''
);

// ---------------------------------------------------------------------------
// 2. Browser tests via Playwright
// ---------------------------------------------------------------------------
console.log('\n--- Browser Tests ---');

const PORT = Number(process.env.PORT) || 4196;
const U = `http://127.0.0.1:${PORT}/`;

try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true
});

let page = null;
const testIds = ['mt-test-legacy', 'mt-test-bankara', 'mt-test-x', 'mt-test-x-progress'];

const cleanup = async () => {
  if (page) {
    await page.evaluate(async ids => {
      try {
        for (const id of ids) {
          await window.inkgraph.db.delMatch(id);
        }
      } catch {}
    }, testIds).catch(() => {});
  }
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(U + '#list');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.analysis, null, { timeout: 10000 });

  await cleanup();

  // Insert 3 test matches:
  // 1) legacy match without match_type / power
  // 2) bankara_open + not_applicable
  // 3) x + not_shown
  await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const baseTime = Date.parse('2026-10-17T10:00:00Z');

    // 1) Legacy match: no match_type, no power
    await db.putMatch({
      id: 'mt-test-legacy',
      match: 1,
      created: new Date(baseTime).toISOString(),
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 10, end: 15 }],
      own_kills: [{ start: 20, end: 21 }],
      special: [],
      tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }, { t: 300, own: 50, enemy: 40, owner: 'neutral' }],
      result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'ユノハナ大渓谷', own: { ka: 5, deaths: 2, specials: 1 } },
      review: { marks: {}, added: [], fix: {} },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    });

    // 2) Bankara open match: bankara_open + not_applicable
    await db.putMatch({
      id: 'mt-test-bankara',
      match: 2,
      created: new Date(baseTime + 60000).toISOString(),
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 10, end: 15 }],
      own_kills: [{ start: 20, end: 21 }],
      special: [],
      tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }, { t: 300, own: 60, enemy: 50, owner: 'neutral' }],
      result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'マテガイ放水路', own: { ka: 8, deaths: 3, specials: 2 } },
      match_type: 'bankara_open',
      power: { value: null, status: 'not_applicable', confidence: 0 },
      review: { marks: {}, added: [], fix: {} },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    });

    // 3) X match: x + not_shown
    await db.putMatch({
      id: 'mt-test-x',
      match: 3,
      created: new Date(baseTime + 120000).toISOString(),
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 10, end: 15 }],
      own_kills: [{ start: 20, end: 21 }],
      special: [],
      tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }, { t: 300, own: 30, enemy: 80, owner: 'neutral' }],
      result_screen: { result: 'LOSE', mode: 'ガチエリア', stage: 'ヤガラ市場', own: { ka: 3, deaths: 4, specials: 0 } },
      match_type: 'x',
      power: { value: null, status: 'not_shown', confidence: 0 },
      review: { marks: {}, added: [], fix: {} },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    });

    // 4) X match with series progress (D53): not_shown + series_in_progress
    await db.putMatch({
      id: 'mt-test-x-progress',
      match: 4,
      created: new Date(baseTime + 180000).toISOString(),
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 10, end: 15 }],
      own_kills: [{ start: 20, end: 21 }],
      special: [],
      tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }, { t: 300, own: 30, enemy: 80, owner: 'neutral' }],
      result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'ヤガラ市場', own: { ka: 5, deaths: 2, specials: 1 } },
      match_type: 'x',
      power: { value: null, status: 'not_shown', reason: 'series_in_progress', confidence: 0 },
      x_series: { state: 'in_progress', win: 2, lose: 1 },
      review: { marks: {}, added: [], fix: {} },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    });
  });

  // Verify list page loads properly
  await page.goto(U + '#list');
  await page.reload();
  await page.waitForSelector('.match-row, .match-card, table, tr[data-id="mt-test-bankara"], a[href*="mt-test-bankara"]', { timeout: 5000 });
  check('browser: match list page displays test matches', true);

  // Verify match detail: legacy record
  await page.goto(U + '#match/' + encodeURIComponent('mt-test-legacy'));
  await page.waitForSelector('#match-type');
  const legacyMatchType = (await page.textContent('#match-type')).trim();
  const legacyPowerStatus = (await page.textContent('#power-status')).trim();
  check(
    'browser: legacy match detail shows "不明" / "タイプ不明"',
    legacyMatchType === '不明' && legacyPowerStatus === 'タイプ不明',
    `type="${legacyMatchType}", power="${legacyPowerStatus}"`
  );

  // Verify match detail: bankara_open record
  await page.goto(U + '#match/' + encodeURIComponent('mt-test-bankara'));
  await page.waitForSelector('#match-type');
  const bankaraMatchType = (await page.textContent('#match-type')).trim();
  const bankaraPowerStatus = (await page.textContent('#power-status')).trim();
  check(
    'browser: bankara_open detail shows "バンカラ・オープン" / "対象外"',
    bankaraMatchType === 'バンカラ・オープン' && bankaraPowerStatus === '対象外',
    `type="${bankaraMatchType}", power="${bankaraPowerStatus}"`
  );

  // Take screenshot of bankara_open detail with header visible
  const ssPath = path.join(SH, 'detail-bankara-open.png');
  await page.screenshot({ path: ssPath, fullPage: false });
  check('browser: screenshot saved to ' + ssPath, fs.existsSync(ssPath));

  // Verify match detail: x match record
  await page.goto(U + '#match/' + encodeURIComponent('mt-test-x'));
  await page.waitForSelector('#match-type');
  const xMatchType = (await page.textContent('#match-type')).trim();
  const xPowerStatus = (await page.textContent('#power-status')).trim();
  check(
    'browser: x match detail shows "Xマッチ" / "表示なし"',
    xMatchType === 'Xマッチ' && xPowerStatus === '表示なし',
    `type="${xMatchType}", power="${xPowerStatus}"`
  );

  // Verify match detail: x match with series progress (D53)
  await page.goto(U + '#match/' + encodeURIComponent('mt-test-x-progress'));
  await page.waitForSelector('#match-type');
  await page.waitForSelector('#power-note');
  const xProgStatus = (await page.textContent('#power-status')).trim();
  const xProgNote = (await page.textContent('#power-note')).trim();
  check(
    'browser: x match with series in progress shows "表示なし" and "（計測中 2勝1敗）"',
    xProgStatus === '表示なし' && xProgNote === '（計測中 2勝1敗）',
    `power="${xProgStatus}", note="${xProgNote}"`
  );

  // Take screenshot of x match with series in progress
  const xssPath = path.join(XP_SH, '03_detail_not_shown.png');
  await page.screenshot({ path: xssPath, fullPage: false });
  check('browser: screenshot saved to ' + xssPath, fs.existsSync(xssPath));

  // Verify trend page opens cleanly
  await page.goto(U + '#trend');
  await page.waitForFunction(() => document.querySelector('.page-title') || document.querySelector('h1'), null, { timeout: 5000 });
  check('browser: trend page loads without crash', true);

  // Verify no pageerror occurred
  check('browser: no pageerror detected', errors.length === 0, errors.join('; '));

  // Clean up test data
  await cleanup();
} finally {
  await browser.close().catch(() => {});
  srv.kill('SIGTERM');
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}
}

console.log('\n--- Summary ---');
const passCount = results.filter(Boolean).length;
const totalCount = results.length;
console.log(`Total: ${passCount}/${totalCount} tests PASSED`);

if (passCount !== totalCount) {
  process.exit(1);
}
