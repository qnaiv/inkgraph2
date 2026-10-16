# InkGraph proto progress
## Goal 1: HUD squid-icon classifier (done, plateau)
- Icons 32x32 crops (8 slots, 5fps). Team-hue normalized features (team-color/S/V/gray/dark 8x8 maps = 320d).
- Semi-auto labels: KMeans(12) clusters visually assigned (X-mark=dead, colored=alive, others unlabeled) -> LogisticRegression.
- HUD-present gate: timer colon template (fixes super-jump plate / map overlay false positives).
- Post: median 5, min 2.0s, merge gap 2.5s; L0 = own-death signal runs (D-pad 'やられた' label) + classifier L0 runs not overlapping any signal run (m1 5/5, m2 7/7). TODO: implement in packaged src.
- Slot->player mapping via weapon icons (src/eval_truth.py).
- Result: per-player deaths exact 13/16, abs err 3 (m1 L1 -1, m1 L2 -1, m2 R3 +1). Team totals m1 L17/19 R11/11, m2 L35/35 R32/31.
- Remaining misses: deaths while own player is on respawn map (HUD hidden). Params fixed (not grid-searched) to limit overfit.
- Next: goal 2 kill notices.
## Goal 1b: respawn-map nameplates (done)
- Map view gated by X-close-button template (work/tpl_mapx.png). Teammate plates: left=L1, top=L2, right=L3; crossed = team-color line fraction>0.08 & dark>0.35.
- Adds deaths not covered (+-3s) by classifier runs. m1 L1/L2 now exact. m2 L1 now 8/7 (plate add at 530 is a real death verified by frame -> some other L1 classifier run is FP).
- Per-player abs err 2 (with L0 fusion): m2 L1 +1, m2 R3 +1. 14/16 exact.
## Goal 2: own kill notices (done, conclusion)
- Full scan at 10fps, wide region (y420-720,x200-1080), 'をたおした' text template and squid-icon template: m1 2 notices (107.5, 159.6), m2 none at all. Notice lasts 3-5s so sampling not the issue.
- Conclusion: m2 own kills = 0; result 'x05' = kills+assists -> 5 assists. m1 x02 = 2 kills. Assists are not shown on-screen -> not detectable from notices; need result-screen assist breakdown (small digits; check on 1080p).
## Goal 3: special activated vs lost (done)
- Gauge ring: orange=filling, white(+'押し込み R')=ready. Activated = ready ends while alive (ring drains to empty); lost = own death starts within 1s of ready end (after respawn ring ~50% orange, verified m2 549/595).
- Short ready (0.4s @615) = immediate use -> sp_min 0.3s. Result: m1 1/1, m2 3/4 (one activation not found; no visible full->empty transition elsewhere).
## Goal 4: autosplit (done) -> src/autosplit.py; full.mp4 -> 2 files (41-259s, 420-795s), json segments.
## Map-open handling
- map_open (X button) m1 18.8s, m2 18.8s; HUD hidden (no timer) m1 12.2s, m2 8.0s. Kill notices DO render over the map (verified 1:49 'R1nka をたおした!' over respawn map).
- Ally crossed nameplates -> recovered m1 L1@77.6, L2@113.2, m2 L1@530 (all verified correct by frame).
- Enemy panel (top-right) crosses: Hough-line detector gave many FPs/duplicates (m1 enemy 11->18) -> disabled by default.
## Goal 5: packaged (src/, models/, templates/, README, requirements, eval). Final: per-player deaths exact 12/16 (abs err 4), own deaths 12/12, specials 4/5, kill notices consistent.
## Goal 6: 1080p re-validation (2026-10-17 01-12-05 recording, 3 matches, Tower Control @ クサヤ温泉)
- Truth: result screens (out/1080p/result_truth.json). M1 LOSE 36-67, M2 WIN, M3 LOSE 62-83. Full board only for M3; M1/M2 personal screen only.
- Pipeline downsamples to 1280x720 internally -> crops/templates (colon, signal, をたおした, gauge, map X) worked unchanged on 1080p.
- Fixes: (1) own deaths = D-pad signal runs only (HUD-classifier fallback added 3 FPs/match on 1080p; fallback kept only if no signal runs; 720p eval unchanged).
  (2) pale "special ready" squid icons were classified dead -> runs rejected when median center saturation >=55 (1080p sources only; 720p icons are more saturated, gate would regress).
  (3) special still full at battle end -> outcome 'unused_at_end' (not 'activated').
- 1080p accuracy: own deaths 8/8, 6/6, 6/6 (exact 3/3). Specials activated 4/5, 3/3, 5/5. Kill notices <= K+A: 5<=8, 1<=4, 4<=4 (consistent).
  M3 per-player deaths (multiset match, slot->name not mapped): ally det 6/13/5/10 vs 6/11/5/10 (L1 +2 from map-plate adds), enemy det {7,6,4,3} vs {7,7,4,3}; team totals 34/32, 20/21. Exact 6/8, abs err 3.
- 720p eval after changes: per-player exact 12/16, abs err 4 (no regression); own deaths 12/12; specials 4/5.
- Remaining: result-board OCR not implemented (truth read manually); M1/M2 board not recorded (press to view board before skipping); map-plate adds can FP at 1080p; slot->player mapping for 1080p not automated.
## Goal 7: own result-screen reading (src/inkgraph/result.py, src/eval_results.py) — no OCR
- Celebration screen WIN!/LOSE template -> result. Results panel located by lobby-label template (handles slide-in offset);
  header mode/stage = NCC vs labeled crop library (templates/res_mode, res_stage); personal stats row (x NN) -> connected components -> digit NN classifier
  (templates/res_digits/digits.npz, 1152 samples from personal rows + scoreboards of old1/old2/m3, labels read by eye). Votes over 5-7 frames.
- Leave-one-match-out on 5 matches (old1, old2, m1-m3): result 5/5, mode 5/5, own K+A 5/5, deaths 5/5, specials 5/5, stage 3/5
  (the 2 misses are stages seen only once -> correctly returned None/unknown when their own template is excluded; in-library stages 3/3).
- Integrated into analyze (result_screen field) and timeline titles. Full scoreboard / HUD-slot linking dropped (low priority per Naoki).
## Goal 8: game context (prototype)
- Players alive (e.g. 4v3) before each own death / kill and at special ready: from squid_down runs (fields alive_before / alive_at_ready).
- Tower Control count/objective from top HUD: NOT reliable yet. Naive team-hue extents along the progress track (y86-100, x320-960) jump frame-to-frame
  because background ink/scenery shares team colors. Needs fixed dot-position sampling + tower-marker (ring) detection + 'のこり' digit reading.
  Phase (抑え/打開) tagging and win-probability model deferred until count reading works.
- Old 720p eval unchanged: per-player exact 12/16.
## Goal 9: Tower Control context (src/inkgraph/tower.py, towerviz.py)
- 'のこり NN' badges under the HUD progress track: team-hue blob -> 2 white digit glyphs -> NN classifier (templates/res_digits/tc_badge_digits.npz,
  2102 glyphs from 48 badge segments of m1-m3, labels read by eye). Remaining counts only decrease -> window vote (>=3 of 7) + cumulative min.
- Tower marker: Hough circle on track (r12-22, excluding end circles), owner = dominant team hue inside (own/enemy/neutral), 5s vote.
- Accuracy: final counts 3/3 exact (m1 36-67, m2 57-55 consistent with WIN, m3 62-83). Badge digits leave-one-segment-out: 83% per frame, 38/48 segments by vote
  (leave-one-match-out only 47%: digits 0/1/6/9 occur in a single match -> more data needed). Manual check of 9 frames: counts 15/18, owner 8/9.
  Known miss: m1 own badges 0:32-1:35 not read (glyph split fails on light-orange badge) -> own count 0 there instead of 15-20.
- Phase per event: 打開 if behind or tower enemy-held; 抑え if ahead (tower ours/neutral) or tower ours; else 互角. Tags: phase, count, count_diff on own deaths/kills/specials.
- Heuristic WP (hand-set logistic: 0.05*diff*(1..3 as time runs out) + 0.35*alive diff + 0.5*owner), per own kill/death delta (t-1s -> t+1.5s), top-3 swings.
  Rendered to out/1080p/matchNN/tower.png (timeline.png renderer is maintained separately). Kill deltas can be negative when other deaths overlap.
