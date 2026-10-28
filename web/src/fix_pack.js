// D75: 要修正パック。「要修正」の印を付けた試合を、ソフトの分析結果・人の修正・差分・（録画からの）コマと一緒に zip にして、AI（Claude Code など）に渡し、検出ロジックの修正に生かす。DOM 非依存。
import { detected, resultOf, RESULT_FIELDS, KINDS } from './analysis.js';
const p2 = n => String(n).padStart(2, '0');
export const FIX_REASONS = { kill: 'キル数', death: 'デス数', special: 'スペシャル', result: '勝敗', rule: 'ルール・ステージ', other: 'その他' };
export const fixPackFilename = (d = new Date()) => `ink-graph_要修正_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.zip`;
export const safeId = id => String(id).replace(/[^0-9A-Za-z]/g, '_');
const r1 = v => Math.round(v * 10) / 10;
const rel = (m, t) => r1(t - (m.battle ? m.battle[0] : 0));

/** 「要修正」の印を付ける／外す。reasons は FIX_REASONS のキー。印を外すときは null */
export function flagMatch(m, on, reasons = [], at = new Date().toISOString()) { if (on) m.needs_fix = { at: m.needs_fix?.at || at, reasons: [...new Set(reasons)] }; else delete m.needs_fix; return m; }

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
  const misses = (r.added || []).map(a => ({ kind: a.kind, t: r1(a.t), rel: rel(m, a.t) }));
  const rs = m.result_screen || {}, own = rs.own || {}, read = { result: rs.result, mode: rs.mode, stage: rs.stage, ka: own.ka, deaths: own.deaths, specials: own.specials }, fixes = [];
  for (const [f, v] of Object.entries(r.fix || {})) if (v !== undefined && v !== null && v !== '') fixes.push({ field: f, label: RESULT_FIELDS[f] || f, software: read[f] ?? null, human: v });
  const wrongNoFix = Object.entries(r.rmarks || {}).filter(([f, v]) => v === 'wrong' && !(r.fix && r.fix[f] !== undefined)).map(([f]) => f);
  return { false_positives: fp, misses, confirmed, result_fixes: fixes, result_wrong_without_value: wrongNoFix, unreviewed };
}

/** 録画（または静止画）から切り出すコマの時刻（解析時刻 t）。差分の前後 ±win 秒を step 秒おき。重なりはまとめる */
export function frameTimes(m, d, { win = 3, step = 0.5, whole = false, wholeStep = 1 } = {}) {
  const set = new Set(), centers = [...d.false_positives, ...d.misses];
  for (const c of centers) for (let x = -win; x <= win + 1e-9; x += step) set.add(r1(c.t + x));
  if (whole && m.battle) for (let t = m.battle[0]; t <= m.battle[1]; t += wholeStep) set.add(r1(t));
  return [...set].filter(t => !m.battle || (t >= m.battle[0] - 1 && t <= m.battle[1] + 30)).sort((a, b) => a - b);
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
    flagged: m.needs_fix ? { at: m.needs_fix.at, reasons: (m.needs_fix.reasons || []).map(k => FIX_REASONS[k] || k) } : null,
    recording: m.recording ? { file: m.recording.file, t0: m.recording.t0, note: '録画の再生位置[秒] ＝ 解析時刻 t − t0' } : null
  };
}

export function fixReadme({ count, exported, withFrames }) {
  return [
    'InkGraph 要修正パック（ソフトの分析が間違っていた試合と、人の修正）',
    '',
    `試合数: ${count}   書き出し: ${exported}   コマ: ${withFrames ? 'あり（録画から切り出し）' : 'なし／静止画・場面クリップのみ'}`,
    '',
    '【中身】（試合ごとに matches/<id>/）',
    '- summary.json … ソフトの検出（デス・キル・スペシャル）・結果画面の読み取り・人が直したあとの値・補正の履歴',
    '- diff.json … ソフトと人の差分。false_positives=誤検出（ソフトは出したが実際は無い）、misses=見逃し（人が追加）、confirmed=合っていた検出、result_fixes=結果画面の読み違い。各項目の t は解析時刻[秒]、rel はバトル開始からの秒',
    '- human_review.json … 人が付けた ✓／✗ の印・追加した見逃し・訂正した値（review）',
    '- software.json … ソフトの分析結果そのもの（rec。cues=フレームごとの信号を含む）',
    '- frames/ … 差分の前後のコマ（録画から切り出し）。ファイル名は 解析時刻。diff.json の frames に対応表あり',
    '',
    '【Claude Code での使い方】',
    'このフォルダで Claude Code を開き、次のように頼む:',
    '  「diff.json の誤検出と見逃しについて、frames のコマを見て、なぜソフトが間違えたか原因を調べて。',
    '   検出ロジック（web/src/core/ の cues.js・analyzer.js・fusion.js・reconcile.js など）の修正案を、',
    '   閾値の調整かコードの修正かで分けて出して。誤検出・見逃しの傾向が複数の試合で共通なら、そこを優先して。」',
    '',
    '【ご注意】',
    '- コマにはゲーム画面のプレイヤー名が映ります。共有前に確認してください。',
    '- このアプリはデータを自動送信しません。',
    ''
  ].join('\n');
}
export { KINDS };
