// IndexedDB: matches (records), videos (recorded clips), snaps (still frames)
const DB = 'inkgraph', VER = 1; let dbp = null;
function open() { if (dbp) return dbp; dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, VER);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('matches', { keyPath: 'id' }); d.createObjectStore('videos', { keyPath: 'id' }); const s = d.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true }); s.createIndex('match', 'matchId'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return dbp; }
const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r && r.result !== undefined ? r.result : r); t.onerror = () => rej(t.error); }); };
export const putMatch = m => tx('matches', 'readwrite', s => s.put(m));
export const getMatch = id => tx('matches', 'readonly', s => s.get(id));
export const allMatches = async () => (await tx('matches', 'readonly', s => s.getAll())).sort((a, b) => (a.created || '').localeCompare(b.created || '') || a.match - b.match);
export const delMatch = async id => { await tx('matches', 'readwrite', s => s.delete(id)); await tx('videos', 'readwrite', s => s.delete(id)); for (const sn of await snapsOf(id)) await tx('snaps', 'readwrite', s => s.delete(sn.id)); };
export const putVideo = v => tx('videos', 'readwrite', s => s.put(v));
export const getVideo = id => tx('videos', 'readonly', s => s.get(id));
export const putSnap = sn => tx('snaps', 'readwrite', s => s.add(sn));
export const snapsOf = id => tx('snaps', 'readonly', s => s.index('match').getAll(id));
export async function exportAll() { const ms = await allMatches(); return { app: 'InkGraph', format: 1, exported: new Date().toISOString(), matches: ms }; }
export async function importAll(j) { let n = 0; for (const m of (j.matches || j)) { if (!m.id) m.id = 'imp-' + Math.random().toString(36).slice(2); await putMatch(m); n++; } return n; }
