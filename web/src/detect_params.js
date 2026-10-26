// D54: 自動調整した検出パラメータの保存・適用・履歴（localStorage 'inkgraph.detectParams'。バックアップの設定に含まれる）
import * as db from './db.js';
import { resultOf } from './analysis.js';
import { toItem, tuneDetect, getParams, setParams, evalItems, TUNABLE } from './core/tuning.js';
const KEY = 'inkgraph.detectParams', AUTO_KEY = 'inkgraph.autoTune';
const read = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && j.v === 1 ? j : { v: 1, params: null, history: [] }; } catch { return { v: 1, params: null, history: [] }; } };
const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('detectParams save failed', e); } };
export const loadState = read;
export const activeParams = () => read().params;
export const autoEnabled = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const setAutoEnabled = on => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* ignore */ } };
/** 保存済みの調整を（メインスレッドの P/FUSE に）当てる。Worker へは init で渡す */
export function applyActive() { const p = activeParams(); if (p) setParams(p); return p; }
export function applyParams(params, info = {}) { const s = read(); s.history.push({ at: new Date().toISOString(), params: s.params, ...info }); s.history = s.history.slice(-10); s.params = params; write(s); setParams(params || defaults()); return s; }
export function rollback() { const s = read(); const h = s.history.pop(); if (!h) return null; s.params = h.params || null; write(s); setParams(s.params || defaults()); return s; }
export function reset() { const s = read(); s.history.push({ at: new Date().toISOString(), params: s.params, note: '既定値に戻した' }); s.history = s.history.slice(-10); s.params = null; write(s); setParams(defaults()); return s; }
const DEFAULTS = Object.fromEntries(TUNABLE.map(d => [d.key, getParams()[d.key]]));
export const defaults = () => ({ ...DEFAULTS });

export async function collectItems() {
  const ms = await db.allMatches();
  return ms.map(m => { const r = resultOf(m); return toItem(m, { ka: r.ka, deaths: r.deaths, specials: r.specials }); }).filter(Boolean);
}
/** 候補を作る（適用はしない）。現在の調整値から始めて探す */
export async function makeCandidate(opts = {}) {
  const items = await collectItems();
  return { ...(await tuneDetect(items, { base: activeParams() || defaults(), ...opts })), items: items.length };
}
/** 採用条件を満たしたら自動で適用する（ライブ・解析の停止後に呼ぶ。何も変わらない／条件未達なら何もしない） */
export async function autoTune(opts = {}) {
  if (!autoEnabled()) return null;
  const c = await makeCandidate(opts);
  if (c.ok) applyParams(c.params, { auto: true, changes: c.changes, train: c.train, holdout: c.holdout });
  return c;
}
