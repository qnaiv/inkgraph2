// D47: アプリ本体（ファイル入力・高速モード）に動画を流し、やられた相手のブキ名を正解（labels/killer/killer_truth.json）と照合する
// 使い方: npm run build && node tools/killer_app_check.mjs --videos videos.json
//   videos.json: {"<labels の video 名>": "<動画ファイルのパス>"}（1 動画 = 1 試合）
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'); const OUT = path.join(ROOT, 'web/test-results'); fs.mkdirSync(OUT, { recursive: true });
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const videos = JSON.parse(fs.readFileSync(arg('--videos'), 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'labels', 'killer', 'killer_truth.json'), 'utf8'));
const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: path.join(ROOT, 'web'), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:4173/#live');
const got = {};
for (const [name, f] of Object.entries(videos)) {
  const before = await page.evaluate(async () => (await window.inkgraph.db.allMatches()).map(m => m.id));
  await page.goto('http://127.0.0.1:4173/#list'); await page.goto('http://127.0.0.1:4173/#live'); await page.waitForSelector('#start');
  await page.locator('input[name=src][value=file]').check({ force: true }); await page.setInputFiles('#file', f); await page.click('#start');
  const t0 = Date.now(); for (;;) { await page.waitForTimeout(5000); const st = await page.textContent('#state'); if (st.includes('停止しました') || st.includes('保存しました')) break; if (Date.now() - t0 > 30 * 60e3) break; }
  await page.waitForTimeout(1500);
  const ms = await page.evaluate(async b => (await window.inkgraph.db.allMatches()).filter(m => !b.includes(m.id)), before);
  got[name] = ms; console.log(name, `${((Date.now() - t0) / 1000).toFixed(0)}s`, ms.length, '試合', ms.map(m => (m.own_deaths || []).map(e => `${e.start}:${e.killed_by ? (e.killed_by.name ?? '未登録') : '-'}`).join(' ')).join(' | '));
}
fs.writeFileSync(path.join(OUT, 'killer_app_matches.json'), JSON.stringify(got));
await browser.close(); srv.kill();
// 照合：正解のデス開始秒 ±2.5 秒のアプリのデスを対応させる
let n = 0, ok = 0, wrong = 0, unread = 0, unk = 0, nodeath = 0; const bad = [];
for (const e of truth) { const ms = got[e.video] || []; n++;
  const d = ms.flatMap(m => m.own_deaths || []).find(x => Math.abs(x.start - e.death_start) <= 2.5);
  if (!d) { nodeath++; bad.push([e.video, e.death_start, e.killer, 'アプリでデス未検出']); continue; }
  const k = d.killed_by || null;
  if (!e.killer) { if (!k) ok++; else { wrong++; bad.push([e.video, e.death_start, '(吹き出し無し)', k.name]); } continue; }
  if (!k) { unread++; bad.push([e.video, e.death_start, e.killer, '読めず']); } else if (k.name === e.killer) ok++; else if (!k.name) { unk++; bad.push([e.video, e.death_start, e.killer, '未登録扱い']); } else { wrong++; bad.push([e.video, e.death_start, e.killer, '→', k.name]); }
}
console.log(`アプリ本体での照合: 正しい ${ok}/${n}（取り違え ${wrong}・未登録扱い ${unk}・読めず ${unread}・デス未検出 ${nodeath}）`); bad.forEach(b => console.log('  ', b.join(' ')));
