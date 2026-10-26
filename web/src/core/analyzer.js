// Streaming match analyzer: feed 1280x720 RGBA frames (~5 fps) with media time t.
// Detects battle start/end (HUD timer), collects per-frame cues, reads result screen, builds the match record (= Python timeline.json item).
import * as C from './cues.js';
import * as R from './result.js';
import * as T from './tower.js';
import { runs, medfilt, median, r1 } from './img.js';
import { readKiller, decideKiller, KP } from './killer.js';
import { LiveSpecialTracker } from './live_special.js';
import { reconcileCounts } from './reconcile.js';
export const P = { icon_th: 0.7, med: 5, minlen: 2.0, gap: 2.5, cover: 3.0, sig_gap: 4.0, sp_min: 0.3, dead_max_sat: 55, battle_gap: 25, battle_min: 60, result_max: 240, sp_drain_min: 0.15, sp_drain_win: 1.5, sp_end_tol: 0.5 }; // sig_gap is kept for backwards compatibility (unused in mergeDeathRuns)

export function specialOutcome(a, b, deathStarts, t, go, lastOk = null) {
  const endTol = P.sp_end_tol ?? 0.5;
  const drainWin = P.sp_drain_win ?? 1.5;
  const drainMin = P.sp_drain_min ?? 0.15;

  const endDeath = deathStarts.some(s => s >= Math.max(a, b - endTol) && s <= b + 1.0); // 従来の窓 a〜b+1.0 の内側だけを見る
  if (endDeath) {
    return { outcome: 'lost_on_death', mid_death: false, drain: null };
  }

  const midDeath = deathStarts.some(s => s >= a && s < b - endTol);
  if (midDeath) {
    let maxGo = -Infinity;
    for (let i = 0; i < t.length; i++) {
      if (t[i] > b && t[i] <= b + drainWin) {
        if (go[i] > maxGo) maxGo = go[i];
      }
    }
    const drain = maxGo === -Infinity ? 0.0 : +maxGo.toFixed(2);
    const outcome = drain >= drainMin ? 'activated' : 'lost_on_death';
    return { outcome, mid_death: true, drain };
  }

  const unused = lastOk != null && b >= lastOk - 1.0;
  const outcome = unused ? 'unused_at_end' : 'activated';
  return { outcome, mid_death: false, drain: null };
}

export class DeathLatch {
  constructor(clearSec = 1.0) {
    this.clearSec = clearSec;
    this.latched = false;
    this.clearSince = null;
    this.prevDead = false;
  }
  reset() {
    this.latched = false;
    this.clearSince = null;
    this.prevDead = false;
  }
  update(dead, tp, mp, t) {
    if (tp && !mp && !dead) {
      if (this.clearSince === null) this.clearSince = t;
      if (this.latched && (t - this.clearSince >= this.clearSec - 1e-6)) {
        this.latched = false;
      }
    } else {
      this.clearSince = null;
    }
    const isRising = dead && !this.prevDead;
    let fire = false;
    if (isRising && !this.latched) {
      fire = true;
      this.latched = true;
    }
    this.prevDead = dead;
    return fire;
  }
}

export class Analyzer {
  constructor(A, opts = {}) { this.A = A; this.srcH = opts.srcH || 1080; this.onMatch = opts.onMatch || (() => {}); this.onEvent = opts.onEvent || (() => {}); this.matchNo = opts.matchNo || 1; this.learnThresholds = opts.learnThresholds || null; this.state = 'idle'; this.cur = null; this.lastT = 0; this.towerNext = 0; this.deathLatch = new DeathLatch(1.0); this.liveSp = new LiveSpecialTracker(); }
  newBattle(t) { this.deathLatch.reset(); this.liveSp.reset(); this.cur = { a: t, lastTp: t, F: [], hist: [new Uint32Array(180), new Uint32Array(180)], hueN: 0, th: null, kscan: [], pend: [], tower: [], RS: { celebration: [], personal: [], board: [] }, lastRes: null, snaps: [], spPrev: 1 }; this.state = 'battle'; this.towerNext = t; this.onEvent({ type: 'battle_start', t }); }
  frame(fr, t) {
    this.lastT = t; const tp = C.timerPresent(this.A, fr);
    if (this.state !== 'battle' && tp) { if (this.state === 'result') this.finish(); this.newBattle(t); }
    if (this.state === 'battle') {
      const m = this.cur; if (tp) m.lastTp = t;
      if (t - m.lastTp > P.battle_gap) { // battle over
        m.F = m.F.filter(f => f.t <= m.lastTp + 1e-6); m.b = m.lastTp;
        if (m.b - m.a < P.battle_min) { this.liveSp.reset(); this.cur = null; this.state = 'idle'; this.onEvent({ type: 'battle_discard', t }); }
        else { this.state = 'result'; m.resultFrom = m.b; for (const e of this.liveSp.end(m.b)) this.onEvent(e); this.onEvent({ type: 'battle_end', t: m.b }); }
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
    const m = this.cur, A = this.A; const mp = C.mapOpen(A, fr), sg = C.ownDeadSignal(A, fr);
    const ksc = C.killNoticeSlotScores(A, fr), killSlots = ksc.map(s => s > 0.6), kill = killSlots.some(Boolean);
    const [gw, go] = C.gauge(fr), crops = C.iconCrops(fr);
    const f = { t, ok: tp, map: mp, sig: sg.dead, sy: sg.soft, ks: Math.max(0, ...ksc), kill, killSlots, gw, go, p: null, s: null, ally: null };
    if (!m.th) { if (tp && m.hueN < 60) { C.hueHist(crops, 0, m.hist[0]); C.hueHist(crops, 1, m.hist[1]); m.hueN++; }
      m.pend.push([f, crops, mp ? fr : null]);
      if (m.hueN >= 60) this.fixHue(); } else this.iconStep(f, crops, mp ? fr : null);
    if (tp && m.th) { let grid = false; if (t >= this.towerNext) { this.towerNext = t + 1.0 - 1e-6; grid = true; } const row = T.towerRow(A, fr, m.th, t); row.grid = grid; m.tower.push(row); }
    if (m.spPrev <= 0.2 && gw > 0.2) this.onEvent({ type: 'special_ready', t });
    if (m.spPrev > 0.2 && gw <= 0.2) this.onEvent({ type: 'special_end', t });
    m.spPrev = gw;
    if (this.deathLatch.update(sg.dead, tp, mp, t)) { this.liveSp.death(t); this.onEvent({ type: 'own_death', t }); if (A.killer) m.kscan.push({ t0: t, reads: [] }); }
    for (const e of this.liveSp.frame({ t, gw, ok: tp, map: mp, dead: sg.dead })) this.onEvent(e);
    this.killerStep(fr, t);
    const prevSlots = (m.F.length && m.F[m.F.length - 1].killSlots) ? m.F[m.F.length - 1].killSlots : [];
    for (let i = 0; i < killSlots.length; i++) {
      const prev = i < prevSlots.length ? !!prevSlots[i] : false;
      if (killSlots[i] && !prev) this.onEvent({ type: 'own_kill', t });
    }
    m.F.push(f);
  }
  // D47: デス直後のデスカメ吹き出し「<ブキ名> で / やられた!」を +1〜+8 秒の間だけ読む
  killerStep(fr, t) {
    const m = this.cur, A = this.A; if (!A.killer || !m.kscan.length) return; const k = m.kscan[m.kscan.length - 1];
    if (t < k.t0 + KP.from || t > k.t0 + KP.to || k.done) return;
    const r = readKiller(A, fr); if (!r) return; k.reads.push(r);
    if (r.name && r.score >= 0.9) k.done = true; // 十分に似た見本があれば以降は読まない
  }
  fixHue() { const m = this.cur; m.th = m.hist.map(h => { let bi = 0; for (let i = 1; i < 180; i++) if (h[i] > h[bi]) bi = i; return h[bi] ? bi : 0; });
    for (const [f, c, fr] of m.pend) this.iconStep(f, c, fr); m.pend = []; }
  iconStep(f, crops, fr) { const m = this.cur; f.p = crops.map((c, i) => C.iconProb(this.A, C.iconFeat(c, m.th[i >> 2]))); f.s = crops.map(c => C.iconSat(c)); if (fr) f.ally = C.allyPlateCrossed(fr, m.th[0]); }
  resultFrame(fr, t) {
    const m = this.cur, c = R.classify(this.A, fr); if (!c) return; m.lastRes = t;
    if (c.kind === 'celebration') m.RS.celebration.push({ t, value: c.value });
    else { const [dx, dy] = c.off, header = R.readHeader(this.A, fr, dx, dy, this.learnThresholds || undefined, c.panel);
      const e = { t, header }; if (c.kind === 'personal') e.personal = R.readPersonal(this.A, fr, dx, dy); else e.board = R.readBoard(this.A, fr, dx, dy);
      m.RS[c.kind].push(e);
      const lowConf = !header.mode || !header.stage || (c.kind === 'personal' && !e.personal);
      if (m.snaps.length < 6 && (m.snaps.length < 2 || lowConf) && (!m.snaps.length || t - m.snaps[m.snaps.length - 1].t > 1.5)) this.onEvent({ type: 'snapshot', t, reason: lowConf ? 'リザルト画面の読み取りに自信なし' : 'リザルト画面のサンプル', kind: c.kind, header });
      if (lowConf || m.snaps.length < 2) m.snaps.push({ t }); }
  }
  flush() { if (this.state === 'battle') { const m = this.cur; m.b = m.lastTp; if (m.b - m.a >= P.battle_min) { for (const e of this.liveSp.end(m.b)) this.onEvent(e); this.state = 'result'; this.finish(); } else { this.cur = null; this.state = 'idle'; this.deathLatch.reset(); this.liveSp.reset(); } }
    else if (this.state === 'result') this.finish(); }
  finish() {
    const m = this.cur; if (!m) return; if (!m.th) this.fixHue();
    const rs = R.finalizeResult(m.RS); const rec = buildMatch(m, this.matchNo++, this.srcH, { own: rs.own, frames: m.RS.personal.length + m.RS.board.length });
    rec.result_screen = { result: rs.result, mode: rs.mode, stage: rs.stage, own: rs.own ? { ka: rs.own.ka, deaths: rs.own.deaths, specials: rs.own.specials } : null, result_source: rs.result_source ?? null };
    rec.match_type = rs.match_type ?? null;
    rec.power = R.powerForMatchType(rec.match_type);
    rec.confidence = { ...rs.confidence, celebration_frames: m.RS.celebration.length, personal_frames: m.RS.personal.length, board_frames: m.RS.board.length };
    const ownRow = rs.board ? rs.board.find(b => b.own) : null;
    rec.enemy_icons = (rs.board && ownRow) ? rs.board.filter(b => b.group === (ownRow.group === 'top' ? 'bot' : 'top')).map(b => ({ slot: `${b.group}${b.idx}`, icon: b.icon })) : [];
    if (isTowerRule(rs.mode) && m.tower.length) tagEvents(rec, T.series(m.tower));
    if (isTowerRule(rs.mode)) {
      rec.tower_rows = m.tower.map(r => ({ t: r.t, own: r.own, enemy: r.enemy, g: r.grid ? 1 : 0, o: r.marker ? r.marker.owner[0] : null }));
      rec.tower_raw = m.tower.length;
    } else {
      rec.tower_rows = [];
      rec.tower_raw = 0;
    }
    this.cur = null; this.state = 'idle'; this.deathLatch.reset(); this.liveSp.reset(); this.onMatch(rec);
  }
}
/** D47: 読み取り（デス検知時刻 t0 ごと）を、検出したデス区間に付ける。1 回のデスでデス検知が 2 回出ることがある（例: 290.2 と 292.0）ので、
 *  同じデス区間に対応した読み取りはまとめてから決める。吹き出しが読めなかったデスには付けない */
export function attachKillers(deaths, kscan) {
  const byDeath = new Map();
  for (const k of kscan) { if (!k.reads.length) continue; let best = null, bd = Infinity;
    for (const e of deaths) { const d = k.t0 < e.start ? e.start - k.t0 : (k.t0 <= e.end ? 0 : k.t0 - e.end); if (d < bd) { bd = d; best = e; } }
    if (!best || bd > 3) continue; if (!byDeath.has(best)) byDeath.set(best, []); byDeath.get(best).push(...k.reads); }
  for (const [e, reads] of byDeath) if (!e.killed_by) e.killed_by = decideKiller(reads);
}
export function isTowerRule(mode) { return mode === 'ガチヤグラ'; }
export function aliveAt(m, t) { const dead = k => (m.squid_down[k] || []).some(e => e.start <= t && t <= Math.max(e.end, e.start + 5.0));
  let a = 4, b = 4; for (let i = 0; i < 4; i++) { if (dead('L' + i)) a--; if (dead('R' + i)) b--; } return [a, b]; }
export function mergeDeathRuns(t, sig, ok, mp, minlen = 1.5) {
  const raw = runs(t, sig, 0, 0);
  if (!raw.length) return [];
  let step = 0.2;
  if (t.length >= 2) {
    const diffs = [];
    for (let i = 1; i < t.length; i++) {
      const d = t[i] - t[i - 1];
      if (d > 0) diffs.push(d);
    }
    if (diffs.length) step = median(diffs);
  }
  const hasAliveSpan = (endA, startB) => {
    let aliveStart = null, aliveEnd = null;
    for (let i = 0; i < t.length; i++) {
      const ti = t[i];
      if (ti <= endA) continue;
      if (ti >= startB) break;
      const isAlive = ok[i] && !mp[i] && !sig[i];
      if (isAlive) {
        if (aliveStart === null) aliveStart = ti;
        aliveEnd = ti;
      } else if (aliveStart !== null) {
        if ((aliveEnd - aliveStart + step) >= 1.0 - 1e-6) return true;
        aliveStart = null;
        aliveEnd = null;
      }
    }
    if (aliveStart !== null && (aliveEnd - aliveStart + step) >= 1.0 - 1e-6) return true;
    return false;
  };
  const merged = [];
  let cur = [raw[0][0], raw[0][1]];
  for (let k = 1; k < raw.length; k++) {
    const nxt = raw[k];
    if (hasAliveSpan(cur[1], nxt[0])) {
      merged.push(cur);
      cur = [nxt[0], nxt[1]];
    } else {
      cur[1] = nxt[1];
    }
  }
  merged.push(cur);
  return merged.filter(([a, b]) => (b - a) >= minlen);
}
export function killEventsFromSlots(t, F) {
  if (!t || !t.length || !F || !F.length) return [];
  let maxSlots = 0;
  for (let i = 0; i < F.length; i++) {
    const s = F[i] && F[i].killSlots ? F[i].killSlots : (Array.isArray(F[i]) ? F[i] : null);
    if (s && s.length > maxSlots) maxSlots = s.length;
  }
  const events = [];
  for (let s = 0; s < maxSlots; s++) {
    const mask = F.map(f => {
      const arr = f && f.killSlots ? f.killSlots : (Array.isArray(f) ? f : null);
      return arr && s < arr.length ? !!arr[s] : false;
    });
    const slotRuns = runs(t, mask, 0.2, 1.0);
    for (const [a, b] of slotRuns) {
      events.push({ start: r1(a), end: r1(b), slot: s });
    }
  }
  events.sort((x, y) => x.start - y.start || x.slot - y.slot);
  return events.map(e => ({ start: e.start, end: e.end }));
}
export const SOFT_DEATH_TH = 0.35, SOFT_READY_TH = 0.12;
const meanOf = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
export function buildMatch(m, no, srcH, ctx = {}) {
  const F = m.F, t = F.map(f => f.t), ok = F.map(f => f.ok), mp = F.map(f => f.map), n = F.length;
  const d = F.map(f => (f.p || Array(8).fill(0)).map(p => p > P.icon_th));
  for (let k = 1; k < n; k++) if (!ok[k]) d[k] = d[k - 1].slice();
  const slots = [...Array(8)].map((_, i) => (i < 4 ? 'L' : 'R') + (i % 4)); const ev = {};
  slots.forEach((k, i) => { const col = medfilt(d.map(r => r[i]), P.med);
    const keep = (a, b) => { if (!P.dead_max_sat || srcH < 1000) return true; const w = F.filter(f => f.t >= a && f.t <= b && f.ok && f.s); return !w.length || median(w.map(f => f.s[i])) < P.dead_max_sat; };
    ev[k] = runs(t, col, P.minlen, P.gap).filter(([a, b]) => keep(a, b)).map(([a, b]) => ({ start: r1(a), end: r1(b), src: 'hud' })); });
  const sig = medfilt(F.map(f => f.sig), 5); const sr = mergeDeathRuns(t, sig, ok, mp);
  let own = sr.map(([a, b]) => ({ start: r1(a), end: r1(b), src: 'signal' }));
  const hudL0 = ev.L0; // 信号が拾えた試合では採用しない HUD 分類器の自分デス候補（D52 の補正候補にだけ使う）
  if (!sr.length) own = own.concat(ev.L0); ev.L0 = own.sort((x, y) => x.start - y.start);
  F.forEach(f => { if (!f.ally) return; for (const [k, crossed] of Object.entries(f.ally)) if (crossed && !ev[k].some(e => e.start - P.cover <= f.t && f.t <= e.end + P.cover)) { ev[k].push({ start: r1(f.t), end: r1(f.t), src: 'map_ally' }); ev[k].sort((x, y) => x.start - y.start); } });
  const hidden = runs(t, ok.map(v => !v), 1.0, 0.6), maps = runs(t, mp, 0.4, 1.0);
  const owndead = t.map(x => ev.L0.some(e => x >= e.start && x <= e.end));
  const ready = medfilt(F.map((f, i) => f.gw > 0.2 && !owndead[i] && ok[i] && !mp[i]), 3); const sp = []; const okT = t.filter((_, i) => ok[i]); const lastOk = okT.length ? okT[okT.length - 1] : null;
  const deathStarts = ev.L0.map(e => e.start);
  const go = F.map(f => f.go ?? 0);
  for (const [a, b] of runs(t, ready, P.sp_min, 3.0)) {
    const res = specialOutcome(a, b, deathStarts, t, go, lastOk);
    const item = { ready: r1(a), end: r1(b), outcome: res.outcome, activated_at: res.outcome === 'activated' ? r1(b) : null };
    if (res.mid_death) {
      item.mid_death = true;
      item.drain = +res.drain.toFixed(2);
    }
    sp.push(item);
  }
  // --- D52: 確信度（conf）と補正の候補 ---
  const inWin = (a, b) => F.filter(f => f.t >= a - 1e-6 && f.t <= b + 1e-6);
  for (const e of ev.L0) e.conf = +(e.src === 'signal' ? meanOf(inWin(e.start, e.end).map(f => f.sy || 0)) : 0.3 * (median(inWin(e.start, e.end).map(f => (f.p ? f.p[0] : 0))) || 0)).toFixed(2);
  const accepted = ev.L0;
  const softSig = medfilt(F.map(f => (f.sy || 0) >= SOFT_DEATH_TH), 5);
  const deathCands = mergeDeathRuns(t, softSig, ok, mp, 1.0).map(([a, b]) => ({ start: r1(a), end: r1(b), src: 'signal_soft', conf: +meanOf(inWin(a, b).map(f => f.sy || 0)).toFixed(2) }))
    .concat(hudL0.filter(e => e.src === 'hud').map(e => ({ start: e.start, end: e.end, src: 'hud_soft', conf: +(0.3 * (median(inWin(e.start, e.end).map(f => (f.p ? f.p[0] : 0))) || 0)).toFixed(2) })))
    .filter(c => !accepted.some(e => c.start <= e.end + 1.5 && e.start <= c.end + 1.5));
  for (const e of sp) { const w = inWin(e.ready, e.end); e.conf = +(0.5 * Math.min(1, (e.end - e.ready) / 1.0) + 0.5 * Math.min(1, meanOf(w.map(f => f.gw)))).toFixed(2); }
  const spReady = medfilt(F.map((f, i) => f.gw > SOFT_READY_TH && !owndead[i] && ok[i] && !mp[i]), 3);
  const spCands = runs(t, spReady, 0.2, 1.0).map(([a, b]) => ({ ready: r1(a), end: r1(b), conf: +(0.1 + 0.3 * Math.min(1, meanOf(inWin(a, b).map(f => f.gw)))).toFixed(2) }));
  const drainAt = b => { let mx = 0; for (let i = 0; i < t.length; i++) if (t[i] > b && t[i] <= b + P.sp_drain_win && go[i] > mx) mx = go[i]; return mx; };

  const hasKillSlots = F.some(f => f.killSlots && f.killSlots.length);
  const kills = hasKillSlots
    ? killEventsFromSlots(t, F)
    : runs(t, F.map(f => f.kill), 0.2, 1.0).map(([a, b]) => ({ start: r1(a), end: r1(b) }));
  for (const e of kills) e.conf = +Math.max(0, ...inWin(e.start - 0.2, e.end + 0.2).map(f => f.ks || 0)).toFixed(2);
  const rr = x => x.map(([a, b]) => [r1(a), r1(b)]); const dur = n ? t[n - 1] - t[0] : 0;
  const rec = { match: no, battle: [r1(m.a), r1(m.b)], squid_down: ev, own_deaths: ev.L0, special: sp, own_kills: kills, hud_hidden: rr(hidden), map_open: rr(maps),
    stats: { duration: r1(dur), map_open_s: r1(maps.reduce((s, [a, b]) => s + b - a, 0)), hud_hidden_s: r1(hidden.reduce((s, [a, b]) => s + b - a, 0)) }, team_hue: m.th };
  const recon = reconcileCounts(rec, { own: ctx.own, frames: ctx.frames, deathCands, spCands, drainAt });
  rec.recon = ctx.own ? recon : null;
  for (const e of rec.own_deaths) { const [a, b] = aliveAt(rec, e.start - 0.5); e.alive_before = `${a}v${b}`; }
  attachKillers(rec.own_deaths, m.kscan || []);
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
