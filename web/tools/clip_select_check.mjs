// clip_select_check.mjs: Node-only check for selectClips and clip selection rules
import { CLIP, PRIORITY, CLIP_KIND_JA, clipBytes, selectClips, clipAt } from '../src/clips.js';

let fails = 0;
const check = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) fails++;
};

console.log('--- clip_select_check ---');

// Helper to make fake frames
const makeFrames = (t, count = 5, size = 1000) => {
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push({ t: t - 2 + i * 0.5, size });
  }
  return frames;
};

// 1. Priority death > special > kill when over 12 scenes
{
  const rec = {
    special: [
      { outcome: 'activated', activated_at: 100 },
      { outcome: 'activated', activated_at: 110 },
      { outcome: 'activated', activated_at: 120 },
      { outcome: 'activated', activated_at: 130 },
      { outcome: 'activated', activated_at: 140 },
      { outcome: 'activated', activated_at: 150 },
      { outcome: 'activated', activated_at: 160 },
      { outcome: 'activated', activated_at: 170 },
    ]
  };

  const clips = [];
  // 8 kills (pri 2)
  for (let i = 0; i < 8; i++) {
    clips.push({ t: 10 + i * 5, from: 8 + i * 5, to: 12 + i * 5, events: [{ kind: 'kill', t: 10 + i * 5 }], frames: makeFrames(10 + i * 5, 5, 100) });
  }
  // 8 specials (pri 1)
  for (let i = 0; i < 8; i++) {
    clips.push({ t: 100 + i * 10, from: 98 + i * 10, to: 101 + i * 10, events: [{ kind: 'special', t: 100 + i * 10 }], frames: makeFrames(100 + i * 10, 5, 100) });
  }
  // 8 deaths (pri 0)
  for (let i = 0; i < 8; i++) {
    clips.push({ t: 200 + i * 5, from: 198 + i * 5, to: 202 + i * 5, events: [{ kind: 'death', t: 200 + i * 5 }], frames: makeFrames(200 + i * 5, 5, 100) });
  }

  const sel = selectClips(clips, rec, { maxScenes: 12, maxBytes: 1000000 });
  const deathCount = sel.filter(c => c.kind === 'death').length;
  const spCount = sel.filter(c => c.kind === 'special').length;
  const killCount = sel.filter(c => c.kind === 'kill').length;

  check(
    sel.length === 12 && deathCount === 8 && spCount === 4 && killCount === 0,
    'priority death > special > kill when over 12 scenes',
    `total=${sel.length}, deaths=${deathCount}, specials=${spCount}, kills=${killCount}`
  );
}

// 2. 12-scene cap
{
  const clips = [];
  for (let i = 0; i < 20; i++) {
    clips.push({ t: 10 + i, from: 8 + i, to: 12 + i, events: [{ kind: 'death', t: 10 + i }], frames: makeFrames(10 + i, 5, 100) });
  }
  const sel = selectClips(clips, null, { maxScenes: 12, maxBytes: 1000000 });
  check(sel.length === 12, '12-scene cap strictly respected', `got ${sel.length}`);
}

// 3. Byte cap respected with skip-and-continue
{
  const clips = [
    { t: 10, from: 8, to: 12, events: [{ kind: 'death', t: 10 }], frames: [{ t: 10, size: 300 }] },
    { t: 20, from: 18, to: 22, events: [{ kind: 'death', t: 20 }], frames: [{ t: 20, size: 800 }] },
    { t: 30, from: 28, to: 32, events: [{ kind: 'death', t: 30 }], frames: [{ t: 30, size: 400 }] },
  ];
  // maxBytes = 1000. Clip 1 (300) fits. Clip 2 (800) does not fit (300+800=1100 > 1000). Clip 3 (400) fits (300+400=700 <= 1000).
  const sel = selectClips(clips, null, { maxScenes: 12, maxBytes: 1000 });
  const ok = sel.length === 2 && sel[0].t === 10 && sel[1].t === 30 && sel[0].bytes === 300 && sel[1].bytes === 400;
  check(ok, 'byte cap respected with skip-and-continue', `selected ts: ${sel.map(c => c.t).join(', ')}`);
}

// 4. Special kept only near an activated activated_at (lost_on_death dropped, merged kept as death)
{
  const rec = {
    special: [
      { outcome: 'lost_on_death', activated_at: null },
      { outcome: 'activated', activated_at: 50.0 },
    ]
  };

  const clipLostOnly = {
    t: 20, from: 18, to: 21,
    events: [{ kind: 'special', t: 20 }],
    frames: makeFrames(20, 5, 100)
  };

  const clipFarActivated = {
    t: 40, from: 38, to: 41,
    events: [{ kind: 'special', t: 40 }], // |50.0 - 40| = 10 > 1.0
    frames: makeFrames(40, 5, 100)
  };

  const clipNearActivated = {
    t: 50.5, from: 48.5, to: 51.5,
    events: [{ kind: 'special', t: 50.5 }], // |50.0 - 50.5| = 0.5 <= 1.0
    frames: makeFrames(50.5, 5, 100)
  };

  const clipMerged = {
    t: 60, from: 58, to: 62,
    events: [{ kind: 'death', t: 60 }, { kind: 'special', t: 59.5 }], // special is lost_on_death, not near activated
    frames: makeFrames(60, 5, 100)
  };

  const clips = [clipLostOnly, clipFarActivated, clipNearActivated, clipMerged];
  const sel = selectClips(clips, rec, { maxScenes: 12, maxBytes: 1000000 });

  const keptLost = sel.some(c => c.t === 20);
  const keptFar = sel.some(c => c.t === 40);
  const keptNear = sel.some(c => c.t === 50.5);
  const mergedRes = sel.find(c => c.t === 60);
  const mergedOk = mergedRes && mergedRes.kind === 'death' && mergedRes.events.length === 1 && mergedRes.events[0].kind === 'death';

  check(
    !keptLost && !keptFar && keptNear && mergedOk,
    'special kept only near activated activated_at (lost_on_death dropped, merged kept as death)',
    `keptLost=${keptLost}, keptFar=${keptFar}, keptNear=${keptNear}, mergedKind=${mergedRes?.kind}`
  );
}

// 5. Output sorted by time
{
  const rec = {
    special: [{ outcome: 'activated', activated_at: 10 }]
  };
  const clips = [
    { t: 50, from: 48, to: 52, events: [{ kind: 'kill', t: 50 }], frames: makeFrames(50, 5, 100) },
    { t: 30, from: 28, to: 32, events: [{ kind: 'death', t: 30 }], frames: makeFrames(30, 5, 100) },
    { t: 10, from: 8, to: 11, events: [{ kind: 'special', t: 10 }], frames: makeFrames(10, 5, 100) },
  ];
  const sel = selectClips(clips, rec);
  const ts = sel.map(c => c.t);
  check(
    ts.length === 3 && ts[0] === 10 && ts[1] === 30 && ts[2] === 50,
    'output sorted by time (t asc)',
    `ts=${ts.join(', ')}`
  );
}

// 6. clipAt helper check
{
  const clips = [
    { t: 10, from: 8, to: 12 },
    { t: 20, from: 18, to: 25 },
    { t: 23, from: 21, to: 27 },
  ];
  const c1 = clipAt(clips, 9);
  const c2 = clipAt(clips, 22);
  const c3 = clipAt(clips, 15);

  check(
    c1?.t === 10 && c2?.t === 20 && c3 === null,
    'clipAt returns containing clip with nearest center, or null',
    `c1=${c1?.t}, c2=${c2?.t}, c3=${c3}`
  );
}

console.log(`\nRESULTS: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`);
if (fails > 0) process.exit(1);
