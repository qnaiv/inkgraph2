# 進み具合メモ（中断しても続きがわかるように）

最終更新：2026-10-24 JST（feat/live-provisional ブランチ）

## 順番（ユーザー側の指示）
1. #146 / #147 のマージ — 済み（#146 ad48a7d、#147 3055247）
2. #17 敵アイコン研究 — PR #148（マージしない）
3. 「速報」→「確定」表示 — この PR（D49）
4. リアルタイムのスペシャル発動表示 — 未着手（ライブで special イベントを出す必要あり。D49「既知の点」参照）
5. Web版でデスが1件抜ける不具合 — 調査中（branch fix/web-death-miss。joined_match02 の 68.0 秒付近。JS の hud_hidden 区間が 64.6–69.2 と Python の 64.6–67.8 より長く、デス信号 68.0–69.8 を飲み込んでいる疑い）
6. Xパワーの読み取り（#133） — 未着手
7. 検証ツールの vite preview をプロセスグループごと止める小さな修正 — 未着手（3 の後）

## 既存チェックを最新 main で回すときの注意
- 各チェックは `npx vite preview --strictPort` を立てるが、`srv.kill()` は npx だけを止め、子の node が残る。次のチェックが同じポートで古いビルドを見て失敗する（前回の 4 件失敗の原因）。チェックごとに `pkill -f "vite preview"` で止めてから回す。
- no_video / tower_label / ui は `web/test-results/web_matches.json` が前提。先に `node tools/validate.mjs`（raw/1080p の 3 本）を回す。
- clip_check は動画の引数が要る：`node tools/clip_check.mjs <動画.mp4>`。
