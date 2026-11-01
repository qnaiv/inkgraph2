// tricolor_layout_check.mjs: トリカラバトルのタイマーは画面の左上にある。その位置でもバトルを検知し、トリカラと分かる（D107）
//   動画は使わず、タイマーのコロンの見本を、通常の位置・トリカラの位置に貼った合成フレームで確かめる
import fs from 'node:fs'; import path from 'node:path';
import { prepAssets } from '../src/core/assets.js';
import { timerBox, TIMER_BOXES } from '../src/core/cues.js';
import { Analyzer, aliveAt } from '../src/core/analyzer.js';
import { resultOf, effective, MATCH_TYPE_LABEL } from '../src/analysis.js';
import { toRecord } from '../src/ai_export.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const D = path.resolve(import.meta.dirname, '..'), dir = path.join(D, 'public/assets');
const A = prepAssets(JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.json'))))));
const W = 1280, H = 720, T = A.tpl.tpl_colon;
// 黒い画面に、コロンの見本の「点いている所」を白で貼る（box の左上から 8px 内側）
const frame = box => {
  const data = new Uint8ClampedArray(W * H * 4); for (let i = 3; i < data.length; i += 4) data[i] = 255;
  if (box >= 0) { const [x0, y0] = TIMER_BOXES[box]; for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) if (T.bits[y * T.w + x]) { const o = ((y0 + 8 + y) * W + x0 + 8 + x) * 4; data[o] = data[o + 1] = data[o + 2] = 255; } }
  return { w: W, h: H, data };
};
check(timerBox(A, frame(0)) === 0, '(1) 通常の位置（画面上部の中央）のタイマーは、0 番として見つかる');
check(timerBox(A, frame(1)) === 1, '(2) トリカラの位置（左上）のタイマーは、1 番として見つかる');
check(timerBox(A, frame(-1)) === -1, '(3) タイマーが無い画面は、見つからない');

const run = box => { const recs = []; const an = new Analyzer(A, { onMatch: r => recs.push(r) });
  for (let t = 0; t <= 80; t += 1) an.frame(frame(box), t);      // 80 秒ぶんタイマーがある（battle_min は 60 秒）
  for (let t = 81; t <= 120; t += 1) an.frame(frame(-1), t);     // その後タイマーが消える
  an.flush(); return recs; };
{ const r = run(1);
  check(r.length === 1 && r[0].battle[1] - r[0].battle[0] >= 60, '(4) トリカラの位置のタイマーだけでも、バトルが 1 試合として検知される', r.length ? JSON.stringify(r[0].battle) : '0 試合');
  check(r[0] && r[0].hud_layout === 'tricolor', '(5) タイマーの位置から、記録に hud_layout: tricolor が付く');
  const m = r[0], rs = resultOf(m);
  check(rs.match_type === 'fest_tricolor' && MATCH_TYPE_LABEL[rs.match_type] === 'トリカラマッチ' && rs.mode === 'ナワバリバトル', '(6) マッチタイプはトリカラ、ルールはナワバリバトルとして扱う（人が直した値があればそちらが優先）', `${rs.match_type} / ${rs.mode}`);
  const m2 = { ...m, review: { marks: {}, rmarks: {}, fix: { match_type: 'fest_open', mode: 'ガチエリア' }, added: [] } }, rs2 = resultOf(m2);
  check(rs2.match_type === 'fest_open' && rs2.mode === 'ガチエリア', '(7) 人が直した値は、自動の判定より優先される');
  const withDeath = { ...m, own_deaths: [{ start: 30, end: 33 }], squid_down: { L0: [{ start: 30, end: 33 }], L1: [], L2: [], L3: [], R0: [{ start: 10, end: 90 }], R1: [], R2: [], R3: [] } };
  check(aliveAt(withDeath, 31).join('v') === '4v4', '(8) 3 チームの HUD では人数の枠の位置が違うので、人数は読まず、中立の 4v4 を返す');
  const ev = effective(withDeath).find(e => e.kind === 'death');
  check(ev && ev.alive === undefined && ev.man === undefined, '(9) トリカラのデスには、人数・人数差を付けない（間違った「人数不利」を出さない）', JSON.stringify({ alive: ev && ev.alive, man: ev && ev.man }));
  const rec = toRecord(withDeath); check(rec.death_ctx.length === 1 && rec.death_ctx[0].man === undefined, '(10) AI 用の記録の death_ctx にも、人数差は入らない'); }
{ const r = run(0);
  check(r.length === 1 && r[0].hud_layout === undefined, '(11) 通常の位置のタイマーは、これまでどおり検知され、トリカラにはならない'); }
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
