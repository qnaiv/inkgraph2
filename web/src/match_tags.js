// AI 連携: 試合全体の流れのタグ（b12）。数値だけを受け取る純関数。DOM・他モジュール非依存。
// しきい値はすべて案。実データで見直す前提。
export const SHORT_SEC = 120;      // これ以下は「短時間で決着」（ナワバリは 180 秒固定なので付けない）
export const LONG_SEC = 270;       // これ以上は「延長」寄り
export const GOOD_KD = 3;          // K+A − デス がこれ以上なら「活躍」
export const POOR_KD = -3;         // 同じくこれ以下なら「不調」
export const MIN_SERIES = 5;       // カウントの点がこれ未満なら、カウント系は付けない
export const LEAD_DEAD = 3;        // カウント差がこの幅以内は「どちらも先行していない」
export const COMEBACK = 20;        // これ以上離された（離した）あとに勝ち（負け）たら逆転
export const STRAIGHT_MAX = 10;    // 逆転なし・最大ビハインドがこれ未満ならストレート
export const ENDGAME_SEC = 30;     // 終盤の粘り＝この秒数でのカウント差の変化

const NAWABARI = 'ナワバリバトル';
const norm = s => (s === 'WIN' || s === 'LOSE' ? s : null);

/** { rule, result, battle_sec, ka, deaths, series:[{t(開始からの秒), own, enemy}] } → タグ */
export function matchTags({ rule, result, battle_sec, ka, deaths, series }) {
  const res = norm(result);
  const length = typeof battle_sec !== 'number' || rule === NAWABARI ? null : battle_sec <= SHORT_SEC ? 'short' : battle_sec >= LONG_SEC ? 'long' : 'normal';
  let performance = null;
  if (typeof ka === 'number' && typeof deaths === 'number' && res) {
    const kd = ka - deaths;
    performance = `${kd >= GOOD_KD ? 'good' : kd <= POOR_KD ? 'poor' : 'mid'}_${res === 'WIN' ? 'win' : 'lose'}`;
  }
  return { length, performance, count: countTags(series, res, battle_sec) };
}

/** ヤグラでカウントの推移がある試合だけ。無ければ null */
export function countTags(series, res, battle_sec) {
  const S = (Array.isArray(series) ? series : []).filter(s => typeof s.own === 'number' && typeof s.enemy === 'number');
  if (S.length < MIN_SERIES) return null;
  const diffs = S.map(s => s.own - s.enemy);
  let first_lead = null, last = null, lead_changes = 0;
  for (const d of diffs) {
    const st = d >= LEAD_DEAD ? 'own' : d <= -LEAD_DEAD ? 'enemy' : null;
    if (!st) continue;
    if (!first_lead) first_lead = st;
    if (last && st !== last) lead_changes++;
    last = st;
  }
  const max_lead = Math.max(0, ...diffs), max_behind = Math.max(0, ...diffs.map(d => -d));
  const end = typeof battle_sec === 'number' ? battle_sec : S[S.length - 1].t;
  const near = S.filter(s => s.t >= end - ENDGAME_SEC - 5);
  const endgame_delta = near.length >= 2 ? (near[near.length - 1].own - near[near.length - 1].enemy) - (near[0].own - near[0].enemy) : null;
  let flow = null;
  if (res === 'WIN') flow = max_behind >= COMEBACK ? 'comeback_win' : lead_changes === 0 && max_behind < STRAIGHT_MAX ? 'straight_win' : 'close';
  if (res === 'LOSE') flow = max_lead >= COMEBACK ? 'comeback_lose' : lead_changes === 0 && max_lead < STRAIGHT_MAX ? 'straight_lose' : 'close';
  return { first_lead, lead_changes, max_lead, max_behind, endgame_delta, flow };
}
