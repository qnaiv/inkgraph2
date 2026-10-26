// D53: 複数の独立した信号の合議。DOM・Analyzer 非依存の純粋関数。
// 同じ出来事を別々の HUD 信号が見ているので、1 つだけの弱い信号より「2 つ以上が一致」のほうを信用する。
//   自分のデス：十字キー付近の「やられた」(sy)・HUD の自分イカアイコンの×(hud)・デスカメの吹き出し(killer)
//   自分のキル：「たおした」通知(notice)・敵 4 人のイカアイコンが直後に×になる(enemy)
// 重み・しきい値は実映像で較正できていない初期値（D54 の自動調整で結果画面の数に合わせて動かす）。
export const FUSE = { w_sig: 0.9, w_hud: 0.7, w_killer: 0.7, sig_lo: 0.3, sig_hi: 0.7, accept: 0.75, accept_signals: 2, sig_count_min: 0.2,
  w_notice: 0.9, w_enemy: 0.5, notice_lo: 0.5, notice_hi: 0.9, hud_win: 0.5 };
const clamp01 = v => Math.max(0, Math.min(1, v));
const orAll = ws => 1 - ws.reduce((p, w) => p * (1 - w), 1);

/** 自分のデスの確信度。sy: 区間内の「やられた」スコア平均、hud: 区間内で HUD の自分アイコンが×だった割合(0..1)、killer: 吹き出しが読めたか */
export function fuseDeath({ sy = 0, hud = 0, killer = false }, F = FUSE) {
  const parts = { sig: F.w_sig * clamp01((sy - F.sig_lo) / (F.sig_hi - F.sig_lo)), hud: F.w_hud * clamp01(hud), killer: killer ? F.w_killer : 0 };
  const signals = Object.entries(parts).filter(([, w]) => w >= F.sig_count_min).map(([k]) => k);
  return { conf: +orAll(Object.values(parts)).toFixed(2), signals };
}
/** 通知が採用されていない候補を、複数信号の一致だけで採用してよいか */
export const fusedAccept = (r, F = FUSE) => r.conf >= F.accept && r.signals.length >= F.accept_signals;

/** 自分のキルの確信度。notice: 通知の照合スコア最大、enemy: 直後に敵のアイコンが×になったか */
export function fuseKill({ notice = 0, enemy = false }, F = FUSE) {
  const parts = { notice: F.w_notice * clamp01((notice - F.notice_lo) / (F.notice_hi - F.notice_lo)), enemy: enemy ? F.w_enemy : 0 };
  return { conf: +orAll(Object.values(parts)).toFixed(2), signals: Object.entries(parts).filter(([, w]) => w >= F.sig_count_min).map(([k]) => k) };
}
