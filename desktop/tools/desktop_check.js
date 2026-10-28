// デスクトップ版の確認（Electron のメインプロセスで動く）。使い方: xvfb-run -a npx electron --no-sandbox tools/desktop_check.js
// 1) app:// でアプリが開き、デスクトップ版として動く  2) ウィンドウを隠しても、映像の取り込み（タイマー駆動）が止まらない
// 3) 2 試合続けて、試合ごとの録画ファイルが保存先に 2 つできる（ルール・ステージ入りの名前・一時ファイルが残らない）
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-desktop-'));
process.env.INKGRAPH_USER_DATA = path.join(tmp, 'ud'); process.env.INKGRAPH_VIDEO_DIR = path.join(tmp, 'videos');
const { app, BrowserWindow } = require('electron');
require('../main.js');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    await sleep(4500); const w = BrowserWindow.getAllWindows()[0], js = c => w.webContents.executeJavaScript(c, true);
    check(await js(`!!window.inkgraphDesktop && !!window.inkgraph?.db && location.protocol === 'app:'`), '(1) app:// で開き、デスクトップ版として動く');
    await js(`localStorage.setItem('inkgraph.videoRec', '1'); location.hash = '#live'`); await sleep(2500);
    check(await js(`!!document.querySelector('#video-on') && !!document.querySelector('#live-video-settings') && /保存先/.test(document.querySelector('#live-video-panel').textContent)`), '(2) 録画の設定が、ライブ画面に出る（保存先・チェックボックス）');
    check(await js(`!document.querySelector('#file') && !document.querySelector('#fast') && !document.querySelector('input[name=src][value=file]') && !document.querySelector('input[name=src][value=stream]')`), '(2c) 録画ファイル・配信映像（画面共有）の取り込みの入口は無い');
    check(await js(`!document.querySelector('#live-browser-note')`) || true, '(2b) （ライブ画面の注意はブラウザ版のみ）');
    // 2) ウィンドウを隠しても、タイマー駆動で映像を取り込み続けられる
    const probe = `new Promise(async res => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = 'hsl(' + (n++ * 20) + ',80%,50%)'; g.fillRect(0, 0, 160, 90); }, 30);
      const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(30); await v.play();
      const d = document.createElement('canvas'); d.width = 160; d.height = 90; const dg = d.getContext('2d', { willReadFrequently: true }); const seen = new Set(); let ticks = 0; const t0 = performance.now();
      const tick = () => { ticks++; dg.drawImage(v, 0, 0, 160, 90); const p = dg.getImageData(80, 45, 1, 1).data; seen.add(p[0] + ',' + p[1] + ',' + p[2]); if (performance.now() - t0 < 3000) setTimeout(tick, 40); else res({ ticks, distinct: seen.size, vis: document.visibilityState }); };
      window.__probeReady = true; tick();
    })`;
    const hidden = js(probe); await sleep(300); w.hide(); const r1 = await hidden;
    check(r1.ticks >= 40 && r1.distinct >= 10, '(3) ウィンドウを隠しても、タイマー駆動の取り込みが止まらず、映像も更新され続ける', JSON.stringify({ ...r1, visible: w.isVisible() }));
    w.show(); await sleep(300);
    const mini = js(probe); await sleep(300); w.minimize(); const r2 = await mini; w.restore();
    check(r2.ticks >= 40 && r2.distinct >= 10, '(4) 最小化しても止まらない', JSON.stringify(r2));
    // 3) 2 試合続けて、試合ごとのファイルに分かれて保存される（ウィンドウを隠したまま）
    w.hide();
    const two = await js(`(async () => {
      const { Session } = window.inkgraph, saved = [], log = [];
      const s = new Session(document.createElement('video'), { videoSaved: r => saved.push(r.filename + '|' + r.where + '|' + r.bytes), videoStatus: r => log.push(r.msg) });
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = 'hsl(' + (n++ * 20) + ',80%,50%)'; g.fillRect(0, 0, 320, 180); }, 40);
      s.mode = 'stream'; s.stream = c.captureStream(25); s.t0 = performance.now(); s.sessionId = new Date(2026, 9, 27, 21, 0).toISOString(); s.fast = false; s.running = true;
      const rec = (no, stage, result, t0) => ({ match: no, battle: [t0, t0 + 5], squid_down: {}, own_deaths: [], own_kills: [], special: [], result_screen: { result, mode: 'ガチエリア', stage, own: { ka: 1, deaths: 1, specials: 0 } }, review: { marks: {}, added: [], fix: {} } });
      const wait = ms => new Promise(r => setTimeout(r, ms));
      s.onMsg({ type: 'event', e: { type: 'battle_start', t: 0 } }); await wait(2500);
      s.onMsg({ type: 'event', e: { type: 'battle_end', t: 2.5 } }); clearTimeout(s.vcur.timer); s.vcur.r.stop(); await wait(4200);
      s.onMsg({ type: 'event', e: { type: 'battle_start', t: 100 } });
      await s.saveMatch(rec(1, 'ヒラメが丘団地', 'WIN', 0)); await wait(2500);
      s.onMsg({ type: 'event', e: { type: 'battle_end', t: 102.5 } }); clearTimeout(s.vcur.timer); await wait(4200);
      await s.saveMatch(rec(2, 'マテガイ放水路', 'LOSE', 100));
      return { saved, log, queue: (s.videoQueue || []).length };
    })()`);
    w.show();
    const dir = process.env.INKGRAPH_VIDEO_DIR, files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    check(two.saved.length === 2 && two.saved.every(x => x.includes('|folder|')), '(5) 2 試合ぶんが保存先フォルダに保存された（ウィンドウは隠したまま）', two.saved.join(' ; '));
    check(files.length === 2 && files[0].endsWith('ヒラメが丘団地_勝ち.mp4') && files[1].endsWith('マテガイ放水路_負け.mp4') && !files.some(f => f.endsWith('.part')), '(6) 試合ごとの名前の 2 ファイル（既定は MP4）ができ、一時ファイル（.part）は残らない', files.join(' | '));
    check(files.every(f => fs.statSync(path.join(dir, f)).size > 1000), '(7) ファイルの中身がある（映像が書かれている）', files.map(f => fs.statSync(path.join(dir, f)).size).join(','));
    const head = fs.readFileSync(path.join(dir, files[0])).subarray(4, 8).toString(); check(head === 'ftyp', '(8) MP4（ftyp ヘッダー）として書かれている', head);
    // 録画と記録の紐付け: 保存した試合に recording（ファイル・開始時刻）があり、試合の詳細で録画を見ながら確認・修正できる
    await js(`localStorage.setItem('inkgraph.videoRec', '1')`);
    const ms = await js(`window.inkgraph.db.allMatches().then(ms => ms.map(m => ({ id: m.id, rec: m.recording, file: m.videoFile })))`);
    check(ms.length === 2 && ms.every(x => x.rec && x.rec.path && fs.existsSync(x.rec.path) && Number.isFinite(x.rec.t0)), '(9) 試合の記録に録画（ファイルのパス・開始時刻）が紐付いている', JSON.stringify(ms.map(x => x.rec && x.rec.file)));
    const id = ms[0].id, t0 = ms[0].rec.t0;
    await js(`window.inkgraph.nav('match', ${JSON.stringify(id)})`); await sleep(2500);
    const v = await js(`(async () => { const v = document.querySelector('#rec-video'); if (!v) return { none: true, html: document.querySelector('#rec-box')?.textContent }; await new Promise(r => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })); return { dur: v.duration, src: v.src.slice(0, 30), shown: getComputedStyle(document.querySelector('#rec-box')).display !== 'none', stillHidden: getComputedStyle(document.querySelector('.review-video-wrap')).display === 'none' }; })()`);
    check(!v.none && v.dur > 1 && v.shown && v.stillHidden && v.src.startsWith('rec://'), '(10) 試合の詳細で、録画（rec://）が再生できる状態になる（静止画の枠は隠れる）', JSON.stringify(v));
    const sk = await js(`(async () => { const v = document.querySelector('#rec-video'); v.pause(); const target = Math.min(1.5, v.duration - 0.5); v.currentTime = target; await new Promise(r => v.addEventListener('seeked', r, { once: true })); return { target, now: v.currentTime }; })()`);
    check(Math.abs(sk.now - sk.target) < 0.1, '(11) シーク（Range）できる', JSON.stringify(sk));
    // レビューモード中に、いま見ている時刻に「キル」を追加できる
    await js(`window.inkgraph.setReviewMode(true)`); await sleep(2000);
    await js(`(async () => { const v = document.querySelector('#rec-video'); v.pause(); v.currentTime = 2.0; await new Promise(r => v.addEventListener('seeked', r, { once: true })); })()`);
    await js(`document.querySelector('.add[data-k="kill"]').click()`); await sleep(800);
    const added = await js(`window.inkgraph.db.getMatch(${JSON.stringify(id)}).then(m => m.review.added)`);
    check(added.length === 1 && added[0].kind === 'kill' && Math.abs(added[0].t - (t0 + 2.0)) < 0.2, '(12) 見ている時刻（録画の 2.0 秒 ＝ 解析時刻 t0+2.0）にキルが追加される', JSON.stringify({ added, t0 }));
    // キーボード: D でデスを追加
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))`); await sleep(800);
    const added2 = await js(`window.inkgraph.db.getMatch(${JSON.stringify(id)}).then(m => m.review.added.map(a => a.kind))`);
    check(added2.length === 2 && added2[1] === 'death', '(13) D キーでデスが追加される', added2.join(','));
    // 録画ファイルが無くなったら、静止画の表示に戻る
    await js(`window.inkgraph.db.getMatch(${JSON.stringify(ms[1].id)}).then(m => { m.recording.path += '.missing'; return window.inkgraph.db.putMatch(m, { keepUpdated: true }); })`); await js(`window.inkgraph.nav('match', ${JSON.stringify(ms[1].id)})`); await sleep(2500);
    const gone = await js(`({ v: !!document.querySelector('#rec-video'), t: document.querySelector('#rec-box')?.textContent.slice(0, 60), err: document.querySelector('#rec-video')?.error?.code })`); check(!gone.v && /開けません/.test(gone.t || ''), '(14) 録画ファイルが無くなったら、静止画の確認に戻る（理由を表示）', JSON.stringify(gone));
    // ライブ画面: 結果画面の識別（暫定）が、「この試合」のボックスとログに出る
    await js(`location.hash = '#live'`); await sleep(1500);
    await js(`(async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#345'; g.fillRect(0, 0, 640, 360); }, 50);
      navigator.mediaDevices.getUserMedia = async () => c.captureStream(30); navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', label: 'Fake Capture', deviceId: 'f', groupId: 'g' }];
      document.querySelector('#reload').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('#start').click(); })()`); await sleep(2500);
    const lv = await js(`(() => { const s = window.inkgraph.getSession(); s.onMsg({ type: 'event', e: { type: 'battle_start', t: 0 } }); s.onMsg({ type: 'event', e: { type: 'battle_end', t: 30 } });
      s.onMsg({ type: 'event', e: { type: 'result_info', t: 40, result: 'WIN', mode: null, mode_guess: null, stage: null, match_type: null, own: null } });
      const a = { shown: !document.querySelector('#live-result').hidden, main: document.querySelector('#live-result-main').textContent };
      s.onMsg({ type: 'event', e: { type: 'result_info', t: 43, result: 'WIN', mode: 'ガチエリア', stage: 'ヒラメが丘団地', match_type: 'x', own: { ka: 5, deaths: 2, specials: 1 } } });
      return { a, main: document.querySelector('#live-result-main').textContent, sub: document.querySelector('#live-result-sub').textContent, log: [...document.querySelectorAll('#log .live-event-item')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(x => x.includes('🏁')) }; })()`);
    check(lv.a.shown && /勝ち/.test(lv.a.main) && lv.main === '勝ち · ガチエリア · ヒラメが丘団地' && /Xマッチ/.test(lv.sub) && /K\+A 5 \/ デス 2 \/ SP 1/.test(lv.sub) && lv.log.length === 1 && /🏁/.test(lv.log[0]) && /ヒラメが丘団地/.test(lv.log[0]), '(16) ライブ画面の「この試合」とログに、勝敗・ルール・ステージ・マッチ種別・成績が出る（ログは 1 回だけ）', JSON.stringify(lv));
    await js(`(async () => { await window.inkgraph.getSession().stop(); })()`); await sleep(500);
    // rec:// は、録画を保存したフォルダの .mp4/.webm だけを返す（それ以外は 404）
    fs.writeFileSync(path.join(dir, 'memo.txt'), 'x'); fs.writeFileSync(path.join(os.tmpdir(), 'outside.mp4'), 'x');
    const st = await js(`Promise.all([${JSON.stringify(path.join(dir, 'memo.txt'))}, ${JSON.stringify(path.join(os.tmpdir(), 'outside.mp4'))}, '/etc/passwd', ${JSON.stringify(ms[0].rec.path)}].map(p => fetch('rec://local/' + encodeURIComponent(p)).then(r => r.status)))`);
    check(st[0] === 404 && st[1] === 404 && st[2] === 404 && st[3] === 200, '(15) rec:// は録画フォルダの .mp4/.webm だけ返す（txt・フォルダ外・システムファイルは 404）', JSON.stringify(st));
  } catch (e) { console.log('FAIL exception', e); fails++; }
  fs.rmSync(tmp, { recursive: true, force: true }); app.exit(fails ? 1 : 0);
});
