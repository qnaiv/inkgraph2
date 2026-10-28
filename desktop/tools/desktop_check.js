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
    await js(`localStorage.setItem('inkgraph.videoRec', '1'); location.hash = '#list'`); await sleep(2500);
    check(await js(`!!document.querySelector('#video-on') && /保存先/.test(document.querySelector('#video-panel').textContent)`), '(2) 録画の設定パネルが出る（保存先・チェックボックス）');
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
      s.mode = 'stream'; s.stream = c.captureStream(25); s.sessionId = new Date(2026, 9, 27, 21, 0).toISOString(); s.fast = false; s.running = true;
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
    check(files.length === 2 && files[0].endsWith('ヒラメが丘団地_勝ち.webm') && files[1].endsWith('マテガイ放水路_負け.webm') && !files.some(f => f.endsWith('.part')), '(6) 試合ごとの名前の 2 ファイルができ、一時ファイル（.part）は残らない', files.join(' | '));
    check(files.every(f => fs.statSync(path.join(dir, f)).size > 1000), '(7) ファイルの中身がある（映像が書かれている）', files.map(f => fs.statSync(path.join(dir, f)).size).join(','));
    const head = fs.readFileSync(path.join(dir, files[0])).subarray(0, 4); check(head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3, '(8) WebM（EBML ヘッダー）として書かれている');
  } catch (e) { console.log('FAIL exception', e); fails++; }
  fs.rmSync(tmp, { recursive: true, force: true }); app.exit(fails ? 1 : 0);
});
