// b04: 怪しい検出（このデス・このキル）を、試合単位ではなく項目単位で見つける。DOM 非依存の純粋関数。
// 数は合っていても、誤検出と見逃しが同時にあると「要修正」にならない。そのとき確認画面で、見直す順番の手がかりにする。
import { detected } from './analysis.js';

export const SUSPECT_CONF = 0.45;   // 案: これ未満の確信度は怪しい（確認画面の「確信度 低」バッジと同じ値）
export const SUSPECT_KINDS = ['death', 'kill']; // 案: スペシャルは確信度の作りが別なので、まだ対象にしない

/** 検出 1 件が怪しい理由（なければ空）。e は detected() の項目（e.src が保存された元の検出） */
export function suspectReasons(e) {
  const s = e && e.src; if (!s || !SUSPECT_KINDS.includes(e.kind) || s.auto === 'added') return [];
  const out = [];
  if (typeof s.conf === 'number' && s.conf < SUSPECT_CONF) out.push('確信度が低い');
  if (s.auto === 'fused') out.push('複数の弱い信号の一致で自動採用');
  if (e.kind === 'death' && s.src === 'hud') out.push('HUD の分類だけで拾った（やられた表示の信号が無い）');
  return out;
}

/** 人がまだ ✓/✗ を付けていない怪しい検出を、時刻順に返す */
export function suspectList(m) {
  const out = [];
  for (const e of detected(m)) { if (e.mark) continue; const reasons = suspectReasons(e); if (reasons.length) out.push({ key: e.key, kind: e.kind, t: e.t, reasons }); }
  return out;
}
