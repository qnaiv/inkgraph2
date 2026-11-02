// AI 連携: 試合 1 件を、AI に渡す「数値と時刻だけ」の record にする。画像・検出用の信号・録画の中身は含めない（録画は、この PC 上のパスと開始位置だけ。MCP の get_frames が必要なコマだけを取り出す）。DOM 非依存。
import { effective, resultOf, matchOwner, specialStats, finalCount } from './analysis.js';
import { fixState, diffOf } from './fix_pack.js';
import { aggregate } from './ai_summary.js';
import { matchTags } from './match_tags.js';

const r1 = v => Math.round(v * 10) / 10;
const norm = s => (typeof s === 'string' ? (/WIN/i.test(s) ? 'WIN' : /LOSE/i.test(s) ? 'LOSE' : null) : null);


const FIX_FIELDS = ['result', 'mode', 'match_type', 'stage', 'ka', 'deaths', 'specials', 'count'];
/** 人の訂正（ソフトの読み → 人の値）。結果画面の項目・見逃し・誤検出。MCP の get_corrections が「訂正前/訂正後」として返す */
function correctionsOf(m, b0) {
  const rs = m.result_screen || {}, own = rs.own || {}, f = (m.review && m.review.fix) || {};
  const soft = { result: rs.result, mode: rs.mode, match_type: m.match_type ?? rs.match_type, stage: rs.stage, ka: own.ka, deaths: own.deaths, specials: own.specials, count: finalCount(m) };
  const fields = FIX_FIELDS.filter(k => f[k] !== undefined && f[k] !== null && f[k] !== '').map(k => ({ field: k, software: soft[k] ?? null, human: f[k] }));
  const d = diffOf(m), rel = t => r1(t - b0);
  return { fields, false_positives: d.false_positives.map(x => ({ kind: x.kind, rel: rel(x.t) })), misses: d.misses.map(x => ({ kind: x.kind, rel: rel(x.t), from_candidate: x.from_candidate })), reviewed: !!m.review && (d.confirmed.length > 0 || d.false_positives.length > 0 || d.misses.length > 0 || fields.length > 0) };
}
/** 検出の根拠（ルール判定・タイマー位置・「のこり」が読めた割合など）。数値と短い文字だけ */
function diagOf(m) {
  const rs = m.result_screen || {};
  return { hud_layout: m.hud_layout || null, rule_software: rs.mode ?? null, rule_source: rs.mode_source ?? null, mode_guess: rs.mode_guess ?? null, yolo_disagree: rs.yolo_disagree ?? null, match_type_software: m.match_type ?? rs.match_type ?? null, match_type_source: m.match_type_source ?? null, count_evidence: m.count_evidence ?? null, count_check: m.count_check ?? null, confidence: m.confidence ?? rs.confidence ?? null };
}
/** カウントの推移（開始からの秒, 自, 相手）。長い試合でも 300 行に収める */
function countSeries(m, b0) {
  const s = m.tower_series || [], step = Math.max(1, Math.ceil(s.length / 300)), out = [];
  for (let i = 0; i < s.length; i += step) out.push([r1(s[i].t - b0), s[i].own, s[i].enemy]);
  return out;
}

/** 試合 1 件 → record（ai_summary.js の先頭に形を書いてある） */
export function toRecord(m) {
  const r = resultOf(m), eff = effective(m), b0 = m.battle ? m.battle[0] : 0;
  const rel = t => r1(t - b0);
  const deathEv = eff.filter(e => e.kind === 'death').sort((a, b) => a.t - b.t);
  const deaths = deathEv.map(e => rel(e.t));
  // デスごとの状況: 直前の生存人数（自チームは自分を含む）と人数差、局面（カウントを読めたヤグラだけ）
  const death_ctx = deathEv.map(e => ({ t: rel(e.t), alive: e.alive, man: e.man, phase: e.phase || null, tags: e.tags || [] }));
  const kills = eff.filter(e => e.kind === 'kill').map(e => rel(e.t)).sort((a, b) => a - b);
  const sp = specialStats(m);
  const battle_sec = m.battle ? Math.round(m.battle[1] - m.battle[0]) : null;
  const series = (m.tower_series || []).map(s => ({ t: rel(s.t), own: s.own, enemy: s.enemy }));
  const tags = matchTags({ rule: r.mode, result: norm(r.result), battle_sec, ka: typeof r.ka === 'number' ? r.ka : null, deaths: typeof r.deaths === 'number' ? r.deaths : null, series });
  return {
    id: m.id, created: m.created || null, owner: matchOwner(m), fix: fixState(m), match_type: r.match_type || null,
    rule: r.mode || null, stage: r.stage || null, result: norm(r.result),
    battle_sec,
    ka: typeof r.ka === 'number' ? r.ka : null, deaths_result: typeof r.deaths === 'number' ? r.deaths : null,
    deaths, death_ctx, kills,
    special: { ready: sp.readyCount, lost: sp.lost, activated: sp.activated },
    first_death: deaths.length ? deaths[0] : null,
    tags,
    video: m.recording && m.recording.path ? { path: m.recording.path, file: m.recording.file || null, t0: Number.isFinite(m.recording.t0) ? m.recording.t0 : null, battle_start_pos: Number.isFinite(m.recording.t0) ? r1(b0 - m.recording.t0) : null, bytes: m.recording.bytes || null } : null,
    diag: diagOf(m), count_series: countSeries(m, b0), corrections: correctionsOf(m, b0)
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
