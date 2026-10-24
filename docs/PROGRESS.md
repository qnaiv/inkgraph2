# 進み具合メモ（中断しても続きがわかるように）

最終更新：2026-10-25 JST（feat/live-special ブランチ）

## 順番（ユーザー側の指示）
1. #146 / #147 のマージ — 済み（#146 ad48a7d、#147 3055247）
2. #17 敵アイコン研究 — PR #148（ユーザー側の指示でマージ済み b24c566）
3. 「速報」→「確定」表示 — PR #149（ユーザー側の指示でマージ済み e24c774）
4. リアルタイムのスペシャル発動表示 — PR #151（D51、実映像 12 本でライブ＝確定 12/12）
5. Web版でデスが1件抜ける不具合 — 調査中（branch fix/web-death-miss。joined_match02 の 68.0 秒付近。JS の hud_hidden 区間が 64.6–69.2 と Python の 64.6–67.8 より長く、デス信号 68.0–69.8 を飲み込んでいる疑い）
6. Xパワーの読み取り（#133） — 未着手
7. 検証ツールの vite preview をプロセスグループごと止める小さな修正 — PR #150（ユーザー側の指示でマージ済み 5a68df3）

## 既存チェックを最新 main で回すときの注意
- 以前は `srv.kill()` が npx だけを止め、子の vite が残って次のチェックが古いビルドを見て失敗していた（前回の 4 件失敗の原因）。D50（#150）で全チェックが `tools/lib/preview_server.mjs` の startPreview を使い、プロセスグループごと止めるようにした。#150 より前の main では、チェックごとに `pkill -f "vite preview"` を挟む。
- no_video / tower_label / ui は `web/test-results/web_matches.json` が前提。先に `node tools/validate.mjs`（raw/1080p の 3 本）を回す。
- clip_check は動画の引数が要る：`node tools/clip_check.mjs <動画.mp4>`。
