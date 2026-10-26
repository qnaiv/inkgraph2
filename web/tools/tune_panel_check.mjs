// tune_panel_check.mjs: ブラウザで「検出の自動調整」パネルを確かめる（D54）。合成の試合 10 件を IndexedDB に入れて、候補→適用→戻すを通す。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import { packCues } from '../src/core/cues_pack.js';
import path from 'node:path';
import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'), SH = path.resolve(WEB, '../docs/screenshots/auto-tune'); fs.mkdirSync(SH, { recursive: true });
const PORT = process.env.PORT || '4231'; let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mkF = seed => { const F = [], on = (t, a, b) => t >= a && t < b;
  for (let t = 0; t <= 120 + 1e-6; t = +(t + 0.2).toFixed(1)) { const d = on(t, 30 + seed, 34 + seed) || on(t, 70, 74), ks = on(t, 10, 12) || on(t, 90, 92) ? 0.85 : on(t, 50 + seed, 52 + seed) ? 0.65 : 0;
    F.push({ t, ok: true, map: false, sig: false, sy: d ? 0.42 : 0, ks, ksc: [ks, 0, 0, 0, 0, 0], kill: false, killSlots: [false], gw: on(t, 20, 25) ? 0.9 : on(t, 100, 103) ? 0.17 : 0, go: 0, p: null, s: null, ally: null }); }
  return F; };
const recs = [...Array(10)].map((_, i) => ({ id: `tune#${i}`, match: i + 1, created: new Date(2026, 9, 20, 12, i).toISOString(), battle: [0, 120], team_hue: [0, 0], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { ka: 2, deaths: 2, specials: 2 } }, own_deaths: [], special: [], own_kills: [], squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 120 },
  confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 }, review: { marks: {}, added: [], fix: {} }, favorite: false, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' }, cues: packCues(mkF(i % 5)) }));
const srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { for (const m of r) await window.inkgraph.db.putMatch(m); }, recs);
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForSelector('#tune-panel');
  check((await page.textContent('#tune-panel')).includes('対象: 10'), '(1) パネルに対象の試合数（10）が出る');
  await page.click('#tune-run'); await page.waitForSelector('#tune-apply', { timeout: 60000 });
  const t1 = await page.textContent('#tune-panel'); check(t1.includes('候補が見つかりました') && t1.includes('0.4') , '(2) 候補が見つかり、変更するしきい値が出る');
  await page.screenshot({ path: path.join(SH, '01_candidate.png'), fullPage: false });
  await page.click('#tune-apply'); await page.waitForTimeout(300);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('inkgraph.detectParams')));
  check(st && st.params && st.params.sig_th < 0.5, '(3) 適用すると localStorage に保存される', JSON.stringify(st && st.params));
  await page.screenshot({ path: path.join(SH, '02_applied.png') });
  await page.click('#tune-rollback'); await page.waitForTimeout(300);
  const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem('inkgraph.detectParams')));
  check(st2.params === null, '(4) ひとつ前に戻すと既定値に戻る');
  check(errs.length === 0, '(5) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
