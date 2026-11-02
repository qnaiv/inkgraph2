// updater_check.js: 自動アップデートの約束（updater.js）を、偽の autoUpdater で確かめる。Electron 不要。使い方: node tools/updater_check.js
// 録画中は確認・ダウンロード・通知・再起動をしない／押されたときだけ再起動する／開発起動では何もしない
const EventEmitter = require('node:events');
const { createUpdater } = require('../updater.js');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fake = ({ available = '0.1.9' } = {}) => {
  const u = new EventEmitter(); u.calls = { check: 0, download: 0, install: 0 };
  u.checkForUpdates = async () => { u.calls.check++; u.emit('checking-for-update'); if (available) u.emit('update-available', { version: available }); else u.emit('update-not-available', {}); };
  u.downloadUpdate = async () => { u.calls.download++; u.emit('download-progress', { percent: 50 }); u.emit('update-downloaded', { version: available }); };
  u.quitAndInstall = () => { u.calls.install++; };
  return u;
};
(async () => {
  { // 1) 録画していなければ、確認→ダウンロード→ready まで進み、通知が飛ぶ
    const au = fake(), sent = []; let rec = false;
    const up = createUpdater({ autoUpdater: au, isRecording: () => rec, send: s => sent.push(s.status) });
    check(au.autoDownload === false && au.autoInstallOnAppQuit === true, '(1) autoDownload は自分で決める／押されなくても終了時に入れ替わる');
    await up.check(false); await sleep(10);
    check(up.getState().status === 'ready' && up.getState().version === '0.1.9', '(2) 録画していなければ、確認→ダウンロード→ready まで進む', JSON.stringify(up.getState()));
    check(sent.includes('ready'), '(3) ready になったら通知（web へ送る）が飛ぶ', sent.join());
    check(up.install().ok === true && au.calls.install === 1, '(4) install で再起動して入れ替える');
  }
  { // 2) 録画中は、確認も再起動もしない。通知もしない
    const au = fake(), sent = []; let rec = true;
    const up = createUpdater({ autoUpdater: au, isRecording: () => rec, send: s => sent.push(s.status) });
    const r = await up.check(false);
    check(r.ok === false && r.reason === 'recording' && au.calls.check === 0, '(5) 録画中は、確認しない（手動でも）', JSON.stringify(r));
    rec = false; await up.check(false); await sleep(10); rec = true;
    const r2 = up.install();
    check(r2.ok === false && r2.reason === 'recording' && au.calls.install === 0, '(6) 録画中は、ダウンロード済みでも再起動しない', JSON.stringify(r2));
    const n = sent.length; await sleep(20);
    check(sent.length === n, '(7) 録画中は通知を送らない（録画中に始まった変化は止める）');
  }
  { // 3) 確認の途中で録画が始まったら、ダウンロードは録画が終わるまで待つ。見回り（tick）で再開
    const au = fake(), sent = []; let rec = false;
    au.checkForUpdates = async () => { au.calls.check++; rec = true; au.emit('checking-for-update'); au.emit('update-available', { version: '0.1.10' }); };
    const up = createUpdater({ autoUpdater: au, isRecording: () => rec, send: s => sent.push(s.status), tickMs: 20 });
    up.start(); await up.check(false); await sleep(60);
    check(au.calls.download === 0 && up.getState().status === 'available', '(8) 録画中にダウンロードは始めない（見つかっただけ）', JSON.stringify(up.getState()));
    rec = false; await sleep(80);
    check(au.calls.download === 1 && up.getState().status === 'ready' && sent.includes('ready'), '(9) 録画が終わったら、ダウンロードを進めて通知する', JSON.stringify(up.getState()));
    up.stop();
  }
  { // 4) 更新なし／手動のときは更新なしも返す／エラーは状態に残る
    const au = fake({ available: null }), sent = [];
    const up = createUpdater({ autoUpdater: au, send: s => sent.push(s.status) });
    await up.check(true);
    check(up.getState().status === 'none' && sent.includes('none'), '(10) 更新が無ければ none（手動の確認には結果を返す）');
    const au2 = fake(); au2.checkForUpdates = async () => { throw new Error('net down'); };
    const up2 = createUpdater({ autoUpdater: au2 }); await up2.check(true);
    check(up2.getState().status === 'error' && /net down/.test(up2.getState().message), '(11) 確認に失敗したら error とその理由が残る');
    check(up.install().reason === 'not-ready', '(12) ダウンロード済みでなければ install しない');
  }
  { // 5) 開発起動（enabled=false）では、何もしない
    const au = fake(), up = createUpdater({ autoUpdater: au, enabled: false });
    const r = await up.check(true);
    check(r.ok === false && r.reason === 'disabled' && au.calls.check === 0 && up.getState().status === 'disabled' && up.install().reason === 'disabled', '(13) 開発起動では、確認も再起動もしない');
    up.start(); up.stop();
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})();
