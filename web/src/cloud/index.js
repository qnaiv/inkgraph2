// D58: クラウド同期の入口（ブラウザ用）。ログイン、自動同期のきっかけ（保存・復帰・オンライン）、状態の保存。
import { createClient } from '@supabase/supabase-js';
import * as db from '../db.js';
import * as DP from '../detect_params.js';
import { createSync } from './sync.js';
import * as WL from '../weapon_lib.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
const STATE_KEY = 'inkgraph.cloud', AUTO_KEY = 'inkgraph.cloud.auto';
let client = null, sync = null, timer = null, running = false; const listeners = new Set();
export const loadState = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; } catch { return {}; } };
export const saveState = s => { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
export const autoEnabled = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const setAuto = on => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* ignore */ } };
export function getClient() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); // hash ルーティングと衝突しないよう PKCE（?code=）
  return client;
}
const getSync = () => sync || (sync = createSync(getClient(), { allMatches: db.allMatches, getMatch: db.getMatch, putMatch: db.putMatch, delMatch: db.delMatch, pendingDeletes: db.pendingDeletes, clearPendingDeletes: db.clearPendingDeletes, loadState, saveState,
  backendKey: SUPABASE_URL, getWeaponLib: () => WL.loadUserLib().items, mergeWeaponLib: items => WL.mergeIntoLocal(items), getDetectParams: () => DP.activeParams(), setDetectParams: p => DP.applyParams(p, { note: 'クラウドから取り込み' }) }));
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = r => listeners.forEach(f => { try { f(r); } catch { /* ignore */ } });
export async function getUser() { const { data: { session } } = await getClient().auth.getSession(); return session ? session.user : null; }
const redirect = () => location.origin + location.pathname;
export const signInGoogle = () => getClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect() } });
export const signInEmail = email => getClient().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect() } });
/** ID（メールアドレスの形）とパスワードで登録／ログイン。「Confirm email」がオフなら確認メールは送られず、すぐ入れる（D61）。
 *  戻り値: { ok, needsConfirm?, error? }。error は人が読める文にする。 */
const authMsg = e => { const m = String((e && e.message) || e || ''); if (/invalid login credentials/i.test(m)) return 'IDまたはパスワードが違います。'; if (/already registered|already been registered/i.test(m)) return 'このIDはすでに登録されています。「ログイン」を押してください。';
  if (/signups? (not allowed|are disabled)|signup is disabled/i.test(m)) return '新規登録は受け付けていません（Supabase の「Allow new users to sign up」がオフです）。'; if (/password/i.test(m) && /(short|least|weak|characters)/i.test(m)) return 'パスワードが短い／弱すぎます。12 文字以上にしてください。';
  if (/invalid/i.test(m) && /email/i.test(m)) return 'IDはメールアドレスの形（例: name@example.com）で入力してください。'; if (/rate limit|too many/i.test(m)) return '短時間に試しすぎです。しばらく待ってください。'; return m; };
export async function signUpPassword(id, password) {
  const { data, error } = await getClient().auth.signUp({ email: id.trim(), password }); if (error) return { ok: false, error: authMsg(error) };
  if (!data.session) return { ok: false, needsConfirm: true, error: '登録しましたが、確認メールが必要な設定のため、まだログインできません。Supabase の Authentication → Sign In / Providers → Email で「Confirm email」をオフにしてから、「ログイン」を押してください。' };
  emit({ signedIn: true }); return { ok: true };
}
export async function signInPassword(id, password) {
  const { error } = await getClient().auth.signInWithPassword({ email: id.trim(), password }); if (error) return { ok: false, error: authMsg(error) };
  emit({ signedIn: true }); return { ok: true };
}
export async function signOut() { await getClient().auth.signOut(); emit({ signedOut: true }); }
export async function resyncAll() { if (running) return { ok: false, reason: 'busy' }; running = true; try { const r = await getSync().resyncAll(); emit(r); return r; } finally { running = false; } }
export const pendingCount = () => getSync().pendingCount();
export async function syncNow() { if (running) return { ok: false, reason: 'busy' }; running = true; try { const r = await getSync().syncOnce(); emit(r); return r; } finally { running = false; } }
function schedule(ms = 8000) { if (!autoEnabled()) return; clearTimeout(timer); timer = setTimeout(async () => { if (navigator.onLine !== false && await getUser().catch(() => null)) syncNow(); }, ms); }
/** アプリの起動時に 1 回呼ぶ。保存・復帰・オンラインの各きっかけで、少し待ってから同期する */
export function startAutoSync() {
  window.addEventListener('inkgraph:dirty', () => schedule());
  window.addEventListener('online', () => schedule(1500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(1500); });
  getClient().auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN') schedule(500); });
  schedule(1500);
}
