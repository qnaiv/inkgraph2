# InkGraph

スプラトゥーン3の録画（キャプチャ映像）を解析して、自分の成績と試合展開を可視化するツールです。

- **Phase 1**：リザルト画面から勝敗・ルール・ステージ・キル+アシスト・デス・スペシャル回数を読み取る
- **Phase 2**：試合中のHUDからタイムライン（自分のキル/デス/スペシャル、人数差、ヤグラのカウントと勝率推移）を作る
- **ブラウザ版**：キャプチャーボード映像をブラウザ上でそのまま分析する（[ブラウザ版（web/）](#ブラウザ版web)を参照）

背景・精度・今後の方針は [docs/CONTEXT.md](docs/CONTEXT.md)、意思決定の記録は [docs/DECISIONS.md](docs/DECISIONS.md)、作業ログは [PROGRESS.md](PROGRESS.md)。

## 現在の状況と残りの作業

ブラウザ版の実装が進み、現在は録画なし・自己学習の仕上げと正解データの収集フェーズにあります。詳細や今後の計画は各 issue および [docs/CONTEXT.md](docs/CONTEXT.md) を参照してください。

- **進行中**: 録画なし設計＋自己学習（[Epic #30](https://github.com/qnaiv/inkgraph2/issues/30)。子課題の大半はマージ済みだが Epic と [#31](https://github.com/qnaiv/inkgraph2/issues/31)・[#35](https://github.com/qnaiv/inkgraph2/issues/35) は open。目的: 録画を残さず静止画と正解データで確認・学習できるようにする → 残りの段階が終わり Epic が閉じること）
- **進行中（レビュー待ち）**: 数字サンプル追加（[#7](https://github.com/qnaiv/inkgraph2/issues/7)、[PR #129](https://github.com/qnaiv/inkgraph2/pull/129) が open。カウント読み取り [#6](https://github.com/qnaiv/inkgraph2/issues/6) の前提 → マージされ、不足数字の補強方針が残課題として記録されること）
- **ブロック中**: XP基盤（Xマッチの録画待ち。対応する issue は現時点で無い → Xマッチ1試合の録画が用意できたら issue 化して着手）
- **未着手**: 後段分析（動きと勝敗の関係 [#14](https://github.com/qnaiv/inkgraph2/issues/14)〜[#16](https://github.com/qnaiv/inkgraph2/issues/16)、ステージの得意・苦手。目的: 状況別のデス/キルと勝敗への効き方を見る → 複数試合で集計とランキングが出ること。ステージ専用の issue は現時点で無い）
- **未着手（ラベル蓄積待ち）**: 精度系（[#1](https://github.com/qnaiv/inkgraph2/issues/1) の正解ラベル蓄積が前提で、[#3](https://github.com/qnaiv/inkgraph2/issues/3) キル・[#4](https://github.com/qnaiv/inkgraph2/issues/4) スペシャル・[#6](https://github.com/qnaiv/inkgraph2/issues/6) カウント等が open → ラベル付き試合が揃い、各検出で目標精度を評価できること）

## ユーザー側でやること

- [ ] Xマッチ1試合の録画を用意する（XP基盤の前提）
- [ ] 開いている PR（現在は [#129](https://github.com/qnaiv/inkgraph2/pull/129)）の内容を確認してマージ判断をする
- [ ] 確認モードで試合に正解ラベルを付け、正解データの zip を渡す（手順は下の「[精度の確認とフィードバックの流れ](#精度の確認とフィードバックの流れ)」、前提は [#1](https://github.com/qnaiv/inkgraph2/issues/1)）
- [ ] GitHub Pages の設定を GitHub Actions にする（手順は下の「[GitHub Pages配信](#github-pages配信)」節）
- [ ] @grok 通知用の secrets を登録する（手順は下の「[GitHub から Grok へ指示する（@grok）](#github-から-grok-へ指示するgrok)」節）
- [ ] 実際のキャプチャーボードでライブ分析を通し、体感の精度を確認する（公開URL https://qnaiv.github.io/inkgraph2/ でも確認）

## セットアップ（Windows）

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

ffmpeg / ffprobe に PATH が通っている必要があります（分割・結合で使用）。

Windows の注意点（v6〜）:
- テンプレート画像は日本語ファイル名（例 `templates/res_mode/ガチヤグラ__m1.png`）。`cv2.imread` は Windows で非ASCIIパスを読めないため、コードは `inkgraph.common.imread_unicode` / `imwrite_unicode`（`np.fromfile`+`cv2.imdecode` / `cv2.imencode`+`tofile`）を使う。新しいコードでも `cv2.imread/imwrite` を直接使わないこと。
- グラフの日本語フォントは `setup_cjk_font()` が Noto Sans CJK JP → Yu Gothic → Meiryo → MS Gothic → Hiragino Sans → IPAexGothic の順で、インストール済みのものだけを使う（Windows標準なら Yu Gothic / Meiryo）。どれも無い場合は警告を1回だけ出す。

## 使い方

### 1. 試合ごとに切り出し（autosplit）

```powershell
python src\autosplit.py <video.mkv>
```

- 録画から試合区間を検出して試合ごとに切り出し、`upload/` に **95MB未満のパート** に分割して出力（Googleドライブの100MB/ファイル制限対策）
- `--chunk-mb N`：分割サイズ指定（上限99、それ以上は99に丸める）
- `--no-chunk`：分割しない
- その他：`-o 出力先`, `--pre/--post`（前後の余白秒）, `--dry-run`

### 2. パートの結合

```powershell
python src\join_parts.py --stem full_match01 --dir upload -o match01.mp4
```

### 3. 解析

```powershell
python src\analyze.py match01.mp4 -o out\match01
```

`timeline.json` / `timeline.png`（ガチヤグラなら `tower.png` も）を出力します。

図だけ描き直す場合：

```powershell
cd src
python -m inkgraph.viz <outdir>
```

## ブラウザ版（web/）

バックエンド不要のブラウザアプリです（Vite＋素のES Modules）。分析はWeb Worker内で動き、試合データはブラウザ内（IndexedDB）に保存されます。

### GitHub Pages配信

ブラウザ版は GitHub Pages にて静的配信されます。

- **公開URL**：https://qnaiv.github.io/inkgraph2/ （リポジトリの Settings > Pages に最終URLが表示されます）
- **自動デプロイ**：`main` ブランチへのマージ時に `.github/workflows/pages.yml` により自動でビルド・デプロイされます。GitHub Actions の `workflow_dispatch`（手動実行）からも実行可能ですが、本番デプロイが行われるのは `main` ブランチから実行した場合のみです（PRや機能ブランチからの実行時はビルド検証のみ行われ、本番環境は上書きされません）。
- **リポジトリ側の必須設定（Naoki / Bobo作業）**：リポジトリの **Settings > Pages > Build and deployment > Source** を **"GitHub Actions"** に変更する必要があります（コード・CIからは変更できないため、管理者による手動設定が必要です）。※本PRではリポジトリ設定の変更は行いません。

### Windowsでの使い方

1. Node.js（LTS版）をインストールする
2. 次を実行する

   ```powershell
   cd web
   npm install
   npm run dev
   ```

3. ChromeまたはEdgeで http://127.0.0.1:5173 を開く
4. 「ライブ分析」でキャプチャーデバイス（Capvoなど）を選び、「解析を開始」を押す
   - OBSがデバイスを占有しているとブラウザから開けません。その場合はOBSを閉じるか、OBSの「仮想カメラ」を選んでください。

ビルド版で動かす場合：

```powershell
cd web
npm run build
npm run preview
```

ビルド結果（dist）は必ずhttp経由で開いてください。file:// で直接開くと、モジュール形式のWorkerが動きません。

### ページ

- **ライブ分析**：キャプチャーボード（映像デバイスを選択）またはローカルの動画ファイルを解析する。動画ファイルは「早送り解析」（再生せず高速に解析）も選べる。キャプチャー時は試合ごとに映像を録画し、後で確認できる。
- **試合一覧**：保存した試合の一覧。バックアップ（試合データ＋設定＋保持中の静止画、録画videosは含めない）のZIP書き出し／読み込み、正解データ（フィードバック）の書き出しができる。従来の試合ログJSONの読み込みにも対応。
- **試合の詳細・確認**：`viz.py` と同じ形式のSVGタイムラインを表示する。確認モードで検出結果の正誤を付けられる。
- **傾向分析**：勝率、試合ごとのキル／デス／スペシャル、抑え／打開別・カウント差別のデス・キル数、勝率変化が大きかったデス（痛手）とキル（好プレー）、全体の検出精度。

### 解析の仕組み（概要）

- Pythonと同じ0.2秒刻み（5フレーム／秒）で解析します。1080pで1フレーム約10ミリ秒です。ヤグラのカウント読み取りは1秒に1回です。
- テンプレートや数字分類器は `tools/export_web_assets.py` が `web/public/assets/inkgraph_assets.json` に書き出します。
- 試合の開始と終了：HUDのタイマーが見えている間を試合中とし、タイマーが25秒間消えたら試合終了（最短60秒）とします。リザルト画面は試合中〜終了後に読み取り、試合をIndexedDBに保存します。

### 精度の確認とフィードバックの流れ

1. ブラウザ版で試合を解析する（キャプチャー使用時は録画も保存される）
2. 「試合の詳細・確認」の確認モードで、保存した録画（または手元の動画ファイル）をタイムラインと同期して再生する。各イベントをクリックするとその時刻へ移動できる。
   - イベントごとに「✓正しい」「✗誤検出」「削除」を付ける
   - 見逃しは「見逃し追加」で現在の再生位置に追加する
   - リザルト画面の各項目にも ✓／✗ を付け、✗のときは正しい値を入力する
   - 試合ごと・全体の適合率（検出のうち正しい割合）と再現率（実際にあったもののうち検出できた割合）が表示される
3. 「試合一覧」の「正解データを書き出す」で、確認済みの正解データをまとめてzipにする（既定は未書き出し分のみの「追加分」、「全件」も選べる。50MBを超える場合は試合のチェックを外して分割）。中身は `feedback.json`（format 2）、`README.txt`、静止画のみで、動画全体よりずっと小さい。
   - ✗にしたイベントと見逃し追加の前後の静止画は自動で保存される
   - 確信度が低いリザルト画面と、未知のルール／ステージ用の試合中画面（1試合3枚）も自動で保存される
4. zipをGoogleドライブのフォルダ「grok用」にアップロードする
5. ボックス側で取り込む

   ```powershell
   python tools/ingest_feedback.py FEEDBACK.zip          # 内容の確認のみ
   python tools/ingest_feedback.py FEEDBACK.zip --apply  # 反映
   ```

   `--apply` を付けると、モード／ステージのテンプレート追加、`labels/feedback/*.json` への修正済みの正解データの書き出し、ラベル付け用のイベント前後フレームの収集、Webアセットの再書き出しを行います。

### 自己学習（S0-S2: 候補提示・端末内適用・版管理）

確認済みの正解データ（ルール・ステージ）をもとに、リザルト画面の判定閾値をブラウザ内で最適化します（外部送信なし・端末内のみ）。

1. 「試合の詳細・確認」でリザルト画面のルール・ステージに ✓（正しい）または ✗（修正値）を付ける
2. 「試合一覧」上部の自己学習パネルで「候補を作って再判定」を押す
   - 学習データ（train）と評価データ（holdout、最新1試合）に分け、最適な閾値候補を探索
   - 変更前後の正解数・一致率・直った件数／新たに壊れた件数の表が表示される
3. 「この候補を端末内に適用」を押し、確認ダイアログで「確認して適用」を押すと、端末内の解析閾値が更新される
4. 判定を元に戻したいときは「学習を1つ前に戻す」でロールバック、「未適用に戻す」で既定値（0.50）へ初期化できる
5. 保存された学習パックは「学習パックの版一覧」に保持され、いつでも再判定結果（直った／壊れた件数）を確認した上で任意の版へ切り替えられる

### 既知の弱点

- ヤグラの位置検出では、OpenCVの `cv2.HoughCircles` の代わりにJSで放射状の勾配を使った円探索を使っています。Pythonのヤグラ保持チーム判定との一致率は1フレームあたり約79%で、精度を落とす要因です。

## timeline.png の見方

- **横軸**：試合開始からの経過時間
- **「自分」の段**：★キル、✖デス。デス後の薄い赤は復活待ち
- **スペシャル**：オレンジの帯が溜まっていた時間。●発動、▼溜めたままやられた（払い落とし）、■試合終了時に未使用
- **人数差の帯**：青＝こちらが多い、赤＝少ない
- **味方1〜3／敵1〜4**：やられ中の時間（参考表示）
- **斜線**：マップ表示中などで判定不可の時間
- ★は画面のキル表示のみ。アシストは含まないため、タイトルの「キル+アシスト」より少なくなることがあります

## tower.png の見方（ガチヤグラ）

- 両チームの残りカウント推移
- ヤグラの保持チーム（自チーム／敵／中立）
- 簡易勝率カーブ
- 勝率を大きく動かした自分のキル・デス（上位）

## GitHub から Grok へ指示する（@grok）

GitHub Actions（`.github/workflows/grok-notify.yml`）が、`@grok` を含む投稿を Grok の webhook に通知します。

- **書き方**：Issue 新規作成の本文、または Issue / PR へのコメントに `@grok` と指示を書く。投稿者が `qnaiv` の場合だけ動作します。
- **対象イベント**：`issues`（opened）、`issue_comment`（created。PR へのコメントも含む）
- **必要な secrets**：`GROK_WEBHOOK_URL` / `GROK_WEBHOOK_AUTH`（Settings > Secrets and variables > Actions に登録）。ルーティンのパネルでコピーできる Authorization header の内容を、そのまま GROK_WEBHOOK_AUTH に登録する
- **自動でしないこと**：GitHub への自動返信、自動マージ、Issue の自動クローズ。通知のみです。
- **secrets 未設定時**：警告（`::warning::`）を出して送信をスキップし、ジョブは成功扱いで終了します。
- **認証**：`GROK_WEBHOOK_AUTH` の値を `Authorization` ヘッダとしてそのまま送信します（加工・`Bearer` の付け足しはしません）。
- **最初のテスト送信での確認手順**：
  - (a) `GROK_WEBHOOK_URL` と `GROK_WEBHOOK_AUTH` の2つの secrets を登録する。
  - (b) `qnaiv` で `@grok` を含むテストコメント／Issue を投稿する。
  - (c) Actions の Grok Notify 実行が成功することと、Grok 側で受信できることを確認する。
  - 失敗時は secrets の値（特に Authorization header の内容をそのまま登録したか）と、Actions ログの警告を確認する。
- 検証：`bash tools/test_grok_notify.sh`
