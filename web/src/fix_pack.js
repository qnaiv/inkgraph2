// D75: 要修正パック。「要修正」の印を付けた試合を、ソフトの分析結果・人の修正・差分・（録画からの）コマと一緒に zip にして、AI（Claude Code など）に渡し、検出ロジックの修正に生かす。DOM 非依存。
import { detected, resultOf, RESULT_FIELDS, KINDS } from './analysis.js';
const p2 = n => String(n).padStart(2, '0');
export const FIX_REASONS = { kill: 'キル数', death: 'デス数', special: 'スペシャル', result: '勝敗', rule: 'ルール・ステージ', other: 'その他' };
export const fixPackFilename = (d = new Date()) => `ink-graph_要修正_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.zip`;
export const safeId = id => String(id).replace(/[^0-9A-Za-z]/g, '_');
const r1 = v => Math.round(v * 10) / 10;
const rel = (m, t) => r1(t - (m.battle ? m.battle[0] : 0));

/** 「要修正」の印を付ける／外す。reasons は FIX_REASONS のキー。印を外すときは null */
export function flagMatch(m, on, reasons = [], at = new Date().toISOString()) { if (on) m.needs_fix = { at: m.needs_fix?.at || at, reasons: [...new Set(reasons)], ...(m.needs_fix?.auto ? { auto: true } : {}), ...(m.needs_fix?.done ? { done: m.needs_fix.done } : {}) }; else delete m.needs_fix; return m; }
/** D88: 試合の「要修正」の状態。none＝確認不要（フラグなし）／todo＝要修正（まだ直していない）／done＝修正済み（人が正解を付け終えた。AI 用に書き出せるのはこれだけ） */
export const fixState = m => (m.needs_fix ? (m.needs_fix.done ? 'done' : 'todo') : 'none');
/** 「修正完了」の印を付ける／外す（要修正の試合だけ。フラグそのものは残す） */
export function markFixDone(m, on, at = new Date().toISOString()) { if (!m.needs_fix) return m; if (on) m.needs_fix.done = { at }; else delete m.needs_fix.done; return m; }

/**
 * ソフトの分析結果と、人の修正の差分。
 *  false_positives: ✗を付けた検出（ソフトは出したが、実際には無い）
 *  misses:          追加した見逃し（実際にはあるが、ソフトは出さなかった）
 *  confirmed:       ✓を付けた検出（合っていた）
 *  result_fixes:    結果画面の読み取りの訂正（ソフトの値 → 人の値）
 *  unreviewed:      まだ確認していない検出の数
 */
export function diffOf(m) {
  const r = m.review || { marks: {}, added: [], fix: {}, rmarks: {} };
  const det = detected(m), fp = [], confirmed = []; let unreviewed = 0;
  for (const e of det) { const o = { kind: e.kind, t: r1(e.t), rel: rel(m, e.t), key: e.key }; if (e.mark === 'wrong' || e.mark === 'deleted') fp.push(o); else if (e.mark === 'ok') confirmed.push(o); else unreviewed++; }
  const misses = (r.added || []).map(a => ({ kind: a.kind, t: r1(a.t), rel: rel(m, a.t), from_candidate: !!a.cand, candidate_conf: a.cand ? a.cand.conf : null }));
  const rs = m.result_screen || {}, own = rs.own || {}, read = { result: rs.result, mode: rs.mode, stage: rs.stage, ka: own.ka, deaths: own.deaths, specials: own.specials }, fixes = [];
  for (const [f, v] of Object.entries(r.fix || {})) if (v !== undefined && v !== null && v !== '') fixes.push({ field: f, label: RESULT_FIELDS[f] || f, software: read[f] ?? null, human: v });
  const wrongNoFix = Object.entries(r.rmarks || {}).filter(([f, v]) => v === 'wrong' && !(r.fix && r.fix[f] !== undefined)).map(([f]) => f);
  // D78: 候補（採用しなかった検出）の使われ方。見逃しのうち、候補にあったもの（目星が当たった）と、候補に無かったもの（検出の取りこぼし）
  const candidates = { saved: !!m.cands, added_from_candidates: misses.filter(x => x.from_candidate).length, added_not_in_candidates: misses.filter(x => !x.from_candidate).length, dismissed: (r.cand_dismissed || []).length };
  return { false_positives: fp, misses, confirmed, result_fixes: fixes, result_wrong_without_value: wrongNoFix, unreviewed, candidates };
}

/** 録画（または静止画）から切り出すコマの時刻（解析時刻 t）。差分の前後 ±win 秒を step 秒おき。重なりはまとめる */
export function frameTimes(m, d, { win = 3, step = 0.5, whole = false, wholeStep = 1 } = {}) {
  const set = new Set(), centers = [...d.false_positives, ...d.misses];
  for (const c of centers) for (let x = -win; x <= win + 1e-9; x += step) set.add(r1(c.t + x));
  if (whole && m.battle) for (let t = m.battle[0]; t <= m.battle[1]; t += wholeStep) set.add(r1(t));
  return [...set].filter(t => !m.battle || (t >= m.battle[0] - 1 && t <= m.battle[1] + 30)).sort((a, b) => a - b);
}

/** D87: 録画をそのまま入れるとき、差分の各項目に「録画の中の位置（秒）」を付ける（録画の位置 ＝ 解析時刻 − t0） */
export function withVideoPos(d, m) {
  const t0 = m.recording && Number.isFinite(m.recording.t0) ? m.recording.t0 : null; if (t0 === null) return d;
  const pos = x => ({ ...x, video_pos: r1(Math.max(0, x.t - t0)) });
  return { ...d, false_positives: d.false_positives.map(pos), misses: d.misses.map(pos), confirmed: d.confirmed.map(pos) };
}

export function matchSummary(m) {
  const res = resultOf(m), rs = m.result_screen || {};
  return {
    id: m.id, created: m.created ?? null, battle: m.battle ?? null, match_type: m.match_type ?? null,
    result_screen_read: { result: rs.result ?? null, mode: rs.mode ?? null, stage: rs.stage ?? null, own: rs.own ?? null, mode_guess: rs.mode_guess ?? null },
    result_after_human_fix: { result: res.result ?? null, mode: res.mode ?? null, stage: res.stage ?? null, ka: res.ka ?? null, deaths: res.deaths ?? null, specials: res.specials ?? null },
    software_detected: {
      deaths: (m.own_deaths || []).map(e => ({ t: r1(e.start), rel: rel(m, e.start), conf: e.conf ?? null, auto: e.auto ?? null })),
      kills: (m.own_kills || []).map(e => ({ t: r1(e.start), rel: rel(m, e.start), conf: e.conf ?? null })),
      specials: (m.special || []).map(e => ({ ready: r1(e.ready), end: r1(e.end), outcome: e.outcome, activated_at: e.activated_at != null ? r1(e.activated_at) : null, auto: e.auto ?? null }))
    },
    reconcile: m.recon ?? null,
    flagged: m.needs_fix ? { at: m.needs_fix.at, reasons: (m.needs_fix.reasons || []).map(k => FIX_REASONS[k] || k), fixed_at: m.needs_fix.done ? m.needs_fix.done.at : null } : null,
    recording: m.recording ? { file: m.recording.file, t0: m.recording.t0, note: '録画の再生位置[秒] ＝ 解析時刻 t − t0' } : null
  };
}

export function fixReadme({ count, exported, withFrames, withVideo = false }) {
  return [
    'InkGraph 要修正パック（ソフトの分析が間違っていた試合と、人の修正）',
    '',
    `試合数: ${count}   書き出し: ${exported}   映像: ${withVideo ? '録画をそのまま入れた（video/）' : withFrames ? 'コマ（録画から切り出し）' : 'なし／静止画・場面クリップのみ'}`,
    '',
    '【中身】（試合ごとに matches/<id>/）',
    '- summary.json … ソフトの検出（デス・キル・スペシャル）・結果画面の読み取り・人が直したあとの値・補正の履歴',
    '- diff.json … ソフトと人の差分。false_positives=誤検出（ソフトは出したが実際は無い）、misses=見逃し（人が追加。from_candidate=採用しなかった候補から追加したか）、confirmed=合っていた検出、result_fixes=結果画面の読み違い、candidates=候補の使われ方（候補にあった見逃し／候補に無かった見逃し／見送った候補の数）。各項目の t は解析時刻[秒]、rel はバトル開始からの秒',
    '- software.json の cands … ソフトが採用しなかった候補（デス・スペシャル・キル。時刻・確信度・信号）。見逃しが候補にあったなら、採用の基準（閾値・合議）の問題、候補にも無ければ、信号そのものの取りこぼし',
    '- human_review.json … 人が付けた ✓／✗ の印・追加した見逃し・訂正した値（review）',
    '- software.json … ソフトの分析結果そのもの（rec。cues=フレームごとの信号を含む）',
    ...(withVideo ? [
      '- video/ … 試合の録画（MP4・無加工）。diff.json の video に、ファイル名と t0 が入る。録画の位置[秒] ＝ 解析時刻 t − t0。',
      '    diff.json の false_positives／misses／confirmed の各項目に、録画の位置 video_pos[秒] が付いている',
      '    見たい場面のコマは、ffmpeg で取り出す（ffmpeg が無ければ入れる）:',
      '      1 枚:           ffmpeg -ss <video_pos> -i video/<ファイル名> -frames:v 1 frame.png',
      '      前後 3 秒を 2 枚/秒: ffmpeg -ss <video_pos - 3> -t 6 -i video/<ファイル名> -vf fps=2 frame_%03d.png',
      '    （-ss は -i の前に置くと速い。取り出したコマは Read で見られる）'
    ] : ['- frames/ … 差分の前後のコマ（録画から切り出し）。ファイル名は 解析時刻。diff.json の frames に対応表あり']),
    '',
    '【Claude Code での使い方】',
    'このフォルダで Claude Code を開き、次のように頼む:',
    withVideo ? '  「diff.json の誤検出と見逃しについて、video_pos の前後のコマを ffmpeg で取り出して見て、なぜソフトが間違えたか原因を調べて。' : '  「diff.json の誤検出と見逃しについて、frames のコマを見て、なぜソフトが間違えたか原因を調べて。',
    '   検出ロジック（web/src/core/ の cues.js・analyzer.js・fusion.js・count_check.js など）の修正案を、',
    '   閾値の調整かコードの修正かで分けて出して。誤検出・見逃しの傾向が複数の試合で共通なら、そこを優先して。」',
    '',
    '【ご注意】',
    '- コマにはゲーム画面のプレイヤー名が映ります。共有前に確認してください。',
    '- このアプリはデータを自動送信しません。',
    ''
  ].join('\n');
}
export { KINDS };
