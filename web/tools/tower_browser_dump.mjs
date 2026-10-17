// Dump browser-decoded (Chrome <video>+canvas) tower bands at the Python sample times -> /tmp/br/tw{n}_*.raw for tower_frames.mjs.
// usage: node tools/tower_browser_dump.mjs && python3 tools/tower_browser_dump.py && TW_DIR=/tmp/br node tools/tower_frames.mjs
import { chromium } from 'playwright-core'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'); fs.mkdirSync('/tmp/br', { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage();
for (const n of [1, 2, 3]) {
  const J = JSON.parse(fs.readFileSync(`/tmp/tw${n}.json`)); await p.goto('file://' + ROOT + '/raw/1080p/joined_match0' + n + '.mp4');
  const out = fs.openSync(`/tmp/br/tw${n}_full.raw`, 'w');
  for (const row of J.rows) {
    const arr = await p.evaluate(async t => { const v = document.querySelector('video'); v.pause(); await new Promise(r => { v.onseeked = r; v.currentTime = t + 1e-3; });
      const c = window._c || (window._c = new OffscreenCanvas(930, 168)); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 495, 117, 930, 168, 0, 0, 930, 168);
      return Array.from(x.getImageData(0, 0, 930, 168).data); }, row.t);
    fs.writeSync(out, Buffer.from(arr));
  }
  fs.closeSync(out); console.log('match', n, J.rows.length);
}
await b.close();
