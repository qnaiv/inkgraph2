#!/usr/bin/env python3
"""Evaluate detector outputs in CI, report Markdown summary, and check regressions against baseline.

Usage:
    python3 tools/eval_ci.py [--labels-dir DIR] [--pred SPEC] [--tol TOL]
                             [--baseline PATH] [--update-baseline]
                             [--md PATH] [--json PATH]
"""
import argparse
import json
import os
import sys

# Allow importing eval_labels when run directly or imported from other scripts
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from eval_labels import (
    ITEM_ORDER,
    NOLABEL,
    evaluate_match,
    fmt_row,
    load_pred,
)

FOCUS_ITEMS = ['デス', 'キル', 'スペシャル', '勝敗']
DEFAULT_BASELINE = os.path.join(HERE, 'eval_baseline.json')


def load_label_files(labels_dir):
    """Load top-level json label files from labels_dir in sorted order."""
    if not os.path.isdir(labels_dir):
        return []
    names = sorted(os.listdir(labels_dir))
    labels = []
    for name in names:
        if not name.endswith('.json'):
            continue
        full_path = os.path.join(labels_dir, name)
        if os.path.isfile(full_path):
            with open(full_path, 'r', encoding='utf-8') as f:
                labels.append(json.load(f))
    return labels


def evaluate_all(labels, pred_spec='python', tol=2.0):
    """Evaluate detector outputs on labels and calculate metrics and totals.

    Returns dict with keys: 'matches', 'totals', 'table_md'.
    """
    by_video = {}
    for lab in labels:
        by_video.setdefault(lab.get('video'), []).append(lab)

    matches = {}
    lines = [
        '| 試合 | 項目 | TP | FP | FN | 適合率 | 再現率 | 備考 |',
        '|---|---|---|---|---|---|---|---|',
    ]
    totals = {i: {'tp': 0, 'fp': 0, 'fn': 0, 'n': 0} for i in ITEM_ORDER}

    for lab in labels:
        v = lab.get('video')
        labs = by_video.get(v, [])
        name = (
            f"{v} ({lab.get('match_id')})"
            if len(labs) > 1
            else (v or str(lab.get('match_id')))
        )
        pred = load_pred(pred_spec, v)
        rows = evaluate_match(lab, pred, tol)
        if pred is None:
            rows = [
                dict(r, note=(r.get('note', '') + ' 予測なし').strip())
                for r in rows
            ]
        matches[name] = rows

        for r in rows:
            lines.append(fmt_row(name, r))
            if 'tp' in r:
                t = totals[r['item']]
                t['tp'] += r['tp']
                t['fp'] += r['fp']
                t['fn'] += r['fn']
                t['n'] += 1

    total_metrics = {}
    for item in ITEM_ORDER:
        t = totals[item]
        if t['n']:
            tp, fp, fn = t['tp'], t['fp'], t['fn']
            prec = (tp / (tp + fp)) if (tp + fp) > 0 else None
            rec = (tp / (tp + fn)) if (tp + fn) > 0 else None
            total_metrics[item] = {
                'tp': tp,
                'fp': fp,
                'fn': fn,
                'precision': prec,
                'recall': rec,
            }
            lines.append(
                fmt_row(
                    '合計',
                    dict(
                        item=item,
                        tp=tp,
                        fp=fp,
                        fn=fn,
                        note=f"{t['n']}試合",
                    ),
                )
            )
        else:
            total_metrics[item] = None
            lines.append(fmt_row('合計', {'item': item, 'note': NOLABEL}))

    table_md = '\n'.join(lines)
    return {
        'matches': matches,
        'totals': total_metrics,
        'table_md': table_md,
    }


def compare_baseline(totals, baseline_data, focus_items=FOCUS_ITEMS):
    """Compare current totals against baseline for focus items.

    Returns (warnings, notes).
    """
    warnings = []
    notes = []
    if isinstance(baseline_data, dict):
        metrics = baseline_data.get('metrics', baseline_data)
    else:
        metrics = {}

    for item in focus_items:
        base_item = metrics.get(item)
        if not base_item:
            notes.append(f"{item}: 基準値に定義がないため比較スキップ")
            continue
        cur_item = totals.get(item)
        if cur_item is None:
            notes.append(f"{item}: ラベルなしのため比較スキップ")
            continue

        for metric_name in ('precision', 'recall'):
            base_val = base_item.get(metric_name)
            if base_val is None:
                continue
            cur_val = cur_item.get(metric_name)
            if cur_val is None:
                notes.append(
                    f"{item} {metric_name}: 現在値が未計算(分母0)のため比較スキップ"
                )
                continue
            if cur_val < base_val - 1e-6:
                warnings.append(
                    f"精度回帰: {item} {metric_name} {cur_val:.3f} < 基準 {base_val:.3f}"
                )

    return warnings, notes


def generate_markdown_summary(
    pred, tol, label_count, table_md, warnings, notes=None
):
    """Generate Markdown summary document."""
    lines = [
        '## 精度回帰テスト (eval_labels)',
        '',
        f"- 予測ソース: `{pred}`",
        f"- 許容誤差 (tol): {tol}s",
        f"- 評価ラベル数: {label_count}件",
        '',
    ]
    if table_md:
        lines.append(table_md)
        lines.append('')

    lines.append('## 警告')
    if warnings:
        for w in warnings:
            lines.append(f"- ⚠️ {w}")
    else:
        lines.append('- 警告はありません。')

    if notes:
        lines.append('')
        lines.append('### 注記')
        for n in notes:
            lines.append(f"- {n}")

    lines.append('')
    lines.append('## 基準値について')
    lines.append(
        '注目項目 (デス, キル, スペシャル, 勝敗) について、基準値 (`tools/eval_baseline.json`) '
        'を下回った場合に警告を出します。\n'
        '現時点では正解ラベルが一部試合 (試合2) のみのため、回帰を検知してもCIジョブは失敗させず警告のみとしています。'
    )
    lines.append('')
    return '\n'.join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='Evaluate detector output against ground-truth labels for CI.'
    )
    ap.add_argument(
        '--labels-dir',
        default=os.path.join(ROOT, 'labels'),
        help='Directory containing ground-truth label JSON files (default: labels/)',
    )
    ap.add_argument(
        '--pred',
        default='python',
        help='Prediction source: python (default) or web:PATH',
    )
    ap.add_argument(
        '--tol',
        type=float,
        default=2.0,
        help='Time tolerance in seconds for event matching (default: 2.0)',
    )
    ap.add_argument(
        '--baseline',
        default=DEFAULT_BASELINE,
        help='Path to baseline JSON file (default: tools/eval_baseline.json)',
    )
    ap.add_argument(
        '--update-baseline',
        action='store_true',
        help='Update baseline JSON with current metrics and skip comparison',
    )
    ap.add_argument('--md', metavar='PATH', help='Path to write Markdown summary')
    ap.add_argument('--json', metavar='PATH', help='Path to write JSON results')
    a = ap.parse_args(argv)

    labels = load_label_files(a.labels_dir)
    step_summary = os.environ.get('GITHUB_STEP_SUMMARY')

    if not labels:
        warn = f"ラベルファイルが見つかりません (ディレクトリ: {a.labels_dir})"
        print(f"::warning::{warn}")
        warnings = [warn]
        md_content = generate_markdown_summary(
            a.pred, a.tol, 0, table_md='', warnings=warnings
        )
        print(md_content)
        if a.md:
            with open(a.md, 'w', encoding='utf-8') as f:
                f.write(md_content)
        if step_summary:
            try:
                with open(step_summary, 'a', encoding='utf-8') as f:
                    f.write(md_content + '\n')
            except Exception as e:
                print(
                    f"::warning::Failed to write GITHUB_STEP_SUMMARY: {e}",
                    file=sys.stderr,
                )
        if a.json:
            json_out = {
                'pred': a.pred,
                'tol': a.tol,
                'matches': {},
                'total': {i: None for i in ITEM_ORDER},
                'warnings': warnings,
            }
            with open(a.json, 'w', encoding='utf-8') as f:
                json.dump(json_out, f, ensure_ascii=False, indent=2)
        return 0

    eval_res = evaluate_all(labels, pred_spec=a.pred, tol=a.tol)
    totals = eval_res['totals']

    warnings = []
    notes = []

    if a.update_baseline:
        base_metrics = {}
        for item in FOCUS_ITEMS:
            t = totals.get(item)
            if t is not None:
                base_metrics[item] = {
                    'precision': t['precision'],
                    'recall': t['recall'],
                }
            else:
                base_metrics[item] = {'precision': None, 'recall': None}
        base_data = {
            'pred': a.pred,
            'tol': a.tol,
            'metrics': base_metrics,
        }
        with open(a.baseline, 'w', encoding='utf-8') as f:
            json.dump(base_data, f, ensure_ascii=False, indent=2)
        print(f"基準値を更新しました: {a.baseline}")
    else:
        if not os.path.exists(a.baseline):
            w = f"基準ファイルが見つかりません: {a.baseline}"
            warnings.append(w)
            print(f"::warning::{w}")
        else:
            try:
                with open(a.baseline, 'r', encoding='utf-8') as f:
                    baseline_data = json.load(f)
                cmp_warnings, cmp_notes = compare_baseline(totals, baseline_data)
                warnings.extend(cmp_warnings)
                notes.extend(cmp_notes)
                for w in cmp_warnings:
                    print(f"::warning::{w}")
            except Exception as e:
                w = f"基準ファイルの読み込みに失敗しました ({a.baseline}): {e}"
                warnings.append(w)
                print(f"::warning::{w}")

    # Output Markdown table to stdout
    print(eval_res['table_md'])

    md_content = generate_markdown_summary(
        a.pred,
        a.tol,
        len(labels),
        eval_res['table_md'],
        warnings,
        notes=notes,
    )

    if a.md:
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(md_content)

    if step_summary:
        try:
            with open(step_summary, 'a', encoding='utf-8') as f:
                f.write(md_content + '\n')
        except Exception as e:
            print(
                f"::warning::Failed to write GITHUB_STEP_SUMMARY: {e}",
                file=sys.stderr,
            )

    if a.json:
        json_out = {
            'pred': a.pred,
            'tol': a.tol,
            'matches': eval_res['matches'],
            'total': totals,
            'warnings': warnings,
        }
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(json_out, f, ensure_ascii=False, indent=2)

    return 0


if __name__ == '__main__':
    sys.exit(main())
