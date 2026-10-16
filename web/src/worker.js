import { prepAssets } from './core/assets.js';
import { Analyzer } from './core/analyzer.js';
let A = null, an = null, curFrame = null, curT = 0;
async function snap(t, reason, extra = {}, fr = curFrame) {
  if (!fr || typeof OffscreenCanvas === 'undefined') return;
  const oc = new OffscreenCanvas(fr.w, fr.h); oc.getContext('2d').putImageData(new ImageData(fr.data, fr.w, fr.h), 0, 0);
  const blob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.85 }); postMessage({ type: 'snapshot', t, reason, blob, ...extra });
}
let battleA = null, snapPlan = [];
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    if (!A) { const r = await fetch(m.assetsUrl); A = prepAssets(await r.json()); }
    an = new Analyzer(A, { srcH: m.srcH || 1080, matchNo: m.matchNo || 1,
      onMatch: rec => postMessage({ type: 'match', rec }),
      onEvent: e => { postMessage({ type: 'event', e });
        if (e.type === 'battle_start') { battleA = e.t; snapPlan = [20, 90, 180]; }
        if (e.type === 'snapshot') snap(e.t, e.reason, { kind: e.kind, header: e.header }); } });
    postMessage({ type: 'ready' });
  } else if (m.type === 'frame') {
    const fr = { w: m.w, h: m.h, data: new Uint8ClampedArray(m.buf) }; curFrame = fr; curT = m.t;
    const t0 = performance.now(); const tp = an.frame(fr, m.t); const ms = performance.now() - t0;
    if (an.state === 'battle' && snapPlan.length && m.t - battleA >= snapPlan[0] && tp) { snapPlan.shift(); snap(m.t, '試合中のサンプル（ルール・ステージ学習用）'); }
    postMessage({ type: 'ack', t: m.t, tp, ms, state: an.state, buf: m.buf }, [m.buf]);
  } else if (m.type === 'flush') { an.flush(); postMessage({ type: 'flushed' }); }
};
