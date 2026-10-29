import * as db from './db.js';
import { frameStepForState } from './analysis.js';
import { powerForMatchType } from './core/result.js';
import { selectClips } from './clips.js';
import AnalyzerWorker from './worker.js?worker';
import { CaptureGuard } from './capture_guard.js';
import { countCheck } from './count_check.js';
import { desktop, isDesktop, recordingAvailable } from './desktop.js';
import { MatchRecorder, pickRecordingStart, videoSupported, getVideoOn, getAudioOn, videoFilename, saveVideo, ensureDirPermission } from './video_rec.js';
export async function listDevices() {
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop()); } catch (e) { /* permission denied */ }
  return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
}
export class Session {
  constructor(video, cb = {}) {
    this.video = video; this.cb = cb; this.canvas = document.createElement('canvas'); 
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }); this.step = 0.2; this.busy = false; this.pendingSnaps = []; this.pendingClips = []; this.stats = { frames: 0, ms: 0 }; this.running = false; this.bufs = [];
    this._loopGen = 0; this._lastTickAt = 0; this._watchdogId = null; this._onVisibilityChange = null;
    this.guard = new CaptureGuard();
  }
  async start({ deviceId } = {}) {
    const wantAudio = getVideoOn() && getAudioOn();
    // D70: 録画の状況を画面に出す。保存先の書き込み許可は、開始ボタンを押した直後（ユーザー操作の中）に聞き直す（再読み込みのあとは切れている）
    if (getVideoOn()) {
      if (!recordingAvailable()) this.videoNote('録画: ブラウザ版では録画できません（デスクトップ版のみ対応）');
      else if (!videoSupported()) this.videoNote('録画: このブラウザは録画（MediaRecorder）に対応していません');
      else if (isDesktop()) { const d = await desktop().getVideoDir().catch(() => null); this.videoNote(`録画: オン（保存先: ${d?.dir || '既定のフォルダ'}）。次のバトル開始から録画します`); }
      else { const h = await db.getVideoDir().catch(() => null), p = await ensureDirPermission(h); this.videoNote(h ? (p === 'granted' ? `録画: オン（保存先: ${h.name}）。次のバトル開始から録画します` : '録画: オン。保存先フォルダの書き込みが許可されなかったので、ダウンロードで保存します') : '録画: オン（保存先フォルダ未設定のため、ダウンロードで保存します）。次のバトル開始から録画します'); }
    }
    this.mode = 'device'; this.owner = 'self'; this.sessionId = new Date().toISOString();
    {
      this.sourceName = 'キャプチャー映像';
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }, audio: false });
      // D68: ゲーム音。キャプチャーボードの音声入力（映像と同じ groupId）を足す。見つからなければ音声なしで続ける
      if (wantAudio) {
        try {
          const gid = this.stream.getVideoTracks()[0]?.getSettings?.()?.groupId, ins = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
          const ain = ins.find(d => gid && d.groupId === gid) || ins.find(d => /cam ?link|capture|elgato|av ?io|hdmi|usb/i.test(d.label));
          if (ain) (await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: ain.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })).getAudioTracks().forEach(t => this.stream.addTrack(t));
        } catch (e) { console.warn('audio device failed', e); }
      }
      this.video.srcObject = this.stream; this.video.muted = true; await this.video.play(); this.srcH = this.stream.getVideoTracks()[0]?.getSettings?.()?.height || 1080; this.t0 = performance.now();
    }
    this.worker = new AnalyzerWorker();
    await new Promise(res => { this.worker.onmessage = e => { if (e.data.type === 'ready') res(); }; this.worker.postMessage({ type: 'init', assetsUrl: new URL('assets/inkgraph_assets.json', document.baseURI).href, srcH: this.srcH }); });
    this.worker.onmessage = e => this.onMsg(e.data); this.running = true;

    // visibilitychange リスナ: hidden 時はガードに通知、visible 復帰時に running なら resume()
    this._onVisibilityChange = () => {
      if (isDesktop()) return; // デスクトップ版は、隠れても止まらないので中断にしない
      const now = performance.now();
      if (document.visibilityState === 'hidden') {
        const info = this.guard.visibility(true, now);
        if (info) this._notifyInterrupted(info);
      } else if (document.visibilityState === 'visible' && this.running) {
        this.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // ウォッチドッグタイマー: 2秒間隔でチェック
    // 注: ブラウザの裏タブではタイマーやrVFC/rAF自体が間引かれる/停止するため保証はできない
    {
      this._watchdogId = setInterval(() => {
        if (!this.running) return;
        const now = performance.now();
        const info = this.guard.tick(now);
        if (info) this._notifyInterrupted(info);
        if (this._lastTickAt && (now - this._lastTickAt) > 2500) {
          this.resume().catch(() => {});
        }
      }, 2000);
    }

    this.liveLoop(); this.ringStart();
  }
  now() { return (performance.now() - this.t0) / 1000; }
  _notifyInterrupted(info) {
    this.cb.interrupted?.(info);
  }
  grab(t) {
    { const now = performance.now(); const info = this.guard.frame(now); if (info) this._notifyInterrupted(info); }
    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720; if (this.canvas.width !== vw) { this.canvas.width = vw; this.canvas.height = vh; } this.ctx.drawImage(this.video, 0, 0, vw, vh); const d = this.ctx.getImageData(0, 0, vw, vh); this.busy = true; this.stats.frames++; this.blackNote(t, d.data);
    this.worker.postMessage({ type: 'frame', t, w: vw, h: vh, buf: d.data.buffer }, [d.data.buffer]); }
  /** D80: 暗転（ほぼ真っ黒な画面＝ロード）の区間を覚えておく。録画の開始点を決めるのに使う */
  blackNote(t, px) {
    let sum = 0, n = 0; for (let i = 0; i < px.length; i += 256) { sum += px[i] + px[i + 1] + px[i + 2]; n += 3; }
    const black = n > 0 && sum / n < 10, runs = this.blackRuns = this.blackRuns || [];
    if (black) { if (this.blackFrom == null) this.blackFrom = t; return; }
    if (this.blackFrom != null) { if (t - this.blackFrom >= 0.4) runs.push({ from: this.blackFrom, to: t }); this.blackFrom = null; while (runs.length && runs[0].to < t - 180) runs.shift(); }
  }
  /** D80: 巻き戻し録画。待機中は、メモリにだけ録っておく（20秒ずつずらして2本、古いほうから捨てる）。バトル開始で本物の録画に昇格する */
  ringWanted() { return isDesktop() && getVideoOn() && recordingAvailable() && videoSupported() && !!this.stream && this.running; }
  ringTick() {
    this.ring = this.ring || [];
    if (!this.ringWanted()) return this.ringClear();
    if (this.vcur && this.vcur.r.state === 'recording') return; // 試合を録っている間は、待機の録画を回さない
    const now = this.now();
    try {
      const newest = this.ring[this.ring.length - 1];
      if (!newest || now - newest.sess0 >= 20) this.ring.push({ r: new MatchRecorder(this.stream, { buffer: true }).start(), sess0: now });
      while (this.ring.length > 1 && now - this.ring[0].sess0 >= 40) this.ringDrop(this.ring.shift());
    } catch (e) { console.warn('ring failed', e); }
  }
  ringDrop(x) { try { x.r.stop().then(b => b?.discard?.()).catch(() => {}); } catch { /* ignore */ } }
  ringClear() { for (const x of this.ring || []) this.ringDrop(x); this.ring = []; }
  ringStart() { if (this._ringId || !isDesktop()) return; this._ringId = setInterval(() => this.ringTick(), 1000); this.ringTick(); }
  ringStop() { if (this._ringId) { clearInterval(this._ringId); this._ringId = null; } this.ringClear(); }
  liveLoop() {
    const gen = ++this._loopGen;
    let next = 0;
    const tick = () => {
      if (!this.running || this._loopGen !== gen) return;
      this._lastTickAt = performance.now();
      const t = this.now();
      const step = frameStepForState(this.lastState, this.step);
      if (!this.busy && t >= next) {
        next = t + step;
        this.grab(t);
      } else if (this.busy && t >= next + 1) {
        this.stats.dropped = (this.stats.dropped || 0) + 1;
        next = t + step;
      }
      if (isDesktop()) {
        setTimeout(tick, 40); // デスクトップ版: 描画に頼らない（最小化・隠れても止まらない）
      } else if (this.video.requestVideoFrameCallback) {
        this.video.requestVideoFrameCallback(tick);
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  }
  async resume() {
    if (!this.running) return;
    if (this.video && this.video.paused) {
      try {
        await this.video.play();
      } catch (e) {
        /* play error ignored */
      }
    }
    if (!this.running) return;
    this.liveLoop();
  }
  onMsg(m) {
    if (m.type === 'ack') { this.busy = false; this.stats.ms += m.ms; this.lastState = m.state; this.cb.status?.(m); if (this.ackWait) { const f = this.ackWait; this.ackWait = null; f(); } }
    else if (m.type === 'event') {
      if (m.e) {
        if (m.e.type === 'battle_start') { this.guard.battleStart(performance.now()); this.videoStart(m.e.t); }
        else if (m.e.type === 'battle_discard') { this.guard.battleDiscard(); this.videoDrop(); }
        else if (m.e.type === 'battle_end') this.videoEndSoon();
      }
      this.cb.event?.(m.e);
    }
    else if (m.type === 'snapshot') this.pendingSnaps.push(m);
    else if (m.type === 'clip') this.pendingClips.push(m);
    else if (m.type === 'match') this.saving = (this.saving || Promise.resolve()).then(() => this.saveMatch(m.rec));
    else if (m.type === 'flushed') this.flushed?.();
  }
  // D68: 試合ごとの録画。バトル開始で録り始め、終了の 25 秒後（結果画面ぶん）に止めて、試合の保存時に名前を付けて保存する
  videoNote(msg, level = 'info') { try { this.cb.videoStatus?.({ msg, level }); } catch { /* ignore */ } }
  videoStart(t) {
    if (!getVideoOn()) return;
    if (!this.stream) return this.videoNote('録画: 映像ストリームが無いので録画できません', 'error');
    if (!videoSupported()) return this.videoNote('録画: この環境では録画できません（ブラウザ版は録画に対応していません）', 'error');
    this.videoQueue = this.videoQueue || [];
    try {
      const bs = Number.isFinite(t) ? t : this.now(), pre = (this.ring || []).filter(x => x.r.state === 'recording');
      if (pre.length) {
        const keep = pre[0]; this.ring = []; for (const x of pre.slice(1)) this.ringDrop(x);
        keep.r.promote();
        const pk = pickRecordingStart({ runs: this.blackRuns || [], battleStart: bs, recStart: keep.sess0 }), ss = Math.max(0, pk.cut - keep.sess0);
        this.vcur = { r: keep.r, timer: null, t0: keep.sess0, ss, cut: { reason: pk.reason, black: pk.black } }; this.videoQueue.push(this.vcur);
        this.videoNote(pk.reason === 'black' ? `録画: 開始しました。暗転の終わり（バトル開始の${(bs - pk.cut).toFixed(0)}秒前）から録ります` : '録画: 開始しました。暗転が見つからなかったので、バトル開始の少し前から録ります');
      } else {
        const t0 = this.now(); const r = new MatchRecorder(this.stream).start(); this.vcur = { r, timer: null, t0, ss: 0 }; this.videoQueue.push(this.vcur); this.videoNote('録画: 開始しました（バトル終了と結果画面のあとに保存します）');
      }
    } catch (e) { console.warn('video start failed', e); this.vcur = null; this.videoNote('録画: 開始できませんでした（' + (e?.message || e) + '）', 'error'); }
  }
  videoEndSoon() { const c = this.vcur; if (!c) { if (getVideoOn()) this.videoNote('録画: バトルが終わりましたが、この試合の録画は始まっていませんでした', 'error'); return; } if (!c.timer) { c.timer = setTimeout(() => c.r.stop(), 25000); this.videoNote('録画: バトル終了。結果画面ぶん（約25秒）を録ってから、試合の保存時に名前を付けて保存します'); } }
  videoDrop() { const c = this.vcur; if (!c) return; this.videoNote('録画: 試合として確定しなかったので、録画を捨てました'); clearTimeout(c.timer); c.r.stop().then(b => b?.discard?.()).catch(() => {}); this.videoQueue = (this.videoQueue || []).filter(x => x !== c); this.vcur = null; }
  async videoFinalize(rec, keep) {
    const c = (this.videoQueue || []).shift(); if (!c) { if (getVideoOn()) this.videoNote(keep ? '録画: この試合に対応する録画がありません（バトル開始時に録画が始まっていませんでした）' : '録画: 試合を保存しなかったので、録画もありません', keep ? 'error' : 'info'); return; }
    if (!keep) this.videoNote('録画: 試合を保存しなかったので、録画も捨てました');
    clearTimeout(c.timer); if (this.vcur === c) this.vcur = null;
    const blob = await c.r.stop(); if (!keep) { await blob?.discard?.(); return; } if (!blob || !blob.size) { this.videoNote('録画: 映像が空だったので保存しませんでした', 'error'); return; }
    try { const name = videoFilename({ ...rec, created: new Date(Date.parse(this.sessionId) + (rec.battle?.[0] ?? 0) * 1000).toISOString() }, c.r.ext || 'webm'), res = await saveVideo(blob, name, { getDir: db.getVideoDir }, { ss: c.ss || 0 }); rec.videoFile = res.filename || name; if (res.path) rec.recording = { path: res.path, file: res.filename, t0: Math.round((c.t0 + (res.trimmed ? c.ss || 0 : 0)) * 100) / 100, ...(c.cut ? { cut: c.cut } : {}), bytes: res.bytes || blob.size, remuxed: !!res.remuxed }; if (res.path && !res.remuxed) this.videoNote('録画: 保存しましたが、シークできる形式への変換に失敗しました（再生は出来ますが、他のプレーヤーでシークできないことがあります。試合の詳細から変換できます）', 'error'); this.cb.videoSaved?.({ ...res, bytes: blob.size }); }
    catch (e) { console.warn('video save failed', e); this.videoNote('録画: 保存に失敗しました（' + (e?.message || e) + '）', 'error'); }
  }
  async saveMatch(rec) {
    {
      const v = this.guard.matchEnd();
      if (v.save === false) {
        const battleStart = rec.battle?.[0] ?? 0;
        this.pendingSnaps = this.pendingSnaps.filter(s => !(s.t >= battleStart - 30));
        this.pendingClips = this.pendingClips.filter(c => !(c.t >= battleStart - 30));
        await this.videoFinalize(rec, false);
        this.stats.discarded = (this.stats.discarded || 0) + 1;
        this.cb.discarded?.({ rec, interrupted: v.interrupted });
        return;
      }
    }
    if (rec.match_type === undefined) rec.match_type = null;
    await this.videoFinalize(rec, true).catch(() => {});
    if (!rec.power) rec.power = powerForMatchType(rec.match_type);
    const id = `${this.sessionId}#${rec.match}`; rec.id = id; rec.created = new Date().toISOString(); rec.session = this.sessionId; rec.source = { kind: this.mode, name: this.sourceName, height: this.srcH, owner: this.owner || 'self' };
    rec.review = rec.review || { marks: {}, added: [], fix: {} };
    // D77: 検出した数が結果画面の数と合わないときは、自動で「要修正」の印を付ける（件数は補正しない。印は、ライブ画面・一覧から外せる）
    if (!rec.count_check) rec.count_check = countCheck(rec);
    if (rec.count_check && rec.count_check.mismatch && rec.count_check.mismatch.length && !rec.needs_fix) rec.needs_fix = { at: new Date().toISOString(), reasons: [...rec.count_check.mismatch], auto: true };
    const cand = this.pendingSnaps.filter(s => s.t >= rec.battle[0] - 30); let snaps = cand; if (snaps.length > 48) { const drop = snaps.length - 48, nulls = snaps.filter(s => !s.kind).slice(0, drop); snaps = snaps.filter(s => !nulls.includes(s)).slice(0, 48); } /* over cap: drop kind-less mid-match samples first */ this.pendingSnaps = this.pendingSnaps.filter(s => !cand.includes(s));
    let bytes = 0; for (const s of snaps) bytes += s.blob?.size || 0;
    const candClips = this.pendingClips.filter(c => c.t >= rec.battle[0] - 30);
    this.pendingClips = this.pendingClips.filter(c => !candClips.includes(c));
    const sel = selectClips(candClips, rec);

    let totalClipFrames = 0;
    let totalClipBytes = 0;
    const clipKindsCount = { death: 0, special: 0, kill: 0 };
    for (const c of sel) {
      totalClipFrames += c.frames?.length || 0;
      totalClipBytes += c.bytes || 0;
      if (clipKindsCount[c.kind] !== undefined) {
        clipKindsCount[c.kind]++;
      }
    }
    rec.clips = {
      count: sel.length,
      frames: totalClipFrames,
      bytes: totalClipBytes,
      kinds: clipKindsCount
    };

    rec.video = { kind: 'none' }; rec.stills = { count: snaps.length, bytes: bytes + totalClipBytes };
    rec.favorite = rec.favorite ?? false; rec.stillsState = (snaps.length || sel.length) ? 'kept' : 'none';
    await db.putMatch(rec);
    for (const s of snaps) {
      await db.putSnap({ matchId: id, t: s.t, reason: s.reason, kind: s.kind || null, header: s.header || null, event: s.event || null, blob: s.blob });
    }
    for (let clipIndex = 0; clipIndex < sel.length; clipIndex++) {
      const c = sel[clipIndex];
      const frames = c.frames || [];
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const f = frames[frameIndex];
        await db.putSnap({
          matchId: id,
          t: f.t,
          reason: '場面クリップ',
          kind: 'clip',
          header: null,
          event: null,
          blob: f.blob,
          features: null,
          clip: {
            idx: clipIndex,
            frame: frameIndex,
            n: frames.length,
            t: c.t,
            from: c.from,
            to: c.to,
            kind: c.kind,
            kinds: c.kinds,
            events: c.events
          }
        });
      }
    }
    try { await db.enforceRetention(); } catch (e) { console.warn('enforceRetention failed', e); }
    try { await db.enforceCapacity(); } catch (e) { console.warn('enforceCapacity failed', e); }
    this.cb.match?.(rec);
  }
  async stop() {
    if (!this.running) return;
    this.running = false;
    this.ringStop();
    this._loopGen++;
    if (this._watchdogId) {
      clearInterval(this._watchdogId);
      this._watchdogId = null;
    }
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this.worker) {
      await new Promise(r => { this.flushed = r; this.worker.postMessage({ type: 'flush' }); });
      await new Promise(r => setTimeout(r, 300));
      await this.saving;
    }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.worker?.terminate();
    this.cb.stopped?.();
  }
}
