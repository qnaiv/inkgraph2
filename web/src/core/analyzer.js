// Streaming match analyzer: feed 1280x720 RGBA frames (~5 fps) with media time t.
// Detects battle start/end (HUD timer), collects per-frame cues, reads result screen, builds the match record (= Python timeline.json item).
import * as C from './cues.js';
import * as R from './result.js';
import * as T from './tower.js';
import { runs, medfilt, median, r1 } from './img.js';
export const P = { icon_th: 0.7, med: 5, minlen: 2.0, gap: 2.5, cover: 3.0, sig_gap: 4.0, sp_min: 0.3, dead_max_sat: 55, battle_gap: 25, battle_min: 60, result_max: 240 };
export class Analyzer {
  constructor(A, opts = {}) { this.A = A; this.srcH = opts.srcH || 1080; this.onMatch = opts.onMatch || (() => {}); this.onEvent = opts.onEvent || (() => {}); this.matchNo = opts.matchNo || 1; this.learnThresholds = opts.learnThresholds || null; this.state = 'idle'; this.cur = null; this.lastT = 0; this.towerNext = 0; }
  newBattle(t) { this.cur = { a: t, lastTp: t, F: [], hist: [new Uint32Array(180), new Uint32Array(180)], hueN: 0, th: null, pend: [], tower: [], RS: { celebration: [], personal: [], board: [] }, lastRes: null, snaps: [], spPrev: 1 }; this.state = 'battle'; this.towerNext = t; this.onEvent({ type: 'battle_start', t }); }
  frame(fr, t) {
    this.lastT = t; const tp = C.timerPresent(this.A, fr);
    if (this.state !== 'battle' && tp) { if (this.state === 'result') this.finish(); this.newBattle(t); }
    if (this.state === 'battle') {
      const m = this.cur; if (tp) m.lastTp = t;
      if (t - m.lastTp > P.battle_gap) { // battle over
        m.F = m.F.filter(f => f.t <= m.lastTp + 1e-6); m.b = m.lastTp;
        if (m.b - m.a < P.battle_min) { this.cur = null; this.state = 'idle'; this.onEvent({ type: 'battle_discard', t }); }
        else { this.state = 'result'; m.resultFrom = m.b; this.onEvent({ type: 'battle_end', t: m.b }); }
      } else { this.battleFrame(fr, t, tp);
        if (tp) { if (m.RS.celebration.length + m.RS.personal.length + m.RS.board.length) m.RS = { celebration: [], personal: [], board: [] }; }
        else if (t - m.lastTp > 2) this.resultFrame(fr, t); }
    }
    if (this.state === 'result') { this.resultFrame(fr, t); const m = this.cur;
      const got = m.RS.personal.length + m.RS.board.length > 0;
      if (t - m.b > P.result_max || (got && m.lastRes !== null && t - m.lastRes > 20)) this.finish(); }
    return tp;
  }
  battleFrame(fr, t, tp) {
    const m = this.cur, A = this.A; const mp = C.mapOpen(A, fr), sg = C.ownDeadSignal(A, fr), kill = C.killNotice(A, fr), [gw, go] = C.gauge(fr), crops = C.iconCrops(fr);
    const f = { t, ok: tp, map: mp, sig: sg.dead, kill, gw, go, p: null, s: null, ally: null };
    if (!m.th) { if (tp && m.hueN < 60) { C.hueHist(crops, 0, m.hist[0]); C.hueHist(crops, 1, m.hist[1]); m.hueN++; }
      m.pend.push([f, crops, mp ? fr : null]);
      if (m.hueN >= 60) this.fixHue(); } else this.iconStep(f, crops, mp ? fr : null);
    if (tp && m.th) { let grid = false; if (t >= this.towerNext) { this.towerNext = t + 1.0 - 1e-6; grid = true; } const row = T.towerRow(A, fr, m.th, t); row.grid = grid; m.tower.push(row); }
    if (m.spPrev <= 0.2 && gw > 0.2) this.onEvent({ type: 'special_ready', t });
    m.spPrev = gw;
    if (sg.dead && !(m.F.length && m.F[m.F.length - 1].sig)) this.onEvent({ type: 'own_death', t });
    if (kill && !(m.F.length && m.F[m.F.length - 1].kill)) this.onEvent({ type: 'own_kill', t });
    m.F.push(f);
  }
  fixHue() { const m = this.cur; m.th = m.hist.map(h => { let bi = 0; for (let i = 1; i < 180; i++) if (h[i] > h[bi]) bi = i; return h[bi] ? bi : 0; });
    for (const [f, c, fr] of m.pend) this.iconStep(f, c, fr); m.pend = []; }
  iconStep(f, crops, fr) { const m = this.cur; f.p = crops.map((c, i) => C.iconProb(this.A, C.iconFeat(c, m.th[i >> 2]))); f.s = crops.map(c => C.iconSat(c)); if (fr) f.ally = C.allyPlateCrossed(fr, m.th[0]); }
  resultFrame(fr, t) {
    const m = this.cur, c = R.classify(this.A, fr); if (!c) return; m.lastRes = t;
    if (c.kind === 'celebration') m.RS.celebration.push({ t, value: c.value });
    else { const [dx, dy] = c.off, header = R.readHeader(this.A, fr, dx, dy, this.learnThresholds || undefined);
      const e = { t, header }; if (c.kind === 'personal') e.personal = R.readPersonal(this.A, fr, dx, dy); else e.board = R.readBoard(this.A, fr, dx, dy);
      m.RS[c.kind].push(e);
      const lowConf = !header.mode || !header.stage || (c.kind === 'personal' && !e.personal);
      if (m.snaps.length < 6 && (m.snaps.length < 2 || lowConf) && (!m.snaps.length || t - m.snaps[m.snaps.length - 1].t > 1.5)) this.onEvent({ type: 'snapshot', t, reason: lowConf ? 'リザルト画面の読み取りに自信なし' : 'リザルト画面のサンプル', kind: c.kind, header });
      if (lowConf || m.snaps.length < 2) m.snaps.push({ t }); }
  }
  flush() { if (this.state === 'battle') { const m = this.cur; m.b = m.lastTp; if (m.b - m.a >= P.battle_min) { this.state = 'result'; this.finish(); } else { this.cur = null; this.state = 'idle'; } }
    else if (this.state === 'result') this.finish(); }
  finish() {
    const m = this.cur; if (!m) return; if (!m.th) this.fixHue();
    const rs = R.finalizeResult(m.RS); const rec = buildMatch(m, this.matchNo++, this.srcH);
    rec.result_screen = { result: rs.result, mode: rs.mode, stage: rs.stage, own: rs.own ? { ka: rs.own.ka, deaths: rs.own.deaths, specials: rs.own.specials } : null, result_source: rs.result_source ?? null };
    rec.confidence = { ...rs.confidence, celebration_frames: m.RS.celebration.length, personal_frames: m.RS.personal.length, board_frames: m.RS.board.length };
    if (rs.mode === 'ガチヤグラ' && m.tower.length) tagEvents(rec, T.series(m.tower));
    rec.tower_rows = m.tower.map(r => ({ t: r.t, own: r.own, enemy: r.enemy, g: r.grid ? 1 : 0, o: r.marker ? r.marker.owner[0] : null }));
    rec.tower_raw = m.tower.length; this.cur = null; this.state = 'idle'; this.onMatch(rec);
  }
}
export function aliveAt(m, t) { const dead = k => (m.squid_down[k] || []).some(e => e.start <= t && t <= Math.max(e.end, e.start + 5.0));
  let a = 4, b = 4; for (let i = 0; i < 4; i++) { if (dead('L' + i)) a--; if (dead('R' + i)) b--; } return [a, b]; }
export function buildMatch(m, no, srcH) {
  const F = m.F, t = F.map(f => f.t), ok = F.map(f => f.ok), mp = F.map(f => f.map), n = F.length;
  const d = F.map(f => (f.p || Array(8).fill(0)).map(p => p > P.icon_th));
  for (let k = 1; k < n; k++) if (!ok[k]) d[k] = d[k - 1].slice();
  const slots = [...Array(8)].map((_, i) => (i < 4 ? 'L' : 'R') + (i % 4)); const ev = {};
  slots.forEach((k, i) => { const col = medfilt(d.map(r => r[i]), P.med);
    const keep = (a, b) => { if (!P.dead_max_sat || srcH < 1000) return true; const w = F.filter(f => f.t >= a && f.t <= b && f.ok && f.s); return !w.length || median(w.map(f => f.s[i])) < P.dead_max_sat; };
    ev[k] = runs(t, col, P.minlen, P.gap).filter(([a, b]) => keep(a, b)).map(([a, b]) => ({ start: r1(a), end: r1(b), src: 'hud' })); });
  const sig = medfilt(F.map(f => f.sig), 5); const sr = runs(t, sig, 1.5, P.sig_gap);
  let own = sr.map(([a, b]) => ({ start: r1(a), end: r1(b), src: 'signal' }));
  if (!sr.length) own = own.concat(ev.L0); ev.L0 = own.sort((x, y) => x.start - y.start);
  F.forEach(f => { if (!f.ally) return; for (const [k, crossed] of Object.entries(f.ally)) if (crossed && !ev[k].some(e => e.start - P.cover <= f.t && f.t <= e.end + P.cover)) { ev[k].push({ start: r1(f.t), end: r1(f.t), src: 'map_ally' }); ev[k].sort((x, y) => x.start - y.start); } });
  const hidden = runs(t, ok.map(v => !v), 1.0, 0.6), maps = runs(t, mp, 0.4, 1.0);
  const owndead = t.map(x => ev.L0.some(e => x >= e.start && x <= e.end));
  const ready = medfilt(F.map((f, i) => f.gw > 0.2 && !owndead[i] && ok[i] && !mp[i]), 3); const sp = []; const okT = t.filter((_, i) => ok[i]); const lastOk = okT.length ? okT[okT.length - 1] : 0;
  for (const [a, b] of runs(t, ready, P.sp_min, 3.0)) { const lost = ev.L0.some(e => a <= e.start && e.start <= b + 1.0); const unused = !lost && okT.length && b >= lastOk - 1.0;
    sp.push({ ready: r1(a), end: r1(b), outcome: lost ? 'lost_on_death' : (unused ? 'unused_at_end' : 'activated') }); }
  const kills = runs(t, F.map(f => f.kill), 0.2, 1.0).map(([a, b]) => ({ start: r1(a), end: r1(b) }));
  const rr = x => x.map(([a, b]) => [r1(a), r1(b)]); const dur = n ? t[n - 1] - t[0] : 0;
  const rec = { match: no, battle: [r1(m.a), r1(m.b)], squid_down: ev, own_deaths: ev.L0, special: sp, own_kills: kills, hud_hidden: rr(hidden), map_open: rr(maps),
    stats: { duration: r1(dur), map_open_s: r1(maps.reduce((s, [a, b]) => s + b - a, 0)), hud_hidden_s: r1(hidden.reduce((s, [a, b]) => s + b - a, 0)) }, team_hue: m.th };
  for (const e of rec.own_deaths) { const [a, b] = aliveAt(rec, e.start - 0.5); e.alive_before = `${a}v${b}`; }
  for (const e of rec.special) { const [a, b] = aliveAt(rec, e.ready); e.alive_at_ready = `${a}v${b}`; }
  for (const e of rec.own_kills) { const [a, b] = aliveAt(rec, e.start - 1.0); e.alive_before = `${a}v${b}`; }
  return rec;
}
export function tagEvents(m, S) {
  const end = m.battle[1], W = t => T.wp(T.at(S, t), t, end, aliveAt(m, t)); const ev = [];
  for (const [kind, lst, key] of [['own_death', m.own_deaths, 'start'], ['own_kill', m.own_kills, 'start'], ['special', m.special, 'ready']]) for (const e of lst) {
    const t = e[key], s = T.at(S, t - 0.5); e.phase = T.phase(s); e.count = s ? `${s.count_own}-${s.count_enemy}` : null; e.count_diff = s ? s.diff : null;
    if (kind !== 'special') { const b = W(t - 1.0), a = W(t + 1.5); e.wp_before = +b.toFixed(3); e.wp_after = +a.toFixed(3); e.wp_delta = +(a - b).toFixed(3); ev.push({ kind, t, delta: e.wp_delta, phase: e.phase, count: e.count }); } }
  m.tower_series = S.map(s => ({ t: s.t, own: s.count_own, enemy: s.count_enemy, owner: s.owner }));
  m.top_swings = ev.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3); return m;
}
/** re-tag phase / win probability after manual corrections (uses stored tower_series) */
export function retag(m) { if (!m.tower_series || !m.tower_series.length) return m; const S = m.tower_series.map(s => ({ t: s.t, count_own: s.own, count_enemy: s.enemy, diff: s.own - s.enemy, owner: s.owner })); return tagEvents(m, S); }
