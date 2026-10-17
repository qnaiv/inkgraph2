#!/usr/bin/env python3
"""Evaluate TC badge digits dataset and leave-one-match-out accuracy."""
import argparse
import json
import os
import sys
import numpy as np
from collections import Counter


def evaluate_npz(npz_path, segment_paths=None, verbose=True):
    if not os.path.exists(npz_path):
        print(f"Error: npz file not found: {npz_path}", file=sys.stderr)
        sys.exit(1)

    z = np.load(npz_path)
    X = z["X"]
    y = z["y"]
    src = z["src"]

    if verbose:
        print("=" * 60)
        print(f"Dataset Evaluation: {npz_path}")
        print("=" * 60)
        print(f"Total glyph samples: {len(y)} (Feature dim: {X.shape[1]})")

    # Counts per digit and counts per src
    digits, d_counts = np.unique(y, return_counts=True)
    d_map = dict(zip(digits, d_counts))
    unique_srcs, s_counts = np.unique(src, return_counts=True)
    s_map = dict(zip(unique_srcs, s_counts))

    if verbose:
        print("\n--- Distribution Summary ---")
        print("Counts per digit (0-9):")
        for d in range(10):
            print(f"  Digit {d}: {d_map.get(d, 0):4d}")

        print("\nCounts per src:")
        for s in sorted(unique_srcs):
            print(f"  src '{s}': {s_map[s]:4d}")

        print("\nCross-tabulation (src vs digit):")
        header = "src \\ digit | " + " ".join(f"{d:4d}" for d in range(10)) + " |  Total"
        print(header)
        print("-" * len(header))
        for s in sorted(unique_srcs):
            s_mask = (src == s)
            counts = [np.sum((y == d) & s_mask) for d in range(10)]
            row_str = f"'{s}'{' ' * (9 - len(s))} | " + " ".join(f"{c:4d}" for c in counts) + f" | {sum(counts):6d}"
            print(row_str)
        print("-" * len(header))
        total_col = [np.sum(y == d) for d in range(10)]
        print("Total       | " + " ".join(f"{c:4d}" for c in total_col) + f" | {len(y):6d}")

    # Leave-one-match-out (LOMO)
    total_correct = 0
    total_samples = len(y)
    per_digit_correct = {d: 0 for d in range(10)}
    per_digit_total = {d: 0 for d in range(10)}
    per_src_acc = {}

    badge_pairs_correct = 0
    total_badge_pairs = 0

    for s in unique_srcs:
        tr_mask = (src != s)
        te_mask = (src == s)
        X_train, y_train = X[tr_mask], y[tr_mask]
        X_test, y_test = X[te_mask], y[te_mask]

        # 1-NN squared Euclidean distance
        dists = np.sum((X_test[:, None, :] - X_train[None, :, :]) ** 2, axis=2)
        preds = y_train[np.argmin(dists, axis=1)]

        correct = (preds == y_test)
        s_corr = int(np.sum(correct))
        s_tot = len(y_test)
        total_correct += s_corr
        per_src_acc[s] = (s_corr, s_tot, (s_corr / s_tot * 100.0) if s_tot else 0.0)

        # Pair-level (2 consecutive glyphs forming a badge)
        if s_tot >= 2:
            p_corr = correct[0::2] & correct[1::2]
            badge_pairs_correct += int(np.sum(p_corr))
            total_badge_pairs += len(p_corr)

        for d in range(10):
            d_mask = (y_test == d)
            per_digit_correct[d] += int(np.sum(preds[d_mask] == d))
            per_digit_total[d] += int(np.sum(d_mask))

    overall_acc = (total_correct / total_samples * 100.0) if total_samples else 0.0
    pair_acc = (badge_pairs_correct / total_badge_pairs * 100.0) if total_badge_pairs else 0.0

    if verbose:
        print("\n--- Leave-One-Match-Out (LOMO) Evaluation ---")
        print(f"Overall glyph-level LOMO accuracy: {total_correct}/{total_samples} = {overall_acc:.2f}%")
        if total_badge_pairs > 0:
            print(f"Reference: badge-level (2-glyph pair) LOMO accuracy: {badge_pairs_correct}/{total_badge_pairs} = {pair_acc:.2f}%")

        print("\nPer-src LOMO accuracy:")
        for s in sorted(unique_srcs):
            c, n, acc = per_src_acc[s]
            print(f"  src '{s}': {c:4d}/{n:4d} = {acc:6.2f}%")

        print("\nPer-digit glyph accuracy:")
        for d in range(10):
            tot = per_digit_total[d]
            cor = per_digit_correct[d]
            acc = (cor / tot * 100.0) if tot > 0 else 0.0
            highlight = " <-- Target (0/1/6/9)" if d in (0, 1, 6, 9) else ""
            print(f"  Digit {d}: {cor:4d}/{tot:4d} = {acc:6.2f}%{highlight}")

        print("\nBreakdown for specified targets (0 / 1 / 6 / 9):")
        for d in (0, 1, 6, 9):
            tot = per_digit_total[d]
            cor = per_digit_correct[d]
            acc = (cor / tot * 100.0) if tot > 0 else 0.0
            print(f"  Digit {d}: {cor:4d}/{tot:4d} = {acc:6.2f}%")

        # If segment files provided, summarize them
        if segment_paths:
            print("\n--- Additional Segments Summary ---")
            for p in segment_paths:
                if not os.path.exists(p):
                    print(f"Segment file not found: {p}")
                    continue
                with open(p, "r", encoding="utf-8") as f:
                    segs = json.load(f)
                print(f"\nFile: {p}")
                print(f"Total segments: {len(segs)}")
                seg_glyph_counts = Counter()
                total_seg_frames = 0
                for seg in segs:
                    pred = str(seg.get("pred", ""))
                    n = seg.get("n", 0)
                    total_seg_frames += n
                    for ch in pred:
                        if ch.isdigit():
                            seg_glyph_counts[int(ch)] += n
                print(f"Total frames in segments: {total_seg_frames} ({total_seg_frames * 2} glyphs)")
                print("Glyphs by pred digit:")
                for d in range(10):
                    print(f"  Digit {d}: {seg_glyph_counts[d]:4d}")

    stats = {
        "total_samples": total_samples,
        "total_correct": total_correct,
        "overall_acc": overall_acc,
        "badge_pairs_correct": badge_pairs_correct,
        "total_badge_pairs": total_badge_pairs,
        "pair_acc": pair_acc,
        "per_src_acc": per_src_acc,
        "per_digit_correct": per_digit_correct,
        "per_digit_total": per_digit_total,
        "d_map": d_map,
        "s_map": s_map,
    }
    return stats


def compare_lomo(before_path, after_path):
    print("=" * 70)
    print("TC Badge Digits: LOMO Evaluation Comparison (Before vs After)")
    print("=" * 70)

    print(f"\n>>> Evaluating BEFORE: {before_path}")
    b_stats = evaluate_npz(before_path, verbose=False)
    print(f">>> Evaluating AFTER:  {after_path}")
    a_stats = evaluate_npz(after_path, verbose=False)

    print("\n" + "=" * 70)
    print("SUMMARY COMPARISON TABLE")
    print("=" * 70)

    # 1. Overall
    b_tot, b_cor, b_acc = b_stats["total_samples"], b_stats["total_correct"], b_stats["overall_acc"]
    a_tot, a_cor, a_acc = a_stats["total_samples"], a_stats["total_correct"], a_stats["overall_acc"]
    diff_acc = a_acc - b_acc

    print(f"\n[Overall Glyph LOMO Accuracy]")
    print(f"  Before: {b_cor}/{b_tot} ({b_acc:.2f}%)")
    print(f"  After:  {a_cor}/{a_tot} ({a_acc:.2f}%)")
    print(f"  Delta:  {diff_acc:+.2f}% pt  (Samples: {b_tot} -> {a_tot}, +{a_tot - b_tot})")

    # 2. Per-src
    print(f"\n[Per-src LOMO Accuracy]")
    all_srcs = sorted(set(list(b_stats["per_src_acc"].keys()) + list(a_stats["per_src_acc"].keys())))
    print(f"{'src':<6} | {'Before Correct/Total':<22} | {'Before Acc':<10} | {'After Correct/Total':<22} | {'After Acc':<10} | {'Delta':<8}")
    print("-" * 88)
    for s in all_srcs:
        if s in b_stats["per_src_acc"]:
            bc, bt, ba = b_stats["per_src_acc"][s]
            b_str = f"{bc:4d}/{bt:4d}"
            ba_str = f"{ba:6.2f}%"
        else:
            b_str = "    - /   - "
            ba_str = "     -   "
            ba = None

        if s in a_stats["per_src_acc"]:
            ac, at, aa = a_stats["per_src_acc"][s]
            a_str = f"{ac:4d}/{at:4d}"
            aa_str = f"{aa:6.2f}%"
        else:
            a_str = "    - /   - "
            aa_str = "     -   "
            aa = None

        if ba is not None and aa is not None:
            d_str = f"{aa - ba:+6.2f}%"
        else:
            d_str = "   new  "
        print(f"'{s}'   | {b_str:<22} | {ba_str:<10} | {a_str:<22} | {aa_str:<10} | {d_str:<8}")

    # 3. Target digits (0 / 1 / 6 / 9) and All digits
    print(f"\n[Per-digit LOMO Accuracy (Target digits: 0, 1, 6, 9)]")
    print(f"{'Digit':<6} | {'Before Correct/Total':<22} | {'Before Acc':<10} | {'After Correct/Total':<22} | {'After Acc':<10} | {'Delta':<8} | Note")
    print("-" * 96)
    for d in range(10):
        bc = b_stats["per_digit_correct"][d]
        bt = b_stats["per_digit_total"][d]
        ba = (bc / bt * 100.0) if bt > 0 else 0.0

        ac = a_stats["per_digit_correct"][d]
        at = a_stats["per_digit_total"][d]
        aa = (ac / at * 100.0) if at > 0 else 0.0

        delta = aa - ba
        note = "Target" if d in (0, 1, 6, 9) else ""
        print(f"Digit {d} | {bc:4d}/{bt:4d}               | {ba:6.2f}%   | {ac:4d}/{at:4d}               | {aa:6.2f}%   | {delta:+6.2f}% | {note}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate TC badge digits dataset.")
    parser.add_argument("--npz", help="Path to npz dataset file")
    parser.add_argument("--before", help="Path to before npz dataset file for comparison")
    parser.add_argument("--after", help="Path to after npz dataset file for comparison")
    parser.add_argument("--segments", nargs="*", default=[], help="Optional paths to segments.json")
    args = parser.parse_args()

    if args.before and args.after:
        compare_lomo(args.before, args.after)
    elif args.npz:
        evaluate_npz(args.npz, args.segments)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
