// デスクトップ版の自動アップデート（b21）の、画面側。状態はデスクトップ側（desktop/updater.js）が持ち、ここは見せるだけ。
// ブラウザ版（window.inkgraphDesktop が無い）では何もしない。
/** 状態 → 設定画面に出す短い文。録画中は「録画が終わってから」と出す */
export function describeUpdate(st) {
  if (!st || st.status === 'disabled') return '自動アップデートは、インストールした版だけで動きます（この起動では無効）。';
  const v = st.version ? `v${st.version}` : '';
  const rec = st.recording ? '（録画中なので、確認・更新は録画が終わってから）' : '';
  switch (st.status) {
    case 'checking': return '確認しています…';
    case 'none': return '最新の版です。';
    case 'available': return `新しい版 ${v} があります。${rec || 'ダウンロードします…'}`;
    case 'downloading': return `新しい版 ${v} をダウンロード中${typeof st.percent === 'number' ? ` ${Math.round(st.percent)}%` : ''}…`;
    case 'ready': return `新しい版 ${v} の準備ができました。${rec || '再起動すると入れ替わります。'}`;
    case 'error': return `更新を確認できませんでした: ${st.message || '理由不明'}`;
    default: return rec;
  }
}
/** 通知バナーを出すべきか（準備ができていて、録画中でないとき） */
export const shouldBanner = st => !!st && st.status === 'ready' && !st.recording;

/** 画面の右下に、更新の通知を出す。押すと再起動して入れ替える。「あとで」で、その版については閉じる */
export function mountUpdateBanner(D, doc = document) {
  if (!D || !D.onUpdate || !D.getUpdateState) return () => {};
  let el = null, dismissed = null;
  const hide = () => { if (el) { el.remove(); el = null; } };
  const render = st => {
    if (!shouldBanner(st) || dismissed === st.version) return hide();
    if (!el) {
      el = doc.createElement('div'); el.id = 'update-banner'; el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;max-width:320px;padding:12px 14px;border-radius:10px;background:var(--bg-elev,#1c1e3a);color:var(--fg,#eee);border:1px solid var(--accent,#7c8cff);box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:13px';
      doc.body.appendChild(el);
    }
    const v = st.version ? `v${st.version}` : '';
    el.innerHTML = `<div style="margin-bottom:8px"><b>新しい版 ${v} があります</b><br><span style="opacity:.8">再起動して更新します。</span></div>`;
    const go = doc.createElement('button'); go.className = 'btn btn-sm btn-primary'; go.id = 'update-install'; go.type = 'button'; go.textContent = '再起動して更新';
    go.onclick = async () => { go.disabled = true; const r = await D.installUpdate().catch(() => null); if (r && !r.ok) { go.disabled = false; go.textContent = r.reason === 'recording' ? '録画が終わってから' : '更新できません'; } };
    const later = doc.createElement('button'); later.className = 'btn btn-sm'; later.id = 'update-later'; later.type = 'button'; later.style.marginLeft = '8px'; later.textContent = 'あとで';
    later.onclick = () => { dismissed = st.version; hide(); };
    el.append(go, later);
  };
  const off = D.onUpdate(render);
  D.getUpdateState().then(render).catch(() => {});
  return () => { try { off && off(); } catch { /* ignore */ } hide(); };
}
