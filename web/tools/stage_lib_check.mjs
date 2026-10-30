// stage_lib_check.mjs: D92 ステージ名の見本を、人が教える（登録・重複・上限・ワーカーへの足し込み・実フレームで読めるようになる）
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
import { prepAssets } from '../src/core/assets.js';
import * as R from '../src/core/result.js';
import { addFromMatch, loadLib, countOf, dxForMode, mergeIntoAssets, STAGES } from '../src/stage_lib.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mem = () => { const o = {}; return { getItem: k => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); } }; };
const web = path.resolve(import.meta.dirname, '..');
check(dxForMode('ガチホコバトル') === 38 && dxForMode('ガチエリア') === 0 && dxForMode('ガチヤグラ') === 0 && dxForMode('ガチアサリ') === null && dxForMode(null) === null, '(1) ルールから、ステージ名の位置が決まる（アサリ・不明は決まらない）');
{
  const st = mem(), m = { stage_feats: [{ 0: 'AAAA', 38: 'BBBB' }, { 0: 'CCCC', 38: 'DDDD' }] };
  let r = addFromMatch('ナメロウ金属', m, 'ガチエリア', st); check(r.ok && r.added === 2 && countOf('ナメロウ金属', st) === 2 && loadLib(st).items[0].feat === 'AAAA', '(2) エリアなら位置 0 の特徴が、2 枚登録される', JSON.stringify(r));
  r = addFromMatch('ナメロウ金属', m, 'ガチエリア', st); check(!r.ok && r.reason === 'dup' && countOf('ナメロウ金属', st) === 2, '(3) 同じ見本は、二重に登録しない');
  r = addFromMatch('マテガイ放水路', m, 'ガチホコバトル', st); check(r.ok && loadLib(st).items.find(x => x.name === 'マテガイ放水路').feat === 'BBBB', '(4) ホコなら位置 38 の特徴が登録される');
  r = addFromMatch('マテガイ放水路', m, 'ガチアサリ', st); check(!r.ok && r.reason === 'no-mode', '(5) ルールが分からない（アサリ・不明）ときは、登録しない');
  r = addFromMatch('マテガイ放水路', { stage_feats: [] }, 'ガチエリア', st); check(!r.ok && r.reason === 'no-feats', '(6) 見本の素が無い試合（古い解析）は、登録しない');
  for (let i = 0; i < 10; i++) addFromMatch('タラポートショッピングパーク', { stage_feats: [{ 0: 'F' + i }] }, 'ガチエリア', st);
  check(countOf('タラポートショッピングパーク', st) === 6 && loadLib(st).items.filter(x => x.name === 'タラポートショッピングパーク')[5].feat === 'F9', '(7) 1 つの名前につき最大 6 枚（古いものから入れ替える）');
}
check(STAGES.length >= 20 && new Set(STAGES).size === STAGES.length && STAGES.includes('ナメロウ金属') && STAGES.includes('オヒョウ海運'), '(8) ステージ名の一覧（重複なし）');
// 実フレーム: 同梱の見本に無いステージ（オヒョウ海運）の結果画面。読めなかったときに残す特徴を、見本として足すと、読めるようになる
const dec = f => spawnSync('ffmpeg', ['-loglevel', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 }).stdout;
const fr = { w: 1280, h: 720, data: new Uint8ClampedArray(dec(path.join(web, 'tools/fixtures/asari_x_result_720p.jpg'))) };
const A = prepAssets(JSON.parse(fs.readFileSync(path.join(web, 'public/assets/inkgraph_assets.json'), 'utf8')));
const c = R.classify(A, fr), h0 = R.readHeader(A, fr, ...c.off, undefined, c.panel);
check(h0.stage === null && h0.stage_feat && Object.keys(h0.stage_feat).length >= 1, '(9) 見本に無いステージは読めず、特徴が残る（ルールが読めなければ位置 0/19/38、読めればその位置）', JSON.stringify({ stage: h0.stage, score: +h0.stage_score.toFixed(2), keys: Object.keys(h0.stage_feat || {}) }));
const fs3 = R.finalizeResult({ celebration: [], personal: [{ t: 1, header: h0, personal: null }, { t: 1.2, header: h0, personal: null }], board: [] });
check(fs3.stage_feats.length === 2, '(10) 試合の結果に、特徴が（最大 2 枚）残る');
let hit = null;
for (const dx of ['0', '19', '38']) { const B = prepAssets(JSON.parse(fs.readFileSync(path.join(web, 'public/assets/inkgraph_assets.json'), 'utf8'))); mergeIntoAssets(B, [{ name: 'オヒョウ海運', feat: h0.stage_feat[dx] }]); const h1 = R.readHeader(B, fr, ...c.off, undefined, c.panel); if (h1.stage === 'オヒョウ海運') hit = { dx, score: +h1.stage_score.toFixed(3) }; }
check(!!hit && hit.score > 0.95, '(11) 特徴を見本に足すと、同じ画面でステージ名（オヒョウ海運）が読める（ワーカーの足し込みと同じ形）', JSON.stringify(hit));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
