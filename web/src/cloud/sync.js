// D58: クラウド同期（Supabase）。端末が主、クラウドは写し。送るのは数値と時刻だけ（slim.js）で、画像・クリップ・信号は端末に残す。
// 流れ：取り込み（クラウドの新しい分を端末へ）→ 送信（端末で変更があった分をクラウドへ）→ 設定（検出の自動調整）。新しい方が勝ち。
import { isSyncable, isDirty, toRow, tombstoneRow, mergeRemote } from './slim.js';
const TABLE = 'inkgraph_matches', SETTINGS = 'inkgraph_settings', PAGE = 200, CHUNK = 25;

/** client: Supabase クライアント、deps: 端末側の読み書き（テストで差し替えられる） */
export function createSync(client, deps) {
  const { allMatches, getMatch, putMatch, delMatch, pendingDeletes, clearPendingDeletes, loadState, saveState, getDetectParams, setDetectParams } = deps;

  async function pull(userId, st) {
    let from = st.lastPull || null, pulled = 0, deleted = 0, maxAt = from;
    const local = new Map((await allMatches()).map(m => [m.id, m]));
    for (let off = 0; ; off += PAGE) {
      let q = client.from(TABLE).select('id,updated_at,deleted,data').order('updated_at', { ascending: true }).range(off, off + PAGE - 1);
      if (from) q = q.gte('updated_at', from);
      const { data, error } = await q; if (error) throw error;
      for (const row of data) {
        const r = mergeRemote(local.get(row.id), row);
        if (r.action === 'insert' || r.action === 'update') { await putMatch(r.match, { keepUpdated: true }); local.set(row.id, r.match); pulled++; }
        else if (r.action === 'delete') { await delMatch(row.id, { fromCloud: true }); local.delete(row.id); deleted++; }
        if (!maxAt || row.updated_at > maxAt) maxAt = row.updated_at;
      }
      if (data.length < PAGE) break;
    }
    st.lastPull = maxAt; return { pulled, deleted };
  }

  async function push(userId) {
    const ms = (await allMatches()).filter(isDirty), rows = [], skipped = [];
    for (const m of ms) { const r = toRow(m); if (r) rows.push({ m, row: { ...r, user_id: userId } }); else skipped.push(m.id); }
    let pushed = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const { error } = await client.from(TABLE).upsert(part.map(p => p.row), { onConflict: 'user_id,id' }); if (error) throw error;
      for (const { m, row } of part) { const cur = await getMatch(m.id); if (cur && (cur.updated || '') === row.updated_at) { cur.synced = row.updated_at; await putMatch(cur, { keepUpdated: true }); } pushed++; }
    }
    const dels = pendingDeletes();
    if (dels.length) { const { error } = await client.from(TABLE).upsert(dels.map(d => ({ ...tombstoneRow(d.id, d.at), user_id: userId })), { onConflict: 'user_id,id' }); if (error) throw error; clearPendingDeletes(dels.map(d => d.id)); }
    return { pushed, deletedSent: dels.length, skipped };
  }

  async function settings(userId) {
    const local = getDetectParams(), { data, error } = await client.from(SETTINGS).select('data,updated_at').eq('user_id', userId).maybeSingle(); if (error) throw error;
    const remote = data && data.data && data.data.detectParams || null;
    if (!local && remote) { setDetectParams(remote); return 'pulled'; }
    if (local && JSON.stringify(local) !== JSON.stringify(remote)) { const { error: e2 } = await client.from(SETTINGS).upsert({ user_id: userId, updated_at: new Date().toISOString(), data: { detectParams: local } }, { onConflict: 'user_id' }); if (e2) throw e2; return 'pushed'; }
    return 'same';
  }

  /** 1 回の同期。失敗しても端末のデータは何も壊さない。戻り値: { ok, ... } */
  async function syncOnce() {
    const { data: { session } } = await client.auth.getSession(); if (!session) return { ok: false, reason: 'signed-out' };
    const userId = session.user.id, st = loadState(); const out = { ok: true };
    try {
      Object.assign(out, await pull(userId, st));
      Object.assign(out, await push(userId));
      out.settings = await settings(userId);
      st.lastSync = new Date().toISOString(); st.lastError = null; saveState(st);
    } catch (e) { st.lastError = String(e && e.message || e); saveState(st); return { ok: false, reason: 'error', error: st.lastError }; }
    return out;
  }
  return { syncOnce, pull, push, isSyncable };
}
