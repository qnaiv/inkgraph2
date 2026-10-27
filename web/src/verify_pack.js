// D67: 検証パック。直近1試合の「全コマ」とソフトの分析結果を1つの zip にまとめる（Claude Code に読ませて検出ロジックの改善材料にする）。DOM 非依存。
const p2 = n => String(n).padStart(2, '0');
export const verifyFilename = (m, d = new Date()) => `ink-graph_検証_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}_試合${m.match ?? ''}.zip`;

/** ソフトの検出結果を、時刻つきの読みやすい一覧にする（rec 本体は software.json に別で入れる） */
export function softwareSummary(rec) {
  const rs = rec.result_screen || {};
  return {
    id: rec.id, match: rec.match, rule: rs.mode ?? rec.rule ?? null, stage: rs.stage ?? rec.stage ?? null, match_type: rec.match_type ?? null,
    battle: rec.battle ?? null, result: rs.result ?? null,
    result_screen_counts: rs.own ?? null, recon: rec.recon ?? null,
    deaths: (rec.own_deaths || []).map(e => ({ start: e.start, end: e.end, conf: e.conf ?? null, auto: e.auto ?? null, src: e.src ?? null })),
    kills: (rec.own_kills || []).map(e => ({ start: e.start, end: e.end ?? null, conf: e.conf ?? null })),
    specials: (rec.special || []).map(e => ({ ready: e.ready, end: e.end, outcome: e.outcome, activated_at: e.activated_at ?? null, conf: e.conf ?? null, auto: e.auto ?? null })),
    human_review: rec.review ?? null
  };
}

export function verifyReadme(meta) {
  return [
    'InkGraph 検証パック（1試合ぶんの全コマ＋ソフト分析結果）',
    '',
    `試合: ${meta.id}   書き出し: ${meta.exported}`,
    `全コマ: ${meta.full.count}枚（約${meta.full.step}秒おき）／場面クリップ: ${meta.clips.count}枚（0.2秒おき・検出箇所の前後）／静止画: ${meta.stills.count}枚`,
    '',
    '【構成】',
    '- manifest.json … 全コマ・クリップ・静止画の一覧（time = 試合の解析時刻[秒], file = zip内パス）',
    '- software.json … ソフト（アプリ）の分析結果そのもの（rec）',
    '- summary.json … 検出したデス・キル・スペシャルと結果画面の数、人の確認内容を読みやすくしたもの',
    '- detect_params.json … 書き出し時点の検出パラメータ',
    '- frames/full/ … 試合中の全コマ（WebP 720p）。検出できなかった場所の取りこぼし探し用',
    '- frames/clips/ … 検出箇所の前後を 5fps で保存したコマ（時刻の精密な確認用）',
    '- stills/ … 結果画面などの静止画',
    '',
    '【Claude Code での使い方】',
    'このzipを展開したフォルダを開き、「summary.json と frames を見て、ソフトの検出が正しいか検証して。',
    '見逃し（デス・キル・スペシャル）と誤検出を時刻つきで列挙し、原因と検出ロジックの改善案を出して」と頼む。',
    '',
    '【ご注意】',
    '- 画像にはゲーム画面のプレイヤー名が映ります。共有前に確認してください。',
    '- このアプリはデータを自動送信しません。',
    ''
  ].join('\n');
}

const tName = t => t.toFixed(2).padStart(7, '0');
/** frames: IndexedDB 由来 [{t, blob}] ではなく、書き出し用に {t, name} へ整形したもの */
export function buildVerifyMeta(rec, { full, clips, stills, params, exportedAt, step }) {
  return {
    app: 'InkGraph', kind: 'verify', format: 1, exported: exportedAt, id: rec.id, battle: rec.battle ?? null,
    full: { count: full.length, step, frames: full },
    clips: { count: clips.length, frames: clips },
    stills: { count: stills.length, frames: stills },
    params: params ?? null
  };
}
export const fullName = t => `frames/full/f_${tName(t)}.webp`;
export const clipName = (idx, t) => `frames/clips/c${String(idx).padStart(2, '0')}_${tName(t)}.webp`;
export const stillName = (kind, t, id) => `stills/${kind || 'frame'}_${tName(t)}_${id}.jpg`;
