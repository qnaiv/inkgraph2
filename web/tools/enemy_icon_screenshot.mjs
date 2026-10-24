// D48: killer_app_check.mjs で得たアプリの試合データを入れて、傾向画面の「いた敵ブキ（結果画面のアイコン）」カードを撮る
// 使い方: npm run build && node tools/enemy_icon_screenshot.mjs [test-results/killer_app_matches.json]
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..');
const src = process.argv[2] || path.join(ROOT, 'web/test-results/killer_app_matches.json');
const ms = Object.values(JSON.parse(fs.readFileSync(src, 'utf8'))).flat();
const SH = path.join(ROOT, 'docs/screenshots/enemy-icon'); fs.mkdirSync(SH, { recursive: true });
const srv = startPreview(4174, path.join(ROOT, 'web'));
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:4174/#list'); await page.waitForFunction(() => window.inkgraph && window.inkgraph.db);
  await page.evaluate(async ms => { for (const m of await window.inkgraph.db.allMatches()) await window.inkgraph.db.delMatch(m.id); for (const m of ms) await window.inkgraph.db.putMatch(m); }, ms);
  await page.goto('http://127.0.0.1:4174/#trend'); await page.waitForSelector('.trend-presence-card');
  await page.waitForTimeout(800);
  const card = page.locator('.trend-presence-card');
  await card.screenshot({ path: path.join(SH, '01-trend-presence-card.png') });
  console.log('withIcons', ms.filter(m => m.enemy_icons && m.enemy_icons.length).length, 'rows', await page.locator('.trend-presence-card tbody tr').count(), 'saved', path.join(SH, '01-trend-presence-card.png'));
} finally { await browser.close(); srv.kill(); }
