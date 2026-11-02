// 起動中のバージョン表示。値はビルド時に vite の define で埋め込まれる（vite.config.js）。DOM 非依存。
/** 'v1.0.0 (abc1234, 2026-11-02)'。開発起動なら 'v1.0.0 (dev, abc1234, 2026-11-02)'。desktop があれば '／デスクトップ v0.1.0' を足す */
export function formatVersion({ version, commit, builtAt, dev = false, desktop = null } = {}) {
  const date = typeof builtAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(builtAt) ? builtAt.slice(0, 10) : 'unknown';
  const parts = [dev ? 'dev' : null, commit || 'unknown', date].filter(Boolean);
  return `${version ? 'v' + version : 'バージョン不明'} (${parts.join(', ')})${desktop ? `／デスクトップ v${desktop}` : ''}`;
}
/** ビルドに埋め込まれた値から表示文字列を作る（define が無い環境では unknown） */
export function currentVersion(desktop = null) {
  const g = (typeof __APP_VERSION__ !== 'undefined');
  return formatVersion({
    version: g ? __APP_VERSION__ : null, commit: typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : null,
    builtAt: typeof __APP_BUILT__ !== 'undefined' ? __APP_BUILT__ : null, dev: typeof __APP_DEV__ !== 'undefined' ? __APP_DEV__ : false, desktop
  });
}
