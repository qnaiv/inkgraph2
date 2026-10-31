// ai_export_check.mjs: AI 連携（要約の集計・record の切り出し・MCP サーバーとのつながり）。Node だけで動く。
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson, rate, eligible, pickWindow, aggregate, stats, MIN_RELIABLE } from '../src/ai_summary.js';
import { toRecord, buildExport } from '../src/ai_export.js';

let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- 試合の合成（analysis.js が読む形）
const T0 = Date.parse('2026-10-31T10:00:00Z');
const mk = (i, o = {}) => ({
  id: `m${i}`, squid_down: {}, created: new Date(T0 + (o.minAfter ?? i * 10) * 60000).toISOString(), battle: [1000, 1000 + (o.dur ?? 180)],
  own_deaths: (o.deaths ?? [20, 80]).map(d => ({ start: 1000 + d, end: 1000 + d + 3, conf: 0.9 })),
  own_kills: (o.kills ?? [30]).map(k => ({ start: 1000 + k, end: 1000 + k + 1 })),
  special: o.special ?? [{ ready: 1010, end: 1050, outcome: 'activated', activated_at: 1050 }],
  result_screen: { result: o.result ?? 'WIN', mode: o.rule ?? 'ガチヤグラ', stage: o.stage ?? 'チョウザメ造船', own: { ka: o.ka ?? 5, deaths: (o.deaths ?? [20, 80]).length, specials: 1 } },
  match_type: 'bankara_challenge', ...(o.extra || {})
});

// 1. wilson / rate
{ const w = wilson(2, 8); check(w && w.value === 0.25 && w.lo > 0.05 && w.lo < 0.25 && w.hi > 0.25 && w.hi < 0.6, '(1) wilson: 2/8 は 0.25 で、幅は 0.05〜0.6 の間', JSON.stringify(w));
  check(wilson(0, 0) === null, '(2) wilson: n=0 は null');
  const r = rate(33, 26.7); check(r && r.value === 1.24 && r.lo < 1.24 && r.hi > 1.24 && rate(3, 0) === null, '(3) rate: 33 回/26.7 分 = 1.24、幅つき。分が 0 は null', JSON.stringify(r)); }

// 2. toRecord
{ const r = toRecord(mk(1, { deaths: [19.3, 50], result: 'LOSE' }));
  check(r.id === 'm1' && r.result === 'LOSE' && r.rule === 'ガチヤグラ' && r.stage === 'チョウザメ造船' && r.battle_sec === 180, '(4) record: 勝敗・ルール・ステージ・長さ', JSON.stringify(r));
  check(JSON.stringify(r.deaths) === '[19.3,50]' && r.first_death === 19.3 && r.owner === 'self' && r.fix === 'none', '(5) record: デスは開始からの秒、最初のデス、自分の試合、要修正なし');
  check(r.special.ready === 1 && r.special.activated === 1 && r.special.lost === 0, '(6) record: スペシャル', JSON.stringify(r.special));
  const bad = Object.keys(r).filter(k => !['id', 'created', 'owner', 'fix', 'match_type', 'rule', 'stage', 'result', 'battle_sec', 'ka', 'deaths_result', 'deaths', 'kills', 'special', 'first_death'].includes(k));
  check(bad.length === 0, '(7) record は決まった項目だけ（画像・信号・録画などは入らない）', bad.join(',')); }

// 3. 人の修正が効く（✗ は除く／追加は入る）、他人の試合・要修正
{ const m = mk(2, { deaths: [20, 80], extra: { review: { marks: { 'death@1020.0': 'wrong' }, added: [{ kind: 'death', t: 1100 }] } } });
  const r = toRecord(m); check(JSON.stringify(r.deaths) === '[80,100]' && r.first_death === 80, '(8) 人が ✗ にしたデスは除かれ、追加したデスが入る', JSON.stringify(r.deaths));
  check(toRecord(mk(3, { extra: { source: { owner: 'other' } } })).owner === 'other', '(9) 他人の試合は owner:other');
  check(toRecord(mk(4, { extra: { needs_fix: { at: 'x', reasons: ['death'] } } })).fix === 'todo', '(10) 要修正のままは fix:todo');
  const sp = toRecord(mk(5, { special: [{ ready: 1010, end: 1040, outcome: 'lost_on_death' }] })).special; check(sp.lost === 1 && sp.activated === 0, '(11) スペシャルを溜めたまま死んだ回数', JSON.stringify(sp)); }

// 4. eligible / 窓
const recs = [];
{ // 3 日前の 1 試合、昨日の 2 試合、今日の連戦 4 試合（間 10 分）と、2 時間空いた今日の別の 2 試合
  const mkr = (id, min, result, d, extra = {}) => ({ id, created: new Date(T0 + min * 60000).toISOString(), owner: 'self', fix: 'none', rule: 'ガチヤグラ', stage: 'チョウザメ造船', result, battle_sec: 180, ka: 4, deaths: d, kills: [], special: { ready: 1, lost: 0, activated: 1 }, first_death: d.length ? d[0] : null, ...extra });
  recs.push(mkr('a', -3 * 1440, 'WIN', [40]), mkr('b', -1440, 'LOSE', [10, 60]), mkr('c', -1400, 'LOSE', [25]));
  recs.push(mkr('d', 0, 'WIN', [45]), mkr('e', 10, 'LOSE', [12, 90]), mkr('f', 20, 'LOSE', [28]), mkr('g', 30, 'WIN', [70]));
  recs.push(mkr('h', 200, 'LOSE', [15]), mkr('i', 210, 'WIN', [50]));
  recs.push(mkr('x', 5, 'WIN', [10], { owner: 'other' }), mkr('y', 6, 'LOSE', [10], { fix: 'todo' }));
  const e = eligible(recs); check(e.list.length === 9 && e.excluded.other_owner === 1 && e.excluded.needs_fix === 1 && e.excluded.total === 2, '(12) 他人の試合と要修正のままは集計から除く', JSON.stringify(e.excluded));
  const now = T0 + 215 * 60000;
  check(pickWindow(e.list, 'today', now).map(r => r.id).join('') === 'hi', '(13) 今日の連戦: 2 時間空いたら区切る（h,i だけ）');
  check(pickWindow(e.list, 'last20', now).length === 9, '(14) 直近 20 試合: 9 試合しか無ければ全部');
  check(pickWindow(e.list, 'last30d', now).length === 9 && pickWindow(e.list, 'last30d', now + 40 * 86400000).length === 0, '(15) 直近 30 日: 40 日後には 0 件');
  const s = stats(e.list.slice(3, 7)); // d,e,f,g
  check(s.n === 4 && s.wins === 2 && s.losses === 2 && s.enough === false && s.win_rate.value === 0.5, '(16) 窓の統計: 4 試合、2 勝 2 敗、件数が少ないので enough:false', JSON.stringify(s.win_rate));
  check(s.first_death.within_edge.n === 2 && s.first_death.within_edge.wins === 0 && s.first_death.after_edge.n === 2 && s.first_death.after_edge.wins === 2 && s.first_death.median_sec === 36.5, '(17) 最初のデスが 30 秒以内の試合と、それより後の試合に分けて勝敗を数える', JSON.stringify(s.first_death));
  const agg = aggregate(recs, { now }); check(Object.keys(agg.windows).join() === 'today,last20,last30d' && agg.windows.today.n === 2 && agg.quality.excluded.total === 2 && agg.quality.min_reliable === MIN_RELIABLE, '(18) aggregate: 3 つの窓と quality', JSON.stringify(agg.quality.excluded));
  const one = aggregate(recs, { now, window: 'last20', rule: 'ガチアサリ' }); check(one.windows.last20.n === 0 && one.windows.last20.window === 'all' && one.windows.last20.widened_from === 'last20', '(19) 絞り込みで件数が足りなければ窓を広げ、広げたことを書く', JSON.stringify([one.windows.last20.window, one.windows.last20.widened_from])); }

// 5. 書き出し → MCP サーバー
const rpc = (srv, msg) => new Promise(res => { const want = msg.id; const on = d => { for (const ln of String(d).split('\n').filter(Boolean)) { try { const j = JSON.parse(ln); if (j.id === want) { srv.stdout.off('data', on); res(j); } } catch { /* partial */ } } }; srv.stdout.on('data', on); srv.stdin.write(JSON.stringify(msg) + '\n'); });
{ const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-ai-'));
  const matches = [mk(1, { result: 'LOSE', deaths: [19, 50] }), mk(2, { result: 'WIN', deaths: [40] }), mk(3, { extra: { source: { owner: 'other' } } })];
  const b = buildExport(matches, Date.parse(matches[1].created) + 60000);
  fs.writeFileSync(path.join(dir, 'records.json'), JSON.stringify(b.records)); fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(b.summary));
  check(b.records.length === 3 && b.summary.quality.excluded.other_owner === 1, '(20) buildExport: 3 件の record と、他人の試合を除いた要約');
  const srv = spawn(process.execPath, [path.join(HERE, '..', '..', 'desktop', 'mcp', 'server.mjs')], { env: { ...process.env, INKGRAPH_AI_EXPORT_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const ini = await rpc(srv, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '0' } } });
    check(ini.result && ini.result.serverInfo && ini.result.serverInfo.name === 'inkgraph-ai', '(21) MCP: initialize に応答');
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const call = await rpc(srv, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_summary', arguments: { window: 'last20' } } });
    const text = call.result && call.result.content && call.result.content[0].text || '';
    const jsonPart = text.slice(text.indexOf('{')); let sum = null; try { sum = JSON.parse(jsonPart); } catch { /* ignore */ }
    check(sum && sum.windows && sum.windows.last20 && sum.windows.last20.n === 2 && sum.windows.last20.wins === 1 && sum.quality.excluded.other_owner === 1, '(22) MCP: get_summary が書き出した records を集計して返す（他人の試合は除く）', text.slice(0, 120));
    const lm = await rpc(srv, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_matches', arguments: { result: 'LOSE' } } });
    const lt = lm.result && lm.result.content[0].text || ''; check(lt.includes('m1') && !lt.includes('"m2"'), '(23) MCP: list_matches の絞り込み（負けだけ）', lt.slice(0, 100));
  } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}
{ const b = buildExport([mk(1), { id: 'broken', own_deaths: [{ start: 5, end: 6 }] }]); check(b.records.length === 1 && b.summary.quality.skipped_unreadable === 1, '(24) 壊れた記録は飛ばして書き出しを続ける', JSON.stringify(b.summary.quality.skipped_unreadable)); }
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
