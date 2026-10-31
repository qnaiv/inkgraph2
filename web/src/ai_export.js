// AI 連携: 試合 1 件を、AI に渡す「数値と時刻だけ」の record にする。画像・検出用の信号・録画は含めない。DOM 非依存。
import { effective, resultOf, matchOwner, specialStats } from './analysis.js';
import { fixState } from './fix_pack.js';
import { aggregate } from './ai_summary.js';

const r1 = v => Math.round(v * 10) / 10;
const norm = s => (typeof s === 'string' ? (/WIN/i.test(s) ? 'WIN' : /LOSE/i.test(s) ? 'LOSE' : null) : null);

/** 試合 1 件 → record（ai_summary.js の先頭に形を書いてある） */
export function toRecord(m) {
  const r = resultOf(m), eff = effective(m), b0 = m.battle ? m.battle[0] : 0;
  const rel = t => r1(t - b0);
  const deathEv = eff.filter(e => e.kind === 'death').sort((a, b) => a.t - b.t);
  const deaths = deathEv.map(e => rel(e.t));
  // デスごとの状況: 直前の生存人数（自チームは自分を含む）と人数差、局面（カウントを読めたヤグラだけ）
  const death_ctx = deathEv.map(e => ({ t: rel(e.t), alive: e.alive, man: e.man, phase: e.phase || null }));
  const kills = eff.filter(e => e.kind === 'kill').map(e => rel(e.t)).sort((a, b) => a - b);
  const sp = specialStats(m);
  return {
    id: m.id, created: m.created || null, owner: matchOwner(m), fix: fixState(m), match_type: r.match_type || null,
    rule: r.mode || null, stage: r.stage || null, result: norm(r.result),
    battle_sec: m.battle ? Math.round(m.battle[1] - m.battle[0]) : null,
    ka: typeof r.ka === 'number' ? r.ka : null, deaths_result: typeof r.deaths === 'number' ? r.deaths : null,
    deaths, death_ctx, kills,
    special: { ready: sp.readyCount, lost: sp.lost, activated: sp.activated },
    first_death: deaths.length ? deaths[0] : null
  };
}

/** 試合の一覧 → 書き出す物（records と summary）。他人の試合は records には残すが、集計では除かれる（owner:'other'） */
export function buildExport(matches, now = Date.now()) {
  const records = []; let skipped = 0;
  for (const m of Array.isArray(matches) ? matches : []) {
    if (!m || !m.id) continue;
    try { records.push(toRecord(m)); } catch { skipped++; } // 壊れた記録 1 件で書き出し全体を止めない
  }
  const summary = aggregate(records, { now });
  summary.quality.skipped_unreadable = skipped;
  return { records, summary };
}
