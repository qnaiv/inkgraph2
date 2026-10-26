// D58: クラウド同期（Supabase）の接続先。公開しても安全な値（publishable キーは行ごとのアクセス制限 RLS で守られる）。
// InkGraph 専用の Supabase プロジェクト `inkgraph`（D61。以前は別アプリと同居の fragments だったが、CAPTCHA と Site URL が別アプリ用で使えなかった）
export const SUPABASE_URL = 'https://mcbakoycsrijtohwipyb.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_o6FhHAJKsTZgXwdxyvjbdA_yGuXcouL';
