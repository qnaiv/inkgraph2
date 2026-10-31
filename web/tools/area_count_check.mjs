// area_count_check.mjs: ガチエリアの「のこり」カウントを読む（数字の見本・パネルの読み取り・推移の整え方）
import fs from 'node:fs'; import path from 'node:path';
import { AREA_DIGITS } from '../src/core/area_digits.js'; import { areaRow, areaSeries, classify, AREA_PANELS } from '../src/core/area_count.js';
import { isAreaRule, isTowerRule, tagEvents } from '../src/core/analyzer.js'; import { b64bytes } from '../src/core/img.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const F = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/area_count/glyphs.json'), 'utf8')).glyphs;
const vec = ([, , ar, b64]) => { const v = new Float32Array(97); v.set(Float32Array.from(b64bytes(b64), x => x / 255)); v[96] = ar; return v; };

// (1) 見本: 人が読んだ 371 個の数字を、その試合を除いた見本で当てる（試合ごとの入れ替え検証）
{ const ms = [...new Set(F.map(g => g[0]))]; let hit = 0;
  for (const m of ms) { const train = F.filter(g => g[0] !== m).map(g => ({ y: g[1], x: vec(g) }));
    for (const g of F.filter(g => g[0] === m)) { const v = vec(g); let by = null, bd = 1e9; for (const t of train) { let d = 0; for (let j = 0; j < 97; j++) { const e = t.x[j] - v[j]; d += e * e; } if (d < bd) { bd = d; by = t.y; } } if (by === g[1]) hit++; } }
  check(ms.length >= 9 && hit / F.length >= 0.97, `(1) 数字の読み取り（見本から外した試合で検証）: ${hit}/${F.length}`, `${(100 * hit / F.length).toFixed(1)}%`);
  check(new Set(AREA_DIGITS.map(r => r[0])).size === 10, '(2) 組み込みの見本は 0〜9 の全部がある'); }

// 画面を作る: パネルの塗りと数字（見本の絵を拡大）
const W = 1280, H = 720; const glyphBits = ch => { const rows = AREA_DIGITS.filter(r => r[0] === ch); const r = rows[0]; return { ar: r[1], d: b64bytes(r[2]) }; };
function frame(own, enemy, style) {
  const data = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < data.length; i += 4) { data[i] = 90; data[i + 1] = 110; data[i + 2] = 80; data[i + 3] = 255; }
  const paint = (rect, val, st) => { const [x0, y0, x1, y1] = rect; const colored = st === 'colored';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * W + x) * 4; [data[o], data[o + 1], data[o + 2]] = colored ? [235, 100, 130] : [25, 22, 30]; }
    if (val === null) return; const s = String(val), gh = 26; let x = x0 + (x1 - x0 - s.length * 16) / 2 + 2;
    for (const ch of s) { const g = glyphBits(ch), gw = Math.max(5, Math.round(g.ar * gh));
      for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++) { if (g.d[Math.floor(yy * 12 / gh) * 8 + Math.floor(xx * 8 / gw)] > 128) { const o = ((y0 + 7 + yy) * W + Math.round(x) + xx) * 4; [data[o], data[o + 1], data[o + 2]] = colored ? [250, 250, 250] : [200, 200, 245]; } }
      x += gw + 3; } };
  paint(AREA_PANELS.own, own, style[0]); paint(AREA_PANELS.enemy, enemy, style[1]); return { w: W, h: H, data };
}
{ const cases = [[100, 100, ['dark', 'dark']], [98, 61, ['dark', 'colored']], [75, 50, ['colored', 'dark']], [41, 9, ['colored', 'dark']], [30, 24, ['dark', 'colored']]];
  const bad = []; for (const [o, e, st] of cases) { const r = areaRow(frame(o, e, st), 5); if (r.own !== o || r.enemy !== e) bad.push(`${o}/${e} → ${r.own}/${r.enemy}`); }
  check(!bad.length, '(3) パネルが暗くても色付きでも、のこりを読む（1〜3 桁）', bad.join('; '));
  const blank = areaRow(frame(null, null, ['dark', 'dark']), 5); check(blank.own === null && blank.enemy === null, '(4) 数字が無い画面（リザルトなど）では読まない'); }

// 推移: 読み違い・欠けを除き、減る一方にそろえる
{ const rows = []; let o = 100, e = 100; for (let t = 0; t < 60; t++) { if (t > 10) e = Math.max(0, e - 2); if (t > 30) o = Math.max(0, o - 1); rows.push({ t, own: o, enemy: e, grid: true }); }
  rows[20].enemy = 4; rows[25].own = null; rows[26].enemy = null; rows[40].own = 100; rows[41].enemy = 7; // 読み違い・欠け・増える読み
  const S = areaSeries(rows); const at = t => S.find(s => s.t === t);
  check(Math.abs((100 - at(20).count_enemy) - 80) <= 2, '(5) 1 回だけの読み違い（80 が 4 など）は無視する', String(100 - at(20).count_enemy));
  check(S.every((s, i) => i === 0 || s.count_own >= S[i - 1].count_own && s.count_enemy >= S[i - 1].count_enemy), '(6) カウント（100−のこり）は、増える一方になる');
  check(Math.abs((100 - at(59).count_own) - o) <= 1 && Math.abs((100 - at(59).count_enemy) - e) <= 1, '(7) 最後は読んだ値（±1）に合う', `${100 - at(59).count_own}/${100 - at(59).count_enemy} vs ${o}/${e}`);
  check(at(5).diff === 0 && at(30).diff < -20 && at(5).owner === 'neutral', '(8) のこりの差（敵−自分）は、敵が先に減れば負。保持チームは読まない'); }

// 局面: エリアの推移でも、デスに局面が付く（ヤグラと同じ関数）
{ const S = areaSeries(Array.from({ length: 40 }, (_, t) => ({ t, own: t > 20 ? 100 - (t - 20) * 2 : 100, enemy: 100, grid: true })));
  const m = { battle: [0, 60], squid_down: {}, own_deaths: [{ start: 30, end: 33 }], own_kills: [], special: [] }; tagEvents(m, S);
  check(m.own_deaths[0].phase === '抑え' && m.tower_series.length === 40, '(9) 自分が先に減っているとき、そのデスは「抑え」', m.own_deaths[0].phase); }

check(isAreaRule('ガチエリア') && !isAreaRule('ガチヤグラ') && !isAreaRule(null) && !isTowerRule('ガチエリア'), '(10) ルールの判定: エリアはヤグラ用の読み取りを使わない');
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
