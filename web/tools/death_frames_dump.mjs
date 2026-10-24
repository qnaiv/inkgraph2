// 診断ツール: 指定動画・区間の各フレームの t, ok, map, sig, 生の runs, own_deaths をダンプ
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { prepAssets } from '../src/core/assets.js';
import { Analyzer, mergeDeathRuns, buildMatch } from '../src/core/analyzer.js';
import { runs, medfilt } from '../src/core/img.js';

const args = process.argv.slice(2);
let video = null;
let fromT = 60.0;
let toT = 75.0;
let outPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from' && i + 1 < args.length) {
    fromT = parseFloat(args[++i]);
  } else if (args[i] === '--to' && i + 1 < args.length) {
    toT = parseFloat(args[++i]);
  } else if (args[i] === '--out' && i + 1 < args.length) {
    outPath = args[++i];
  } else if (!args[i].startsWith('-') && !video) {
    video = args[i];
  }
}

if (!video) {
  console.error('Usage: node death_frames_dump.mjs <video> [--from <sec>] [--to <sec>] [--out <file>]');
  process.exit(1);
}

const assetsPath = path.resolve(import.meta.dirname, '../public/assets/inkgraph_assets.json');
const A = prepAssets(JSON.parse(fs.readFileSync(assetsPath, 'utf8')));

const matches = [];
let capturedF = null;

const an = new Analyzer(A, {
  srcH: +execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "${video}"`).toString().trim() || 1080,
  onMatch: m => {
    matches.push(m);
  }
});

const origFinish = an.finish.bind(an);
an.finish = (...a) => {
  if (an.cur && an.cur.F) {
    capturedF = an.cur.F.map(f => ({ ...f }));
  }
  return origFinish(...a);
};

const W = 1280, H = 720, FS = W * H * 4;
const ff = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=5,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);

let buf = Buffer.alloc(0), n = 0;
for await (const ch of ff.stdout) {
  buf = Buffer.concat([buf, ch]);
  while (buf.length >= FS) {
    const d = new Uint8ClampedArray(buf.subarray(0, FS));
    buf = buf.subarray(FS);
    const t = +(n++ * 0.2).toFixed(1);
    an.frame({ w: W, h: H, data: d }, t);
  }
}
an.flush?.();

if (!capturedF && an.cur && an.cur.F) {
  capturedF = an.cur.F.map(f => ({ ...f }));
}

const allF = capturedF || [];
const filteredFrames = allF
  .filter(f => f.t >= fromT - 1e-4 && f.t <= toT + 1e-4)
  .map(f => ({
    t: +(f.t).toFixed(1),
    ok: !!f.ok,
    map: !!f.map,
    sig: !!f.sig
  }));

// Analyzer 全体の F から runs と mergeDeathRuns を計算
const tAll = allF.map(f => f.t);
const okAll = allF.map(f => f.ok);
const mpAll = allF.map(f => f.map);
const sigAll = medfilt(allF.map(f => f.sig), 5);
const rawRuns = runs(tAll, sigAll, 0, 0);
const mergedRuns = mergeDeathRuns(tAll, sigAll, okAll, mpAll);

const lastMatch = matches.length ? matches[matches.length - 1] : null;
const ownDeaths = lastMatch ? (lastMatch.own_deaths || []) : [];

const outputData = {
  video,
  from: fromT,
  to: toT,
  frames: filteredFrames,
  raw_runs_in_window: rawRuns.filter(([a, b]) => b >= fromT && a <= toT),
  raw_runs_all: rawRuns,
  merged_runs_in_window: mergedRuns.filter(([a, b]) => b >= fromT && a <= toT),
  merged_runs_all: mergedRuns,
  own_deaths: ownDeaths
};

const jsonStr = JSON.stringify(outputData, null, 2);
if (outPath) {
  fs.writeFileSync(outPath, jsonStr, 'utf8');
} else {
  console.log(jsonStr);
}
