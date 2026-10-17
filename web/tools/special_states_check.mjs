// Special states check (D33): special intervals vs activation, stats, timeline rendering, trend cards.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(WEB_DIR, '..');
const SH = path.join(ROOT, 'docs/screenshots/special-states');
fs.mkdirSync(SH, { recursive: true });

let fails = 0;
const results = [];
const check = (ok, name, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
  if (!ok) fails++;
};

const PORT = 4197;
const U = `http://127.0.0.1:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
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
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.AN);

  // Synthetic match for test
  const synthMatch = {
    id: 'test-synth-match',
    session: 'synth-session',
    match: 99,
    battle: [0, 300],
    squid_down: { L0: [{ start: 130, end: 135, src: 'signal' }] },
    own_deaths: [{ start: 130, end: 135, src: 'signal' }],
    own_kills: [{ start: 50, end: 50 }],
    special: [
      { ready: 10, end: 40, outcome: 'activated', activated_at: 40 },
      { ready: 100, end: 130, outcome: 'lost_on_death', activated_at: null },
      { ready: 200, end: 300, outcome: 'unused_at_end', activated_at: null }
    ],
    tower_series: [
      { t: 0, own: 100, enemy: 100, owner: 'neutral' },
      { t: 150, own: 70, enemy: 100, owner: 'own' },
      { t: 300, own: 50, enemy: 80, owner: 'own' }
    ],
    result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: '海女美術大学', own: { ka: '1/1', deaths: 1, specials: 1 } },
    review: { marks: {}, added: [], fix: {} }
  };

  // (a) Unit check via window.inkgraph.AN.specialStats
  const synthStats = await page.evaluate(m => {
    return window.inkgraph.AN.specialStats(m);
  }, synthMatch);

  check(synthStats.activated === 1, '(a) specialStats: activated == 1', `activated=${synthStats.activated}`);
  check(synthStats.readyCount === 3, '(a) specialStats: readyCount == 3', `readyCount=${synthStats.readyCount}`);
  check(synthStats.readySeconds === 160, '(a) specialStats: readySeconds == 160', `readySeconds=${synthStats.readySeconds}`);
  check(synthStats.lost === 1, '(a) specialStats: lost == 1', `lost=${synthStats.lost}`);
  check(synthStats.unusedEnd === 1, '(a) specialStats: unusedEnd == 1', `unusedEnd=${synthStats.unusedEnd}`);
  check(Math.abs(synthStats.wastedRate - 1 / 3) < 0.001, '(a) specialStats: wastedRate == 1/3', `wastedRate=${synthStats.wastedRate}`);

  // Insert synthetic match and navigate to match page
  await page.evaluate(async m => {
    await window.inkgraph.db.putMatch(m);
  }, synthMatch);

  await page.goto(U + '#match/' + encodeURIComponent(synthMatch.id));
  await page.reload();
  await page.waitForSelector('.timeline-svg', { timeout: 8000 });

  // (b) Timeline DOM inspection
  const bands = page.locator('.sp-band');
  const bandCount = await bands.count();
  check(bandCount === 3, '(b) timeline: .sp-band 3 elements', `count=${bandCount}`);

  const activated = page.locator('.sp-activated');
  const actCount = await activated.count();
  check(actCount === 1, '(b) timeline: .sp-activated 1 element', `count=${actCount}`);
  if (actCount === 1) {
    const actVal = await activated.getAttribute('data-activated');
    check(actVal === '40', '(b) timeline: .sp-activated data-activated == 40', `actVal=${actVal}`);
  }

  const wastedTri = page.locator('.sp-wasted-tri');
  const wastedCount = await wastedTri.count();
  check(wastedCount === 1, '(b) timeline: .sp-wasted-tri 1 element', `count=${wastedCount}`);

  const unusedEnd = page.locator('.sp-unused-end');
  const unusedEndCount = await unusedEnd.count();
  check(unusedEndCount === 1, '(b) timeline: .sp-unused-end 1 element', `count=${unusedEndCount}`);

  // Check band widths
  const bandWidthsOk = await page.evaluate(() => {
    const b1 = document.querySelector('.sp-band[data-ready="10"] rect');
    const b3 = document.querySelector('.sp-band[data-ready="200"] rect');
    if (!b1 || !b3) return false;
    const w1 = parseFloat(b1.getAttribute('width'));
    const w3 = parseFloat(b3.getAttribute('width'));
    // w1: 30s in 300s -> 10% of 950 = 95px
    // w3: 100s in 300s -> 33.3% of 950 = 316.7px
    return Math.abs(w1 - 95) < 2 && Math.abs(w3 - 316.7) < 2;
  });
  check(bandWidthsOk, '(b) timeline: band widths match duration', `bandWidthsOk=${bandWidthsOk}`);

  // Screenshot 01: timeline
  await page.screenshot({ path: path.join(SH, '01_timeline.png') });

  // (c) Detail etab inspection
  const spRows = await page.$$eval('#etab tbody tr', trs => trs.filter(tr => tr.textContent.includes('スペシャル発動')).length);
  check(spRows === 1, '(c) etab: スペシャル発動 row count == 1', `spRows=${spRows}`);

  const wastedBadge = await page.locator('#etab .sp-wasted-badge').count();
  check(wastedBadge === 1, '(c) etab: .sp-wasted-badge count == 1', `count=${wastedBadge}`);

  const unusedRow = page.locator('#etab tr.sp-unused-end-row');
  const unusedRowCount = await unusedRow.count();
  check(unusedRowCount === 1, '(c) etab: .sp-unused-end-row count == 1', `count=${unusedRowCount}`);
  if (unusedRowCount === 1) {
    const winrateText = await unusedRow.locator('td').nth(4).textContent();
    check(winrateText.trim() === '—', '(c) etab: unused row winrate delta is —', `text=${winrateText}`);
    const reviewCell = await unusedRow.locator('td').nth(5).textContent();
    check(reviewCell.trim() === '', '(c) etab: unused row review cell is empty', `text=${reviewCell}`);
  }

  // (d) LEGEND order check
  const legendText = await page.locator('.tl-legend').textContent();
  const i1 = legendText.indexOf('帯：スペシャル使用可能');
  const i2 = legendText.indexOf('◆ スペシャル発動');
  const i3 = legendText.indexOf('×＋▼ 未使用のままデス');
  const i4 = legendText.indexOf('▯ 未使用のまま終了');
  check(i1 !== -1 && i2 !== -1 && i3 !== -1 && i4 !== -1 && i1 < i2 && i2 < i3 && i3 < i4,
    '(d) LEGEND: 4 special items exist in exact order',
    `i1=${i1}, i2=${i2}, i3=${i3}, i4=${i4}`);

  const legendPositionOk = await page.evaluate(() => {
    const wrap = document.querySelector('.timeline-wrap');
    if (!wrap) return false;
    const svg = wrap.querySelector('.timeline-svg');
    const legend = wrap.querySelector('.tl-legend');
    const collapse = wrap.querySelector('.tl-collapse');
    if (!svg || !legend || !collapse) return false;
    const children = Array.from(wrap.children);
    const iSvg = children.indexOf(svg);
    const iLegend = children.indexOf(legend);
    const iCollapse = children.indexOf(collapse);
    return iSvg !== -1 && iLegend !== -1 && iCollapse !== -1 && iSvg < iLegend && iLegend < iCollapse;
  });
  check(legendPositionOk, '(d) LEGEND: placed directly below timeline and before tl-collapse');

  // (e) Trends page inspection
  await page.goto(U + '#trend');
  await page.reload();
  await page.waitForSelector('.trends-stat-band', { timeout: 8000 });

  const trendLabels = await page.$$eval('.trends-stat-band .stat .stat-label', els => els.map(e => e.textContent.trim()));
  const requiredLabels = [
    'スペシャル発動の回数',
    '使用可能だった時間（秒／試合）',
    '未使用のままデスの回数',
    '未使用のまま終了した試合',
    'ためたままデスした割合'
  ];
  for (const lab of requiredLabels) {
    check(trendLabels.includes(lab), `(e) trends: label exists "${lab}"`);
  }

  const avgReadyText = await page.evaluate(() => {
    const stats = Array.from(document.querySelectorAll('.trends-stat-band .stat'));
    const target = stats.find(s => s.querySelector('.stat-label')?.textContent.trim() === '使用可能だった時間（秒／試合）');
    return target?.querySelector('.stat-value')?.textContent.trim() ?? '';
  });
  check(avgReadyText !== '' && !avgReadyText.includes('.'),
    '(e) trends: avgReadySec displayed as integer without decimal',
    `value="${avgReadyText}"`);

  // Screenshot 02: trends
  await page.screenshot({ path: path.join(SH, '02_trends.png') });

  // (f) Real data web_matches check
  const matchesPath = path.join(WEB_DIR, 'test-results/web_matches.json');
  if (fs.existsSync(matchesPath)) {
    const realMatches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
    let totalActivated = 0;
    let totalIntervals = 0;
    let killsUnchanged = true;
    let deathsUnchanged = true;

    for (const rm of realMatches) {
      const st = await page.evaluate(m => window.inkgraph.AN.specialStats(m), rm);
      totalActivated += st.activated;
      totalIntervals += st.readyCount;
      const eff = await page.evaluate(m => window.inkgraph.AN.effective(m), rm);
      const kCount = eff.filter(e => e.kind === 'kill').length;
      const dCount = eff.filter(e => e.kind === 'death').length;
      if (kCount !== (rm.own_kills || []).length) killsUnchanged = false;
      if (dCount !== (rm.own_deaths || []).length) deathsUnchanged = false;
    }

    check(totalActivated < totalIntervals, '(f) real matches: total activated < total intervals', `act=${totalActivated}, int=${totalIntervals}`);
    check(killsUnchanged, '(f) real matches: own_kills counts unchanged');
    check(deathsUnchanged, '(f) real matches: own_deaths counts unchanged');
  }

  // (g) No page error
  check(errors.length === 0, '(g) no page errors', errors.join('; '));

} catch (e) {
  console.error('FAIL exception:', e.message);
  fails++;
} finally {
  if (browser) await browser.close();
  srv.kill();
}

console.log(fails ? `${fails} check(s) FAILED` : `ALL ${results.length} PASS`);
process.exit(fails ? 1 : 0);
