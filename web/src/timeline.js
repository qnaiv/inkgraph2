// SVG timeline per InkGraph design spec v1:
// Left label column 72px, 30s ticks, 7 lanes:
// 1. 局面の帯 (28px)  2. カウント差 (80px)  3. 自分レーン  4. 勝率グラフ (120px, 50% split)
// 5. 人数差 (smoothed <1s)  6. ヤグラ (count lines + holder band)  7. 味方・敵のやられ (collapsed)
import { effective, series, wpAt, mss, SP_LABEL, holderSegments, HOLDER_JA, setHolderLabel, clearHolderLabel, addCountPoint, removeCountPoint, specialIntervals } from './analysis.js';
import { aliveAt } from './core/analyzer.js';
import * as T from './core/tower.js';

const NS = 'http://www.w3.org/2000/svg';

const fmtDiff = d => d === null || d === undefined || isNaN(d) ? '—' : d > 0 ? `+${d}` : d < 0 ? `\u2212${Math.abs(d)}` : '±0';
const diffClass = d => d === null || d === undefined || isNaN(d) ? 'count-zero' : d > 0 ? 'count-pos' : d < 0 ? 'count-neg' : 'count-zero';
const phaseClass = p => p === '抑え' ? 'phase-osae' : p === '打開' ? 'phase-dakai' : 'phase-gokaku';

// document-level listeners of the open popover; aborted whenever a timeline is re-rendered
let popAbort = null;

export const LEGEND = `
<div class="tl-legend">
  <div class="tl-legend-group">
    <span class="tl-legend-heading">帯の色：</span>
    <span><i class="tl-swatch" style="background:var(--ally-soft);border:1px solid var(--ally)"></i>抑え</span>
    <span><i class="tl-swatch" style="background:var(--enemy-soft);border:1px solid var(--enemy)"></i>打開</span>
    <span><i class="tl-swatch" style="background:var(--surface-2);border:1px solid var(--border-strong)"></i>互角</span>
    <span><i class="tl-swatch" style="background:var(--respawn)"></i>復活待ち</span>
    <span><i class="tl-swatch" style="background:var(--unknown);border:1px solid var(--border)"></i>判定不可区間</span>
  </div>
  <div class="tl-legend-group">
    <span class="tl-legend-heading">線の色・記号：</span>
    <span><i class="tl-line-swatch" style="background:var(--ally)"></i>味方</span>
    <span><i class="tl-line-swatch" style="background:var(--enemy)"></i>敵</span>
    <span><b style="color:var(--kill)">★</b> キル</span>
    <span><i class="tl-swatch" style="background:var(--special-soft);border-top:2px solid var(--special)"></i>帯：スペシャル使用可能</span>
    <span><b style="color:var(--special)">◆</b> スペシャル発動</span>
    <span><svg width="18" height="14" viewBox="0 0 18 14" style="vertical-align:middle"><line x1="1" y1="2" x2="11" y2="12" stroke="var(--death)" stroke-width="2" stroke-linecap="round"/><line x1="11" y1="2" x2="1" y2="12" stroke="var(--death)" stroke-width="2" stroke-linecap="round"/><polygon points="9,2 19,2 14,10" fill="var(--special-wasted)" stroke="var(--surface)" stroke-width="1"/></svg> ×＋▼ 未使用のままデス</span>
    <span><svg width="13" height="13" viewBox="0 0 13 13" style="vertical-align:middle"><rect x="2" y="2" width="9" height="9" fill="none" stroke="var(--special-wasted)" stroke-width="2"/></svg> ▯ 未使用のまま終了</span>
    <span><b style="color:var(--accent)">●</b> 修正済み</span>
  </div>
</div>`;

export function renderTimeline(m, { onSeek, onReviewChange, reviewMode, cands = null } = {}) {
  if (popAbort) popAbort.abort();
  popAbort = new AbortController();
  const popSignal = popAbort.signal;
  const t0 = m.battle[0], t1 = m.battle[1], Tm = Math.max(60, t1 - t0);
  // D89: コンパクトな表示。幅は、置かれた場所の幅に合わせる（viewBox を実寸に近づけて、縦も文字も大きく伸びないようにする）
  const L = 72, Rpad = 38, hostW = (typeof document !== 'undefined' && document.querySelector('#tl')?.clientWidth) || 0, Wd = hostW ? Math.max(640, Math.min(1700, hostW - L - Rpad)) : 950, W = L + Wd + Rpad;
  const X = t => L + Math.max(0, Math.min(1, (t - t0) / Tm)) * Wd;
  const ev = effective(m), S = series(m), holderSegs = holderSegments(m);
  const uid = Math.random().toString(36).slice(2, 8);

  const unknownIntervals = (m.hud_hidden || []).concat(m.map_open || []);
  const unknownBand = (y0, h) => unknownIntervals.map(([a, b]) =>
    `<rect x="${X(a).toFixed(1)}" y="${y0}" width="${Math.max(1, X(b) - X(a)).toFixed(1)}" height="${h}" fill="var(--unknown)" pointer-events="none"/>`
  ).join('');

  const gridTicks = [];
  for (let dt = 0; dt <= Tm; dt += 30) gridTicks.push(dt);

  let y = 8;
  let defs = '';
  let body = '';

  // ---------------- 1. 局面の帯 (28px) ----------------
  const phaseY = y, phaseH = 16;
  body += `<text x="${L - 8}" y="${phaseY + 12}" text-anchor="end" font-size="12" font-weight="500" fill="var(--text-muted)">局面</text>`;
  body += `<rect x="${L}" y="${phaseY}" width="${Wd}" height="${phaseH}" fill="var(--surface-2)" rx="4"/>`;
  if (S.length) {
    const runs = [];
    for (let i = 0; i < S.length; i++) {
      const ph = T.phase(S[i]) || '互角';
      const ta = i === 0 ? t0 : (S[i - 1].t + S[i].t) / 2;
      const tb = i === S.length - 1 ? t1 : (S[i].t + S[i + 1].t) / 2;
      if (runs.length && runs[runs.length - 1].ph === ph) {
        runs[runs.length - 1].tb = tb;
      } else {
        runs.push({ ta, tb, ph });
      }
    }
    for (const r of runs) {
      const xa = X(r.ta), xb = X(r.tb), w = Math.max(1, xb - xa);
      const fill = r.ph === '抑え' ? 'var(--ally-soft)' : r.ph === '打開' ? 'var(--enemy-soft)' : 'var(--surface-2)';
      const col = r.ph === '抑え' ? 'var(--ally)' : r.ph === '打開' ? 'var(--enemy)' : 'var(--text-muted)';
      body += `<rect x="${xa.toFixed(1)}" y="${phaseY}" width="${w.toFixed(1)}" height="${phaseH}" fill="${fill}"/>`;
      if (w >= 36) {
        body += `<text x="${((xa + xb) / 2).toFixed(1)}" y="${phaseY + 12}" text-anchor="middle" font-size="11" font-weight="700" fill="${col}">${r.ph}</text>`;
      }
    }
  } else {
    body += `<text x="${L + Wd / 2}" y="${phaseY + 12}" text-anchor="middle" font-size="11" fill="var(--text-faint)">互角</text>`;
  }
  body += unknownBand(phaseY, phaseH);
  body += `<rect x="${L}" y="${phaseY}" width="${Wd}" height="${phaseH}" fill="none" stroke="var(--border)" rx="4"/>`;
  y += phaseH + 6;

  // ---------------- 2. カウント差のグラフ (80px) ----------------
  const cdY = y, cdH = 44, cdMid = cdY + cdH / 2;
  const Ycd = d => cdMid - (Math.max(-100, Math.min(100, d || 0)) / 100) * (cdH / 2 - 6);
  defs += `<clipPath id="cd-pos-${uid}"><rect x="${L}" y="${cdY}" width="${Wd}" height="${cdH / 2}"/></clipPath>`;
  defs += `<clipPath id="cd-neg-${uid}"><rect x="${L}" y="${cdMid}" width="${Wd}" height="${cdH / 2}"/></clipPath>`;
  body += `<text x="${L - 8}" y="${cdMid + 4}" text-anchor="end" font-size="12" font-weight="500" fill="var(--text-muted)">カウント差</text>`;
  body += `<rect x="${L}" y="${cdY}" width="${Wd}" height="${cdH}" fill="var(--surface-2)" fill-opacity="0.35"/>`;
  body += `<line x1="${L}" x2="${L + Wd}" y1="${cdMid}" y2="${cdMid}" stroke="var(--border-strong)" stroke-dasharray="3,3"/>`;
  if (S.length) {
    const linePts = S.map(p => `${X(p.t).toFixed(1)},${Ycd(p.diff).toFixed(1)}`).join(' ');
    const areaPts = `${X(S[0].t).toFixed(1)},${cdMid} ${linePts} ${X(S[S.length - 1].t).toFixed(1)},${cdMid}`;
    body += `<g clip-path="url(#cd-pos-${uid})"><polygon points="${areaPts}" fill="var(--ally-soft)"/><polyline points="${linePts}" fill="none" stroke="var(--ally)" stroke-width="1.8"/></g>`;
    body += `<g clip-path="url(#cd-neg-${uid})"><polygon points="${areaPts}" fill="var(--enemy-soft)"/><polyline points="${linePts}" fill="none" stroke="var(--enemy)" stroke-width="1.8"/></g>`;
  }
  body += unknownBand(cdY, cdH);
  body += `<text x="${L + Wd + 4}" y="${cdY + 12}" class="num" font-size="10" fill="var(--ally)">+100</text>`;
  body += `<text x="${L + Wd + 4}" y="${cdMid + 4}" class="num" font-size="10" fill="var(--text-faint)">±0</text>`;
  body += `<text x="${L + Wd + 4}" y="${cdY + cdH - 4}" class="num" font-size="10" fill="var(--enemy)">−100</text>`;
  y += cdH + 6;

  // ---------------- 3. 自分レーン (84px) ----------------
  const ownY = y, ownH = 64;
  const rowY = { kill: ownY + 15, death: ownY + 35, special: ownY + 54 };
  body += `<text x="${L - 8}" y="${ownY + 36}" text-anchor="end" font-size="12" font-weight="700" fill="var(--text-muted)">自分</text>`;
  body += `<rect x="${L}" y="${ownY}" width="${Wd}" height="${ownH}" fill="var(--surface-2)" fill-opacity="0.25"/>`;
  for (const r of [rowY.kill, rowY.death, rowY.special]) {
    body += `<line x1="${L}" x2="${L + Wd}" y1="${r}" y2="${r}" stroke="var(--border)" stroke-opacity="0.5"/>`;
  }
  body += unknownBand(ownY, ownH);

  // Special intervals (all intervals: ready to end)
  const spInts = specialIntervals(m);
  for (const intv of spInts) {
    const x1 = X(intv.ready), x2 = X(intv.end);
    const y1 = rowY.special - 5, y2 = rowY.special + 5;
    const isLost = intv.outcome === 'lost_on_death';
    // lost_on_death: 帯高10px(y2-y1)に合わせて終端上辺をx2-10からx2の底辺へ落とす45度相当の斜め切り
    const topX2 = isLost ? Math.max(x1, x2 - 10) : x2;
    const shape = isLost
      ? `<polygon points="${x1.toFixed(1)},${y1} ${topX2.toFixed(1)},${y1} ${x2.toFixed(1)},${y2} ${x1.toFixed(1)},${y2}" fill="var(--special-soft)"/>`
      : `<rect x="${x1.toFixed(1)}" y="${y1}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="10" fill="var(--special-soft)"/>`;
    body += `<g class="sp-band" data-outcome="${intv.outcome}" data-ready="${intv.ready}" data-end="${intv.end}" data-activated="${intv.activated_at ?? ''}" style="cursor:pointer">`
      + `<title>${mss(intv.ready - t0)} スペシャル使用可能</title>`
      + shape
      + `<line x1="${x1.toFixed(1)}" x2="${topX2.toFixed(1)}" y1="${y1}" y2="${y1}" stroke="var(--special)" stroke-width="1"/>`
      + `<circle cx="${x1.toFixed(1)}" cy="${rowY.special}" r="3" fill="var(--special)"/>`
      + `</g>`;
    if (intv.outcome === 'unused_at_end') {
      body += `<rect class="sp-unused-end" x="${(x2 - 4.5).toFixed(1)}" y="${(rowY.special - 4.5).toFixed(1)}" width="9" height="9" fill="none" stroke="var(--special-wasted)" stroke-width="2"><title>未使用のまま終了</title></rect>`;
    }
  }

  // Special activations (effective activated only)
  const specialEff = ev.filter(e => e.kind === 'special');
  for (const e of specialEff) {
    const actT = e.activated_at ?? e.t;
    const ax = X(actT);
    const tip = `${mss(actT - t0)} スペシャル発動`;
    body += `<g class="sp-activated" data-t="${e.t}" data-activated="${actT}" style="cursor:pointer">`
      + `<title>${tip}</title>`
      + `<line x1="${ax.toFixed(1)}" x2="${ax.toFixed(1)}" y1="${ownY}" y2="${ownY + ownH}" stroke="var(--special)" stroke-width="2"/>`
      + `<polygon points="${ax.toFixed(1)},${ownY + 2} ${(ax + 5).toFixed(1)},${ownY + 7} ${ax.toFixed(1)},${ownY + 12} ${(ax - 5).toFixed(1)},${ownY + 7}" fill="var(--special)" class="sp-activated-diamond"/>`
      + `</g>`;
  }

  // D78: 採用しなかった候補（レビューモードのみ）。見逃しの場所を探す目星。点線の丸＝候補（濃いほど確信度が高い）、スペシャルは点線の帯
  if (cands && cands.length) {
    const CK = { kill: 'キル', death: 'デス', special: 'スペシャル発動' };
    for (const c of cands) {
      const cx = X(c.t), cy = rowY[c.kind], op = (0.45 + 0.55 * Math.min(1, c.conf * 1.4)).toFixed(2);
      const tip = `候補 ${mss(c.t - t0)} ${CK[c.kind] || c.kind}（確信度 ${Math.round(c.conf * 100)}%）`;
      body += `<g class="cand-mark" data-t="${c.t}" data-kind="${c.kind}" style="cursor:pointer" opacity="${op}"><title>${tip}</title>`
        + (c.kind === 'special' && c.from != null ? `<rect x="${X(c.from).toFixed(1)}" y="${cy - 5}" width="${Math.max(2, X(c.t) - X(c.from)).toFixed(1)}" height="10" fill="none" stroke="var(--special)" stroke-width="1" stroke-dasharray="3 2"/>` : '')
        + `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="7" fill="var(--bg, #111)" fill-opacity="0.6" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="3 2"/>`
        + `<text x="${cx.toFixed(1)}" y="${cy + 4}" text-anchor="middle" font-size="10" fill="var(--text-muted)" pointer-events="none">?</text></g>`;
    }
  }

  // ---------------- 4. 勝率グラフ (132px >= 120px) ----------------
  const SHOW_WP = false; // D81: 勝率予測は一旦出さない（計算と wp_delta の保存は残す）
  const wpY = ownY + ownH + 6, wpH = SHOW_WP ? 132 : 0, wpMid = wpY + wpH / 2;
  const Ywp = v => wpY + wpH - 8 - Math.max(0, Math.min(1, v)) * (wpH - 16);
  if (SHOW_WP) {
  defs += `<clipPath id="wp-up-${uid}"><rect x="${L}" y="${wpY}" width="${Wd}" height="${wpH / 2}"/></clipPath>`;
  defs += `<clipPath id="wp-dn-${uid}"><rect x="${L}" y="${wpMid}" width="${Wd}" height="${wpH / 2}"/></clipPath>`;
  body += `<text x="${L - 8}" y="${wpMid + 4}" text-anchor="end" font-size="12" font-weight="500" fill="var(--text-muted)">勝率</text>`;
  body += `<rect x="${L}" y="${wpY}" width="${Wd}" height="${wpH}" fill="var(--surface-2)" fill-opacity="0.35"/>`;
  body += `<line x1="${L}" x2="${L + Wd}" y1="${wpMid}" y2="${wpMid}" stroke="var(--border-strong)" stroke-dasharray="4,3"/>`;

  const wpSamples = [];
  for (let t = t0; t <= t1; t += 1.5) wpSamples.push([t, wpAt(m, S, t)]);
  if (wpSamples.length && wpSamples[wpSamples.length - 1][0] < t1) wpSamples.push([t1, wpAt(m, S, t1)]);
  const wpLinePts = wpSamples.map(([t, v]) => `${X(t).toFixed(1)},${Ywp(v).toFixed(1)}`).join(' ');
  const wpAreaPts = `${X(t0).toFixed(1)},${wpMid} ${wpLinePts} ${X(t1).toFixed(1)},${wpMid}`;
  body += `<g clip-path="url(#wp-up-${uid})"><polygon points="${wpAreaPts}" fill="var(--ally-soft)"/><polyline points="${wpLinePts}" fill="none" stroke="var(--winrate-up)" stroke-width="2"/></g>`;
  body += `<g clip-path="url(#wp-dn-${uid})"><polygon points="${wpAreaPts}" fill="var(--enemy-soft)"/><polyline points="${wpLinePts}" fill="none" stroke="var(--winrate-down)" stroke-width="2"/></g>`;
  body += unknownBand(wpY, wpH);
  body += `<text x="${L + Wd + 4}" y="${wpMid + 4}" class="num" font-size="10" fill="var(--text-muted)">50%</text>`;
  }

  // Draw events on Lane 3 (Self) + vertical dotted connectors to Lane 4 (Winrate)
  for (const e of ev) {
    if (e.kind === 'special') continue;
    const x = X(e.t);
    const attr = `class="ev" data-t="${e.t}" style="cursor:pointer"`;
    if (e.kind === 'kill' || e.kind === 'death') {
      const wy = SHOW_WP ? Ywp(wpAt(m, S, e.t)) : 0;
      const sy = e.kind === 'kill' ? rowY.kill : rowY.death;
      const lineCol = e.kind === 'kill' ? 'var(--kill)' : 'var(--enemy)';
      // Vertical dotted connector from self lane to winrate point
      if (SHOW_WP) body += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${sy + 8}" y2="${wy.toFixed(1)}" stroke="${lineCol}" stroke-width="1" stroke-dasharray="2,3" stroke-opacity="0.75"/>`;
      if (SHOW_WP) body += `<circle cx="${x.toFixed(1)}" cy="${wy.toFixed(1)}" r="3" fill="${e.wp_delta >= 0 ? 'var(--winrate-up)' : 'var(--winrate-down)'}"/>`;
      if (e.kind === 'kill') {
        body += `<g ${attr}><title>${mss(e.t - t0)} キル</title><text x="${x.toFixed(1)}" y="${rowY.kill + 6}" text-anchor="middle" font-size="17" fill="var(--kill)">★</text></g>`;
      } else {
        const rw = Math.max(4, X(e.end) - x);
        const x1 = (x - 6).toFixed(1), x2 = (x + 6).toFixed(1);
        const y1 = (rowY.death - 6).toFixed(1), y2 = (rowY.death + 6).toFixed(1);
        const isLostEnd = spInts.some(si => si.outcome === 'lost_on_death' && Math.abs(e.t - si.end) <= 1.0);
        const wastedTri = isLostEnd
          ? `<polygon class="sp-wasted-tri" points="${(x + 4).toFixed(1)},${(rowY.death - 15).toFixed(1)} ${(x + 14).toFixed(1)},${(rowY.death - 15).toFixed(1)} ${(x + 9).toFixed(1)},${(rowY.death - 5).toFixed(1)}" fill="var(--special-wasted)" stroke="var(--surface)" stroke-width="1"><title>未使用のままデス（スペシャルを失いました）</title></polygon>`
          : '';
        body += `<g ${attr}><title>${mss(e.t - t0)} デス</title><rect x="${x.toFixed(1)}" y="${rowY.death - 8}" width="${rw.toFixed(1)}" height="16" rx="3" fill="var(--respawn)"/><g class="death-mark" data-size="14" stroke="var(--death)" stroke-width="2" stroke-linecap="round"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line x1="${x2}" y1="${y1}" x2="${x1}" y2="${y2}"/></g>${wastedTri}</g>`;
      }
      if (SHOW_WP && e.wp_delta !== undefined && Math.abs(e.wp_delta) >= 0.05) {
        const dp = Math.round(e.wp_delta * 100);
        const dTxt = dp > 0 ? `+${dp}%` : `\u2212${Math.abs(dp)}%`;
        const dCol = dp > 0 ? 'var(--winrate-up)' : 'var(--winrate-down)';
        const ly = dp > 0 ? Math.max(wpY + 12, wy - 8) : Math.min(wpY + wpH - 6, wy + 14);
        body += `<text x="${x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" class="num" font-size="11" font-weight="700" fill="${dCol}">${dTxt}</text>`;
      }
    }
  }
  y = wpY + wpH + (SHOW_WP ? 8 : 0);

  // ---------------- 5. 人数差 (56px, smoothed <1s) ----------------
  const alY = y, alH = 32, alMid = alY + alH / 2;
  const Yal = d => alMid - (Math.max(-4, Math.min(4, d)) / 4) * (alH / 2 - 4);
  defs += `<clipPath id="al-pos-${uid}"><rect x="${L}" y="${alY}" width="${Wd}" height="${alH / 2}"/></clipPath>`;
  defs += `<clipPath id="al-neg-${uid}"><rect x="${L}" y="${alMid}" width="${Wd}" height="${alH / 2}"/></clipPath>`;
  body += `<text x="${L - 8}" y="${alMid + 4}" text-anchor="end" font-size="12" font-weight="500" fill="var(--text-muted)">人数差</text>`;
  body += `<rect x="${L}" y="${alY}" width="${Wd}" height="${alH}" fill="var(--surface-2)" fill-opacity="0.35"/>`;
  body += `<line x1="${L}" x2="${L + Wd}" y1="${alMid}" y2="${alMid}" stroke="var(--border-strong)" stroke-dasharray="3,3"/>`;

  // Sample every 0.5s and median-filter over 3 points (1.0s) to smooth <1s changes
  const rawAl = [];
  for (let t = t0; t <= t1; t += 0.5) {
    const [a, b] = aliveAt(m, t);
    rawAl.push({ t, d: a - b });
  }
  const smAl = rawAl.map((p, i) => {
    const w = [rawAl[Math.max(0, i - 1)].d, p.d, rawAl[Math.min(rawAl.length - 1, i + 1)].d].sort((a, b) => a - b);
    return { t: p.t, d: w[1] };
  });
  if (smAl.length) {
    const stepPts = [];
    for (let i = 0; i < smAl.length; i++) {
      const px = X(smAl[i].t).toFixed(1), py = Yal(smAl[i].d).toFixed(1);
      if (i > 0) stepPts.push(`${px},${Yal(smAl[i - 1].d).toFixed(1)}`);
      stepPts.push(`${px},${py}`);
    }
    const alLine = stepPts.join(' ');
    const alArea = `${X(smAl[0].t).toFixed(1)},${alMid} ${alLine} ${X(smAl[smAl.length - 1].t).toFixed(1)},${alMid}`;
    body += `<g clip-path="url(#al-pos-${uid})"><polygon points="${alArea}" fill="var(--ally-soft)"/><polyline points="${alLine}" fill="none" stroke="var(--ally)" stroke-width="1.5"/></g>`;
    body += `<g clip-path="url(#al-neg-${uid})"><polygon points="${alArea}" fill="var(--enemy-soft)"/><polyline points="${alLine}" fill="none" stroke="var(--enemy)" stroke-width="1.5"/></g>`;
  }
  body += unknownBand(alY, alH);
  body += `<text x="${L + Wd + 4}" y="${alY + 12}" class="num" font-size="10" fill="var(--ally)">+4</text>`;
  body += `<text x="${L + Wd + 4}" y="${alMid + 4}" class="num" font-size="10" fill="var(--text-faint)">±0</text>`;
  body += `<text x="${L + Wd + 4}" y="${alY + alH - 4}" class="num" font-size="10" fill="var(--enemy)">−4</text>`;
  y += alH + 6;

  // ---------------- 6. ヤグラ (70px) ----------------
  if (S.length) {
    const isReview = reviewMode !== undefined ? !!reviewMode : (typeof document !== 'undefined' && !!document.querySelector('.detail-body.review-on'));
    const tcY = y, tcH = 46;
    const Ytc = v => tcY + tcH - 10 - (Math.max(0, Math.min(100, v || 0)) / 100) * (tcH - 18);
    body += `<text x="${L - 8}" y="${tcY + 28}" text-anchor="end" font-size="12" font-weight="500" fill="var(--text-muted)">ヤグラ</text>`;
    body += `<rect x="${L}" y="${tcY}" width="${Wd}" height="${tcH}" fill="var(--surface-2)" fill-opacity="0.35"/>`;
    // Holder band at bottom of lane: review mode has 14px height and 24px hit area
    const bandH = isReview ? 14 : 8, bandY = tcY + tcH - bandH;
    const hitH = 24, hitY = bandY - (hitH - bandH) / 2;
    const holderCol = v => v === 'own' ? 'var(--ally)' : v === 'enemy' ? 'var(--enemy)' : 'var(--surface-2)';
    for (const sg of holderSegs) {
      const xa = X(sg.ta), w = Math.max(2, X(sg.tb) - xa);
      let tip;
      if (sg.changed) {
        tip = `修正済み（検出：${HOLDER_JA[sg.det]}）`;
      } else if (sg.val === 'neutral') {
        tip = '中立（だれも乗っていない）';
      } else if (sg.confirmed) {
        tip = `ヤグラ保持: ${HOLDER_JA[sg.val]}（確認済み）`;
      } else {
        tip = `ヤグラ保持: ${HOLDER_JA[sg.val]}`;
      }
      const lab = `${mss(sg.ta - t0)}–${mss(sg.tb - t0)} ${tip}`;
      const fillStyle = sg.val === 'neutral'
        ? 'fill="var(--surface-2)" stroke="var(--border-strong)" stroke-width="1"'
        : `fill="${holderCol(sg.val)}"`;
      const dotX = xa + Math.min(5, w / 2), dotY = bandY + bandH / 2;
      body += `<g class="tw-seg" data-key="${sg.key}" data-tip="${tip}" tabindex="0" role="button" aria-label="${lab}"><title>${tip}</title>`
        + (isReview ? `<rect class="tw-hit" x="${xa.toFixed(1)}" y="${hitY.toFixed(1)}" width="${w.toFixed(1)}" height="${hitH}" fill="transparent"/>` : '')
        + `<rect class="tw-fill" x="${xa.toFixed(1)}" y="${bandY.toFixed(1)}" width="${w.toFixed(1)}" height="${bandH.toFixed(1)}" ${fillStyle}/>`
        + (sg.changed ? `<circle class="tw-changed-dot" cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="3" fill="var(--accent)" pointer-events="none"/>` : '')
        + (sg.confirmed && !sg.changed ? `<rect class="tw-confirmed" x="${(xa + 0.5).toFixed(1)}" y="${(bandY - 0.5).toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${(bandH + 1).toFixed(1)}" fill="none" stroke="var(--accent)" stroke-width="1" pointer-events="none"/>` : '')
        + `<rect class="tw-focus" x="${(xa - 1).toFixed(1)}" y="${(bandY - 2).toFixed(1)}" width="${(w + 2).toFixed(1)}" height="${(bandH + 4).toFixed(1)}" rx="2" fill="none" stroke="var(--text)" stroke-width="1.5" pointer-events="none"/></g>`;
    }
    const ownLine = S.map(p => `${X(p.t).toFixed(1)},${Ytc(p.count_own).toFixed(1)}`).join(' ');
    const eneLine = S.map(p => `${X(p.t).toFixed(1)},${Ytc(p.count_enemy).toFixed(1)}`).join(' ');
    body += `<polyline fill="none" stroke="var(--ally)" stroke-width="2" points="${ownLine}"/>`;
    body += `<polyline fill="none" stroke="var(--enemy)" stroke-width="2" points="${eneLine}"/>`;
    // recorded count points (review.count_series) as dots on the count lines
    for (const c of (m.review && m.review.count_series) || []) {
      if (c[0] < t0 || c[0] > t1) continue;
      const cTip = `味方 ${c[1]} ／ 敵 ${c[2]}`;
      const cx = X(c[0]).toFixed(1), cyOwn = Ytc(c[1]).toFixed(1), cyEnemy = Ytc(c[2]).toFixed(1);
      body += `<g class="tw-cp" data-c0="${c[0]}" data-own="${c[1]}" data-enemy="${c[2]}" data-tip="${cTip}" tabindex="0" role="button" aria-label="${cTip}">`
        + `<title>${cTip}</title>`
        + `<line x1="${cx}" x2="${cx}" y1="${cyOwn}" y2="${cyEnemy}" stroke="var(--border-strong)" stroke-width="1.5" stroke-dasharray="2,2"/>`
        + `<circle cx="${cx}" cy="${cyOwn}" r="3.5" fill="var(--ally)" stroke="var(--surface)" stroke-width="1.5"/>`
        + `<circle cx="${cx}" cy="${cyEnemy}" r="3.5" fill="var(--enemy)" stroke="var(--surface)" stroke-width="1.5"/>`
        + `</g>`;
    }
    body += unknownBand(tcY, tcH);
    body += `<text x="${L + Wd + 4}" y="${tcY + 12}" class="num" font-size="10" fill="var(--text-muted)">100</text>`;
    y += tcH + 6;
  }

  // Time axis (30s ticks)
  const axisY = y;
  let gridLines = '';
  for (const dt of gridTicks) {
    const gx = X(t0 + dt).toFixed(1);
    gridLines += `<line x1="${gx}" x2="${gx}" y1="${phaseY}" y2="${axisY}" stroke="var(--border)" stroke-opacity="0.45"/>`;
    body += `<text x="${gx}" y="${axisY + 16}" text-anchor="middle" class="num" font-size="11" fill="var(--text-muted)">${mss(dt)}</text>`;
  }
  const totalH = axisY + 22;

  const mainSvg = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${totalH}" class="timeline-svg">
    <defs>${defs}</defs>
    ${gridLines}
    ${body}
    <line id="hover-line" x1="-10" x2="-10" y1="${phaseY}" y2="${axisY}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,3" style="pointer-events:none;opacity:0"/>
    <line id="playhead" x1="-10" x2="-10" y1="${phaseY}" y2="${axisY}" stroke="var(--accent)" stroke-width="1.5" style="pointer-events:none"/>
  </svg>`;

  // ---------------- 7. 味方・敵のやられ (collapsed) ----------------
  const rows = [
    ['L1', '味方1', 'var(--ally)'],
    ['L2', '味方2', 'var(--ally)'],
    ['L3', '味方3', 'var(--ally)'],
    ['R0', '敵1', 'var(--enemy)'],
    ['R1', '敵2', 'var(--enemy)'],
    ['R2', '敵3', 'var(--enemy)'],
    ['R3', '敵4', 'var(--enemy)'],
  ];
  const subH = rows.length * 20 + 12;
  let subBody = '';
  for (const dt of gridTicks) {
    const gx = X(t0 + dt).toFixed(1);
    subBody += `<line x1="${gx}" x2="${gx}" y1="4" y2="${subH - 4}" stroke="var(--border)" stroke-opacity="0.45"/>`;
  }
  rows.forEach(([k, lab, col], i) => {
    const ry = 6 + i * 20;
    subBody += `<text x="${L - 8}" y="${ry + 12}" text-anchor="end" font-size="12" fill="var(--text-muted)">${lab}</text>`;
    subBody += `<line x1="${L}" x2="${L + Wd}" y1="${ry + 8}" y2="${ry + 8}" stroke="var(--border)" stroke-opacity="0.4"/>`;
    for (const e of (m.squid_down?.[k] || [])) {
      const ex = X(e.start), ew = Math.max(3, X(e.end) - ex);
      subBody += `<rect x="${ex.toFixed(1)}" y="${ry + 3}" width="${ew.toFixed(1)}" height="10" rx="2" fill="${col}" fill-opacity="0.65"/>`;
    }
  });
  subBody += unknownBand(4, subH - 8);
  const subSvg = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${subH}" class="timeline-svg">${subBody}</svg>`;

  const wrap = document.createElement('div');
  wrap.className = 'timeline-wrap';
  wrap.innerHTML = `
    ${mainSvg}
    <div class="tl-tooltip"></div>
    ${LEGEND}
    <details class="tl-collapse">
      <summary>味方・敵のやられ（7レーン）</summary>
      ${subSvg}
    </details>
  `;

  const svg = wrap.querySelector('.timeline-svg');
  const hoverLine = svg.querySelector('#hover-line');
  const tooltip = wrap.querySelector('.tl-tooltip');

  const clientToMatchTime = e => {
    const rect = svg.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) / rect.width * W;
    if (svgX < L || svgX > L + Wd) return null;
    return t0 + (svgX - L) / Wd * Tm;
  };

  svg.addEventListener('mousemove', e => {
    if (pop) {
      hoverLine.style.opacity = '0';
      tooltip.style.display = 'none';
      return;
    }
    const seg = e.target.closest('.tw-seg');
    if (seg && seg.dataset.tip) {
      hoverLine.style.opacity = '0';
      tooltip.innerHTML = `<span>${seg.dataset.tip}</span>`;
      tooltip.style.display = 'inline-flex';
      const rect = wrap.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - 260, relX - 110))}px`;
      tooltip.style.top = `${Math.max(4, relY - 42)}px`;
      return;
    }
    const cp = e.target.closest('.tw-cp');
    if (cp && cp.dataset.tip) {
      hoverLine.style.opacity = '0';
      tooltip.innerHTML = `<span>${cp.dataset.tip}</span>`;
      tooltip.style.display = 'inline-flex';
      const rect = wrap.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - 260, relX - 110))}px`;
      tooltip.style.top = `${Math.max(4, relY - 42)}px`;
      return;
    }

    const t = clientToMatchTime(e);
    if (t === null) {
      hoverLine.style.opacity = '0';
      tooltip.style.display = 'none';
      return;
    }
    const x = X(t);
    hoverLine.setAttribute('x1', x.toFixed(1));
    hoverLine.setAttribute('x2', x.toFixed(1));
    hoverLine.style.opacity = '1';

    const s = S.length ? T.at(S, t) : null;
    const ph = T.phase(s) || '互角';
    const diff = s ? s.diff : 0;

    tooltip.innerHTML = `
      <span class="num">${mss(t - t0)}</span>
      <span class="phase-badge ${phaseClass(ph)}">${ph}</span>
      <span class="num ${diffClass(diff)}">カウント差 ${fmtDiff(diff)}</span>
    `;
    tooltip.style.display = 'inline-flex';
    const rect = wrap.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    tooltip.style.left = `${Math.max(8, Math.min(rect.width - 260, relX - 110))}px`;
    tooltip.style.top = `${Math.max(4, relY - 42)}px`;
  });

  svg.addEventListener('mouseleave', () => {
    hoverLine.style.opacity = '0';
    tooltip.style.display = 'none';
  });

  wrap.querySelectorAll('.tw-seg').forEach(g => {
    g.addEventListener('mouseenter', e => {
      if (pop) return;
      const tip = g.dataset.tip;
      if (!tip) return;
      hoverLine.style.opacity = '0';
      tooltip.innerHTML = `<span>${tip}</span>`;
      tooltip.style.display = 'inline-flex';
      const rect = wrap.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      const relX = gr.left - rect.left + gr.width / 2;
      const relY = gr.top - rect.top;
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - 260, relX - 110))}px`;
      tooltip.style.top = `${Math.max(4, relY - 42)}px`;
    });
  });

  wrap.querySelectorAll('.tw-cp').forEach(g => {
    g.addEventListener('mouseenter', e => {
      if (pop) return;
      const tip = g.dataset.tip;
      if (!tip) return;
      hoverLine.style.opacity = '0';
      tooltip.innerHTML = `<span>${tip}</span>`;
      tooltip.style.display = 'inline-flex';
      const rect = wrap.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      const relX = gr.left - rect.left + gr.width / 2;
      const relY = gr.top - rect.top;
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - 260, relX - 110))}px`;
      tooltip.style.top = `${Math.max(4, relY - 42)}px`;
    });
  });

  wrap.querySelectorAll('.cand-mark').forEach(g => g.addEventListener('click', e => { e.stopPropagation(); if (onSeek) onSeek(+g.dataset.t); }));
  wrap.querySelectorAll('.ev').forEach(g => g.addEventListener('click', e => {
    e.stopPropagation();
    if (onSeek) onSeek(+g.dataset.t);
  }));

  svg.addEventListener('click', e => {
    const t = clientToMatchTime(e);
    if (t !== null && onSeek) onSeek(t, { exact: true });
  });

  // ---- ヤグラ保持ラベルのポップオーバー（確認モードのみ） ----
  // カウント点の時刻は「区間の開始時刻」に固定（動画の同期ずれに依存せず再現できるため）。
  let pop = null, popKey = null;
  const reviewOn = () => reviewMode !== undefined ? !!reviewMode : !!wrap.closest('.detail-body.review-on');
  const segEl = key => [...svg.querySelectorAll('.tw-seg')].find(g => g.dataset.key === key);
  const closePop = (refocus) => {
    if (!pop) return;
    svg.querySelectorAll('.tw-seg.is-editing').forEach(el => el.classList.remove('is-editing'));
    const k = popKey; pop.remove(); pop = null; popKey = null;
    if (refocus) { const g = segEl(k); if (g) g.focus(); }
  };
  const openPop = key => {
    const sg = holderSegs.find(x => x.key === key), g = segEl(key);
    if (!sg || !g || !reviewOn()) return;
    closePop();
    if (tooltip) {
      tooltip.style.display = 'none';
      tooltip.innerHTML = '';
    }
    if (hoverLine) {
      hoverLine.style.opacity = '0';
    }
    popKey = key;
    g.classList.add('is-editing');
    pop = document.createElement('div');
    pop.className = 'tw-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'ヤグラ保持のラベル');
    const pts = ((m.review && m.review.count_series) || []).filter(c => c[0] >= sg.ta - 1e-6 && c[0] < sg.tb);
    pop.innerHTML = `
      <div class="tw-pop-head"><span class="tw-pop-title">ヤグラ保持</span><span class="num tw-pop-range">${mss(sg.ta - t0)}–${mss(sg.tb - t0)}</span><span class="tw-pop-det">検出: ${HOLDER_JA[sg.det]}</span></div>
      <div class="tw-pop-choices" role="radiogroup" aria-label="保持者">
        ${['own', 'enemy', 'neutral'].map(v => `<button type="button" class="tw-pill tw-pill-${v}" role="radio" aria-checked="${sg.val === v}" data-v="${v}">${HOLDER_JA[v]}</button>`).join('')}
      </div>
      <div class="tw-pop-count">
        <span class="tw-pop-count-label">この時点のカウント</span>
        <label>味方 <input type="number" class="input-sm tw-cn tw-cn-own" min="0" max="100" inputmode="numeric" aria-label="味方のカウント"></label>
        <label>敵 <input type="number" class="input-sm tw-cn tw-cn-enemy" min="0" max="100" inputmode="numeric" aria-label="敵のカウント"></label>
        <button type="button" class="btn btn-sm tw-cn-add">カウントを記録</button>
      </div>
      <div class="tw-pop-note">記録時刻: この区間の開始 ${mss(sg.ta - t0)}</div>
      ${pts.length ? `<ul class="tw-pop-list">${pts.map(c => `<li><span class="num">${mss(c[0] - t0)}</span><span class="num">味方 ${c[1]} / 敵 ${c[2]}</span><button type="button" class="btn btn-sm tw-cn-del" data-sec="${c[0]}" aria-label="カウント点を削除">×</button></li>`).join('')}</ul>` : ''}
      ${sg.confirmed ? `<div class="tw-pop-foot"><button type="button" class="tw-unconfirm">未確認に戻す</button></div>` : ''}
      <svg class="tw-pop-arrow" width="16" height="8" viewBox="0 0 16 8"><path d="M0,0 L8,8 L16,0" fill="var(--surface)" stroke="var(--border-strong)" stroke-width="1"/><line x1="0" y1="0" x2="16" y2="0" stroke="var(--surface)" stroke-width="1.5"/></svg>`;
    wrap.appendChild(pop);
    const wr = wrap.getBoundingClientRect(), gr = g.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    const segCenterX = gr.left - wr.left + gr.width / 2;
    const popLeft = Math.max(8, Math.min(wr.width - pw - 8, segCenterX - pw / 2));
    const popTop = Math.max(4, gr.top - wr.top - ph - 8);
    pop.style.left = `${popLeft}px`;
    pop.style.top = `${popTop}px`;
    const arrow = pop.querySelector('.tw-pop-arrow');
    if (arrow) {
      const arrowX = Math.max(16, Math.min(pw - 16, segCenterX - popLeft));
      arrow.style.left = `${arrowX}px`;
    }
    pop.querySelectorAll('.tw-pill').forEach(b => b.addEventListener('click', () => {
      setHolderLabel(m, key, b.dataset.v);
      closePop();
      if (onReviewChange) onReviewChange({ reopen: null, focus: key });
    }));
    const uc = pop.querySelector('.tw-unconfirm');
    if (uc) uc.addEventListener('click', () => {
      clearHolderLabel(m, key);
      closePop();
      if (onReviewChange) onReviewChange({ reopen: null, focus: key });
    });
    pop.querySelector('.tw-cn-add').addEventListener('click', () => {
      const a = pop.querySelector('.tw-cn-own').value, b = pop.querySelector('.tw-cn-enemy').value;
      const ok = v => v !== '' && Number.isFinite(+v) && +v >= 0 && +v <= 100;
      if (!ok(a) || !ok(b)) { pop.querySelector(ok(a) ? '.tw-cn-enemy' : '.tw-cn-own').focus(); return; }
      addCountPoint(m, sg.ta, Math.round(+a), Math.round(+b));
      if (onReviewChange) onReviewChange({ reopen: key });
    });
    pop.querySelectorAll('.tw-cn-del').forEach(b => b.addEventListener('click', () => {
      removeCountPoint(m, +b.dataset.sec);
      if (onReviewChange) onReviewChange({ reopen: key });
    }));
    (pop.querySelector('.tw-pill[aria-checked="true"]') || pop.querySelector('.tw-pill')).focus();
  };
  wrap.openPopover = openPop;
  wrap.closePopover = () => closePop(false);
  wrap.focusSegment = key => { const g = segEl(key); if (g) g.focus(); };
  svg.querySelectorAll('.tw-seg').forEach(g => {
    g.addEventListener('click', e => { e.stopPropagation(); if (reviewOn()) openPop(g.dataset.key); });
    g.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && reviewOn()) { e.preventDefault(); openPop(g.dataset.key); }
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pop) { e.preventDefault(); closePop(true); }
  }, { signal: popSignal });
  document.addEventListener('mousedown', e => {
    if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.tw-seg'))) closePop(false);
  }, { signal: popSignal });

  wrap.setPlayhead = t => {
    const p = svg.querySelector('#playhead');
    if (t < t0 || t > t1) {
      p.setAttribute('x1', -10);
      p.setAttribute('x2', -10);
      return;
    }
    const x = X(t);
    p.setAttribute('x1', x.toFixed(1));
    p.setAttribute('x2', x.toFixed(1));
  };

  return wrap;
}
