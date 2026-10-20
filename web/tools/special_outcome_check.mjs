// special_outcome_check.mjs: Node-only check for specialOutcome (D44 mid-death handling).
import { specialOutcome } from '../src/core/analyzer.js';

let fails = 0;
const check = (ok, name, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) fails++;
};

function makeTimeline(b, drainVal = 0.0) {
  const t = [];
  const go = [];
  for (let x = 0; x <= 35.0; x += 0.2) {
    const ti = +x.toFixed(1);
    t.push(ti);
    go.push(ti > b && ti <= b + 1.5 ? drainVal : 0.0);
  }
  return { t, go };
}

console.log('--- specialOutcome Unit Checks (D44) ---');

// (1) 途中デス＋直後に橙0.28 → activated, mid_death True, drain 0.28
{
  const a = 10.0, b = 20.0;
  const deathStarts = [15.0];
  const { t, go } = makeTimeline(b, 0.28);
  const res = specialOutcome(a, b, deathStarts, t, go, 30.0);
  check(
    res.outcome === 'activated' && res.mid_death === true && Math.abs(res.drain - 0.28) < 1e-4,
    '(1) mid-death with drain 0.28 -> activated, mid_death true, drain 0.28',
    JSON.stringify(res)
  );
}

// (2) 途中デス＋直後の橙0.02 → lost_on_death, mid_death True
{
  const a = 10.0, b = 20.0;
  const deathStarts = [15.0];
  const { t, go } = makeTimeline(b, 0.02);
  const res = specialOutcome(a, b, deathStarts, t, go, 30.0);
  check(
    res.outcome === 'lost_on_death' && res.mid_death === true && Math.abs(res.drain - 0.02) < 1e-4,
    '(2) mid-death with drain 0.02 -> lost_on_death, mid_death true, drain 0.02',
    JSON.stringify(res)
  );
}

// (3) 終端直後デス（b+0.2）→ lost_on_death（橙があっても）
{
  const a = 10.0, b = 20.0;
  const deathStarts = [20.2];
  const { t, go } = makeTimeline(b, 0.28);
  const res = specialOutcome(a, b, deathStarts, t, go, 30.0);
  check(
    res.outcome === 'lost_on_death' && res.mid_death === false && res.drain === null,
    '(3) end death (b+0.2) -> lost_on_death, mid_death false, drain null',
    JSON.stringify(res)
  );
}

// (4) デスなし・途中 → activated、終端（b>=last_ok-1）→ unused_at_end
{
  const a = 10.0, b = 20.0;
  const deathStarts = [];
  const { t, go } = makeTimeline(b, 0.0);

  const resMid = specialOutcome(a, b, deathStarts, t, go, 30.0);
  const okMid = resMid.outcome === 'activated' && resMid.mid_death === false && resMid.drain === null;

  const resEnd = specialOutcome(a, b, deathStarts, t, go, 20.5);
  const okEnd = resEnd.outcome === 'unused_at_end' && resEnd.mid_death === false && resEnd.drain === null;

  check(
    okMid && okEnd,
    '(4) no death: middle -> activated, end (b>=last_ok-1) -> unused_at_end',
    `mid=${JSON.stringify(resMid)}, end=${JSON.stringify(resEnd)}`
  );
}

// (5) デスが a より前・b+1.0 より後 → 影響なし
{
  const a = 10.0, b = 20.0;
  const deathStarts = [8.0, 21.5];
  const { t, go } = makeTimeline(b, 0.0);
  const res = specialOutcome(a, b, deathStarts, t, go, 30.0);
  check(
    res.outcome === 'activated' && res.mid_death === false && res.drain === null,
    '(5) death outside window (before a / after b+1.0) -> no effect',
    JSON.stringify(res)
  );
}

// (6) 境界: s=b-0.5 は end_death、s=b-0.6 は mid_death
{
  const a = 10.0, b = 20.0;
  const { t, go } = makeTimeline(b, 0.28);

  const resEnd = specialOutcome(a, b, [19.5], t, go, 30.0);
  const okEnd = resEnd.outcome === 'lost_on_death' && resEnd.mid_death === false && resEnd.drain === null;

  const resMid = specialOutcome(a, b, [19.4], t, go, 30.0);
  const okMid = resMid.outcome === 'activated' && resMid.mid_death === true && Math.abs(resMid.drain - 0.28) < 1e-4;

  check(
    okEnd && okMid,
    '(6) boundary: s=b-0.5 is end_death, s=b-0.6 is mid_death',
    `s=19.5:${JSON.stringify(resEnd)}, s=19.4:${JSON.stringify(resMid)}`
  );
}

if (fails > 0) {
  console.error(`\n${fails} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll checks PASSED.');
}
