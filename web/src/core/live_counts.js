// 純関数: ライブ速報値と試合後確定値の差分を計算

export const COUNT_FIELDS = [
  { key: 'k', label: 'キル' },
  { key: 'd', label: 'デス' },
  { key: 'sp', label: 'スペシャル発動' },
];

/**
 * ライブ速報値と確定値の差分を計算する
 * @param {{k?: number, d?: number, sp?: number}} live 速報値
 * @param {{k?: number, d?: number, sp?: number}} fin 確定値
 * @param {Array<{key: string, label: string}>} [fields] フィールド定義（省略時は k, d, sp）
 * @returns {{ changed: Array<{key: string, label: string, from: number, to: number}>, text: string }}
 */
export function recountDiff(live = {}, fin = {}, fields = COUNT_FIELDS) {
  const changed = [];
  for (const { key, label } of fields) {
    const from = Number(live?.[key] ?? 0);
    const to = Number(fin?.[key] ?? 0);
    if (from !== to) {
      changed.push({ key, label, from, to });
    }
  }

  let text = '';
  if (changed.length === 0) {
    text = '試合後の数え直しでも同じ数でした';
  } else {
    const parts = changed.map(c => `${c.label} ${c.from}→${c.to}`).join('、');
    text = `試合後の数え直しで ${parts} に直しました`;
  }

  return { changed, text };
}

/**
 * D82: 速報のキル数。「たおした」通知は、新しい通知が出ると古いものが上の段へ繰り上がる。段ごとの立ち上がりで数えると、同じ通知を何度も数える。
 * そこで、出ている通知の数 n が増えたときだけ、増えた分を数える。n が変わったら、2 フレーム続けて同じ数のときに確定する（1 フレームのちらつきは無視）。
 * step(slots) は、このフレームで新しく数えるキルの数を返す。
 */
export class LiveKillCounter {
  constructor(confirm = 2) { this.confirm = confirm; this.n = 0; this.cand = null; this.cc = 0; }
  step(slots) {
    const n = slots.reduce((c, v) => c + (v ? 1 : 0), 0);
    if (n === this.n) { this.cand = null; this.cc = 0; return 0; }
    if (n === this.cand) this.cc++; else { this.cand = n; this.cc = 1; }
    if (this.cc < this.confirm) return 0;
    const add = Math.max(0, n - this.n); this.n = n; this.cand = null; this.cc = 0; return add;
  }
}
