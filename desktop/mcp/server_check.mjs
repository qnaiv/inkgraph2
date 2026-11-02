// server_check.mjs: AI 連携の MCP サーバー（desktop/mcp/server.mjs）を子プロセスで起動し、JSON-RPC で確かめる。
import { spawn, spawnSync } from 'node:child_process';
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
  check(names === 'get_analysis,get_corrections,get_frames,get_match,get_summary,get_video,list_matches' && list.result.tools.every(t => t.inputSchema && t.inputSchema.type === 'object' && t.description.length > 20), '(4) tools/list: 7 つ・説明と入力スキーマ付き', names);

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


// ---- b22: 録画・コマ・検出の根拠・訂正 ----
const ffmpegOk = (() => { try { return spawnSync(process.env.INKGRAPH_FFMPEG || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();
const vdir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-vid-'));
const vfile = path.join(vdir, 'test.mp4');
let haveVideo = false;
if (ffmpegOk) haveVideo = spawnSync(process.env.INKGRAPH_FFMPEG || 'ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=10:duration=12', '-pix_fmt', 'yuv420p', vfile]).status === 0 && fs.existsSync(vfile);
const REC2 = [
  ...RECORDS,
  rec('v1', iso(50), { video: { path: vfile, file: 'test.mp4', t0: 100, battle_start_pos: 3, bytes: 1 }, diag: { hud_layout: null, rule_software: 'ガチホコバトル', rule_source: 'yolo', mode_guess: null, yolo_disagree: { mode: { template: null, yolo: 'ガチホコバトル', reason: 'count_evidence' } }, match_type_software: null, count_evidence: { tower: { n: 100, ok: 0, share: 0 }, area: { n: 100, ok: 1, share: 0.01 }, hoko: { n: 100, ok: 2, share: 0.02 } }, count_check: null, confidence: null }, count_series: [[0, 100, 100], [5, 90, 100], [9, 80, 70]], corrections: { fields: [{ field: 'mode', software: 'ガチホコバトル', human: 'ナワバリバトル' }, { field: 'match_type', software: null, human: 'fest_open' }], false_positives: [{ kind: 'death', rel: 40 }], misses: [{ kind: 'kill', rel: 61.5, from_candidate: false }], reviewed: true } }),
  rec('v2', iso(40), { video: { path: path.join(vdir, 'gone.mp4'), file: 'gone.mp4', t0: 5, battle_start_pos: 1, bytes: 1 }, diag: {}, count_series: [], corrections: { fields: [], false_positives: [], misses: [], reviewed: false } })
];
const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-ai3-'));
fs.writeFileSync(path.join(dir3, 'records.json'), JSON.stringify(REC2));
const s3 = start(dir3);
try {
  await s3.call('initialize', { protocolVersion: '2025-06-18' });
  const gv = await s3.call('tools/call', { name: 'get_video', arguments: { id: 'v1' } });
  const gvj = jsonOf(toolText(gv));
  check(!gv.result.isError && gvj.exists === haveVideo && gvj.battle_start_pos_sec === 3 && gvj.path === vfile, '(16) get_video: パス・存在・バトル開始の位置', toolText(gv).slice(0, 120));
  const gv2 = await s3.call('tools/call', { name: 'get_video', arguments: { id: 'v2' } });
  check(jsonOf(toolText(gv2)).exists === false && toolText(gv2).includes('見つかりません'), '(17) get_video: 録画ファイルが無いときは exists:false と理由');
  const gv3 = await s3.call('tools/call', { name: 'get_video', arguments: { id: 'm1' } });
  check(gv3.result.isError === true && toolText(gv3).includes('録画と結びついていません'), '(18) get_video: 録画の無い試合は分かりやすいエラー');
  const gf0 = await s3.call('tools/call', { name: 'get_frames', arguments: { id: 'v2', times: [1] } });
  check(gf0.result.isError === true && toolText(gf0).includes('録画のある PC'), '(19) get_frames: 録画ファイルが無い PC では「録画のある PC 上でだけ」と返す', toolText(gf0).slice(0, 100));
  const gf1 = await s3.call('tools/call', { name: 'get_frames', arguments: { id: 'v1', times: [] } });
  check(gf1.result.isError === true, '(20) get_frames: times が空はエラー');
  const gf2 = await s3.call('tools/call', { name: 'get_frames', arguments: { id: 'v1', times: [1, 2, 3, 4, 5, 6, 7, 8, 9] } });
  check(gf2.result.isError === true && toolText(gf2).includes('8 枚'), '(21) get_frames: 9 枚は上限でエラー');
  if (haveVideo) {
    const gf = await s3.call('tools/call', { name: 'get_frames', arguments: { id: 'v1', times: [0, 2.5], width: 320 } });
    const imgs = (gf.result.content || []).filter(c => c.type === 'image');
    const jpg = imgs[0] && Buffer.from(imgs[0].data, 'base64');
    check(!gf.result.isError && imgs.length === 2 && imgs.every(i => i.mimeType === 'image/jpeg') && jpg[0] === 0xFF && jpg[1] === 0xD8 && jpg.length < 350 * 1024, '(22) get_frames: バトル開始からの秒で JPEG が 2 枚返る（容量上限内）', `${imgs.length} 枚, ${jpg ? jpg.length : 0} B`);
    const t0 = (gf.result.content || [])[0];
    check(t0 && t0.type === 'text' && t0.text.includes('録画内 3.0 秒'), '(23) get_frames: バトル開始の位置 3 秒を足して録画内の位置にする', t0 && t0.text);
    const gfv = await s3.call('tools/call', { name: 'get_frames', arguments: { id: 'v1', times: [1], base: 'video' } });
    check(!gfv.result.isError && gfv.result.content[0].text.includes('録画内 1.0 秒'), '(24) get_frames: base:"video" は録画の先頭からの秒');
    const gfe = await s3.call('tools/call', { name: 'get_frames', arguments: { id: 'v1', times: [1, 500] } });
    check(!gfe.result.isError && gfe.result.content.filter(c => c.type === 'image').length === 1 && gfe.result.content.some(c => c.type === 'text' && c.text.includes('取れなかった')), '(25) get_frames: 録画の長さを超えた秒は取れなかったコマとして報告し、取れたコマは返す');
    const gfn = await s3.call('tools/call', { name: 'get_frames', arguments: { id: 'v1', times: [-5] } });
    check(gfn.result.isError === true && toolText(gfn).includes('開始より前'), '(26) get_frames: 録画の開始より前の秒はエラー');
  } else console.log('SKIP (22)-(26) get_frames の実コマ: ffmpeg が使えないので飛ばす');

  const ga = await s3.call('tools/call', { name: 'get_analysis', arguments: { id: 'v1', from: 4, to: 100 } });
  const gaj = jsonOf(toolText(ga));
  check(gaj.diag.rule_software === 'ガチホコバトル' && gaj.diag.yolo_disagree.mode.reason === 'count_evidence' && gaj.diag.count_evidence.hoko.share === 0.02, '(27) get_analysis: ルール判定の根拠（yolo_disagree・count_evidence）', JSON.stringify(gaj.diag).slice(0, 100));
  check(JSON.stringify(gaj.count_series) === '[[5,90,100],[9,80,70]]' && gaj.deaths.length === 2 && gaj.deaths[0].t === 40, '(28) get_analysis: from〜to で、カウントの推移とデスを絞る', JSON.stringify(gaj.count_series));
  const ga2 = await s3.call('tools/call', { name: 'get_analysis', arguments: { id: 'm1' } });
  check(ga2.result.isError === true && toolText(ga2).includes('古い書き出し'), '(29) get_analysis: 古い書き出し（diag 無し）は分かりやすいエラー');

  const gc = jsonOf(toolText(await s3.call('tools/call', { name: 'get_corrections', arguments: {} })));
  check(gc.count === 1 && gc.matches[0].id === 'v1' && gc.matches[0].corrections.fields[0].software === 'ガチホコバトル' && gc.matches[0].corrections.fields[0].human === 'ナワバリバトル' && gc.matches[0].corrections.misses[0].rel === 61.5, '(30) get_corrections: 訂正のある試合だけ、訂正前→後と見逃しの時刻', JSON.stringify(gc).slice(0, 120));
  const gc1 = jsonOf(toolText(await s3.call('tools/call', { name: 'get_corrections', arguments: { id: 'v2' } })));
  check(gc1.id === 'v2' && gc1.corrections.fields.length === 0, '(31) get_corrections: id 指定なら訂正が無くても返す');
  const gc2 = await s3.call('tools/call', { name: 'get_corrections', arguments: { id: 'nope' } });
  check(gc2.result.isError === true, '(32) get_corrections: 無い id は isError');
  check(s3.lines.every(l => { try { JSON.parse(l); return true; } catch { return false; } }), '(33) 画像を返しても stdout は JSON-RPC だけ');
} catch (e) { check(false, '(例外3) ' + e.message, s3.stderr()); }
finally { s3.stop(); fs.rmSync(dir3, { recursive: true, force: true }); fs.rmSync(vdir, { recursive: true, force: true }); }

fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(empty, { recursive: true, force: true });
if (fails) { console.log(`\n${fails} check(s) FAILED`); process.exit(1); }
console.log('\nALL PASSED');
process.exit(0);
