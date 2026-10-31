// server_check.mjs: AI 連携の MCP サーバー（desktop/mcp/server.mjs）を子プロセスで起動し、JSON-RPC で確かめる。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');

const rec = (id, created, o = {}) => ({ id, created, owner: 'self', fix: 'none', match_type: 'bankara_challenge', rule: 'ガチヤグラ', stage: 'チョウザメ造船', result: 'WIN', battle_sec: 300, ka: 8, deaths_result: 3, deaths: [40, 90, 150], kills: [30, 60], special: { ready: 3, lost: 1, activated: 2 }, first_death: 40, ...o });
const now = Date.now(), iso = d => new Date(now - d * 60000).toISOString();
const RECORDS = [
  rec('m1', iso(300)),
  rec('m2', iso(200), { result: 'LOSE', rule: 'ガチアサリ', stage: 'ザトウマーケット', deaths: [20, 70], first_death: 20, ka: 4 }),
  rec('m3', iso(100), { result: 'LOSE', deaths: [25, 80, 120, 200], first_death: 25, ka: 5 })
];

function start(dir) {
  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, INKGRAPH_AI_EXPORT_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiters = new Map(); let buf = '', stderr = ''; const lines = [];
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; lines.push(l); let m; try { m = JSON.parse(l); } catch { continue; } const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } } });
  p.stderr.on('data', d => { stderr += d; });
  let seq = 0;
  const call = (method, params) => new Promise((res, rej) => { const id = ++seq; const t = setTimeout(() => { waiters.delete(id); rej(new Error('timeout ' + method)); }, 8000); waiters.set(id, m => { clearTimeout(t); res(m); }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const notify = (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { call, notify, lines, stderr: () => stderr, stop: () => { try { p.stdin.end(); p.kill(); } catch { /* ignore */ } } };
}
const toolText = m => (m.result && m.result.content && m.result.content[0] && m.result.content[0].text) || '';
const jsonOf = s => JSON.parse(s.slice(s.indexOf('{')));

console.log('--- AI export MCP server checks ---');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-ai-'));
fs.writeFileSync(path.join(dir, 'records.json'), JSON.stringify(RECORDS));
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ format: 1, generated_at: new Date(now).toISOString() }));

const s = start(dir);
try {
  const init = await s.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '0' } });
  check(init.result && init.result.protocolVersion === '2024-11-05' && init.result.serverInfo.name === 'inkgraph-ai' && init.result.capabilities.tools, '(1) initialize: クライアントの版を返し、tools を宣言する', JSON.stringify(init.result));
  const init2 = await s.call('initialize', { protocolVersion: '1999-01-01' });
  check(init2.result.protocolVersion === '2025-06-18', '(2) 知らない版には最新を返す');
  s.notify('notifications/initialized');
  const ping = await s.call('ping');
  check(ping.result && Object.keys(ping.result).length === 0, '(3) initialized の通知には応答せず、ping には空で答える');

  const list = await s.call('tools/list');
  const names = (list.result.tools || []).map(t => t.name).sort().join(',');
  check(names === 'get_match,get_summary,list_matches' && list.result.tools.every(t => t.inputSchema && t.inputSchema.type === 'object' && t.description.length > 20), '(4) tools/list: 3 つ・説明と入力スキーマ付き', names);

  const sum = await s.call('tools/call', { name: 'get_summary', arguments: {} });
  const sj = jsonOf(toolText(sum));
  check(!sum.result.isError && toolText(sum).startsWith('注意:') && sj.windows.today && sj.windows.last20 && sj.windows.last30d && sj.windows.last20.n === 3, '(5) get_summary: 注意書きと 3 つの窓', Object.keys(sj.windows).join());
  check(sj.windows.last20.wins === 1 && sj.windows.last20.losses === 2 && sj.windows.last20.first_death.within_edge.n === 2 && sj.windows.last20.enough === false, '(6) get_summary: 勝敗・開幕のデス・enough=false が正しい', JSON.stringify(sj.windows.last20.first_death));
  const one = jsonOf(toolText(await s.call('tools/call', { name: 'get_summary', arguments: { window: 'all', rule: 'ガチアサリ' } })));
  check(Object.keys(one.windows).join() === 'all' && one.windows.all.n === 1 && one.filter.rule === 'ガチアサリ', '(7) get_summary: window と rule で絞れる');

  const lm = jsonOf(toolText(await s.call('tools/call', { name: 'list_matches', arguments: { result: 'LOSE' } })));
  check(lm.count === 2 && lm.matches[0].id === 'm3' && lm.matches[0].deaths === 4 && lm.matches[0].fix === 'none' && !('kills' in lm.matches[0]), '(8) list_matches: 勝敗で絞り、新しい順・件数だけの形', lm.matches.map(m => m.id).join());
  const lm2 = jsonOf(toolText(await s.call('tools/call', { name: 'list_matches', arguments: { limit: 1, stage: 'チョウザメ造船' } })));
  check(lm2.count === 1 && lm2.matches[0].id === 'm3', '(9) list_matches: limit とステージ');

  const gm = jsonOf(toolText(await s.call('tools/call', { name: 'get_match', arguments: { id: 'm2' } })));
  check(gm.id === 'm2' && gm.deaths.length === 2 && gm.special.lost === 1, '(10) get_match: record 1 件');
  const gm2 = await s.call('tools/call', { name: 'get_match', arguments: { id: 'nope' } });
  check(gm2.result.isError === true, '(11) get_match: 無い id は isError');

  const unk = await s.call('resources/list');
  check(unk.error && unk.error.code === -32601, '(12) 未知のメソッドは -32601', JSON.stringify(unk.error));
  check(s.lines.every(l => { try { JSON.parse(l); return true; } catch { return false; } }), '(13) stdout は JSON-RPC だけ', `${s.lines.length} 行`);
} catch (e) { check(false, '(例外) ' + e.message, s.stderr()); }
finally { s.stop(); }

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-ai-empty-'));
const s2 = start(empty);
try {
  await s2.call('initialize', { protocolVersion: '2025-06-18' });
  const r = await s2.call('tools/call', { name: 'get_summary', arguments: {} });
  check(r.result.isError === true && toolText(r).includes('書き出し先') && toolText(r).includes(empty), '(14) ファイルが無いとき: 書き出し先つきのエラー', toolText(r));
  fs.writeFileSync(path.join(empty, 'records.json'), JSON.stringify(RECORDS));
  const r2 = await s2.call('tools/call', { name: 'list_matches', arguments: {} });
  check(!r2.result.isError && jsonOf(toolText(r2)).count === 3, '(15) 呼び出しのたびに読み直す（あとから書き出されても拾う）');
} catch (e) { check(false, '(例外2) ' + e.message, s2.stderr()); }
finally { s2.stop(); }

fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(empty, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} check(s) FAILED`); process.exit(1); }
console.log('\nALL PASSED');
process.exit(0);
