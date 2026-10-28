# InkGraph デスクトップ版（Windows）

Web 版（`../web`）を Electron で包んだものです。解析・保存・クラウド同期のコードは Web 版と同じで、次の点だけ違います。

- **ウィンドウが最小化・他のウィンドウに隠れても、解析と録画が止まりません**（ブラウザ版は止まって、その試合が保存されません）。
- **試合ごとの録画ファイル**（`日時_ルール_ステージ_勝敗.webm`、1 試合 1 ファイル）を、保存先フォルダへ直接書きます。ブラウザ版は録画に対応していません。
- 画面共有は、アプリ内の一覧からウィンドウ／画面を選びます（Windows ではシステム音も録れます）。キャプチャーボードの映像はブラウザ版と同じく使えます。

## 使い方（配る側）
- Actions の「Build desktop (Windows)」を手動で実行するか、`desktop-v0.1.0` のようなタグを push すると、`InkGraph-…-win-x64.exe`（インストーラー）と `…-portable.exe`（インストール不要）ができます（Artifacts／Release）。
- コード署名はしていないので、初回は Windows の「PC を保護しました」が出ます（「詳細情報」→「実行」）。

## 開発
```
cd web && npm ci && npm run build      # Web 版を dist に作る
cd ../desktop && npm install
npm start                              # 起動（../web/dist を読む）
npm run check                          # Linux: xvfb-run -a electron --no-sandbox tools/desktop_check.js
```
`desktop_check` は、デスクトップ版として開く・ウィンドウを隠しても取り込みが止まらない・2 試合続けて録画ファイルが 2 つできる、を確認します（Windows 実機での最小化・遮蔽は未確認）。
