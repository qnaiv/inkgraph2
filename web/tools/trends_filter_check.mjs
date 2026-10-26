// #140 trends filter & stage table check tool
// Usage: node tools/trends_filter_check.mjs
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

import {
  MATCH_TYPE_OPTIONS,
  RULE_OPTIONS,
  parseTrendFilter,
  trendFilterToQuery,
  filterTrendMatches,
  sampleTier,
  powerBreakdown,
  stageRuleRows,
  sortStageRows,
  candidateShortage,
  ownMatches,
  isVerificationMatch
} from '../src/analysis.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/trends-match-type');
fs.mkdirSync(SH, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// ============================================================================
// 1. 純粋関数検証 (Node direct import)
// ============================================================================
console.log('--- Pure Function Tests ---');

// (a) オプションの値と正式名称（短縮なし）
{
  const expectedMatchTypes = [
    { value: 'all', label: 'すべて' },
    { value: 'x', label: 'Xマッチ' },
    { value: 'bankara_open', label: 'バンカラ・オープン' },
    { value: 'bankara_challenge', label: 'バンカラ・チャレンジ' },
    { value: 'other', label: 'その他' }
  ];
  const mtOk = MATCH_TYPE_OPTIONS.length === 5 &&
    expectedMatchTypes.every((e, i) => MATCH_TYPE_OPTIONS[i].value === e.value && MATCH_TYPE_OPTIONS[i].label === e.label);
  check('pure: MATCH_TYPE_OPTIONS values and labels correct', mtOk, JSON.stringify(MATCH_TYPE_OPTIONS));

  const expectedRules = [
    { value: 'all', label: 'すべて' },
    { value: 'area', label: 'ガチエリア' },
    { value: 'hoko', label: 'ガチホコバトル' },
    { value: 'yagura', label: 'ガチヤグラ' },
    { value: 'asari', label: 'ガチアサリ' },
    { value: 'nawabari', label: 'ナワバリバトル' }
  ];
  const rOk = RULE_OPTIONS.length === 6 &&
    expectedRules.every((e, i) => RULE_OPTIONS[i].value === e.value && RULE_OPTIONS[i].label === e.label);
  check('pure: RULE_OPTIONS values and labels correct (no abbreviations)', rOk, JSON.stringify(RULE_OPTIONS));
}

// (b) parseTrendFilter / trendFilterToQuery の正常・不正フォールバック
{
  const p1 = parseTrendFilter('#trend?matchType=x&rule=yagura');
  check('pure: parseTrendFilter with hash prefix', p1.matchType === 'x' && p1.rule === 'yagura', JSON.stringify(p1));

  const p2 = parseTrendFilter('?matchType=bankara_open&rule=nawabari');
  check('pure: parseTrendFilter with query prefix', p2.matchType === 'bankara_open' && p2.rule === 'nawabari', JSON.stringify(p2));

  const p3 = parseTrendFilter('invalid-string?matchType=unknown&rule=hoge');
  check('pure: parseTrendFilter invalid falls back to all', p3.matchType === 'all' && p3.rule === 'all', JSON.stringify(p3));

  const p4 = parseTrendFilter('');
  check('pure: parseTrendFilter empty string falls back to all', p4.matchType === 'all' && p4.rule === 'all', JSON.stringify(p4));

  const q1 = trendFilterToQuery({ matchType: 'x', rule: 'yagura' });
  check('pure: trendFilterToQuery creates standard query', q1 === 'matchType=x&rule=yagura', q1);

  const q2 = trendFilterToQuery({});
  check('pure: trendFilterToQuery defaults empty to all', q2 === 'matchType=all&rule=all', q2);
}

// (c) filterTrendMatches の組み合わせ
{
  const sampleMatches = [
    { id: 'm1', match_type: 'x', result_screen: { mode: 'ガチヤグラ', result: 'WIN' }, review: {} },
    { id: 'm2', match_type: 'x', result_screen: { mode: 'ガチエリア', result: 'WIN' }, review: {} },
    { id: 'm3', match_type: 'bankara_open', result_screen: { mode: 'ナワバリバトル', result: 'LOSE' }, review: {} },
    { id: 'm4', match_type: 'other', result_screen: { mode: 'ガチアサリ', result: 'WIN' }, review: {} },
    { id: 'm5', match_type: null, result_screen: { mode: null, result: 'WIN' }, review: {} },
    { id: 'm6', match_type: 'unrecognized_type', result_screen: { mode: '未知ルール', result: 'LOSE' }, review: {} }
  ];

  const f1 = filterTrendMatches(sampleMatches, { matchType: 'x', rule: 'yagura' });
  check('pure: filterTrendMatches (x * yagura)', f1.length === 1 && f1[0].id === 'm1', `got ${f1.map(m => m.id)}`);

  const f2 = filterTrendMatches(sampleMatches, { matchType: 'other', rule: 'all' });
  check('pure: filterTrendMatches (other * all)', f2.length === 1 && f2[0].id === 'm4', `got ${f2.map(m => m.id)}`);

  const f3 = filterTrendMatches(sampleMatches, { matchType: 'all', rule: 'nawabari' });
  check('pure: filterTrendMatches (all * nawabari)', f3.length === 1 && f3[0].id === 'm3', `got ${f3.map(m => m.id)}`);

  const f4 = filterTrendMatches(sampleMatches, { matchType: 'x', rule: 'all' });
  check('pure: filterTrendMatches (x * all) does not include null or other match_types',
    f4.length === 2 && f4.every(m => m.match_type === 'x'),
    `got ${f4.map(m => m.id)}`
  );

  const fAll = filterTrendMatches(sampleMatches, { matchType: 'all', rule: 'all' });
  check('pure: filterTrendMatches (all * all) preserves order and includes null/unrecognized',
    fAll.length === sampleMatches.length && fAll[4].id === 'm5' && fAll[5].id === 'm6',
    `length=${fAll.length}`
  );

  const fSpecificNoNull = filterTrendMatches(sampleMatches, { matchType: 'other', rule: 'asari' });
  check('pure: filterTrendMatches specific excludes null/unrecognized match_type/mode',
    fSpecificNoNull.length === 1 && fSpecificNoNull[0].id === 'm4'
  );
}

// (d) sampleTier 境界 0/4/5/9/10
{
  check('pure: sampleTier 0 -> insufficient', sampleTier(0).key === 'insufficient' && sampleTier(0).label === 'データ不足');
  check('pure: sampleTier 4 -> insufficient', sampleTier(4).key === 'insufficient');
  check('pure: sampleTier 5 -> reference', sampleTier(5).key === 'reference' && sampleTier(5).label === '参考値');
  check('pure: sampleTier 9 -> reference', sampleTier(9).key === 'reference');
  check('pure: sampleTier 10 -> normal', sampleTier(10).key === 'normal' && sampleTier(10).label === '通常');
  check('pure: sampleTier -2 -> insufficient (0扱い)', sampleTier(-2).key === 'insufficient');
}

// (e) powerBreakdown の内訳
{
  const powerMatches = [
    { match_type: 'x', power: { status: 'acquired', value: 2150, confidence: 0.9 } },
    { match_type: 'x', power: { status: 'acquired', value: null, confidence: 0 } }, // value null -> notAcquired
    { match_type: 'x', power: { status: 'not_shown', value: null, confidence: 0 } }, // notAcquired
    { match_type: 'x', power: { status: 'read_failed', value: null, confidence: 0 } }, // notAcquired
    { match_type: 'bankara_open', power: { status: 'not_applicable', value: null, confidence: 0 } }, // notApplicable
    { match_type: 'bankara_challenge', power: { status: 'not_applicable', value: null, confidence: 0 } }, // notApplicable
    { match_type: 'other', power: { status: 'not_applicable', value: null, confidence: 0 } }, // notApplicable
    { match_type: null, power: { status: 'unknown_type', value: null, confidence: 0 } } // notAcquired
  ];
  const pb = powerBreakdown(powerMatches);
  check('pure: powerBreakdown counts match spec',
    pb.acquired === 1 && pb.notApplicable === 3 && pb.notAcquired === 4 && pb.excluded === 7,
    JSON.stringify(pb)
  );
}

// (f) stageRuleRows の集計・平均・バッジ境界と初期順 n降順
{
  // 10 matches on StageA x Yagura: 6 wins, 4 losses -> winRate=0.6, badge='得意'
  const msA = Array.from({ length: 10 }, (_, i) => ({
    battle: [0, 300],
    squid_down: {},
    result_screen: { result: i < 6 ? 'WIN' : 'LOSE', mode: 'ガチヤグラ', stage: 'ユノハナ大渓谷' },
    own_kills: [{ start: 1, end: 2 }],
    own_deaths: [{ start: 5, end: 10 }],
    special: [{ outcome: 'activated', ready: 10, end: 20 }]
  }));
  // 9 matches on StageB x Area: 6 wins, 3 losses -> winRate=0.666, badge=null (n<10)
  const msB = Array.from({ length: 9 }, (_, i) => ({
    battle: [0, 300],
    squid_down: {},
    result_screen: { result: i < 6 ? 'WIN' : 'LOSE', mode: 'ガチエリア', stage: 'ゴンベエ海峡' },
    own_kills: [{ start: 1, end: 2 }, { start: 3, end: 4 }],
    own_deaths: [{ start: 5, end: 10 }],
    special: []
  }));
  // 10 matches on StageC x Hoko: 4 wins, 6 losses -> winRate=0.4, badge='苦手'
  const msC = Array.from({ length: 10 }, (_, i) => ({
    battle: [0, 300],
    squid_down: {},
    result_screen: { result: i < 4 ? 'WIN' : 'LOSE', mode: 'ガチホコバトル', stage: 'ヤガラ市場' },
    own_kills: [],
    own_deaths: [{ start: 5, end: 10 }],
    special: [{ outcome: 'activated', ready: 10, end: 20 }]
  }));

  const rows = stageRuleRows([...msB, ...msA, ...msC]);
  check('pure: stageRuleRows length', rows.length === 3, `got ${rows.length}`);
  check('pure: stageRuleRows initial sort n desc',
    rows[0].n === 10 && rows[1].n === 10 && rows[2].n === 9,
    `n=[${rows.map(r => r.n).join(',')}]`
  );

  const rowA = rows.find(r => r.stage === 'ユノハナ大渓谷');
  check('pure: stageRuleRows n=10 winRate=0.6 gets "得意" badge',
    rowA && rowA.badge === '得意' && rowA.winRate === 0.6 && rowA.killsPer === 1 && rowA.deathsPer === 1 && rowA.specialsPer === 1 && rowA.kd === 1,
    JSON.stringify(rowA)
  );

  const rowB = rows.find(r => r.stage === 'ゴンベエ海峡');
  check('pure: stageRuleRows n=9 winRate>0.6 gets badge null (<10)',
    rowB && rowB.badge === null && rowB.n === 9,
    JSON.stringify(rowB)
  );

  const rowC = rows.find(r => r.stage === 'ヤガラ市場');
  check('pure: stageRuleRows n=10 winRate=0.4 gets "苦手" badge',
    rowC && rowC.badge === '苦手' && rowC.winRate === 0.4,
    JSON.stringify(rowC)
  );
}

// (g) sortStageRows の勝率ソートで n<5 が末尾
{
  const testRows = [
    { stage: 'S1', rule: 'R1', n: 3, winRate: 1.0, wins: 3, losses: 0, killsPer: 5, deathsPer: 1, kd: 5, specialsPer: 2 },
    { stage: 'S2', rule: 'R2', n: 10, winRate: 0.5, wins: 5, losses: 5, killsPer: 4, deathsPer: 2, kd: 2, specialsPer: 1 },
    { stage: 'S3', rule: 'R3', n: 12, winRate: 0.8, wins: 10, losses: 2, killsPer: 6, deathsPer: 1, kd: 6, specialsPer: 3 },
    { stage: 'S4', rule: 'R4', n: 2, winRate: 1.0, wins: 2, losses: 0, killsPer: 3, deathsPer: 1, kd: 3, specialsPer: 1 }
  ];

  const sortedWpDesc = sortStageRows(testRows, 'winRate', 'desc');
  check('pure: sortStageRows winRate desc keeps n<5 at the end in relative order',
    sortedWpDesc[0].stage === 'S3' &&
    sortedWpDesc[1].stage === 'S2' &&
    sortedWpDesc[2].stage === 'S1' &&
    sortedWpDesc[3].stage === 'S4',
    `order=[${sortedWpDesc.map(r => r.stage).join(',')}]`
  );
}

// (h) candidateShortage の needed 計算
{
  const c1 = candidateShortage(30, 10);
  check('pure: candidateShortage enough when total>=30 and filtered>=10', c1.enough === true && c1.needed === 0, JSON.stringify(c1));

  const c2 = candidateShortage(12, 12);
  check('pure: candidateShortage needed=18 when total=12', c2.enough === false && c2.needed === 18, JSON.stringify(c2));

  const c3 = candidateShortage(35, 6);
  check('pure: candidateShortage needed=4 when total=35 and filtered=6', c3.enough === false && c3.needed === 4, JSON.stringify(c3));
}

// (i) ownMatches で検証用を除いてから filter しても混ざらないこと
{
  const mix = [
    { id: 'own-1', match_type: 'x', source: { kind: 'device', owner: 'self' }, result_screen: { mode: 'ガチヤグラ' } },
    { id: 'verify-1', match_type: 'x', source: { kind: 'device', owner: 'other' }, result_screen: { mode: 'ガチヤグラ' } }
  ];
  const cleaned = ownMatches(mix);
  const filtered = filterTrendMatches(cleaned, { matchType: 'x', rule: 'yagura' });
  check('pure: ownMatches removes verification match before filtering',
    filtered.length === 1 && filtered[0].id === 'own-1' && !isVerificationMatch(filtered[0]),
    `got ${filtered.map(m => m.id)}`
  );
}

// ============================================================================
// 2. ブラウザ検証 (Playwright + vite preview)
// ============================================================================
console.log('\n--- Browser Tests ---');

const PORT = Number(process.env.PORT) || 4219;
const U = `http://127.0.0.1:${PORT}/`;

try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}

const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));

let browser = null;
let page = null;

const testIds = [
  // 6 バンカラ・チャレンジ x ガチヤグラ
  'trends-check-bc-1', 'trends-check-bc-2', 'trends-check-bc-3',
  'trends-check-bc-4', 'trends-check-bc-5', 'trends-check-bc-6',
  // 3 Xマッチ x ガチエリア
  'trends-check-x-1', 'trends-check-x-2', 'trends-check-x-3',
  // 2 バンカラ・オープン x ナワバリバトル
  'trends-check-bo-1', 'trends-check-bo-2',
  // 1 その他 x ガチアサリ
  'trends-check-other-1',
  // 1 検証用 (owner: other)
  'trends-check-verify-1'
];

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
  browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ja-JP' });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(U + '#trend');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db && window.inkgraph.analysis, null, { timeout: 10000 });

  await cleanup();

  // シードデータ投入
  await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const baseTime = Date.parse('2026-10-17T12:00:00Z');

    const mkMatch = (id, idx, match_type, mode, stage, result, ka, d, sp, power, owner = 'self') => {
      const deaths = Array.from({ length: d }, (_, i) => ({ start: 10 + i * 20, end: 15 + i * 20 }));
      const kills = Array.from({ length: ka }, (_, i) => ({ start: 20 + i * 15, end: 21 + i * 15 }));
      const special = Array.from({ length: sp }, (_, i) => ({ ready: 10 + i * 30, end: 15 + i * 30, activated_at: 15 + i * 30, outcome: 'activated' }));
      return {
        id,
        match: idx,
        created: new Date(baseTime + idx * 60000).toISOString(),
        battle: [0, 300],
        squid_down: {},
        own_deaths: deaths,
        own_kills: kills,
        special,
        tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }, { t: 300, own: result === 'WIN' ? 50 : 30, enemy: result === 'WIN' ? 30 : 50, owner: 'neutral' }],
        result_screen: { result, mode, stage, own: { ka, deaths: d, specials: sp } },
        match_type,
        power,
        review: { marks: {}, added: [], fix: {} },
        source: { kind: 'device', owner },
        stills: { count: 0, bytes: 0 },
        stillsState: 'none',
        favorite: false,
        video: { kind: 'none' }
      };
    };

    // 6 バンカラ・チャレンジ x ガチヤグラ (ユノハナ大渓谷 3, ゴンベエ海峡 3)
    await db.putMatch(mkMatch('trends-check-bc-1', 1, 'bankara_challenge', 'ガチヤグラ', 'ユノハナ大渓谷', 'WIN', 6, 2, 2, { status: 'not_applicable', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-bc-2', 2, 'bankara_challenge', 'ガチヤグラ', 'ユノハナ大渓谷', 'LOSE', 3, 4, 1, { status: 'not_applicable', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-bc-3', 3, 'bankara_challenge', 'ガチヤグラ', 'ユノハナ大渓谷', 'WIN', 5, 1, 2, { status: 'not_applicable', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-bc-4', 4, 'bankara_challenge', 'ガチヤグラ', 'ゴンベエ海峡', 'WIN', 7, 2, 3, { status: 'not_applicable', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-bc-5', 5, 'bankara_challenge', 'ガチヤグラ', 'ゴンベエ海峡', 'LOSE', 2, 5, 0, { status: 'not_applicable', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-bc-6', 6, 'bankara_challenge', 'ガチヤグラ', 'ゴンベエ海峡', 'LOSE', 4, 3, 1, { status: 'not_applicable', value: null, confidence: 0 }));

    // 3 Xマッチ x ガチエリア (マテガイ放水路 2, ユノハナ大渓谷 1)
    await db.putMatch(mkMatch('trends-check-x-1', 7, 'x', 'ガチエリア', 'マテガイ放水路', 'WIN', 5, 2, 1, { status: 'not_shown', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-x-2', 8, 'x', 'ガチエリア', 'マテガイ放水路', 'WIN', 8, 1, 2, { status: 'not_shown', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-x-3', 9, 'x', 'ガチエリア', 'ユノハナ大渓谷', 'LOSE', 3, 4, 1, { status: 'not_shown', value: null, confidence: 0 }));

    // 2 バンカラ・オープン x ナワバリバトル (ヤガラ市場 2)
    await db.putMatch(mkMatch('trends-check-bo-1', 10, 'bankara_open', 'ナワバリバトル', 'ヤガラ市場', 'WIN', 4, 2, 1, { status: 'not_applicable', value: null, confidence: 0 }));
    await db.putMatch(mkMatch('trends-check-bo-2', 11, 'bankara_open', 'ナワバリバトル', 'ヤガラ市場', 'LOSE', 2, 3, 0, { status: 'not_applicable', value: null, confidence: 0 }));

    // 1 その他 x ガチアサリ (ゴンベエ海峡 1)
    await db.putMatch(mkMatch('trends-check-other-1', 12, 'other', 'ガチアサリ', 'ゴンベエ海峡', 'WIN', 5, 2, 2, { status: 'not_applicable', value: null, confidence: 0 }));

    // 1 検証用 (owner: other)
    await db.putMatch(mkMatch('trends-check-verify-1', 13, 'x', 'ガチエリア', 'ユノハナ大渓谷', 'WIN', 10, 0, 4, { status: 'acquired', value: 2400, confidence: 0.9 }, 'other'));
  });

  // 再描画
  await page.goto(U + '#trend');
  await page.waitForSelector('.trends-filter');

  // 検証 1: 既定 #trend でピル両段が初期「すべて」、対象12試合（全体12試合）
  const initialTargetText = await page.textContent('.trend-target-line');
  check('browser: default #trend shows 12 matches (total 12)',
    initialTargetText.includes('対象 12試合（全体12試合）'),
    initialTargetText
  );

  const activeMatchTypePill = await page.textContent('.trend-pill[data-match-type][aria-pressed="true"]');
  const activeRulePill = await page.textContent('.trend-pill[data-rule][aria-pressed="true"]');
  check('browser: default active pills are both "すべて"',
    activeMatchTypePill.trim() === 'すべて' && activeRulePill.trim() === 'すべて',
    `matchType=${activeMatchTypePill}, rule=${activeRulePill}`
  );

  const verifyNote = await page.textContent('.trend-verify-note');
  check('browser: verification match excluded and noted',
    verifyNote.includes('検証用1試合を除く12試合で計算'),
    verifyNote
  );

  // パワー内訳 details の確認
  const breakdownSummary = await page.textContent('.trend-power-breakdown summary');
  const breakdownDiv = await page.textContent('.trend-power-breakdown div');
  check('browser: power breakdown details has correct labels and counts (9 notApplicable, 3 notAcquired)',
    breakdownSummary.includes('パワーの対象外・未取得の内訳') &&
    breakdownDiv.includes('対象外（ナワバリバトルなど）9件') &&
    breakdownDiv.includes('未取得（取得できなかった試合）3件'),
    breakdownDiv
  );

  // Xパワー空状態カードが勝率の推移の直後にあること
  const xPowerCardExists = await page.evaluate(() => {
    const card = document.querySelector('.trend-xpower-card');
    if (!card) return false;
    const prev = card.previousElementSibling;
    return prev && prev.textContent.includes('勝率の推移');
  });
  check('browser: X-power card is placed right after winrate chart card', xPowerCardExists);

  // 候補ランキングの母数不足文言
  const candidateText = await page.textContent('.trend-candidate-card');
  check('browser: candidate card shows shortage (needed 18 matches)',
    candidateText.includes('まだ順位を付けられるほど試合がありません') &&
    candidateText.includes('あと18試合記録すると、ここに候補が出ます'),
    candidateText
  );

  // ステージ表の確認
  const stageCardText = await page.textContent('.trend-stage-card');
  check('browser: stage card title and note exist',
    stageCardText.includes('ステージとルールの成績') &&
    stageCardText.includes('5試合未満の行は参考になりません。表示は記録の確認用です')
  );

  // スクショ 1: 01-all.png
  await page.screenshot({ path: path.join(SH, '01-all.png') });
  check('browser: screenshot 01-all.png saved', fs.existsSync(path.join(SH, '01-all.png')));

  // 検証 2: ピルで「Xマッチ」をクリック
  await page.click('.trend-pill[data-match-type="x"]');
  await page.waitForTimeout(300);

  const hashAfterX = await page.evaluate(() => location.hash);
  check('browser: clicking Xマッチ pill updates hash query', hashAfterX.includes('matchType=x'), hashAfterX);

  const targetAfterX = await page.textContent('.trend-target-line');
  check('browser: filtered to 3 matches for Xマッチ', targetAfterX.includes('対象 3試合（全体12試合）'), targetAfterX);

  const sampleBannerX = await page.textContent('.trend-sample-banner');
  check('browser: 1-4 matches shows sample banner',
    sampleBannerX.includes('対象が 3 件のため、傾向としてはまだ読めません。数字は記録の合計です'),
    sampleBannerX
  );

  const winrateValX = await page.textContent('.trends-stat-band .stat .stat-value-2xl');
  const winrateSubX = await page.textContent('.trends-stat-band .stat .stat-sub');
  check('browser: 1-4 matches winrate is "—" and sub is "2勝1敗"',
    winrateValX.trim() === '—' && winrateSubX.includes('2勝1敗'),
    `val=${winrateValX}, sub=${winrateSubX}`
  );

  // スクショ 2: 02-filtered-x.png
  await page.screenshot({ path: path.join(SH, '02-filtered-x.png') });
  check('browser: screenshot 02-filtered-x.png saved', fs.existsSync(path.join(SH, '02-filtered-x.png')));

  // 検証 3: ルールで「ガチヤグラ」をクリック -> 0件空状態
  await page.click('.trend-pill[data-rule="yagura"]');
  await page.waitForTimeout(300);

  const emptyCard = await page.$('.trend-empty-filtered');
  const emptyText = emptyCard ? await emptyCard.textContent() : '';
  const hasResetBtn = await page.$('#trend-reset-filter');
  const hasStatBand = await page.$('.trends-stat-band');
  check('browser: 0 matches shows empty card without charts/stat bands',
    emptyCard != null &&
    emptyText.includes('この条件の試合はまだありません') &&
    emptyText.includes('マッチタイプとルールを変えると、記録済みの試合から集計します') &&
    hasResetBtn != null &&
    hasStatBand == null,
    `hasReset=${!!hasResetBtn}, hasStat=${!!hasStatBand}`
  );

  // スクショ 3: 03-empty.png
  await page.screenshot({ path: path.join(SH, '03-empty.png') });
  check('browser: screenshot 03-empty.png saved', fs.existsSync(path.join(SH, '03-empty.png')));

  // 検証 4: リセットボタンをクリックで12件に戻る
  await page.click('#trend-reset-filter');
  await page.waitForTimeout(300);
  const targetAfterReset = await page.textContent('.trend-target-line');
  check('browser: reset button restores all filters (12 matches)',
    targetAfterReset.includes('対象 12試合（全体12試合）'),
    targetAfterReset
  );

  // 検証 5: 直接 URL #trend?matchType=bankara_challenge&rule=yagura
  await page.goto(U + '#trend?matchType=bankara_challenge&rule=yagura');
  await page.waitForSelector('.trends-filter');

  const targetDirect = await page.textContent('.trend-target-line');
  check('browser: direct URL with query shows 6 matches',
    targetDirect.includes('対象 6試合（全体12試合）'),
    targetDirect
  );

  const sampleBanner6 = await page.textContent('.trend-sample-banner');
  check('browser: 6 matches shows reference banner (5-9 matches)',
    sampleBanner6.includes('対象 6 件のため参考値です'),
    sampleBanner6
  );

  const winrateMutedEl = await page.$('.stat-value-2xl.trend-winrate-muted');
  check('browser: winrate is muted for reference sample (5-9 matches)', winrateMutedEl != null);

  const xPowerHidden = await page.$('.trend-xpower-card');
  check('browser: X-power card is hidden for bankara_challenge', xPowerHidden == null);

  // スクショ 4: 04-stage-candidate.png (ステージ表と候補ランキングが見える位置)
  await page.screenshot({ path: path.join(SH, '04-stage-candidate.png'), fullPage: true });
  check('browser: screenshot 04-stage-candidate.png saved', fs.existsSync(path.join(SH, '04-stage-candidate.png')));

  // pageerror 確認
  check('browser: no pageerror detected', errors.length === 0, errors.join('; '));

  await cleanup();

} finally {
  if (browser) await browser.close().catch(() => {});
  try { srv.kill('SIGTERM'); } catch {}
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}
}

// ============================================================================
// 3. まとめ
// ============================================================================
console.log('\n--- Summary ---');
const total = results.length;
const passed = results.filter(Boolean).length;
const failed = total - passed;
console.log(`Total: ${passed}/${total} tests PASSED`);

if (failed > 0) {
  console.error(`FAILED: ${failed} tests failed.`);
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED!');
  process.exit(0);
}
