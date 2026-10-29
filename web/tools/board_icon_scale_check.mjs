// board_icon_scale_check.mjs: D86 結果画面ボードのブキの絵の切り出しが、映像の大きさ（720p / 1080p）によらず同じ場所になる
import { boardIconGray, BI, ROW_Y } from '../src/core/board_icons.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
// 720p の映像: 全体は暗く、(上段・1 行目) のブキの位置にだけ明るい四角を置く
const mk = (w, h) => { const d = new Uint8ClampedArray(w * h * 4), k = w / 1280; for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 20; d[i * 4 + 3] = 255; }
  const x0 = BI.x0 + 10, y0 = ROW_Y.top[1] + 8; for (let y = Math.round(y0 * k); y < Math.round((y0 + 14) * k); y++) for (let x = Math.round(x0 * k); x < Math.round((x0 + 24) * k); x++) { const p = (y * w + x) * 4; d[p] = d[p + 1] = d[p + 2] = 230; }
  return { w, h, data: d }; };
const g720 = boardIconGray(mk(1280, 720), 0, 0, 'top', 1), g1080 = boardIconGray(mk(1920, 1080), 0, 0, 'top', 1);
const bright = g => g.reduce((n, v) => n + (v > 128 ? 1 : 0), 0);
check(bright(g720) === 24 * 14, '(1) 720p: 明るい四角が切り出しの中に 24x14 で入る', String(bright(g720)));
check(Math.abs(bright(g1080) - 24 * 14) <= 24, '(2) 1080p でも同じ場所・同じ大きさで入る（以前は別の場所を読んでいた）', String(bright(g1080)));
let diff = 0; for (let i = 0; i < g720.length; i++) diff += Math.abs(g720[i] - g1080[i]); check(diff / g720.length < 8, '(3) 720p と 1080p の切り出しがほぼ同じ', 'diff=' + (diff / g720.length).toFixed(2));
const edge = boardIconGray(mk(1920, 1080), -700, 0, 'top', 0); check(edge.length === BI.w * BI.h, '(4) 画面の外にはみ出す位置でも落ちない');
console.log(fails ? `FAIL ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
