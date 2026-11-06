// InkGraph 拡張の入口。サーバー本体はコピーせず、インストール済みの InkGraph の desktop/mcp/server.mjs をそのまま読み込む（アプリの更新に自動で追従する）。
// 探す順: 環境変数 INKGRAPH_MCP_SERVER → インストール版 → 開発用の既定の場所。見つからなければ stderr に理由を出して終了する。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const local = process.env.LOCALAPPDATA || '';
const candidates = [
  process.env.INKGRAPH_MCP_SERVER,
  path.join(local, 'Programs', 'InkGraph', 'resources', 'mcp', 'server.mjs'),
  path.join(local, 'Programs', 'inkgraph-desktop', 'resources', 'mcp', 'server.mjs')
].filter(Boolean);
const found = candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
if (!found) {
  process.stderr.write(`InkGraph のサーバーが見つかりません。InkGraph をインストールするか、環境変数 INKGRAPH_MCP_SERVER に server.mjs のパスを設定してください。探した場所:\n${candidates.join('\n')}\n`);
  process.exit(1);
}
await import(pathToFileURL(found).href);
