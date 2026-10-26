export const CLIP = {
  STEP: 0.2, // コマ間隔（秒）。解析のフレーム（5 枚／秒）をそのまま全部残す＝5fps。これより細かくはできない（D62）
  H: 720,
  TYPE: 'image/webp',
  QUALITY: 0.15,
  FALLBACK_TYPE: 'image/jpeg',
  FALLBACK_QUALITY: 0.3,
  BEFORE: 2,
  AFTER: { death: 2, kill: 2, special: 1 },
  MAX_SCENES: 12,
  MAX_BYTES: Math.round(12 * 1024 * 1024),
  SPECIAL_TOL: 1.0
};

export const PRIORITY = { death: 0, special: 1, kill: 2 };

export const CLIP_KIND_JA = { death: 'デス', special: 'スペシャル発動', kill: 'キル' };

export function clipBytes(c) {
  if (!c || !c.frames) return 0;
  let sum = 0;
  for (let i = 0; i < c.frames.length; i++) {
    const f = c.frames[i];
    sum += f?.blob?.size ?? f?.size ?? 0;
  }
  return sum;
}

export function selectClips(clips, rec, { maxScenes = CLIP.MAX_SCENES, maxBytes = CLIP.MAX_BYTES } = {}) {
  if (!clips || !clips.length) return [];
  const cands = [];
  for (const c of clips) {
    if (!c.frames || c.frames.length === 0) continue;
    const filteredEvents = (c.events || []).filter(ev => {
      if (ev.kind !== 'special') return true;
      if (!rec || !rec.special || !Array.isArray(rec.special)) return false;
      return rec.special.some(sp =>
        sp.outcome === 'activated' &&
        typeof sp.activated_at === 'number' &&
        Math.abs(sp.activated_at - ev.t) <= CLIP.SPECIAL_TOL
      );
    });
    if (filteredEvents.length === 0) continue;

    const kinds = [...new Set(filteredEvents.map(e => e.kind))].sort(
      (a, b) => (PRIORITY[a] ?? 999) - (PRIORITY[b] ?? 999)
    );
    const pri = PRIORITY[kinds[0]] ?? 999;
    const bytes = clipBytes(c);

    cands.push({
      clip: c,
      events: filteredEvents,
      kinds,
      kind: kinds[0],
      bytes,
      pri
    });
  }

  cands.sort((a, b) => {
    if (a.pri !== b.pri) return a.pri - b.pri;
    return a.clip.t - b.clip.t;
  });

  const accepted = [];
  let totalBytes = 0;
  for (const item of cands) {
    if (accepted.length < maxScenes && totalBytes + item.bytes <= maxBytes) {
      accepted.push(item);
      totalBytes += item.bytes;
    }
  }

  accepted.sort((a, b) => a.clip.t - b.clip.t);
  return accepted.map(a => ({
    ...a.clip,
    t: (a.events.find(e => e.kind === a.kind) || a.events[0]).t, /* representative time = first event of the top-priority kind */
    events: a.events,
    kinds: a.kinds,
    kind: a.kind,
    bytes: a.bytes
  }));
}

export function clipAt(clips, t) {
  if (!clips || !clips.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const c of clips) {
    if (t >= c.from && t <= c.to) {
      const center = (c.from + c.to) / 2;
      const dist = Math.abs(t - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
  }
  return best;
}
