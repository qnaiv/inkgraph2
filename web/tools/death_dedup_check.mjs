// Death dedup check (D38): DeathLatch and mergeDeathRuns unit checks, and timeline screenshot.
import { DeathLatch, mergeDeathRuns, buildMatch } from '../src/core/analyzer.js';
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(WEB_DIR, '..');
const SH = path.join(ROOT, 'docs/screenshots/death-dedup');
fs.mkdirSync(SH, { recursive: true });

let fails = 0;
const results = [];
const check = (ok, name, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) fails++;
};

console.log('--- 1. DeathLatch (Live) Unit Checks ---');

// a. ライブ: デス信号 -> マップ開閉で信号が消えて戻る -> 再発火しない (発火1回)
{
  const latch = new DeathLatch(1.0);
  const events = [];
  const frames = [
    { t: 10.0, dead: false, tp: true, mp: false },
    { t: 10.2, dead: true, tp: true, mp: false },  // fire 1
    { t: 10.4, dead: true, tp: true, mp: false },
    { t: 10.6, dead: false, tp: true, mp: true },  // map open (dead signal disappears)
    { t: 10.8, dead: false, tp: true, mp: true },
    { t: 15.0, dead: false, tp: true, mp: true },  // > 4s in map
    { t: 15.2, dead: true, tp: true, mp: false },  // map close (signal reappears)
    { t: 15.4, dead: true, tp: true, mp: false },
  ];
  for (const f of frames) {
    if (latch.update(f.dead, f.tp, f.mp, f.t)) events.push(f.t);
  }
  check(events.length === 1 && events[0] === 10.2, 'case (a) Live map open/close: fires once', `events=${JSON.stringify(events)}`);
}

// b. ライブ: 信号の短いチラつき (通常画面で0.4秒だけ消える) -> 再発火しない
{
  const latch = new DeathLatch(1.0);
  const events = [];
  const frames = [
    { t: 20.0, dead: true, tp: true, mp: false },  // fire 1
    { t: 20.2, dead: false, tp: true, mp: false }, // flicker 0.2s
    { t: 20.4, dead: false, tp: true, mp: false }, // flicker 0.4s
    { t: 20.6, dead: true, tp: true, mp: false },  // signal returns
    { t: 20.8, dead: true, tp: true, mp: false },
  ];
  for (const f of frames) {
    if (latch.update(f.dead, f.tp, f.mp, f.t)) events.push(f.t);
  }
  check(events.length === 1 && events[0] === 20.0, 'case (b) Live short flicker (0.4s): fires once', `events=${JSON.stringify(events)}`);
}

// c. ライブ: 復活確認 (通常画面で信号なしが1秒以上) の後に再び信号 -> 2回目として発火する (連続デスの取りこぼしなし)
{
  const latch = new DeathLatch(1.0);
  const events = [];
  const frames = [
    { t: 30.0, dead: true, tp: true, mp: false },  // fire 1
    { t: 34.0, dead: false, tp: true, mp: false }, // alive start
    { t: 34.2, dead: false, tp: true, mp: false },
    { t: 34.4, dead: false, tp: true, mp: false },
    { t: 34.6, dead: false, tp: true, mp: false },
    { t: 34.8, dead: false, tp: true, mp: false },
    { t: 35.0, dead: false, tp: true, mp: false }, // >= 1.0s clear -> unlatched
    { t: 40.0, dead: true, tp: true, mp: false },  // fire 2
  ];
  for (const f of frames) {
    if (latch.update(f.dead, f.tp, f.mp, f.t)) events.push(f.t);
  }
  check(events.length === 2 && events[0] === 30.0 && events[1] === 40.0, 'case (c) Live respawn confirmation (>=1.0s alive): fires 2nd death', `events=${JSON.stringify(events)}`);
}

// d. ライブ: 試合開始リセット後に信号 -> 発火する
{
  const latch = new DeathLatch(1.0);
  latch.update(true, true, false, 1.0); // fire 1, latched
  check(latch.latched === true, 'case (d) setup: latch is active');
  latch.reset(); // reset on newBattle
  check(latch.latched === false, 'case (d) reset(): latch is reset');
  const fired = latch.update(true, true, false, 0.2);
  check(fired === true, 'case (d) Live new battle reset: fires on new death', `fired=${fired}`);
}

console.log('--- 2. mergeDeathRuns (Storage) Unit Checks ---');

// Helper to generate frames
function genFrames(specs, step = 0.2) {
  const t = [], sig = [], ok = [], mp = [];
  let curT = 0.0;
  for (const s of specs) {
    const count = Math.round(s.dur / step);
    for (let i = 0; i < count; i++) {
      t.push(Math.round(curT * 10) / 10);
      sig.push(s.sig ? 1 : 0);
      ok.push(s.ok !== undefined ? s.ok : true);
      mp.push(s.mp !== undefined ? s.mp : false);
      curT += step;
    }
  }
  return { t, sig, ok, mp };
}

// e. 保存側: 信号2区間がマップ表示の空白 (map=true) で隔てられ空白が4秒超 -> 1件に統合
{
  const f = genFrames([
    { dur: 2.0, sig: true, ok: true, mp: false },
    { dur: 4.8, sig: false, ok: true, mp: true },  // map open > 4.0s
    { dur: 2.0, sig: true, ok: true, mp: false },
  ]);
  const runs = mergeDeathRuns(f.t, f.sig, f.ok, f.mp);
  check(runs.length === 1, 'case (e) Storage 4s+ map gap: merged into 1 run', `runs=${JSON.stringify(runs)}`);
  if (runs.length === 1) {
    check(runs[0][0] === f.t[0] && Math.abs(runs[0][1] - f.t[f.t.length - 1]) < 0.3, 'case (e) span spans both signals', `start=${runs[0][0]} end=${runs[0][1]}`);
  }
}

// f. 保存側: 信号2区間が HUD非表示 (ok=false) の空白で隔てられる -> 1件
{
  const f = genFrames([
    { dur: 2.0, sig: true, ok: true, mp: false },
    { dur: 3.0, sig: false, ok: false, mp: false }, // HUD hidden
    { dur: 2.0, sig: true, ok: true, mp: false },
  ]);
  const runs = mergeDeathRuns(f.t, f.sig, f.ok, f.mp);
  check(runs.length === 1, 'case (f) Storage HUD hidden gap: merged into 1 run', `runs=${JSON.stringify(runs)}`);
}

// g. 保存側: 信号2区間の間に通常画面で生きている区間が1秒以上 -> 2件 (正規の連続デスを取りこぼさない)
{
  const f = genFrames([
    { dur: 2.0, sig: true, ok: true, mp: false },
    { dur: 1.4, sig: false, ok: true, mp: false }, // normal screen alive 1.4s (>= 1.0s)
    { dur: 2.0, sig: true, ok: true, mp: false },
  ]);
  const runs = mergeDeathRuns(f.t, f.sig, f.ok, f.mp);
  check(runs.length === 2, 'case (g) Storage >= 1.0s alive gap: splits into 2 runs', `runs=${JSON.stringify(runs)}`);
}

// h. 保存側: 生きている区間が1秒未満 (0.4秒) -> 1件
{
  const f = genFrames([
    { dur: 2.0, sig: true, ok: true, mp: false },
    { dur: 0.4, sig: false, ok: true, mp: false }, // flicker 0.4s (< 1.0s)
    { dur: 2.0, sig: true, ok: true, mp: false },
  ]);
  const runs = mergeDeathRuns(f.t, f.sig, f.ok, f.mp);
  check(runs.length === 1, 'case (h) Storage < 1.0s alive gap: merged into 1 run', `runs=${JSON.stringify(runs)}`);
}

// buildMatch verification
{
  const f = genFrames([
    { dur: 2.0, sig: true, ok: true, mp: false },
    { dur: 4.6, sig: false, ok: true, mp: true }, // map gap
    { dur: 2.0, sig: true, ok: true, mp: false },
  ]);
  const F = f.t.map((ti, i) => ({
    t: ti,
    ok: f.ok[i],
    map: f.mp[i],
    sig: f.sig[i] === 1,
    kill: false,
    gw: 0,
    go: 0,
    p: Array(8).fill(0),
    s: Array(8).fill(100),
    ally: null
  }));
  const m = {
    a: 0,
    b: f.t[f.t.length - 1],
    F,
    th: [50, 120],
    tower: [],
    RS: { celebration: [], personal: [], board: [] }
  };
  const rec = buildMatch(m, 1, 1080);
  check(rec.own_deaths.length === 1, 'buildMatch integration: own_deaths has 1 merged death', `len=${rec.own_deaths.length}`);
  if (rec.own_deaths.length === 1) {
    const d = rec.own_deaths[0];
    check(d.src === 'signal' && typeof d.start === 'number' && typeof d.end === 'number' && typeof d.alive_before === 'string',
      'buildMatch own_deaths schema preserved', JSON.stringify(d));
  }
}

console.log('--- 3. UI Timeline Screenshot Verification ---');

const PORT = 4198;
const U = `http://127.0.0.1:${PORT}/`;
const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  const page = await ctx.newPage();
  await page.route('https://fonts.**/**', r => r.abort());
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('pageerror:', e.message); });

  await page.goto(U + '#live');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.db);

  // Synthetic match representing a match where death was deduped (1 own death instead of 2 duplicated deaths)
  const synthMatch = {
    id: 'synth-death-dedup-match',
    session: 'synth-session',
    match: 1,
    battle: [0, 300],
    squid_down: {
      L0: [{ start: 30.0, end: 38.6, src: 'signal' }]
    },
    own_deaths: [
      { start: 30.0, end: 38.6, src: 'signal', alive_before: '4v4' }
    ],
    own_kills: [
      { start: 60.0, end: 60.0, alive_before: '4v4' }
    ],
    special: [
      { ready: 10.0, end: 28.0, outcome: 'lost_on_death', activated_at: null, alive_at_ready: '4v4' }
    ],
    hud_hidden: [],
    map_open: [[32.0, 36.6]], // map open during death
    stats: { duration: 300, map_open_s: 4.6, hud_hidden_s: 0 },
    team_hue: [30, 120],
    tower_series: [
      { t: 0, own: 100, enemy: 100, owner: 'neutral' },
      { t: 150, own: 70, enemy: 100, owner: 'own' },
      { t: 300, own: 50, enemy: 80, owner: 'own' }
    ],
    result_screen: {
      result: 'WIN',
      mode: 'ガチヤグラ',
      stage: 'クサヤ温泉',
      own: { ka: '1/0', deaths: 1, specials: 0 },
      result_source: 'celebration'
    },
    review: { marks: {}, added: [], fix: {} }
  };

  await page.evaluate(async m => {
    await window.inkgraph.db.putMatch(m);
  }, synthMatch);

  await page.goto(U + '#match/' + encodeURIComponent(synthMatch.id));
  await page.reload();
  await page.waitForSelector('.timeline-svg', { timeout: 8000 });

  const shotPath = path.join(SH, 'timeline_dedup.png');
  const card = await page.$('.timeline-card') || await page.$('.content');
  if (card) {
    await card.screenshot({ path: shotPath });
  } else {
    await page.screenshot({ path: shotPath });
  }
  check(fs.existsSync(shotPath), 'Screenshot saved: timeline_dedup.png', shotPath);

  // Check death marks on timeline
  const deathCount = await page.evaluate(() => {
    const marks = document.querySelectorAll('.ev-own_death, text.ev-death');
    return marks.length;
  });
  console.log(`Rendered timeline own_death markers count: ${deathCount}`);

} catch (err) {
  console.error('Playwright execution error:', err);
  fails++;
} finally {
  if (browser) await browser.close();
  srv.kill();
}

console.log(`\nFinal result: ${fails === 0 ? 'ALL PASS' : fails + ' FAILS'}`);
process.exit(fails > 0 ? 1 : 0);
