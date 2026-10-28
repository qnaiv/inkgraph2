// InkGraph デスクトップ版（Electron）。Web 版（../web の dist）を app:// で読み込み、次の点だけ Web 版と違う:
//  - ウィンドウが最小化・他のウィンドウに隠れても、解析と録画が止まらない（バックグラウンドの間引きを切る）
//  - 試合ごとの録画を、保存先フォルダへ直接書く（メモリに溜めない・許可の確認なし）
//  - 画面共有（getDisplayMedia）は、アプリ内の一覧からウィンドウ／画面を選ぶ（Windows はシステム音も録れる）
const { app, BrowserWindow, protocol, net, ipcMain, dialog, session, desktopCapturer, powerSaveBlocker } = require('electron');
const path = require('node:path'), fs = require('node:fs'), { pathToFileURL } = require('node:url');

// バックグラウンドの間引きを切る（ウィンドウが隠れても setTimeout・映像の取り込みを止めない）
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (process.env.INKGRAPH_USER_DATA) app.setPath('userData', process.env.INKGRAPH_USER_DATA); // テスト用
const WEB = process.env.INKGRAPH_WEB || (app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web', 'dist'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let win = null;
const settingsPath = () => path.join(app.getPath('userData'), 'desktop-settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; } };
const writeSettings = s => { try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 1)); } catch (e) { console.warn('settings write failed', e); } };
const defaultDir = () => process.env.INKGRAPH_VIDEO_DIR || path.join(app.getPath('videos'), 'InkGraph');
const videoDir = () => readSettings().videoDir || defaultDir();

/** 同じ名前があれば (2) (3) を付けて、上書きしない */
function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext); let p = path.join(dir, name), i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}
const safeName = n => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);

// ---- 録画ファイルの書き込み（録画中は一時ファイル、試合が確定したら名前を付けて移す） ----
const recs = new Map(); let recSeq = 0;
ipcMain.handle('rec:open', async () => {
  const dir = videoDir(); fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `録画中_${Date.now()}_${recSeq}.webm.part`), id = ++recSeq;
  recs.set(id, { tmp, dir, stream: fs.createWriteStream(tmp), bytes: 0 });
  return id;
});
ipcMain.handle('rec:write', (_e, id, buf) => new Promise((res, rej) => { const r = recs.get(id); if (!r) return rej(new Error('録画が開かれていません')); const b = Buffer.from(buf); r.bytes += b.length; r.stream.write(b, err => err ? rej(err) : res(r.bytes)); }));
const endStream = r => new Promise(res => r.stream.end(res));
ipcMain.handle('rec:close', async (_e, id, finalName) => {
  const r = recs.get(id); if (!r) throw new Error('録画が開かれていません'); recs.delete(id); await endStream(r);
  const dest = uniquePath(r.dir, safeName(finalName)); fs.renameSync(r.tmp, dest);
  return { path: dest, folder: path.basename(r.dir), filename: path.basename(dest), bytes: r.bytes };
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

// ---- 画面共有の選択（アプリ内の一覧） ----
let pickResolve = null;
ipcMain.on('desktop:pick-source-reply', (_e, id) => { if (pickResolve) { const f = pickResolve; pickResolve = null; f(id); } });
function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const srcs = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      const list = srcs.map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL(), screen: s.id.startsWith('screen:') }));
      const id = await new Promise(res => { pickResolve = res; win.webContents.send('desktop:pick-source', list); });
      const src = srcs.find(s => s.id === id);
      if (!src) return callback({});
      callback({ video: src, ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    } catch (e) { console.warn('display media failed', e); callback({}); }
  });
}

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
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'display-capture', 'fullscreen'].includes(perm)));
  installDisplayMediaHandler();
  powerSaveBlocker.start('prevent-display-sleep'); // 解析・録画中に画面・システムがスリープしない
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
