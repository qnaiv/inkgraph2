# 精度回帰テスト (Eval CI)

## 目的
PR #28 で実装された `tools/eval_labels.py` を再利用し、正解ラベル (`labels/*.json`) と検出器の出力結果を比較して、K/D/SP・勝敗等の精度を GitHub Actions CI で自動検証する仕組みです。

- ラベルが無い項目は採点から除外する仕様 (eval_labels の「ラベルなし」行) を維持します。
- 基準値 (`tools/eval_baseline.json`) を下回った場合は警告 (`::warning::`) を出力しますが、CIジョブは失敗させず常に exit 0 で終了します。

---

## 手元実行コマンド

### 1. 単体テスト実行
```bash
python3 tools/test_eval_ci.py
```

### 2. 通常評価 (Python検出結果)
```bash
python3 tools/eval_ci.py --labels-dir labels --pred python --md eval-summary.md --json eval-result.json
```
- stdout に Markdown 表と警告メッセージが出力されます。
- `--md` で Markdown 形式のサマリを出力します。
- `--json` で各試合および合計メトリクスの詳細結果を出力します。

### 3. ベースラインの更新 (`--update-baseline`)
現状の評価結果を `tools/eval_baseline.json` に書き出します (比較は行われません)。
```bash
python3 tools/eval_ci.py --labels-dir labels --pred python --update-baseline
```

### 4. Webアプリ検出結果の評価例
Webアプリの検証用JSON（試合の配列）を指定して評価する場合:
```bash
python3 tools/eval_ci.py --labels-dir labels --pred web:out/web_results.json
```

---

## Baseline (基準値) の意味

- **対象項目**: 注目項目である「デス」「キル」「スペシャル」「勝敗」の precision / recall を記録・比較します。
- **警告条件**: 現状値が基準値を下回った場合 (`現在 < 基準 - 1e-6`)、以下のように警告を発出します:
  ```text
  ::warning::精度回帰: デス precision 0.800 < 基準 1.000
  ```
- **ジョブを失敗させない理由**:
  現在登録されている正解ラベルは試合2 (`joined_match02.json`) の部分ラベルのみです。母数が少なく、検出アルゴリズムの調整過程でスコアが変動しやすいため、開発をブロックしないよう警告のみ (`exit 0`) としています。

---

## GitHub Actions CI の動作

`.github/workflows/eval-ci.yml` により自動実行されます。

### トリガー条件
- `pull_request` および `push` (mainブランチ)
- `workflow_dispatch` (手動実行)
- **対象パス絞り込み**:
  - `tools/eval_labels.py`
  - `tools/eval_ci.py`
  - `tools/eval_baseline.json`
  - `tools/test_eval_ci.py`
  - `labels/**`
  - `out/1080p/**`
  - `.github/workflows/eval-ci.yml`

### CI 出力・成果物
1. **Job Summary**: `GITHUB_STEP_SUMMARY` に評価サマリ表と警告節がレンダリングされます。
2. **Artifact**: ジョブ終了後に `eval-result` アーティファクトとして以下が保存されます:
   - `eval-summary.md` (Markdown サマリ)
   - `eval-result.json` (JSON 詳細メトリクス)

---

## ラベル追加手順

新しい試合の正解ラベルを追加する手順:

1. **フィードバック zip の取得**:
   Webアプリのレビュー画面でアノテーションを行い、フィードバック zip をダウンロードします。
2. **正解ラベル JSON の生成**:
   `tools/eval_labels.py` の `--write-labels` オプションを使用して `labels/` に書き出します:
   ```bash
   python3 tools/eval_labels.py path/to/feedback.zip --write-labels labels/
   ```
   `labels/joined_matchXX.json` が生成されます。
3. **差分の確認**:
   ```bash
   git status
   git diff labels/
   ```
4. **Baseline 更新の要否**:
   - 新しい試合が追加されて適合率・再現率の母数が増えた場合や、検出器の改善に伴い新たな水準を基準値としたい場合は `--update-baseline` を実行して `tools/eval_baseline.json` を更新・コミットします。
   - 既存の基準値と比較した挙動を維持したい場合は、baseline の更新は不要です。

---

## 現状のサンプル評価数値 (試合2: joined_match02.mp4)

| 試合 | 項目 | TP | FP | FN | 適合率 | 再現率 | 備考 |
|---|---|---|---|---|---|---|---|
| joined_match02.mp4 | デス | 4 | 0 | 0 | 1.000 | 1.000 | ラベル一部（未確認2件は除外） |
| joined_match02.mp4 | キル | 1 | 0 | 0 | 1.000 | 1.000 |  |
| joined_match02.mp4 | スペシャル | 2 | 0 | 0 | 1.000 | 1.000 | ラベル一部（未確認2件は除外） |
| joined_match02.mp4 | 勝敗 | 1 | 0 | 0 | 1.000 | 1.000 |  |
| joined_match02.mp4 | ルール | 1 | 0 | 0 | 1.000 | 1.000 |  |
| joined_match02.mp4 | ステージ | 1 | 0 | 0 | 1.000 | 1.000 |  |
| joined_match02.mp4 | キル+アシスト | 1 | 0 | 0 | 1.000 | 1.000 |  |
| joined_match02.mp4 | デス数 | 1 | 0 | 0 | 1.000 | 1.000 |  |
| joined_match02.mp4 | スペシャル数 | 1 | 0 | 0 | 1.000 | 1.000 |  |
| joined_match02.mp4 | 最終カウント | - | - | - | - | - | ラベルなし |
| joined_match02.mp4 | ヤグラ保持(味方) | - | - | - | - | - | ラベルなし |
| joined_match02.mp4 | ヤグラ保持(相手) | - | - | - | - | - | ラベルなし |
| joined_match02.mp4 | カウント系列 | - | - | - | - | - | ラベルなし |
| 合計 | デス | 4 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | キル | 1 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | スペシャル | 2 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | 勝敗 | 1 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | ルール | 1 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | ステージ | 1 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | キル+アシスト | 1 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | デス数 | 1 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | スペシャル数 | 1 | 0 | 0 | 1.000 | 1.000 | 1試合 |
| 合計 | 最終カウント | - | - | - | - | - | ラベルなし |
| 合計 | ヤグラ保持(味方) | - | - | - | - | - | ラベルなし |
| 合計 | ヤグラ保持(相手) | - | - | - | - | - | ラベルなし |
| 合計 | カウント系列 | - | - | - | - | - | ラベルなし |
