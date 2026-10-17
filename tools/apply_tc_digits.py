#!/usr/bin/env python3
"""Apply verified TC badge digit labels to dataset npz."""
import argparse
import json
import os
import sys
from collections import Counter
import cv2
import numpy as np

# Ensure inkgraph source is in sys.path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO_ROOT, "src")
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from inkgraph.common import W, H, frames
from inkgraph import cues, detect, tower

BATTLE_INTERVALS = {
    "f1": (61.0, 191.0),
    "f2": (20.0, 322.0),
}


def estimate_team_hues(video_path, start, end, step=1.0):
    """Estimate team hues from icon crops in early battle frames."""
    early_crops = []
    scan_end = min(end, start + 60.0)
    for t, img in frames(video_path, step_s=step, start=start, end=scan_end):
        if cues.timer_present(img):
            early_crops.append(cues.icon_crops(img))
        if len(early_crops) >= 30:
            break
    if not early_crops:
        return None
    try:
        return detect.team_hues(early_crops)
    except Exception as e:
        print(f"Warning: detect.team_hues failed: {e}", file=sys.stderr)
        return None


def get_frame_at_time(cap, t):
    """Retrieve single frame closest to timestamp t."""
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_idx = int(round(t * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, img = cap.read()
    if not ret or img is None:
        return None
    if img.shape[1] != W:
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    return img


def parse_video_args(video_args):
    """Parse list of match_id=path arguments."""
    video_map = {}
    for item in video_args:
        if "=" not in item:
            raise ValueError(f"Invalid --video format: {item}. Expected match_id=path")
        m, p = item.split("=", 1)
        video_map[m.strip()] = p.strip()
    return video_map


def main():
    parser = argparse.ArgumentParser(description="Apply TC badge digit labels to dataset npz.")
    parser.add_argument("--labels", default="templates/res_digits/tc_badge_labels.json", help="Path to labels JSON")
    parser.add_argument("--video", action="append", required=True, help="Video path in match_id=path format")
    parser.add_argument("--npz", default="templates/res_digits/tc_badge_digits.npz", help="Path to npz file")
    parser.add_argument("--cap", type=int, default=20, help="Max frames per (match_id, side, label)")
    args = parser.parse_args()

    video_map = parse_video_args(args.video)

    if not os.path.exists(args.labels):
        print(f"Error: labels file not found: {args.labels}", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(args.npz):
        print(f"Error: npz file not found: {args.npz}", file=sys.stderr)
        sys.exit(1)

    with open(args.labels, "r", encoding="utf-8") as f:
        labels_data = json.load(f)

    print("=" * 60)
    print("TC Badge Digits: Apply Labels")
    print("=" * 60)
    print(f"Labels file: {args.labels} ({len(labels_data)} labels)")
    print(f"Target npz:  {args.npz}")
    print(f"Cap:         {args.cap} frames per (match_id, side, label)")
    for m, p in video_map.items():
        print(f"Video {m}:    {p}")

    # Estimate / verify team hues for each match
    hues_map = {}
    for m, p in video_map.items():
        if not os.path.exists(p):
            print(f"Error: Video file not found: {p}", file=sys.stderr)
            sys.exit(1)

        if m in BATTLE_INTERVALS:
            b_start, b_end = BATTLE_INTERVALS[m]
            print(f"\nEstimating team hues for {m} on [{b_start:.1f}, {b_end:.1f}]...")
            th = estimate_team_hues(p, b_start, b_end)
            if th is None:
                print(f"Error: Failed to estimate team hues for {m}", file=sys.stderr)
                sys.exit(1)
            print(f"  Estimated team hues for {m}: own={th[0]}, enemy={th[1]}")
            if m == "f1" and th != [39, 155]:
                print(f"Error: hues for f1 ({th}) do not match expected [39, 155]", file=sys.stderr)
                sys.exit(1)
            hues_map[m] = th
        else:
            print(f"Warning: No predefined battle interval for match {m}, attempting default scan.", file=sys.stderr)
            th = estimate_team_hues(p, 0.0, 60.0)
            if th is None:
                print(f"Error: Failed to estimate team hues for {m}", file=sys.stderr)
                sys.exit(1)
            hues_map[m] = th

    # Open video capture handles
    caps = {m: cv2.VideoCapture(p) for m, p in video_map.items()}

    # Load existing npz
    z_old = np.load(args.npz)
    X_old = z_old["X"]
    y_old = z_old["y"]
    src_old = z_old["src"]
    n_old = len(y_old)
    t_old = z_old["t"] if "t" in z_old.files else np.full(n_old, -1.0, dtype=np.float64)
    side_old = z_old["side"] if "side" in z_old.files else np.full(n_old, "", dtype="<U5")

    print(f"\nExisting dataset size: {n_old} glyphs")

    # Extract glyphs and features for all labels
    print("\nExtracting badge glyphs from video frames...")
    extracted_frames = []
    unreadable_frames = []

    for item in labels_data:
        m = item["match_id"]
        side = item["side"]
        t = float(item["t"])
        label_str = str(item["label"]).strip()

        if m not in caps:
            print(f"Error: Match {m} not in provided videos", file=sys.stderr)
            sys.exit(1)

        cap = caps[m]
        img = get_frame_at_time(cap, t)
        if img is None:
            unreadable_frames.append((item, "frame_read_failed"))
            continue

        th = hues_map[m]
        bd = tower.badges(img, th)
        if side not in bd:
            unreadable_frames.append((item, "badge_not_detected"))
            continue

        pos_x, crop = bd[side]
        gs = tower.glyphs(crop)
        if len(gs) != 2:
            unreadable_frames.append((item, f"glyphs_count_{len(gs)}"))
            continue

        f0 = tower.feat(gs[0])
        f1 = tower.feat(gs[1])
        d0 = int(label_str[0])
        d1 = int(label_str[1])

        extracted_frames.append({
            "match_id": m,
            "side": side,
            "t": t,
            "label": label_str,
            "feat0": f0,
            "feat1": f1,
            "d0": d0,
            "d1": d1,
        })

    for c in caps.values():
        c.release()

    print(f"Extraction result: {len(extracted_frames)} frames successfully extracted, {len(unreadable_frames)} frames excluded.")
    if unreadable_frames:
        print("Excluded frames detail:")
        for it, reason in unreadable_frames:
            print(f"  match={it['match_id']} side={it['side']} t={it['t']:.1f} reason={reason}")

    # Held-out evaluation on ALL extracted new glyphs (before cap) using old model
    print("\n" + "=" * 60)
    print("Held-out Evaluation: Old Model on All New Glyphs (Before Cap)")
    print("=" * 60)
    all_new_X = []
    all_new_y = []
    for ef in extracted_frames:
        all_new_X.append(ef["feat0"])
        all_new_y.append(ef["d0"])
        all_new_X.append(ef["feat1"])
        all_new_y.append(ef["d1"])

    all_new_X = np.array(all_new_X)
    all_new_y = np.array(all_new_y)
    total_new_glyphs = len(all_new_y)

    # 1-NN squared Euclidean distance against old dataset
    dists = np.sum((all_new_X[:, None, :] - X_old[None, :, :]) ** 2, axis=2)
    preds = y_old[np.argmin(dists, axis=1)]

    corr = (preds == all_new_y)
    overall_heldout_acc = np.sum(corr) / total_new_glyphs if total_new_glyphs else 0.0
    print(f"Overall held-out accuracy: {np.sum(corr)}/{total_new_glyphs} = {overall_heldout_acc*100:.2f}%\n")

    print(f"{'Digit':<7} | {'Correct':<8} | {'Total':<6} | {'Accuracy':<9}")
    print("-" * 37)
    for d in range(10):
        mask = (all_new_y == d)
        tot = int(np.sum(mask))
        c = int(np.sum(preds[mask] == d))
        acc = (c / tot * 100.0) if tot > 0 else 0.0
        hl = " <-- (Target 0/1/6/9)" if d in (0, 1, 6, 9) else ""
        print(f"Digit {d:<2} | {c:6d}   | {tot:5d}  | {acc:6.2f}%{hl}")
    print("-" * 37)
    print(f"Total   | {int(np.sum(corr)):6d}   | {total_new_glyphs:5d}  | {overall_heldout_acc*100:6.2f}%")

    # Apply Capping: max `args.cap` frames per (match_id, side, label)
    print("\n" + "=" * 60)
    print(f"Applying Cap (max {args.cap} frames per group)...")
    print("=" * 60)
    groups = {}
    for ef in extracted_frames:
        key = (ef["match_id"], ef["side"], ef["label"])
        groups.setdefault(key, []).append(ef)

    capped_frames = []
    over_cap_groups = 0
    for key, items in groups.items():
        n = len(items)
        if n <= args.cap:
            capped_frames.extend(items)
        else:
            over_cap_groups += 1
            indices = np.round(np.linspace(0, n - 1, args.cap)).astype(int)
            capped_frames.extend([items[i] for i in indices])

    print(f"Total groups: {len(groups)}, Groups exceeding cap ({args.cap}): {over_cap_groups}")
    print(f"Frames before cap: {len(extracted_frames)} ({len(extracted_frames)*2} glyphs)")
    print(f"Frames after cap:  {len(capped_frames)} ({len(capped_frames)*2} glyphs)")

    # Prepare capped arrays to append
    new_capped_X = []
    new_capped_y = []
    new_capped_src = []
    new_capped_t = []
    new_capped_side = []

    for cf in capped_frames:
        # Glyph 0 (tens)
        new_capped_X.append(cf["feat0"])
        new_capped_y.append(cf["d0"])
        new_capped_src.append(cf["match_id"])
        new_capped_t.append(cf["t"])
        new_capped_side.append(cf["side"])

        # Glyph 1 (ones)
        new_capped_X.append(cf["feat1"])
        new_capped_y.append(cf["d1"])
        new_capped_src.append(cf["match_id"])
        new_capped_t.append(cf["t"])
        new_capped_side.append(cf["side"])

    new_capped_X = np.array(new_capped_X, dtype=np.float64)
    new_capped_y = np.array(new_capped_y, dtype=np.int64)
    new_capped_src = np.array(new_capped_src, dtype="<U2")
    new_capped_t = np.array(new_capped_t, dtype=np.float64)
    new_capped_side = np.array(new_capped_side, dtype="<U5")

    # Combine existing (unchanged) + new (appended at end)
    comb_X = np.vstack([X_old, new_capped_X])
    comb_y = np.concatenate([y_old, new_capped_y])
    comb_src = np.concatenate([src_old, new_capped_src])
    comb_t = np.concatenate([t_old, new_capped_t])
    comb_side = np.concatenate([side_old, new_capped_side])

    # Save to npz
    np.savez(args.npz, X=comb_X, y=comb_y, src=comb_src, t=comb_t, side=comb_side)
    print(f"\nSaved updated dataset to {args.npz}:")
    print(f"  Total glyphs: {len(comb_y)} (Existing: {n_old}, Added: {len(new_capped_y)})")

    # Output distribution in the new npz
    print("\n" + "=" * 60)
    print("New NPZ Distribution Summary")
    print("=" * 60)
    unique_srcs = np.unique(comb_src)
    header = f"{'src \\ digit':<11} | " + " ".join(f"{d:4d}" for d in range(10)) + " |  Total"
    print(header)
    print("-" * len(header))
    for s in sorted(unique_srcs):
        s_mask = (comb_src == s)
        counts = [int(np.sum((comb_y == d) & s_mask)) for d in range(10)]
        row_str = f"'{s}'{' ' * (9 - len(s))} | " + " ".join(f"{c:4d}" for c in counts) + f" | {sum(counts):6d}"
        print(row_str)
    print("-" * len(header))
    total_col = [int(np.sum(comb_y == d)) for d in range(10)]
    print(f"{'Total':<11} | " + " ".join(f"{c:4d}" for c in total_col) + f" | {len(comb_y):6d}")

    print("\nDigit breakdown added by match:")
    for s in ["f1", "f2"]:
        s_mask = (comb_src == s)
        counts = [int(np.sum((comb_y == d) & s_mask)) for d in range(10)]
        print(f"  src '{s}': " + " ".join(f"d{d}:{c}" for d, c in enumerate(counts) if c > 0))


if __name__ == "__main__":
    main()
