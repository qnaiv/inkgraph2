// D68: 試合ごとの録画ファイル。配信映像／キャプチャー映像の MediaStream を、バトル開始から結果画面までを 1 試合 = 1 ファイルで録る。
// ファイル名は試合が終わって結果画面を読めてから決まる（日時_ルール_ステージ_勝敗）。DOM 非依存の部分（名前付け）と、MediaRecorder の薄い包み。
import { desktop, recordingAvailable } from './desktop.js';
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

// 録画形式。MP4（H.264 ＋ AAC。AAC が使えない環境は Opus）が既定。使えなければ WebM。
const MIMES = {
  mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1'],
  webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
};
export const videoSupported = () => typeof MediaRecorder !== 'undefined' && recordingAvailable();
export function pickMime(format = 'mp4') {
  if (typeof MediaRecorder === 'undefined') return null;
  const ok = m => MediaRecorder.isTypeSupported?.(m);
  return MIMES[format].find(ok) || (format === 'mp4' ? MIMES.webm.find(ok) : null) || '';
}
export const extOfMime = m => (/mp4/.test(m || '') ? 'mp4' : 'webm');
// 映像のビットレート（Mbps）。60fps なので既定は 8（1 試合 約 300MB）。音声は 192kbps
export const BITRATE_CHOICES = [5, 8, 12], AUDIO_BPS = 192_000;
export const getBitrateMbps = () => { try { const v = parseInt(localStorage.getItem('inkgraph.videoBitrate') || '', 10); return BITRATE_CHOICES.includes(v) ? v : 8; } catch { return 8; } };
export const setBitrateMbps = v => { try { localStorage.setItem('inkgraph.videoBitrate', String(v)); } catch { /* ignore */ } };

/** 1 試合ぶんの録画。start() → stop() で Blob（ブラウザ）／ディスク上のファイルの控え（デスクトップ版: 2 秒ごとに保存先へ直接書く） */
export class MatchRecorder {
  /** buffer: 待機中の巻き戻し録画。ディスクに書かず、メモリに持っておく（promote() で、持っていた分をディスクへ書き出して、続きを書く。デスクトップ版のみ） */
  constructor(stream, { bps = getBitrateMbps() * 1_000_000, buffer = false } = {}) {
    const mimeType = pickMime(), D = desktop();
    this.rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: bps, ...(stream.getAudioTracks?.().length ? { audioBitsPerSecond: AUDIO_BPS } : {}) });
    this.mime = this.rec.mimeType || mimeType || 'video/webm'; this.ext = extOfMime(this.mime); this.chunks = []; this.state = 'idle'; this.D = D;
    this.buffering = !!buffer && !!D; this.pending = []; this.bytes = 0;
    if (D && !this.buffering) this._open();
    this.rec.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      if (!D) { this.chunks.push(e.data); return; }
      if (this.buffering) { this.pending.push(e.data); return; }
      this._write(e.data);
    };
    this.done = new Promise((res, rej) => { this.rec.onstop = () => { this.state = 'stopped'; if (!D) return res(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
      if (this.buffering) { this.pending = []; return res({ disk: true, size: 0, finalize: async () => { throw new Error('録画が確定していません'); }, discard: async () => {} }); }
      this.chain.then(() => res({ disk: true, size: this.bytes, finalize: async (name, opts) => ({ where: 'folder', ...(await D.recClose(await this.idP, name, opts || {})) }), discard: async () => D.recDiscard(await this.idP) }), rej); }; });
  }
  _open() { this.idP = this.D.recOpen(); this.chain = this.idP.then(() => 0); }
  _write(data) { const D = this.D; this.chain = this.chain.then(async () => { const buf = new Uint8Array(await data.arrayBuffer()); this.bytes += buf.length; await D.recWrite(await this.idP, buf); }); }
  /** 待機中の録画を、試合の録画にする（持っていた分をディスクへ書き出して、続きを書く） */
  promote() { if (!this.D || !this.buffering) return; this._open(); this.buffering = false; for (const d of this.pending) this._write(d); this.pending = []; }
  start() { this.rec.start(2000); this.state = 'recording'; return this; }
  stop() { if (this.state === 'recording') { try { this.rec.stop(); } catch { this.state = 'stopped'; } } return this.done; }
}

/**
 * D80: 録画の開始点（解析時刻）。試合の録画は、バトル開始より前から巻き戻して録り、**バトル開始の前の、最後の暗転（黒い画面＝ロード）が終わる少し前**から始める。
 * runs: 暗転の区間 [{from, to}]（to ＝ 暗転が終わった時刻）。複数あるときは、いちばん長い暗転（＝ロード）を選ぶ（短い暗転は、場面の切り替わり）。
 * 暗転が見つからなければ、バトル開始の fallback 秒前から。録画を始めた時刻（recStart）より前にはならない。
 */
export function pickRecordingStart({ runs = [], battleStart, recStart, lead = 1.0, fallback = 8, minLen = 0.8, maxBack = 60, minBefore = 2 }) {
  const c = runs.filter(r => r.to - r.from >= minLen && r.to <= battleStart - minBefore && r.to >= battleStart - maxBack && r.to > recStart);
  if (c.length) {
    const best = c.reduce((a, b) => ((b.to - b.from) > (a.to - a.from) + 1e-9 ? b : a));
    return { cut: Math.max(recStart, best.to - lead), reason: 'black', black: { from: best.from, to: best.to }, found: c.length };
  }
  return { cut: Math.max(recStart, battleStart - fallback), reason: 'fallback', black: null, found: 0 };
}

// ---- 保存先 ----
const KEY = 'inkgraph.videoRec';
export const getVideoOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const getAudioOn = () => { try { return localStorage.getItem(KEY + '.audio') === '1'; } catch { return false; } };
export const setAudioOn = on => { try { localStorage.setItem(KEY + '.audio', on ? '1' : '0'); } catch { /* ignore */ } };
export const setVideoOn = on => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } };

/** 保存先フォルダの書き込み許可。再読み込みのあとは 'prompt' に戻っているので、ボタンを押した直後（ユーザー操作の中）に聞き直す。'granted' / 'denied' / 'prompt' / null（フォルダ未設定）を返す */
export async function ensureDirPermission(h) {
  if (!h) return null;
  try { let p = await h.queryPermission?.({ mode: 'readwrite' }); if (p !== 'granted') p = await h.requestPermission?.({ mode: 'readwrite' }); return p || 'prompt'; } catch { return 'prompt'; }
}

/** 保存先フォルダ（File System Access API）。ハンドルは IndexedDB の learn ストア（key: videoDir）に持つ。使えないときはダウンロード */
export async function saveVideo(blob, filename, store, opts = {}) {
  if (blob && blob.disk) return blob.finalize(filename, opts); // デスクトップ版: すでに保存先に書いてある。名前を付けて確定する（opts.ss: 先頭を切る秒数）
  const h = await store.getDir?.();
  let why = h ? null : 'フォルダ未設定';
  if (h) {
    try {
      if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'granted') {
        const fh = await h.getFileHandle(filename, { create: true }), w = await fh.createWritable(); await w.write(blob); await w.close();
        return { where: 'folder', folder: h.name, filename };
      }
      why = '書き込み許可が切れている';
    } catch (e) { console.warn('folder save failed', e); why = 'フォルダへの保存に失敗（' + (e?.message || e) + '）'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { where: 'download', filename, why };
}
