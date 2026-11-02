// 自動アップデート（b21 / D110）。electron-updater の autoUpdater を包み、次の約束を守る:
//  - 録画中（isRecording）は、確認・ダウンロード・通知・再起動をしない。録画が終わってからやる
//  - 再起動して入れ替えるのは、ユーザーが押したときだけ（install）。押さなければ、終了時に入れ替わる
//  - 未パッケージ（開発起動）では何もしない
// Electron に依存しない（autoUpdater は渡してもらう）ので、desktop/tools/updater_check.js で単体で確かめられる。
const CHECK_FIRST_MS = 20 * 1000;          // 起動して少ししてから最初の確認（案）
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // その後の確認の間隔（案）
const TICK_MS = 30 * 1000;                 // 録画が終わったかの見回り（案）

function createUpdater({ autoUpdater, isRecording = () => false, send = () => {}, enabled = true, firstMs = CHECK_FIRST_MS, everyMs = CHECK_EVERY_MS, tickMs = TICK_MS } = {}) {
  // status: disabled | idle | checking | none | available | downloading | ready | error
  let state = { status: enabled ? 'idle' : 'disabled', version: null, percent: null, message: null, checkedAt: null };
  let wantDownload = false, notified = '', timers = [];
  const set = patch => { state = { ...state, ...patch }; };
  const view = () => ({ ...state, recording: isRecording() });
  // 通知は、録画中でないときだけ。状態が変わっていなければ重ねて送らない
  const flush = () => {
    if (!enabled || isRecording()) return;
    const key = state.status + '|' + state.version + '|' + (state.percent == null ? '' : Math.floor(state.percent / 10));
    if (key === notified) return; notified = key;
    try { send(view()); } catch { /* 画面が無い */ }
  };
  const startDownload = () => {
    if (!wantDownload || isRecording()) return; wantDownload = false;
    set({ status: 'downloading', percent: 0 });
    Promise.resolve(autoUpdater.downloadUpdate()).catch(e => { set({ status: 'error', message: String(e && e.message || e) }); flush(); });
  };

  if (enabled) {
    autoUpdater.autoDownload = false;          // ダウンロードのタイミングは自分で決める（録画中は始めない）
    autoUpdater.autoInstallOnAppQuit = true;   // 押されなくても、アプリを閉じたときに入れ替わる
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => { set({ status: 'none', version: null, checkedAt: new Date().toISOString() }); flush(); });
    autoUpdater.on('update-available', info => { set({ status: 'available', version: info && info.version || null, checkedAt: new Date().toISOString() }); wantDownload = true; startDownload(); flush(); });
    autoUpdater.on('download-progress', p => { set({ status: 'downloading', percent: p && typeof p.percent === 'number' ? p.percent : null }); flush(); });
    autoUpdater.on('update-downloaded', info => { set({ status: 'ready', version: info && info.version || state.version, percent: 100 }); flush(); });
    autoUpdater.on('error', e => { set({ status: 'error', message: String(e && e.message || e) }); flush(); });
  }

  /** 確認する。manual は、ユーザーが押したとき。録画中は何もしない */
  async function check(manual = false) {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (isRecording()) return { ok: false, reason: 'recording' };
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return { ok: true, state: view() };
    if (manual) notified = ''; // 手動のときは、結果（更新なしを含む）を必ず返す
    try { await autoUpdater.checkForUpdates(); } catch (e) { set({ status: 'error', message: String(e && e.message || e) }); flush(); }
    return { ok: true, state: view() };
  }
  /** 再起動して入れ替える。ダウンロード済みで、録画中でないときだけ */
  function install() {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (state.status !== 'ready') return { ok: false, reason: 'not-ready' };
    if (isRecording()) return { ok: false, reason: 'recording' };
    autoUpdater.quitAndInstall(false, true); // (isSilent=false, forceRunAfter=true): 入れ替えたあと、起動し直す
    return { ok: true };
  }
  function start() {
    if (!enabled) return;
    timers.push(setTimeout(() => check(false), firstMs), setInterval(() => check(false), everyMs));
    // 録画が終わったら、止めていたダウンロードと通知を進める
    timers.push(setInterval(() => { startDownload(); flush(); }, tickMs));
    timers.forEach(t => t && t.unref && t.unref());
  }
  function stop() { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers = []; }
  return { check, install, start, stop, getState: view };
}

module.exports = { createUpdater, CHECK_FIRST_MS, CHECK_EVERY_MS, TICK_MS };
