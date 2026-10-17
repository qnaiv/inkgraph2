// Kill slot check (issue #140): killEventsFromSlots and live rising edge checks.
import { killEventsFromSlots } from '../src/core/analyzer.js';

let fails = 0;
const results = [];
const check = (ok, name, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) fails++;
};

console.log('--- Kill Slot Unit Checks (JS) ---');

// 1. single slot0 continuous 3s => 1 event, no false split.
{
  const t = Array.from({ length: 25 }, (_, i) => +(i * 0.2).toFixed(1));
  const slots = t.map(ti => [ti >= 1.0 && ti <= 4.0]);
  const ev = killEventsFromSlots(t, slots);
  check(
    ev.length === 1 && ev[0].start === 1.0 && ev[0].end === 4.0,
    'case 1: single slot0 continuous 3s => 1 event',
    `got=${JSON.stringify(ev)}`
  );
}

// 2. stacking 2: slot0 continuous from t=1 (kill1 then kill2 occupies bottom without gap), slot1 from t=2 => total 2 events.
{
  const t = Array.from({ length: 30 }, (_, i) => +(i * 0.2).toFixed(1));
  const slots = t.map(ti => [ti >= 1.0 && ti <= 5.0, ti >= 2.0 && ti <= 4.0]);
  const ev = killEventsFromSlots(t, slots);
  check(
    ev.length === 2 &&
      ev[0].start === 1.0 && ev[0].end === 5.0 &&
      ev[1].start === 2.0 && ev[1].end === 4.0,
    'case 2: stacking 2 => 2 events',
    `got=${JSON.stringify(ev)}`
  );
}

// 3. 4 simultaneous: slots0-3 all start same t => 4 events.
{
  const t = Array.from({ length: 25 }, (_, i) => +(i * 0.2).toFixed(1));
  const slots = t.map(ti => Array(4).fill(ti >= 1.0 && ti <= 3.0));
  const ev = killEventsFromSlots(t, slots);
  const ok = ev.length === 4 && ev.every(e => e.start === 1.0 && e.end === 3.0);
  check(ok, 'case 3: 4 simultaneous => 4 events', `got=${JSON.stringify(ev)}`);
}

// 4. 4 staggered stacking => 4 events.
{
  const t = Array.from({ length: 35 }, (_, i) => +(i * 0.2).toFixed(1));
  const slots = t.map(ti => [
    ti >= 1.0 && ti <= 4.0,
    ti >= 1.6 && ti <= 4.0,
    ti >= 2.2 && ti <= 4.0,
    ti >= 2.8 && ti <= 4.0,
  ]);
  const ev = killEventsFromSlots(t, slots);
  const starts = ev.map(e => e.start);
  const ok = ev.length === 4 && JSON.stringify(starts) === '[1,1.6,2.2,2.8]' && ev.every(e => e.end === 4.0);
  check(ok, 'case 4: 4 staggered stacking => 4 events', `starts=${JSON.stringify(starts)}`);
}

// 5. gap merging: slot flicker gap 0.4s within same slot => still 1 (runs gap1.0), and a slot signal shorter than 0.2 minlen dropped if applicable.
{
  const t = Array.from({ length: 30 }, (_, i) => +(i * 0.2).toFixed(1));
  const slots = t.map(ti => [
    (ti >= 1.0 && ti <= 2.0) || (ti >= 2.6 && ti <= 3.6),
    ti === 1.0,
  ]);
  const ev = killEventsFromSlots(t, slots);
  check(
    ev.length === 1 && ev[0].start === 1.0 && ev[0].end === 3.6,
    'case 5: gap merging (0.4s flicker) and minlen filter (<0.2s dropped)',
    `got=${JSON.stringify(ev)}`
  );
}

// 6. frames format with {killSlots: [...]} and varying lengths
{
  const t = [0.0, 0.2, 0.4, 0.6];
  const frames = [
    { killSlots: [true] },
    { killSlots: [true, true] },
    { killSlots: [true] },
    { killSlots: [] },
  ];
  const ev = killEventsFromSlots(t, frames);
  check(
    ev.length === 1 && ev[0].start === 0.0 && ev[0].end === 0.4,
    'case 6: frame objects with varying killSlots lengths',
    `got=${JSON.stringify(ev)}`
  );
}

console.log('--- Live Event Rising Edge Checks ---');
{
  const emitted = [];
  const onEvent = e => emitted.push(e);
  let prevSlots = [];
  const feed = (t, killSlots) => {
    for (let i = 0; i < killSlots.length; i++) {
      const prev = i < prevSlots.length ? !!prevSlots[i] : false;
      if (killSlots[i] && !prev) onEvent({ type: 'own_kill', t, slot: i });
    }
    prevSlots = killSlots;
  };

  feed(1.0, [true, false, false, false]); // slot0 rises -> 1 event
  feed(1.2, [true, false, false, false]); // no change -> 0 events
  feed(1.4, [true, true, false, false]);  // slot1 rises -> 1 event
  feed(2.0, [false, false, false, false]); // all clear
  feed(3.0, [true, true, true, true]);    // 4 simultaneous rise -> 4 events

  check(emitted.length === 6, 'Live events: 1 + 1 + 4 = 6 events emitted', `emittedCount=${emitted.length}`);
  check(emitted.filter(e => e.t === 3.0).length === 4, 'Live events: 4 simultaneous events at t=3.0');
}

if (fails > 0) {
  console.error(`\nFAILED: ${fails} check(s) failed`);
  process.exit(1);
} else {
  console.log(`\nALL PASSED: ${results.length} checks passed`);
  process.exit(0);
}
