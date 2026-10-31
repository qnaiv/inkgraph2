// regress_import.mjs: 要修正パック（展開済みフォルダ）を、回帰テストの正解データ（動画なし）に取り込む
// 使い方: node tools/regress_import.mjs <展開したフォルダ>    例: node tools/regress_import.mjs D:/splatoonAI/extracted
//   - 人が全件確認した試合（diff.json の unreviewed が 0）だけを取り込む。確認していない試合は正解が無いので飛ばす
//   - fixtures/regress/<試合ID>/software.json … 解析に要る信号（cues など）と結果画面だけ。録画のパス・静止画・アイコンは入れない
//   - fixtures/regress/<試合ID>/truth.json   … 人が直した後のデス・キル・スペシャルの時刻（diff.json の confirmed + misses）
//   - 取り込み後に `node tools/regress_check.mjs --update` で baseline.json を作り直す（精度が上がったときだけ）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2];
if (!root) { console.error('使い方: node tools/regress_import.mjs <展開したフォルダ>'); process.exit(2); }
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'regress');
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const KEEP = ['id', 'battle', 'cues', 'team_hue', 'result_screen', 'match_type', 'source'];
let n = 0, skipped = 0;
for (const d of fs.readdirSync(path.join(root, 'matches')).sort()) {
  const dir = path.join(root, 'matches', d), sw = rj(path.join(dir, 'software.json')), df = rj(path.join(dir, 'diff.json'));
  if (df.unreviewed > 0) { skipped++; console.log('skip（未確認あり）', d); continue; }
  const m = {}; for (const k of KEEP) if (sw[k] !== undefined) m[k] = sw[k];
  if (m.source) m.source = { height: m.source.height };
  const truth = { events: [...df.confirmed, ...df.misses].map(e => ({ kind: e.kind, t: e.t })).sort((a, b) => a.t - b.t) };
  const o = path.join(out, d); fs.mkdirSync(o, { recursive: true });
  fs.writeFileSync(path.join(o, 'software.json'), JSON.stringify(m));
  fs.writeFileSync(path.join(o, 'truth.json'), JSON.stringify(truth, null, 1));
  n++; console.log('取り込み', d, `(${truth.events.length} 件)`);
}
console.log(`${n} 試合を取り込み、${skipped} 試合を飛ばした → ${out}`);
