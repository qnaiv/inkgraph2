// D52: 結果画面の数（デス・スペシャル・K+A）に合わせた自動補正。DOM・Analyzer 非依存の純粋関数。
// 結果画面は全試合で読めるゲーム側の正解なので、検出の件数がずれていたら
// 「閾値の少し下で捨てた候補」を戻す／「確信度の低い検出」を落とす、で件数を合わせる。
// 件数は合わせられるが、補正で足した分の時刻は推定（auto 印を付けて区別する）。
export const RECON = {
  maxAdjust: 2,      // 1 種類あたり直す最大件数（結果画面の読み違いで検出を壊さないための歯止め）
  maxKillDrop: 3,
  minFrames: 3,      // 結果画面を読めたフレーム数の下限（これ未満は信用しない）
  deathFloor: 0.1,   // 候補にする最低の確信度（fusion.js の合議後の値）
  overlapSec: 2.0,   // 既存のデスと候補がこれ以内なら同じデスとみなして足さない
  spFloor: 0.1,
  spOverlapSec: 1.0,
};

/** 手入力した値は読み違いの心配が無いので、補正の歯止め（件数の上限・確信度の下限・結果画面を読んだフレーム数）を外す（D57） */
export const FORCE = { ...RECON, maxAdjust: 12, maxKillDrop: 12, deathFloor: 0, spFloor: 0, minFrames: 0 };
const isCount = v => Number.isInteger(v) && v >= 0 && v <= 60;
const overlaps = (a0, a1, b0, b1, m) => a0 <= b1 + m && b0 <= a1 + m;

/** デスだけ先に合わせる（スペシャルの判定がデスの位置に依存するため、スペシャルを数える前に呼ぶ）。L は検出したデスの配列（in place で直す） */
export function reconcileDeaths(L, own, frames, deathCands = [], lim = RECON) {
  const applied = [], summary = {};
  if (!own || frames < lim.minFrames || !isCount(own.deaths)) return { applied, summary };
  const before = L.length; let n = own.deaths - before;
  if (n > 0) {
    const pool = deathCands.filter(c => c.conf >= lim.deathFloor).sort((a, b) => b.conf - a.conf);
    for (const c of pool) {
      if (n <= 0 || applied.length >= lim.maxAdjust) break;
      if (L.some(e => overlaps(c.start, c.end, e.start, e.end, lim.overlapSec))) continue;
      L.push({ start: c.start, end: c.end, src: c.src, conf: c.conf, sigs: c.sigs, auto: 'added' });
      applied.push({ kind: 'death', action: 'added', t: c.start, conf: c.conf });
      n--;
    }
    L.sort((a, b) => a.start - b.start);
  } else if (n < 0) {
    const drop = [...L].sort((a, b) => (a.conf ?? 0) - (b.conf ?? 0) || (a.end - a.start) - (b.end - b.start)).slice(0, Math.min(-n, lim.maxAdjust));
    for (const e of drop) { L.splice(L.indexOf(e), 1); applied.push({ kind: 'death', action: 'dropped', t: e.start, conf: e.conf ?? null }); }
  }
  summary.deaths = { result: own.deaths, before, after: L.length };
  return { applied, summary };
}

/**
 * rec を結果画面の数に合わせて直す（in place）。
 * ctx: { own: {ka,deaths,specials}|null, frames: 結果画面を読めたフレーム数,
 *        deathCands: [{start,end,src,conf}]  // 採用しなかったデス候補
 *        spCands:    [{ready,end,conf}]      // 採用しなかったゲージ候補（新規）
 *        drainAt:    b => number             // 区間の終わり b の後のゲージ減少量（橙）
 *      }
 * 戻り値: { applied: [{kind, action, t, conf, from}], summary: {deaths?, specials?, kills?} }
 */
export function reconcileCounts(rec, ctx) {
  const { own, frames = 0, deathCands = [], spCands = [], drainAt = () => 0 } = ctx, lim = ctx.lim || RECON;
  const applied = [], summary = {};
  if (!own || frames < lim.minFrames) return { applied, summary };

  if (!ctx.skipDeaths) { const r = reconcileDeaths(rec.own_deaths, own, frames, deathCands, lim); applied.push(...r.applied); Object.assign(summary, r.summary); }

  // --- スペシャル: 結果画面のスペシャル回数（＝発動の数）に合わせる ---
  if (isCount(own.specials)) {
    const SP = rec.special, act = () => SP.filter(e => e.outcome === 'activated').length, before = act(); let n = own.specials - before;
    if (n > 0) {
      const pool = [];
      for (const e of SP) if (e.outcome === 'lost_on_death') pool.push({ promote: e, conf: (e.mid_death ? 0.3 : 0) + 0.2 + (drainAt(e.end) || 0) });
      for (const c of spCands) if (c.conf >= lim.spFloor && !SP.some(e => overlaps(c.ready, c.end, e.ready, e.end, lim.spOverlapSec))) pool.push({ add: c, conf: c.conf });
      pool.sort((a, b) => b.conf - a.conf);
      let done = 0;
      for (const p of pool) {
        if (n <= 0 || done >= lim.maxAdjust) break;
        if (p.promote) {
          const e = p.promote; e.outcome = 'activated'; e.activated_at = e.end; e.auto = 'promoted'; e.conf = p.conf;
          applied.push({ kind: 'special', action: 'promoted', t: e.end, conf: p.conf });
        } else {
          const c = p.add;
          if (SP.some(e => overlaps(c.ready, c.end, e.ready, e.end, lim.spOverlapSec))) continue; // 同じ候補群の中で重なる分
          SP.push({ ready: c.ready, end: c.end, outcome: 'activated', activated_at: c.end, auto: 'added', conf: c.conf });
          applied.push({ kind: 'special', action: 'added', t: c.end, conf: c.conf });
        }
        n--; done++;
      }
      SP.sort((a, b) => a.ready - b.ready);
    } else if (n < 0) {
      const drop = SP.filter(e => e.outcome === 'activated').sort((a, b) => (a.conf ?? 0) - (b.conf ?? 0)).slice(0, Math.min(-n, lim.maxAdjust));
      for (const e of drop) { SP.splice(SP.indexOf(e), 1); applied.push({ kind: 'special', action: 'dropped', t: e.activated_at ?? e.end, conf: e.conf ?? null }); }
    }
    summary.specials = { result: own.specials, before, after: act() };
  }

  // --- キル: K+A（アシストを含む）が上限。超えた分だけ確信度の低い順に落とす ---
  if (isCount(own.ka)) {
    const K = rec.own_kills, before = K.length, over = before - own.ka;
    if (over > 0) {
      const drop = [...K].sort((a, b) => (a.conf ?? 0) - (b.conf ?? 0)).slice(0, Math.min(over, lim.maxKillDrop));
      for (const e of drop) { K.splice(K.indexOf(e), 1); applied.push({ kind: 'kill', action: 'dropped', t: e.start, conf: e.conf ?? null }); }
    }
    summary.kills = { result_ka: own.ka, before, after: K.length };
  }
  return { applied, summary };
}
