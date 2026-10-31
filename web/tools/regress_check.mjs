// regress_check.mjs: 回帰テスト。保存済みの cues から buildMatch をやり直し、人が直した正解（truth.json）と突き合わせる（D100）
//   node tools/regress_check.mjs            … baseline.json と比べる。正解を取りこぼす（TP 減）・誤検出が増える（FP 増）・見逃しが増える（FN 増）と失敗（終了コード 1）
//   node tools/regress_check.mjs -v         … 試合ごとの検出と正解の時刻も出す
//   node tools/regress_check.mjs --update   … baseline.json を今の結果で書き直す（精度を上げた PR だけで使う）
// 新しい要修正パックを足す手順:
//   1. アプリで「要修正パック」を書き出し、zip を展開する
//   2. node tools/regress_import.mjs <展開したフォルダ>   … 人が全件確認した試合だけが fixtures/regress/ に入る（動画は入らない）
//   3. node tools/regress_check.mjs -v で結果を見る。悪化した試合が無ければ --update で baseline.json を更新して、一緒にコミットする
// 注意：キラー（敵ブキ）の読み取りは入れていない（kscan 空）。デス・キル・スペシャルの時刻だけを突き合わせる
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatch } from '../src/core/analyzer.js';
import { unpackCues } from '../src/core/cues_pack.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'regress');
const TOL = 3.0; // 検出と正解の時刻のずれ[秒]。これ以内なら同じ出来事とみなす
const KINDS = ['death', 'special', 'kill'];
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const score = (pred, truth) => {
  const used = new Set(); let tp = 0;
  for (const p of pred) { const j = truth.findIndex((t, i) => !used.has(i) && Math.abs(t - p) <= TOL); if (j >= 0) { used.add(j); tp++; } }
  return { tp, fp: pred.length - tp, fn: truth.length - tp };
};
const verbose = process.argv.includes('-v'), update = process.argv.includes('--update');

const result = {};
const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'software.json'))).sort() : [];
for (const id of ids) {
  const sw = rj(path.join(dir, id, 'software.json')), truth = rj(path.join(dir, id, 'truth.json'));
  const F = unpackCues(sw.cues);
  const rec = buildMatch({ a: sw.battle[0], b: sw.battle[1], F, th: sw.team_hue, kscan: [] }, 1, (sw.source && sw.source.height) || 1080, {});
  const pred = {
    death: rec.own_deaths.map(e => e.start),
    special: rec.special.filter(e => e.outcome === 'activated').map(e => e.activated_at),
    kill: rec.own_kills.map(e => e.start)
  };
  result[id] = {};
  const line = [];
  for (const k of KINDS) {
    const tt = truth.events.filter(e => e.kind === k).map(e => e.t), s = score(pred[k], tt);
    result[id][k] = s; line.push(`${k}:${s.tp}/${s.fp}fp/${s.fn}fn`);
    if (verbose) console.log('   ', k, 'pred', pred[k].join(','), '| truth', tt.join(','));
  }
  console.log(id.slice(0, 26).padEnd(26), line.join('  '));
}
const total = k => Object.values(result).reduce((a, r) => ({ tp: a.tp + r[k].tp, fp: a.fp + r[k].fp, fn: a.fn + r[k].fn }), { tp: 0, fp: 0, fn: 0 });
for (const k of KINDS) { const t = total(k); console.log('TOTAL', k.padEnd(8), `TP ${t.tp}  FP ${t.fp}  FN ${t.fn}`); }

const basePath = path.join(dir, 'baseline.json');
if (update) { fs.writeFileSync(basePath, JSON.stringify(result, null, 1) + '\n'); console.log('baseline.json を更新した'); process.exit(0); }

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
check(ids.length > 0, `(1) 正解データがある（${ids.length} 試合）`);
if (!fs.existsSync(basePath)) { check(false, '(2) baseline.json がある（--update で作る）'); process.exit(1); }
const base = rj(basePath);
check(Object.keys(base).every(id => result[id]), '(2) baseline の試合が、すべて fixtures にある', Object.keys(base).filter(id => !result[id]).join());
for (const k of KINDS) {
  const bad = [];
  for (const id of ids) { const b = base[id] && base[id][k], r = result[id][k]; if (!b) continue; if (r.tp < b.tp || r.fp > b.fp || r.fn > b.fn) bad.push(`${id.slice(0, 26)} TP ${b.tp}→${r.tp} FP ${b.fp}→${r.fp} FN ${b.fn}→${r.fn}`); }
  check(!bad.length, `(3) ${k}: 試合ごとに baseline より悪化していない`, bad.join(' / '));
}
check(ids.every(id => base[id]), '(4) fixtures の試合が、すべて baseline にある（取り込んだら --update）', ids.filter(id => !base[id]).join());
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
