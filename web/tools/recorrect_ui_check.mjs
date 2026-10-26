// recorrect_ui_check.mjs: D57 確認画面で K+A・デス・スペシャルを手入力すると、検出が直る（実ブラウザ）。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import { buildMatch } from '../src/core/analyzer.js';
import { packCues } from '../src/core/cues_pack.js';
import path from 'node:path'; import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'), SH = path.resolve(WEB, '../docs/screenshots/recorrect'); fs.mkdirSync(SH, { recursive: true });
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const on = (t, a, b) => t >= a && t < b; const F = [];
for (let t = 0; t <= 140 + 1e-6; t = +(t + 0.2).toFixed(1)) { const strong = on(t, 10, 14) || on(t, 60, 64), weak = on(t, 100, 104), ks = on(t, 30, 32) || on(t, 90, 92) || on(t, 120, 122) ? 0.85 : 0;
  F.push({ t, ok: true, map: false, sig: false, sy: strong ? 0.8 : weak ? 0.42 : 0, ks, ksc: [ks, 0, 0, 0, 0, 0], kill: false, killSlots: [false], gw: on(t, 20, 30) ? 0.9 : on(t, 80, 80.6) ? 0.16 : 0, go: 0, p: null, s: null, ally: null }); }
const rec = buildMatch({ a: 0, b: 140, F: JSON.parse(JSON.stringify(F)), th: [0, 0], kscan: [] }, 1, 1080, {});
const m = { ...rec, id: 'rc#1', match: 1, created: new Date(2026, 9, 20, 12, 0).toISOString(), source: { kind: 'file', name: 'x', height: 1080, owner: 'self' }, cues: packCues(F),
  result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { ka: 5, deaths: 2, specials: 1 } }, confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 },
  review: { marks: {}, added: [], fix: {}, rmarks: {} }, favorite: false, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' } };
const PORT = process.env.PORT || '4233', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { await window.inkgraph.db.putMatch(r); }, m);
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#match/${encodeURIComponent(m.id)}`); await page.waitForSelector('#hdr-d');
  check((await page.textContent('#hdr-d')).trim() === '2' && (await page.textContent('#hdr-sp')).trim() === '1', '(1) 直す前: デス 2・スペシャル 1');
  await page.check('#review-toggle', { force: true }).catch(() => {}); await page.waitForTimeout(300);
  check((await page.$$eval('#rtab tbody tr', rs => rs.map(r => r.cells[0].textContent))).includes('キル+アシスト'), '(2) 結果の確認表に「キル+アシスト」の行がある');
  for (const f of ['deaths', 'specials']) { await page.click(`#rtab .mk[data-f="${f}"][data-v="wrong"]`); await page.waitForTimeout(150); }
  await page.fill('#rtab input[data-fix="deaths"]', '3'); await page.dispatchEvent('#rtab input[data-fix="deaths"]', 'change'); await page.waitForTimeout(500);
  await page.fill('#rtab input[data-fix="specials"]', '2'); await page.dispatchEvent('#rtab input[data-fix="specials"]', 'change'); await page.waitForTimeout(500);
  check((await page.textContent('#hdr-d')).trim() === '3' && (await page.textContent('#hdr-sp')).trim() === '2', '(3) デス 3・スペシャル 2 を手入力すると、検出が直って見出しが 3・2 になる', `${(await page.textContent('#hdr-d')).trim()}/${(await page.textContent('#hdr-sp')).trim()}`);
  const note = await page.textContent('#recon-note'); check(/手入力の値に合わせて検出を直しました/.test(note) && /追加/.test(note), '(4) 何を直したかの説明が出る', note.trim().slice(0, 90));
  const saved = await page.evaluate(async () => { const x = await window.inkgraph.db.getMatch('rc#1'); return { d: x.own_deaths.length, sp: x.special.filter(s => s.outcome === 'activated').length, manual: x.recon && x.recon.manual, pre: !!x.pre_recorrect }; });
  check(saved.d === 3 && saved.sp === 2 && saved.manual && saved.pre, '(5) 直した検出が保存される（元の検出も取ってある）', JSON.stringify(saved));
  await page.screenshot({ path: path.join(SH, '01_recorrected.png') });
  await page.click('#recon-undo'); await page.waitForTimeout(400);
  check((await page.textContent('#hdr-d')).trim() === '2' && (await page.textContent('#hdr-sp')).trim() === '1', '(6) 「もとの検出に戻す」で 2・1 に戻る');
  check(errs.length === 0, '(7) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
