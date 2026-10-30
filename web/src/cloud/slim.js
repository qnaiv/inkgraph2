// D58: クラウドに送る試合データ（数値と時刻だけ）の切り出しと、取り込み時の統合。DOM・ネットワーク非依存の純粋関数。
// 送らないもの：静止画・クリップ・録画・検出用の信号（cues）・ヤグラの生データ・自己学習用の特徴量（端末にだけ残す）。
export const LOCAL_ONLY = ['cues', 'tower_rows', 'tower_raw', 'learnFeatures', 'stage_feats', 'stills', 'clips', 'verify', 'videoFile', 'recording', 'video', 'stillsState', 'pre_recorrect', 'remote', 'synced', 'updated', 'favorite_local'];
export const MAX_BYTES = 400 * 1024; // 1 試合の上限（超えたら送らない。通常は 10〜30KB）

/** 同期の対象か：自分の試合だけ（配信映像などの「検証用」＝他人の試合は送らない） */
export function isSyncable(m) { return !!(m && m.id && !(m.source && m.source.owner && m.source.owner !== 'self')); }

/** クラウドに送る形（LOCAL_ONLY を除いた浅いコピー） */
export function slimMatch(m) { const o = {}; for (const [k, v] of Object.entries(m)) if (!LOCAL_ONLY.includes(k)) o[k] = v; return o; }

/** 送る行。updated は端末側の最終更新（ISO）。サイズが上限を超えたら null */
export function toRow(m) {
  const data = slimMatch(m), size = JSON.stringify(data).length; if (size > MAX_BYTES) return null;
  return { id: m.id, updated_at: m.updated || m.created || new Date(0).toISOString(), deleted: false, data };
}
export const tombstoneRow = (id, at) => ({ id, updated_at: at, deleted: true, data: {} });

/** 端末で変更があって、まだ送っていない試合か（updated が synced より新しい） */
export const isDirty = m => isSyncable(m) && (!m.synced || (m.updated || '') > m.synced);

/**
 * クラウドから来た行を、端末の試合（あれば）に統合する。返り値: { action: 'insert'|'update'|'skip'|'delete', match? }
 * - 端末に無い → 端末専用の項目を持たない「閲覧用」として追加（remote:true。画像・信号が無いので検出の作り直しや確認の修正はできない）。
 * - 端末にある → クラウドの updated_at が新しいときだけ、送られる項目を上書きする。端末専用の項目（cues・静止画など）は残す。
 *   端末にも未送信の変更があり、そちらが新しければ何もしない（新しい方が勝ち）。
 */
export function mergeRemote(local, row) {
  if (row.deleted) return local ? { action: 'delete' } : { action: 'skip' };
  const data = row.data || {};
  if (!local) return { action: 'insert', match: { ...data, id: row.id, remote: true, stillsState: 'none', stills: { count: 0, bytes: 0 }, video: { kind: 'none' }, updated: row.updated_at, synced: row.updated_at } };
  if ((local.updated || '') >= row.updated_at) return { action: 'skip' };
  const keep = {}; for (const k of LOCAL_ONLY) if (k in local) keep[k] = local[k];
  return { action: 'update', match: { ...data, ...keep, id: row.id, updated: row.updated_at, synced: row.updated_at } };
}
