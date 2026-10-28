# InkGraph デスクトップ版（Windows）

Web 版（`../web`）を Electron で包んだものです。解析・保存・クラウド同期のコードは Web 版と同じで、次の点だけ違います。

- **ウィンドウが最小化・他のウィンドウに隠れても、解析と録画が止まりません**（ブラウザ版は止まって、その試合が保存されません）。
- **試合ごとの録画ファイル**（`日時_ルール_ステージ_勝敗.webm`、1 試合 1 ファイル）を、保存先フォルダへ直接書きます。ブラウザ版は録画に対応していません。
- 映像の入力はキャプチャーボードだけです（録画ファイル・画面共有の取り込みは廃止）。録画の設定はライブ画面にあります。

## 使い方（配る側）
- main に `desktop/` か `web/` の変更が入ると、Actions の「Build desktop (Windows)」が自動で動き、`InkGraph-…-win-x64.exe`（インストーラー）と `…-portable.exe`（インストール不要）を作ります。成果物は Artifacts と、**固定のリリース「desktop-latest」**（いつも最新）に出ます。手動実行や、`desktop-v0.1.0` のようなタグでも動きます。
- コード署名はしていないので、初回は Windows の「PC を保護しました」が出ます（「詳細情報」→「実行」）。

## 開発
```
cd web && npm ci && npm run build      # Web 版を dist に作る
cd ../desktop && npm install
npm start                              # 起動（../web/dist を読む）
npm run check                          # Linux: xvfb-run -a electron --no-sandbox tools/desktop_check.js
```
`desktop_check` は、デスクトップ版として開く・ウィンドウを隠しても取り込みが止まらない・2 試合続けて録画ファイルが 2 つできる、を確認します（Windows 実機での最小化・遮蔽は未確認）。
