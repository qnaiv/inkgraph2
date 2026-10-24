# 進み具合メモ（中断しても続きがわかるように）

最終更新：2026-10-25 JST（fix/web-death-miss ブランチ）

## 順番（ユーザー側の指示）
1. #146 / #147 のマージ — 済み（#146 ad48a7d、#147 3055247）
2. #17 敵アイコン研究 — PR #148（ユーザー側の指示でマージ済み b24c566）
3. 「速報」→「確定」表示 — PR #149（ユーザー側の指示でマージ済み e24c774）
4. リアルタイムのスペシャル発動表示 — PR #151（D51、レビュー待ち・未マージ）
5. Web版でデスが1件抜ける不具合 — この PR #152（D52、branch fix/web-death-miss）。原因は Chrome のシークのフレームが ffmpeg より約1フレーム後ろで、マップの合間の短い「やられた」信号が medfilt で消えること。deathSignal でマップ区間を前後の確かな信号から埋めて修正
6. Xパワーの読み取り（#133） — 未着手
7. 検証ツールの vite preview をプロセスグループごと止める小さな修正 — この PR #150（D50）

## 既存チェックを最新 main で回すときの注意
- 以前は `srv.kill()` が npx だけを止め、子の vite が残って次のチェックが古いビルドを見て失敗していた（前回の 4 件失敗の原因）。D50（#150）で全チェックが `tools/lib/preview_server.mjs` の startPreview を使い、プロセスグループごと止めるようにした。#150 より前の main では、チェックごとに `pkill -f "vite preview"` を挟む。
- no_video / tower_label / ui は `web/test-results/web_matches.json` が前提。先に `node tools/validate.mjs`（raw/1080p の 3 本）を回す。
- clip_check は動画の引数が要る：`node tools/clip_check.mjs <動画.mp4>`。
