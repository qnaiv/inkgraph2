// D68: 試合ごとの録画ファイル。配信映像／キャプチャー映像の MediaStream を、バトル開始から結果画面までを 1 試合 = 1 ファイルで録る。
// ファイル名は試合が終わって結果画面を読めてから決まる（日時_ルール_ステージ_勝敗）。DOM 非依存の部分（名前付け）と、MediaRecorder の薄い包み。
const p2 = n => String(n).padStart(2, '0');
const bad = /[\\/:*?"<>|\u0000-\u001f]/g;
const clean = s => String(s ?? '').replace(bad, '').replace(/\s+/g, '').trim();

/** 日時_ルール_ステージ_勝敗.webm。結果画面を読めなかった項目は「ルール不明」などで埋める */
export function videoFilename(rec, ext = 'webm') {
  const d = new Date(rec.created || Date.now()), rs = rec.result_screen || {};
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  const win = rs.result === 'WIN' ? '勝ち' : rs.result === 'LOSE' ? '負け' : '勝敗不明';
  const parts = [stamp, clean(rs.mode || rs.mode_guess) || 'ルール不明', clean(rs.stage) || 'ステージ不明'];
  if (rec.match_type && rec.match_type !== 'regular') parts.push(clean(rec.match_type));
  parts.push(win);
  return parts.filter(Boolean).join('_') + '.' + ext;
}

const MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export const videoSupported = () => typeof MediaRecorder !== 'undefined';
export function pickMime() { if (!videoSupported()) return null; return MIMES.find(m => MediaRecorder.isTypeSupported?.(m)) || ''; }
export const VIDEO_BPS = 3_000_000; // 3Mbps ≒ 5 分で約 110MB

/** 1 試合ぶんの録画。start() → stop() で Blob */
export class MatchRecorder {
  constructor(stream, { bps = VIDEO_BPS } = {}) {
    const mimeType = pickMime();
    this.rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: bps, ...(stream.getAudioTracks?.().length ? { audioBitsPerSecond: 128_000 } : {}) });
    this.mime = this.rec.mimeType || mimeType || 'video/webm'; this.chunks = []; this.state = 'idle';
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.done = new Promise(res => { this.rec.onstop = () => { this.state = 'stopped'; res(new Blob(this.chunks, { type: this.mime.split(';')[0] })); }; });
  }
  start() { this.rec.start(2000); this.state = 'recording'; return this; }
  stop() { if (this.state === 'recording') { try { this.rec.stop(); } catch { this.state = 'stopped'; } } return this.done; }
}

// ---- 保存先 ----
const KEY = 'inkgraph.videoRec';
export const getVideoOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const getAudioOn = () => { try { return localStorage.getItem(KEY + '.audio') === '1'; } catch { return false; } };
export const setAudioOn = on => { try { localStorage.setItem(KEY + '.audio', on ? '1' : '0'); } catch { /* ignore */ } };
export const setVideoOn = on => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } };

/** 保存先フォルダ（File System Access API）。ハンドルは IndexedDB の learn ストア（key: videoDir）に持つ。使えないときはダウンロード */
export async function saveVideo(blob, filename, store) {
  const h = await store.getDir?.();
  if (h) {
    try {
      if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'granted') {
        const fh = await h.getFileHandle(filename, { create: true }), w = await fh.createWritable(); await w.write(blob); await w.close();
        return { where: 'folder', folder: h.name, filename };
      }
    } catch (e) { console.warn('folder save failed', e); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { where: 'download', filename };
}
