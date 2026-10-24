import * as db from './db.js';
import * as learn from './learn.js';
import { frameStepForState } from './analysis.js';
import { powerForMatchType } from './core/result.js';
import AnalyzerWorker from './worker.js?worker';
import { CaptureGuard } from './capture_guard.js';
export async function listDevices() {
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop()); } catch (e) { /* permission denied */ }
  return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
}
export class Session {
  constructor(video, cb = {}) {
    this.video = video; this.cb = cb; this.canvas = document.createElement('canvas'); 
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }); this.step = 0.2; this.busy = false; this.pendingSnaps = []; this.stats = { frames: 0, ms: 0 }; this.running = false; this.bufs = [];
    this._loopGen = 0; this._lastTickAt = 0; this._watchdogId = null; this._onVisibilityChange = null; this._onEnded = null;
    this.guard = new CaptureGuard();
  }
  async start({ mode, deviceId, file, fast = false, owner = 'self' }) {
    this.mode = mode; this.owner = owner || 'self'; this.fast = fast; this.sessionId = new Date().toISOString();
    if (mode === 'stream') {
      this.sourceName = '配信映像（画面共有）';
      this.stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
      this.video.srcObject = this.stream; await this.video.play(); this.srcH = this.stream.getVideoTracks()[0]?.getSettings?.()?.height || 1080; this.t0 = performance.now();
    } else if (mode === 'device') {
      this.sourceName = 'キャプチャー映像';
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
      this.video.srcObject = this.stream; await this.video.play(); this.srcH = this.stream.getVideoTracks()[0]?.getSettings?.()?.height || 1080; this.t0 = performance.now();
    } else {
      this.sourceName = file ? file.name : 'キャプチャー映像';
      this.video.srcObject = null; this.video.src = URL.createObjectURL(file); this.video.muted = true; await new Promise(r => this.video.onloadedmetadata = r); this.srcH = this.video.videoHeight;
    }
    this.worker = new AnalyzerWorker();
    const learnState = await db.getLearnState().catch(() => null);
    const activePack = await db.activeLearnPack(learnState).catch(() => null);
    const learnThresholds = activePack?.thresholds || null;
    await new Promise(res => { this.worker.onmessage = e => { if (e.data.type === 'ready') res(); }; this.worker.postMessage({ type: 'init', assetsUrl: new URL('assets/inkgraph_assets.json', document.baseURI).href, srcH: this.srcH, learnThresholds }); });
    this.worker.onmessage = e => this.onMsg(e.data); this.running = true;

    // visibilitychange リスナ: hidden 時はガードに通知、visible 復帰時に running なら resume()
    this._onVisibilityChange = () => {
      if (this.fast) return;
      const now = performance.now();
      if (document.visibilityState === 'hidden') {
        const info = this.guard.visibility(true, now);
        if (info) this._notifyInterrupted(info);
      } else if (document.visibilityState === 'visible' && this.running) {
        this.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // ended リスナ: ファイル通常再生で動画末尾に達したらセッション停止
    if (this.mode === 'file' && !this.fast) {
      this._onEnded = () => {
        if (this.running) this.stop();
      };
      this.video.addEventListener('ended', this._onEnded);
    }

    // ウォッチドッグタイマー: 2秒間隔でチェック
    // 注: ブラウザの裏タブではタイマーやrVFC/rAF自体が間引かれる/停止するため保証はできない
    if (!this.fast) {
      this._watchdogId = setInterval(() => {
        if (!this.running || this.fast) return;
        if (this.mode === 'file' && this.video.ended) {
          this.stop();
          return;
        }
        const now = performance.now();
        const info = this.guard.tick(now);
        if (info) this._notifyInterrupted(info);
        if (this._lastTickAt && (now - this._lastTickAt) > 2500) {
          this.resume().catch(() => {});
        }
      }, 2000);
    }

    if (mode === 'file' && fast) this.fastLoop(); else { if (mode === 'file') await this.video.play(); this.liveLoop(); }
  }
  now() { return (this.mode === 'device' || this.mode === 'stream') ? (performance.now() - this.t0) / 1000 : this.video.currentTime; }
  _notifyInterrupted(info) {
    this.cb.interrupted?.(info);
  }
  grab(t) {
    if (!this.fast) {
      const now = performance.now();
      const info = this.guard.frame(now);
      if (info) this._notifyInterrupted(info);
    }
    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720; if (this.canvas.width !== vw) { this.canvas.width = vw; this.canvas.height = vh; } this.ctx.drawImage(this.video, 0, 0, vw, vh); const d = this.ctx.getImageData(0, 0, vw, vh); this.busy = true; this.stats.frames++;
    this.worker.postMessage({ type: 'frame', t, w: vw, h: vh, buf: d.data.buffer }, [d.data.buffer]); }
  liveLoop() {
    const gen = ++this._loopGen;
    let next = 0;
    const tick = () => {
      if (!this.running || this._loopGen !== gen) return;
      this._lastTickAt = performance.now();
      const t = this.now();
      if (this.mode === 'file' && this.video.ended) { this.stop(); return; }
      const step = frameStepForState(this.lastState, this.step);
      if (!this.busy && t >= next) {
        next = t + step;
        this.grab(t);
      } else if (this.busy && t >= next + 1) {
        this.stats.dropped = (this.stats.dropped || 0) + 1;
        next = t + step;
      }
      if (this.video.requestVideoFrameCallback) {
        this.video.requestVideoFrameCallback(tick);
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  }
  async resume() {
    if (!this.running || this.fast) return;
    if (this.mode === 'file' && this.video.ended) {
      this.stop();
      return;
    }
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
  async fastLoop() { const v = this.video, dur = v.duration; for (let t = 0; t < dur && this.running; t = Math.round((t + this.step) * 1000) / 1000) {
      await new Promise(r => { v.onseeked = r; v.currentTime = t; }); while (this.busy) await new Promise(r => this.ackWait = r); this.grab(t); this.cb.progress?.(t / dur, t); }
    while (this.busy) await new Promise(r => this.ackWait = r); this.stop(); }
  onMsg(m) {
    if (m.type === 'ack') { this.busy = false; this.stats.ms += m.ms; this.lastState = m.state; this.cb.status?.(m); if (this.ackWait) { const f = this.ackWait; this.ackWait = null; f(); } }
    else if (m.type === 'event') {
      if (!this.fast && m.e) {
        if (m.e.type === 'battle_start') this.guard.battleStart(performance.now());
        else if (m.e.type === 'battle_discard') this.guard.battleDiscard();
      }
      this.cb.event?.(m.e);
    }
    else if (m.type === 'snapshot') this.pendingSnaps.push(m);
    else if (m.type === 'match') this.saving = (this.saving || Promise.resolve()).then(() => this.saveMatch(m.rec));
    else if (m.type === 'flushed') this.flushed?.();
  }
  async saveMatch(rec) {
    if (!this.fast) {
      const v = this.guard.matchEnd();
      if (v.save === false) {
        const battleStart = rec.battle?.[0] ?? 0;
        this.pendingSnaps = this.pendingSnaps.filter(s => !(s.t >= battleStart - 30));
        this.stats.discarded = (this.stats.discarded || 0) + 1;
        this.cb.discarded?.({ rec, interrupted: v.interrupted });
        return;
      }
    }
    if (rec.match_type === undefined) rec.match_type = null;
    if (!rec.power) rec.power = powerForMatchType(rec.match_type);
    const id = `${this.sessionId}#${rec.match}`; rec.id = id; rec.created = new Date().toISOString(); rec.session = this.sessionId; rec.source = { kind: this.mode, name: this.sourceName, height: this.srcH, owner: this.owner || 'self' };
    rec.review = rec.review || { marks: {}, added: [], fix: {} };
    const cand = this.pendingSnaps.filter(s => s.t >= rec.battle[0] - 30); let snaps = cand; if (snaps.length > 48) { const drop = snaps.length - 48, nulls = snaps.filter(s => !s.kind).slice(0, drop); snaps = snaps.filter(s => !nulls.includes(s)).slice(0, 48); } /* over cap: drop kind-less mid-match samples first */ this.pendingSnaps = this.pendingSnaps.filter(s => !cand.includes(s));
    let bytes = 0; for (const s of snaps) bytes += s.blob?.size || 0;
    rec.video = { kind: 'none' }; rec.stills = { count: snaps.length, bytes };
    rec.favorite = rec.favorite ?? false; rec.stillsState = snaps.length ? 'kept' : 'none';
    const matchLearnFeats = [];
    const snapFeatPairs = [];
    for (const s of snaps) {
      const feat = learn.featureFromHeader(s);
      if (feat) matchLearnFeats.push(feat);
      snapFeatPairs.push({ snap: s, feat });
    }
    rec.learnFeatures = matchLearnFeats;
    await db.putMatch(rec);
    for (const { snap: s, feat } of snapFeatPairs) {
      await db.putSnap({ matchId: id, t: s.t, reason: s.reason, kind: s.kind || null, header: s.header || null, event: s.event || null, blob: s.blob, features: feat });
    }
    try { await db.enforceRetention(30); } catch (e) { console.warn('enforceRetention failed', e); }
    try { await db.enforceCapacity(); } catch (e) { console.warn('enforceCapacity failed', e); }
    this.cb.match?.(rec);
  }
  async stop() {
    if (!this.running) return;
    this.running = false;
    this._loopGen++;
    if (this._watchdogId) {
      clearInterval(this._watchdogId);
      this._watchdogId = null;
    }
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this._onEnded) {
      this.video.removeEventListener('ended', this._onEnded);
      this._onEnded = null;
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
