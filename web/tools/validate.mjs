// Headless Chrome validation: feeds the recorded matches through the web app (file source, fast mode)
// and compares with the Python outputs. usage: node tools/validate.mjs [1 2 3]
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'); const OUT = path.join(ROOT, 'web/test-results'); fs.mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '2', '3'];
const srv = startPreview('4173', path.join(ROOT, 'web'));
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); }); page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:4173/#live');
for (const id of ids) {
  const f = path.join(ROOT, `raw/1080p/joined_match0${id}.mp4`); const t0 = Date.now();
  await page.goto('http://127.0.0.1:4173/#list'); await page.goto('http://127.0.0.1:4173/#live'); await page.waitForSelector('#start');
  await page.locator('input[name=src][value=file]').check({ force: true }); await page.setInputFiles('#file', f); await page.click('#start');
  let last = ''; for (;;) { await page.waitForTimeout(5000); const st = await page.textContent('#state'); if (st !== last) { console.log(`match${id}`, st); last = st; } if (st.includes('停止しました') || st.includes('保存しました')) break; } // joined file = 1 match, save implies file analysis finished
  console.log(`match${id} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.waitForTimeout(1500);
}
const ms = await page.evaluate(async () => (await window.inkgraph.db.allMatches()).map(m => m));
fs.writeFileSync(path.join(OUT, 'web_matches.json'), JSON.stringify(ms, null, 1));
await browser.close(); srv.kill(); console.log('wrote', path.join(OUT, 'web_matches.json'), ms.length, 'matches');
