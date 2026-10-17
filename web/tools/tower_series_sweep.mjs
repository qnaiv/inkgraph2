// usage: node tools/tower_series_sweep.mjs [web_matches.json]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import * as T from '../src/core/tower.js';
const here = path.dirname(fileURLToPath(import.meta.url)), R = path.resolve(here, '../..');
const web = JSON.parse(fs.readFileSync(process.argv[2] || path.join(R, 'web/test-results/web_matches.json'), 'utf8'));
const full = { o: 'own', e: 'enemy', n: 'neutral' };
const ms = web.filter(m => m.tower_rows).sort((a, b) => a.source.name.localeCompare(b.source.name)).map(m => {
  const no = +m.source.name.split('match').pop().slice(0, 2);
  const py = JSON.parse(fs.readFileSync(path.join(R, `out/1080p/match0${no}/timeline.json`), 'utf8'))[0].tower_series;
  const rows = m.tower_rows.map(r => ({ t: r.t, own: r.own, enemy: r.enemy, grid: r.g, marker: r.o ? { owner: full[r.o] } : null }));
  return { no, py, rows };
});
function score(opts) {
  let N = 0, H = 0; const per = [];
  for (const m of ms) { const ws = T.series(m.rows, opts); let n = 0, h = 0;
    for (const s of m.py) { let w = null, bd = Infinity; for (const x of ws) { const d = Math.abs(x.t - s.t); if (d < bd) { bd = d; w = x; } }
      if (!w || bd > 0.7) continue; n++; if (w.owner === s.owner) h++; }
    per.push(h / Math.max(n, 1)); N += n; H += h; }
  return { N, H, per };
}
const res = [];
for (const dense of [true, false]) for (const win of [1, 1.5, 2, 2.5, 3, 4]) for (const hold of [0, 2, 3, 5, 10]) {
  if (!dense && hold) continue; res.push({ label: `dense=${dense} win=${win} hold=${hold}`, ...score({ dense, win, hold }) }); }
res.sort((a, b) => b.H - a.H);
const pr = r => console.log(r.label.padEnd(30), `${(100 * r.H / Math.max(r.N, 1)).toFixed(1)}%`.padStart(7), `${r.H}/${r.N}`.padStart(10), ' ', ms.map((m, i) => `m${m.no}:${(100 * r.per[i]).toFixed(1)}%`).join(' '));
res.forEach(pr);
const o = score({ dense: false, win: 2, hold: 0 }); console.log('\nold behaviour:'); pr({ label: 'dense=false win=2 rows hold=0', ...o });
