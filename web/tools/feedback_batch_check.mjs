// #33 正解データのバッチ書き出しチェック。usage: node tools/feedback_batch_check.mjs
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/feedback-batch-export');
const ZIP_PATH = '/tmp/feedback_batch_check.zip';
fs.mkdirSync(SH, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

const ids = { A: 'fbbatch-A', B: 'fbbatch-B', C: 'fbbatch-C' };
const BIG_ID = 'fbbatch-big';
const idList = [...Object.values(ids), BIG_ID];

const PORT = Number(process.env.PORT) || 4197, U = `http://127.0.0.1:${PORT}/`;
const srv = startPreview(PORT, WEB_DIR);
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
let page = null;
const cleanup = async () => {
  if (page) await page.evaluate(async ids => { for (const id of ids) await window.inkgraph.db.delMatch(id); localStorage.removeItem('inkgraph.feedbackHistory'); }, idList).catch(() => {});
};
const stateOf = id => page.evaluate(async id => { const F = window.inkgraph.feedback; return F.exportStateOf(await window.inkgraph.db.getMatch(id)); }, id);
const pendingIds = () => page.evaluate(async () => { const F = window.inkgraph.feedback; return F.pendingMatches(await window.inkgraph.db.allMatches()).map(m => m.id).sort(); });
const clickDownload = async (sel) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  return dl;
};
const j = x => JSON.stringify(x);

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', acceptDownloads: true });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(U + '#list');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.feedback, null, { timeout: 10000 });
  await cleanup();

  await page.evaluate(async ({ ids }) => {
    const db = window.inkgraph.db;
    const mk = () => new Promise(res => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.fillStyle = '#2a6'; x.fillRect(0, 0, 64, 36); c.toBlob(res, 'image/jpeg', 0.8); });
    const base = Date.parse('2026-01-01T00:00:00Z');
    const mkm = (id, i, review, stills) => ({
      id, match: i, created: new Date(base + i * 3600000).toISOString(), battle: [0, 300], squid_down: {},
      own_deaths: [{ start: 10, end: 15 }], own_kills: [{ start: 20, end: 21 }], special: [],
      tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }],
      result_screen: { result: i % 2 ? 'WIN' : 'LOSE', mode: 'ガチヤグラ', stage: 'テスト' + i, own: { deaths: 1, specials: 0 } },
      review, stills: { count: stills, bytes: stills * 123 }, stillsState: stills ? 'kept' : 'deleted', video: { kind: 'none' }
    });
    await db.putMatch(mkm(ids.A, 1, { marks: { 'death@10.0': 'ok' }, added: [{ kind: 'kill', t: 30 }], fix: {}, rmarks: { result: 'ok' }, tower_seg: { '5.0': 'own' }, tower_holder: [[5, 10, 'own']], updated: '2026-01-01T00:00:00Z' }, 2));
    await db.putMatch(mkm(ids.B, 2, { marks: { 'kill@20.0': 'wrong' }, added: [], fix: { result: 'WIN' }, rmarks: {}, updated: '2026-01-02T00:00:00Z' }, 0));
    await db.putMatch(mkm(ids.C, 3, { marks: {}, added: [], fix: {}, rmarks: {} }, 1));
    await db.putSnap({ matchId: ids.A, t: 10, reason: 'テスト', kind: 'death', header: null, blob: await mk() });
    await db.putSnap({ matchId: ids.A, t: 20, reason: 'テスト', kind: 'kill', header: null, blob: await mk() });
  }, { ids });
  // 一覧を再描画
  await page.evaluate(() => { location.hash = '#live'; }); await page.waitForTimeout(100);
  await page.goto(U + '#list'); await page.reload(); await page.waitForTimeout(1200);

  // 1. exportStateOf
  const st = { A: await stateOf(ids.A), B: await stateOf(ids.B), C: await stateOf(ids.C) };
  check('1) states A/B=accumulated, C=unreviewed', st.A === 'accumulated' && st.B === 'accumulated' && st.C === 'unreviewed', j(st));
  check('1) pending = A,B', j(await pendingIds()) === j([ids.A, ids.B].sort()), j(await pendingIds()));

  // 2. hash
  const h = await page.evaluate(async id => {
    const F = window.inkgraph.feedback, m = await window.inkgraph.db.getMatch(id);
    const h1 = F.reviewHash(m);
    const m2 = JSON.parse(JSON.stringify(m)); m2.review.updated = 'x'; m2.review.tower_seg = {}; m2.review.export = { state: 'exported' };
    // キー順を変えても同値
    m2.review.marks = Object.fromEntries(Object.entries(m2.review.marks).reverse());
    const h2 = F.reviewHash(m2);
    const m3 = JSON.parse(JSON.stringify(m)); m3.review.marks['death@10.0'] = 'wrong';
    const rc = F.reviewContent(m);
    return { h1, h2, h3: F.reviewHash(m3), keys: Object.keys(rc), holder: !!rc.tower_holder, added: rc.added.length };
  }, ids.A);
  check('2) reviewHash stable for same content', h.h1 === h.h2 && /^[0-9a-f]+$/.test(h.h1), `${h.h1}/${h.h2}`);
  check('2) reviewHash changes on marks change', h.h1 !== h.h3);
  check('2) reviewContent drops tower_seg/export/updated, keeps others', !h.keys.includes('tower_seg') && !h.keys.includes('export') && !h.keys.includes('updated') && h.holder && h.added === 1, h.keys.join(','));

  // 3. list
  const pendingText = (await page.locator('#fb-pending').textContent()).trim();
  check('3) list shows 未書き出しの正解データ: 2試合', pendingText.includes('未書き出しの正解データ') && pendingText.includes('2試合（確認済み 5件）'), pendingText);
  check('3) bar has primary button', (await page.locator('.fb-bar #fbbar.btn-primary').count()) === 1);
  const ddSummary = (await page.locator('.page-header-actions .dropdown summary').innerText()).trim();
  check('3) dropdown is バックアップ and no #fb', (ddSummary.includes('バックアップ') || ddSummary.includes('試合ログ')) && (await page.locator('#fb').count()) === 0, ddSummary);
  const labels = await page.locator('.match-row .export-state').allTextContents();
  check('3) rows show state labels', labels.filter(t => t === '未書き出し').length === 2 && labels.filter(t => t === '未確認').length === 1, j(labels));
  const pills = await page.locator('.match-row .export-state').evaluateAll(els => els.map(el => ({
    w: el.getBoundingClientRect().width,
    state: el.dataset.state,
    text: el.innerText.trim()
  })));
  check('3) pills width 90px and data-state/text', pills.length === 3 && pills.every(p => Math.abs(p.w - 90) <= 2) && pills.some(p => p.state === 'accumulated' && p.text === '未書き出し') && pills.some(p => p.state === 'unreviewed' && p.text === '未確認'), j(pills));

  // 4. dialog diff
  await page.click('#fbbar');
  await page.waitForSelector('.fb-dialog');
  const rows = await page.locator('.fb-dialog-row').evaluateAll(es => es.map(e => ({ id: e.dataset.id, text: e.innerText.replace(/\s+/g, ' ') })));
  const rowIds = rows.map(r => r.id).sort();
  check('4) dialog diff targets A,B (no C)', j(rowIds) === j([ids.A, ids.B].sort()), j(rowIds));
  const rowB = rows.find(r => r.id === ids.B)?.text || '';
  const rowA = rows.find(r => r.id === ids.A)?.text || '';
  check('4) B shows 静止画なし', rowB.includes('静止画なし'), rowB);
  check('4) A shows 枚数/容量 and 確認済み件数', /静止画 2枚/.test(rowA) && /確認済み 4件/.test(rowA), rowA);
  const total = await page.locator('#fbd-total').innerText();
  check('4) total estimate shown', /合計 約\s*\d+(\.\d+)?(KB|MB)/.test(total), total.replace(/\s+/g, ' '));
  check('4) no 50MB warning', (await page.locator('#fbd-warn').count()) === 0);

  // fbd-mark チェック
  const markChecked = await page.isChecked('#fbd-mark');
  const markLabel = await page.locator('label.fb-dialog-mark').innerText();
  const markOk1 = markChecked && markLabel.includes('書き出し済みにする（次回は差分に出ません）') && (await page.locator('#fbd-skip-note').count()) === 0;
  await page.uncheck('#fbd-mark');
  const noteShown = (await page.locator('#fbd-skip-note').count()) === 1 && (await page.locator('#fbd-skip-note').innerText()).includes('今回は記録を残さないため、次回も差分に出ます');
  await page.check('#fbd-mark');
  const noteHidden = (await page.locator('#fbd-skip-note').count()) === 0;
  check('4) fbd-mark initial checked, toggle note', markOk1 && noteShown && noteHidden);

  // 5. export (diff)
  const dl1 = await clickDownload('#fbd-go');
  await dl1.saveAs(ZIP_PATH);
  const fname1 = dl1.suggestedFilename();
  check('5) filename _追加分', /^ink-graph_正解データ_\d{8}-\d{4}_追加分\.zip$/.test(fname1), fname1);
  const z = unzipSync(new Uint8Array(fs.readFileSync(ZIP_PATH)));
  const fj = JSON.parse(strFromU8(z['feedback.json']));
  check('5) feedback.json format=2 / batchId / exportMode=diff', fj.format === 2 && /^fb-\d{8}-\d{6}-\d{4}$/.test(fj.batchId) && fj.exportMode === 'diff', `${fj.format} ${fj.batchId} ${fj.exportMode}`);
  check('5) includes declared', fj.includes?.videos === false && fj.includes?.snaps === true && fj.appBuild === 'dev');
  check('5) matches=2, no tower_seg, reviewHash present', fj.matches.length === 2 && fj.matches.every(m => !('tower_seg' in m.review) && !('export' in m.review) && m.reviewHash && 'reviewUpdated' in m && m.tower_series), `${fj.matches.length}`);
  const mA = fj.matches.find(m => m.id === ids.A), mB = fj.matches.find(m => m.id === ids.B);
  check('5) A has images in zip, B has none', mA.stillsAvailable && mA.snapshots.length === 2 && mA.snapshots.every(s => z[s.file]) && !mB.stillsAvailable && mB.snapshots.length === 0);
  check('5) README.txt contains batchId/mode/privacy note', z['README.txt'] && strFromU8(z['README.txt']).includes(fj.batchId) && strFromU8(z['README.txt']).includes('プレイヤー名') && strFromU8(z['README.txt']).includes('自動送信'));
  await page.waitForTimeout(500);

  // 6. after export
  const st6 = { A: await stateOf(ids.A), B: await stateOf(ids.B), C: await stateOf(ids.C) };
  const pend6 = await pendingIds();
  check('6) A/B exported, pending=0', st6.A === 'exported' && st6.B === 'exported' && pend6.length === 0, j(st6));
  const diffTargets = await page.evaluate(async () => { const F = window.inkgraph.feedback; return F.exportableMatches(await window.inkgraph.db.allMatches(), 'diff').length; });
  check('6) diff re-export targets = 0', diffTargets === 0);
  const hist = await page.evaluate(() => window.inkgraph.feedback.getFeedbackHistory());
  check('6) history appended', hist.length === 1 && hist[0].batchId === fj.batchId && hist[0].count === 2 && hist[0].mode === 'diff', j(hist));
  const zeroPendingText = (await page.locator('#fb-pending').innerText()).trim();
  const zeroNoBarBtn = (await page.locator('#fbbar').count()) === 0;
  check('6) list shows 0試合 pending and 書き出し済み labels', zeroPendingText === '未書き出しの正解データはありません' && zeroNoBarBtn && (await page.locator('.match-row .export-state').allTextContents()).filter(t => t === '書き出し済み').length === 2);

  // 履歴テーブル確認
  await page.locator('details.fb-history summary').click();
  const histRow = await page.locator('.fb-history-table tbody tr').first();
  const histText = (await histRow.innerText()).replace(/\s+/g, ' ');
  const histHasNoBtn = (await page.locator('details.fb-history button').count()) === 0;
  check('6) history table has entry with no buttons', histText.includes('追加分') && histText.includes('2試合') && histText.includes('.zip') && histHasNoBtn, histText);

  // ダイアログ再オープンして前回表示 & "fb-" 非表示確認
  await page.evaluate(() => window.inkgraph.showFeedbackExportDialog('diff'));
  await page.waitForSelector('.fb-dialog');
  const dialogText = await page.locator('.fb-dialog').innerText();
  const lastTxt = (await page.locator('.fb-dialog-last').innerText()).trim();
  check('6) dialog shows 前回 format without fb- batchId', /^前回：\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}・追加分・2試合$/.test(lastTxt) && !dialogText.includes('fb-'), `${lastTxt} | has-fb: ${dialogText.includes('fb-')}`);
  await page.click('#fbd-cancel');

  // 7. re-edit B
  const st7 = await page.evaluate(async id => {
    const F = window.inkgraph.feedback, db = window.inkgraph.db;
    const m = await db.getMatch(id); m.review.marks['kill@20.0'] = 'ok'; F.syncExportState(m); await db.putMatch(m);
    const m2 = await db.getMatch(id);
    return { s: m2.review.export.state, keep: !!m2.review.export.lastExportedHash && !!m2.review.export.lastBatchId, pend: F.pendingMatches(await db.allMatches()).map(x => x.id) };
  }, ids.B);
  check('7) B -> changed, pending includes B, export fields kept', st7.s === 'changed' && st7.keep && j(st7.pend) === j([ids.B]), j(st7));

  // 8/10. full mode, with 書き出し済みにしない
  await page.reload(); await page.waitForTimeout(1000);
  await page.click('#fbbar'); await page.waitForSelector('.fb-dialog');
  await page.check('input[name="fbmode"][value="full"]');
  await page.waitForTimeout(200);
  const rowsF = await page.locator('.fb-dialog-row').evaluateAll(es => es.map(e => e.dataset.id).sort());
  check('8) full targets = A,B (C excluded)', j(rowsF) === j([ids.A, ids.B].sort()), j(rowsF));
  await page.uncheck('#fbd-mark');
  const dl2 = await clickDownload('#fbd-go');
  const fname2 = dl2.suggestedFilename();
  const p2 = '/tmp/feedback_batch_check_full.zip';
  await dl2.saveAs(p2);
  const fj2 = JSON.parse(strFromU8(unzipSync(new Uint8Array(fs.readFileSync(p2)))['feedback.json']));
  check('8) filename _全件, exportMode=full, 2 matches', /_全件\.zip$/.test(fname2) && fj2.exportMode === 'full' && fj2.matches.length === 2, fname2);
  await page.waitForTimeout(500);
  const st10 = { A: await stateOf(ids.A), B: await stateOf(ids.B) };
  check('10) 書き出し済みにしない: B stays changed, A stays exported', st10.B === 'changed' && st10.A === 'exported', j(st10));

  // 9. estimate threshold
  const est = await page.evaluate(() => {
    const F = window.inkgraph.feedback, MB = 1024 * 1024;
    const m = id => ({ id, review: {} });
    const mk = mb => ({ blob: { size: mb * MB } });
    const lo = F.estimateExport([m('x'), m('y')], new Map([['x', [mk(24)]], ['y', [mk(25)]]]));
    const hi = F.estimateExport([m('x'), m('y')], { x: [mk(25)], y: [mk(26)] });
    const ex = F.estimateExport([m('x')], { x: [mk(50)] });
    return { lo: lo.over50MB, hi: hi.over50MB, ex: ex.over50MB, p: lo.perMatch.get('x') };
  });
  check('9) estimateExport over50MB threshold', est.lo === false && est.hi === true && est.ex === true && est.p.snaps === 1 && est.p.stillsAvailable, j(est));

  // 50MB警告UI & 詳細画面
  await page.evaluate(async (bigId) => {
    const db = window.inkgraph.db;
    const bigBlob = new Blob([new Uint8Array(51 * 1024 * 1024)], { type: 'image/jpeg' });
    const m = {
      id: bigId, match: 99, created: new Date().toISOString(), battle: [0, 300], squid_down: {},
      own_deaths: [], own_kills: [], special: [],
      tower_series: [],
      result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: '巨大' },
      review: { marks: { 'kill@1.0': 'ok', 'death@2.0': 'ok' }, added: [], fix: {}, rmarks: {} },
      stills: { count: 1, bytes: bigBlob.size }, stillsState: 'kept', video: { kind: 'none' }
    };
    await db.putMatch(m);
    await db.putSnap({ matchId: bigId, t: 10, reason: '巨大テスト', kind: 'death', header: null, blob: bigBlob });
  }, BIG_ID);

  await page.goto(U + '#match/' + encodeURIComponent(BIG_ID));
  await page.waitForTimeout(500);
  await page.locator('label.review-toggle-label').click();
  await page.waitForSelector('.detail-body.review-on');
  const fboneText = (await page.locator('#fbone').innerText()).trim();
  const fboneStateText = (await page.locator('#fbone-state').innerText()).trim();
  check('detail: fbone text and state', fboneText === '試合一覧でまとめて書き出す →' && fboneStateText === 'この試合：未書き出し（確認済み 2件）', `${fboneText} | ${fboneStateText}`);

  await page.click('#fbone');
  await page.waitForSelector('.fb-dialog', { timeout: 10000 });
  const warnLocator = page.locator('#fbd-warn');
  const warnCount = await warnLocator.count();
  const warnText = warnCount ? (await warnLocator.innerText()).trim() : '';
  check('dialog: 50MB warning shown', warnText.includes('を超えています') && warnText.includes('あと1試合外すと50MB以内です'), warnText);

  await page.uncheck(`.fbd-chk[data-id="${BIG_ID}"]`);
  await page.waitForTimeout(300);
  check('dialog: 50MB warning disappeared after uncheck', (await page.locator('#fbd-warn').count()) === 0);

  await page.click('#fbd-cancel');
  await page.evaluate(async (bigId) => {
    await window.inkgraph.db.delMatch(bigId);
  }, BIG_ID);

  check('11) no pageerror', errors.length === 0, errors.join(';'));
} catch (e) {
  check('unexpected error', false, e.stack || String(e));
} finally {
  await cleanup();
  await browser.close();
  srv.kill();
  console.log(`zip saved: ${ZIP_PATH}`);
}
const fails = results.filter(r => !r).length;
console.log(fails ? `\nFAILED ${fails}/${results.length}` : `\nALL PASS (${results.length})`);
process.exit(fails ? 1 : 0);
