// AI 連携（デスクトップ版だけ）: 試合を保存・修正するたびに、要約を書き出す。ブラウザ版では何もしない。
import * as db from './db.js';
import { buildExport } from './ai_export.js';

const WAIT_MS = 2000;
let timer = null, running = false, again = false, last = null;
const desktop = () => (typeof window !== 'undefined' && window.inkgraphDesktop && window.inkgraphDesktop.exportWrite ? window.inkgraphDesktop : null);

/** 直近の書き出しの結果（設定画面の表示用）。{ ok, at, count, dir } か { ok:false, reason } */
export const lastResult = () => last;
export const available = () => !!desktop();

/** いま書き出す。デスクトップ版でなければ { ok:false, reason:'desktop-only' } */
export async function exportNow() {
  const D = desktop(); if (!D) return { ok: false, reason: 'desktop-only' };
  if (running) { again = true; return last || { ok: false, reason: 'busy' }; }
  running = true;
  try {
    const r = await D.exportWrite(buildExport(await db.allMatches()));
    last = r;
  } catch (e) { last = { ok: false, reason: String(e && e.message || e) }; }
  running = false;
  if (again) { again = false; schedule(); }
  return last;
}

function schedule() { clearTimeout(timer); timer = setTimeout(() => { exportNow(); }, WAIT_MS); }

/** 起動時に 1 回書き出し、以後は保存・修正（inkgraph:dirty）のたびに、少し待ってまとめて書き出す */
export function startAutoExport() {
  if (!desktop()) return;
  window.addEventListener('inkgraph:dirty', schedule);
  schedule();
}
