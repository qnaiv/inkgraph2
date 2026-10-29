// D77: 検出した件数と、結果画面（公式アプリの表示）の数の突き合わせ。補正はしない（件数合わせで出来事を足したり消したりしない）。DOM 非依存の純粋関数。
// 結果画面の数を信用するには、結果画面を読めたコマが minFrames 以上あること（読み違いで誤って要修正にしないため）。
export const COUNT_CHECK = { minFrames: 3 };

/** 検出した数。デス＝own_deaths、スペシャル＝発動した回数、キル＝own_kills（アシストは含まない） */
export function detectedCounts(rec) {
  return {
    deaths: (rec.own_deaths || []).length,
    specials: (rec.special || []).filter(e => e.outcome === 'activated').length,
    kills: (rec.own_kills || []).length
  };
}

/**
 * 突き合わせの結果。mismatch は理由のキー（fix_pack.js の FIX_REASONS）。
 *  デス・スペシャル: 結果画面と同じ数でなければ不一致。
 *  キル: 結果画面は K+A（アシスト込み）なので、検出キルが K+A を超えたときだけ不一致（足りない分はアシストかもしれない）。
 */
export function countCheck(rec, { minFrames = COUNT_CHECK.minFrames } = {}) {
  const rs = rec.result_screen || {}, own = rs.own, cf = rec.confidence || {};
  const frames = (cf.personal_frames || 0) + (cf.board_frames || 0), det = detectedCounts(rec);
  const isInt = v => Number.isInteger(v) && v >= 0;
  const trusted = !!own && frames >= minFrames && isInt(own.deaths) && isInt(own.specials);
  const out = { trusted, detected: det, result: own ? { ka: own.ka ?? null, deaths: own.deaths ?? null, specials: own.specials ?? null } : null, mismatch: [] };
  if (!trusted) return out;
  out.mismatch = compareCounts(det, own);
  return out;
}

/** 検出した数 det ＝ {kills, deaths, specials} と、結果画面の数 own ＝ {ka, deaths, specials} の不一致の理由。ライブの暫定値にも使う */
export function compareCounts(det, own) {
  const isInt = v => Number.isInteger(v) && v >= 0, out = [];
  if (!own) return out;
  if (isInt(own.deaths) && det.deaths !== own.deaths) out.push('death');
  if (isInt(own.specials) && det.specials !== own.specials) out.push('special');
  if (isInt(own.ka) && det.kills > own.ka) out.push('kill');
  return out;
}

/** 不一致の説明（ログ・通知用）。例: 「デス 検出 6／リザルト 5」 */
export function mismatchText(cc) {
  if (!cc || !cc.trusted || !cc.mismatch.length) return '';
  const L = { death: `デス 検出 ${cc.detected.deaths}／リザルト ${cc.result.deaths}`, special: `スペシャル 検出 ${cc.detected.specials}／リザルト ${cc.result.specials}`, kill: `キル 検出 ${cc.detected.kills}／K+A ${cc.result.ka}（K+A を超過）` };
  return cc.mismatch.map(k => L[k]).join('、');
}
