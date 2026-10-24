// clip_check.mjs: Browser verification of scene clips on video file.
// Usage: node tools/clip_check.mjs <video.mp4>
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const videoArg = process.argv[2];
if (!videoArg) {
  console.error('Usage: node web/tools/clip_check.mjs <video.mp4>');
  process.exit(1);
}
const videoPath = path.resolve(process.cwd(), videoArg);
if (!fs.existsSync(videoPath)) {
  console.error(`File not found: ${videoPath}`);
  process.exit(1);
}

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

const PORT = 4232;
const U = `http://127.0.0.1:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: WEB_DIR,
  stdio: 'ignore'
});

await new Promise(r => setTimeout(r, 2500));

let browser = null;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP'
  });
  const page = await ctx.newPage();
  await page.route('https://fonts.**/**', r => r.abort());

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  console.log(`Analyzing file: ${path.basename(videoPath)}`);
  await page.goto(U + '#live');
  await page.waitForSelector('#start', { timeout: 15000 });

  await page.locator('input[name=src][value=file]').check({ force: true });
  await page.setInputFiles('#file', videoPath);
  await page.$eval('#fast', el => {
    if (!el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    }
  });

  await page.click('#start');

  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(1000);
    const st = (await page.textContent('#state').catch(() => '')) || '';
    if (st.includes('停止しました') || st.includes('保存しました')) break;
    if (Date.now() - t0 > 1800e3) {
      throw new Error('Analysis timed out after 30 minutes');
    }
  }
  await page.waitForTimeout(2000);

  const data = await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const matches = await db.allMatches();
    const list = [];
    for (const m of matches) {
      const snaps = await db.snapsOf(m.id);
      const clips = await db.clipsOf(m.id);
      const snapList = [];
      for (const s of snaps) {
        let bmpH = 0;
        let bmpW = 0;
        if (s.kind === 'clip' && s.blob) {
          try {
            const bmp = await createImageBitmap(s.blob);
            bmpH = bmp.height;
            bmpW = bmp.width;
            bmp.close();
          } catch (e) {}
        }
        snapList.push({
          id: s.id,
          t: s.t,
          kind: s.kind,
          reason: s.reason,
          size: s.blob?.size || 0,
          type: s.blob?.type || '',
          bmpH,
          bmpW,
          clip: s.clip || null
        });
      }
      list.push({ match: m, snaps: snapList, clips });
    }
    return list;
  });

  check('At least one match saved', data.length > 0, `saved: ${data.length}`);

  for (const item of data) {
    const { match: rec, snaps, clips } = item;
    const totalSnapBytes = snaps.reduce((sum, s) => sum + s.size, 0);

    // Assertions
    check(`[${rec.id}] rec.clips exists`, !!rec.clips, JSON.stringify(rec.clips));
    check(`[${rec.id}] rec.clips.count <= 12`, rec.clips ? rec.clips.count <= 12 : false, `count=${rec.clips?.count}`);
    check(`[${rec.id}] rec.clips.bytes <= 3.5MiB`, rec.clips ? rec.clips.bytes <= 3.5 * 1024 * 1024 : false, `bytes=${rec.clips?.bytes}`);
    check(`[${rec.id}] rec.stills.bytes == sum of all snap blob sizes`, rec.stills?.bytes === totalSnapBytes, `stills.bytes=${rec.stills?.bytes}, sum=${totalSnapBytes}`);

    // Every clip frame is image/webp with height 720
    const clipSnaps = snaps.filter(s => s.kind === 'clip');
    let allWebpAnd720 = clipSnaps.length > 0;
    for (const cs of clipSnaps) {
      if (cs.type !== 'image/webp' || cs.bmpH !== 720) {
        allWebpAnd720 = false;
        break;
      }
    }
    check(`[${rec.id}] every clip frame is image/webp with height 720`, allWebpAnd720, `frames=${clipSnaps.length}`);

    // Frames within a clip are 0.5 s apart (±0.15)
    let timingOk = true;
    for (const c of clips) {
      for (let i = 1; i < c.frames.length; i++) {
        const dt = c.frames[i].t - c.frames[i - 1].t;
        if (Math.abs(dt - 0.5) > 0.15) {
          timingOk = false;
          break;
        }
      }
    }
    check(`[${rec.id}] frames within a clip are 0.5 s apart (±0.15)`, timingOk);

    // Each clip has <= 9 frames unless merged
    let lengthOk = true;
    for (const c of clips) {
      if (c.events.length <= 1 && c.frames.length > 9) {
        lengthOk = false;
        break;
      }
    }
    check(`[${rec.id}] each clip has <= 9 frames unless merged`, lengthOk);

    // Death clips present for min(deaths, 12) deaths when bytes allow (print counts instead of failing if not)
    const deathCount = rec.own_deaths?.length || 0;
    const deathClips = clips.filter(c => c.kind === 'death').length;
    const expectedDeaths = Math.min(deathCount, 12);
    if (deathClips === expectedDeaths) {
      check(`[${rec.id}] death clips count matches min(deaths, 12)`, true, `${deathClips}/${expectedDeaths}`);
    } else {
      console.log(`INFO [${rec.id}] death clips: ${deathClips}, expected min(deaths, 12): ${expectedDeaths} (byte cap may have limited)`);
    }

    // Special clips only near rec.special activated_at
    let specialOk = true;
    for (const c of clips) {
      for (const ev of c.events) {
        if (ev.kind === 'special') {
          const matchSp = rec.special?.some(
            sp => sp.outcome === 'activated' && typeof sp.activated_at === 'number' && Math.abs(sp.activated_at - ev.t) <= 1.0
          );
          if (!matchSp) {
            specialOk = false;
            break;
          }
        }
      }
    }
    check(`[${rec.id}] special clips only near rec.special activated_at`, specialOk);

    // Print per-match summary JSON
    const summary = {
      id: rec.id,
      scenes_by_kind: rec.clips?.kinds || {},
      frames: rec.clips?.frames || 0,
      bytes: rec.clips?.bytes || 0,
      avg_frame_bytes: rec.clips?.frames ? Math.round(rec.clips.bytes / rec.clips.frames) : 0
    };
    console.log(`MATCH SUMMARY [${rec.id}]:`, JSON.stringify(summary, null, 2));
  }

  // Open match with most clips
  if (data.length > 0) {
    const sortedByClips = [...data].sort((a, b) => (b.clips?.length || 0) - (a.clips?.length || 0));
    const target = sortedByClips[0];
    console.log(`Opening match ${target.match.id} (clips: ${target.clips?.length})`);

    await page.goto(U + '#match/' + encodeURIComponent(target.match.id));
    await page.waitForTimeout(800);

    const tg = page.locator('#review-toggle');
    if (!(await tg.isChecked())) await tg.check();
    await page.waitForTimeout(400);

    // Click the first death chip (or first chip)
    const deathChip = page.locator('.clip-chip:has-text("デス")').first();
    if (await deathChip.count()) {
      await deathChip.click();
    } else {
      const anyChip = page.locator('.clip-chip').first();
      if (await anyChip.count()) await anyChip.click();
    }

    const src1 = await page.locator('#still-img').getAttribute('src');
    await page.waitForTimeout(1200);
    const src2 = await page.locator('#still-img').getAttribute('src');
    check('still-img src changes between frames while playing', !!src1 && !!src2 && src1 !== src2, `${src1} -> ${src2}`);

    const shDir = path.resolve(WEB_DIR, '../docs/screenshots/review-clips');
    fs.mkdirSync(shDir, { recursive: true });
    const shPath = path.join(shDir, '01_review_clip.png');
    await page.screenshot({ path: shPath });
    console.log(`Screenshot saved to: ${shPath}`);
  }
} finally {
  if (browser) await browser.close();
  srv.kill('SIGTERM');
}

const failed = results.filter(r => !r).length;
console.log(`\nRESULTS: ${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
