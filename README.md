# InkGraph

スプラトゥーン3の録画（キャプチャ映像）を解析して、自分の成績と試合展開を可視化するツールです。

- **Phase 1**：リザルト画面から勝敗・ルール・ステージ・キル+アシスト・デス・スペシャル回数を読み取る
- **Phase 2**：試合中のHUDからタイムライン（自分のキル/デス/スペシャル、人数差、ヤグラのカウントと勝率推移）を作る
- 将来：ブラウザ版を予定

背景・精度・今後の方針は [docs/CONTEXT.md](docs/CONTEXT.md)、意思決定の記録は [docs/DECISIONS.md](docs/DECISIONS.md)、作業ログは [PROGRESS.md](PROGRESS.md)。

## セットアップ（Windows）

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

ffmpeg / ffprobe に PATH が通っている必要があります（分割・結合で使用）。

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
