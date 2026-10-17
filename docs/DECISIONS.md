# DECISIONS

新しい決定は末尾に追記する（日付・決定・理由）。

## 2026-10-16 D1: OCR/YOLO/有料APIを使わない
- 決定：1280x720正規化＋固定座標HUD切り抜き＋小さな分類器・テンプレートで検出する
- 理由：ローカルで軽く動かす、依存とコストを減らす

## 2026-10-16 D2: アシストは分析しない
- 理由：画面上に表示されず検出不能。本人も重視していない

## 2026-10-17 D3: 自分の成績を最優先
- 味方・敵のスコアは優先度低（タイムライン上の文脈表示のみ）
- フルスコアボード読み取りとHUDスロット↔プレイヤー対応付けは中止

## 2026-10-17 D4: 試合展開（抑え/打開＋カウント差）を分析の軸にする
- 各デス・キル・スペシャルに状況（抑え/打開/互角、カウント、カウント差、人数差）を付ける

## 2026-10-17 D5: キル/デスを勝率変化で重み付け
- その前後の勝率予測の差をプレーの重みとする
- まず手設定のヒューリスティック（カウント差×残り時間、人数差、ヤグラ保持）、試合が貯まったら学習
- ブキ別の重み付けは後回し

## 2026-10-17 D6: autosplitはデフォルトで95MB分割、上限99MB
- 理由：Googleドライブ「grok用」への転送が1ファイル100MB制限。`--no-chunk`で無効化

## 2026-10-17 D7: タイムラインを日本語表記に作り直し
- L0-3/R0-3表記を廃止し「自分」「味方1〜3」「敵1〜4」、日本語凡例、試合開始からの経過時間軸

## 2026-10-17 D8: 自分のデスは「やられた」表示のみで判定
- 理由：HUD分類器併用で1080pで1試合約3回の誤検出

## 2026-10-17 D9: スペシャル満タンアイコンの彩度フィルタ（1080pのみ）
- 白っぽい満タンアイコンをデスと誤判定していたため、中央彩度>=55の区間を除外。720pでは悪化するため1080pのみ

## 2026-10-17 D10: スペシャル結果に unused_at_end を追加
- 試合終了時に溜まったままのスペシャルは「発動」ではなく「未使用」

## 2026-10-17 D11: GitHub連携はリポジトリ限定のfine-grained token
- 理由：セキュリティ。qnaiv/inkgraph2 のContents読み書きのみ許可。トークンはリポジトリやgit設定に保存しない

## D12 (2026-10-17) 最終目標：ブラウザ完結のWebアプリ
- キャプチャーボード映像をブラウザに映し、ブラウザ上でリアルタイム分析する。
- 試合ログをブラウザ内に蓄積し、試合ごとのタイムラインを個別に開けるようにする。
- 複数試合を通した傾向分析の結果を表示する。
- 現在のPythonパイプライン（固定座標クロップ＋小型分類器）は、ブラウザ移植を前提とした検証用プロトタイプと位置付ける。

## D13 (2026-10-17) タスクはGitHub Issues＋Projectで管理
- qnaiv/inkgraph2 のIssues（#1〜#25）に切り、Projectに自動追加する。
- ラベル：priority:高/中/低、phase:精度改善/分析/Webアプリ/基盤。
- 自分のK/D/SP・勝敗と抑え/打開・勝率重み付けを高、味方/敵スコアは低、アシストは扱わない。

## D14 (2026-10-17) Windows対応：日本語パスの画像I/OとCJKフォント
- 画像の読み書きは `imread_unicode` / `imwrite_unicode`（np.fromfile+imdecode / imencode+tofile）に統一。理由：Windowsで cv2.imread が日本語ファイル名のテンプレートを読めず、モード・ステージ判定が壊れていた。
- matplotlib の font.family は候補リストのうち実在するフォントだけを設定（findfont警告の大量出力を防ぐ）。CJKフォントが無ければ警告1回。
- ボックスで joined_match01 を再解析し、既存出力と同値（モード ガチヤグラ／ステージ クサヤ温泉）を確認。

## D15 (2026-10-17) ブラウザ版のアーキテクチャ
- 構成：`web/` にVite＋素のES Modules。バックエンドなし。
- 分析はWeb Workerで実行。Pythonと同じ5フレーム／秒（0.2秒刻み）。1080pで1フレーム約10ミリ秒、ヤグラのカウント読み取りは1秒に1回。
- 試合データと録画（MediaRecorder、webm 約2.5Mbps）はブラウザのIndexedDBに保存。
- 1080pからの切り抜きは、OpenCVのINTER_AREAと同じ計算をJSで再現して縮小する。理由：Pythonで作ったテンプレートと数字分類器をそのまま使うため。テンプレート・モデルは `tools/export_web_assets.py` が `web/public/assets/inkgraph_assets.json` に書き出す。
- `cv2.HoughCircles` はJSの放射状勾配による円探索に置き換えた。Pythonのヤグラ保持チーム判定との一致率は1フレーム約79%で、既知の弱点。
- 検証：ヘッドレスChromeで `web/tools/validate.mjs` と `compare.py` により1080pの試合1〜3をPythonと比較（自分のデス19/20一致、キル10/10、スペシャル14/14、リザルト各項目3/3、最終カウント2/2）。

## D16 (2026-10-17) 確認モードと、修正にもとづく精度評価・フィードバックパッケージ
- 確認モードで検出イベントごとに「正しい／誤検出／削除」、見逃しの追加、リザルト項目の ✓／✗（と修正値）を付ける。その結果から試合ごと・全体の適合率と再現率を求める。
- 動画全体ではなく、修正内容と静止画を入れたzip（feedback.json＋画像）を書き出し、Googleドライブ「grok用」にアップロードする。理由：動画は大きすぎる（D6の100MB制限）が、静止画とJSONなら十分小さい。
- 静止画の自動保存：✗にしたイベントと見逃し追加の前後、確信度が低いリザルト画面、試合中の3枚（未知のルール／ステージ用）。
- ボックス側は `python tools/ingest_feedback.py FEEDBACK.zip [--apply]` で取り込む。テンプレート追加、`labels/feedback/*.json` への正解データ書き出し、ラベル付け用フレーム収集、Webアセット再書き出しを行う。

## D17 (2026-10-17) コードの実装はAntigravity CLI（agy）に任せる
- Grokは仕様書の作成、検証、レビューを担当し、コードの記述はAntigravity CLI（`agy`）が行う。
- 作業の記録は `docs/AGY_LOG.md` に残す。

## D18 (2026-10-17) デザインレビュー反映：キル+アシストの廃止と停止ボタンの追加
- キル+アシスト（ka）はUIから外す。`tools/ingest_feedback.py` は `result_screen` や `fix` に `ka` がなくても止まらず、「未確認」（None）として扱う。自分のキルは、タイムラインのキルイベントで確認する（Leadの決定）。
- `.btn-stop` を `tokens.css` に追加した（背景は透明、文字色は `--danger`、1pxの `--danger` 枠線、ホバーで12%の薄い赤）。`.btn-danger-ghost` は残し、試合一覧の「…」メニュー内の「削除」に使う。
## D19 (2026-10-17) ヤグラ保持チーム判定：HoughCircles の忠実移植＋密サンプルの多数決
- 円検出：`web/src/core/tower.js` の `findCircle` を OpenCV 4 `HOUGH_GRADIENT`（medianBlur3→Canny 60/120→勾配方向投票→極大・minDist30→半径ヒストグラム）の JS 移植に置換。所有判定（色割合 S>140・V>120・0.15）は Python と同一。同じ cv2 画素を通す `tools/tower_frames.mjs` で保持チーム・x位置とも **100%一致**（3試合）、約50→8ms/フレーム。
- 系列化：ブラウザ版は約5fpsで全フレームに towerRow をかけ（`grid` 行は従来どおり約1秒ごと）、各1秒点の保持チームを ±3秒内の全検出の多数決で決める（同数なら最も近い行）。窓内に検出がなければ直前の保持チームを3秒まで引き継ぐ。生データは `tower_rows` として試合記録に保存し、`tools/tower_series_sweep.mjs` でオフライン探索できる。
- 一致率（ブラウザ版 vs Python版、`tools/tower_agree.py`）：

| 試合 | 最初 | Hough移植後 | 今回 |
|---|---|---|---|
| 1 | 62.2% | 74.9% | 82.8% |
| 2 | 81.1% | 83.3% | 84.5% |
| 3 | 64.4% | 70.9% | 78.2% |
| 合計 | 69.1% | 76.3% | 81.8% |

- 目標90%は未達。保持の引き継ぎ（hold 0〜10秒）は効果なし（窓内に検出が常にある）。色しきい値を緩める（S/V 80〜120、割合 0.08〜0.10）と、ブラウザ画素での一致はむしろ下がった（72.5%→67.9〜71.8%、試合1）ため据え置き。
- 原因：判定ロジックは一致しているので、残りはブラウザと cv2 のデコード画素とサンプル時刻の違い。Python版も1秒1枚の判定で揺れており（保持↔中立）、基準側のノイズも一致率を下げている。
- 次の案：(1) 比較の基準を Python 版ではなく人手ラベル（フィードバック zip）にする、(2) Python 版も密サンプル＋多数決にして両者のノイズを揃える、(3) ブラウザのフレームの PTS を requestVideoFrameCallback の mediaTime で Python のフレーム番号に合わせる。
## D20 (2026-10-17) 人手ラベル（フィードバック zip）を正解とした評価
- 正解は Web 版の確認モードが書き出すフィードバック zip（`feedback.json`、format 1）。`tools/eval_labels.py` が試合ごとのラベルに変換する（`--write-labels labels/` で `labels/<動画名>.json`）。
- ラベル形式（1試合）：
  - `video`（例 joined_match02.mp4）、`match_id`、`battle`（[開始, 終了] 秒）
  - `result` / `mode` / `stage`：`review.fix` の値、なければ `review.rmarks[項目]=='ok'` のときの検出値、どちらもなければ null（ラベルなし）
  - `own.ka` / `own.deaths` / `own.specials`：同上
  - `count_final`：`review.fix.count`、なければ null
  - `events.{death,kill,special}`：`times`＝検出のうち `review.marks["種類@秒"]=='ok'` のもの＋`review.added` の追加分（wrong/deleted は除外）、`unreviewed`＝マークのない検出、`status`＝complete（全件確認）/ partial（一部確認）/ none（未確認）。検出時刻は death=own_deaths.start、kill=own_kills.start、special=special.ready
  - `tower_holder`：`review.tower_holder`（[開始, 終了, own|enemy|neutral] の区間リスト）。**現在の確認モードには入力 UI がないため常に null**
  - `count_series`：`review.count_series`（[秒, 味方, 相手]）。同じく入力 UI なし
- 照合：イベントは許容幅 ±2.0 秒（`--tol`）で時刻順に1対1対応を取り、TP/FP/FN から適合率・再現率を出す。partial のときは未確認の時刻の近くの検出は数えない。勝敗などの単一値は一致/不一致。ヤグラ保持は試合中の整数秒ごとに最も近い系列サンプル（0.7秒以内）と比べ、味方/相手それぞれの適合率・再現率を出す。カウント系列は秒単位の完全一致率。null の項目と、ラベルのない試合は「ラベルなし」と表示する。
- 現状のラベルは feedback_sample.zip（試合2のみ、デス・スペシャルは一部未確認）だけ。試合1・3はラベルなし。

## D21 (2026-10-17) ヤグラ保持ラベルの入力 UI（D20 への追記）
- 本ブランチは D20（review.tower_holder / review.count_series、PR #28）への追記・補足を定める。
- review.tower_holder には、ユーザーがポップオーバーで明示的に確認・設定した区間のみを `[start, end, own|enemy|neutral]`（昇順ソート、隣接する同値区間は結合）として書き出す。未確認区間は含めず除外（隙間）とし、eval_labels.py 等の評価ツール側でも区間に覆われない秒は採点対象外（スキップ）とする。確認済み区間が1つも存在しない場合は tower_holder は未設定（undefined/null、未ラベル扱い）とする。
- カウント系列（review.count_series）の記録点は、動画の同期ずれに依存せず再現できるよう、該当区間の開始時刻（秒、0.1秒丸め）に記録する。
- ポップオーバーには確認済み区間を未確認状態に戻す「未確認に戻す」ボタンを設け、押下時は内部の確認状態（review.tower_seg）から該当区間を削除し、タイムラインの確認マーカーを除去して tower_holder を再生成する。
- review.tower_seg は検出された区間の開始時刻（秒、0.1秒丸め）をキーとして own|enemy|neutral を保持する内部管理用とし、ここから 0.1 秒丸めの tower_holder を再構築する。評価ツール側は tower_seg ではなく tower_holder / count_series を参照する。

## D22 (2026-10-17) 録画廃止と静止画P0（#31第1段階）
- MediaRecorder による映像録画をやめ、映像は保存しない（rec.video={kind:'none'}）。確認用に要所の静止画だけを IndexedDB の snaps に保存する（1試合あたり上限48枚、rec.stills={count,bytes}）。既存の videos データは自動削除しない。
- 静止画P0: リザルト、キル・デス、スペシャル（ゲージが0.2以下→0.2超になった立ち上がり時点）、試合中サンプル（20/90/180秒）。キル/デス/スペシャルは同種5秒未満の重複を撮らない（信号のちらつき対策。実測で試合2の静止画が39枚→23枚）。リザルト系は上限48枚に優先枠（+8枚まで）を持つ。検出結果には影響させない。
- worker は試合中、直近6秒・2fpsのJPEGリングバッファをメモリのみで保持し、試合終了（onMatch/flush）で破棄する。キル/デスは発生時刻に最も近いバッファ画像を使う。
- 代償: 任意時刻の巻き戻し確認はできない。見逃し追加の前後は最も近い静止画で代用し、新規の静止画抽出は手動で録画ファイルを選んだ場合のみ。スペシャルの静止画は発動時ではなくゲージ満タンの立ち上がり時点。

## D23 (2026-10-17) 静止画の件数ベース保持（#32第1段階）
- 依存: PR#39（録画廃止・静止画P0, D22）。
- お気に入り（favorite===true）を除く、静止画が実際にある直近30試合ぶんの静止画だけを保持する。それより古い試合は試合単位で静止画Blob（snaps）のみ削除する。お気に入りは件数に数えず、自動では絶対に消さない。
- 試合ログ・正解データ（review）・stills メタデータ {count,bytes} は削除後も保持する。傾向分析などの集計は静止画が消えた試合も含める。
- rec.stillsState: 'kept'（保持中）/ 'deleted'（削除済み）/ 'none'（未保存）。既存レコードはフィールド無しを許容し、表示では stills.count から推定する。
- 手動操作: 試合一覧の「…」メニューに「静止画だけ消す」（確認ダイアログあり）。試合ごとの削除は従来どおり。
- 自動実行のタイミング: 試合保存後（saveMatch で静止画保存のあと enforceRetention(30)。失敗しても試合保存は壊さない）。import 後は実行しない。
- 容量ベースの整理・警告は第2段階で、今回は未実施。
- UI（お気に入りボタン・静止画状態表示）は最小の仮置きで、Designer 確定後に寄せる。

## D24 (2026-10-17) 正解データの蓄積とバッチ書き出し（#33、技術設計v2 §3.4）
- 依存: #32（D23）。即ダウンロードをやめ、試合一覧のダイアログでまとめて1つのZIPに書き出す（手動のみ、自動送信なし）。
- 蓄積と状態: 正解データ本体は従来どおり各試合の review。試合ごとに review.export={state,lastExportedAt,lastExportedHash,lastBatchId} を持つ。表示上の状態は常に現在のhashから再計算する（unreviewed=確認内容なし／accumulated=確認済み・未書き出し／exported=現在のhashが lastExportedHash と一致／changed=不一致）。確認保存（save）の直前に syncExportState で review.reviewHash と state を更新するので、書き出し後の再編集は「再編集」に遷移する。
- reviewHash: review から tower_seg・export・updated（と reviewHash 自身）を除いた内容を、キーを再帰ソートして安定stringifyし、cyrb53（同期・非暗号）で16進化した値。確認内容が変わらない限り不変（保存時刻の更新では変わらない）。
- 差分は試合単位: 対象試合は review 全体と関連静止画を含める。差分=accumulated/changed の試合、全件=確認内容のある全試合（書き出し済みも含む）。未確認（確認内容なし）の試合は対象外。
- ファイル名: `ink-graph_正解データ_YYYYMMDD-HHMM_追加分.zip`／`..._全件.zip`（ローカル時刻）。バッチID: `fb-YYYYMMDD-HHMMSS-ランダム4桁`。
- format 2 の追加項目: batchId, exportMode, appBuild（暫定で 'dev'）, includes={videos:false,snaps:true}、各試合に reviewHash / reviewUpdated / stillsAvailable。review は tower_seg を含めない。ZIP には README.txt（含まれるもの・含まれないもの・プレイヤー名の注意・自動送信しない）を同梱。スナップの sha256・priority 等の任意項目は今回未実施。
- 50MB超: 静止画Blobの合計＋JSON長で見積もり、ダイアログで警告し「試合のチェックを外して分割」を案内する（自動分割はしない。チェック状態で再計算）。
- 静止画が削除済み／未保存の試合は JSON のみで書き出し（snapshots は空配列、stillsAvailable=false）。ダイアログに「静止画なし（削除済み／未保存）」と明示。
- 「書き出し済みにしない」: ブラウザーは保存の成否を知れないため、チェックを入れると書き出しても状態を更新しない（履歴は残る）。全件の再書き出しでいつでも出し直せる。
- 書き出し履歴: localStorage 'inkgraph.feedbackHistory' に {at,batchId,count,filename,mode} を最大20件。設定画面での表示は未実装。
- 試合詳細の「正解データの書き出し」は一覧へ遷移するだけ（未書き出しなら差分ダイアログを自動表示）。旧 `inkgraph_feedback_*.zip`（format 1）は出さなくなった。互換確認: 生成した format 2 の追加分zipを `tools/ingest_feedback.py`（--applyなし）で実際に取り込み、2試合の判定集計と正解ラベル出力が従来どおり動くことを確認した（ingest は format 値を参照せず feedback.json の中身で処理するため互換）。
- Designer 確認事項: ダイアログ・一覧の「未書き出しの正解データ」バー・状態ラベルの配置と文言、確認モードのヘッダーへのボタン追加、設定画面の履歴表示。いずれも仮置きのUI。
- Designer必須修正（PR #121）:
  - 試合一覧バー: 左ライム点（span.fb-bar-dot）・試合数強調（.fb-bar-count）・右端に主ボタン「正解データを書き出す」(#fbbar)。0件時はボタンなし淡色文言（.fb-bar-empty-text）で高さ維持。右上ドロップダウンは「試合ログ ▾」（中身は「試合ログ（JSON）」のみ）とし #fb を廃止してバーに一本化。
  - 行・ダイアログの状態ラベル: 固定幅90pxピル型（accumulated=accent-soft, changed=enemy-soft, exported=surface-2, unreviewed=transparent）。
  - ダイアログ: 否定形チェックを廃止し既定オンの肯定形「書き出し済みにする（次回は差分に出ません）」(#fbd-mark, オフ時直下に #fbd-skip-note「今回は記録を残さないため、次回も差分に出ます」を表示)。50MB超時は警告枠 #fbd-warn に「合計 約<MB>MBで目安の50MBを超えています。チェックを外して分けてください。あと<N>試合外すと50MB以内です」を動的表示（ZIPボタンは無効化しない）。バッチID非表示、前回表示は「前回：MM/DD HH:MM・追加分・N試合」形式。注意文はチェック欄上に配置。
  - 詳細画面: #fbone 文言「試合一覧でまとめて書き出す →」、#fbone-state「この試合：<状態>（確認済み N件）」。
  - 履歴表示: 蓄積バー直下に折りたたみ details.fb-history で最近5件の表（日時・区分・試合数・ファイル名、ボタンなし）を表示。ダイアログの前回表示とフォーマットを統一。

## D25 (2026-10-17) バックアップ範囲の見直し（試合データ＋設定＋保持中静止画、録画videos除外）（#34）
- 依存: PR #39（録画廃止・静止画P0, D22）、PR #40（静止画件数保持, D23）、PR #121（正解データ蓄積とバッチ書き出し, D24）。
- 対象と非対象:
  - 対象: 全試合データ（IndexedDB `matches`: 検出結果、正解データ `review`、お気に入り `favorite`、静止画状態 `stillsState` など全フィールド）、アプリ設定（localStorage の `inkgraph.*` キー全件）、保持中の静止画ファイル（IndexedDB `snaps`: JPEG Blob）。
  - 非対象: 録画・動画ファイル（IndexedDB `videos` は含めない。大容量化を防ぐためバックアップ範囲から完全除外）。
- 削除済み・未保存の扱い:
  - 静止画が削除された試合（`stillsState: 'deleted'`）や未保存の試合（`stillsState: 'none'`）でも、試合ログレコードおよび正解データ（`review`）はそのままバックアップに含まれる。
  - 静止画ファイルが存在しない試合は `stills/` 内に画像ファイルが出力されず、`backup.json` の `stills` 配列にもエントリは含めない。
- 復元（インポート）の挙動:
  - 復元時、各試合の既存静止画（`snaps`）を `delSnaps` でクリアしてから、バックアップ内の静止画を `putSnap` する（削除済み・未保存の静止画状態を正しく再現）。
  - バックアップ内に静止画が1枚以上あれば `stillsState = 'kept'` に補正して保存、0枚なら記録の `stillsState`（'deleted' / 'none' / 未定義）をそのまま保持する。
  - お気に入り（`favorite`）、確認・書き出し状態（`review.export`）も完全に復元・保持される。
  - 録画ストア（`videos`）は復元処理でも一切触らない（既存の録画が IndexedDB に残っていても上書き・削除しない）。
- 互換性:
  - 旧形式JSON（`{ app: 'InkGraph', format: 1, matches: [...] }` または配列）は、`#imp` での読み込みのみ可能（後方互換）。ただし静止画・設定は含まれない旨をアラートで通知する。
  - 新形式のバックアップZIP（`inkgraph_backup_YYYYMMDD-HHMM.zip`）は旧アプリでは復元できない。
  - バックアップ書き出しはZIP形式のみとし、従来の単体JSON書き出しはバックアップZIPに一本化した。
- UI:
  - 試合一覧右上の「試合ログを読み込む」ボタンを「バックアップを読み込む」に変更（`.json, .zip` を受付）。
  - 右上ドロップダウン「試合ログ ▾」を「バックアップ ▾」に改名、項目は「バックアップを書き出す（ZIP）」1項目とし、件数・保持中静止画枚数・容量（約〜KB/MB）を併記。

## D26 (2026-10-17) 精度回帰テストのCI化（警告のみ）
- `tools/eval_ci.py` が `tools/eval_labels.py` を再利用し、`labels/*.json` と検出結果（既定はPython版 `out/1080p/`）を比べてデス／キル／スペシャル／勝敗などの適合率・再現率を出す。ラベルがない項目は従来どおり採点から外す。
- 基準値 `tools/eval_baseline.json`（現状値、全て試合2の部分ラベル由来）を下回ったら `::warning::` とStep Summaryで警告するが、ジョブは失敗させない。理由：正解ラベルがまだ試合2の部分ラベルのみで母数が小さいため。ラベルが増えたら失敗条件への移行を再検討する。
- ワークフロー `.github/workflows/eval-ci.yml` は既存ワークフローと分離し、評価に関係するパスが変わったPR／main pushと手動実行でのみ回す。結果はStep Summaryとartifact（eval-summary.md／eval-result.json）で見る。

## D27 (2026-10-17) 自己学習ループ S0-S1（特徴量保存・候補提示・端末内最小適用）（#35）
- 依存: 技術設計v2 §5（リポジトリ外 `/workspace/inkgraph-design/tech-design-v2.md` §5, A5 にあり本repo内には未配置）、PR #39（録画廃止・静止画P0, D22）、PR #40（静止画件数保持, D23）、PR #121（正解データ蓄積, D24）、PR #34（バックアップ, D25）。
- 特徴量v1定義:
  - 形式: `{ v: 1, kind, t, header: { mode, modeScore, stage, stageScore }, gray, source: 'header'|'still' }`。
  - 静止画保存時（session.saveMatch）に `learn.featureFromHeader` で特徴量を抽出して `snap.features` に付与し、非null一覧を `match.learnFeatures` に保存。
  - 静止画削除済み（`stillsState: 'deleted'`）でも `match.learnFeatures` が残るため、映像・静止画本体が削除された後もリザルトのモード・ステージ再判定と自己学習サンプルの収集が可能。
  - ブラウザ専用の `computeStillFeature` により、過去の features 欠け静止画から 32x18 輝度配列（0-255整数、box平均）を含む完全な特徴量を補完して `db.updateSnapFeatures` + `setMatchLearnFeatures` で永続化。
- 学習対象とデータ要件:
  - 対象: リザルト画面の mode / stage 判定閾値（`thr.mode`, `thr.stage`）の最適化（探索範囲 0.30〜0.80, step 0.05）。
  - 材料: 確認済みの正解データ（`review.rmarks[field] == 'ok'` の検出値、または `wrong` かつ `review.fix[field]` の修正値）のみ。未確認データは除外。
  - holdout: 試合ID単位。2試合以上ある場合は最終試合（試合IDソート最後）を holdout として評価専用に分離し、過学習を抑える。1試合以下の場合は holdout なし。
  - 材料不足: train サンプルが各項目 3件未満の場合はその項目の探索を行わず、既定値（0.50）を維持する。
- 適用とロールバック（端末内のみ）:
  - 適用範囲: 端末内 IndexedDB の新設 `learn` ストア（key 'state', stack 配列）に閉じる。全体や本体アセットには波及しない。
  - 適用前確認: 候補生成後、直った件数・新たに壊れた件数・不変件数の前後比較（train/holdout別）を表示し、ユーザーの承認（「確認して適用」）を経てのみ適用。新たに壊れた件数が >0 の場合は警告を目立たせる。
  - 最小ロールバック: `rollbackLearnPack()` により stack を pop して1つ前または未適用（なし）に戻せる。戻した直後に判定結果が既定値（0.50）に戻る。
  - 解析への反映: `Analyzer` constructor と `readHeader` で `learnThresholds` を受け取り、`worker.js` の init、`session.js` の start で active pack の閾値を渡すことで、今後の解析に端末内のみで即時反映。
- 範囲外（S2以降）:
  - 学習パックの複数版管理・baseBuild/baseAssetVersion に応じた要再検証判定・テンプレート追加・数字分類器/アイコン分類器の再学習・Grok側再現ハーネス（S3）などは将来の段階とし、本段階のスコープ外とする。



## D28 (2026-10-17) GitHub issue・一括処理の運用ルール（Naoki指示）
- issue を新規作成する前に、必ず既存 issue をタイトルとキーワードで検索し、重複がないことを確認する。確認なしに新規作成しない。
- 優先度の変更は、既存 issue のラベル変更のみで行う。優先度を付け直す目的で issue を新規作成しない。
- 同じスクリプトや一括処理を再実行するときは、作成済みの件数と番号を事前に確認し、再実行しても重複が増えない冪等なチェック（既存確認・スキップ条件）を入れる。
- 一括作成の後は、作成件数を数えて報告する。件数が想定と違えば、その場で止めて原因を確認する（続行しない）。
- 先日の `gh.py` 誤実行のようなケースも、この事前確認（既存検索・件数と番号の確認・冪等チェック）で防ぐこと。`/workspace/gh.py` は実行しない。

## D29 (2026-10-17) 自己学習S2: 学習パック版管理（#36）
- 依存: PR #124（自己学習S0-S1, D27）。
- IndexedDB `learn` ストアの state 正規化:
  - 形式: `{ key: 'state', stack: [...], versions: [...], activePackId: string|null }`。
  - 後方互換: 旧形式（`{ stack: [...] }` のみ）から読み出した場合、stack 内の pack を packId で一意化した一覧を `versions` とし、stack 末尾を `activePackId` として正規化。
  - 全消去互換: `putLearnState({ stack: [] })` 呼び出し時は、versions 未指定のため stack から導出して versions も空になり全消去となる互換性を維持。
- 版の保存と重複ID一意化:
  - `applyLearnPack(pack)`: 新規作成・適用した学習パックを `versions` 配列に永続保存し、`stack` に push。既存 `packId` と衝突した場合は `-2`, `-3`… を付与して一意化して保存。保存済み pack の status フィールドは破壊せず、active 判定は stack 末尾の `packId` で行う。
- 版の切り替え・ロールバック・未適用化:
  - 切替: `activateLearnPack(packId)` により、指定した版を `stack` に push して active を切り替え。stack 構造のため `rollbackLearnPack()`（pop）により切替前の版へ戻れる。
  - 未適用: `deactivateLearnPack()` により `stack` を空にして未適用（既定値 0.50）に戻す。保存済みの `versions` は削除せず保持される。
  - 一覧: `listLearnPacks()` により作成日時降順で版一覧を取得。
- 切替前確認 UI:
  - 学習パネルに「学習パックの版一覧」を表示（版ID、作成日時 JST、閾値、学習元試合数、状態「適用中」「保存済み」）。
  - 適用中以外の版にある「この版を使う」ボタンを押すと、即適用せず確認カードを展開。現在の閾値から対象の版への再判定比較（`compareSamples` で直った/新たに壊れた/不変）を表示し、「確認して切り替える」「やめる」。新たに壊れた件数が >0 の場合は警告を目立たせる。
  - 適用中はヘッダーに「未適用に戻す」ボタンと従来の「学習を1つ前に戻す」ボタンを表示。
- 端末内限定と範囲外（S3以降）:
  - 学習パックの全データ・版情報は端末内 IndexedDB にのみ保存され、外部送信されない。
  - Grok 側再現ハーネス（S3）は次段階（次PR）とし、本段階のスコープ外とする。

## D30 (2026-10-17) 静止画の容量ベース管理（250MB上限・段階表示・自動削除）（#32）
- 依存: PR #39（録画廃止・静止画P0, D22）、PR #40（静止画件数保持30件, D23）、技術設計v2 §2.4。
- 容量上限と閾値:
  - 上限（`CAP_BYTES`）は静止画合計 250MB（`250 * 1024 * 1024` bytes）。
  - 警告閾値: 80%（`WARN_RATIO = 0.80`）。アプリ上部に1行の黄色警告バナー（`.capacity-banner`）を表示＋「古い試合を書き出して消す」ボタン（`.capacity-cleanup-btn`）。
  - 開始ブロック閾値: 95%（`BLOCK_RATIO = 0.95`）。ライブ解析開始ボタン（`#start`）を無効化し、理由と対処（`.capacity-block-reason`）を表示。ボタン押下時にも再検証ガードを配置。
  - 自動削除目標: 90%（`TARGET_RATIO = 0.90`）。上限超過時（`usedBytes > cap`）に、お気に入りを除く古い試合の静止画を削除し、90%以下までまとめて戻す（頻繁な小刻み削除を防止）。
- UI表示:
  - 容量は MB ではなく「あと約◯試合分」で表示（`使用量◯%（あと約◯試合分）`）。試合一覧ヘッダーおよびライブ画面に常時表示（`.capacity-status`）。MB表示はUIに出さない。
  - 1試合あたりの平均静止画サイズは保持中の実績平均を用い、保持0件時は既定値 5MB（`DEFAULT_PER_MATCH_BYTES`）で推計。
- クリーンアップ仕様:
  - 削除はお気に入り（`favorite === true`）以外の古い試合から試合単位で実行。試合レコード・勝敗・正解データ・静止画メタデータは維持し、`stillsState: 'deleted'` に更新。
  - お気に入りのみで上限を超過している場合（`favOnlyOver`）、自動削除は行わずユーザー判断に委ねる（`removedIds: []`）。
  - 静止画バイト数の計算は `match.stills.bytes` を優先し、未定義・異常値時は Blob サイズ合計にフォールバック（テスト時のシミュレーションを容易化）。
  - テスト用オーバーライド: `window.__INKGRAPH_CAP_BYTES__` または localStorage `inkgraph.testCapBytes` により、250MBの実データを作らずに容量テスト可能。
- Designer確認事項:
  - バナーの「古い試合を書き出して消す」ボタンは、本PRでは誤削除を防ぐため確認ダイアログ（先にバックアップ／正解データを書き出すよう案内）を経てクリーンアップを実行する仕様とした。自動書き出し＋削除の一括フローは将来検討。
- Designer必須修正（PR #126）:
  - バナーボタン文言: 「古い試合の静止画を整理する」（`.capacity-cleanup-btn`）。
  - クリーンアップ確認ダイアログ: `window.confirm` を廃止し、独自ダイアログ（`.capacity-dialog-overlay` / `.capacity-dialog`）を導入。手動整理目標75%（`MANUAL_TARGET_RATIO = 0.75`）で事前計算した対象試合数（「対象：古い順の◯試合（お気に入りを除く）」`.capacity-dialog-target`）、注意書き（静止画のみ削除され記録・正解データは残ること、消した静止画は戻せないこと）、ショートカットボタン（「バックアップを書き出す」「正解データを書き出す」）、赤系の実行ボタン（「静止画だけを消す（記録は残ります）」`.capacity-dialog-execute`）を表示。実行後はダイアログ内で結果「◯試合分の静止画を消しました。使用量は◯%です」（`.capacity-cleanup-result`）を表示し、閉じるボタンで画面更新。
  - 自動削除目標90% vs 手動削除目標75%: 保存後の自動クリーンアップ（`session.js` / `db.enforceCapacity` 既定）は90%を維持し、ユーザーによる手動整理ダイアログは75%まで戻して次回警告までの余裕を確保。
  - お気に入り単独超過バナー: `favBytes > capBytes` 時は文言を「お気に入りの試合だけで容量がいっぱいです。試合一覧でお気に入りを外すか、手動で静止画を消してください」（`.capacity-banner--favonly`）に変更し、一括整理ボタンは非表示。
  - 警告色トークン（`--warn`）: ダーク `--warn: #FACC15`, `--warn-soft: rgba(250,204,21,.12)`, `--warn-border: rgba(250,204,21,.45)`。ライト `--warn: #854D0E`, `--warn-soft: #FEF9C3`, `--warn-border: rgba(133,77,14,.45)`。バナー文字色・アイコン色に `--warn` を適用、ボタン枠線も `--warn`。
  - 重複ステータス非表示: バナー表示中（warn/block、またはお気に入り超過時）はヘッダーの `.capacity-status` を非表示化。ok時のみ `.capacity-status` を表示。
  - 95%ブロック理由・無効化スタイル: `.capacity-block-reason` を `.live-source-actions` の外（直後）に配置し全幅表示（アイコン接頭辞 `⚠ `、動的文言「使用量◯%で、解析を始められる上限（95%）を超えています。古い試合の静止画を消すと始められます」）。`#start:disabled` は背景 `var(--surface-2)`、文字色 `var(--text-faint)`、枠線 `1px solid var(--border)`、`cursor: not-allowed`（opacity廃止）。
- 備考: PR #125 など先行PRとD番号が競合する場合はマージ時に番号を振り直す。

## D31 (2026-10-17) 自己学習S3: Grok側再現ハーネス（#36）
- 決定番号の整理: PR #125 と PR #126 の両ブランチで「D29」の番号重複が生じていたため自己学習S2を「D29」、静止画容量管理を「D30」とし、本S3再現ハーネスは「D31」を使用する。
- 目的: ブラウザ端末側（Web版）で生成・適用された学習パックおよび検出器の出力を、Grok側（Python環境・標準ライブラリのみ）で完全再現・検証する独立ハーネス（`tools/repro_s3.py`）を構築（技術設計v2 §5.5, PR #125 メモ準拠）。
- 構成要素と責務:
  - 検出器再現: 各試合の検出結果（`timeline.json`）をロード、または `--run-detector` で `src/analyze.py` を実走して生成。
  - 参照比較: ブラウザ実行結果（`--reference web:PATH` または plain timeline JSON）と `pred` を許容誤差 `--tol`（既定 2.0s）内で突合。イベント（デス/キル/スペシャル）およびリザルト画面（勝敗/ルール/ステージ/自キル・デス・スペシャル）の一致・差分を抽出。未指定時は `reference=null`（理由:「参照（ブラウザ実行結果）が未指定」）。
  - 精度評価: 正解ラベル（フィードバックZIPまたはラベルDIR）が与えられた場合、`eval_labels.py` / `eval_ci.py` 互換で評価指標（TP/FP/FN/適合率/再現率）を集計。
  - パック再判定: `web/src/learn.js` の `compareSamples` / `predict` / `collectSamples` ロジックをPythonに完全移植。`--pack` の閾値（`--thresholds` による上書き可能）をサンプル群に適用し、`beforeCorrect`, `afterCorrect`, `fixed`, `broken`, `unchanged` を再計算。
  - 合否判定（Verdict）:
    - 特徴量バージョン不一致（pack `featureVersion` vs sample `v`）は「再現不可」。
    - `--expected`（端末レポート）指定時: `afterCorrect`, `fixed`, `broken`, `n` を完全突合し「一致」または「再現不可（不一致項目を列挙）」。
    - `--expected` 未指定時: 「自己完結（端末レポート未指定）」。
- 出力と終了コード:
  - `<out-dir>/report.json` および `<out-dir>/report.md`（日本語テーブル）を出力し、標準出力に要約を表示。
  - 差分があっても終了コード 0（CIや自動化で差分調査可能）、引数・ファイル不足等の入力エラー時のみ終了コード 2。

## D32 (2026-10-17) GitHub Pages配信（U1）
- 決定：ブラウザ版（`web/`）を現行リポジトリの GitHub Pages（https://qnaiv.github.io/inkgraph2/ ）で配信する。
- 方式：`.github/workflows/pages.yml` による GitHub Actions ベースの `web/dist` デプロイ。Vite の base はすでに相対パス `'./'` に設定済みで、アセット取得も `document.baseURI` 基準のため `/inkgraph2/` サブパス配下でも安全に動作する。
- デプロイ制御：`main` ブランチへの push（マージ時）のみ本番 Pages へアーティファクトをアップロード・デプロイする。PR や機能ブランチからの `workflow_dispatch` 実行時はビルド検証のみを行い、本番 Pages は上書きしない。
- リポジトリ設定：GitHub Pages の Source を "GitHub Actions" へ切り替える設定はリポジトリ管理者の Naoki / Bobo が手動で実施する（コード・PRでは設定不可）。
- 関連issue：なし（既存 issue を Pages / ホスティング / デプロイ で検索し該当 0 件を確認）。

## D33 (2026-10-17) スペシャル状態分離（使用可能区間 vs 発動瞬間）
- 課題: スペシャル使用可能区間中ずっと「スペシャル発動」ラインが描画され、区間（ready->end）と実際の発動瞬間が混同されていた。Designer仕様に基づき、区間（使用可能）と発動瞬間（ゲージ消費による区間終了）を明確に分離。
- データモデル:
  - `special` 各要素に `activated_at` を追加（outcome が `'activated'` のときは `r1(b)`、`'lost_on_death'` や `'unused_at_end'` のときは `null`）。
  - `web/src/core/analyzer.js` および `src/inkgraph/detect.py` の両方で出力。既存の `ready`, `end`, `outcome` との後方互換性は維持。
  - `eval_labels.py` は変更しない（ラベル照合点としての互換性を維持）。
- イベントとキーの後方互換:
  - `analysis.js` の `detected()` は `outcome === 'activated'` の要素のみをイベント化し、時刻 `t` は `activated_at ?? end` とする。
  - レビューマークの照合キーは後方互換維持のため `key('special', e.ready)` を維持し、既存のレビュー済みデータ（`review.marks`）を破壊しない。
- ライブ解析の即時範囲:
  - ライブ解析の即時表示は「スペシャル使用可能」（`#live-sp-ready`）までにとどめ、発動の確定は試合終了後のレコード生成時に行う（デス時は即座に非表示）。
- UI・タイムライン描画:
  - 自分レーンの帯: `specialIntervals` 全件を描画（fill: `--special-soft`, 上端ライン, 開始点circle）。デスで失った場合は終端を斜め切り、終了時未使用は末尾に 8px四角（`▯`）。
  - 発動: 有効な発動のみに縦ライン（`width 2`）＋上端ひし形（`◆`）。
  - 未使用デス: デス×の右上に下向き三角（`▼`）および詳細出来事表で「スペシャル未使用」バッジを表示。
  - 詳細ヘッダー、一覧、ライブ、傾向画面での単独「スペシャル」表記を廃止し、「スペシャル発動」「スペシャル使用可能」等の複合語に統一。
- 代償と制約:
  - 発動時刻はスペシャルゲージ消費時点（ゲージの減少検知）の近似値であり、実際の入力瞬間に対して約±0.2秒（フレームレート誤差）のずれが生じる。