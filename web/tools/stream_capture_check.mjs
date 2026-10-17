// Verification of stream capture controls, owner attribution, and verification match exclusion
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  isVerificationMatch,
  ownMatches,
  matchOwner
} from '../src/analysis.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/stream-capture');
fs.mkdirSync(SH, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// ============================================================================
// 前半: Node直接importでの純粋関数検証
// ============================================================================

// 1. isVerificationMatch
{
  check('isVerificationMatch: owner "other" returns true',
    isVerificationMatch({ source: { owner: 'other' } }) === true
  );
  check('isVerificationMatch: owner "self" returns false',
    isVerificationMatch({ source: { owner: 'self' } }) === false
  );
  check('isVerificationMatch: missing owner in source returns false (backward compatible)',
    isVerificationMatch({ source: { kind: 'device' } }) === false
  );
  check('isVerificationMatch: empty source returns false',
    isVerificationMatch({ source: {} }) === false
  );
  check('isVerificationMatch: missing source returns false',
    isVerificationMatch({}) === false
  );
  check('isVerificationMatch: null returns false',
    isVerificationMatch(null) === false
  );
  check('isVerificationMatch: undefined returns false',
    isVerificationMatch(undefined) === false
  );
}

// 2. matchOwner
{
  check('matchOwner: "other" returns "other"',
    matchOwner({ source: { owner: 'other' } }) === 'other'
  );
  check('matchOwner: "self" returns "self"',
    matchOwner({ source: { owner: 'self' } }) === 'self'
  );
  check('matchOwner: empty or missing returns "self"',
    matchOwner({}) === 'self' && matchOwner(null) === 'self'
  );
}

// 3. ownMatches
{
  const m1 = { id: 'm1', source: { owner: 'self' } };
  const m2 = { id: 'm2', source: { owner: 'other' } };
  const m3 = { id: 'm3', source: { kind: 'device' } }; // legacy, self
  const m4 = { id: 'm4' }; // legacy, self
  const original = [m1, m2, m3, m4];
  const originalCopy = [...original];

  const filtered = ownMatches(original);
  check('ownMatches: removes verification match (owner "other")',
    filtered.length === 3 && !filtered.some(m => m.id === 'm2')
  );
  check('ownMatches: preserves order of remaining items',
    filtered[0].id === 'm1' && filtered[1].id === 'm3' && filtered[2].id === 'm4'
  );
  check('ownMatches: non-destructive to original array',
    original.length === originalCopy.length && original.every((m, i) => m === originalCopy[i])
  );
  check('ownMatches: empty or non-array returns empty array',
    Array.isArray(ownMatches([])) && ownMatches([]).length === 0 &&
    Array.isArray(ownMatches(null)) && ownMatches(null).length === 0
  );
}

// ============================================================================
// 後半: Playwrightによるブラウザ検証
// ============================================================================

const PORT = 4198;
const U = `http://127.0.0.1:${PORT}/`;
try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true
});
let page = null;

const TEST_IDS = ['stream-test-self', 'stream-test-other'];

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

  // 1. ライブ画面検証
  await page.goto(U + '#live');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.analysis, null, { timeout: 10000 });
  await cleanup();

  // (a) 「配信映像（画面共有）」タブの存在
  const streamTab = await page.$('.pill-tab[data-src-tab="stream"]');
  check('Live page: "配信映像（画面共有）" tab exists', !!streamTab);
  const streamTabLabel = await streamTab?.textContent();
  check('Live page: tab text is exactly "配信映像（画面共有）"',
    streamTabLabel?.includes('配信映像（画面共有）')
  );

  // (b) stream選択時のコントロール表示切替
  await streamTab?.click();
  await page.waitForTimeout(200);

  const streamControlsVisible = await page.$eval('#stream-controls', el => getComputedStyle(el).display !== 'none');
  check('Live page: stream controls visible when stream tab active', streamControlsVisible);

  const deviceControlsHidden = await page.$eval('#device-controls', el => getComputedStyle(el).display === 'none');
  const fileControlsHidden = await page.$eval('#file-controls', el => getComputedStyle(el).display === 'none');
  check('Live page: device and file controls hidden when stream active',
    deviceControlsHidden && fileControlsHidden
  );

  // (c) stream空状態の文言とファイル選択ボタン非表示
  const streamEmptyText = await page.$eval('#video-empty p', el => el.textContent.trim());
  const streamPickBtnHidden = await page.$eval('#video-pick-file', el => getComputedStyle(el).display === 'none');
  check('Live page: stream empty state shows "共有する画面を選んでください" and hides #video-pick-file',
    streamEmptyText === '共有する画面を選んでください' && streamPickBtnHidden,
    `text="${streamEmptyText}", pickBtnHidden=${streamPickBtnHidden}`
  );

  // (d) radioとcheckboxの初期未選択状態 & #start disabled
  const radios = await page.$$eval('input[name="stream-owner"]', els => els.map(el => ({ value: el.value, checked: el.checked })));
  check('Live page: stream-owner radios exist with "self" and "other", both initially unchecked',
    radios.length === 2 &&
    radios.some(r => r.value === 'self' && !r.checked) &&
    radios.some(r => r.value === 'other' && !r.checked)
  );

  const checkboxes = await page.$$eval('.stream-check', els => els.map(el => ({ value: el.value, checked: el.checked })));
  check('Live page: three stream-check checkboxes exist (1080p, fullscreen, nocaption/subtitles_off), initially unchecked',
    checkboxes.length === 3 && checkboxes.every(c => !c.checked)
  );

  const startInitialState = await page.$eval('#start', el => {
    const cs = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.background = root.getPropertyValue('--surface-2');
    probe.style.color = root.getPropertyValue('--text-faint');
    document.body.appendChild(probe);
    const pcs = getComputedStyle(probe);
    const bgMatch = cs.backgroundColor === pcs.backgroundColor;
    const fgMatch = cs.color === pcs.color;
    probe.remove();
    return { disabled: el.disabled, bgMatch, fgMatch, bg: cs.backgroundColor, fg: cs.color };
  });
  check('Live page: #start is disabled with surface-2/text-faint style when stream conditions unmet',
    startInitialState.disabled && startInitialState.bgMatch && startInitialState.fgMatch,
    `disabled=${startInitialState.disabled}, bg=${startInitialState.bg}, fg=${startInitialState.fg}`
  );

  // スクリーンショット1: ライブ画面（stream選択・条件未達状態）
  await page.screenshot({ path: path.join(SH, 'live-stream-select.png') });

  // (e) ownerと開始前チェック3つを満たすと #start が有効になり、外すと無効に戻ること
  await page.check('input[name="stream-owner"][value="other"]');
  const disabledOnlyOwner = await page.$eval('#start', el => el.disabled);
  check('Live page: #start remains disabled when only owner is selected', disabledOnlyOwner);

  const checkEls = await page.$$('.stream-check');
  for (const c of checkEls) await c.check();
  const enabledWhenAllMet = await page.$eval('#start', el => !el.disabled);
  check('Live page: #start becomes enabled when owner and all 3 stream-checks are checked', enabledWhenAllMet);

  await checkEls[0].uncheck();
  const disabledAfterUncheck = await page.$eval('#start', el => el.disabled);
  check('Live page: #start becomes disabled again when a stream-check is unchecked', disabledAfterUncheck);

  // (f) 二重防御の alert ガード確認
  let alertMessage = null;
  page.once('dialog', async dialog => {
    alertMessage = dialog.message();
    await dialog.accept();
  });

  await page.$eval('#start', el => el.onclick());
  await page.waitForTimeout(300);

  check('Live page: onclick guard triggers alert dialog when conditions unmet',
    !!alertMessage,
    `alert message: "${alertMessage}"`
  );

  const stopVisible = await page.$eval('#stop', el => getComputedStyle(el).display !== 'none');
  const liveStateText = await page.$eval('#state', el => el.textContent);
  check('Live page: analysis not started (#stop not shown, state not analyzing)',
    !stopVisible && !liveStateText.includes('解析中'),
    `stopVisible=${stopVisible}, state="${liveStateText}"`
  );

  // 2. seed投入による試合一覧・傾向分析の検証
  const seedMatches = [
    {
      id: 'stream-test-self',
      match: 1,
      created: '2026-10-17T11:00:00.000Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 20, end: 25, alive_before: '4v4' }],
      own_kills: [{ start: 40, end: 41, alive_before: '4v4' }],
      special: [],
      tower_series: [{ t: 0, own: 50, enemy: 20, owner: 'own' }],
      result_screen: {
        result: 'WIN',
        mode: 'ガチヤグラ',
        stage: '海女美術大学',
        own: { ka: 10, deaths: 1, specials: 2 },
        result_source: 'celebration'
      },
      confidence: { celebration_frames: 3, personal_frames: 0, board_frames: 0 },
      review: { marks: {}, added: [], fix: {} },
      source: { kind: 'device', name: 'キャプチャー映像', height: 1080, owner: 'self' },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    },
    {
      id: 'stream-test-other',
      match: 2,
      created: '2026-10-17T11:10:00.000Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 30, end: 35, alive_before: '4v4' }],
      own_kills: [{ start: 50, end: 51, alive_before: '4v4' }],
      special: [],
      tower_series: [{ t: 0, own: 10, enemy: 60, owner: 'enemy' }],
      result_screen: {
        result: 'LOSE',
        mode: 'ガチヤグラ',
        stage: '海女美術大学',
        own: { ka: 5, deaths: 4, specials: 1 },
        result_source: 'celebration'
      },
      confidence: { celebration_frames: 3, personal_frames: 0, board_frames: 0 },
      review: { marks: {}, added: [], fix: {} },
      source: { kind: 'stream', name: '配信映像（画面共有）', height: 1080, owner: 'other' },
      stills: { count: 0, bytes: 0 },
      stillsState: 'none',
      favorite: false,
      video: { kind: 'none' }
    }
  ];

  await page.evaluate(async items => {
    for (const m of items) await window.inkgraph.db.putMatch(m);
  }, seedMatches);

  // 試合一覧画面へ移動
  await page.goto(U + '#list');
  await page.waitForSelector('.match-row');

  const rows = await page.$$('.match-row');
  check('Match list: 2 matches displayed', rows.length === 2);

  const rowSelfBadge = await page.$eval('.match-row[data-id="stream-test-self"]', el => !!el.querySelector('.verify-badge'));
  const rowOtherBadgeInfo = await page.$eval('.match-row[data-id="stream-test-other"]', el => {
    const b = el.querySelector('.verify-badge');
    if (!b) return null;
    const inColRes = !!el.querySelector('.match-row-col-res .verify-badge');
    const inColStage = !!el.querySelector('.match-row-col-stage .verify-badge');
    const prevIsResultBadge = b.previousElementSibling?.classList.contains('badge') || false;
    const cs = getComputedStyle(b);
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.background = root.getPropertyValue('--warn-soft');
    probe.style.border = `1px solid ${root.getPropertyValue('--warn-border')}`;
    probe.style.color = root.getPropertyValue('--warn');
    document.body.appendChild(probe);
    const pcs = getComputedStyle(probe);
    const colorMatch =
      cs.backgroundColor === pcs.backgroundColor &&
      cs.borderTopColor === pcs.borderTopColor &&
      cs.color === pcs.color;
    probe.remove();
    return {
      text: b.textContent.trim(),
      inColRes,
      inColStage,
      prevIsResultBadge,
      colorMatch,
      bg: cs.backgroundColor,
      border: cs.borderTopColor,
      fg: cs.color
    };
  });

  check('Match list: verification badge NOT present on self match row', !rowSelfBadge);
  check('Match list: verification badge present with text "検証用" only on other match row',
    rowOtherBadgeInfo?.text === '検証用',
    `rowOtherBadge="${rowOtherBadgeInfo?.text}"`
  );
  check('Match list: verification badge is inside .match-row-col-res right next to result badge and uses warn colors',
    !!(rowOtherBadgeInfo && rowOtherBadgeInfo.inColRes && !rowOtherBadgeInfo.inColStage && rowOtherBadgeInfo.prevIsResultBadge && rowOtherBadgeInfo.colorMatch),
    JSON.stringify(rowOtherBadgeInfo)
  );

  // スクリーンショット2: 試合一覧
  await page.screenshot({ path: path.join(SH, 'match-list.png') });

  // 傾向分析画面へ移動
  await page.goto(U + '#trend');
  await page.waitForSelector('.trends-stat-band');

  // 試合数表示
  const trendPageTitle = await page.$eval('.page-title', el => el.textContent);
  check('Trend page: title shows only 1 match (excluding verification match)',
    trendPageTitle.includes('（1試合）'),
    `title="${trendPageTitle}"`
  );

  // 勝率表示: 1勝0敗、100%
  const winrateVal = await page.$eval('.stat-value-2xl', el => el.textContent.trim());
  const winrateSub = await page.$eval('.stat-sub', el => el.textContent.trim());
  check('Trend page: winrate is 100% (1勝0敗) calculated only from own match',
    winrateVal === '100%' && winrateSub === '1勝0敗',
    `winrateVal="${winrateVal}", winrateSub="${winrateSub}"`
  );

  // 検証用除外の注記
  const verifyNote = await page.$eval('.trend-verify-note', el => el.textContent.trim()).catch(() => null);
  check('Trend page: shows note excluding verification matches ("検証用1試合を除く1試合で計算")',
    verifyNote === '検証用1試合を除く1試合で計算',
    `verifyNote="${verifyNote}"`
  );

  // スクリーンショット3: 傾向分析
  await page.screenshot({ path: path.join(SH, 'trend.png') });

  check('No uncaught page errors', errors.length === 0, errors.join(', '));

} finally {
  await cleanup();
  await browser.close();
  srv.kill('SIGTERM');
}

const allPass = results.length > 0 && results.every(Boolean);
console.log(`\nResult: ${results.filter(Boolean).length}/${results.length} checks passed.`);
if (!allPass) {
  process.exit(1);
} else {
  console.log('All checks PASSED!');
  process.exit(0);
}
