// InkGraph AI 連携: MCP サーバー（stdio・依存ゼロ）。アプリが書き出した records.json を読み、Claude / Gemini CLI などに試合の要約を渡す。読み取り専用。
// b22: 録画のあるこの PC 上では、録画のパス・指定した秒のコマ（画像）・検出の根拠・人の訂正（訂正前/後）も返す。コマは同梱の ffmpeg で 1 枚ずつ取り出す（動画全体は渡さない）。
// stdout には JSON-RPC だけを書く（ログは stderr）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'inkgraph-ai', version: '0.2.0' };

const exportDir = () => process.env.INKGRAPH_AI_EXPORT_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'InkGraph', 'ai-export');
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

let aggregatePromise = null;
function loadAggregate() {
  if (!aggregatePromise) {
    aggregatePromise = (async () => {
      for (const p of [path.join(HERE, 'ai_summary.js'), path.join(HERE, '..', '..', 'web', 'src', 'ai_summary.js')]) {
        if (fs.existsSync(p)) return (await import(pathToFileURL(p).href)).aggregate;
      }
      throw new Error('ai_summary.js が見つかりません');
    })();
  }
  return aggregatePromise;
}

class NoData extends Error {}
function readJson(name) {
  const file = path.join(exportDir(), name);
  if (!fs.existsSync(file)) throw new NoData(`InkGraph のデスクトップ版で試合を保存すると書き出されます。書き出し先: ${exportDir()}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${name} を読めませんでした: ${e.message}`); }
}
const loadRecords = () => { const r = readJson('records.json'); if (!Array.isArray(r)) throw new Error('records.json の形が違います（配列ではありません）'); return r; };

const ms = r => { const t = Date.parse(r.created || ''); return Number.isFinite(t) ? t : 0; };
const text = s => ({ content: [{ type: 'text', text: s }] });
const fail = s => ({ isError: true, content: [{ type: 'text', text: s }] });
const pretty = o => JSON.stringify(o, null, 1);

// ---- b22: 録画・コマ ----
const MAX_FRAMES = 8, FRAME_BYTES = 350 * 1024, FRAME_TIMEOUT_MS = 20000;
const readConfig = () => { try { return JSON.parse(fs.readFileSync(path.join(exportDir(), 'config.json'), 'utf8')); } catch { return {}; } };
/** ffmpeg の場所: 環境変数 → アプリが書いた config.json → 開発時の node_modules → インストール版の同梱 → PATH 上の ffmpeg */
function findFfmpeg() {
  const cand = [process.env.INKGRAPH_FFMPEG, readConfig().ffmpeg];
  try { cand.push(createRequire(path.join(HERE, '..', 'package.json'))('ffmpeg-static')); } catch { /* 開発用の依存が無い */ }
  const la = process.env.LOCALAPPDATA; if (la) cand.push(path.join(la, 'Programs', 'InkGraph', 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'));
  for (const c of cand) if (c && fs.existsSync(c)) return c;
  return 'ffmpeg';
}
function runFfmpeg(args) {
  return new Promise(resolve => {
    let p, t; const out = []; let err = '', done = false;
    const fin = v => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    try { p = spawn(findFfmpeg(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, reason: `ffmpeg を起動できません: ${e.message}` }); }
    t = setTimeout(() => { try { p.kill(); } catch { /* ignore */ } fin({ ok: false, reason: 'ffmpeg が時間内に終わりませんでした' }); }, FRAME_TIMEOUT_MS);
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => { err += d; });
    p.on('error', e => fin({ ok: false, reason: e.code === 'ENOENT' ? 'ffmpeg が見つかりません（INKGRAPH_FFMPEG に ffmpeg.exe のパスを設定するか、InkGraph を一度起動して書き出しを更新してください）' : `ffmpeg エラー: ${e.message}` }));
    p.on('close', code => { const buf = Buffer.concat(out); fin(code === 0 && buf.length ? { ok: true, buf } : { ok: false, reason: `コマを取り出せませんでした（位置が録画の長さを超えている／壊れた録画の可能性）${err ? ': ' + err.trim().split('\n').pop() : ''}` }); });
  });
}
/** 1 コマ（JPEG）。容量の上限を超えたら、画質→幅の順に下げて撮り直す */
async function grabFrame(file, pos, width) {
  let w = width, q = 4, last = null;
  for (let i = 0; i < 4; i++) {
    const r = await runFfmpeg(['-v', 'error', '-ss', Math.max(0, pos).toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale='min(${w},iw)':-2`, '-q:v', String(q), '-f', 'image2pipe', '-vcodec', 'mjpeg', '-']);
    if (!r.ok) return r;
    last = r;
    if (r.buf.length <= FRAME_BYTES) return r;
    if (i % 2 === 0) q += 6; else w = Math.round(w * 0.75);
  }
  return last;
}
const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
function needRecord(id) {
  const r = loadRecords().find(x => x.id === id);
  if (!r) throw new NoData(`id ${id} の試合が見つかりません。list_matches で確認してください`);
  return r;
}
/** 録画を開ける状態か。ダメなら、理由を日本語で返す */
function videoState(r) {
  const v = r.video;
  if (!v || !v.path) return { ok: false, reason: 'この試合は録画と結びついていません（録画オフで保存した試合、または録画機能の前の書き出しです）。InkGraph を起動すると書き出しが更新されます。' };
  let st = null; try { st = fs.statSync(v.path); } catch { /* 無い */ }
  if (!st || !st.isFile()) return { ok: false, v, reason: `録画ファイルが見つかりません: ${v.path}\nこの MCP は録画のある PC 上でだけコマを取り出せます。別の PC・移動/削除した録画では使えません。` };
  return { ok: true, v, size: st.size };
}
const inRange = (t, from, to) => t >= from && t <= to;

const NOTE = '注意: enough が false の窓（試合数が少ない）は、助言の根拠にしない。quality（除外した試合・要修正のまま・注意書き）と、各値の lo/hi（95% 信頼区間）を必ず踏まえ、断言せず「傾向」として話すこと。';

const TOOLS = [
  {
    name: 'get_summary',
    description: 'プレイヤー本人のスプラトゥーン3の戦績を、集計済みの要約で返す。戦績・上達・負けパターン・デスの傾向を聞かれたら、最初にこのツールを呼ぶ。窓は「今日の連戦」「直近20試合」「直近30日」の3つを同時に返す（window で1つに絞れる。all は全期間）。勝率とデス/分には信頼区間（lo/hi）が付く。ルールやステージで絞れる（件数が足りないと窓が自動で広がり widened_from に出る）。数値はアプリが計算済みなので、自分で計算し直さない。',
    inputSchema: {
      type: 'object',
      properties: {
        window: { type: 'string', enum: ['today', 'last20', 'last30d', 'all'], description: '省略すると today / last20 / last30d の3つを返す' },
        rule: { type: 'string', description: 'ルールで絞る。例: ガチヤグラ、ガチアサリ、ガチエリア、ガチホコバトル' },
        stage: { type: 'string', description: 'ステージ名で絞る。例: チョウザメ造船' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'list_matches',
    description: '試合の一覧を新しい順に返す（id・日時・ルール・ステージ・勝敗・時間・K+A・デス数・最初のデスの秒・要修正の状態）。get_summary で気になった試合を探すときに使う。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '件数。既定10、最大50' },
        rule: { type: 'string' }, stage: { type: 'string' },
        result: { type: 'string', enum: ['WIN', 'LOSE'] }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_match',
    description: '試合1件の詳細（デスとキルの時刻＝バトル開始からの秒、スペシャルの溜め/未使用のままデス/発動の数など）を返す。id は list_matches か get_summary の match_ids から取る。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '試合の id' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'get_video',
    description: '試合の録画の情報（この PC 上のパス・存在するか・サイズ・バトル開始の録画内の位置）を返す。コマを見る前に、録画があるか確かめるのに使う。録画が無い・移動した場合は、その理由を返す。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '試合の id' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'get_frames',
    description: `録画の指定した秒のコマを画像（JPEG）で返す。times は get_match のデス/キルと同じ「バトル開始からの秒」（base:"video" なら録画の先頭からの秒）。最大 ${MAX_FRAMES} 枚・1 枚 約350KB 以内に縮小。誤検出・見逃しの疑いがある時刻の前後（例: t-2, t, t+2）を見て、検出が合っているか確かめる。録画がこの PC に無いと使えない。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '試合の id' },
        times: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: MAX_FRAMES, description: '見たい時刻（秒）' },
        base: { type: 'string', enum: ['battle', 'video'], description: '既定 battle＝バトル開始からの秒。video＝録画の先頭からの秒' },
        width: { type: 'integer', minimum: 160, maximum: 1280, description: '画像の幅。既定 640' }
      },
      required: ['id', 'times'], additionalProperties: false
    }
  },
  {
    name: 'get_analysis',
    description: '試合の検出の根拠を返す: ルール/マッチタイプをどう決めたか（ソフトの読み・出どころ・YOLO との食い違い mode_guess/yolo_disagree）、タイマーの位置 hud_layout（トリカラは tricolor）、「のこり」が読めた割合 count_evidence、カウントの推移、デス/キル（from〜to の秒で絞れる）。ルールの誤判定やカウントの読み違いを調べるときに使う。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, from: { type: 'number', description: 'バトル開始からの秒（始め）' }, to: { type: 'number', description: 'バトル開始からの秒（終わり）' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'get_corrections',
    description: '人が訂正した試合の「ソフトの読み（訂正前）→ 人の値（訂正後）」を返す（ルール・マッチタイプ・ステージ・勝敗・K+A・デス・カウント）と、誤検出（✗）・見逃し（追加）の時刻。検出を直す材料。id を省くと、訂正のある試合・要修正の試合を新しい順に返す。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '省略すると訂正のある試合の一覧' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: '既定 20' } }, additionalProperties: false }
  }
];

async function callTool(name, args = {}) {
  try {
    if (name === 'get_summary') {
      const aggregate = await loadAggregate();
      const out = aggregate(loadRecords(), { window: args.window || null, rule: args.rule || null, stage: args.stage || null });
      return text(NOTE + '\n' + pretty(out));
    }
    if (name === 'list_matches') {
      const lim = Math.max(1, Math.min(50, Number.isFinite(+args.limit) && args.limit ? Math.floor(+args.limit) : 10));
      const rows = loadRecords().filter(r => (!args.rule || r.rule === args.rule) && (!args.stage || r.stage === args.stage) && (!args.result || r.result === args.result))
        .sort((a, b) => ms(b) - ms(a)).slice(0, lim)
        .map(r => ({ id: r.id, created: r.created, rule: r.rule, stage: r.stage, result: r.result, battle_sec: r.battle_sec, ka: r.ka, deaths: Array.isArray(r.deaths) ? r.deaths.length : null, first_death: r.first_death, fix: r.fix }));
      return text(pretty({ count: rows.length, matches: rows }));
    }
    if (name === 'get_match') {
      const r = loadRecords().find(x => x.id === args.id);
      return r ? text(pretty(r)) : fail(`id ${args.id} の試合が見つかりません。list_matches で確認してください`);
    }
    if (name === 'get_video') {
      const r = needRecord(args.id), st = videoState(r);
      if (!st.ok && !st.v) return fail(st.reason);
      return text(pretty({ id: r.id, exists: st.ok, path: r.video.path, file: r.video.file, bytes_on_disk: st.ok ? st.size : null, battle_start_pos_sec: r.video.battle_start_pos, battle_sec: r.battle_sec, ffmpeg: findFfmpeg(), note: st.ok ? 'get_frames に、get_match と同じ「バトル開始からの秒」を渡すとコマを見られる' : st.reason }));
    }
    if (name === 'get_frames') {
      const r = needRecord(args.id), st = videoState(r);
      if (!st.ok) return fail(st.reason);
      const times = Array.isArray(args.times) ? args.times.map(num) : [];
      if (!times.length || times.some(t => !Number.isFinite(t))) return fail('times に、見たい時刻（秒）の数値を 1 つ以上渡してください');
      if (times.length > MAX_FRAMES) return fail(`一度に取れるのは ${MAX_FRAMES} 枚までです（${times.length} 枚指定）`);
      const base = args.base === 'video' ? 'video' : 'battle', off = base === 'battle' ? num(st.v.battle_start_pos) : 0;
      if (!Number.isFinite(off)) return fail('この試合は録画の開始位置（t0）が分からないので、バトル開始からの秒では指定できません。base:"video" で録画の先頭からの秒を渡してください');
      const width = Math.max(160, Math.min(1280, Number.isFinite(+args.width) && args.width ? Math.floor(+args.width) : 640));
      const content = [], errs = [];
      for (const t of times) {
        const pos = t + off;
        if (pos < 0) { errs.push(`${t} 秒: 録画の開始より前です（録画内の位置 ${pos.toFixed(1)} 秒）`); continue; }
        const g = await grabFrame(st.v.path, pos, width);
        if (!g.ok) { errs.push(`${t} 秒（録画内 ${pos.toFixed(1)} 秒）: ${g.reason}`); continue; }
        content.push({ type: 'text', text: `${base === 'battle' ? 'バトル開始から' : '録画の先頭から'} ${t} 秒（録画内 ${pos.toFixed(1)} 秒）` });
        content.push({ type: 'image', data: g.buf.toString('base64'), mimeType: 'image/jpeg' });
      }
      if (!content.length) return fail(errs.join('\n'));
      if (errs.length) content.push({ type: 'text', text: '取れなかったコマ:\n' + errs.join('\n') });
      return { content };
    }
    if (name === 'get_analysis') {
      const r = needRecord(args.id), from = Number.isFinite(num(args.from)) ? num(args.from) : -Infinity, to = Number.isFinite(num(args.to)) ? num(args.to) : Infinity;
      if (!r.diag) return fail('この試合の書き出しには検出の根拠がありません（古い書き出しです）。InkGraph を起動すると更新されます。');
      const deaths = Array.isArray(r.death_ctx) && r.death_ctx.length ? r.death_ctx.filter(d => inRange(d.t, from, to)) : (r.deaths || []).filter(t => inRange(t, from, to)).map(t => ({ t }));
      return text(pretty({ id: r.id, created: r.created, rule: r.rule, match_type: r.match_type, stage: r.stage, battle_sec: r.battle_sec, diag: r.diag, count_series_columns: ['バトル開始からの秒', '自チームのカウント', '相手のカウント'], count_series: (r.count_series || []).filter(x => inRange(x[0], from, to)), deaths, kills: (r.kills || []).filter(t => inRange(t, from, to)), tags: r.tags }));
    }
    if (name === 'get_corrections') {
      const recs = loadRecords();
      const row = r => ({ id: r.id, created: r.created, fix: r.fix, rule: r.rule, match_type: r.match_type, stage: r.stage, corrections: r.corrections || null, diag: r.diag ? { hud_layout: r.diag.hud_layout, rule_source: r.diag.rule_source, yolo_disagree: r.diag.yolo_disagree, count_evidence: r.diag.count_evidence } : null });
      if (args.id) { const r = recs.find(x => x.id === args.id); return r ? text(pretty(row(r))) : fail(`id ${args.id} の試合が見つかりません。list_matches で確認してください`); }
      const lim = Math.max(1, Math.min(50, Number.isFinite(+args.limit) && args.limit ? Math.floor(+args.limit) : 20));
      const has = r => r.fix !== 'none' || (r.corrections && (r.corrections.fields.length || r.corrections.false_positives.length || r.corrections.misses.length));
      const rows = recs.filter(has).sort((a, b) => ms(b) - ms(a)).slice(0, lim).map(row);
      return text(pretty({ count: rows.length, matches: rows, note: 'corrections.fields＝結果画面の項目の訂正（software＝ソフトの読み、human＝人の値）。false_positives＝人が✗にした検出、misses＝人が足した見逃し（時刻はバトル開始からの秒）。' }));
    }
    return null;
  } catch (e) {
    return fail(e instanceof NoData ? e.message : `エラー: ${e.message}`);
  }
}

const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isNote = id === undefined || id === null;
  if (method === 'initialize') {
    const want = params && params.protocolVersion;
    return reply(id, { protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0], capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === 'notifications/initialized' || (isNote && String(method).startsWith('notifications/'))) return;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const res = await callTool(params && params.name, params && params.arguments);
    return res ? reply(id, res) : error(id, -32602, `unknown tool: ${params && params.name}`);
  }
  if (!isNote) return error(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return error(null, -32700, 'Parse error'); }
  handle(msg).catch(e => { log('handler error', e && e.stack || e); if (msg && msg.id !== undefined && msg.id !== null) error(msg.id, -32603, 'Internal error'); });
});
rl.on('close', () => process.exit(0));
