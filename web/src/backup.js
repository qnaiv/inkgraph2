// バックアップ用ヘルパー (#34)。純粋関数中心。
import { localStampTime } from './feedback.js';

export const BACKUP_FILENAME = (d = new Date()) => `inkgraph_backup_${localStampTime(d)}.zip`;

// storage (localStorage互換 getItem/key/length) の 'inkgraph.' prefix全キーを {key: value文字列} で返す。storage nullなら {}
export function collectSettings(storage) {
  if (!storage) return {};
  const res = {};
  const len = storage.length || 0;
  for (let i = 0; i < len; i++) {
    const k = storage.key(i);
    if (k && k.startsWith('inkgraph.')) {
      res[k] = storage.getItem(k);
    }
  }
  try {
    for (const k of Object.keys(storage)) {
      if (k && k.startsWith('inkgraph.') && !(k in res)) {
        res[k] = storage.getItem(k);
      }
    }
  } catch {}
  return res;
}

// 'inkgraph.' prefixの既存キーを全削除してから、settings内の 'inkgraph.' prefixキーだけsetItem。prefix外は無視。
export function applySettings(settings, storage) {
  if (!storage) return;
  const toRemove = [];
  const len = storage.length || 0;
  for (let i = 0; i < len; i++) {
    const k = storage.key(i);
    if (k && k.startsWith('inkgraph.')) toRemove.push(k);
  }
  try {
    for (const k of Object.keys(storage)) {
      if (k && k.startsWith('inkgraph.') && !toRemove.includes(k)) toRemove.push(k);
    }
  } catch {}
  for (const k of toRemove) {
    storage.removeItem(k);
  }
  if (settings && typeof settings === 'object') {
    for (const [k, v] of Object.entries(settings)) {
      if (k.startsWith('inkgraph.') && v !== undefined && v !== null) {
        storage.setItem(k, String(v));
      }
    }
  }
}

// metaオブジェクト生成
export function buildBackupMeta(matches = [], stillsById = {}, settings = {}, exportedAt = new Date()) {
  const exported = typeof exportedAt === 'string' ? exportedAt : exportedAt.toISOString();
  const stills = [];
  let stillsBytes = 0;

  for (const m of matches) {
    const list = (stillsById instanceof Map ? stillsById.get(m.id) : stillsById?.[m.id]) || [];
    for (const s of list) {
      const bytes = s.bytes ?? s.size ?? s.blob?.size ?? 0;
      stillsBytes += bytes;
      stills.push({
        matchId: m.id,
        file: s.file,
        t: s.t,
        reason: s.reason,
        kind: s.kind,
        header: s.header ?? null,
        event: s.event ?? null,
        bytes
      });
    }
  }

  return {
    app: 'InkGraph',
    kind: 'backup',
    format: 1,
    exported,
    includes: {
      matches: true,
      settings: true,
      stills: true,
      videos: false
    },
    counts: {
      matches: matches.length,
      stills: stills.length,
      stillsBytes
    },
    settings: settings || {},
    matches: matches.map(m => ({ ...m })),
    stills
  };
}

// バックアップREADME
export function backupReadme(meta) {
  const mCount = meta?.counts?.matches ?? meta?.matches?.length ?? 0;
  const sCount = meta?.counts?.stills ?? meta?.stills?.length ?? 0;
  const dt = meta?.exported || '';
  return [
    'InkGraph バックアップデータ',
    '',
    `書き出し日時: ${dt}`,
    `試合数: ${mCount} / 保持中静止画: ${sCount}枚`,
    '',
    '【含まれるもの】',
    '- backup.json: 全試合データ (検出結果・正解データreview・お気に入りfavorite・静止画状態stillsState)',
    '- backup.json 内 settings: アプリ設定（localStorageの inkgraph.* キー）',
    '- stills/: 保持中の静止画ファイル (JPEG)',
    '',
    '【含まれないもの】',
    '- 録画・動画ファイル (videos)',
    '- 保持期間経過や手動操作で削除された静止画ファイル',
    '',
    '【静止画が削除された試合・静止画なし試合の扱い】',
    '- 静止画が削除された試合でも、試合ログおよび正解データ(review)はそのまま含まれ復元されます。',
    '- 静止画ファイルが存在しない試合は stills/ に画像が出力されず、復元後も静止画なし(deleted / none)として扱われます。',
    '',
    '【ご注意】',
    '- 静止画にはゲーム画面上のプレイヤー名などが含まれる場合があります。外部への共有時は注意してください。',
    '- このバックアップは端末内・手動管理用であり、自動送信は行われません。',
    ''
  ].join('\n');
}

// jが配列 or j.matches配列を持つ (kind backupでない) 旧形式判定
export function isLegacyMatchJson(j) {
  if (!j || typeof j !== 'object') return false;
  if (j.kind === 'backup') return false;
  if (Array.isArray(j)) return true;
  if (Array.isArray(j.matches)) return true;
  return false;
}

// {matches, stills, bytes} (bytesは blob.size/size)
export function summarize(matches = [], snapsById = {}) {
  let stills = 0;
  let bytes = 0;
  for (const m of matches) {
    const snaps = (snapsById instanceof Map ? snapsById.get(m.id) : snapsById?.[m.id]) || [];
    stills += snaps.length;
    for (const s of snaps) {
      bytes += s.blob?.size ?? s.size ?? s.bytes ?? 0;
    }
  }
  return {
    matches: matches.length,
    stills,
    bytes
  };
}
