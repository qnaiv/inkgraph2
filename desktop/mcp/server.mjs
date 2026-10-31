// InkGraph AI 連携: MCP サーバー（stdio・依存ゼロ）。アプリが書き出した records.json を読み、Claude / Gemini CLI などに試合の要約を渡す。読み取り専用。
// stdout には JSON-RPC だけを書く（ログは stderr）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'inkgraph-ai', version: '0.1.0' };

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
