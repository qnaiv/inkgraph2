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
  await page.evaluate(() => localStorage.removeItem('inkgraph.videoRec'));
  await page.goto(`http://127.0.0.1:${PORT}/#live`); await page.goto(`http://127.0.0.1:${PORT}/#list`); await page.waitForSelector('#video-on');
  check(!(await page.isChecked('#video-on')) && /未設定/.test(await page.textContent('#video-dir')), '(5) パネル: 既定はオフ・保存先は未設定');
  await page.check('#video-on'); check(await page.evaluate(() => window.inkgraph.VR.getVideoOn()), '(6) オンの設定が保存される');
  // canvas の映像を録って、Blob になる・ダウンロード保存される
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${n++ * 20},80%,50%)`; g.fillRect(0, 0, 320, 180); }, 50);
    const rec = new window.inkgraph.VR.MatchRecorder(c.captureStream(20)).start(); await new Promise(r => setTimeout(r, 1500)); const blob = await rec.stop(); clearInterval(iv);
    window.__blob = blob; return { size: blob.size, type: blob.type };
  });
  check(r.size > 500 && /webm/.test(r.type), '(7) MediaRecorder で WebM の Blob ができる', JSON.stringify(r));
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
  await page.reload(); await page.waitForSelector('#video-audio'); await page.check('#video-audio');
  check(await page.evaluate(() => window.inkgraph.VR.getAudioOn()), '(10) 「ゲーム音も録音する」の設定が保存される');
  check(!errs.length, '(11) ページエラー無し', errs.join('|'));
} finally { await browser.close(); srv.kill?.(); }
process.exit(fails ? 1 : 0);
