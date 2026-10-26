# inbox

アプリの「正解データを書き出す」で作った zip（`ink-graph_正解データ_*.zip`）を、ここにアップロードします。
アップロードすると GitHub Actions（`ingest-feedback`）が自動で取り込み、**取り込み結果の PR** を作ります（zip はその PR で削除されます）。

アップロード（PC でもスマホでも）: https://github.com/qnaiv/inkgraph2/upload/main/inbox

取り込みでやること: ルール・ステージの見本の追加、`labels/feedback/` への正解ラベル、`training/` への学習用画像（WebP に軽くして保存）、Web アセットの再書き出し、精度の確認（`eval_ci`）。
