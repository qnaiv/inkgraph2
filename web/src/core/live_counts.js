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
