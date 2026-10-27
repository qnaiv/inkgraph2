// verify_rec_check.mjs: D67 検証録画（直近1試合の全コマ）と検証zipの書き出し。実ブラウザ。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path'; import { unzipSync } from 'fflate';
const WEB = path.resolve(import.meta.dirname, '..');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const PORT = process.env.PORT || '4236', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForFunction(() => window.inkgraph && window.inkgraph.db);
  await page.evaluate(async () => {
    const db = window.inkgraph.db; localStorage.removeItem('inkgraph.verifyRec');
    const blob = () => new Promise(res => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.toBlob(res, 'image/webp'); });
    for (const [i, id] of ['v#1', 'v#2'].entries()) await db.putMatch({ id, match: i + 1, created: new Date(2026, 9, 20, 12, i).toISOString(), battle: [0, 100], squid_down: {}, own_deaths: [{ start: 10, end: 12 }], own_kills: [], special: [], result_screen: { result: 'WIN', mode: 'area', stage: 'テスト', own: { ka: 1, deaths: 1, specials: 0 } }, review: { marks: {}, added: [], fix: {} }, stills: { count: 0, bytes: 0 }, stillsState: 'none', video: { kind: 'none' } });
    await db.putVerify('v#1', [{ t: 1, blob: await blob() }, { t: 1.4, blob: await blob() }]);
    await db.putVerify('v#2', [{ t: 2, blob: await blob() }, { t: 2.4, blob: await blob() }, { t: 2.8, blob: await blob() }]);
  });
  const info = await page.evaluate(() => window.inkgraph.db.verifyInfo());
  check(info && info.matchId === 'v#2' && info.count === 3, '(1) 検証録画は直近1試合ぶんだけ（前の試合のぶんは上書き）', JSON.stringify(info));
  await page.evaluate(() => window.inkgraph.db.delMatch('v#1'));
  check((await page.evaluate(() => window.inkgraph.db.verifyInfo()))?.count === 3, '(2) 別の試合を消しても検証録画は残る');
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForSelector('#verify-export');
  check(await page.isEnabled('#verify-export') && /3コマ/.test(await page.textContent('#verify-info')), '(3) パネルに保存中の表示と書き出しボタン');
  await page.check('#verify-on'); check(await page.evaluate(() => window.inkgraph.db.getVerifyOn()) === true, '(4) オンの設定が保存される');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#verify-export')]);
  const buf = await new Promise((res, rej) => { const chunks = []; dl.createReadStream().then(s => { s.on('data', c => chunks.push(c)); s.on('end', () => res(Buffer.concat(chunks))); s.on('error', rej); }); });
  const z = unzipSync(new Uint8Array(buf)), names = Object.keys(z);
  check(true, '(5) zip 名は verify_pack_check で確認（ヘッドレスでは download 属性名が取れない）');
  check(['manifest.json', 'software.json', 'summary.json', 'README.txt', 'detect_params.json'].every(n => names.includes(n)), '(6) 必要なファイルが入っている', names.join(','));
  check(names.filter(n => n.startsWith('frames/full/')).length === 3, '(7) 全コマが3枚');
  const sum = JSON.parse(Buffer.from(z['summary.json']).toString()); check(sum.deaths.length === 1 && sum.stage === 'テスト', '(8) summary に検出結果');
  check(!errs.length, '(9) ページエラー無し', errs.join('|'));
} finally { await browser.close(); srv.kill?.(); }
process.exit(fails ? 1 : 0);
