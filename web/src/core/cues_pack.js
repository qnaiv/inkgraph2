// D54: 試合ごとに「フレームごとの信号」（自動調整で検出をやり直すための最小限）を小さく保存・復元する。
// 映像や静止画ではなく、0.2 秒ごとの数値だけ（約 22 バイト/フレーム、5 分の試合で base64 約 45KB）。
// 保存する信号：時刻・ok/map・「やられた」スコア・キル通知スコア（スロットごと）・ゲージ（白/橙）・
//   HUD アイコン確率と彩度（自分の枠 L0 と敵 4 枠 R0..R3）。味方の枠・マップの味方ネームプレートは検出の件数に効かないので保存しない。
export const CUES_V = 1;
const SLOTS = [0, 4, 5, 6, 7];
const q = (v, k = 100) => Math.max(0, Math.min(255, Math.round((v || 0) * k)));
const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

/** F: Analyzer のフレーム列 → 保存用オブジェクト */
export function packCues(F) {
  const n = F.length, ns = Math.max(0, ...F.map(f => (f.ksc ? f.ksc.length : 0)));
  const t = new Uint16Array(n), fl = new Uint8Array(n), sy = new Uint8Array(n), gw = new Uint8Array(n), go = new Uint8Array(n), ks = new Uint8Array(n * ns), p = new Uint8Array(n * SLOTS.length), s = new Uint8Array(n * SLOTS.length);
  F.forEach((f, i) => { t[i] = Math.round(f.t * 10); fl[i] = (f.ok ? 1 : 0) | (f.map ? 2 : 0) | (f.p ? 4 : 0); sy[i] = q(f.sy); gw[i] = q(f.gw); go[i] = q(f.go);
    if (f.ksc) f.ksc.forEach((v, j) => { ks[i * ns + j] = q(v); });
    SLOTS.forEach((sl, j) => { if (f.p) p[i * SLOTS.length + j] = q(f.p[sl]); if (f.s) s[i * SLOTS.length + j] = Math.max(0, Math.min(255, Math.round(f.s[sl] || 0))); }); });
  return { v: CUES_V, n, ns, t: toB64(new Uint8Array(t.buffer)), fl: toB64(fl), sy: toB64(sy), gw: toB64(gw), go: toB64(go), ks: toB64(ks), p: toB64(p), s: toB64(s) };
}

/** 保存用オブジェクト → buildMatch に渡せるフレーム列（kill_th などの再判定は buildMatch 側で ksc から行う） */
export function unpackCues(c) {
  const { n, ns } = c, tb = fromB64(c.t), t = new Uint16Array(tb.buffer, tb.byteOffset, n), fl = fromB64(c.fl), sy = fromB64(c.sy), gw = fromB64(c.gw), go = fromB64(c.go), ks = fromB64(c.ks), p = fromB64(c.p), s = fromB64(c.s), K = SLOTS.length, F = [];
  for (let i = 0; i < n; i++) {
    const ksc = Array.from({ length: ns }, (_, j) => ks[i * ns + j] / 100), hasP = !!(fl[i] & 4);
    let pp = null, ss = null; if (hasP) { pp = Array(8).fill(0); ss = Array(8).fill(0); SLOTS.forEach((sl, j) => { pp[sl] = p[i * K + j] / 100; ss[sl] = s[i * K + j]; }); }
    F.push({ t: t[i] / 10, ok: !!(fl[i] & 1), map: !!(fl[i] & 2), sy: sy[i] / 100, sig: sy[i] / 100 > 0.5, ksc, ks: Math.max(0, ...ksc), killSlots: ksc.map(v => v > 0.6), kill: ksc.some(v => v > 0.6), gw: gw[i] / 100, go: go[i] / 100, p: pp, s: ss, ally: null });
  }
  return F;
}
