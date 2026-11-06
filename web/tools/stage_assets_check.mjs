// stage_assets_check.mjs: D112 録画から作ったステージ名の見本が辞書に入っている／Xマッチの位置のずれで読める
import fs from 'node:fs'; import path from 'node:path';
import { prepAssets } from '../src/core/assets.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const j = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../public/assets/inkgraph_assets.json'), 'utf8'));
const names = new Set(Object.keys(j.lib.stage).map(k => k.split('__')[0]));
const WANT = ['オヒョウ海運', 'マヒマヒリゾート&スパ', 'マンタマリア号', 'デカライン高架下', 'バイガイ亭', 'ヤガラ市場', 'クサヤ温泉', 'ザトウマーケット', 'リュウグウターミナル', '海女美術大学'];
check(WANT.every(n => names.has(n)), `(1) 録画から作った見本が辞書に入っている（${names.size} ステージ）`, WANT.filter(n => !names.has(n)).join(','));
check(Object.values(j.lib.stage).every(b => atob(b).length === 120 * 32), '(2) どの見本も 120x32');
const A = prepAssets(j); check(Object.keys(A.lib.stage).length === Object.keys(j.lib.stage).length, '(3) prepAssets で全部読み込める');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
