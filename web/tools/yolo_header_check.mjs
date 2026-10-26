// yolo_header_check.mjs: D56 結果画面の見出し（ルール・ステージ・モード）の YOLO 読み取り。純関数＋実ブラウザで yolo_stats.onnx を動かす。
// 画像: tools/fixtures/asari_x_result_720p.jpg（Xマッチ・ガチアサリ・オヒョウ海運の結果画面、v1 の参照画像を 720p に縮小したもの）
import { mergeYoloHeader, voteReads, headerFromDetections, decodeYolo, headerRect, YOLO_CLASSES } from '../src/core/yolo_header.js';
import { powerForMatchType } from '../src/core/result.js';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path'; import fs from 'node:fs';
const WEB = path.resolve(import.meta.dirname, '..'); let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };

console.log('--- 純関数 ---');
{
  const r = (rule, stage, type, c = 0.9) => ({ type, rule, stage, conf: { type: c, rule: c, stage: c } });
  check(JSON.stringify(headerRect(1280, 720)) === '[524,14,653,94]', '(1) 切り出し矩形（v1 と同じ比率）', JSON.stringify(headerRect(1280, 720)));
  const v = voteReads([r('ガチアサリ', 'オヒョウ海運', 'x'), r('ガチヤグラ', 'オヒョウ海運', 'x', 0.55), r('ガチアサリ', null, 'x', 0.8), null]);
  check(v.rule === 'ガチアサリ' && v.stage === 'オヒョウ海運' && v.type === 'x' && v.frames === 3, '(2) 複数フレームは確信度の合計で多数決');
  const dets = [{ name: 'rule_asari', conf: 0.83, cls: 18, box: [0, 0, 1, 1] }, { name: 'rule_hoko', conf: 0.6, cls: 19, box: [0, 0, 1, 1] }, { name: 'stage_ohyou', conf: 0.98, cls: 39, box: [0, 0, 1, 1] }, { name: 'mode_x', conf: 0.95, cls: 16, box: [0, 0, 1, 1] }];
  const h = headerFromDetections(dets); check(h.rule === 'ガチアサリ' && h.stage === 'オヒョウ海運' && h.type === 'x' && headerFromDetections([{ name: 'digit_1', conf: 0.9 }]) === null, '(3) グループごとに最高確信度を採る');
  // マージ：テンプレートで読めなかった項目だけ埋め、食い違いは直さず記録する
  const rec = { result_screen: { mode: null, stage: null, mode_unknown: true, mode_guess: 'ガチホコバトル' }, match_type: null };
  const filled = mergeYoloHeader(rec, [r('ガチアサリ', 'オヒョウ海運', 'x')], powerForMatchType);
  check(rec.result_screen.mode === 'ガチアサリ' && rec.result_screen.mode_source === 'yolo' && rec.result_screen.mode_unknown === undefined && rec.result_screen.stage === 'オヒョウ海運' && rec.match_type === 'x' && rec.power.status === 'not_shown' && filled.length === 3, '(4) テンプレートが null の項目を YOLO で埋める（mode・stage・match_type）', JSON.stringify(filled));
  const rec2 = { result_screen: { mode: 'ガチヤグラ', stage: 'クサヤ温泉' }, match_type: 'bankara_open' };
  const f2 = mergeYoloHeader(rec2, [r('ガチホコバトル', 'クサヤ温泉', 'x')], powerForMatchType);
  check(!f2.length && rec2.result_screen.mode === 'ガチヤグラ' && rec2.match_type === 'bankara_open' && rec2.result_screen.yolo_disagree.mode.yolo === 'ガチホコバトル' && rec2.result_screen.yolo_disagree.match_type.yolo === 'x' && !rec2.result_screen.yolo_disagree.stage, '(5) テンプレートで読めている項目は直さず、食い違いだけ記録する');
  check(mergeYoloHeader({ result_screen: {} }, [], powerForMatchType).length === 0, '(6) 読み取りが無ければ何もしない');
}

console.log('--- 実ブラウザ（yolo_stats.onnx を onnxruntime-web で実行） ---');
const PORT = process.env.PORT || '4311';
const srv = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { cwd: WEB, stdio: 'ignore', detached: true });
const killSrv = () => { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* ignore */ } }; process.on('exit', killSrv);
await new Promise(r => setTimeout(r, 4000));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForTimeout(500);
  const b64 = fs.readFileSync(path.join(WEB, 'tools/fixtures/asari_x_result_720p.jpg')).toString('base64');
  const runIt = b64 => page.evaluate(async b64 => {
    const Y = await import('/src/yolo_runner.js'); const H = await import('/src/core/yolo_header.js');
    Y.configureYolo(new URL('/public/assets/', location.href).href.replace('/public/', '/'));
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, 1280, 720); const fr = { w: 1280, h: 720, data: d.data };
    const t0 = performance.now(); const chw = H.preprocessHeader(fr); const t1 = performance.now(); const r = await Y.readHeaderTensor(chw); const t2 = performance.now();
    const r2 = await Y.readHeaderTensor(chw); const t3 = performance.now();
    return { r, pre: Math.round(t1 - t0), first: Math.round(t2 - t1), second: Math.round(t3 - t2), again: r2 };
  }, b64);
  // Vite の開発サーバーは、初めて依存（onnxruntime-web）を取り込むときにページを 1 回再読み込みする
  let res; for (let i = 0; i < 4 && !res; i++) { try { res = await runIt(b64); } catch (e) { if (!/context was destroyed|navigation/.test(String(e))) throw e; await page.waitForLoadState('load'); await page.waitForTimeout(1500); } }
  console.log('result:', JSON.stringify(res));
  check(res.r && res.r.rule === 'ガチアサリ' && res.r.stage === 'オヒョウ海運' && res.r.type === 'x', '(7) 実画像: ガチアサリ・オヒョウ海運・Xマッチを読めた（テンプレートに見本の無いルール）', JSON.stringify(res.r));
  check(res.r && res.r.conf.rule >= 0.5 && res.r.conf.stage >= 0.9, '(8) 確信度（ルール≧0.5、ステージ≧0.9）', JSON.stringify(res.r && res.r.conf));
  check(JSON.stringify(res.again) === JSON.stringify(res.r), '(9) 2 回目（セッション再利用）も同じ結果', `前処理 ${res.pre}ms／初回 ${res.first}ms／2回目 ${res.second}ms`);
  check(res.second < 3000, '(10) 1 回の推論が 3 秒未満（解析中の裏で動かす用途）', `${res.second}ms`);
  check(errs.length === 0, '(11) ページエラーなし', errs.slice(0, 3).join('|'));
  // 本番と同じ Worker（ビルド済み dist）の中でも動くこと（WASM の取得先・単一スレッド・モジュール Worker）
  killSrv(); await new Promise(r => setTimeout(r, 500));
  const prev = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { cwd: WEB, stdio: 'ignore', detached: true }); const killPrev = () => { try { process.kill(-prev.pid, 'SIGTERM'); } catch { /* ignore */ } }; process.on('exit', killPrev);
  await new Promise(r => setTimeout(r, 2500));
  try {
    const p2 = await browser.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message)); p2.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) e2.push(`${r.status()} ${r.url()}`); });
    await p2.goto(`http://127.0.0.1:${PORT}/`); await p2.waitForTimeout(500);
    const wres = await p2.evaluate(async b64 => {
      const html = await (await fetch('/')).text(); const idx = await (await fetch(html.match(/src="([^"]*index-[^"]*\.js)"/)[1])).text();
      const url = new URL('assets/' + idx.match(/worker-[A-Za-z0-9_-]+\.js/)[0], location.href).href;
      const w = new Worker(url, { type: 'module' }); const wait = t => new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('timeout ' + t)), 60000); w.addEventListener('message', function f(e) { if (e.data.type === t) { clearTimeout(to); w.removeEventListener('message', f); res(e.data); } }); });
      const rd = wait('ready'); w.postMessage({ type: 'init', assetsUrl: new URL('assets/inkgraph_assets.json', location.href).href, srcH: 720 }); await rd;
      const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const buf = x.getImageData(0, 0, 1280, 720).data.buffer; const rp = wait('yolo_header'); w.postMessage({ type: 'yolo_header', w: 1280, h: 720, buf }, [buf]); const r = await rp; w.terminate(); return r.r;
    }, b64);
    check(wres && wres.rule === 'ガチアサリ' && wres.stage === 'オヒョウ海運' && wres.type === 'x', '(12) ビルド済みの Worker の中でも同じ結果（本番と同じ経路）', JSON.stringify(wres));
    check(e2.length === 0, '(13) Worker 経路でページエラー・404 なし', e2.slice(0, 3).join('|'));
  } finally { killPrev(); }
} finally { await browser.close(); killSrv(); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
