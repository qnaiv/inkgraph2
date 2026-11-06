# InkGraph デスクトップ版（Windows）

Web 版（`../web`）を Electron で包んだものです。解析・保存・クラウド同期のコードは Web 版と同じで、次の点だけ違います。

- **ウィンドウが最小化・他のウィンドウに隠れても、解析と録画が止まりません**（ブラウザ版は止まって、その試合が保存されません）。
- **試合ごとの録画ファイル**（`日時_ルール_ステージ_勝敗.webm`、1 試合 1 ファイル）を、保存先フォルダへ直接書きます。ブラウザ版は録画に対応していません。
- 録画は、保存時に ffmpeg（同梱。`ffmpeg-static`）で**再エンコードなしに詰め替え**て、どのプレーヤーでもシークできる普通の MP4 にします（インストーラーは約 70MB 大きくなります）。
- 映像の入力はキャプチャーボードだけです（録画ファイル・画面共有の取り込みは廃止）。録画の設定はライブ画面にあります。

## 使い方（配る側）
- main に `desktop/` か `web/` の変更が入ると、Actions の「Build desktop (Windows)」が自動で動き、**インストーラー**（`InkGraph-0.1.<実行番号>-win-x64.exe`）と、自動アップデート用の `latest.yml`・`.blockmap` を作ります。成果物は Artifacts と、**固定のリリース「desktop-latest」**（いつも最新）に出ます。手動実行や、`desktop-v0.1.0` のようなタグでも動きます。
- **portable 版は廃止しました**（インストーラーと同じファイル名で上書きし合っていたため）。
- コード署名はしていないので、初回は Windows の「PC を保護しました」が出ます（「詳細情報」→「実行」）。

## 自動アップデート（b21）
- インストーラー版は、起動の少しあと（20 秒）と、4 時間ごとに、`desktop-latest` の `latest.yml` を見に行きます。版番号（`0.1.<実行番号>`）が大きければ、新しい版をダウンロードし、準備ができたら右下に「再起動して更新」を出します。押さなければ、アプリを閉じたときに入れ替わります。
- **録画中は、確認・ダウンロード・通知・再起動をしません**（録画が終わってから）。
- 設定画面の「バージョン」に「更新を確認」ボタンがあります。
- 開発起動（`npm start`）では無効です。動作確認だけ、`INKGRAPH_UPDATE_TEST_URL=http://localhost:8123/`（`latest.yml` を置いた場所）で有効にできます。
- 差分ダウンロードは、前の版の blockmap が置き場に無いので、基本は全体のダウンロードです。

### portable 版から、インストーラー版への乗り換え（1 回だけ）
1. リリース `desktop-latest` から `InkGraph-…-win-x64.exe` をダウンロードして実行する。
2. 設定・試合の記録・AI 連携のファイルは、`%APPDATA%\inkgraph-desktop` にあり、portable 版と同じ場所なので、そのまま引き継がれます（アプリ名が同じため。実際に入れ替えた通しでは未確認）。
3. 以後は、アプリが新しい版を見つけて更新します。古い portable の exe は消して構いません。

## AI 連携の MCP: 録画のコマ・検出の根拠・訂正（b22）

`desktop/mcp/server.mjs`（設定画面の「AI 連携」に、Claude Desktop 用の設定が出ます）は、集計（`get_summary` / `list_matches` / `get_match`）に加えて、次のツールを持ちます。AI 用 ZIP を書き出さなくても、MCP だけで検出の誤りを調べられます。

| ツール | 返すもの |
| --- | --- |
| `get_video` | 録画のパス・存在・サイズ・バトル開始の録画内の位置 |
| `get_frames` | 指定した秒のコマ（JPEG。最大 8 枚、1 枚 350KB 以内）。`times` は `get_match` のデス/キルと同じ「バトル開始からの秒」。`base:"video"` で録画の先頭からの秒 |
| `get_analysis` | ルール判定の根拠（`yolo_disagree`・`count_evidence`）、`hud_layout`、カウントの推移、デス/キル（`from`〜`to` で絞る） |
| `get_corrections` | 人の訂正の「ソフトの読み → 人の値」、✗ にした検出、足した見逃し |

- コマは**録画のある PC 上でだけ**取り出せます（ffmpeg で 1 枚ずつ。動画全体は渡しません）。録画が無い・移動した場合は、その理由が返ります。
- ffmpeg は、同梱のものを自動で見つけます（アプリが書き出し先の `config.json` に場所を書きます）。見つからない場合は、環境変数 `INKGRAPH_FFMPEG` に ffmpeg.exe のパスを設定します。
- 新しいツールを使うには、InkGraph を新しい版に更新して一度起動し（書き出しが更新されます）、Claude Desktop を再起動します。

## 開発
```
cd web && npm ci && npm run build      # Web 版を dist に作る
cd ../desktop && npm install
npm start                              # 起動（../web/dist を読む）
npm run check                          # Linux: xvfb-run -a electron --no-sandbox tools/desktop_check.js
```
`desktop_check` は、デスクトップ版として開く・ウィンドウを隠しても取り込みが止まらない・2 試合続けて録画ファイルが 2 つできる、を確認します（Windows 実機での最小化・遮蔽は未確認）。

## Claude Desktop 拡張（.mcpb）
`desktop/mcp/extension/` は Claude Desktop に入れる拡張の元。中身は入口の `server/launch.mjs` だけで、サーバー本体は**インストール済みの InkGraph**（`%LOCALAPPDATA%\Programs\InkGraph\resources\mcp\server.mjs`、環境変数 `INKGRAPH_MCP_SERVER` で上書き可）をそのまま読む。アプリを更新すれば MCP のツールも自動で新しくなるので、拡張は入れ直さなくてよい。
作り方: `manifest.json` と `server/launch.mjs` を zip にして拡張子を `.mcpb` にする。Claude Desktop の設定 → 拡張機能 で入れる（旧版 0.1.0 は先に削除）。
