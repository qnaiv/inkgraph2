// #34 バックアップチェック。usage: node tools/backup_check.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/backup');
const ZIP_PATH = '/tmp/inkgraph_backup_test.zip';
const LEGACY_JSON_PATH = '/tmp/inkgraph_backup_legacy.json';
fs.mkdirSync(SH, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

const PORT = 4195;
const U = `http://127.0.0.1:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
let page = null;

const cleanup = async () => {
  if (page) {
    await page.evaluate(async () => {
      const db = window.inkgraph?.db;
      if (!db) return;
      for (const id of ['backup-test-a', 'backup-test-b', 'backup-test-c', 'backup-legacy-1']) {
        await db.delMatch(id).catch(() => {});
      }
      localStorage.removeItem('inkgraph.feedbackHistory');
      localStorage.removeItem('inkgraph.backupTest');
    }).catch(() => {});
  }
  try { if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH); } catch {}
  try { if (fs.existsSync(LEGACY_JSON_PATH)) fs.unlinkSync(LEGACY_JSON_PATH); } catch {}
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', acceptDownloads: true });
  page = await ctx.newPage();
  await page.route('https://fonts.**/**', route => route.abort());

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const dialogMessages = [];
  page.on('dialog', async d => {
    dialogMessages.push(d.message());
    await d.accept();
  });

  await page.goto(U + '#list');
  await page.waitForFunction(() => window.inkgraph && window.inkgraph.backup && window.inkgraph.db, null, { timeout: 10000 });
  await cleanup();

  // Seed 投入
  await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const FB = window.inkgraph.feedback;
    const mk = () => new Promise(res => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      const x = c.getContext('2d');
      x.fillStyle = '#2a6';
      x.fillRect(0, 0, 64, 36);
      c.toBlob(res, 'image/jpeg', 0.8);
    });

    // a: favorite: true, review marks + export.lastExportedHash (exported), stillsState: kept, stills meta, snap 2枚, putVideoダミーBlobあり
    const matchA = {
      id: 'backup-test-a',
      match: 1,
      favorite: true,
      stillsState: 'kept',
      stills: { count: 2, bytes: 2048 },
      created: '2026-01-01T00:00:00Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [{ start: 10, end: 15 }],
      own_kills: [{ start: 20, end: 21 }],
      special: [],
      tower_series: [{ t: 0, own: 0, enemy: 0, owner: 'neutral' }],
      result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'テストA', own: { deaths: 1, specials: 0 } },
      review: {
        marks: { 'kill@20.0': 'ok' },
        export: { state: 'exported' }
      }
    };
    matchA.review.export.lastExportedHash = FB.reviewHash(matchA);
    await db.putMatch(matchA);
    await db.putSnap({ matchId: 'backup-test-a', t: 10, reason: 'テスト1', kind: 'death', header: null, blob: await mk() });
    await db.putSnap({ matchId: 'backup-test-a', t: 20, reason: 'テスト2', kind: 'kill', header: null, blob: await mk() });
    await db.putVideo({ id: 'backup-test-a', blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/webm' }) });

    // b: stillsState: 'deleted', review marksあり, stills meta, snapなし
    const matchB = {
      id: 'backup-test-b',
      match: 2,
      stillsState: 'deleted',
      stills: { count: 0, bytes: 0 },
      created: '2026-01-02T00:00:00Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [],
      own_kills: [{ start: 15, end: 16 }],
      special: [],
      tower_series: [],
      result_screen: { result: 'LOSE', mode: 'ガチホコ', stage: 'テストB', own: { deaths: 0, specials: 0 } },
      review: {
        marks: { 'kill@15.0': 'wrong' }
      }
    };
    await db.putMatch(matchB);

    // c: stillsState: 'none', reviewなし, snapなし
    const matchC = {
      id: 'backup-test-c',
      match: 3,
      stillsState: 'none',
      stills: { count: 0, bytes: 0 },
      created: '2026-01-03T00:00:00Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [],
      own_kills: [],
      special: [],
      tower_series: [],
      result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'テストC', own: { deaths: 0, specials: 0 } },
      review: {}
    };
    await db.putMatch(matchC);

    localStorage.setItem('inkgraph.feedbackHistory', JSON.stringify([{ batchId: 'seed-batch', count: 1 }]));
    localStorage.setItem('inkgraph.backupTest', 'hello-test-val');
  });

  // 再描画
  await page.evaluate(() => { location.hash = '#live'; });
  await page.waitForTimeout(100);
  await page.goto(U + '#list');
  await page.waitForTimeout(1000);

  // スクショ1: 初期一覧
  await page.screenshot({ path: path.join(SH, '01_list_initial.png') });

  // ドロップダウンを開く
  await page.locator('.page-header-actions .dropdown summary').click();
  await page.waitForTimeout(300);

  // スクショ2: ドロップダウン展開
  await page.screenshot({ path: path.join(SH, '02_dropdown_open.png') });

  // ボタン文言の確認
  const bkExpText = (await page.locator('#bkexp').innerText()).trim();
  check('0) #bkexp text shows matches, stills and bytes', bkExpText.includes('3試合') && bkExpText.includes('静止画2枚') && bkExpText.includes('バックアップを書き出す（ZIP）'), bkExpText);

  // (1) UI #bkexp 経由で download zip 保存
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#bkexp')
  ]);
  await download.saveAs(ZIP_PATH);
  check('(1) zip downloaded via #bkexp', fs.existsSync(ZIP_PATH) && fs.statSync(ZIP_PATH).size > 0);

  // (2) unzip しファイル一覧を検証
  const zipBuf = fs.readFileSync(ZIP_PATH);
  const unzipped = unzipSync(new Uint8Array(zipBuf));
  const fnames = Object.keys(unzipped);

  const hasVideos = fnames.some(n => n.startsWith('videos/') || n.includes('.webm'));
  const hasBackupJson = fnames.includes('backup.json');
  const hasReadme = fnames.includes('README.txt');
  const stillAFiles = fnames.filter(n => n.startsWith('stills/backup_test_a/'));
  const stillBFiles = fnames.filter(n => n.startsWith('stills/backup_test_b/'));
  const stillCFiles = fnames.filter(n => n.startsWith('stills/backup_test_c/'));

  check('(2) no videos or webm in zip', !hasVideos, fnames.filter(n => n.includes('video')).join(','));
  check('(2) backup.json and README.txt exist', hasBackupJson && hasReadme);
  check('(2) match a has 2 stills in stills/', stillAFiles.length === 2, stillAFiles.join(', '));
  check('(2) match b and c have no files in stills/', stillBFiles.length === 0 && stillCFiles.length === 0);

  // (3) backup.json parse 検証
  const meta = JSON.parse(strFromU8(unzipped['backup.json']));
  check('(3) meta.kind is backup and format is 1', meta.kind === 'backup' && meta.format === 1);
  check('(3) meta.includes.videos is false', meta.includes?.videos === false);
  check('(3) meta.counts: matches=3, stills=2', meta.counts?.matches === 3 && meta.counts?.stills === 2, JSON.stringify(meta.counts));
  check('(3) settings has 2 inkgraph keys', meta.settings?.['inkgraph.feedbackHistory'] && meta.settings?.['inkgraph.backupTest'] === 'hello-test-val');
  check('(3) b has no stills in meta.stills', !meta.stills?.some(s => s.matchId === 'backup-test-b') && meta.stills?.length === 2);
  const mb = meta.matches?.find(m => m.id === 'backup-test-b');
  check('(3) b included in meta.matches and review marks preserved', mb && mb.review?.marks?.['kill@15.0'] === 'wrong');

  // (4) 全削除 + localStorage.clear + reload 後、#imp に zip 投入し alert 受理、復元後検証
  await page.evaluate(async () => {
    const db = window.inkgraph.db;
    await db.delMatch('backup-test-a');
    await db.delMatch('backup-test-b');
    await db.delMatch('backup-test-c');
    localStorage.clear();
  });
  await page.reload();
  await page.waitForTimeout(500);

  // 空状態確認
  const emptyText = await page.locator('.empty-state p').innerText().catch(() => '');
  check('(4) empty state text updated', emptyText.includes('バックアップを読み込んでください'), emptyText);

  // #imp に zip 投入
  dialogMessages.length = 0;
  await page.locator('#imp').setInputFiles(ZIP_PATH);
  await page.waitForTimeout(1000);

  check('(4) import alert dialog shown', dialogMessages.some(m => m.includes('バックアップから 3試合（静止画2枚）を読み込みました')), dialogMessages.join(' | '));

  // 復元後データの検証
  const restored = await page.evaluate(async () => {
    const db = window.inkgraph.db;
    const FB = window.inkgraph.feedback;
    const a = await db.getMatch('backup-test-a');
    const aSnaps = await db.snapsOf('backup-test-a');
    const aVideo = await db.getVideo('backup-test-a');
    const b = await db.getMatch('backup-test-b');
    const bSnaps = await db.snapsOf('backup-test-b');
    const c = await db.getMatch('backup-test-c');
    const settings = {
      hist: localStorage.getItem('inkgraph.feedbackHistory'),
      test: localStorage.getItem('inkgraph.backupTest')
    };
    return {
      a: {
        favorite: a?.favorite,
        stillsState: a?.stillsState,
        snapsCount: aSnaps.length,
        exportState: FB.exportStateOf(a),
        hasVideo: aVideo !== undefined
      },
      b: {
        stillsState: b?.stillsState,
        snapsCount: bSnaps.length,
        marks: b?.review?.marks
      },
      cExists: !!c,
      settings
    };
  });

  check('(4) match a restored: favorite=true, exportState=exported, snaps=2, stillsState=kept',
    restored.a.favorite === true && restored.a.exportState === 'exported' && restored.a.snapsCount === 2 && restored.a.stillsState === 'kept',
    JSON.stringify(restored.a));
  check('(4) match a video untouched (remains undefined)', restored.a.hasVideo === false);
  check('(4) match b restored: marks preserved, snaps=0, stillsState=deleted',
    restored.b.marks?.['kill@15.0'] === 'wrong' && restored.b.snapsCount === 0 && restored.b.stillsState === 'deleted',
    JSON.stringify(restored.b));
  check('(4) match c exists', restored.cExists === true);
  check('(4) localStorage settings restored', restored.settings.test === 'hello-test-val' && !!restored.settings.hist);

  // スクショ3: 復元後一覧
  await page.screenshot({ path: path.join(SH, '03_restored_list.png') });

  // (5) 旧形式JSON を #imp 投入し読み込める
  const legacyJson = {
    app: 'InkGraph',
    format: 1,
    matches: [{
      id: 'backup-legacy-1',
      match: 99,
      created: '2026-01-04T00:00:00Z',
      battle: [0, 300],
      squid_down: {},
      own_deaths: [],
      own_kills: [],
      special: [],
      tower_series: [],
      result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'レガシー' }
    }]
  };
  fs.writeFileSync(LEGACY_JSON_PATH, JSON.stringify(legacyJson));
  dialogMessages.length = 0;
  await page.locator('#imp').setInputFiles(LEGACY_JSON_PATH);
  await page.waitForTimeout(1000);

  check('(5) legacy import alert dialog shown', dialogMessages.some(m => m.includes('旧形式の試合ログから 1試合を読み込みました')), dialogMessages.join(' | '));
  const legacyMatch = await page.evaluate(async () => window.inkgraph.db.getMatch('backup-legacy-1'));
  check('(5) legacy match imported successfully', legacyMatch && legacyMatch.id === 'backup-legacy-1');

  // スクショ4: 旧形式読み込み後
  await page.screenshot({ path: path.join(SH, '04_legacy_imported.png') });

  // (6) pageerror なし
  check('(6) no pageerror occurred', errors.length === 0, errors.join('; '));

  await cleanup();
} catch (e) {
  console.error('Test error:', e);
  results.push(false);
} finally {
  await browser.close();
  srv.kill('SIGTERM');
}

const allPass = results.length > 0 && results.every(Boolean);
console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAIL'} (${results.filter(Boolean).length}/${results.length})`);
process.exit(allPass ? 0 : 1);
