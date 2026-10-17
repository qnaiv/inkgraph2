// Self-learning (S0-S1): feature extraction, sample collection, threshold sweep, pack generation
import { resizeArea } from './core/img.js';

export const FEATURE_VERSION = 1;
export const DEFAULT_THRESHOLDS = { mode: 0.5, stage: 0.5 };

/**
 * Extracts a lightweight feature descriptor from a snapshot header.
 * Snapshot header format: { mode, mode_score, stage, stage_score }
 */
export function featureFromHeader(snap) {
  if (!snap || !snap.header) return null;
  const h = snap.header;
  const mode = h.mode ?? null;
  const modeScore = h.modeScore ?? h.mode_score ?? null;
  const stage = h.stage ?? null;
  const stageScore = h.stageScore ?? h.stage_score ?? null;
  return {
    v: FEATURE_VERSION,
    kind: snap.kind || null,
    t: snap.t ?? null,
    header: { mode, modeScore, stage, stageScore },
    gray: null,
    source: 'header'
  };
}

/**
 * Downsamples RGBA frame to 32x18 luminance thumbnail (0-255 integers, box averaged).
 * frame: { w, h, data }
 */
export function extractGrayThumb(frame) {
  const { w, h, data } = frame;
  const n = w * h;
  const gr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    gr[i] = (data[o] * 4899 + data[o + 1] * 9617 + data[o + 2] * 1868 + 8192) >> 14;
  }
  const resized = resizeArea(gr, w, h, 32, 18);
  const out = new Array(32 * 18);
  for (let i = 0; i < resized.length; i++) {
    out[i] = Math.round(resized[i]);
  }
  return out;
}

/**
 * Returns ground truth values for a match (mode/stage).
 * Only confirmed matches:
 * - review.rmarks[field] === 'ok' -> result_screen[field]
 * - review.rmarks[field] === 'wrong' && review.fix[field] -> review.fix[field]
 * - otherwise null
 */
export function truthForMatch(m, targetField = null) {
  if (!m || !m.review) {
    const empty = { mode: null, stage: null };
    return targetField ? empty[targetField] ?? null : empty;
  }
  const rmarks = m.review.rmarks || {};
  const fix = m.review.fix || {};
  const res = m.result_screen || {};

  const getVal = field => {
    const mark = rmarks[field];
    if (mark === 'ok') {
      return res[field] ?? null;
    }
    if (mark === 'wrong' && fix[field] !== undefined && fix[field] !== null && fix[field] !== '') {
      return fix[field];
    }
    return null;
  };

  const truths = {
    mode: getVal('mode'),
    stage: getVal('stage')
  };
  return targetField ? truths[targetField] ?? null : truths;
}

/**
 * Collects mode/stage samples from matches and snapshot features.
 * Priority: snap.features > match.learnFeatures > featureFromHeader(snap).
 * Excludes samples where truth is null or score is non-finite.
 */
export function collectSamples(matches, snapsOrFeaturesByMatchId = null) {
  const samples = [];
  if (!matches || !Array.isArray(matches)) return samples;

  for (const m of matches) {
    if (!m || !m.id) continue;
    const truths = truthForMatch(m);

    let rawList = null;
    if (snapsOrFeaturesByMatchId) {
      if (snapsOrFeaturesByMatchId instanceof Map) {
        rawList = snapsOrFeaturesByMatchId.get(m.id);
      } else if (typeof snapsOrFeaturesByMatchId === 'object') {
        rawList = snapsOrFeaturesByMatchId[m.id];
      }
    }

    let feats = [];
    if (rawList && Array.isArray(rawList) && rawList.length > 0) {
      for (const item of rawList) {
        if (!item) continue;
        if (item.features) {
          feats.push(item.features);
        } else if (item.v && item.source) {
          // Already a feature object
          feats.push(item);
        } else {
          const f = featureFromHeader(item);
          if (f) feats.push(f);
        }
      }
    }

    if (feats.length === 0 && Array.isArray(m.learnFeatures) && m.learnFeatures.length > 0) {
      feats = m.learnFeatures;
    }

    for (const feat of feats) {
      if (!feat || !feat.header) continue;
      const h = feat.header;

      // mode sample
      const mTruth = truths.mode;
      const mScore = h.modeScore ?? h.mode_score;
      if (mTruth !== null && mTruth !== undefined && Number.isFinite(mScore)) {
        samples.push({
          matchId: m.id,
          field: 'mode',
          detected: h.mode ?? null,
          score: mScore,
          truth: mTruth
        });
      }

      // stage sample
      const sTruth = truths.stage;
      const sScore = h.stageScore ?? h.stage_score;
      if (sTruth !== null && sTruth !== undefined && Number.isFinite(sScore)) {
        samples.push({
          matchId: m.id,
          field: 'stage',
          detected: h.stage ?? null,
          score: sScore,
          truth: sTruth
        });
      }
    }
  }

  return samples;
}

/**
 * Predicts whether detected value passes threshold thr.
 */
export function predict(sample, thr) {
  const pred = sample.score > thr ? sample.detected : null;
  const isCorrect = pred === sample.truth;
  return { pred, isCorrect };
}

/**
 * Compares before and after performance on samples.
 * before and after can be a single number or { mode, stage } object.
 * Returns { total: {...}, mode: {...}, stage: {...} }
 */
export function compareSamples(samples, before, after) {
  const initMetrics = () => ({
    n: 0,
    beforeCorrect: 0,
    afterCorrect: 0,
    beforeAcc: 0,
    afterAcc: 0,
    fixed: 0,
    broken: 0,
    unchanged: 0
  });

  const res = {
    total: initMetrics(),
    mode: initMetrics(),
    stage: initMetrics()
  };

  const update = (m, bCorr, aCorr) => {
    m.n++;
    if (bCorr) m.beforeCorrect++;
    if (aCorr) m.afterCorrect++;
    if (!bCorr && aCorr) m.fixed++;
    else if (bCorr && !aCorr) m.broken++;
    else m.unchanged++;
    m.beforeAcc = m.n > 0 ? m.beforeCorrect / m.n : 0;
    m.afterAcc = m.n > 0 ? m.afterCorrect / m.n : 0;
  };

  if (!samples || !Array.isArray(samples)) return res;

  for (const s of samples) {
    const f = s.field;
    const bThr = typeof before === 'number' ? before : (before?.[f] ?? DEFAULT_THRESHOLDS[f] ?? 0.5);
    const aThr = typeof after === 'number' ? after : (after?.[f] ?? DEFAULT_THRESHOLDS[f] ?? 0.5);

    const bCorr = predict(s, bThr).isCorrect;
    const aCorr = predict(s, aThr).isCorrect;

    update(res.total, bCorr, aCorr);
    if (res[f]) update(res[f], bCorr, aCorr);
  }

  return res;
}

/**
 * Splits samples into train and holdout by matchId.
 * If 2 or more matches exist, the last match (by matchId sort) is holdout, rest train.
 * If 1 or 0 match exists, holdout is empty.
 */
export function splitHoldout(samples) {
  if (!samples || samples.length === 0) {
    return { train: [], holdout: [] };
  }
  const matchIds = [...new Set(samples.map(s => s.matchId))].sort();
  if (matchIds.length < 2) {
    return { train: [...samples], holdout: [] };
  }
  const holdoutId = matchIds[matchIds.length - 1];
  const train = samples.filter(s => s.matchId !== holdoutId);
  const holdout = samples.filter(s => s.matchId === holdoutId);
  return { train, holdout };
}

/**
 * Generates candidate thresholds on train samples using sweep: 0.30..0.80 step 0.05.
 * Best criterion: max correct, ties broken by proximity to 0.50 (if still tie, smaller value).
 * Fields with < 3 train samples have insufficient: true and retain default threshold.
 * Holdout samples are only used for evaluation.
 */
export function generateCandidate(samples) {
  const { train, holdout } = splitHoldout(samples);
  const sourceMatchIds = [...new Set(train.map(s => s.matchId))].sort();

  const candidates = [];
  for (let v = 30; v <= 80; v += 5) {
    candidates.push(Math.round(v) / 100);
  }

  const insufficient = [];
  const thresholds = { ...DEFAULT_THRESHOLDS };

  for (const field of ['mode', 'stage']) {
    const fieldTrain = train.filter(s => s.field === field);
    if (fieldTrain.length < 3) {
      insufficient.push(field);
      thresholds[field] = DEFAULT_THRESHOLDS[field];
      continue;
    }

    let bestThr = DEFAULT_THRESHOLDS[field];
    let bestCorrect = -1;
    let bestDist = 1;

    for (const thr of candidates) {
      let correct = 0;
      for (const s of fieldTrain) {
        if (predict(s, thr).isCorrect) correct++;
      }
      const dist = Math.abs(thr - 0.5);
      if (
        correct > bestCorrect ||
        (correct === bestCorrect && dist < bestDist) ||
        (correct === bestCorrect && Math.abs(dist - bestDist) < 1e-6 && thr < bestThr)
      ) {
        bestCorrect = correct;
        bestDist = dist;
        bestThr = thr;
      }
    }
    thresholds[field] = bestThr;
  }

  const trainCompare = compareSamples(train, DEFAULT_THRESHOLDS, thresholds);
  const holdoutCompare = holdout.length > 0 ? compareSamples(holdout, DEFAULT_THRESHOLDS, thresholds) : null;

  const noteParts = [
    `train ${train.length} samples (${sourceMatchIds.length} matches)`,
    holdout.length > 0 ? `holdout ${holdout.length} samples` : 'holdout なし'
  ];
  if (insufficient.length > 0) {
    noteParts.push(`材料不足: ${insufficient.join(', ')}`);
  }

  return {
    thresholds,
    trainCompare,
    holdoutCompare,
    sourceMatchIds,
    insufficient,
    note: noteParts.join(' / ')
  };
}

/**
 * Creates a learning pack object from a candidate.
 */
export function makePack(candidate, nowIso = null) {
  const created = nowIso || new Date().toISOString();
  // packId: 'lp-' + compact ISO string
  const cleanIso = created.replace(/[-:]/g, '').replace('T', '-').split('.')[0];
  const packId = `lp-${cleanIso}`;
  return {
    packId,
    version: 1,
    thresholds: { ...candidate.thresholds },
    sourceMatchIds: [...candidate.sourceMatchIds],
    metrics: {
      train: candidate.trainCompare,
      holdout: candidate.holdoutCompare
    },
    created,
    status: 'active',
    base: 's0s1'
  };
}

/**
 * Computes a still image feature using browser Canvas/createImageBitmap APIs.
 * Safe for node imports (DOM APIs referenced strictly inside function).
 */
export async function computeStillFeature(blob, snap = {}) {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') {
    throw new Error('computeStillFeature is only supported in browser environments');
  }
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close?.();

  const gray = extractGrayThumb({ w: imgData.width, h: imgData.height, data: imgData.data });
  const hFeat = featureFromHeader(snap);

  return {
    v: FEATURE_VERSION,
    kind: snap.kind || null,
    t: snap.t ?? null,
    header: hFeat?.header || null,
    gray,
    source: 'still'
  };
}
