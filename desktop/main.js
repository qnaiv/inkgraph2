// InkGraph デスクトップ版（Electron）。Web 版（../web の dist）を app:// で読み込み、次の点だけ Web 版と違う:
//  - ウィンドウが最小化・他のウィンドウに隠れても、解析と録画が止まらない（バックグラウンドの間引きを切る）
//  - 試合ごとの録画を、保存先フォルダへ直接書く（メモリに溜めない・許可の確認なし）
const { app, BrowserWindow, protocol, net, ipcMain, dialog, session, powerSaveBlocker } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs'), { pathToFileURL } = require('node:url'), { Readable } = require('node:stream');

// バックグラウンドの間引きを切る（ウィンドウが隠れても setTimeout・映像の取り込みを止めない）
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (process.env.INKGRAPH_USER_DATA) app.setPath('userData', process.env.INKGRAPH_USER_DATA); // テスト用
const WEB = process.env.INKGRAPH_WEB || (app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web', 'dist'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm' };
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'rec', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } } // 録画ファイルの再生（シーク用に Range を通す）
]);

let win = null;
const settingsPath = () => path.join(app.getPath('userData'), 'desktop-settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; } };
const writeSettings = s => { try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 1)); } catch (e) { console.warn('settings write failed', e); } };
// 録画を保存したことのあるフォルダ（レビュー画面で録画を再生してよいフォルダ。ここに無いフォルダのファイルは配らない）
const knownDirs = () => new Set([...(readSettings().knownDirs || []), videoDir()].map(d => path.resolve(d)));
const addKnownDir = d => { const st = readSettings(), set = new Set((st.knownDirs || []).map(x => path.resolve(x))); set.add(path.resolve(d)); writeSettings({ ...st, knownDirs: [...set] }); };
const defaultDir = () => process.env.INKGRAPH_VIDEO_DIR || path.join(app.getPath('videos'), 'InkGraph');
const videoDir = () => readSettings().videoDir || defaultDir();

/** 同じ名前があれば (2) (3) を付けて、上書きしない */
function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext); let p = path.join(dir, name), i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}
const safeName = n => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);

// ---- 録画を、どのプレーヤーでもシークできる普通の MP4 にする（MediaRecorder の MP4 は断片化していて、シーク用の索引が無い）。ffmpeg（同梱）で、再エンコードせずに詰め替える ----
function ffmpegPath() { try { const p = process.env.INKGRAPH_FFMPEG || require('ffmpeg-static'); return p ? String(p).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/') : null; } catch { return null; } }
function remux(inp, out, ext) {
  return new Promise(res => {
    const ff = ffmpegPath(); if (!ff) return res(false);
    const args = ['-y', '-loglevel', 'error', '-fflags', '+genpts', '-i', inp, '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...(ext === '.mp4' ? ['-movflags', '+faststart', '-f', 'mp4'] : ['-f', 'webm']), out];
    let done = false; const fin = ok => { if (!done) { done = true; res(ok); } };
    try { const p = spawn(ff, args, { windowsHide: true, stdio: 'ignore' }); p.on('error', () => fin(false)); p.on('close', code => fin(code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0)); } catch { fin(false); }
  });
}

// ---- 録画ファイルの書き込み（録画中は一時ファイル、試合が確定したら名前を付けて移す） ----
const recs = new Map(); let recSeq = 0;
ipcMain.handle('rec:open', async () => {
  const dir = videoDir(); fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `録画中_${Date.now()}_${recSeq}.webm.part`), id = ++recSeq;
  recs.set(id, { tmp, dir, stream: fs.createWriteStream(tmp), bytes: 0 }); addKnownDir(dir);
  return id;
});
ipcMain.handle('rec:write', (_e, id, buf) => new Promise((res, rej) => { const r = recs.get(id); if (!r) return rej(new Error('録画が開かれていません')); const b = Buffer.from(buf); r.bytes += b.length; r.stream.write(b, err => err ? rej(err) : res(r.bytes)); }));
const endStream = r => new Promise(res => r.stream.end(res));
ipcMain.handle('rec:close', async (_e, id, finalName) => {
  const r = recs.get(id); if (!r) throw new Error('録画が開かれていません'); recs.delete(id); await endStream(r);
  const name = safeName(finalName), ext = path.extname(name).toLowerCase(), dest = uniquePath(r.dir, name), conv = dest + '.converting';
  let remuxed = false;
  if (await remux(r.tmp, conv, ext)) { try { fs.renameSync(conv, dest); fs.unlinkSync(r.tmp); remuxed = true; } catch { /* 下で元のファイルを使う */ } }
  if (!remuxed) { try { fs.unlinkSync(conv); } catch { /* ignore */ } fs.renameSync(r.tmp, dest); }
  return { path: dest, folder: path.basename(r.dir), filename: path.basename(dest), bytes: fs.statSync(dest).size, remuxed };
});
// 以前の録画（断片化したまま）を、シークできる形式に直す。許可したフォルダの .mp4/.webm だけ
ipcMain.handle('rec:repair', async (_e, file) => {
  const f = path.resolve(String(file)), ext = path.extname(f).toLowerCase();
  if (!/\.(mp4|webm)$/i.test(f) || !knownDirs().has(path.dirname(f)) || !fs.existsSync(f)) return { ok: false, reason: 'not-found' };
  const out = f + '.converting';
  if (!(await remux(f, out, ext))) { try { fs.unlinkSync(out); } catch { /* ignore */ } return { ok: false, reason: ffmpegPath() ? 'ffmpeg-failed' : 'no-ffmpeg' }; }
  fs.renameSync(out, f); return { ok: true, bytes: fs.statSync(f).size };
});
ipcMain.handle('rec:discard', async (_e, id) => { const r = recs.get(id); if (!r) return; recs.delete(id); await endStream(r); try { fs.unlinkSync(r.tmp); } catch { /* ignore */ } });
ipcMain.handle('desktop:get-dir', () => ({ dir: videoDir(), custom: !!readSettings().videoDir }));
ipcMain.handle('desktop:pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: '録画の保存先フォルダ', defaultPath: videoDir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  writeSettings({ ...readSettings(), videoDir: r.filePaths[0] }); return r.filePaths[0];
});
ipcMain.handle('desktop:open-dir', () => { const d = videoDir(); fs.mkdirSync(d, { recursive: true }); return require('electron').shell.openPath(d); });
// ウィンドウ状態（テスト・診断用）
ipcMain.handle('desktop:window', (_e, cmd) => { if (!win) return null; if (cmd === 'hide') win.hide(); else if (cmd === 'minimize') win.minimize(); else if (cmd === 'show') win.show(); else if (cmd === 'restore') win.restore(); return { visible: win.isVisible(), minimized: win.isMinimized() }; });

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, title: 'InkGraph', backgroundColor: '#0f1020',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setMenuBarVisibility(false);
  win.loadURL('app://inkgraph/index.html');
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const u = new URL(req.url); let rel = decodeURIComponent(u.pathname); if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(path.normalize(WEB)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).then(r => new Response(r.body, { status: r.status, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } }));
  });
  // rec://local/<フルパス> … 録画ファイルの再生。許可したフォルダ内の .mp4/.webm だけ。シークのため Range（206）を自前で返す
  protocol.handle('rec', req => {
    try {
      const file = path.resolve(decodeURIComponent(new URL(req.url).pathname.slice(1)));
      if (!/\.(mp4|webm)$/i.test(file) || !knownDirs().has(path.dirname(file)) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
      const size = fs.statSync(file).size, type = MIME[path.extname(file).toLowerCase()] || (/\.webm$/i.test(file) ? 'video/webm' : 'video/mp4');
      const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes' }, range = req.headers.get('range'), m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === '' && m[2] === '')) return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(size) } });
      let start = m[1] === '' ? Math.max(0, size - parseInt(m[2], 10)) : parseInt(m[1], 10), end = m[1] !== '' && m[2] !== '' ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      if (!(start < size) || start > end) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } });
    } catch { return new Response('bad request', { status: 400 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'fullscreen'].includes(perm)));
  powerSaveBlocker.start('prevent-display-sleep'); // 解析・録画中に画面・システムがスリープしない
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
