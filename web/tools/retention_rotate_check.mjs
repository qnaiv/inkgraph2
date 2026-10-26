// retention_rotate_check.mjs: D59 静止画・場面クリップ（と昔の録画）を直近 N 試合だけ残す。既定は 3。実ブラウザ。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path'; import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'), SH = path.resolve(WEB, '../docs/screenshots/retention'); fs.mkdirSync(SH, { recursive: true });
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const PORT = process.env.PORT || '4235', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  let dialogs = []; page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForFunction(() => window.inkgraph && window.inkgraph.db);
  const ids = ['r#1', 'r#2', 'r#3', 'r#4', 'r#5', 'r#6', 'r#7'];
  await page.evaluate(async ids => {
    const db = window.inkgraph.db; localStorage.removeItem('inkgraph.retentionKeep');
    const blob = () => new Promise(res => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.toBlob(res, 'image/jpeg'); });
    for (let i = 0; i < ids.length; i++) {
      await db.putMatch({ id: ids[i], match: i + 1, created: new Date(2026, 9, 20, 12, i).toISOString(), battle: [0, 100], squid_down: {}, own_deaths: [{ start: 10, end: 12 }], own_kills: [], special: [], result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'テスト', own: { ka: 1, deaths: 1, specials: 0 } },
        review: { marks: { 'death@10.0': 'ok' }, added: [{ kind: 'kill', t: 30 }], fix: {} }, stills: { count: 1, bytes: 9 }, stillsState: 'kept', video: { kind: 'none' }, favorite: i === 0 });
      await db.putSnap({ matchId: ids[i], t: 10, reason: 't', kind: 'death', header: null, blob: await blob() });
    }
    await db.putVideo({ id: 'r#2', blob: await blob() }); // 昔の録画（r#2 は古い側）
  }, ids);
  check(await page.evaluate(() => window.inkgraph.db.getRetentionKeep()) === 3, '(1) 既定の残す試合数は 3');
  const plan = await page.evaluate(() => window.inkgraph.db.retentionPlan());
  check(JSON.stringify(plan.sort()) === JSON.stringify(['r#2', 'r#3', 'r#4']), '(2) 整理の対象は、お気に入り（r#1）を除いた古い方 3 試合（r#2〜r#4）。新しい 3 試合（r#5〜r#7）は残す', plan.join(','));
  const removed = await page.evaluate(() => window.inkgraph.db.enforceRetention());
  const st = await page.evaluate(async ids => { const db = window.inkgraph.db, o = {}; for (const id of ids) { const m = await db.getMatch(id); o[id] = { snaps: (await db.snapsOf(id)).length, state: m.stillsState, review: m.review.added.length, deaths: m.own_deaths.length, video: !!(await db.getVideo(id)) }; } return o; }, ids);
  check(removed.length === 3 && ['r#2', 'r#3', 'r#4'].every(i => st[i].snaps === 0 && st[i].state === 'deleted'), '(3) 古い 3 試合の静止画が消え、「静止画 削除済み」になる');
  check(['r#1', 'r#5', 'r#6', 'r#7'].every(i => st[i].snaps === 1 && st[i].state === 'kept'), '(4) お気に入りと新しい 3 試合の静止画は残る');
  check(ids.every(i => st[i].deaths === 1 && st[i].review === 1), '(5) 全部の試合で、数値データ（検出結果・確認画面の修正）は残る');
  check(st['r#2'].video === false, '(6) 古い試合の昔の録画も消える');
  await page.evaluate(() => window.inkgraph.db.setFavorite('r#1', false));
  const plan2 = await page.evaluate(() => window.inkgraph.db.retentionPlan(1));
  check(JSON.stringify(plan2.sort()) === JSON.stringify(['r#1', 'r#5', 'r#6']), '(7) 残す数を 1 にして、お気に入りを外すと、新しい 1 試合（r#7）より古い、静止画が残っている試合（r#1・r#5・r#6）が対象になる', plan2.join(','));
  // 画面：パネルと、選択を変えたときの確認
  await page.evaluate(async () => { await window.inkgraph.db.setFavorite('r#1', true); });
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForSelector('#retention-keep');
  check((await page.textContent('#retention-panel')).includes('直近 3 試合') && /数値データ.*消えません/.test(await page.textContent('#retention-panel')), '(8) パネルに「直近 3 試合」と、数値データは消えない旨が出る');
  await page.screenshot({ path: path.join(SH, '01_panel.png') });
  await page.selectOption('#retention-keep', '1'); await page.waitForTimeout(600);
  check(dialogs.length === 1 && /2 試合ぶん/.test(dialogs[0]), '(9) 残す数を減らすと、確認ダイアログが出る（消す試合数つき）', dialogs[0]);
  const left = await page.evaluate(async () => { const db = window.inkgraph.db; const r = []; for (const id of ['r#5', 'r#6', 'r#7']) r.push((await db.snapsOf(id)).length); return r; });
  check(JSON.stringify(left) === '[0,0,1]' && (await page.evaluate(() => window.inkgraph.db.getRetentionKeep())) === 1, '(10) 確認すると整理が実行され、設定が保存される', JSON.stringify(left));
  check(errs.length === 0, '(11) ページエラーなし', errs.join('|'));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
