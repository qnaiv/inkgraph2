// IndexedDB: matches (records), videos (recorded clips), snaps (still frames)
const DB = 'inkgraph', VER = 1; let dbp = null;
function open() { if (dbp) return dbp; dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, VER);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('matches', { keyPath: 'id' }); d.createObjectStore('videos', { keyPath: 'id' }); const s = d.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true }); s.createIndex('match', 'matchId'); };
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
