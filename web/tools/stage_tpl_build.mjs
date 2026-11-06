// stage_tpl_build.mjs: 録画（D:\splatoon など）の結果画面から、ステージ名の見本（templates/res_stage/<ステージ>__<印>.png、145x32 のグレー）を作る
// 録画のファイル名 `日付_時刻_ルール_ステージ_マッチタイプ_勝敗.mp4` のステージ名を正解として使う（ステージ不明・要修正は使わない）
// usage: node web/tools/stage_tpl_build.mjs <録画フォルダ> <ffmpeg> [--write] [--per 3] [--only ステージ名]
//   --write なし: 読み取りだけ（見本は書かない）。各録画の結果画面で、いまの見本が何と読むか・ステージ名の位置のずれを表示する
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { prepAssets } from '../src/core/assets.js';
import { classify, stageDxCandidates } from '../src/core/result.js';
import { crop, gray } from '../src/core/img.js';

const args = process.argv.slice(2), flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const [dir, ffmpeg] = args.filter(a => !a.startsWith('--')).slice(0, 2);
const SKIP = new Set(String(flag('--skip', '')).split(',').filter(Boolean)); // 例: ガチエリア/x（プライベートマッチの見出しは並びが違い、位置が合わない）
const WRITE = args.includes('--write'), PER = Number(flag('--per', 3)), ONLY = flag('--only', null);
const ROOT = path.resolve(import.meta.dirname, '../..'), OUT = path.join(ROOT, 'templates/res_stage');
const A = prepAssets(JSON.parse(fs.readFileSync(path.join(ROOT, 'web/public/assets/inkgraph_assets.json'), 'utf8')));
const STAGE_BOX = [655, 52, 800, 84];
const W = 1280, H = 720, FB = W * H * 4;

function pearson(a, b) { let ma = 0, mb = 0; const n = a.length; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; } return s / (Math.sqrt(sa * sb) + 1e-6); }
// 録画の最後の 45 秒を 1 秒おきに取り出し、結果画面（ボード）が出ているコマを集める
function resultFrames(video) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-sseof', '-45', '-i', video, '-vf', `fps=1,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  const b = r.stdout || Buffer.alloc(0), out = [];
  for (let i = 0; i + FB <= b.length; i += FB) {
    const fr = { w: W, h: H, data: new Uint8ClampedArray(b.buffer.slice(b.byteOffset + i, b.byteOffset + i + FB)) };
    const c = classify(A, fr); if (c && (c.kind === 'board' || c.kind === 'personal')) out.push({ fr, off: c.off, panel: c.panel });
  }
  return out;
}
const cropAt = (fr, off, sdx) => { const c = crop(fr, STAGE_BOX[0] + off[0] + sdx, STAGE_BOX[1] + off[1], STAGE_BOX[2] + off[0] + sdx, STAGE_BOX[3] + off[1]); return { w: c.w, h: c.h, g: gray(c) }; };
// ステージ名の特徴（result.js の normText と同じ。2 値化して 120x32）
import { bin, resizeArea } from '../src/core/img.js';
const norm = c => { const b = bin(c.g, 170); for (let i = 0; i < b.length; i++) b[i] *= 255; return resizeArea(b, c.w, c.h, 120, 32); };
const bestOf = v => { let bk = null, bs = -1; for (const [k, t] of Object.entries(A.lib.stage)) { const s = pearson(v, t); if (s > bs) { bs = s; bk = k; } } return [bk && bk.split('__')[0], bs]; };
function savePng(c, file) { // ffmpeg でグレーの生データを PNG にする
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${c.w}x${c.h}`, '-i', '-', file], { input: Buffer.from(c.g) });
  if (r.status !== 0) throw new Error('ffmpeg png failed: ' + r.stderr);
}

const files = fs.readdirSync(dir).filter(f => /^\d{8}_\d{4}_.+\.mp4$/.test(f)).sort();
const byStage = new Map(), report = [];
for (const f of files) {
  const [, , rule, stage] = f.replace(/\.mp4$/, '').split('_'); if (!stage || /不明|要修正/.test(stage) || (ONLY && stage !== ONLY)) continue;
  const frs = resultFrames(path.join(dir, f)); if (!frs.length) { report.push({ f, stage, rule, note: 'no-header' }); continue; }
  const pick = frs[frs.length >> 1], sdxs = stageDxCandidates(rule, pick.panel);
  // いまの見本で、ずれの候補のうち一番合うもの
  let best = null; for (let d = 0; d <= 60; d += 1) { const c = cropAt(pick.fr, pick.off, d), [k, s] = bestOf(norm(c)); if (!best || s > best.s) best = { d, k, s }; }
  const ref = cropAt(pick.fr, pick.off, sdxs[0]); const [rk, rs] = bestOf(norm(ref));
  report.push({ f, stage, rule, frames: frs.length, panel: pick.panel, read: rk, score: Math.round(rs * 100) / 100, scan_dx: best.d, scan_name: best.k, scan_score: Math.round(best.s * 100) / 100 });
  if (!byStage.has(stage)) byStage.set(stage, []); byStage.get(stage).push({ f, rule, panel: pick.panel, c: ref, sdx: sdxs[0] });
}
console.log(JSON.stringify(report, null, 1));
// 検証: 切り出した見本を、その録画を除いた残り（と今の辞書）で当てる。ルール・画面の種類ごとの正答
{ const all = []; for (const [stage, items] of byStage) for (const it of items) all.push({ stage, ...it, v: norm(it.c) });
  const acc = {}; for (const t of all) { const lib = Object.entries(A.lib.stage).map(([k, v]) => [k.split('__')[0], v]).concat(all.filter(o => o.f !== t.f).map(o => [o.stage, o.v]));
    let bk = null, bs = -1; for (const [k, v] of lib) { const sc = pearson(t.v, v); if (sc > bs) { bs = sc; bk = k; } }
    const key = `${t.rule}/${t.panel}`, a = (acc[key] ||= { n: 0, ok: 0, wrong: [] }); a.n++; if (bk === t.stage && bs > 0.5) a.ok++; else a.wrong.push(`${t.stage}→${bk}(${bs.toFixed(2)})`); }
  console.error('LOO 検証（その録画を除いた見本で当てる）'); for (const [k, a] of Object.entries(acc)) console.error(k, `${a.ok}/${a.n}`, a.wrong.slice(0, 6).join(' ')); }
if (WRITE) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [stage, items] of byStage) {
    // 同じステージの見本どうしの似かたが低い（取り違えの疑い）ものは入れない。ルールごとに 1 つずつ、PER 個まで
    const seen = new Set(), keep = [];
    for (const it of items) { if (SKIP.has(`${it.rule}/${it.panel}`)) continue; const k = `${it.rule}/${it.panel}`; if (seen.has(k)) continue; seen.add(k); keep.push(it); if (keep.length >= PER) break; }
    keep.forEach((it, i) => { const name = `${stage}__d112${it.panel === 'x' ? 'x' : 'b'}${i + 1}_${it.rule === 'ガチホコバトル' ? 'hoko' : it.rule === 'ガチアサリ' ? 'asari' : it.rule === 'ガチエリア' ? 'area' : it.rule === 'ガチヤグラ' ? 'yagura' : 'other'}.png`; savePng(it.c, path.join(OUT, name)); console.log('wrote', name); });
  }
}
