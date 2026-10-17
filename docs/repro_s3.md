# 自己学習S3: Grok側再現ハーネス仕様・利用手順書

## 1. 目的（Purpose）

PR #125 メモ「自己学習ループの第三者再現性保証」に基づき、ブラウザ端末（Web版）内で完結していた自己学習（S0〜S2）の学習結果（閾値パック）および検出器の出力を、Grok側（Python環境・標準ライブラリのみ）で機械的に追試・再現・検証するための再現ハーネス（`tools/repro_s3.py`）を提供します。

- **Web版ロジックの完全追従**: `web/src/learn.js` の判定アルゴリズム（`predict`、`compareSamples`、`collectSamples`）を Python 側に忠実に移植。
- **第三者検証性**: ブラウザ環境がなくても、端末からエクスポートされた学習パックやログを入力として、同じ改善（fixed）・改悪（broken）・正解件数が得られるかを検証可能。
- **検出器・ラベル評価との統合**: 既存の `tools/eval_labels.py` / `tools/eval_ci.py` と連携し、検出器出力の差分突合や正解ラベルに対する精度集計を1つのレポートに統合。

---

## 2. 入力と出力（Inputs & Outputs）

### 入力

| 引数 | 型 / 形式 | 説明 |
|---|---|---|
| `--videos` | 文字列（カンマ区切り） | 対象試合の動画名（例: `joined_match01.mp4,joined_match02.mp4`）。省略時はラベルまたは既定の3試合 |
| `--run-detector` | フラグ | 評価前に `python3 src/analyze.py VIDEO -o <out-dir>/detected/matchNN` を実走し、その出力を予測として使用 |
| `--pred` | 文字列（既定: `python`） | 予測データの指定。<br>・`python`: `out/1080p/matchNN/timeline.json`<br>・`web:PATH`: Web版エクスポートファイル<br>・ファイルパス: timeline.json 直接指定 |
| `--reference` | 文字列（省略可） | 参照データ（ブラウザ実行結果等）。`python`、`web:PATH`、または timeline.json のパス。未指定時は `reference=null`（理由:「参照（ブラウザ実行結果）が未指定」） |
| `--labels` | ファイルパス（複数可） | 正解ラベルの feedback zip または label json ファイル |
| `--labels-dir` | ディレクトリパス | 正解ラベル json が格納されたディレクトリ（例: `labels/`） |
| `--samples` | ファイルパス | サンプルJSON。以下の3形式に対応:<br>1. サンプル配列 `[{matchId, field, detected, score, truth}]`<br>2. `{"samples": [...]}`<br>3. 試合オブジェクト配列 `[{id, review, result_screen, learnFeatures}]` |
| `--pack` | ファイルパス | 学習パックJSON `{packId, thresholds, featureVersion, metrics}` |
| `--thresholds` | 文字列 | 閾値上書き（例: `mode=0.4,stage=0.6`） |
| `--expected` | ファイルパス | 端末側レポートJSON（前回の report.json または metrics）。`afterCorrect`, `fixed`, `broken`, `n` を突合 |
| `--out-dir` | ディレクトリ（既定: `out/repro`） | レポートの出力先ディレクトリ |
| `--tol` | 浮動小数点（既定: `2.0`） | イベント（デス/キル/スペシャル）突き合わせの許容秒数 |

### 出力

- **`<out-dir>/report.json`**:
  - `generated_at`: ISO 8601 タイムスタンプ
  - `videos`: 対象動画リスト
  - `detector`: 試合ごとの予測ソース・参照ソース・差分（`identical`, `fields`, `events`）
  - `eval`: 正解ラベル評価（試合別・合計の TP/FP/FN/適合率/再現率）
  - `pack`: パックID・特徴量バージョン・実効閾値・再判定メトリクス・合否判定（`verdict`）と理由
- **`<out-dir>/report.md`**:
  - 日本語Markdownテーブル（試合ごとの一致/差分、評価数値、パック再判定と合否判定）
- **標準出力**:
  - 実行要約（検出器の一致状況、精度集計、パック再判定メトリクス、合否判定）

---

## 3. 使い方（Usage）

### 基本的な実行

```bash
# 既存のPython版検出結果とラベルによる評価
python3 tools/repro_s3.py --videos joined_match02.mp4 --pred python --labels-dir labels --out-dir out/repro
```

### ブラウザ実行結果との突合（--reference web:PATH）

Web版アプリのログ出力・エクスポート結果を `--reference` に渡すことで、Python版検出器とWeb版検出器の挙動差分（イベント発生時刻のズレ、リザルト項目の認識差分）を抽出します。

```bash
python3 tools/repro_s3.py \
  --videos joined_match02.mp4 \
  --pred python \
  --reference web:exported_web_timeline.json \
  --out-dir out/repro
```

> **Note**: ブラウザ側の実行結果は、Web版のログエクスポート機能から書き出した timeline JSON を `web:PATH` または直接ファイルパスとして渡します。

### 生動画と `--run-detector` に関する重要な注意

- リポジトリ内には容量制限のため生動画（`joined_match01.mp4`〜`03`）はコミットされていません。
- `--run-detector` を指定した場合、ローカルに存在する動画ファイルに対して `src/analyze.py`（OpenCV解析）を実際に実行します。
- **実行時間の注意**: 動画解析はCPUリソースを消費し数分単位の時間がかかるため、通常はすでに解析済みの `out/1080p/` の結果を利用するか、必要時のみ `--run-detector` を指定してください。

```bash
# 生動画が存在する場合のみ
python3 tools/repro_s3.py --videos /path/to/joined_match01.mp4 --run-detector --out-dir out/repro
```

### 学習パックの再判定と期待値検証（--pack + --expected）

端末側で生成された学習パックとサンプルを与えて、Grok側で再計算・突合します。

```bash
python3 tools/repro_s3.py \
  --samples out/samples.json \
  --pack out/learn_pack.json \
  --expected out/device_report.json \
  --out-dir out/repro
```

### 閾値の動的上書き検証（--thresholds）

パック内の閾値とは異なる閾値で試行したい場合、`--thresholds` で任意に上書きできます。

```bash
python3 tools/repro_s3.py \
  --samples out/samples.json \
  --pack out/learn_pack.json \
  --thresholds mode=0.35,stage=0.65 \
  --out-dir out/repro
```

---

## 4. 合否判定基準（Pass Criteria）

### 検出器差分判定
- **一致（identical=True）**:
  - デス、キル、スペシャルのイベント時刻が許容誤差 `--tol`（既定 2.0秒）以内で全て1対1対応すること（`only_pred` / `only_ref` が空）。
  - リザルト画面項目（`result`, `mode`, `stage`, `own.ka`, `own.deaths`, `own.specials`）が全て完全一致すること。
- **参照未指定**:
  - `--reference` が指定されていない場合は、判定保留として `reference=null`、理由「参照（ブラウザ実行結果）が未指定」を出力。

### 学習パック判定（Verdict）
1. **特徴量バージョン不一致**:
   - パックの `featureVersion` とサンプルの `v` が一致しない場合、無条件で `verdict: "再現不可"`（理由:「特徴量バージョン不一致」）。
2. **`--expected` 指定時**:
   - 再計算された `afterCorrect`、`fixed`、`broken`、`n` が期待値レポートと完全一致する場合: `verdict: "一致"`。
   - 1項目でも差異がある場合: `verdict: "再現不可"`（不一致項目と差異内容を列挙）。
3. **`--expected` 未指定時**:
   - バージョン不一致がなければ、`verdict: "自己完結（端末レポート未指定）"`（自立検証完了）。

### 終了コード仕様
- **終了コード 0**: 正常完了。検出器差分やパックの判定が「再現不可」であっても、検証プロセス自体が正常に完了した場合はレポートを出力して 0 で終了します。
- **終了コード 2**: 入力エラー。指定されたファイルが存在しない、不正な引数形式など入力に不備がある場合はエラーメッセージを表示して 2 で終了します。
