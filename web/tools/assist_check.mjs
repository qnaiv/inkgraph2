// assist_check.mjs: D57 結果画面の K+A と検出キルから、アシストの推定を出す。純関数＋実ブラウザ（一覧・詳細）。
import { assistEstimate, assistText } from '../src/analysis.js';
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path';
const WEB = path.resolve(import.meta.dirname, '..'); let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
check(JSON.stringify(assistEstimate(7, 2)) === '{"ka":7,"kills":2,"assists":5,"over":0}' && assistText(assistEstimate(7, 2)) === 'K+A 7（アシスト推定 5）', '(1) K+A 7・検出キル 2 → アシスト推定 5');
check(assistEstimate(3, 3).assists === 0 && assistText(assistEstimate(3, 3)) === 'K+A 3（アシスト推定 0）', '(2) K+A と検出キルが同じ → アシスト 0');
check(assistEstimate(2, 4).over === 2 && /検出キルが 2 多い/.test(assistText(assistEstimate(2, 4))), '(3) 検出キルが K+A を超える → 誤検出の可能性');
check(assistEstimate(null, 3) === null && assistEstimate(undefined, 3) === null && assistText(null) === '', '(4) K+A が読めていなければ出さない');
const mk = (id, ka, i) => ({ id, match: i, created: new Date(2026, 9, 20, 12, i).toISOString(), battle: [0, 120], source: { kind: 'file', name: 'x', height: 1080, owner: 'self' },
  result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { ka, deaths: 3, specials: 1 } }, own_deaths: [], special: [],
  own_kills: [{ start: 10, end: 11.8 }, { start: 50, end: 51.8 }], squid_down: {}, hud_hidden: [], map_open: [], stats: { duration: 120 }, confidence: { celebration_frames: 5, personal_frames: 5, board_frames: 0 },
  review: { marks: {}, added: [], fix: {} }, favorite: false, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' } });
const PORT = process.env.PORT || '4232', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForTimeout(800);
  await page.evaluate(async r => { for (const m of r) await window.inkgraph.db.putMatch(m); }, [mk('as#1', 7, 1), mk('as#2', 1, 2), mk('as#3', null, 3)]);
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForSelector('.match-row');
  const rows = await page.$$eval('.match-row', els => els.map(e => ({ id: e.dataset.id, t: e.querySelector('.kda-metrics')?.textContent.replace(/\s+/g, '') })));
  const by = id => rows.find(r => r.id === id)?.t || '';
  check(JSON.stringify(rows.map(r => r.id)) === JSON.stringify(['as#3', 'as#2', 'as#1']), '(5a) 一覧は日時の降順（最新が一番上）', rows.map(r => r.id).join(','));
  check(/キル2\+A5/.test(by('as#1')), '(5) 一覧: K+A 7・検出 2 → 「+A5」', by('as#1'));
  check(/キル2⚠/.test(by('as#2')), '(6) 一覧: K+A 1・検出 2 → 警告「⚠」', by('as#2'));
  check(!/\+A|⚠/.test(by('as#3')), '(7) 一覧: K+A が読めていなければ何も出さない', by('as#3'));
  await page.goto(`http://127.0.0.1:${PORT}/#match/${encodeURIComponent('as#1')}`); await page.waitForSelector('#hdr-ka');
  check((await page.textContent('#hdr-ka')) === 'K+A 7（アシスト推定 5）', '(8) 詳細: 見出しにアシスト推定が出る', await page.textContent('#hdr-ka'));
  check(errs.length === 0, '(9) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
