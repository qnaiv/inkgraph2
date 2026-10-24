// デス検出の「フレーム間引き」への強さを確かめるチェック（D52）。
// 1) 純関数: マップの開け閉めの合間に短く見えた「やられた」信号が、間引かれても 1 件のデスとして残るか。
// 2) --videos <json>: 実映像を 10fps で読み、ブラウザのように間隔 0.2/0.3/0.4 秒・ばらつきありで間引いた
//    フレーム列を Analyzer に流し、旧平滑化（全フレームで中央値）と新平滑化（deathSignal）のデス数を、
//    0.2 秒間隔・旧平滑化の結果（試合後の数え方の基準）と比べる。
// 使い方: node tools/death_sparse_check.mjs [--videos v.json] [--out result.json]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { prepAssets } from '../src/core/assets.js';
import { Analyzer, mergeDeathRuns, deathSignal } from '../src/core/analyzer.js';
import { medfilt } from '../src/core/img.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const videosPath = opt('--videos'), outPath = opt('--out');
let pass = 0, fail = 0; const out = { unit: [], videos: [] };
const check = (name, okv, detail) => { (okv ? pass++ : fail++); console.log(`[${okv ? 'PASS' : 'FAIL'}] ${name} - ${detail}`); out.unit.push({ name, ok: okv, detail }); };
const deathsOld = F => mergeDeathRuns(F.map(f => f.t), medfilt(F.map(f => f.sig), 5), F.map(f => f.ok), F.map(f => f.map));
const deathsNew = F => mergeDeathRuns(F.map(f => f.t), deathSignal(F), F.map(f => f.ok), F.map(f => f.map));
const mk = (t0, step, spec) => spec.split('').map((c, i) => ({ t: +(t0 + i * step).toFixed(2), ok: c !== 'M' && c !== 'H', map: c === 'M', sig: c === 'S' }));

// (a) joined_match02 68.0 秒と同じ形（5fps）: 生存→マップ→信号3枚→マップ3枚→信号4枚→生存
{ const F = mk(60, 0.2, 'A'.repeat(10) + 'M'.repeat(17) + 'SSS' + 'MMM' + 'SSSS' + 'A'.repeat(10));
  const o = deathsOld(F), n = deathsNew(F); check('(a) 5fps・マップの合間の信号 → 新旧とも 1 件', o.length === 1 && n.length === 1, `old=${JSON.stringify(o)} new=${JSON.stringify(n)}`); }
// (b) 同じ場面を約 0.4 秒間隔に間引く（信号 2 枚・2 枚）→ 旧は 0 件、新は 1 件
{ const F = mk(60, 0.4, 'A'.repeat(5) + 'M'.repeat(8) + 'SS' + 'M' + 'SS' + 'A'.repeat(5));
  const o = deathsOld(F), n = deathsNew(F); check('(b) 0.4秒間隔・信号2枚+2枚 → 新は 1 件（旧は落とす）', o.length === 0 && n.length === 1, `old=${JSON.stringify(o)} new=${JSON.stringify(n)}`); }
// (c) 生存中の 1 枚だけの誤検出は今まで通り消える
{ const F = mk(10, 0.2, 'A'.repeat(10) + 'S' + 'A'.repeat(10));
  const n = deathsNew(F); check('(c) 生存中の 1 枚の誤検出は数えない', n.length === 0, `new=${JSON.stringify(n)}`); }
// (d) マップ表示をはさんで 1 枚の誤検出 → 数えない（短すぎる）
{ const F = mk(10, 0.2, 'A'.repeat(10) + 'M'.repeat(5) + 'S' + 'M'.repeat(5) + 'A'.repeat(10));
  const n = deathsNew(F); check('(d) マップの合間の 1 枚だけの信号は数えない', n.length === 0, `new=${JSON.stringify(n)}`); }
// (e) 普通のデス（信号 6 秒、マップなし）は新旧同じ
{ const F = mk(10, 0.2, 'A'.repeat(10) + 'S'.repeat(30) + 'A'.repeat(10));
  const o = deathsOld(F), n = deathsNew(F); check('(e) 普通のデスは新旧同じ', JSON.stringify(o) === JSON.stringify(n) && n.length === 1, `old=${JSON.stringify(o)} new=${JSON.stringify(n)}`); }
// (f) 生存 1.0 秒以上をはさむ 2 回のデスは 2 件のまま
{ const F = mk(10, 0.2, 'S'.repeat(10) + 'A'.repeat(6) + 'S'.repeat(10));
  const n = deathsNew(F); check('(f) 生存1秒以上をはさむ2回のデスは2件', n.length === 2, `new=${JSON.stringify(n)}`); }
// (g) Chrome の <video> でシークしたフレーム列そのもの（joined_match02 63.6〜71.0 秒、ok/map/sig を tools/death_browser_cues.mjs で取得）。
//     ffmpeg より約 1 フレーム遅い絵になり、信号が 2 枚＋4 枚になる。旧は 0 件、新は 1 件。
{ const spec = '100 100 101 101 100 000 010 010 010 010 010 010 010 010 010 010 010 010 010 010 010 010 010 101 101 010 010 010 010 101 101 101 101 010 010 010 010 010'.split(' ');
  const F = spec.map((c, i) => ({ t: +(63.6 + i * 0.2).toFixed(1), ok: c[0] === '1', map: c[1] === '1', sig: c[2] === '1' }));
  const o = deathsOld(F), n = deathsNew(F); check('(g) ブラウザのシーク結果（b_match02 68秒付近）→ 新は 68.2 秒の 1 件（旧は落とす）', o.length === 0 && n.length === 1 && Math.abs(n[0][0] - 68.2) < 0.3, `old=${JSON.stringify(o)} new=${JSON.stringify(n)}`); }
// (h) 生存中の 1 枚ずつの誤検出（275.8・276.2）→ マップ 2.4 秒 → 本物のデス（278.8〜）。デスの始まりを前へずらさない
//     （b_match02 278.8 秒付近のブラウザのシーク結果。最初の版はここを 276.0 からのデスにしていた）
{ const spec = '100 100 100 100 100 100 100 100 100 101 100 101 010 010 010 010 010 010 010 010 010 010 010 010 101 101 101 010 010 010 101 101 000 010 010 101 101 101 010 101 100 100 100 100 100 100'.split(' ');
  const F = spec.map((c, i) => ({ t: +(274 + i * 0.2).toFixed(1), ok: c[0] === '1', map: c[1] === '1', sig: c[2] === '1' }));
  const n = deathsNew(F); check('(h) 生存中の誤検出からマップをはさんでデスへつながない（b_match02 278.8秒付近）', n.length === 1 && Math.abs(n[0][0] - 278.8) < 0.3, `new=${JSON.stringify(n)}`); }

async function runVideo(name, video) {
  const srcH = +execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "${video}"`).toString().trim() || 1080;
  const A = prepAssets(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/assets/inkgraph_assets.json'), 'utf8')));
  // 10fps のフレーム番号 n に対し、各パターンが次に取る番号を決める
  const patterns = { '0.2': [2], '0.3': [3], '0.4': [4], 'ばらつき': [2, 3, 4, 3, 2, 4, 4, 3] };
  const runs = Object.entries(patterns).map(([key, steps]) => {
    const r = { key, steps, next: 0, k: 0, Fs: [] };
    r.an = new Analyzer(A, { srcH, onMatch: () => {} });
    const fin = r.an.finish.bind(r.an); r.an.finish = (...a) => { if (r.an.cur && r.an.cur.F) r.Fs.push(r.an.cur.F.map(f => ({ t: f.t, ok: f.ok, map: f.map, sig: f.sig }))); return fin(...a); };
    return r; });
  const W = 1280, H = 720, FS = W * H * 4;
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=10,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  let buf = Buffer.alloc(0), n = 0;
  for await (const ch of ff.stdout) { buf = Buffer.concat([buf, ch]);
    while (buf.length >= FS) { const d = new Uint8ClampedArray(buf.subarray(0, FS)); buf = buf.subarray(FS); const t = +(n * 0.1).toFixed(1);
      for (const r of runs) if (n >= r.next) { r.an.frame({ w: W, h: H, data: d }, t); r.next = n + r.steps[r.k++ % r.steps.length]; }
      n++; } }
  for (const r of runs) { if (r.an.state === 'battle' || r.an.state === 'result') { if (r.an.cur && r.an.cur.F) r.Fs.push(r.an.cur.F.map(f => ({ t: f.t, ok: f.ok, map: f.map, sig: f.sig }))); } }
  const base = runs[0].Fs.flatMap(F => deathsOld(F).map(([a]) => a));
  const near = (xs, ys) => xs.filter(x => ys.some(y => Math.abs(x - y) <= 1.0)).length;
  const res = { name, base };
  for (const r of runs) { const o = r.Fs.flatMap(F => deathsOld(F).map(([a]) => a)), nw = r.Fs.flatMap(F => deathsNew(F).map(([a]) => a));
    res[r.key] = { old: o, new: nw, old_hit: near(base, o), new_hit: near(base, nw) };
    console.log(`[VIDEO] ${name} 間隔${r.key}: 基準 ${base.length} 件 / 旧 ${o.length}件(一致${near(base, o)}) / 新 ${nw.length}件(一致${near(base, nw)})`); }
  return res;
}

// 判定は正解（labels/killer/killer_truth.json のデスの始まり、±1.0秒）と照らす。
// 5fps の基準（旧の平滑化）自体が b_match02 68 秒を落とすので、基準との完全一致は求めない
const fromPath = opt('--from');
if (videosPath || fromPath) {
  if (fromPath) out.videos = JSON.parse(fs.readFileSync(fromPath, 'utf8')).videos;
  else { const V = JSON.parse(fs.readFileSync(videosPath, 'utf8'));
    for (const [name, video] of Object.entries(V)) { const r = await runVideo(name, video); out.videos.push(r); if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 1)); } }
  const truthAll = JSON.parse(fs.readFileSync(new URL('../../labels/killer/killer_truth.json', import.meta.url), 'utf8'));
  const tr = name => truthAll.filter(e => e.video === name).map(e => e.death_start);
  const hitN = (T, xs) => T.filter(x => xs.some(y => Math.abs(x - y) <= 1.0)).length;
  const falseOf = (T, xs) => xs.filter(y => !T.some(x => Math.abs(x - y) <= 1.0));
  const keys = ['0.2', '0.3', '0.4', 'ばらつき']; let tt = 0; const sum = {};
  for (const r of out.videos) tt += tr(r.name).length;
  for (const k of keys) { const s = sum[k] = { old_hit: 0, new_hit: 0, old_false: [], new_false: [] };
    for (const r of out.videos) { const T = tr(r.name);
      s.old_hit += hitN(T, r[k].old); s.new_hit += hitN(T, r[k].new);
      s.old_false.push(...falseOf(T, r[k].old).map(y => `${r.name}@${y}`)); s.new_false.push(...falseOf(T, r[k].new).map(y => `${r.name}@${y}`)); }
    console.log(`[SUM] 間隔${k}: 正解 ${tt} 件 / 旧 一致 ${s.old_hit}・誤検出 ${s.old_false.length} / 新 一致 ${s.new_hit}・誤検出 ${s.new_false.length}${s.new_false.length ? ' ' + s.new_false.join(',') : ''}`); }
  out.summary = { truth: tt, ...sum };
  for (const k of keys) check(`間隔${k}で新しい平滑化は旧より正解に多く（同数以上）一致し、誤検出は増えない`, sum[k].new_hit >= sum[k].old_hit && sum[k].new_false.length <= sum[k].old_false.length, `正解 ${tt} / 旧 ${sum[k].old_hit}・誤${sum[k].old_false.length} / 新 ${sum[k].new_hit}・誤${sum[k].new_false.length}`);
  check('5fps（0.2秒）で基準（旧）のデスを新でも全部拾う', out.videos.every(r => r['0.2'].new_hit === r.base.length), out.videos.filter(r => r['0.2'].new_hit !== r.base.length).map(r => r.name).join(',') || '全試合');
}
if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(fail ? `FAIL ${fail} / PASS ${pass}` : `ALL ${pass} PASS`); process.exit(fail ? 1 : 0);
