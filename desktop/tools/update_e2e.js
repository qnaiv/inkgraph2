// update_e2e.js: 自動アップデートを、実際の Electron で通しで確かめる（手動用）。
// 使い方: latest.yml と新しい版のインストーラーを置いた場所を、簡易 HTTP サーバーで配り、
//   INKGRAPH_UPDATE_FEED=http://127.0.0.1:8123/ npx electron --no-sandbox tools/update_e2e.js
// 開発起動の版（package.json の version）より新しい版が置いてあれば、検出→ダウンロード→ready→画面右下の通知まで進むことを確かめる。
// 入れ替え（quitAndInstall）は、インストールした版でしか試せないので、ここでは押さない。
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const feed = process.env.INKGRAPH_UPDATE_FEED; if (!feed) { console.log('INKGRAPH_UPDATE_FEED を指定してください'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-upd-'));
process.env.INKGRAPH_USER_DATA = path.join(tmp, 'ud'); process.env.INKGRAPH_VIDEO_DIR = path.join(tmp, 'videos');
process.env.INKGRAPH_UPDATE_TEST_URL = feed; process.env.INKGRAPH_UPDATE_TEST_VERSION = process.env.INKGRAPH_UPDATE_TEST_VERSION || '0.1.0'; process.env.INKGRAPH_UPDATE_FAST = '1';
const { app, BrowserWindow } = require('electron');
// 開発起動のダウンロードは dev-app-update.yml（キャッシュの置き場）を読む。テスト用に一時フォルダへ置く
fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(path.join(tmp, 'dev-app-update.yml'), `provider: generic
url: ${feed}
updaterCacheDirName: inkgraph-e2e-updater
`); app.getAppPath = () => tmp;
require('../main.js');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    await sleep(3000); const w = BrowserWindow.getAllWindows()[0], js = c => w.webContents.executeJavaScript(c, true);
    check(await js(`!!window.inkgraphDesktop && typeof window.inkgraphDesktop.getUpdateState === 'function'`), '(1) デスクトップ版として開き、更新の口がある');
    const seen = []; let st = null; const t0 = Date.now();
    while (Date.now() - t0 < 180000) { st = await js(`window.inkgraphDesktop.getUpdateState()`); if (!seen.length || seen[seen.length - 1] !== st.status) seen.push(st.status); if (st.status === 'ready' || st.status === 'error') break; await sleep(500); }
    check(st && st.status === 'ready', '(2) 新しい版を検出し、ダウンロードして ready になる', `${seen.join('→')} ${JSON.stringify(st)}`);
    await sleep(1500);
    check(await js(`!!document.querySelector('#update-banner') && /再起動して更新/.test(document.querySelector('#update-install')?.textContent || '')`), '(3) 画面右下に「再起動して更新」の通知が出る');
    await js(`document.querySelector('#update-later')?.click()`); await sleep(300);
    check(await js(`!document.querySelector('#update-banner')`), '(4) 「あとで」で通知が消える');
    await js(`location.hash = '#settings'`); await sleep(1500);
    const txt = await js(`document.querySelector('#update-msg')?.textContent || ''`);
    check(/準備ができました/.test(txt), '(5) 設定画面の「更新を確認」欄に、状態が出る', txt);
  } catch (e) { check(false, '例外', String(e && e.stack || e)); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); app.exit(fails ? 1 : 0);
});
