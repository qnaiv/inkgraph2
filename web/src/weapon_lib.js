// D65: 名前を付けたブキアイコンの見本（この端末で作る）。静的な見本（templates/enemy_icon_lib.json）に足して照合に使う。
// 保存は localStorage 'inkgraph.weaponLib'（アイコン 1 つ約 2KB。100 個で約 200KB）。クラウド同期の「設定」に含めて、他の端末へも届ける。
import { prepEnemyIconLib } from './core/board_icons.js';
import { b64bytes } from './core/img.js';
const KEY = 'inkgraph.weaponLib';
export const loadUserLib = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && j.v === 1 && Array.isArray(j.items) ? j : { v: 1, items: [] }; } catch { return { v: 1, items: [] }; } };
const save = j => { try { localStorage.setItem(KEY, JSON.stringify(j)); window.dispatchEvent(new CustomEvent('inkgraph:dirty')); return true; } catch { return false; } };
/** 名前を付けたアイコンを追加する（同じ絵・同じ名前は重ねない）。戻り値: 追加した数 */
export function addNamed(name, icons, type = null) {
  const n = String(name || '').trim(); if (!n) return 0;
  const j = loadUserLib(); let added = 0;
  for (const icon of icons) if (icon && !j.items.some(x => x.icon === icon && x.name === n)) { j.items.push({ name: n, icon, ...(type ? { type } : {}), at: new Date().toISOString() }); added++; }
  if (added) save(j); return added;
}
/** この端末で付けた名前の種類 {名前: 種類}（一覧に無いブキを足したときの種類） */
export function userTypes() { const o = {}; for (const x of loadUserLib().items) if (x.type) o[x.name] = x.type; return o; }
export function removeByName(name) { const j = loadUserLib(); const k = j.items.length; j.items = j.items.filter(x => x.name !== name); if (j.items.length !== k) save(j); return k - j.items.length; }
/** 2 つの見本の和集合（名前＋絵が同じなら 1 つ）。同期で別の端末のものを足すとき用 */
export function unionItems(a, b) { const out = [...a]; for (const x of b) if (!out.some(y => y.icon === x.icon && y.name === x.name)) out.push(x); return out; }
export function mergeIntoLocal(items) { const j = loadUserLib(), u = unionItems(j.items, items); if (u.length !== j.items.length) { j.items = u; save(j); return true; } return false; }
/** 静的な見本（prepEnemyIconLib の結果）にこの端末の見本を足した照合用の lib。使うたびに作り直さないよう、見本の数が変わるまで使い回す */
let memo = null;
export function combinedLib(staticLib) {
  const j = loadUserLib(), key = `${(staticLib && staticLib.lib ? staticLib.lib.length : 0)}|${j.items.length}|${j.items.length ? j.items[j.items.length - 1].at : ''}`;
  if (memo && memo.key === key && memo.base === staticLib) return memo.lib;
  const user = prepEnemyIconLib({ lib: j.items.map(x => ({ name: x.name, g: x.icon, video: 'user', slot: '' })) }, b64bytes).lib;
  const lib = { lib: [...(staticLib && staticLib.lib ? staticLib.lib : []), ...user] }; memo = { key, base: staticLib, lib }; return lib;
}
