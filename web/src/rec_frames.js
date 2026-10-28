// D75: 録画から、指定した時刻のコマを WebP で切り出す（要修正パック用）。録画（rec://）を <video> で開き、1 コマずつシークして canvas に描く。
export async function extractFrames(url, times, { width = 1280, quality = 0.7, onProgress = null, signal = null } = {}) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('録画を開けません')); });
  const w = Math.min(width, v.videoWidth || width), h = Math.round(w * (v.videoHeight || 720) / (v.videoWidth || 1280));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) break;
    const t = Math.max(0, Math.min((v.duration || 1e9) - 0.05, times[i]));
    await new Promise(res => { v.onseeked = res; v.currentTime = t; });
    g.drawImage(v, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/webp', quality));
    if (blob) out.push({ t: times[i], blob });
    onProgress?.(i + 1, times.length);
  }
  v.removeAttribute('src'); v.load();
  return out;
}
