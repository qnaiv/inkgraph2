#!/usr/bin/env python3
"""Harvest TC badge digit segments from gameplay video."""
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

from inkgraph.common import frames, TPL
from inkgraph import cues, tower, detect


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


def create_montage(items, out_path):
    """Create a montage grid of enlarged badge crops with time labels."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    n = len(items)
    if n == 0:
        return

    # Pick up to 20 frames evenly distributed
    if n <= 20:
        picked = items
    else:
        indices = np.round(np.linspace(0, n - 1, 20)).astype(int)
        picked = [items[i] for i in indices]

    enlarged_crops = []
    times = []
    for it in picked:
        cr = it["crop"]
        h, w = cr.shape[:2]
        c3 = cv2.resize(cr, (w * 3, h * 3), interpolation=cv2.INTER_NEAREST)
        enlarged_crops.append(c3)
        times.append(it["t"])

    max_h = max(c.shape[0] for c in enlarged_crops)
    max_w = max(c.shape[1] for c in enlarged_crops)
    hdr_h = 24
    pad = 4
    cell_w = max_w + pad * 2
    cell_h = max_h + hdr_h + pad * 2

    k = len(picked)
    ncols = min(5, k)
    nrows = (k + ncols - 1) // ncols

    montage = np.full((nrows * cell_h, ncols * cell_w, 3), 40, dtype=np.uint8)

    for idx, (c3, t_val) in enumerate(zip(enlarged_crops, times)):
        r = idx // ncols
        c = idx % ncols
        y0 = r * cell_h
        x0 = c * cell_w

        cell = np.full((cell_h, cell_w, 3), 30, dtype=np.uint8)
        cell[0:hdr_h, :] = (20, 20, 20)

        label = f"{t_val:.1f}s"
        (tw, th_txt), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        tx = max(pad, (cell_w - tw) // 2)
        ty = (hdr_h + th_txt) // 2
        cv2.putText(cell, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

        ch, cw = c3.shape[:2]
        cy = hdr_h + pad + (max_h - ch) // 2
        cx = pad + (max_w - cw) // 2
        cell[cy:cy + ch, cx:cx + cw] = c3

        montage[y0:y0 + cell_h, x0:x0 + cell_w] = cell

    cv2.imwrite(out_path, montage)


def create_contact_sheet(items, out_path, ncols=6):
    """Create a contact sheet grid of 2x enlarged badge crops with t and pred labels."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    n = len(items)
    if n == 0:
        return

    enlarged_crops = []
    labels = []
    for it in items:
        cr = it["crop"]
        h, w = cr.shape[:2]
        c2 = cv2.resize(cr, (w * 2, h * 2), interpolation=cv2.INTER_NEAREST)
        enlarged_crops.append(c2)
        t_val = it["t"]
        pred = it["pred"]
        t_str = f"{t_val:.1f}" if abs(t_val - round(t_val, 1)) < 1e-4 else f"{t_val:.2f}"
        labels.append(f"t={t_str} pred={pred}")

    max_h = max(c.shape[0] for c in enlarged_crops)
    max_w = max(c.shape[1] for c in enlarged_crops)
    hdr_h = 24
    pad = 4

    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.45
    font_thickness = 1

    max_tw = max(cv2.getTextSize(lbl, font, font_scale, font_thickness)[0][0] for lbl in labels)
    cell_w = max(max_w + pad * 2, max_tw + pad * 2)
    cell_h = max_h + hdr_h + pad * 2

    k = len(items)
    nrows = (k + ncols - 1) // ncols

    sheet = np.full((nrows * cell_h, ncols * cell_w, 3), 40, dtype=np.uint8)

    for idx, (c2, label) in enumerate(zip(enlarged_crops, labels)):
        r = idx // ncols
        c = idx % ncols
        y0 = r * cell_h
        x0 = c * cell_w

        cell = np.full((cell_h, cell_w, 3), 30, dtype=np.uint8)
        cell[0:hdr_h, :] = (20, 20, 20)

        (tw, th_txt), _ = cv2.getTextSize(label, font, font_scale, font_thickness)
        tx = max(pad, (cell_w - tw) // 2)
        ty = (hdr_h + th_txt) // 2
        cv2.putText(cell, label, (tx, ty), font, font_scale, (255, 255, 255), font_thickness, cv2.LINE_AA)

        ch, cw = c2.shape[:2]
        cy = hdr_h + pad + (max_h - ch) // 2
        cx = pad + (max_w - cw) // 2
        cell[cy:cy + ch, cx:cx + cw] = c2

        sheet[y0:y0 + cell_h, x0:x0 + cell_w] = cell

    cv2.imwrite(out_path, sheet)


def harvest(video_path, match_id=None, battle_start=0.0, battle_end=0.0, step=1.0, out_dir="out/digit_harvest", hues=None, min_frames=3, contact_sheets=False):
    # Normalize output directory path and match_id
    base = os.path.basename(os.path.normpath(out_dir))
    if match_id is None:
        match_id = base.split('_')[0]

    if base == match_id or base.startswith(f"{match_id}_") or base.startswith(f"{match_id}-"):
        match_out = out_dir
    elif base in ("digit_harvest", "harvest", "out"):
        match_out = os.path.join(out_dir, match_id)
    else:
        match_out = out_dir
    montage_dir = os.path.join(match_out, "montages")
    os.makedirs(montage_dir, exist_ok=True)

    # Check video duration
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    duration = frame_count / fps if fps > 0 else 0.0
    cap.release()

    print("=" * 60)
    print(f"Harvest TC Digits: match_id={match_id}")
    print(f"Video: {video_path} (Duration: {duration:.1f}s)")
    print(f"Battle interval requested: [{battle_start:.1f}, {battle_end:.1f}]")
    print(f"Min frames: {min_frames}")

    if battle_start >= duration:
        print(f"Warning: battle start ({battle_start:.1f}s) is beyond video duration ({duration:.1f}s).", file=sys.stderr)

    # Team hues determination
    th = None
    if hues:
        th = [int(h.strip()) for h in hues.split(",")]
        print(f"Using user-specified team hues: own={th[0]}, enemy={th[1]}")
    else:
        th = estimate_team_hues(video_path, battle_start, battle_end, step=step)
        if th:
            print(f"Auto-estimated team hues: own={th[0]}, enemy={th[1]}")
        else:
            print("Warning: Could not automatically estimate team hues (no early battle frames found).", file=sys.stderr)

    # Load existing tc_badge_digits classifier
    npz_path = os.path.join(TPL, "res_digits", "tc_badge_digits.npz")
    if not os.path.exists(npz_path):
        print(f"Error: classifier npz not found at {npz_path}", file=sys.stderr)
        sys.exit(1)
    z = np.load(npz_path)
    X, y = z["X"], z["y"]

    records = []
    if th is not None and battle_start < duration:
        for t, img in frames(video_path, step_s=step, start=battle_start, end=battle_end):
            if not cues.timer_present(img):
                continue
            bd = tower.badges(img, th)
            for side in ("own", "enemy"):
                if side in bd:
                    pos_x, crop = bd[side]
                    gs = tower.glyphs(crop)
                    if len(gs) == 2:
                        f0 = tower.feat(gs[0])
                        f1 = tower.feat(gs[1])
                        d0 = int(y[np.argmin(((X - f0) ** 2).sum(axis=1))])
                        d1 = int(y[np.argmin(((X - f1) ** 2).sum(axis=1))])
                        pred = f"{d0}{d1}"
                        records.append({
                            "side": side,
                            "t": round(t, 2),
                            "pred": pred,
                            "crop": crop
                        })

    # Write records.json (all records without crop)
    records_data = [
        {"t": r["t"], "side": r["side"], "pred": r["pred"]}
        for r in records
    ]
    records_json_path = os.path.join(match_out, "records.json")
    with open(records_json_path, "w", encoding="utf-8") as f:
        json.dump(records_data, f, indent=2, ensure_ascii=False)
    print(f"Saved {len(records_data)} raw records to: {records_json_path}")

    # Segment consecutive frames: split if gap > 2.0s or value changes; discard < min_frames
    raw_segments = []
    for target_side in ("own", "enemy"):
        side_items = [r for r in records if r["side"] == target_side]
        side_items.sort(key=lambda it: it["t"])
        curr = []
        for item in side_items:
            if not curr:
                curr = [item]
            else:
                prev = curr[-1]
                if item["pred"] != prev["pred"] or (item["t"] - prev["t"]) > 2.001:
                    if len(curr) >= min_frames:
                        raw_segments.append(curr)
                    curr = [item]
                else:
                    curr.append(item)
        if len(curr) >= min_frames:
            raw_segments.append(curr)

    # Sort segments chronologically
    raw_segments.sort(key=lambda s: s[0]["t"])

    segments_data = []
    digit_glyph_counts = Counter()

    print(f"\nFound {len(raw_segments)} segments (>= {min_frames} frames, max gap <= 2.0s).")
    print("\nSegment List:")
    print(f"  {'ID':<5} {'Side':<6} {'Time Range':<19} {'Pred':<6} {'Frames':<6}")
    print("  " + "-" * 46)

    for i, seg in enumerate(raw_segments):
        seg_id = i + 1
        side = seg[0]["side"]
        pred = seg[0]["pred"]
        times = [it["t"] for it in seg]
        n = len(times)
        t_start = times[0]
        t_end = times[-1]

        # Update glyph counts
        for ch in pred:
            if ch.isdigit():
                digit_glyph_counts[int(ch)] += n

        seg_record = {
            "id": seg_id,
            "match_id": match_id,
            "side": side,
            "t_start": t_start,
            "t_end": t_end,
            "times": times,
            "pred": pred,
            "n": n
        }
        segments_data.append(seg_record)

        time_range_str = f"{t_start:.1f}s - {t_end:.1f}s"
        print(f"  {seg_id:03d}   {side:<6} {time_range_str:<19} {pred:<6} {n:<6}")

        # Generate montage
        montage_filename = f"seg{seg_id:03d}_{side}_{pred}.png"
        montage_path = os.path.join(montage_dir, montage_filename)
        create_montage(seg, montage_path)

    # Write segments.json
    segments_json_path = os.path.join(match_out, "segments.json")
    with open(segments_json_path, "w", encoding="utf-8") as f:
        json.dump(segments_data, f, indent=2, ensure_ascii=False)
    print(f"\nSaved segments data to: {segments_json_path}")
    print(f"Montages saved to: {montage_dir}/")

    # Generate contact sheets if requested
    if contact_sheets:
        sheets_dir = os.path.join(match_out, "sheets")
        os.makedirs(sheets_dir, exist_ok=True)
        target_sides = []
        for s in ("own", "enemy"):
            if any(r["side"] == s for r in records):
                target_sides.append(s)
        for r in records:
            if r["side"] not in target_sides:
                target_sides.append(r["side"])

        for side in target_sides:
            side_records = [r for r in records if r["side"] == side]
            side_records.sort(key=lambda it: it["t"])
            for sheet_idx, start_idx in enumerate(range(0, len(side_records), 24), start=1):
                chunk = side_records[start_idx:start_idx + 24]
                sheet_filename = f"{side}_{sheet_idx:02d}.png"
                sheet_path = os.path.join(sheets_dir, sheet_filename)
                create_contact_sheet(chunk, sheet_path)
        print(f"Contact sheets saved to: {sheets_dir}/")

    # Print glyph distribution
    total_glyphs = sum(digit_glyph_counts.values())
    print("\nDigit Glyph Counts (pred-based across segments):")
    for d in range(10):
        print(f"  Digit {d}: {digit_glyph_counts[d]:4d}")
    print(f"  Total glyphs: {total_glyphs:4d}")

    return segments_data, digit_glyph_counts


def main():
    parser = argparse.ArgumentParser(description="Harvest TC badge digit segments.")
    parser.add_argument("--video", required=True, help="Path to video file")
    parser.add_argument("--match-id", default=None, help="Match ID (e.g. f1, f2)")
    parser.add_argument("--battle", nargs=2, type=float, required=True, help="Battle start and end time (seconds)")
    parser.add_argument("--step", type=float, default=1.0, help="Sampling step in seconds (default: 1.0)")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--hues", type=str, default=None, help="Optional comma-separated team hues (e.g. 39,155)")
    parser.add_argument("--min-frames", type=int, default=3, help="Minimum frames for a segment (default: 3)")
    parser.add_argument("--contact-sheets", action="store_true", help="Generate contact sheet PNGs for all records")
    args = parser.parse_args()

    harvest(
        video_path=args.video,
        match_id=args.match_id,
        battle_start=args.battle[0],
        battle_end=args.battle[1],
        step=args.step,
        out_dir=args.out,
        hues=args.hues,
        min_frames=args.min_frames,
        contact_sheets=args.contact_sheets
    )


if __name__ == "__main__":
    main()
