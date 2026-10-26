import { prepAssets } from './core/assets.js';
import { Analyzer } from './core/analyzer.js';
import { setParams } from './core/tuning.js';
import { CLIP } from './clips.js';

let A = null, an = null, curFrame = null, curT = 0;

function toBlob(fr) { // ImageData is built synchronously (the frame buffer is transferred away right after)
  if (!fr || typeof OffscreenCanvas === 'undefined') return null;
  const oc = new OffscreenCanvas(fr.w, fr.h); oc.getContext('2d').putImageData(new ImageData(fr.data, fr.w, fr.h), 0, 0);
  return oc.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

let clipMime = CLIP.TYPE;
let clipQuality = CLIP.QUALITY;

function toClipBlob(fr) {
  if (!fr || typeof OffscreenCanvas === 'undefined') return null;
  const srcOc = new OffscreenCanvas(fr.w, fr.h);
  srcOc.getContext('2d').putImageData(new ImageData(fr.data, fr.w, fr.h), 0, 0);
  let dstOc = srcOc;
  if (fr.h > CLIP.H) {
    const scale = CLIP.H / fr.h;
    const dstW = Math.round(fr.w * scale);
    const dstH = CLIP.H;
    dstOc = new OffscreenCanvas(dstW, dstH);
    const ctx = dstOc.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcOc, 0, 0, dstW, dstH);
  }
  const p = dstOc.convertToBlob({ type: clipMime, quality: clipQuality });
  return p.then(async blob => {
    if (clipMime === CLIP.TYPE && blob && blob.type !== CLIP.TYPE) {
      clipMime = CLIP.FALLBACK_TYPE;
      clipQuality = CLIP.FALLBACK_QUALITY;
      return dstOc.convertToBlob({ type: clipMime, quality: clipQuality });
    }
    return blob;
  });
}

const STILL_CAP = 48, RESULT_EXTRA = 8, MOMENT_DEDUP_SEC = 5, RING_SEC = 6;
let ring = [], lastRingT = -1e9, stillCount = 0, ringGen = 0; const lastKindT = {};
let pendingClips = [];

function openClip(kind, t) {
  const from = t - CLIP.BEFORE;
  const to = t + CLIP.AFTER[kind];
  const pending = pendingClips.find(p => p.to >= from - CLIP.STEP);
  if (pending) {
    pending.to = Math.max(pending.to, to);
    pending.events.push({ kind, t });
    for (const r of ring) {
      if (r.t >= pending.from && r.t <= pending.to) {
        if (!pending.frames.some(f => f.t === r.t)) {
          pending.frames.push({ t: r.t, blob: r.blob });
        }
      }
    }
    pending.frames.sort((a, b) => a.t - b.t);
  } else {
    const frames = [];
    for (const r of ring) {
      if (r.t >= from && r.t <= to) {
        frames.push({ t: r.t, blob: r.blob });
      }
    }
    frames.sort((a, b) => a.t - b.t);
    pendingClips.push({ t, from, to, events: [{ kind, t }], frames });
  }
}

function resetMatchState() {
  for (const clip of pendingClips) {
    if (clip.frames && clip.frames.length >= 1) {
      clip.frames.sort((a, b) => a.t - b.t);
      postMessage({
        type: 'clip',
        t: clip.t,
        from: clip.from,
        to: clip.to,
        events: clip.events,
        frames: clip.frames
      });
    }
  }
  pendingClips = [];
  ring = [];
  lastRingT = -1e9;
  stillCount = 0;
  ringGen++;
  for (const k in lastKindT) delete lastKindT[k];
}

async function snap(t, reason, extra = {}, fr = curFrame, priority = false) {
  if (stillCount >= STILL_CAP + (priority ? RESULT_EXTRA : 0)) return; const p = toBlob(fr); if (!p) return; stillCount++;
  const blob = await p; postMessage({ type: 'snapshot', t, reason, blob, ...extra });
}

/** key-moment still: nearest ring-buffer blob to t (current frame if none close), de-duplicated per kind (MOMENT_DEDUP_SEC: signal flicker would otherwise shoot repeatedly) */
async function momentSnap(t, kind, reason) {
  if (stillCount >= STILL_CAP) return; if (lastKindT[kind] !== undefined && t - lastKindT[kind] < MOMENT_DEDUP_SEC) return; lastKindT[kind] = t;
  let best = null; for (const r of ring) if (!best || Math.abs(r.t - t) < Math.abs(best.t - t)) best = r;
  if (best && Math.abs(best.t - t) <= 1) { stillCount++; postMessage({ type: 'snapshot', t, reason, kind, blob: best.blob }); return; }
  await snap(t, reason, { kind });
}

let battleA = null, snapPlan = [];
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    if (m.detectParams) setParams(m.detectParams);
    if (!A) { const r = await fetch(m.assetsUrl); A = prepAssets(await r.json()); }
    an = new Analyzer(A, { srcH: m.srcH || 1080, matchNo: m.matchNo || 1, learnThresholds: m.learnThresholds || null,
      onMatch: rec => { resetMatchState(); postMessage({ type: 'match', rec }); },
      onEvent: e => { postMessage({ type: 'event', e });
        if (e.type === 'battle_start') { battleA = e.t; snapPlan = [20, 90, 180]; resetMatchState(); }
        if (e.type === 'own_kill') { momentSnap(e.t, 'kill', 'キル'); openClip('kill', e.t); }
        if (e.type === 'own_death') { momentSnap(e.t, 'death', 'デス'); openClip('death', e.t); }
        if (e.type === 'special_ready') momentSnap(e.t, 'special', 'スペシャル');
        if (e.type === 'special_end') openClip('special', e.t);
        if (e.type === 'snapshot') snap(e.t, e.reason, { kind: e.kind, header: e.header }, curFrame, ['celebration', 'personal', 'board'].includes(e.kind)); } });
    postMessage({ type: 'ready' });
  } else if (m.type === 'frame') {
    const fr = { w: m.w, h: m.h, data: new Uint8ClampedArray(m.buf) }; curFrame = fr; curT = m.t;
    const t0 = performance.now(); const tp = an.frame(fr, m.t); const ms = performance.now() - t0;
    if (an.state === 'battle' && snapPlan.length && m.t - battleA >= snapPlan[0] && tp) { snapPlan.shift(); snap(m.t, '試合中のサンプル（ルール・ステージ学習用）'); }
    if (an.state === 'battle' && m.t - lastRingT >= CLIP.STEP - 1e-6) {
      // keep a 0.5 s grid on average even when frames come every 0.2 s (0.6/0.4 s alternation instead of a fixed 0.6 s)
      lastRingT = m.t - lastRingT < 2 * CLIP.STEP ? lastRingT + CLIP.STEP : m.t;
      const p = toClipBlob(fr), gen = ringGen, t = m.t;
      if (p) p.then(blob => {
        if (gen !== ringGen) return;
        ring.push({ t, blob });
        while (ring.length && ring[0].t < t - RING_SEC) ring.shift();
        for (const clip of pendingClips) {
          if (t >= clip.from && t <= clip.to) {
            if (!clip.frames.some(f => f.t === t)) {
              clip.frames.push({ t, blob });
            }
          }
        }
        const remaining = [];
        for (const clip of pendingClips) {
          if (t > clip.to) {
            clip.frames.sort((a, b) => a.t - b.t);
            if (clip.frames.length >= 1) {
              postMessage({
                type: 'clip',
                t: clip.t,
                from: clip.from,
                to: clip.to,
                events: clip.events,
                frames: clip.frames
              });
            }
          } else {
            remaining.push(clip);
          }
        }
        pendingClips = remaining;
      });
    }
    postMessage({ type: 'ack', t: m.t, tp, ms, state: an.state, buf: m.buf }, [m.buf]);
  } else if (m.type === 'flush') { an.flush(); resetMatchState(); postMessage({ type: 'flushed' }); }
};
