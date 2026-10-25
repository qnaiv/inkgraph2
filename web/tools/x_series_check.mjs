// #134 X-match series and power check tool
// Usage: node tools/x_series_check.mjs [--pure-only] [--videos path1,path2]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prepAssets } from '../src/core/assets.js';
import {
  finalizeSeries,
  powerForSeries,
  powerForMatchType,
  readXPower,
  finalizeXPower
} from '../src/core/result.js';
import { Analyzer } from '../src/core/analyzer.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

const args = process.argv.slice(2);
const pureOnly = args.includes('--pure-only');
const videosIdx = args.indexOf('--videos');
const customVideos = videosIdx !== -1 && args[videosIdx + 1] ? args[videosIdx + 1].split(',') : null;

// ===========================================================================
// (1) Pure Function Tests
// ===========================================================================
console.log('--- Pure Function Tests ---');

// --- finalizeSeries ---
// 1. 0-0 が5フレーム→1-0 が5フレーム で in_progress 1-0 before 0-0
const reads_00_10 = [
  ...Array.from({ length: 5 }, (_, i) => ({ t: i * 0.2, win: 0, lose: 0 })),
  ...Array.from({ length: 5 }, (_, i) => ({ t: 1.0 + i * 0.2, win: 1, lose: 0 }))
];
const res_00_10 = finalizeSeries(reads_00_10);
check(
  'finalizeSeries: 0-0 (5f) -> 1-0 (5f) => in_progress 1-0 before 0-0',
  res_00_10 &&
    res_00_10.state === 'in_progress' &&
    res_00_10.win === 1 &&
    res_00_10.lose === 0 &&
    res_00_10.before?.win === 0 &&
    res_00_10.before?.lose === 0 &&
    res_00_10.frames === 10,
  JSON.stringify(res_00_10)
);

// 2. 2-0→2-1 で in_progress
const reads_20_21 = [
  ...Array.from({ length: 5 }, (_, i) => ({ t: i * 0.2, win: 2, lose: 0 })),
  ...Array.from({ length: 5 }, (_, i) => ({ t: 1.0 + i * 0.2, win: 2, lose: 1 }))
];
const res_20_21 = finalizeSeries(reads_20_21);
check(
  'finalizeSeries: 2-0 -> 2-1 => in_progress',
  res_20_21 &&
    res_20_21.state === 'in_progress' &&
    res_20_21.win === 2 &&
    res_20_21.lose === 1 &&
    res_20_21.before?.win === 2 &&
    res_20_21.before?.lose === 0,
  JSON.stringify(res_20_21)
);

// 3. 2-1→3-1 で finished
const reads_21_31 = [
  ...Array.from({ length: 5 }, (_, i) => ({ t: i * 0.2, win: 2, lose: 1 })),
  ...Array.from({ length: 5 }, (_, i) => ({ t: 1.0 + i * 0.2, win: 3, lose: 1 }))
];
const res_21_31 = finalizeSeries(reads_21_31);
check(
  'finalizeSeries: 2-1 -> 3-1 => finished',
  res_21_31 &&
    res_21_31.state === 'finished' &&
    res_21_31.win === 3 &&
    res_21_31.lose === 1 &&
    res_21_31.before?.win === 2 &&
    res_21_31.before?.lose === 1,
  JSON.stringify(res_21_31)
);

// 4. 1-2→1-3 で finished
const reads_12_13 = [
  ...Array.from({ length: 5 }, (_, i) => ({ t: i * 0.2, win: 1, lose: 2 })),
  ...Array.from({ length: 5 }, (_, i) => ({ t: 1.0 + i * 0.2, win: 1, lose: 3 }))
];
const res_12_13 = finalizeSeries(reads_12_13);
check(
  'finalizeSeries: 1-2 -> 1-3 => finished',
  res_12_13 &&
    res_12_13.state === 'finished' &&
    res_12_13.win === 1 &&
    res_12_13.lose === 3 &&
    res_12_13.before?.win === 1 &&
    res_12_13.before?.lose === 2,
  JSON.stringify(res_12_13)
);

// 5. 空→null
check('finalizeSeries: empty -> null', finalizeSeries([]) === null);

// 6. 2フレームしか続かない値だけ→null
const reads_short = [
  { t: 0.0, win: 0, lose: 0 },
  { t: 0.2, win: 0, lose: 0 },
  { t: 0.4, win: 1, lose: 0 },
  { t: 0.6, win: 1, lose: 0 }
];
check('finalizeSeries: only <=2 frames -> null', finalizeSeries(reads_short) === null);

// 7. 0-0→2-0（2試合飛ぶ）→unknown
const reads_skip2 = [
  ...Array.from({ length: 5 }, (_, i) => ({ t: i * 0.2, win: 0, lose: 0 })),
  ...Array.from({ length: 5 }, (_, i) => ({ t: 1.0 + i * 0.2, win: 2, lose: 0 }))
];
const res_skip2 = finalizeSeries(reads_skip2);
check(
  'finalizeSeries: 0-0 -> 2-0 (diff=2) => unknown',
  res_skip2 &&
    res_skip2.state === 'unknown' &&
    res_skip2.win === null &&
    res_skip2.lose === null &&
    res_skip2.before?.win === 0 &&
    res_skip2.before?.lose === 0 &&
    res_skip2.after?.win === 2 &&
    res_skip2.after?.lose === 0 &&
    res_skip2.frames === 10,
  JSON.stringify(res_skip2)
);

// 8. 0.6秒より空いた前のまとまりは無視されること
const reads_gap = [
  ...Array.from({ length: 5 }, (_, i) => ({ t: i * 0.2, win: 0, lose: 0 })), // t: 0.0..0.8
  // gap > 0.6s
  ...Array.from({ length: 5 }, (_, i) => ({ t: 3.0 + i * 0.2, win: 1, lose: 0 })), // t: 3.0..3.8
  ...Array.from({ length: 5 }, (_, i) => ({ t: 4.0 + i * 0.2, win: 2, lose: 0 }))  // t: 4.0..4.8
];
const res_gap = finalizeSeries(reads_gap);
check(
  'finalizeSeries: cluster with gap > 0.6s ignores older cluster',
  res_gap &&
    res_gap.state === 'in_progress' &&
    res_gap.win === 2 &&
    res_gap.lose === 0 &&
    res_gap.before?.win === 1 &&
    res_gap.before?.lose === 0,
  JSON.stringify(res_gap)
);

// --- powerForSeries ---
// 1. bankara_open -> not_applicable (no reason)
const ps_open = powerForSeries('bankara_open', { state: 'in_progress' }, null);
check(
  'powerForSeries: bankara_open -> not_applicable (no reason)',
  ps_open.value === null && ps_open.status === 'not_applicable' && ps_open.reason === undefined,
  JSON.stringify(ps_open)
);

// 2. null -> unknown_type
const ps_null = powerForSeries(null, null, null);
check(
  'powerForSeries: null -> unknown_type',
  ps_null.value === null && ps_null.status === 'unknown_type' && ps_null.reason === undefined,
  JSON.stringify(ps_null)
);

// 3. x + null -> not_shown / series_unknown
const ps_x_null = powerForSeries('x', null, null);
check(
  'powerForSeries: x + null -> not_shown / series_unknown',
  ps_x_null.value === null && ps_x_null.status === 'not_shown' && ps_x_null.reason === 'series_unknown',
  JSON.stringify(ps_x_null)
);

// 4. x + in_progress -> not_shown / series_in_progress
const ps_x_prog = powerForSeries('x', { state: 'in_progress' }, null);
check(
  'powerForSeries: x + in_progress -> not_shown / series_in_progress',
  ps_x_prog.value === null && ps_x_prog.status === 'not_shown' && ps_x_prog.reason === 'series_in_progress',
  JSON.stringify(ps_x_prog)
);

// 5. x + finished + null -> read_failed
const ps_x_fin_null = powerForSeries('x', { state: 'finished' }, null);
check(
  'powerForSeries: x + finished + null xp -> read_failed',
  ps_x_fin_null.value === null && ps_x_fin_null.status === 'read_failed' && ps_x_fin_null.reason === 'series_finished',
  JSON.stringify(ps_x_fin_null)
);

// 6. x + finished + {value:2150.3,confidence:0.95} -> acquired 2150.3
const ps_x_fin_val = powerForSeries('x', { state: 'finished' }, { value: 2150.3, confidence: 0.95 });
check(
  'powerForSeries: x + finished + xp valid -> acquired 2150.3',
  ps_x_fin_val.value === 2150.3 &&
    ps_x_fin_val.status === 'acquired' &&
    ps_x_fin_val.confidence === 0.95 &&
    ps_x_fin_val.reason === 'series_finished',
  JSON.stringify(ps_x_fin_val)
);

// 7. value が文字列や null の xp -> read_failed
const ps_x_str = powerForSeries('x', { state: 'finished' }, { value: '2150.3', confidence: 0.95 });
const ps_x_vnull = powerForSeries('x', { state: 'finished' }, { value: null, confidence: 0.95 });
check(
  'powerForSeries: x + finished + invalid xp.value -> read_failed',
  ps_x_str.status === 'read_failed' && ps_x_vnull.status === 'read_failed',
  `str=${ps_x_str.status}, null=${ps_x_vnull.status}`
);

// --- finalizeXPower ---
// 1. 空 -> null
check('finalizeXPower: empty -> null', finalizeXPower([]) === null);
// 2. confidence 0.5 だけ -> null
check(
  'finalizeXPower: confidence 0.5 -> null',
  finalizeXPower([{ t: 1.0, value: 2150.3, confidence: 0.5 }]) === null
);

// --- readXPower ---
check('readXPower: returns null', readXPower(null, null) === null && readXPower({}, {}) === null);

// ===========================================================================
// (2) Real Video Tests
// ===========================================================================
if (!pureOnly) {
  console.log('\n--- Real Video Tests ---');

  const assetFile = fs.readdirSync(path.join(WEB_DIR, 'public/assets')).find(f => f.endsWith('.json'));
  if (!assetFile) {
    console.error('FAIL: Asset file not found in public/assets');
    process.exit(1);
  }
  const A = prepAssets(JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'public/assets', assetFile), 'utf8')));

  // 正解（動画から目視で作成、コメントに書く）：
  // /workspace/igc/rules/22-15-50_match03.mp4: 1-0 (before 0-0)
  // /workspace/igc/rules/22-15-50_match04.mp4: 2-0 (before 1-0)
  // /workspace/igc/rules/22-15-50_match05.mp4: 2-1 (before 2-0)
  // /workspace/igc/rules/23-23-22_match01.mp4: 1-0 (before 0-0)
  // /workspace/igc/rules/23-23-22_match02.mp4: 1-1 (before 1-0)
  // /workspace/igc/rules/23-23-22_match03.mp4: 2-1 (before 1-1)
  const defaultTargets = [
    {
      file: '/workspace/igc/rules/22-15-50_match03.mp4',
      isX: true,
      truth: { win: 1, lose: 0, beforeWin: 0, beforeLose: 0 }
    },
    {
      file: '/workspace/igc/rules/22-15-50_match04.mp4',
      isX: true,
      truth: { win: 2, lose: 0, beforeWin: 1, beforeLose: 0 }
    },
    {
      file: '/workspace/igc/rules/22-15-50_match05.mp4',
      isX: true,
      truth: { win: 2, lose: 1, beforeWin: 2, beforeLose: 0 }
    },
    {
      file: '/workspace/igc/rules/23-23-22_match01.mp4',
      isX: true,
      truth: { win: 1, lose: 0, beforeWin: 0, beforeLose: 0 }
    },
    {
      file: '/workspace/igc/rules/23-23-22_match02.mp4',
      isX: true,
      truth: { win: 1, lose: 1, beforeWin: 1, beforeLose: 0 }
    },
    {
      file: '/workspace/igc/rules/23-23-22_match03.mp4',
      isX: true,
      truth: { win: 2, lose: 1, beforeWin: 1, beforeLose: 1 }
    },
    {
      file: '/workspace/igw/x_match01.mp4',
      isX: false,
      truth: null
    }
  ];

  let targets = defaultTargets;
  if (customVideos) {
    targets = customVideos.map(cv => {
      const found = defaultTargets.find(t => t.file === cv || path.basename(t.file) === cv);
      return found || { file: cv, isX: false, truth: null };
    });
  }

  const FRAME_SIZE = 1280 * 720 * 4;
  const tableRows = [];

  for (const target of targets) {
    const videoPath = target.file;
    const baseName = path.basename(videoPath);
    if (!fs.existsSync(videoPath)) {
      check(`video exists: ${baseName}`, false, `File not found: ${videoPath}`);
      continue;
    }

    const recs = [];
    const analyzer = new Analyzer(A, {
      srcH: 1080,
      onMatch: rec => recs.push(rec)
    });

    const startMs = Date.now();
    const child = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', 'fps=5,scale=1280:720',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    let remainder = Buffer.alloc(0);
    let frameIndex = 0;

    for await (const chunk of child.stdout) {
      remainder = Buffer.concat([remainder, chunk]);
      while (remainder.length >= FRAME_SIZE) {
        const frameBuf = remainder.subarray(0, FRAME_SIZE);
        const data = new Uint8ClampedArray(frameBuf.buffer, frameBuf.byteOffset, FRAME_SIZE);
        const fr = { w: 1280, h: 720, data };
        const t = frameIndex / 5;
        analyzer.frame(fr, t);
        frameIndex++;
        remainder = Buffer.from(remainder.subarray(FRAME_SIZE));
      }
    }
    analyzer.flush();
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

    if (target.isX) {
      const rec = recs.length ? recs[recs.length - 1] : null;
      const xSeries = rec?.x_series;
      const power = rec?.power;
      const ok =
        recs.length >= 1 &&
        rec.match_type === 'x' &&
        xSeries?.state === 'in_progress' &&
        xSeries?.win === target.truth.win &&
        xSeries?.lose === target.truth.lose &&
        xSeries?.before?.win === target.truth.beforeWin &&
        xSeries?.before?.lose === target.truth.beforeLose &&
        power?.status === 'not_shown' &&
        power?.reason === 'series_in_progress' &&
        power?.value === null;

      check(
        `x_series: ${baseName}`,
        ok,
        `recs=${recs.length}, type=${rec?.match_type}, state=${xSeries?.state}, win-lose=${xSeries?.win}-${xSeries?.lose} (exp ${target.truth.win}-${target.truth.lose}), before=${xSeries?.before?.win}-${xSeries?.before?.lose} (exp ${target.truth.beforeWin}-${target.truth.beforeLose}), power.status=${power?.status}, reason=${power?.reason}`
      );

      tableRows.push({
        video: baseName,
        match_type: rec?.match_type ?? 'none',
        state: xSeries?.state ?? 'none',
        win_lose: xSeries ? `${xSeries.win}-${xSeries.lose}` : '-',
        before: xSeries?.before ? `${xSeries.before.win}-${xSeries.before.lose}` : '-',
        power_status: power?.status ?? '-',
        reason: power?.reason ?? '-',
        elapsed_sec: `${elapsedSec}s`
      });
    } else {
      // 非Xの回帰
      const allNonX = recs.every(r => r.match_type !== 'x');
      const allOk =
        recs.length >= 1 &&
        allNonX &&
        recs.every(r => r.x_series === null && r.power.status === powerForMatchType(r.match_type).status);

      check(
        `non-X regression: ${baseName}`,
        allOk,
        `recs=${recs.length}, allNonX=${allNonX}`
      );

      const rec = recs.length ? recs[recs.length - 1] : null;
      tableRows.push({
        video: baseName,
        match_type: rec?.match_type ?? 'none',
        state: rec?.x_series?.state ?? 'null',
        win_lose: '-',
        before: '-',
        power_status: rec?.power?.status ?? '-',
        reason: rec?.power?.reason ?? '-',
        elapsed_sec: `${elapsedSec}s`
      });
    }
  }

  // Display results table
  console.log('\n--- Video Results Summary Table ---');
  console.table(tableRows);
}

// ===========================================================================
// Summary
// ===========================================================================
const allPass = results.length > 0 && results.every(Boolean);
console.log(`\nTotal: ${results.filter(Boolean).length}/${results.length} tests PASSED`);
if (!allPass) {
  process.exit(1);
}
