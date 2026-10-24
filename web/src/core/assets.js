import { b64bytes } from './img.js';
import { prepKiller } from './killer.js';
export function prepAssets(j) {
  const A = { tpl: {}, gray: {}, lib: { mode: {}, stage: {}, match_type: {} } };
  for (const [k, v] of Object.entries(j.tpl)) A.tpl[k] = { w: v.w, h: v.h, bits: b64bytes(v.data) };
  for (const [k, v] of Object.entries(j.gray)) A.gray[k] = { w: v.w, h: v.h, data: b64bytes(v.data) };
  for (const kind of ['mode', 'stage', 'match_type']) for (const [k, v] of Object.entries(j.lib[kind] || {})) A.lib[kind][k] = Float32Array.from(b64bytes(v));
  A.icon = { coef: Float32Array.from(j.icon_lr.coef), b: j.icon_lr.intercept };
  for (const key of ['digits', 'tc_digits']) A[key] = { X: j[key].X.map(r => Float32Array.from(r)), y: j[key].y };
  A.killer = prepKiller(j.killer, b64bytes); // D47: やられた相手のブキ名
  return A;
}
export function nn(D, f) { let bi = 0, bd = Infinity; for (let i = 0; i < D.X.length; i++) { const x = D.X[i]; let d = 0; for (let j = 0; j < f.length; j++) { const e = x[j] - f[j]; d += e * e; } if (d < bd) { bd = d; bi = i; } } return { y: D.y[bi], d: bd }; }
