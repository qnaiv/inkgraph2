// D47: やられた相手のブキ名の見本を作る／精度を測る
// 使い方: node tools/killer_lib_build.mjs --videos videos.json [--out ../templates/killer_lib.json] [--eval]
//   videos.json: {"<labels の video 名>": "<動画ファイルのパス>"}。正解は labels/killer/killer_truth.json（目視）。
//   各デスの +1.0〜+8.0 秒を 5fps で読み、アプリと同じ readKiller で 1 フレームずつ読む。
//   --eval: 試合ごとに見本から外して当てる（その試合の見本を使わない）精度と、デスごとに外す精度を表示。
import fs from 'fs'; import path from 'path'; import { spawnSync } from 'child_process'; import { fileURLToPath } from 'url';
import { b64bytes } from '../src/core/img.js';
import { readKiller, matchName, decideKiller, encodeFeat, prepKiller, killerKind, KP } from '../src/core/killer.js';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const videos = JSON.parse(fs.readFileSync(arg('--videos'), 'utf8'));
const truth = JSON.parse(fs.readFileSync(path.join(root, 'labels', 'killer', 'killer_truth.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(root, 'web', 'public', 'assets', 'inkgraph_assets.json'), 'utf8'));
const K = prepKiller({ tpl: assets.killer.tpl, lib: [] }, b64bytes), A = { killer: K };
const FS = 1280 * 720 * 4, scans = [];
for (const e of truth) {
  const src = videos[e.video]; if (!src) { console.error('動画が無い:', e.video); process.exit(1); }
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-ss', String(e.death_start + KP.from), '-i', src, '-t', String(KP.to - KP.from + 0.2), '-vf', 'fps=5,scale=1280:720:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  const reads = []; for (let i = 0; (i + 1) * FS <= r.stdout.length; i++) { const k = readKiller(A, { w: 1280, h: 720, data: r.stdout.subarray(i * FS, (i + 1) * FS) }); if (k) reads.push(k); }
  scans.push({ ...e, reads }); process.stderr.write(`${e.video} ${e.death_start} ${e.killer ?? '(吹き出し無し)'} 読めたフレーム ${reads.length}\n`);
}
const sample = d => d.reads.reduce((a, b) => (b.yar > a.yar ? b : a));
const libFrom = list => list.filter(d => d.killer && d.reads.length).map(d => { const s = sample(d); return { name: d.killer, kind: killerKind(d.killer), ar: s.ar, f: s.f }; });
if (process.argv.includes('--eval')) {
  for (const mode of ['試合ごとに外す', 'デスごとに外す']) { let ok = 0, wrong = 0, unk = 0, noread = 0, n = 0; const bad = [];
    for (const d of scans) { n++; const lib = libFrom(scans.filter(y => (mode === '試合ごとに外す' ? y.video !== d.video : y !== d)));
      const reads = d.reads.map(r => ({ ...r, ...matchName({ killer: { lib } }, r.f, r.ar) })); const k = decideKiller(reads);
      const inLib = lib.some(l => l.name === d.killer), want = inLib ? d.killer : null;
      if (!d.killer) { if (!k) ok++; else { wrong++; bad.push([d.video, d.death_start, '(吹き出し無し)', k.name]); } continue; }
      if (!k) { noread++; bad.push([d.video, d.death_start, d.killer, '読めず']); continue; }
      if (k.name === want) ok++; else if (k.name) { wrong++; bad.push([d.video, d.death_start, d.killer, k.name, k.score]); } else { unk++; bad.push([d.video, d.death_start, d.killer, '未登録扱い', k.score]); } }
    console.log(`${mode}: 正しい ${ok}/${n}（取り違え ${wrong}・見本にあるのに未登録 ${unk}・読めず ${noread}）`); bad.forEach(b => console.log('  ', b.join(' '))); }
}
const out = arg('--out'); if (out) { const lib = libFrom(scans).map(e => ({ name: e.name, kind: e.kind, ar: +e.ar.toFixed(3), f: encodeFeat(e.f) }));
  fs.writeFileSync(out, JSON.stringify({ note: 'D47 やられた相手のブキ名の見本（labels/killer/killer_truth.json から web/tools/killer_lib_build.mjs で生成）', lib }, null, 0) + '\n'); console.log('wrote', out, lib.length); }
