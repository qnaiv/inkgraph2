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
// D58: 書き込みのたびに更新時刻（updated）を付ける（クラウド同期の新旧の判定用）。同期が取り込む／送った記録（keepUpdated）は付け替えない。
export const putMatch = (m, opts = {}) => { if (!opts.keepUpdated) m.updated = new Date().toISOString(); const r = tx('matches', 'readwrite', s => s.put(m)); if (!opts.keepUpdated && typeof window !== 'undefined') r.then(() => window.dispatchEvent(new CustomEvent('inkgraph:dirty')), () => {}); return r; };
export const getMatch = id => tx('matches', 'readonly', s => s.get(id));
export const allMatches = async () => (await tx('matches', 'readonly', s => s.getAll())).sort((a, b) => (a.created || '').localeCompare(b.created || '') || a.match - b.match);
const delSnaps = async id => { for (const sn of await snapsOf(id)) await tx('snaps', 'readwrite', s => s.delete(sn.id)); };
const DEL_KEY = 'inkgraph.cloud.deleted'; // クラウドに「消した」と伝えるための印（送ったら消す）
export const pendingDeletes = () => { try { return JSON.parse(localStorage.getItem(DEL_KEY) || '[]'); } catch { return []; } };
export const clearPendingDeletes = ids => { try { localStorage.setItem(DEL_KEY, JSON.stringify(pendingDeletes().filter(d => !ids.includes(d.id)))); } catch { /* ignore */ } };
export const delMatch = async (id, opts = {}) => {
  if (!opts.fromCloud) { try { localStorage.setItem(DEL_KEY, JSON.stringify([...pendingDeletes().filter(d => d.id !== id), { id, at: new Date().toISOString() }])); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('inkgraph:dirty')); } catch { /* ignore */ } }
  await tx('matches', 'readwrite', s => s.delete(id)); await tx('videos', 'readwrite', s => s.delete(id)); await delSnaps(id); };
export async function snapsCount(id) { return (await snapsOf(id)).length; }
// m.favorite: boolean / m.stillsState: 'kept'|'deleted'|'none' (旧レコードはフィールド無し可)
export function stillsStateOf(m, snapCount) {
  if (snapCount > 0) return 'kept';
  if (snapCount === undefined || snapCount === null) { const st = m?.stillsState; if (st === 'kept' || st === 'deleted' || st === 'none') return st; return 'none'; }
  return m?.stillsState === 'deleted' ? 'deleted' : 'none';
}
export async function deleteStills(id) { const m = await getMatch(id); if (!m) return null; await delSnaps(id); m.stillsState = 'deleted'; await putMatch(m); return m; }
export async function setFavorite(id, fav) { const m = await getMatch(id); if (!m) return null; m.favorite = !!fav; await putMatch(m); return m; }
// D59: 静止画・場面クリップ（と、昔の録画）を残す試合数。既定は直近 3 試合（確認に使う分だけ）。お気に入りは数えず、自動では消さない。
// 試合の数値データ（検出結果・確認画面の修正）は、静止画が消えても残る（クラウドにも同期される）。
export const RETENTION_KEY = 'inkgraph.retentionKeep', RETENTION_DEFAULT = 3, RETENTION_CHOICES = [1, 2, 3, 5, 10, 30];
export function getRetentionKeep() { try { const v = parseInt(localStorage.getItem(RETENTION_KEY) || '', 10); return Number.isFinite(v) && v >= 1 && v <= 100 ? v : RETENTION_DEFAULT; } catch { return RETENTION_DEFAULT; } }
export function setRetentionKeep(n) { try { localStorage.setItem(RETENTION_KEY, String(Math.max(1, Math.min(100, Math.round(n))))); } catch { /* ignore */ } }
/** 整理の対象（残す分より古い試合）の id を返す。消さずに数えるだけ（確認ダイアログ用） */
export async function retentionPlan(keep = getRetentionKeep()) {
  const ms = (await allMatches()).filter(m => m.favorite !== true).reverse(); // 新しい順・お気に入りを除く
  const rotate = []; let kept = 0;
  for (const m of ms) {
    const has = (await snapsCount(m.id)) > 0 || !!(await getVideo(m.id));
    if (!has) continue;
    if (kept < keep) { kept++; continue; }
    rotate.push(m.id);
  }
  return rotate;
}
export async function enforceRetention(keep = getRetentionKeep()) {
  const removed = await retentionPlan(keep);
  for (const id of removed) { if (await snapsCount(id)) await deleteStills(id); await tx('videos', 'readwrite', s => s.delete(id)); }
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
export function groupClips(snaps) {
  const map = new Map();
  for (const s of snaps) {
    if (!s.clip || s.clip.idx === undefined) continue;
    const idx = s.clip.idx;
    if (!map.has(idx)) {
      map.set(idx, {
        idx,
        t: s.clip.t,
        from: s.clip.from,
        to: s.clip.to,
        kind: s.clip.kind,
        kinds: s.clip.kinds,
        events: s.clip.events,
        frames: []
      });
    }
    map.get(idx).frames.push({ t: s.t, blob: s.blob });
  }
  const result = Array.from(map.values());
  for (const c of result) {
    c.frames.sort((a, b) => a.t - b.t);
  }
  result.sort((a, b) => a.t - b.t);
  return result;
}
export const clipsOf = async id => groupClips((await snapsOf(id)).filter(s => s.kind === 'clip'));
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
