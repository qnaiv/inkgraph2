// video_rec_check.mjs: D68 試合ごとの録画ファイル。名前付け（純関数）と、実ブラウザでの MediaRecorder 録画・保存（ダウンロード）・パネル。
import { chromium } from 'playwright-core';
import { startPreview } from './lib/preview_server.mjs';
import path from 'node:path';
import { videoFilename } from '../src/video_rec.js';
const WEB = path.resolve(import.meta.dirname, '..');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mk = (o = {}) => ({ created: new Date(2026, 9, 27, 21, 5).toISOString(), match_type: 'regular', result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'ヒラメが丘団地' }, ...o });
check(videoFilename(mk()) === '20261027_2105_ガチエリア_ヒラメが丘団地_勝ち.webm', '(1) 名前: 日時_ルール_ステージ_勝敗', videoFilename(mk()));
check(videoFilename(mk({ result_screen: { result: 'LOSE', mode: 'ガチ/ヤグラ', stage: 'マ:ン*タ' } })) === '20261027_2105_ガチヤグラ_マンタ_負け.webm', '(2) 使えない文字は除く');
check(videoFilename(mk({ result_screen: {} })) === '20261027_2105_ルール不明_ステージ不明_勝敗不明.webm', '(3) 読めなかった項目は「不明」で埋める');
check(videoFilename(mk({ match_type: 'X' })) === '20261027_2105_ガチエリア_ヒラメが丘団地_X_勝ち.webm', '(4) マッチ種別（regular 以外）を入れる');
const PORT = process.env.PORT || '4237', srv = startPreview(PORT, WEB); await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForFunction(() => window.inkgraph && window.inkgraph.VR);
  // ブラウザ版では録画は非対応: パネルは「デスクトップ版だけ」と出し、録画のオプションは出ない
  await page.evaluate(() => { localStorage.removeItem('inkgraph.videoBrowser'); localStorage.removeItem('inkgraph.videoRec'); });
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.waitForFunction(() => document.querySelector('#live-video-panel')?.textContent.includes('試合ごとの録画')); await page.evaluate(() => { document.querySelector('#live-video-settings').open = true; });
  check(/デスクトップ版（Windows）だけ/.test(await page.textContent('#live-video-panel')) && !(await page.$('#video-on')) && !(await page.evaluate(() => window.inkgraph.VR.videoSupported())), '(0) ブラウザ版では録画の設定が出ない（デスクトップ版だけの旨が出る）');
  await page.goto(`http://127.0.0.1:${PORT}/#live`); check(/ブラウザ版: 解析中は/.test(await page.textContent('#live-browser-note')), '(0b) ブラウザ版のライブ画面に「ウィンドウを隠さないで」の注意が出る');
  // 以降は、サポート外の実験フラグで、ブラウザ録画の仕組み（MediaRecorder・保存・Session の配線）を確認する
  await page.evaluate(() => localStorage.setItem('inkgraph.videoBrowser', '1'));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.waitForSelector('#video-on', { state: 'attached' }); await page.evaluate(() => { document.querySelector('#live-video-settings').open = true; });
  check(!(await page.isChecked('#video-on')) && /未設定/.test(await page.textContent('#video-dir')), '(5) パネル: 既定はオフ・保存先は未設定');
  await page.check('#video-on'); check(await page.evaluate(() => window.inkgraph.VR.getVideoOn()), '(6) オンの設定が保存される');
  // canvas の映像を録って、Blob になる・ダウンロード保存される
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${n++ * 20},80%,50%)`; g.fillRect(0, 0, 320, 180); }, 50);
    const rec = new window.inkgraph.VR.MatchRecorder(c.captureStream(20)).start(); await new Promise(r => setTimeout(r, 1500)); const blob = await rec.stop(); clearInterval(iv);
    window.__blob = blob; return { size: blob.size, type: blob.type };
  });
  check(r.size > 500 && /webm|mp4/.test(r.type), '(7) MediaRecorder で動画の Blob ができる（既定は MP4）', JSON.stringify(r));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.inkgraph.VR.saveVideo(window.__blob, 'テスト.webm', { getDir: async () => null }))]);
  check(!!dl, '(8) 保存先未設定ならダウンロードで保存される');
  const a = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); let n = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${n++ * 20},80%,50%)`; g.fillRect(0, 0, 160, 90); }, 50);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    const st = c.captureStream(20); d.stream.getAudioTracks().forEach(t => st.addTrack(t));
    const rec = new window.inkgraph.VR.MatchRecorder(st).start(); await new Promise(r => setTimeout(r, 1500)); const blob = await rec.stop(); clearInterval(iv); o.stop();
    return { size: blob.size, mime: rec.mime, audioTracks: st.getAudioTracks().length };
  });
  check(a.size > 500 && a.audioTracks === 1 && /opus/.test(a.mime), '(9) 音声つきのストリームも録れる（opus）', JSON.stringify(a));
  await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.waitForSelector('#video-audio', { state: 'attached' }); await page.evaluate(() => { document.querySelector('#live-video-settings').open = true; }); await page.check('#video-audio');
  check(await page.evaluate(() => window.inkgraph.VR.getAudioOn()), '(10) 「ゲーム音も録音する」の設定が保存される');
  // 保存先フォルダ: 許可が切れていたら聞き直す／許可されなければダウンロード（理由つき）／許可済みならフォルダに書く
  const f = await page.evaluate(async () => {
    const VR = window.inkgraph.VR, written = [];
    const mk = perm => { let p = perm; return { name: 'テスト', queryPermission: async () => p, requestPermission: async () => { p = 'granted'; return p; }, getFileHandle: async n => ({ createWritable: async () => ({ write: async b => written.push([n, b.size]), close: async () => {} }) }) }; };
    const lapsed = mk('prompt'), r1 = await VR.ensureDirPermission(lapsed);
    const denied = { name: 'x', queryPermission: async () => 'prompt', requestPermission: async () => 'denied', getFileHandle: async () => { throw new Error('no'); } };
    const r2 = await VR.ensureDirPermission(denied), blob = new Blob([new Uint8Array(100)], { type: 'video/webm' });
    const s1 = await VR.saveVideo(blob, 'a.webm', { getDir: async () => mk('granted') });
    const s2 = await VR.saveVideo(blob, 'b.webm', { getDir: async () => denied });
    const s3 = await VR.saveVideo(blob, 'c.webm', { getDir: async () => null });
    return { r1, r2, s1, s2: s2.where + ':' + s2.why, s3: s3.where + ':' + s3.why, written, none: await VR.ensureDirPermission(null) };
  });
  check(f.r1 === 'granted' && f.r2 === 'denied' && f.none === null, '(11) 許可が切れていたら聞き直す（granted／denied／未設定）', JSON.stringify([f.r1, f.r2, f.none]));
  check(f.s1.where === 'folder' && f.written[0][0] === 'a.webm' && f.s2.startsWith('download:') && /許可/.test(f.s2) && f.s3 === 'download:フォルダ未設定', '(12) 許可済みはフォルダに保存・許可が無ければ理由つきでダウンロード', f.s2 + ' / ' + f.s3);
  // Session の配線: バトル開始で録画開始 → 試合の保存で名前を付けて保存 → 画面向けの状況通知が出る
  await page.evaluate(() => { localStorage.setItem('inkgraph.videoRec', '1'); });
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.evaluate(async () => {
    const { Session, db } = window.inkgraph, log = [], saved = [];
    const v = document.createElement('video'), s = new Session(v, { videoStatus: r => log.push(r.msg), videoSaved: r => saved.push(r.filename) });
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); let n = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${n++ * 20},80%,50%)`; g.fillRect(0, 0, 160, 90); }, 50);
    s.mode = 'stream'; s.stream = c.captureStream(20); s.sessionId = new Date(2026, 9, 27, 21, 0).toISOString(); s.fast = false; s.running = true;
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: 0 } });
    await new Promise(r => setTimeout(r, 1500));
    s.onMsg({ type: 'event', e: { type: 'battle_end', t: 1.5 } });
    clearInterval(iv); clearTimeout(s.vcur?.timer);
    await new Promise(r => setTimeout(r, 4200)); // CaptureGuard の最短時間を越える
    await s.saveMatch({ match: 1, battle: [5, 10], squid_down: {}, own_deaths: [], own_kills: [], special: [], result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'ヒラメが丘団地', own: { ka: 1, deaths: 1, specials: 0 } }, review: { marks: {}, added: [], fix: {} } });
    window.__sess = { log, saved, queue: (s.videoQueue || []).length };
  })]);
  const ss = await page.evaluate(() => window.__sess);
  check(ss.log[0]?.startsWith('録画: 開始'), '(14) バトル開始で録画が始まり、状況が画面に出る', JSON.stringify(ss.log));
  check(ss.saved.length === 1 && /_ガチエリア_ヒラメが丘団地_勝ち\.(mp4|webm)$/.test(ss.saved[0]) && ss.queue === 0, '(15) 試合の保存で、ルール・ステージ入りの名前で保存される', ss.saved.join(','));
  check(!!dl2, '(16) 保存先が無ければダウンロードされる');
  // 2 試合続けて：2 つのファイルに分かれる（実際の順序どおり、次のバトル開始のイベントが前の試合の保存より先に届く）
  const two = await page.evaluate(async () => {
    const { Session } = window.inkgraph, saved = [], sizes = [];
    const s = new Session(document.createElement('video'), { videoSaved: r => { saved.push(r.filename); sizes.push(r.bytes); } });
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = `hsl(${n++ * 20},80%,50%)`; g.fillRect(0, 0, 160, 90); }, 50);
    s.mode = 'stream'; s.stream = c.captureStream(20); s.sessionId = new Date(2026, 9, 27, 21, 0).toISOString(); s.fast = false; s.running = true;
    const rec = (no, stage, result, t0) => ({ match: no, battle: [t0, t0 + 5], squid_down: {}, own_deaths: [], own_kills: [], special: [], result_screen: { result, mode: 'ガチエリア', stage, own: { ka: 1, deaths: 1, specials: 0 } }, review: { marks: {}, added: [], fix: {} } });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: 0 } }); await wait(1200);
    s.onMsg({ type: 'event', e: { type: 'battle_end', t: 1.2 } }); clearTimeout(s.vcur.timer); s.vcur.r.stop(); await wait(4200);
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: 100 } }); // 2 試合目の開始が先に届く
    await s.saveMatch(rec(1, 'ヒラメが丘団地', 'WIN', 0)); await wait(1200);
    s.onMsg({ type: 'event', e: { type: 'battle_end', t: 101.2 } }); clearTimeout(s.vcur.timer); await wait(4200);
    await s.saveMatch(rec(2, 'マテガイ放水路', 'LOSE', 100));
    return { saved, sizes, queue: (s.videoQueue || []).length };
  });
  check(two.saved.length === 2 && /ヒラメが丘団地_勝ち/.test(two.saved[0]) && /マテガイ放水路_負け/.test(two.saved[1]) && two.queue === 0, '(17) 2 試合続けると、試合ごとの 2 つのファイルに分かれて保存される', two.saved.join(' | '));
  // ライブ映像（キャプチャーボード）の解析を始めると、見張り・中断の検出・録画が動く
  const live = await page.evaluate(async () => {
    const { Session } = window.inkgraph, log = [];
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${n++ * 20},80%,50%)`; g.fillRect(0, 0, 320, 180); }, 40);
    navigator.mediaDevices.getUserMedia = async () => c.captureStream(25);
    const v = document.createElement('video'); document.body.appendChild(v);
    const s = new Session(v, { videoStatus: r => log.push(r.msg) });
    await s.start({ deviceId: '' });
    const watchdog = !!s._watchdogId;
    s.onMsg({ type: 'event', e: { type: 'battle_start', t: 0 } });
    const rec = !!s.vcur, inMatch = s.guard.inMatch;
    s.onMsg({ type: 'event', e: { type: 'battle_discard', t: 1 } });
    s.running = false; clearInterval(s._watchdogId); s.worker.terminate(); clearInterval(iv);
    return { watchdog, rec, inMatch, mode: s.mode, log };
  });
  check(live.watchdog && live.rec && live.inMatch && live.mode === 'device', '(18) キャプチャー映像の解析を始めると、見張り・中断の検出・録画が動く', JSON.stringify(live));
  check(!errs.length, '(13) ページエラー無し', errs.join('|'));
} finally { await browser.close(); srv.kill?.(); }
process.exit(fails ? 1 : 0);
