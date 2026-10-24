// Verification of result missing / partial / read status and result_source
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

import { finalizeResult } from '../src/core/result.js';
import {
  resultStatus,
  RESULT_STATUS_LABEL,
  resultSourceLabel,
  resultOf,
  frameStepForState,
  RESULT_FRAME_STEP
} from '../src/analysis.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/result-missing');
fs.mkdirSync(SH, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// ============================================================================
// 前半: Node直接importでの純粋関数検証
// ============================================================================

// 1. finalizeResult
{
  // a) celebration由来
  const rCel = finalizeResult({
    celebration: [{ t: 10, value: 'WIN' }, { t: 10.2, value: 'WIN' }],
    personal: [],
    board: []
  });
  check('finalizeResult: celebration WIN gives result_source="celebration"',
    rCel.result === 'WIN' && rCel.result_source === 'celebration',
    `result=${rCel.result}, source=${rCel.result_source}`
  );

  const rCelLose = finalizeResult({
    celebration: [{ t: 10, value: 'LOSE' }],
    personal: [],
    board: []
  });
  check('finalizeResult: celebration LOSE gives result_source="celebration"',
    rCelLose.result === 'LOSE' && rCelLose.result_source === 'celebration'
  );

  // b) board由来 (celebration無し、boardのownから決定)
  const rBoard = finalizeResult({
    celebration: [],
    personal: [],
    board: [{
      t: 20,
      header: { mode: 'ガチヤグラ', mode_score: 0.9, stage: '海女美術大学', stage_score: 0.9 },
      board: [
        { group: 'top', idx: 0, own: true, ka: 10, deaths: 2, specials: 3 },
        { group: 'bot', idx: 0, own: false, ka: 3, deaths: 5, specials: 1 }
      ]
    }]
  });
  check('finalizeResult: board own gives result_source="board"',
    rBoard.result === 'WIN' && rBoard.result_source === 'board',
    `result=${rBoard.result}, source=${rBoard.result_source}`
  );

  // c) none (celebrationもboard ownも無し)
  const rNone = finalizeResult({
    celebration: [],
    personal: [],
    board: []
  });
  check('finalizeResult: empty cues gives result=null, result_source=null',
    rNone.result === null && rNone.result_source === null
  );

  const rBoardNoOwn = finalizeResult({
    celebration: [],
    personal: [],
    board: [{
      t: 20,
      header: { mode: 'ガチヤグラ', mode_score: 0.9, stage: '海女美術大学', stage_score: 0.9 },
      board: [
        { group: 'top', idx: 0, own: false, ka: 10, deaths: 2, specials: 3 }
      ]
    }]
  });
  check('finalizeResult: board without own gives result_source=null',
    rBoardNoOwn.result === null && rBoardNoOwn.result_source === null
  );
}

// 2. resultStatus
{
  // a) read
  const stRead = resultStatus({
    result_screen: {
      result: 'WIN',
      mode: 'ガチヤグラ',
      stage: '海女美術大学',
      own: { ka: 12, deaths: 3, specials: 2 }
    }
  });
  check('resultStatus: read when result, mode, stage, own all present',
    stRead.key === 'read' && stRead.label === RESULT_STATUS_LABEL.read,
    JSON.stringify(stRead)
  );

  // b) missing
  const stMissing = resultStatus({
    result_screen: { result: null, mode: null, stage: null, own: null },
    confidence: { celebration_frames: 0, personal_frames: 0, board_frames: 0 }
  });
  check('resultStatus: missing when no result, mode, stage, own or frame cues',
    stMissing.key === 'missing' && stMissing.label === RESULT_STATUS_LABEL.missing,
    JSON.stringify(stMissing)
  );

  // c) partial
  const stPartResOnly = resultStatus({
    result_screen: { result: 'WIN', mode: null, stage: null, own: null }
  });
  check('resultStatus: partial when only result is present',
    stPartResOnly.key === 'partial' && stPartResOnly.label === RESULT_STATUS_LABEL.partial
  );

  const stPartModeOnly = resultStatus({
    result_screen: { result: null, mode: 'ガチヤグラ', stage: '海女美術大学', own: null }
  });
  check('resultStatus: partial when only mode/stage are present',
    stPartModeOnly.key === 'partial' && stPartModeOnly.label === RESULT_STATUS_LABEL.partial
  );

  const stPartFramesOnly = resultStatus({
    result_screen: null,
    confidence: { celebration_frames: 2, personal_frames: 0, board_frames: 0 }
  });
  check('resultStatus: partial when only confidence frames present',
    stPartFramesOnly.key === 'partial' && stPartFramesOnly.label === RESULT_STATUS_LABEL.partial
  );

  const stPartOwnMissingField = resultStatus({
    result_screen: {
      result: 'WIN',
      mode: 'ガチヤグラ',
      stage: '海女美術大学',
      own: { ka: null, deaths: 3, specials: 2 }
    }
  });
  check('resultStatus: partial when own has null fields',
    stPartOwnMissingField.key === 'partial' && stPartOwnMissingField.label === RESULT_STATUS_LABEL.partial
  );

  // d) null safety
  check('resultStatus: null match is missing without throwing',
    resultStatus(null).key === 'missing'
  );
  check('resultStatus: empty match is missing without throwing',
    resultStatus({}).key === 'missing'
  );
  check('resultStatus: result_screen null is missing without throwing',
    resultStatus({ result_screen: null }).key === 'missing'
  );
  check('resultStatus: null result_screen and confidence is missing without throwing',
    resultStatus({ result_screen: null, confidence: null }).key === 'missing'
  );
}

// 3. resultSourceLabel
{
  check('resultSourceLabel: review.fix.result gives "手動訂正"',
    resultSourceLabel({ review: { fix: { result: 'WIN' } }, result_screen: { result_source: 'celebration' } }) === '手動訂正'
  );
  check('resultSourceLabel: celebration gives "演出"',
    resultSourceLabel({ result_screen: { result_source: 'celebration' } }) === '演出'
  );
  check('resultSourceLabel: board gives "対戦表"',
    resultSourceLabel({ result_screen: { result_source: 'board' } }) === '対戦表'
  );
  check('resultSourceLabel: fix gives "手動訂正"',
    resultSourceLabel({ result_screen: { result_source: 'fix' } }) === '手動訂正'
  );
  check('resultSourceLabel: existing/missing record gives "不明"',
    resultSourceLabel({ result_screen: { result: 'WIN' } }) === '不明' &&
    resultSourceLabel({}) === '不明' &&
    resultSourceLabel(null) === '不明' &&
    resultSourceLabel({ result_screen: { result_source: null } }) === '不明'
  );
  const ro = resultOf({ result_screen: { result: 'WIN', mode: 'ガチヤグラ', result_source: 'celebration' } });
  check('resultOf returns result_source',
    ro.result_source === '演出' && ro.result === 'WIN' && ro.mode === 'ガチヤグラ'
  );
}

// 4. frameStepForState
{
  check('frameStepForState: "result" returns 0.08',
    frameStepForState('result') === 0.08 && RESULT_FRAME_STEP === 0.08
  );
  check('frameStepForState: "battle" returns base (0.2)',
    frameStepForState('battle') === 0.2
  );
  check('frameStepForState: "idle" with custom base returns custom base',
    frameStepForState('idle', 0.5) === 0.5
  );
}

// ============================================================================
// 後半: Playwrightによるブラウザ検証
// ============================================================================

const PORT = 4194;
const U = `http://127.0.0.1:${PORT}/`;
try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true
});
let page = null;

const TEST_IDS = ['rm-test-missing', 'rm-test-partial', 'rm-test-read'];

const cleanup = async () => {
  if (page) {
    await page.evaluate(async ids => {
      try {
        for (const id of ids) await window.inkgraph.db.delMatch(id);
      } catch {}
    }, TEST_IDS).catch(() => {});
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

  // シードデータの定義
  const seedMatches = [
    {
      id: 'rm-test-missing',
      match: 1,
      created: '2026-10-17T10:00:00.000Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 10, end: 15, alive_before: '4v4' }],
      own_kills: [{ start: 20, end: 21, alive_before: '4v4' }],
      special: [],
      tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }],
      result_screen: { result: null, mode: null, stage: null, own: null, result_source: null },
      confidence: { celebration_frames: 0, personal_frames: 0, board_frames: 0 },
      review: { marks: {}, added: [], fix: {} },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    },
    {
      id: 'rm-test-partial',
      match: 2,
      created: '2026-10-17T10:10:00.000Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 12, end: 17, alive_before: '4v4' }],
      own_kills: [{ start: 25, end: 26, alive_before: '4v4' }],
      special: [],
      tower_series: [{ t: 0, own: 50, enemy: 20, owner: 'own' }],
      result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: null, own: null, result_source: 'celebration' },
      confidence: { celebration_frames: 3, personal_frames: 0, board_frames: 0 },
      review: { marks: {}, added: [], fix: {} },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    },
    {
      id: 'rm-test-read',
      match: 3,
      created: '2026-10-17T10:20:00.000Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 14, end: 19, alive_before: '4v4' }],
      own_kills: [{ start: 30, end: 31, alive_before: '4v4' }],
      special: [],
      tower_series: [{ t: 0, own: 30, enemy: 80, owner: 'enemy' }],
      result_screen: { result: 'LOSE', mode: 'ガチヤグラ', stage: 'チョウザメ造船', own: { ka: 8, deaths: 4, specials: 2 }, result_source: 'celebration' },
      confidence: { celebration_frames: 5, personal_frames: 3, board_frames: 0 },
      review: { marks: {}, added: [], fix: {} },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    }
  ];

  // 1. db.putMatch で投入し、getMatch で result: null の維持を確認
  await page.evaluate(async matches => {
    for (const m of matches) await window.inkgraph.db.putMatch(m);
  }, seedMatches);

  const savedMissing = await page.evaluate(id => window.inkgraph.db.getMatch(id), 'rm-test-missing');
  check('browser: db.getMatch preserves result: null for missing match',
    savedMissing && savedMissing.result_screen && savedMissing.result_screen.result === null,
    JSON.stringify(savedMissing?.result_screen)
  );

  // 2. 試合一覧での 3種バッジ (data-status と文言)
  await page.goto(U + '#list');
  await page.reload();
  await page.waitForSelector('.match-row[data-id="rm-test-missing"]', { timeout: 5000 });

  const getRowBadge = async id => {
    return page.evaluate(mid => {
      const row = document.querySelector(`.match-row[data-id="${mid}"]`);
      if (!row) return null;
      const b = row.querySelector('.result-status');
      return b ? { status: b.getAttribute('data-status'), text: b.textContent.trim() } : null;
    }, id);
  };

  const bMissing = await getRowBadge('rm-test-missing');
  check('browser: list row for missing match has data-status="missing" and label',
    bMissing?.status === 'missing' && bMissing?.text === '未取得（試合中データのみ）',
    JSON.stringify(bMissing)
  );

  const bPartial = await getRowBadge('rm-test-partial');
  check('browser: list row for partial match has data-status="partial" and label',
    bPartial?.status === 'partial' && bPartial?.text === '一部未取得',
    JSON.stringify(bPartial)
  );

  const bRead = await getRowBadge('rm-test-read');
  check('browser: list row for read match has data-status="read" and label',
    bRead?.status === 'read' && bRead?.text === '読み取り済み',
    JSON.stringify(bRead)
  );

  // 3. 未取得試合の詳細でバッジ確認 & スクショ
  await page.goto(U + '#match/rm-test-missing');
  await page.reload();
  await page.waitForSelector('.detail-stage-info .result-status', { timeout: 5000 });

  const detailBadge = await page.evaluate(() => {
    const el = document.querySelector('.detail-stage-info .result-status');
    return el ? { status: el.getAttribute('data-status'), text: el.textContent.trim() } : null;
  });
  check('browser: detail header has result-status badge with data-status="missing"',
    detailBadge?.status === 'missing' && detailBadge?.text === '未取得（試合中データのみ）',
    JSON.stringify(detailBadge)
  );

  const p1 = path.join(SH, '01_detail_missing.png');
  await page.screenshot({ path: p1 });
  check('screenshot: 01_detail_missing.png saved', fs.existsSync(p1));

  // 4. 傾向分析での注記文と小グラフの不明試合ラベル fill & スクショ
  await page.goto(U + '#trend');
  await page.reload();
  await page.waitForSelector('.trends-stat-band', { timeout: 5000 });

  const noteText = await page.locator('.trend-winrate-note').textContent().catch(() => '');
  check('browser: trends shows winrate note for unknown matches',
    noteText.includes('勝敗不明1試合を除く2試合で計算'),
    `noteText="${noteText}"`
  );

  const labelFills = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('.small-chart-box:first-of-type g.click-match text.num[y*="bBot"], .small-chart-box:first-of-type g.click-match text:last-child'));
    return texts.map(t => ({ text: t.textContent.trim(), fill: t.getAttribute('fill') }));
  });
  const missingLabel = labelFills.find(l => l.text === '#1');
  check('browser: smallChart unknown match #1 label fill is var(--text-faint)',
    missingLabel?.fill === 'var(--text-faint)',
    JSON.stringify(missingLabel)
  );

  const winLabel = labelFills.find(l => l.text === '#2');
  const loseLabel = labelFills.find(l => l.text === '#3');
  check('browser: smallChart #2 is var(--win) and #3 is var(--lose)',
    winLabel?.fill === 'var(--win)' && loseLabel?.fill === 'var(--lose)',
    `#2=${winLabel?.fill}, #3=${loseLabel?.fill}`
  );

  // 勝率推移ドットの色確認
  const dotFills = await page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('.wp-dot circle'));
    return dots.map(d => d.getAttribute('fill'));
  });
  check('browser: winrate progression dots handle unknown (#1 faint, #2 win, #3 lose)',
    dotFills[0] === 'var(--text-faint)' && dotFills[1] === 'var(--win)' && dotFills[2] === 'var(--lose)',
    JSON.stringify(dotFills)
  );

  const p2 = path.join(SH, '02_trends.png');
  await page.screenshot({ path: p2 });
  check('screenshot: 02_trends.png saved', fs.existsSync(p2));

  // 5. pageerror確認
  check('browser: no page errors', errors.length === 0, errors.join('; '));

  // 6. cleanup
  await cleanup();
} catch (e) {
  console.log('FAIL exception:', e);
  results.push(false);
} finally {
  await browser.close().catch(() => {});
  srv.kill();
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}
}

const failed = results.filter(x => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
