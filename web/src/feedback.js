// 正解データのバッチ書き出し用ヘルパー (#33, 技術設計v2 §3.4)。純粋関数中心。

export const EXPORT_STATE_LABEL = { unreviewed: '未確認', accumulated: '未書き出し', exported: '書き出し済み', changed: '再編集' };
export const LIMIT_BYTES = 50 * 1024 * 1024;
const HISTORY_KEY = 'inkgraph.feedbackHistory';
const HISTORY_MAX = 20;

// 書き出し対象の review 表現 (内部管理キーを除外)
export function reviewContent(m) {
  const { tower_seg, export: _e, updated, reviewHash: _h, ...rest } = (m && m.review) || {};
  return JSON.parse(JSON.stringify(rest));
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

// cyrb53 (同期・非暗号)
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function reviewHash(m) {
  return cyrb53(stable(reviewContent(m))).toString(16).padStart(14, '0');
}

const vals = o => Object.values(o || {}).filter(Boolean);

export function hasReview(m) {
  const r = (m && m.review) || {};
  return vals(r.marks).length > 0
    || (r.added || []).length > 0
    || Object.keys(r.fix || {}).length > 0
    || vals(r.rmarks).length > 0
    || (r.tower_holder || []).length > 0
    || (r.count_series || []).length > 0;
}

export function confirmedCount(m) {
  const r = (m && m.review) || {};
  return vals(r.marks).length + (r.added || []).length + vals(r.rmarks).length
    + (r.tower_holder || []).length + (r.count_series || []).length;
}

export function exportStateOf(m) {
  if (!hasReview(m)) return 'unreviewed';
  const ex = m.review.export;
  if (!ex || !ex.lastExportedHash) return 'accumulated';
  return ex.lastExportedHash === reviewHash(m) ? 'exported' : 'changed';
}

// 保存は呼び出し側。review が無ければ何もしない。
export function syncExportState(m) {
  if (!m.review) return m;
  m.review.reviewHash = reviewHash(m);
  m.review.export = { ...(m.review.export || {}), state: exportStateOf(m) };
  return m;
}

export const pendingMatches = ms => ms.filter(m => { const s = exportStateOf(m); return s === 'accumulated' || s === 'changed'; });
export const exportableMatches = (ms, mode) => (mode === 'full' ? ms.filter(hasReview) : pendingMatches(ms));

const snapList = (snapsById, id) => (snapsById instanceof Map ? snapsById.get(id) : snapsById?.[id]) || [];

export function estimateExport(matches, snapsById) {
  const perMatch = new Map();
  let totalBytes = 0;
  for (const m of matches) {
    const snaps = snapList(snapsById, m.id);
    let bytes = 0;
    for (const s of snaps) bytes += s.blob?.size ?? s.size ?? 0;
    bytes += JSON.stringify(m).length;
    perMatch.set(m.id, { snaps: snaps.length, bytes, stillsAvailable: snaps.length > 0 });
    totalBytes += bytes;
  }
  return { perMatch, totalBytes, over50MB: totalBytes > LIMIT_BYTES };
}

const p2 = n => String(n).padStart(2, '0');
export const localStamp = (d = new Date()) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
export const localStampTime = (d = new Date()) => `${localStamp(d)}-${p2(d.getHours())}${p2(d.getMinutes())}`;

export function makeBatchId(d = new Date()) {
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `fb-${localStamp(d)}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${rnd}`;
}

export const batchFilename = (mode, d = new Date()) => `ink-graph_正解データ_${localStampTime(d)}_${mode === 'full' ? '全件' : '追加分'}.zip`;

// opts: {mode,batchId,exportedAt,accuracy,snapshotsById}。snapshotsById: id -> [{file,t,reason,kind,header,event}]
export function buildFeedbackMeta(matches, { mode = 'diff', batchId, exportedAt, accuracy = null, snapshotsById = {} } = {}) {
  return {
    app: 'InkGraph', kind: 'feedback', format: 2,
    exported: exportedAt || new Date().toISOString(),
    batchId, exportMode: mode, appBuild: 'dev',
    includes: { videos: false, snaps: true },
    accuracy,
    matches: matches.map(m => {
      const { tower_series, squid_down, review, ...light } = m;
      const snaps = snapList(snapshotsById, m.id);
      return {
        ...light, tower_series, squid_down,
        review: reviewContent(m),
        reviewHash: reviewHash(m),
        reviewUpdated: (review && review.updated) || null,
        stillsAvailable: snaps.length > 0,
        snapshots: snaps
      };
    })
  };
}

export function feedbackReadme(meta) {
  const n = meta.matches.length;
  const imgs = meta.matches.reduce((a, m) => a + (m.snapshots?.length || 0), 0);
  return [
    'InkGraph 正解データ（フィードバック）',
    '',
    `バッチID: ${meta.batchId}`,
    `書き出しモード: ${meta.exportMode === 'full' ? '全件 (full)' : '追加分 (diff)'}`,
    `書き出し日時: ${meta.exported}`,
    `試合数: ${n} / 静止画: ${imgs}枚`,
    '',
    '【含まれるもの】',
    '- feedback.json: 確認済みの正解データ(review)、検出結果、ヤグラ・カウントの系列 (format 2)',
    '- images/: 確認用に保存された静止画 (JPEG)。保持期間を過ぎて削除された試合は画像なし(JSONのみ)',
    '',
    '【含まれないもの】',
    '- 録画・動画ファイル (保存していません)',
    '',
    '【ご注意】',
    '- 静止画には、ゲーム画面に表示されたプレイヤー名が映っている場合があります。共有前に内容を確認してください。',
    '- このアプリはデータを自動送信しません。このzipは手動で渡してください。',
    ''
  ].join('\n');
}

// ---- 書き出し履歴 (localStorage。ブラウザ外では空扱い) ----
function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
export function getFeedbackHistory() {
  try {
    const s = ls(); if (!s) return [];
    const a = JSON.parse(s.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
export function addFeedbackHistory({ at, batchId, count, filename, mode }) {
  try {
    const s = ls(); if (!s) return [];
    const a = [...getFeedbackHistory(), { at, batchId, count, filename, mode }].slice(-HISTORY_MAX);
    s.setItem(HISTORY_KEY, JSON.stringify(a));
    return a;
  } catch { return []; }
}

export function formatHistoryItem(h) {
  if (!h) return { dtStr: '', modeStr: '', countStr: '', label: 'なし' };
  const d = new Date(h.at);
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const ho = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const dtStr = `${mo}/${da} ${ho}:${mi}`;
  const modeStr = h.mode === 'full' ? '全件' : '追加分';
  const countStr = `${h.count}試合`;
  return { dtStr, modeStr, countStr, label: `${dtStr}・${modeStr}・${countStr}` };
}

