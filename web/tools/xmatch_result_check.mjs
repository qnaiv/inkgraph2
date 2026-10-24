// Verification of result-screen reading across X-match and joined-match frames.
// usage: node web/tools/xmatch_result_check.mjs [XM_DIR]
import fs from 'node:fs';
import path from 'node:path';
import { prepAssets } from '../src/core/assets.js';
import { classify, readHeader, readPersonal, readBoard, finalizeResult } from '../src/core/result.js';
import { isTowerRule } from '../src/core/analyzer.js';

const D = path.resolve(import.meta.dirname, '..');
const assetFile = fs.readdirSync(path.join(D, 'public/assets')).find(f => f.endsWith('.json'));
if (!assetFile) {
  console.error('Asset file not found in public/assets');
  process.exit(1);
}
const A = prepAssets(JSON.parse(fs.readFileSync(path.join(D, 'public/assets', assetFile), 'utf8')));

const xmDir = process.argv[2] || process.env.XM_DIR || '/tmp/xm/dump';
if (!fs.existsSync(xmDir)) {
  console.error(`XM_DIR does not exist: ${xmDir}`);
  process.exit(1);
}

const jsonFiles = fs.readdirSync(xmDir).filter(f => f.endsWith('.json')).sort((a, b) => {
  const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
  const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
  return numA - numB || a.localeCompare(b);
});

if (!jsonFiles.length) {
  console.error(`No .json files found in ${xmDir}`);
  process.exit(1);
}

function parseTruth(name, truthInJson) {
  const m = name.match(/match\d+_(ガチヤグラ|ガチホコバトル)_([^_]+)_(WIN|LOSE)_KA(\d+)_D(\d+)_SP(\d+)/);
  if (m) {
    return {
      result: m[3],
      ka: parseInt(m[4], 10),
      deaths: parseInt(m[5], 10),
      specials: parseInt(m[6], 10),
      mode: m[1],
      stage: m[2],
      match_type: 'x'
    };
  }
  if (name.includes('joined_match')) {
    return {
      result: truthInJson?.result ?? null,
      ka: truthInJson?.ka ?? null,
      deaths: truthInJson?.deaths ?? null,
      specials: truthInJson?.specials ?? null,
      mode: 'ガチヤグラ',
      stage: 'クサヤ温泉',
      match_type: null
    };
  }
  return truthInJson;
}

const items = ['result', 'ka', 'deaths', 'specials', 'mode', 'stage', 'match_type'];
const totalCounts = Object.fromEntries(items.map(k => [k, [0, 0]]));
const rows = [];
let hasMismatch = false;

for (const jfile of jsonFiles) {
  const J = JSON.parse(fs.readFileSync(path.join(xmDir, jfile), 'utf8'));
  const rawPath = path.join(xmDir, jfile.replace(/\.json$/, '.raw'));
  const rawBuf = fs.readFileSync(rawPath);
  const { w, h, frames, name } = J;
  const truth = parseTruth(name, J.truth);

  const RS = { celebration: [], personal: [], board: [] };
  const panelCounts = {};

  for (let k = 0; k < frames.length; k++) {
    const t = frames[k];
    const data = new Uint8ClampedArray(w * h * 4);
    const rawOffset = k * w * h * 3;
    for (let p = 0; p < w * h; p++) {
      const s = rawOffset + p * 3;
      const d = p * 4;
      data[d] = rawBuf[s];
      data[d + 1] = rawBuf[s + 1];
      data[d + 2] = rawBuf[s + 2];
      data[d + 3] = 255;
    }
    const fr = { w, h, data };
    const c = classify(A, fr);
    if (c) {
      if (c.kind === 'celebration') {
        RS.celebration.push({ t, value: c.value });
      } else {
        panelCounts[c.panel] = (panelCounts[c.panel] || 0) + 1;
        const [dx, dy] = c.off;
        const header = readHeader(A, fr, dx, dy, undefined, c.panel);
        const e = { t, header };
        if (c.kind === 'personal') e.personal = readPersonal(A, fr, dx, dy);
        else e.board = readBoard(A, fr, dx, dy);
        RS[c.kind].push(e);
      }
    }
  }

  const res = finalizeResult(RS);
  const detected = {
    result: res.result || null,
    ka: res.own ? res.own.ka : null,
    deaths: res.own ? res.own.deaths : null,
    specials: res.own ? res.own.specials : null,
    mode: res.mode || null,
    stage: res.stage || null,
    match_type: res.match_type || null
  };

  const rowEval = {};
  for (const k of items) {
    let ok = detected[k] === truth[k];
    // joined 試合で JS 側の既存マッチタイプ判定（PR #133 MATCH_TYPE_BOX）により bankara_challenge が検出された場合も許容
    if (!ok && k === 'match_type' && truth.match_type === null && detected.match_type === 'bankara_challenge') {
      ok = true;
    }
    rowEval[k] = ok;
    totalCounts[k][1]++;
    if (ok) totalCounts[k][0]++;
    else hasMismatch = true;
  }

  const towerRule = isTowerRule(res.mode);
  const isHoko = truth.mode === 'ガチホコバトル' || res.mode === 'ガチホコバトル';
  if (isHoko && towerRule) {
    hasMismatch = true;
  }

  const panelBreakdown = Object.entries(panelCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(', ') || 'none';

  rows.push({
    name,
    panel: panelBreakdown,
    detected,
    truth,
    eval: rowEval,
    towerRule
  });
}

// 表の出力
console.log('='.repeat(140));
console.log(
  `${'Video'.padEnd(45)} | ${'Panel'.padEnd(14)} | ${'Result'.padEnd(10)} | ${'K+A'.padEnd(8)} | ${'D'.padEnd(8)} | ${'SP'.padEnd(8)} | ${'Mode'.padEnd(14)} | ${'Stage'.padEnd(14)} | ${'Type'.padEnd(8)} | ${'TowerRule'.padEnd(10)}`
);
console.log('-'.repeat(140));

for (const r of rows) {
  const d = r.detected;
  const t = r.truth;
  const ev = r.eval;
  const mark = k => (ev[k] ? '✓' : `✗(${t[k]})`);

  const resStr = `${d.result}${mark('result')}`;
  const kaStr = `${d.ka}${mark('ka')}`;
  const dStr = `${d.deaths}${mark('deaths')}`;
  const spStr = `${d.specials}${mark('specials')}`;
  const modeStr = `${d.mode}${mark('mode')}`;
  const stageStr = `${d.stage}${mark('stage')}`;
  const mtStr = `${d.match_type}${mark('match_type')}`;
  const trStr = `${r.towerRule}`;

  let shortName = r.name;
  if (shortName.length > 43) {
    shortName = shortName.slice(0, 20) + '...' + shortName.slice(-20);
  }

  console.log(
    `${shortName.padEnd(45)} | ${r.panel.padEnd(14)} | ${resStr.padEnd(10)} | ${kaStr.padEnd(8)} | ${dStr.padEnd(8)} | ${spStr.padEnd(8)} | ${modeStr.padEnd(14)} | ${stageStr.padEnd(14)} | ${mtStr.padEnd(8)} | ${trStr.padEnd(10)}`
  );
}

console.log('-'.repeat(140));
const summaryParts = items.map(k => `${k}: ${totalCounts[k][0]}/${totalCounts[k][1]}`);
console.log('Summary matches: ' + summaryParts.join(', '));

console.log('-'.repeat(140));
console.log('Hoko guard checks (isTowerRule(mode) === false on Hoko matches):');
for (const r of rows) {
  const isHoko = r.truth.mode === 'ガチホコバトル' || r.detected.mode === 'ガチホコバトル';
  if (isHoko) {
    const status = !r.towerRule ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${r.name}: mode=${r.detected.mode}, isTowerRule=${r.towerRule}`);
  }
}
console.log('='.repeat(140));

if (hasMismatch) {
  console.log('ERROR: Mismatch or guard failure detected in one or more items.');
  process.exit(1);
} else {
  console.log('SUCCESS: All videos matched truth expectations (JS).');
}
