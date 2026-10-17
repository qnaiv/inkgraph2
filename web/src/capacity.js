// 静止画容量管理純粋関数・定数 (#32 stage 2)

export const CAP_BYTES = 250 * 1024 * 1024; // 250MB
export const WARN_RATIO = 0.80; // 80% 警告バナー
export const BLOCK_RATIO = 0.95; // 95% 解析開始ブロック
export const TARGET_RATIO = 0.90; // 90% 自動削除目標
export const DEFAULT_PER_MATCH_BYTES = 5 * 1024 * 1024; // 保持0件時の推計値 (5MB)

/**
 * 容量上限バイト数の解決ヘルパー。
 * 引数に正の有限数が渡されればそれを優先。
 * ブラウザ環境では window.__INKGRAPH_CAP_BYTES__ または
 * localStorage 'inkgraph.testCapBytes'（テスト用）を読み、
 * 未設定なら既定の CAP_BYTES (250MB) を返す。
 */
export function getCapBytes(explicitCap) {
  if (Number.isFinite(explicitCap) && explicitCap > 0) return explicitCap;
  if (typeof window !== 'undefined') {
    if (Number.isFinite(window.__INKGRAPH_CAP_BYTES__) && window.__INKGRAPH_CAP_BYTES__ > 0) {
      return window.__INKGRAPH_CAP_BYTES__;
    }
    try {
      const v = window.localStorage?.getItem('inkgraph.testCapBytes');
      if (v) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {}
  }
  return CAP_BYTES;
}

/**
 * 試合の静止画バイト数を判定する。
 * m.stills.bytes が有限値かつ >=0 であれば優先して使用（テストでメタデータによる容量シミュレーションを可能にするため）。
 * それ以外は actualBytes || 0 にフォールバックする。
 */
export function matchStillsBytes(m, actualBytes = 0) {
  if (m && m.stills && Number.isFinite(m.stills.bytes) && m.stills.bytes >= 0) {
    return m.stills.bytes;
  }
  return (Number.isFinite(actualBytes) && actualBytes >= 0) ? actualBytes : 0;
}

/**
 * 容量比率から警告レベルを判定する。
 * >= 0.95: 'block'
 * >= 0.80: 'warn'
 * else: 'ok'
 */
export function capacityLevel(ratio) {
  if (ratio >= BLOCK_RATIO) return 'block';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'ok';
}

/**
 * 容量サマリオブジェクトを生成する。
 * matches: { id, created, favorite, stillsBytes, hasStills, stillsState, ... } の配列。
 * 実際に静止画を保持している試合（hasStills=true、または bytes>0 かつ state!='deleted'/'none'）のみをカウントする。
 */
export function summarizeCapacity(matches = [], capBytes = CAP_BYTES) {
  const cap = getCapBytes(capBytes);
  let usedBytes = 0;
  let favBytes = 0;
  let nonFavBytes = 0;
  let keptCount = 0;

  for (const m of matches) {
    const bytes = m.stillsBytes !== undefined ? m.stillsBytes : matchStillsBytes(m, m.actualBytes);
    const hasStills = m.hasStills !== undefined
      ? !!m.hasStills
      : (bytes > 0 && m.stillsState !== 'deleted' && m.stillsState !== 'none');

    if (!hasStills) continue;

    keptCount++;
    usedBytes += bytes;
    if (m.favorite) {
      favBytes += bytes;
    } else {
      nonFavBytes += bytes;
    }
  }

  const ratio = cap > 0 ? (usedBytes / cap) : 0;
  const pct = Math.round(ratio * 100);
  const level = capacityLevel(ratio);
  const avgBytesPerMatch = keptCount > 0 ? (usedBytes / keptCount) : DEFAULT_PER_MATCH_BYTES;
  const perMatch = (avgBytesPerMatch > 0) ? avgBytesPerMatch : DEFAULT_PER_MATCH_BYTES;
  const remainingMatches = Math.floor(Math.max(0, cap - usedBytes) / perMatch);
  const remainingMatchesAtBlock = Math.floor(Math.max(0, (cap * BLOCK_RATIO) - usedBytes) / perMatch);
  const targetBytes = cap * TARGET_RATIO;
  const excess = Math.max(0, usedBytes - targetBytes);
  const matchesToFree = Math.ceil(excess / perMatch);

  return {
    usedBytes,
    capBytes: cap,
    ratio,
    pct,
    level,
    favBytes,
    nonFavBytes,
    keptCount,
    avgBytesPerMatch,
    remainingMatches,
    remainingMatchesAtBlock,
    matchesToFree
  };
}

/**
 * 容量超過時のクリーンアップ計画を計算する。
 * matches は古い順（created asc）でソートして処理する。
 *
 * - お気に入りのみで上限超過している場合（favBytes > cap）: 自動削除は行わず favOnlyOver=true, removedIds=[] を返す。
 * - 上限超過時（usedBytes > cap、または force=true の場合は usedBytes > targetBytes）:
 *   お気に入り以外の古い試合から、結果の容量が <= 90% (targetRatio) になるまで削除。
 * - お気に入りは決して removedIds に含めない。
 * - お気に入り以外をすべて削除しても targetRatio を超える場合、favOnlyOver=true とする。
 */
export function planCapacityCleanup(matches = [], capBytes = CAP_BYTES, targetRatio = TARGET_RATIO, { force = false } = {}) {
  const cap = getCapBytes(capBytes);
  const targetBytes = cap * targetRatio;

  const keptMatches = [];
  for (const m of matches) {
    const bytes = m.stillsBytes !== undefined ? m.stillsBytes : matchStillsBytes(m, m.actualBytes);
    const hasStills = m.hasStills !== undefined
      ? !!m.hasStills
      : (bytes > 0 && m.stillsState !== 'deleted' && m.stillsState !== 'none');
    if (hasStills) {
      keptMatches.push({
        id: m.id,
        created: m.created || '',
        favorite: !!m.favorite,
        stillsBytes: bytes,
        original: m
      });
    }
  }

  // 古い順にソート (created asc)
  keptMatches.sort((a, b) => (a.created || '').localeCompare(b.created || '') || (a.id || '').localeCompare(b.id || ''));

  let usedBytes = 0;
  let favBytes = 0;
  for (const m of keptMatches) {
    usedBytes += m.stillsBytes;
    if (m.favorite) favBytes += m.stillsBytes;
  }

  const allKeptIds = keptMatches.map(m => m.id);
  const allFavIds = keptMatches.filter(m => m.favorite).map(m => m.id);

  // お気に入りのみで上限超過している場合は自動削除しない
  if (favBytes > cap) {
    return {
      removedIds: [],
      keptIds: allKeptIds,
      freedBytes: 0,
      resultingUsed: usedBytes,
      resultingRatio: cap > 0 ? (usedBytes / cap) : 0,
      favOnlyOver: true,
      skippedFavoriteIds: allFavIds
    };
  }

  const isOver = force ? (usedBytes > targetBytes) : (usedBytes > cap);
  if (!isOver) {
    return {
      removedIds: [],
      keptIds: allKeptIds,
      freedBytes: 0,
      resultingUsed: usedBytes,
      resultingRatio: cap > 0 ? (usedBytes / cap) : 0,
      favOnlyOver: false,
      skippedFavoriteIds: allFavIds
    };
  }

  let resultingUsed = usedBytes;
  let freedBytes = 0;
  const removedIds = [];
  const keptIds = [];
  const skippedFavoriteIds = [];

  for (const m of keptMatches) {
    if (resultingUsed > targetBytes && !m.favorite) {
      removedIds.push(m.id);
      freedBytes += m.stillsBytes;
      resultingUsed -= m.stillsBytes;
    } else {
      keptIds.push(m.id);
      if (m.favorite) {
        skippedFavoriteIds.push(m.id);
      }
    }
  }

  const resultingRatio = cap > 0 ? (resultingUsed / cap) : 0;
  const favOnlyOver = (resultingUsed > targetBytes);

  return {
    removedIds,
    keptIds,
    freedBytes,
    resultingUsed,
    resultingRatio,
    favOnlyOver,
    skippedFavoriteIds
  };
}

export function matchesToFreeToReach(matches, capBytes = CAP_BYTES, targetRatio = TARGET_RATIO) {
  const plan = planCapacityCleanup(matches, capBytes, targetRatio, { force: true });
  return plan.removedIds;
}

/**
 * 容量ラベルを生成する。
 * UI仕様: `使用量${pct}%（あと約${remainingMatches}試合分）`
 * MB表示は含めてはならない。
 */
export function formatCapacityLabel(summary) {
  const pct = summary?.pct ?? 0;
  const rem = summary?.remainingMatches ?? 0;
  return `使用量${pct}%（あと約${rem}試合分）`;
}
