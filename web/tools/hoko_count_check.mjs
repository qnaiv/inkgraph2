// hoko_count_check.mjs: ガチホコバトルの「のこり」を読む（実フレームから切り出したバッジ 18 枚・推移の整え方・局面・b12 のカウント系タグ）
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { readBadge, hokoRow, hokoSeries, HOKO_BAND } from '../src/core/hoko_count.js';
import { isHokoRule, isAreaRule, isTowerRule, tagEvents } from '../src/core/analyzer.js';
import { toRecord } from '../src/ai_export.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const F = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/hoko_count/badges.json'), 'utf8'));
// 録画 7 試合から切り出した 90x80 の画像（しずく形のバッジ 1 つ）。値は人が画面を見て読んだもの（数字の見本には、これらを使っていない）
const band = f => { const raw = zlib.gunzipSync(Buffer.from(f.z, 'base64')), n = f.w * f.h, r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n); for (let i = 0; i < n; i++) { r[i] = raw[i * 3]; g[i] = raw[i * 3 + 1]; b[i] = raw[i * 3 + 2]; } return { w: f.w, h: f.h, r, g, b }; };

{ const bad = F.filter(f => readBadge(band(f), f.hue) !== f.v).map(f => `m${f.match}@${f.t} ${f.side}: ${readBadge(band(f), f.hue)} (正解 ${f.v})`);
  check(bad.length === 0, `(1) 実フレームのバッジを読む: ${F.length - bad.length}/${F.length}`, bad.join('; '));
  check(new Set(F.flatMap(f => String(f.v).split(''))).size === 10, '(2) 検証に 0〜9 の数字が全部入っている', [...new Set(F.flatMap(f => String(f.v).split('')))].sort().join('')); }
{ // 相手のチーム色の色相では、そのバッジを読まない（自チームと敵チームを取り違えない）
  const only = F.filter(f => F.filter(g => g.match === f.match && g.t === f.t).length === 1 && !(f.match == 5 && f.t === 55)) // 試合5 の 55 秒は、ホコの印の数字（隠れた「5」）を自チームのバッジと読み違える既知の例。推移の整理で捨てる（下の (7)）
   , bad = only.filter(f => readBadge(band(f), f.other) !== null).length;
  check(bad === 0 && only.length >= 12, '(3) もう一方のチームの色では、読まない（チームを取り違えない）', `${bad} 件 / ${only.length}`); }
{ // 画面（1280x720）の決まった位置に置いて、hokoRow で読む。th = [自分, 敵]
  const f = F.find(x => x.match == 2 && x.side === 'own'), bd = band(f), W = 1280, H = 720, data = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < data.length; i += 4) data[i + 3] = 255;
  for (let y = 0; y < bd.h; y++) for (let x = 0; x < bd.w; x++) { const o = ((HOKO_BAND[1] + y) * W + HOKO_BAND[0] + 100 + x) * 4, s = y * bd.w + x; data[o] = bd.r[s]; data[o + 1] = bd.g[s]; data[o + 2] = bd.b[s]; }
  const r = hokoRow({ w: W, h: H, data }, 12.34, [f.hue, f.other]), r2 = hokoRow({ w: W, h: H, data }, 12.34, [f.other, f.hue]);
  check(r.own === 63 && r.enemy === null && r.t === 12.3, '(4) 画面から、自チームのこり（63）を読み、敵は「読めず」', JSON.stringify(r));
  check(r2.enemy === 63 && r2.own === null, '(5) チームの色を入れ替えると、敵のこりとして読む', JSON.stringify(r2)); }

// 推移: 地図を開いたときの読み違い・隠れた数字の読み違いを捨て、減る一方にそろえる
const mkRows = (own, enemy) => own.map((o, i) => ({ t: i, own: o, enemy: enemy[i], grid: true }));
{ const n = 40, own = Array(n).fill(null), en = Array(n).fill(null);
  for (let t = 5; t < 40; t++) { own[t] = t < 12 ? 100 - (t - 4) * 4 : 72; en[t] = t < 20 ? null : 60; } // 自チームは 12 秒で 72 まで、敵は 20 秒から 60 のまま
  own[6] = 1; own[9] = 16; en[22] = 9; en[23] = 9; en[24] = 3; en[25] = 4; own[30] = 5; // 読み違い（地図を開いたとき・隠れた数字）。うち 4 つは連続
  const S = hokoSeries(mkRows(own, en)), rem = (i, k) => 100 - S[i][k];
  check(S[0].count_own === 0 && S[4].count_own === 0, '(6) 最初の読みまでは、のこり 100（カウント 0）');
  check(rem(8, 'count_own') === 84 && rem(30, 'count_own') === 72, '(7) 自チームのこり: 途中の読み違い（1・16・5）を捨てて 72 になる', `${rem(8, 'count_own')}, ${rem(30, 'count_own')}`);
  check(rem(30, 'count_enemy') === 60 && rem(39, 'count_enemy') === 60, '(8) 敵のこり: 連続した読み違い（9・9・3・4）を捨てて 60 を保つ', `${rem(30, 'count_enemy')}`);
  check(S.every((s, i) => i === 0 || (s.count_own >= S[i - 1].count_own && s.count_enemy >= S[i - 1].count_enemy)), '(9) カウント（100−のこり）は、増える一方になる');
  check(S[30].diff === 60 - 72 && S[30].owner === 'neutral', '(10) のこりの差（敵−自分）。保持チームは読まない', String(S[30].diff)); }
{ const S = hokoSeries(mkRows([null, null, 90, 89, 90, 88], [null, 100, null, null, null, null]));
  check(100 - S[5].count_own === 88 && 100 - S[3].count_own === 89, '(11) 1 だけ増えた読み（89→90）は、誤差として許す（減る一方は保つ）', `${100 - S[3].count_own}, ${100 - S[5].count_own}`);
  check(hokoSeries([]).length === 0 && hokoSeries(mkRows([null, null], [null, null]))[1].diff === 0, '(12) 読みが無くても壊れない（のこり 100 の同点）'); }

// 局面と、b12 のカウント系タグ
{ const own = Array(60).fill(null), en = Array(60).fill(null); for (let t = 10; t < 60; t++) { en[t] = Math.max(5, 100 - (t - 9) * 2); own[t] = t < 40 ? 100 - (t - 9) : 70 - (t - 40) * 2; }
  const S = hokoSeries(mkRows(own, en));
  const m = { battle: [0, 70], squid_down: {}, own_deaths: [{ start: 30, end: 33 }, { start: 55, end: 58 }], own_kills: [], special: [] }; tagEvents(m, S);
  check(m.tower_series.length === 60 && m.own_deaths[0].phase === '打開' && m.own_deaths[1].phase === '打開', '(13) ホコでも、デスに局面が付く（敵のほうがのこりが少ないとき「打開」）', m.own_deaths.map(d => d.phase).join());
  const rec = toRecord({ id: 'h1', created: '2026-11-01T10:00:00Z', battle: [1000, 1070], squid_down: {}, match_type: 'bankara_open', own_deaths: [], own_kills: [], special: [], tower_series: m.tower_series.map(s => ({ ...s, t: s.t + 1000 })), result_screen: { result: 'LOSE', mode: 'ガチホコバトル', stage: 'クサヤ温泉', own: { ka: 3, deaths: 4, specials: 1 } } });
  check(rec.rule === 'ガチホコバトル' && rec.tags.count && rec.tags.count.first_lead === 'enemy' && rec.tags.count.flow === 'straight_lose', '(14) ホコのカウントから、b12 のカウント系タグ（先行・ストレート負けなど）が付く', JSON.stringify(rec.tags.count)); }
check(isHokoRule('ガチホコバトル') && !isHokoRule('ガチエリア') && !isHokoRule('ガチヤグラ') && !isHokoRule(null) && !isTowerRule('ガチホコバトル') && !isAreaRule('ガチホコバトル'), '(15) ルールの判定: ホコは、ヤグラ・エリア用の読み取りを使わない');
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
