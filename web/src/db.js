// IndexedDB: matches (records), videos (recorded clips), snaps (still frames), learn (learning packs)
import { CAP_BYTES, TARGET_RATIO, getCapBytes, matchStillsBytes, summarizeCapacity, planCapacityCleanup } from './capacity.js';
const DB = 'inkgraph', VER = 2; let dbp = null;
function open() { if (dbp) return dbp; dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, VER);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('matches')) d.createObjectStore('matches', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('videos')) d.createObjectStore('videos', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('snaps')) {
      const s = d.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true });
      s.createIndex('match', 'matchId');
    }
    if (!d.objectStoreNames.contains('learn')) d.createObjectStore('learn', { keyPath: 'key' });
  };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return dbp; }
const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r instanceof IDBRequest ? r.result : r); t.onerror = () => rej(t.error); }); };
export const putMatch = m => tx('matches', 'readwrite', s => s.put(m));
export const getMatch = id => tx('matches', 'readonly', s => s.get(id));
export const allMatches = async () => (await tx('matches', 'readonly', s => s.getAll())).sort((a, b) => (a.created || '').localeCompare(b.created || '') || a.match - b.match);
const delSnaps = async id => { for (const sn of await snapsOf(id)) await tx('snaps', 'readwrite', s => s.delete(sn.id)); };
export const delMatch = async id => { await tx('matches', 'readwrite', s => s.delete(id)); await tx('videos', 'readwrite', s => s.delete(id)); await delSnaps(id); };
export async function snapsCount(id) { return (await snapsOf(id)).length; }
// m.favorite: boolean / m.stillsState: 'kept'|'deleted'|'none' (旧レコードはフィールド無し可)
export function stillsStateOf(m, snapCount) {
  if (snapCount > 0) return 'kept';
  if (snapCount === undefined || snapCount === null) { const st = m?.stillsState; if (st === 'kept' || st === 'deleted' || st === 'none') return st; return 'none'; }
  return m?.stillsState === 'deleted' ? 'deleted' : 'none';
}
export async function deleteStills(id) { const m = await getMatch(id); if (!m) return null; await delSnaps(id); m.stillsState = 'deleted'; await putMatch(m); return m; }
export async function setFavorite(id, fav) { const m = await getMatch(id); if (!m) return null; m.favorite = !!fav; await putMatch(m); return m; }
export async function enforceRetention(keep = 30) {
  const ms = (await allMatches()).filter(m => m.favorite !== true).reverse(); // newest first, favorites excluded
  const removed = []; let kept = 0;
  for (const m of ms) {
    if (!(await snapsCount(m.id))) continue;
    if (kept < keep) { kept++; continue; }
    await deleteStills(m.id); removed.push(m.id);
  }
  return removed;
}
export async function stillsUsage(capBytes = getCapBytes()) {
  const cap = getCapBytes(capBytes);
  const ms = await allMatches();
  const list = [];
  for (const m of ms) {
    const snaps = await snapsOf(m.id);
    const snapCount = snaps.length;
    let actualBytes = 0;
    for (const sn of snaps) {
      actualBytes += sn.blob?.size || 0;
    }
    const bytes = matchStillsBytes(m, actualBytes);
    const hasStills = snapCount > 0 || (m.stillsState === 'kept' && bytes > 0);
    list.push({
      id: m.id,
      created: m.created,
      favorite: !!m.favorite,
      stillsBytes: bytes,
      hasStills,
      stillsState: stillsStateOf(m, snapCount),
      snapCount,
      match: m
    });
  }
  const summary = summarizeCapacity(list, cap);
  return { ...summary, matches: list };
}
export async function enforceCapacity(capBytes = getCapBytes(), targetRatio = TARGET_RATIO, opts = {}) {
  const cap = getCapBytes(capBytes);
  const usageBefore = await stillsUsage(cap);
  const plan = planCapacityCleanup(usageBefore.matches, cap, targetRatio, opts);
  if (plan.favOnlyOver && plan.removedIds.length === 0) {
    return {
      removed: [],
      summaryBefore: usageBefore,
      summaryAfter: usageBefore,
      favOnlyOver: true
    };
  }
  const removed = [];
  for (const id of plan.removedIds) {
    await deleteStills(id);
    removed.push(id);
  }
  const usageAfter = await stillsUsage(cap);
  return {
    removed,
    summaryBefore: usageBefore,
    summaryAfter: usageAfter,
    favOnlyOver: plan.favOnlyOver
  };
}
export const putVideo = v => tx('videos', 'readwrite', s => s.put(v));
export const getVideo = id => tx('videos', 'readonly', s => s.get(id));
export const putSnap = sn => tx('snaps', 'readwrite', s => s.add(sn));
export const snapsOf = id => tx('snaps', 'readonly', s => s.index('match').getAll(id));
export async function exportAll() { const ms = await allMatches(); return { app: 'InkGraph', format: 1, exported: new Date().toISOString(), matches: ms }; }
export async function importAll(j) { let n = 0; for (const m of (j.matches || j)) { if (!m.id) m.id = 'imp-' + Math.random().toString(36).slice(2); await putMatch(m); n++; } return n; }
export async function importBackup({ matches = [], stills = [] } = {}) {
  const stillsByMatch = new Map();
  for (const s of stills) {
    if (!s || !s.matchId) continue;
    if (!stillsByMatch.has(s.matchId)) stillsByMatch.set(s.matchId, []);
    stillsByMatch.get(s.matchId).push(s);
  }
  let matchCount = 0;
  let snapCount = 0;
  for (const m of matches) {
    if (!m.id) m.id = 'imp-' + Math.random().toString(36).slice(2);
    await delSnaps(m.id);
    const snaps = stillsByMatch.get(m.id) || [];
    if (snaps.length > 0) {
      m.stillsState = 'kept';
    }
    await putMatch(m);
    matchCount++;
    for (const s of snaps) {
      await putSnap({
        matchId: m.id,
        t: s.t,
        reason: s.reason,
        kind: s.kind,
        header: s.header ?? null,
        event: s.event ?? null,
        blob: s.blob
      });
      snapCount++;
    }
  }
  return { matches: matchCount, stills: snapCount };
}

function normalizeLearnState(row) {
  if (!row) {
    return { stack: [], versions: [], activePackId: null };
  }
  const stack = Array.isArray(row.stack) ? row.stack : [];
  let versions = null;
  if (Array.isArray(row.versions)) {
    const seen = new Set();
    versions = [];
    for (const p of row.versions) {
      if (p && p.packId && !seen.has(p.packId)) {
        seen.add(p.packId);
        versions.push(p);
      }
    }
  } else {
    const seen = new Set();
    versions = [];
    for (const p of stack) {
      if (p && p.packId && !seen.has(p.packId)) {
        seen.add(p.packId);
        versions.push(p);
      }
    }
  }
  const activePackId = (stack.length > 0 && stack[stack.length - 1]?.packId) ? stack[stack.length - 1].packId : null;
  return { stack, versions, activePackId };
}

export async function getLearnState() {
  const row = await tx('learn', 'readonly', s => s.get('state')).catch(() => null);
  return normalizeLearnState(row);
}

export async function putLearnState(state) {
  const norm = normalizeLearnState(state);
  const rec = { key: 'state', stack: norm.stack, versions: norm.versions, activePackId: norm.activePackId };
  await tx('learn', 'readwrite', s => s.put(rec));
  return norm;
}

export async function applyLearnPack(pack) {
  const state = await getLearnState();
  let candidateId = pack?.packId || ('lp-' + new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0]);
  const existingIds = new Set(state.versions.map(p => p.packId));
  if (existingIds.has(candidateId)) {
    let counter = 2;
    while (existingIds.has(`${candidateId}-${counter}`)) {
      counter++;
    }
    candidateId = `${candidateId}-${counter}`;
  }
  const savedPack = { ...pack, packId: candidateId };
  state.versions.push(savedPack);
  state.stack.push(savedPack);
  await putLearnState(state);
  return savedPack;
}

export async function listLearnPacks() {
  const state = await getLearnState();
  return [...state.versions].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

export async function activateLearnPack(packId) {
  const state = await getLearnState();
  const pack = state.versions.find(p => p.packId === packId);
  if (!pack) return null;
  state.stack.push(pack);
  await putLearnState(state);
  return pack;
}

export async function deactivateLearnPack() {
  const state = await getLearnState();
  state.stack = [];
  await putLearnState(state);
  return null;
}

export async function activeLearnPack(state = null) {
  const s = state || await getLearnState();
  const st = s?.stack;
  return (st && st.length) ? st[st.length - 1] : null;
}

export async function rollbackLearnPack() {
  const state = await getLearnState();
  if (state.stack.length > 0) {
    state.stack.pop();
    await putLearnState(state);
  }
  return state.stack.length ? state.stack[state.stack.length - 1] : null;
}

export async function updateSnapFeatures(snapId, features) {
  const snap = await tx('snaps', 'readonly', s => s.get(snapId));
  if (!snap) return null;
  snap.features = features;
  await tx('snaps', 'readwrite', s => s.put(snap));
  return snap;
}

export async function setMatchLearnFeatures(matchId, list) {
  const m = await getMatch(matchId);
  if (!m) return null;
  m.learnFeatures = list;
  await putMatch(m);
  return m;
}
