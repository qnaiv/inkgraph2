// SVG timeline (equivalent of viz.py): own lane (キル/デス/スペシャル), 人数差, 味方/敵, ヤグラカウント, 勝率
import { effective, series, wpAt, mss, SP_LABEL } from './analysis.js';
import { aliveAt } from './core/analyzer.js';
const NS = 'http://www.w3.org/2000/svg';
export function renderTimeline(m, { onSeek } = {}) {
  const t0 = m.battle[0], t1 = m.battle[1], Tm = Math.max(300, t1 - t0) + 2, L = 110, Wd = 1060, X = t => L + (t - t0) / Tm * Wd;
  const ev = effective(m), S = series(m); const lanes = []; let y = 10; const svgH = [];
  let s = `<svg xmlns="${NS}" width="${L + Wd + 20}" height="HEIGHT" style="background:#fff;font-size:13px">`;
  const band = (y0, h) => (m.hud_hidden || []).concat(m.map_open || []).map(([a, b]) => `<rect x="${X(a)}" y="${y0}" width="${Math.max(1, X(b) - X(a))}" height="${h}" fill="url(#hatch)"/>`).join('');
  s += `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f2f2f2"/><line x1="0" y1="0" x2="0" y2="6" stroke="#bbb" stroke-width="1.5"/></pattern></defs>`;
  // own lane
  const oy = y, rowY = { kill: oy + 20, death: oy + 55, special: oy + 90 }; s += band(oy, 110);
  s += `<text x="8" y="${oy + 58}" font-size="18" font-weight="bold">自分</text>`; for (const [k, lab] of [['kill', 'キル'], ['death', 'デス'], ['special', 'スペシャル']]) s += `<text x="${L - 8}" y="${rowY[k] + 5}" text-anchor="end" fill="#444">${lab}</text><line x1="${L}" x2="${L + Wd}" y1="${rowY[k]}" y2="${rowY[k]}" stroke="#eee"/>`;
  for (const e of ev) { const x = X(e.t), tip = `${mss(e.t - t0)} ${e.phase ? e.phase : ''} ${e.count ? 'カウント' + e.count : ''} ${e.wp_delta !== undefined ? '勝率変化 ' + Math.round(e.wp_delta * 100) + '%' : ''}${e.added ? '（手動追加）' : ''}`;
    const attr = `class="ev" data-t="${e.t}" style="cursor:pointer"`;
    if (e.kind === 'kill') s += `<g ${attr}><title>キル ${tip}</title><text x="${x}" y="${rowY.kill + 7}" text-anchor="middle" font-size="22" fill="#2e7d32">★</text></g>`;
    if (e.kind === 'death') s += `<g ${attr}><title>デス ${tip}</title><rect x="${x}" y="${rowY.death - 10}" width="${Math.max(3, X(e.end) - x)}" height="20" fill="#e57373" opacity=".35"/><text x="${x}" y="${rowY.death + 7}" text-anchor="middle" font-size="20" fill="#c62828" font-weight="bold">✕</text></g>`;
    if (e.kind === 'special') { const col = { activated: '#f9a825', lost_on_death: '#8d6e63' }[e.outcome] || '#bdbdbd';
      s += `<g ${attr}><title>スペシャル ${SP_LABEL[e.outcome] || ''} ${tip}</title><rect x="${x}" y="${rowY.special - 7}" width="${Math.max(4, X(e.end) - x)}" height="14" fill="${col}"/><text x="${X(e.end)}" y="${rowY.special + 22}" text-anchor="middle" font-size="11" fill="#6d4c00">${SP_LABEL[e.outcome] || ''}</text></g>`; }
    if (e.wp_delta !== undefined && Math.abs(e.wp_delta) >= 0.05) s += `<text x="${x}" y="${(e.kind === 'kill' ? rowY.kill : rowY.death) - 12}" text-anchor="middle" font-size="11" fill="${e.wp_delta > 0 ? '#1565c0' : '#c62828'}">${e.wp_delta > 0 ? '+' : ''}${Math.round(e.wp_delta * 100)}%</text>`; }
  y = oy + 120;
  // alive diff strip
  s += `<text x="${L - 8}" y="${y + 13}" text-anchor="end" fill="#444">人数差</text>`;
  for (let t = t0; t < t1; t += 1) { const [a, b] = aliveAt(m, t), d = a - b; const col = d >= 2 ? '#1e88e5' : d > 0 ? '#64b5f6' : d <= -2 ? '#e53935' : d < 0 ? '#ef9a9a' : '#eeeeee'; s += `<rect x="${X(t)}" y="${y}" width="${Wd / Tm + 0.5}" height="18" fill="${col}"><title>${mss(t - t0)} 味方${a}人 対 敵${b}人</title></rect>`; }
  y += 28;
  // tower count + win probability
  if (S.length) { const h = 90; s += band(y, h); s += `<text x="${L - 8}" y="${y + 30}" text-anchor="end" fill="#444">ヤグラ</text><text x="${L - 8}" y="${y + 46}" text-anchor="end" fill="#444">カウント</text>`;
    const Y = v => y + h - v / 100 * h; const line = (k, c) => `<polyline fill="none" stroke="${c}" stroke-width="2" points="${S.map(p => `${X(p.t)},${Y(k === 'o' ? p.count_own : p.count_enemy)}`).join(' ')}"/>`;
    for (const p of S) if (p.owner !== 'neutral') s += `<rect x="${X(p.t)}" y="${y + h - 4}" width="${Wd / Tm + 0.5}" height="4" fill="${p.owner === 'own' ? '#1e88e5' : '#e53935'}"/>`;
    s += line('o', '#1e88e5') + line('e', '#e53935') + `<text x="${L + Wd + 4}" y="${y + 10}" font-size="11" fill="#555">100</text>`; y += h + 12;
    const h2 = 70, Y2 = v => y + h2 - v * h2; const pts = []; for (let t = t0; t <= t1; t += 2) pts.push(`${X(t)},${Y2(wpAt(m, S, t))}`);
    s += `<text x="${L - 8}" y="${y + 30}" text-anchor="end" fill="#444">勝率の目安</text><line x1="${L}" x2="${L + Wd}" y1="${Y2(0.5)}" y2="${Y2(0.5)}" stroke="#ccc" stroke-dasharray="4"/><polyline fill="none" stroke="#6a1b9a" stroke-width="2" points="${pts.join(' ')}"/><text x="${L + Wd + 4}" y="${Y2(0.5) + 4}" font-size="11" fill="#555">50%</text>`; y += h2 + 12; }
  // ally/enemy
  const rows = [['L1', '味方1'], ['L2', '味方2'], ['L3', '味方3'], ['R0', '敵1'], ['R1', '敵2'], ['R2', '敵3'], ['R3', '敵4']];
  rows.forEach(([k, lab], i) => { const yy = y + i * 16; s += `<text x="${L - 8}" y="${yy + 11}" text-anchor="end" font-size="12" fill="#666">${lab}</text>`;
    for (const e of (m.squid_down[k] || [])) s += e.start === e.end ? `<rect x="${X(e.start) - 4}" y="${yy + 2}" width="8" height="8" transform="rotate(45 ${X(e.start)} ${yy + 6})" fill="#888"/>` : `<rect x="${X(e.start)}" y="${yy + 2}" width="${Math.max(2, X(e.end) - X(e.start))}" height="10" fill="${k[0] === 'L' ? '#90a4ae' : '#d7a8a8'}"/>`; });
  y += rows.length * 16 + 8;
  for (let t = 0; t <= Tm; t += 30) s += `<line x1="${X(t0 + t)}" x2="${X(t0 + t)}" y1="10" y2="${y}" stroke="#e8e8e8"/><text x="${X(t0 + t)}" y="${y + 14}" text-anchor="middle" fill="#555">${mss(t)}</text>`;
  s += `<text x="${L + Wd / 2}" y="${y + 32}" text-anchor="middle" fill="#555">試合時間（バトル開始からの経過）</text><line id="playhead" x1="-10" x2="-10" y1="5" y2="${y}" stroke="#000" stroke-width="1.5"/></svg>`;
  s = s.replace('HEIGHT', y + 40);
  const div = document.createElement('div'); div.style.overflowX = 'auto'; div.innerHTML = s;
  div.querySelectorAll('.ev').forEach(g => g.addEventListener('click', () => onSeek && onSeek(+g.dataset.t)));
  const svg = div.querySelector('svg'); svg.addEventListener('click', e => { if (e.target.closest('.ev')) return; const r = svg.getBoundingClientRect(); const t = t0 + (e.clientX - r.left - L) / Wd * Tm; if (t >= t0 && t <= t1 && onSeek) onSeek(t); });
  div.setPlayhead = t => { const p = div.querySelector('#playhead'); const x = X(t); p.setAttribute('x1', x); p.setAttribute('x2', x); };
  return div;
}
export const LEGEND = `<div class="legend"><span><i style="color:#2e7d32">★</i>自分のキル</span><span><b style="color:#c62828">✕</b> 自分のデス</span><span><i style="background:#e57373;opacity:.4"></i>復活待ち</span><span><i style="background:#f9a825"></i>スペシャル溜まり中（発動）</span><span><i style="background:#8d6e63"></i>溜めたままやられた</span><span><i style="background:#bdbdbd"></i>未使用のまま終了</span><span><i style="background:#1e88e5"></i>人数有利・味方カウント</span><span><i style="background:#e53935"></i>人数不利・敵カウント</span><span><i style="background:#6a1b9a"></i>勝率の目安</span><span><i style="background:#f2f2f2;border:1px solid #bbb"></i>判定できない区間（マップ表示中など）</span><span>+5%/−5% は勝率の変化</span></div>`;
