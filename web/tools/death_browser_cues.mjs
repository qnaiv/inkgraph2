// デス抜け調査用（D52）: Chrome の <video> をアプリの高速モードと同じように currentTime=t でシークし、canvas に描いたフレームの
// timerPresent / mapOpen / ownDeadSignal を 0.2 秒ごとに出す。使い方: node tools/death_browser_cues.mjs <video> <from> <to> [pngの保存先]
import { chromium } from 'playwright-core'; import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { prepAssets } from '../src/core/assets.js'; import * as C from '../src/core/cues.js';
const A = prepAssets(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/assets/inkgraph_assets.json'), 'utf8')));
const [video, from, to, dir] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5] || '/workspace/dm/br']; fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); await p.goto('file://' + video); await p.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
const line = [];
for (let t = from; t <= to + 1e-6; t = Math.round((t + 0.2) * 1000) / 1000) {
  const url = await p.evaluate(async t => { const v = document.querySelector('video'); v.pause(); await new Promise(r => { v.onseeked = r; v.currentTime = t; });
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, c.width, c.height); return c.toDataURL('image/png'); }, t);
  const f = path.join(dir, `f${t.toFixed(1)}.png`); fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e9 });
  const fr = { w: 1920, h: 1080, data: new Uint8ClampedArray(r.stdout) };
  line.push(`${t.toFixed(1)}:${+C.timerPresent(A, fr)}${+C.mapOpen(A, fr)}${+C.ownDeadSignal(A, fr).dead}`);
}
console.log(line.join('  ')); await b.close();
