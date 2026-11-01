// D92: ステージ名の見本を、人が教えられる。レビューでステージを選ぶと、その試合で読めなかった（確信が低かった）ステージ名の特徴（rec.stage_feats）を、この端末の見本に登録する。
// 登録した見本は、次に解析を始めるときにワーカーへ渡し、同梱の見本に足して照合する（名前は 'ステージ名__uN'）。
import { b64bytes } from './core/img.js';
import { STAGE_DX_BY_MODE } from './core/result.js';

export const STAGES = ['ユノハナ大渓谷', 'ゴンズイ地区', 'ヤガラ市場', 'マテガイ放水路', 'ナンプラー遺跡', 'ナメロウ金属', 'クサヤ温泉', 'ヒラメが丘団地', 'マサバ海峡大橋', 'キンメダイ美術館', 'マヒマヒリゾート＆スパ', '海女美術大学', 'チョウザメ造船', 'ザトウマーケット', 'スメーシーワールド', 'タラポートショッピングパーク', 'タカアシ経済特区', 'オヒョウ海運', 'バイガイ亭', 'ネギトロ炭鉱', 'カジキ空港', 'リュウグウターミナル', 'デカライン高架下', 'マンタマリア号', 'コンブトラック'];
const KEY = 'inkgraph.stageLib', MAX_PER_NAME = 6;
const empty = () => ({ v: 1, items: [] });
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
export function loadLib(st = store()) { try { const j = JSON.parse(st.getItem(KEY) || 'null'); return j && j.v === 1 && Array.isArray(j.items) ? j : empty(); } catch { return empty(); } }
const saveLib = (lib, st = store()) => { try { st.setItem(KEY, JSON.stringify(lib)); } catch (e) { console.warn('stageLib save failed', e); } };

/** 試合のルールから、ステージ名の位置（dx）が決まるか。ホコは +38、エリア・ヤグラは 0。アサリ・ルール不明は決まらない（null） */
export function dxForMode(mode) { if (mode in STAGE_DX_BY_MODE) return STAGE_DX_BY_MODE[mode]; return mode === 'ガチエリア' || mode === 'ガチヤグラ' ? 0 : null; }

/**
 * 試合の stage_feats（読めなかったときに残した、位置ごとの特徴）から、ルールに合う位置のものを、name の見本に登録する。
 * 戻り値: { ok, added, reason }。reason: 'no-feats'（古い解析で、特徴が無い）／'no-mode'（ルールが分からず、位置が決まらない）／'dup'（同じ見本がある）
 */
export function addFromMatch(name, m, mode, st = store()) {
  const feats = m && m.stage_feats; if (!name) return { ok: false, added: 0, reason: 'no-name' };
  if (!feats || !feats.length) return { ok: false, added: 0, reason: 'no-feats' };
  const dx = dxForMode(mode); if (dx === null) return { ok: false, added: 0, reason: 'no-mode' };
  const lib = loadLib(st); let added = 0;
  for (const f of feats) {
    const b = f[String(dx)]; if (!b) continue;
    if (lib.items.some(x => x.name === name && x.feat === b)) continue;
    const same = lib.items.filter(x => x.name === name); if (same.length >= MAX_PER_NAME) lib.items.splice(lib.items.indexOf(same[0]), 1);
    lib.items.push({ name, feat: b }); added++;
  }
  if (added) saveLib(lib, st);
  return { ok: added > 0, added, reason: added ? null : 'dup' };
}
export const countOf = (name, st = store()) => loadLib(st).items.filter(x => x.name === name).length;

/** 同梱の見本（A.lib.stage）に、登録した見本を足す（ワーカーの init で）。items: [{ name, feat }] */
export function mergeIntoAssets(A, items) {
  const n = {}; let added = 0;
  for (const it of items || []) { if (!it || !it.name || !it.feat) continue; const i = n[it.name] = (n[it.name] || 0) + 1; A.lib.stage[`${it.name}__u${i}`] = Float32Array.from(b64bytes(it.feat)); added++; }
  return added;
}
