// D58: クラウド同期（Supabase）。端末が主、クラウドは写し。送るのは数値と時刻だけ（slim.js）で、画像・クリップ・信号は端末に残す。
// 流れ：取り込み（クラウドの新しい分を端末へ）→ 送信（端末で変更があった分をクラウドへ）→ 設定（検出の自動調整）。新しい方が勝ち。
import { isSyncable, isDirty, toRow, tombstoneRow, mergeRemote } from './slim.js';
const TABLE = 'inkgraph_matches', SETTINGS = 'inkgraph_settings', PAGE = 200, CHUNK = 25;

/** client: Supabase クライアント、deps: 端末側の読み書き（テストで差し替えられる） */
export function createSync(client, deps) {
  const { allMatches, getMatch, putMatch, delMatch, pendingDeletes, clearPendingDeletes, loadState, saveState, getDetectParams, setDetectParams, backendKey = 'default' } = deps;

  /** 送信済みの印（synced）と取り込みの位置（lastPull）を消す。送り先（プロジェクト）やアカウントが変わったときに、全部を送り直すため（D63） */
  async function resetMarks(st) {
    for (const m of await allMatches()) if (m.synced) { const cur = await getMatch(m.id); if (cur) { delete cur.synced; await putMatch(cur, { keepUpdated: true }); } }
    st.lastPull = null;
  }

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

  // 設定（検出の自動調整の値・名前を付けたブキアイコンの見本）。ブキの見本は、端末とクラウドの和集合にそろえる（名前＋絵が同じなら 1 つ）
  const unionLib = (a, b) => { const out = [...a]; for (const x of b) if (!out.some(y => y.icon === x.icon && y.name === x.name)) out.push(x); return out; };
  async function settings(userId) {
    const local = getDetectParams(), { data, error } = await client.from(SETTINGS).select('data,updated_at').eq('user_id', userId).maybeSingle(); if (error) throw error;
    const rd = (data && data.data) || {}, remote = rd.detectParams || null, remoteLib = (rd.weaponLib && rd.weaponLib.items) || [];
    const localLib = deps.getWeaponLib ? deps.getWeaponLib() : [], union = unionLib(remoteLib, localLib);
    let pulled = false, pushed = false;
    if (!local && remote) { setDetectParams(remote); pulled = true; }
    if (deps.mergeWeaponLib && union.length > localLib.length) { deps.mergeWeaponLib(union); pulled = true; }
    const params = local || remote;
    const needPush = (local && JSON.stringify(local) !== JSON.stringify(remote)) || (deps.getWeaponLib && union.length > remoteLib.length);
    if (needPush) { const payload = { detectParams: params || null, ...(deps.getWeaponLib ? { weaponLib: { items: union } } : (rd.weaponLib ? { weaponLib: rd.weaponLib } : {})) };
      const { error: e2 } = await client.from(SETTINGS).upsert({ user_id: userId, updated_at: new Date().toISOString(), data: payload }, { onConflict: 'user_id' }); if (e2) throw e2; pushed = true; }
    return pushed ? 'pushed' : pulled ? 'pulled' : 'same';
  }

  /** 1 回の同期。失敗しても端末のデータは何も壊さない。戻り値: { ok, ... } */
  async function syncOnce() {
    const { data: { session } } = await client.auth.getSession(); if (!session) return { ok: false, reason: 'signed-out' };
    const userId = session.user.id, st = loadState(); const out = { ok: true };
    try {
      // 前回の同期の相手（プロジェクト・アカウント）と違えば、前の相手に送った印は無効。全部を未送信に戻して、新しい相手へ送り直す
      const key = `${backendKey}|${userId}`;
      if (st.backend !== key) { await resetMarks(st); st.backend = key; out.reset = true; }
      Object.assign(out, await pull(userId, st));
      Object.assign(out, await push(userId));
      out.settings = await settings(userId);
      st.lastSync = new Date().toISOString(); st.lastError = null; saveState(st);
    } catch (e) { st.lastError = String(e && e.message || e); saveState(st); return { ok: false, reason: 'error', error: st.lastError }; }
    return out;
  }
  /** 全部を送り直す（印を消して同期する）。手動の「すべて送り直す」用 */
  async function resyncAll() { const st = loadState(); await resetMarks(st); st.backend = null; saveState(st); return syncOnce(); }
  async function pendingCount() { return (await allMatches()).filter(isDirty).length; }
  return { syncOnce, resyncAll, pendingCount, pull, push, isSyncable };
}
