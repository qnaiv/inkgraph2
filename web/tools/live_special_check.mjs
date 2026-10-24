#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { LiveSpecialTracker } from '../src/core/live_special.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '..');

let passCount = 0;
let failCount = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passCount++;
    console.log(`[PASS] ${name}${detail ? ' - ' + detail : ''}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${name}${detail ? ' - ' + detail : ''}`);
  }
}

// ==========================================
// 純関数テスト (a) 〜 (h)
// ==========================================

// (a) 2秒 ready→切れて 3秒後に special が1件、t が区間の終わり
{
  const tr = new LiveSpecialTracker();
  const events = [];
  let emittedAt = null;
  for (let t = 0; t <= 7.0; t = +(t + 0.2).toFixed(1)) {
    const raw = t >= 1.2 && t <= 3.2; // 2.0s duration
    const evs = tr.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    if (evs.length) {
      events.push(...evs);
      if (emittedAt === null) emittedAt = t;
    }
  }
  const ok = events.length === 1 &&
    events[0].type === 'special' &&
    events[0].t === 3.2 &&
    events[0].ready === 1.2 &&
    emittedAt === 6.2; // 3.2 + gap(3.0) = 6.2
  check('(a) 2秒 ready→切れて 3秒後に special が1件、t が区間の終わり', ok,
    `events=${JSON.stringify(events)}, emittedAt=${emittedAt}`);
}

// (b) ready の途中に 1秒の切れ目（gap 内）→1件にまとまる
{
  const tr = new LiveSpecialTracker();
  const events = [];
  for (let t = 0; t <= 8.0; t = +(t + 0.2).toFixed(1)) {
    const raw = (t >= 1.0 && t <= 2.0) || (t >= 3.0 && t <= 4.0); // 1.0s gap between 2.0 and 3.0
    const evs = tr.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    events.push(...evs);
  }
  const ok = events.length === 1 &&
    events[0].type === 'special' &&
    events[0].t === 4.0 &&
    events[0].ready === 1.0;
  check('(b) ready の途中に 1秒の切れ目（gap 内）→1件にまとまる', ok,
    `events=${JSON.stringify(events)}`);
}

// (c) 0.2秒だけの ready→出ない
{
  const tr1 = new LiveSpecialTracker();
  const events1 = [];
  for (let t = 0; t <= 5.0; t = +(t + 0.2).toFixed(1)) {
    const raw = t === 1.0; // 単一フレーム
    const evs = tr1.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    events1.push(...evs);
  }
  const tr2 = new LiveSpecialTracker();
  const events2 = [];
  for (let t = 0; t <= 5.0; t = +(t + 0.2).toFixed(1)) {
    const raw = t === 1.0 || t === 1.2; // 0.2秒間（2フレーム: b-a=0.2 < minLen 0.3）
    const evs = tr2.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    events2.push(...evs);
  }
  const ok = events1.length === 0 && events2.length === 0;
  check('(c) 0.2秒だけの ready→出ない', ok,
    `1frame=${events1.length}, 2frames=${events2.length}`);
}

// (d) 区間の終わりの 0.3秒後にデス→special_lost
{
  const tr = new LiveSpecialTracker();
  const events = [];
  let deathCalled = false;
  for (let t = 0; t <= 7.0; t = +(t + 0.2).toFixed(1)) {
    if (!deathCalled && t >= 3.3) {
      tr.death(3.3); // 区間の終わり(3.0)の 0.3秒後
      deathCalled = true;
    }
    const raw = t >= 1.0 && t <= 3.0;
    const evs = tr.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    events.push(...evs);
  }
  const ok = events.length === 1 &&
    events[0].type === 'special_lost' &&
    events[0].t === 3.0 &&
    events[0].ready === 1.0;
  check('(d) 区間の終わりの 0.3秒後にデス→special_lost', ok,
    `events=${JSON.stringify(events)}`);
}

// (e) 区間の終わりの 3秒後にデス→special
{
  const tr = new LiveSpecialTracker();
  const events = [];
  for (let t = 0; t <= 8.0; t = +(t + 0.2).toFixed(1)) {
    if (t === 6.0) tr.death(6.0); // 3.0s after b=3.0 (outside [3.0-1.0, 3.0+1.5])
    const raw = t >= 1.0 && t <= 3.0;
    const evs = tr.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    events.push(...evs);
  }
  const ok = events.length === 1 &&
    events[0].type === 'special' &&
    events[0].t === 3.0 &&
    events[0].ready === 1.0;
  check('(e) 区間の終わりの 3秒後にデス→special', ok,
    `events=${JSON.stringify(events)}`);
}

// (f) 試合終了の 0.5秒前に区間が終わる→end() で何も出ない
{
  const tr = new LiveSpecialTracker();
  const events = [];
  for (let t = 90.0; t <= 99.5; t = +(t + 0.2).toFixed(1)) {
    const raw = t >= 90.0 && t <= 99.5;
    const evs = tr.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    events.push(...evs);
  }
  events.push(...tr.end(100.0));
  const ok = events.length === 0;
  check('(f) 試合終了の 0.5秒前に区間が終わる→end() で何も出ない', ok,
    `events=${JSON.stringify(events)}`);
}

// (g) 試合終了の 10秒前に終わり保留中→end() で special
{
  const tr = new LiveSpecialTracker();
  const events = [];
  for (let t = 80.0; t <= 92.0; t = +(t + 0.2).toFixed(1)) {
    const raw = t >= 80.0 && t <= 90.0; // ready ended at 90.0
    const evs = tr.frame({ t, gw: raw ? 1 : 0, ok: true, map: false, dead: false });
    events.push(...evs);
  }
  // At t=92.0, gap=3.0 hasn't fired yet (needs 93.0), so still pending
  events.push(...tr.end(100.0));
  const ok = events.length === 1 &&
    events[0].type === 'special' &&
    events[0].t === 90.0 &&
    events[0].ready === 80.0;
  check('(g) 試合終了の 10秒前に終わり保留中→end() で special', ok,
    `events=${JSON.stringify(events)}`);
}

// (h) map 表示中に一瞬 ready が切れても gap 内なら1件
{
  const tr = new LiveSpecialTracker();
  const events = [];
  for (let t = 0; t <= 7.0; t = +(t + 0.2).toFixed(1)) {
    const isMap = t >= 2.2 && t <= 2.4;
    const isReadyTime = t >= 1.0 && t <= 3.6;
    const evs = tr.frame({ t, gw: isReadyTime ? 1 : 0, ok: true, map: isMap, dead: false });
    events.push(...evs);
  }
  const ok = events.length === 1 &&
    events[0].type === 'special' &&
    events[0].t === 3.6 &&
    events[0].ready === 1.0;
  check('(h) map 表示中に一瞬 ready が切れても gap 内なら1件', ok,
    `events=${JSON.stringify(events)}`);
}

// (i) ライブのデスが区間の終わりの 0.8秒前（試合後の数え方ではデスの始まりが終わりの直後）→special_lost
{
  const tr = new LiveSpecialTracker();
  const events = [];
  for (let t = 0; t <= 8.0; t = +(t + 0.2).toFixed(1)) {
    if (t === 2.2) tr.death(2.2);
    events.push(...tr.frame({ t, gw: t >= 1.0 && t <= 3.0 ? 1 : 0, ok: true, map: false, dead: false }));
  }
  const ok = events.length === 1 && events[0].type === 'special_lost' && events[0].t === 3.0;
  check('(i) 区間の終わりの 0.8秒前にライブのデス→special_lost', ok, `events=${JSON.stringify(events)}`);
}

// (j) 区間の始まりより前のデスは数えない（生き返ってからゲージが溜まった）
{
  const tr = new LiveSpecialTracker();
  const events = [];
  for (let t = 0; t <= 8.0; t = +(t + 0.2).toFixed(1)) {
    if (t === 0.6) tr.death(0.6);
    events.push(...tr.frame({ t, gw: t >= 1.0 && t <= 1.4 ? 1 : 0, ok: true, map: false, dead: false }));
  }
  const ok = events.length === 1 && events[0].type === 'special';
  check('(j) 区間の始まりより前のデスは数えない', ok, `events=${JSON.stringify(events)}`);
}

// ==========================================
// 実映像の比較（--videos <json> 指定時のみ）
// ==========================================

const args = process.argv.slice(2);
let videosArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--videos' && args[i + 1]) {
    videosArg = args[i + 1];
    i++;
  } else if (args[i].startsWith('--videos=')) {
    videosArg = args[i].slice('--videos='.length);
  }
}

if (videosArg) {
  let videoMap = null;
  try {
    if (fs.existsSync(videosArg)) {
      videoMap = JSON.parse(fs.readFileSync(videosArg, 'utf8'));
    } else {
      videoMap = JSON.parse(videosArg);
    }
  } catch (err) {
    console.error(`--videos の解析に失敗しました: ${err.message}`);
    process.exit(1);
  }

  const { prepAssets } = await import('../src/core/assets.js');
  const { Analyzer } = await import('../src/core/analyzer.js');
  const assetsJsonPath = path.join(webDir, 'public/assets/inkgraph_assets.json');
  const A = prepAssets(JSON.parse(fs.readFileSync(assetsJsonPath, 'utf8')));

  const allResults = [];

  for (const [name, videoPath] of Object.entries(videoMap)) {
    if (!fs.existsSync(videoPath)) {
      console.warn(`[WARN] 動画が見つかりません: ${videoPath} (${name})`);
      continue;
    }
    const srcH = +execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "${videoPath}"`).toString().trim();
    const recs = [];
    let currentLiveSp = 0;

    const an = new Analyzer(A, {
      srcH,
      onEvent: e => {
        if (e.type === 'battle_start') {
          currentLiveSp = 0;
        } else if (e.type === 'special') {
          currentLiveSp++;
        } else if (e.type === 'battle_discard') {
          currentLiveSp = 0;
        }
      },
      onMatch: rec => {
        const finSp = (rec.special || []).filter(s => s.outcome === 'activated').length;
        recs.push({
          matchNo: rec.no ?? (recs.length + 1),
          live: currentLiveSp,
          fin: finSp,
          diff: Math.abs(currentLiveSp - finSp)
        });
      }
    });

    const W = 1280, H = 720, FS = W * H * 4;
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', videoPath, '-vf', `fps=5,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    let buf = Buffer.alloc(0), n = 0;
    for await (const ch of ff.stdout) {
      buf = Buffer.concat([buf, ch]);
      while (buf.length >= FS) {
        const d = new Uint8ClampedArray(buf.subarray(0, FS));
        buf = buf.subarray(FS);
        an.frame({ w: W, h: H, data: d }, +(n++ * 0.2).toFixed(1));
      }
    }
    an.flush?.();

    for (const r of recs) {
      allResults.push({ name, ...r });
      const statusStr = r.live === r.fin ? '一致' : `ずれ (${r.live > r.fin ? '+' : ''}${r.live - r.fin})`;
      console.log(`[VIDEO] ${name} 試合#${r.matchNo}: ライブ ${r.live} / 確定 ${r.fin} / ${statusStr}`);
    }
  }

  if (allResults.length > 0) {
    const total = allResults.length;
    const exact = allResults.filter(r => r.diff === 0).length;
    const within1 = allResults.every(r => r.diff <= 1);
    const maxDiff = Math.max(...allResults.map(r => r.diff));
    const exactPct = (exact / total * 100).toFixed(1);

    console.log(`\n実映像の集計: 合計 ${total} 試合, 完全一致 ${exact}/${total} (${exactPct}%), 最大差 ${maxDiff}`);
    check('実映像の比較（差が全試合で±1以内）', within1, `完全一致率: ${exactPct}%, 最大差: ${maxDiff}`);
  } else {
    console.log('実映像の試合データがありませんでした。');
  }
}

// ==========================================
// 総合判定
// ==========================================
console.log('');
if (failCount === 0) {
  console.log(`ALL ${passCount} PASS`);
} else {
  console.error(`FAIL (${passCount}/${passCount + failCount} passed)`);
  process.exit(1);
}
