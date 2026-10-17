#!/usr/bin/env python3
"""Grok-side reproduction harness S3 for InkGraph.

Reproduces detector outputs, reference comparisons, accuracy evaluation,
and self-learning pack re-evaluation in a standalone Python environment.

Usage:
    python3 tools/repro_s3.py [--videos V1,V2,...] [--run-detector]
        [--pred SPEC default python] [--reference SPEC_OR_PATH]
        [--labels ZIP... | --labels-dir DIR]
        [--samples FILE] [--pack FILE] [--thresholds mode=0.4,stage=0.6]
        [--expected FILE] [--out-dir DIR default out/repro] [--tol 2.0]
"""
import argparse
import datetime
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from eval_labels import (
    ITEM_ORDER,
    KINDS,
    KIND_JA,
    NOLABEL,
    evaluate_match,
    fmt_row,
    labels_from_feedback,
    load_pred,
    pred_events,
)

DEFAULT_THRESHOLDS = {'mode': 0.5, 'stage': 0.5}


# -----------------------------------------------------------------------------
# 1. Prediction Loading & Detector Reproduction
# -----------------------------------------------------------------------------
def load_pred_file(path, video=None):
    """Load timeline prediction from a file.

    Handles list or dict. If a list of match predictions is loaded,
    selects the element whose source/name matches video or match number.
    """
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if isinstance(data, dict):
        if 'matches' in data and isinstance(data['matches'], list):
            data = data['matches']
        else:
            return data

    if isinstance(data, list):
        if not data:
            return None
        if not video:
            return data[0]

        v_base = os.path.basename(video)
        # 1. Match by source name or match name
        for m in data:
            if not isinstance(m, dict):
                continue
            src = m.get('source')
            src_name = src.get('name') if isinstance(src, dict) else (src if isinstance(src, str) else None)
            if src_name in (video, v_base):
                return m
            if m.get('name') in (video, v_base) or m.get('video') in (video, v_base):
                return m

        # 2. Match by match number
        mm = re.search(r'match0*(\d+)', video)
        if mm:
            num = int(mm.group(1))
            for m in data:
                if not isinstance(m, dict):
                    continue
                if m.get('match') in (num, f"match{num:02d}"):
                    return m
                mid = str(m.get('id', ''))
                if f"#{num}" in mid or f"match{num:02d}" in mid:
                    return m
            if 1 <= num <= len(data) and isinstance(data[num - 1], dict):
                return data[num - 1]

        return data[0]

    return None


def resolve_pred(spec, video, run_detector_dir=None):
    """Resolve prediction for a video given a spec and optional detector run directory."""
    if run_detector_dir:
        mm = re.search(r'match0*(\d+)', video or '')
        match_dir = f"match{int(mm.group(1)):02d}" if mm else "match01"
        p = os.path.join(run_detector_dir, match_dir, 'timeline.json')
        if os.path.exists(p):
            return load_pred_file(p, video), f"detector:{p}"

    if spec == 'python':
        pred = load_pred('python', video)
        mm = re.search(r'match0*(\d+)', video or '')
        match_dir = f"match{int(mm.group(1)):02d}" if mm else "match01"
        default_p = os.path.join(ROOT, 'out', '1080p', match_dir, 'timeline.json')
        return pred, f"python:{default_p}"

    if spec.startswith('web:'):
        p = spec[4:]
        return load_pred_file(p, video), spec

    # Direct file path
    return load_pred_file(spec, video), f"file:{spec}"


# -----------------------------------------------------------------------------
# 2. Reference Comparison
# -----------------------------------------------------------------------------
def diff_preds(pred, ref, tol=2.0):
    """Compare prediction and reference timeline per match.

    Returns:
        {
            'identical': bool,
            'fields': {field: {'pred': val, 'reference': val}},
            'events': {kind: {'only_pred': [...], 'only_ref': [...]}}
        }
    """
    if pred is None and ref is None:
        return {
            'identical': True,
            'fields': {},
            'events': {k: {'only_pred': [], 'only_ref': []} for k in KINDS},
        }

    if pred is None or ref is None:
        return {
            'identical': False,
            'fields': {'_existence': {'pred': pred is not None, 'reference': ref is not None}},
            'events': {k: {'only_pred': [], 'only_ref': []} for k in KINDS},
        }

    # Field diffs
    p_rs = pred.get('result_screen') or {}
    r_rs = ref.get('result_screen') or {}
    p_own = p_rs.get('own') or {}
    r_own = r_rs.get('own') or {}

    field_diffs = {}
    for f in ('result', 'mode', 'stage'):
        pv = p_rs.get(f)
        rv = r_rs.get(f)
        if pv != rv:
            field_diffs[f] = {'pred': pv, 'reference': rv}

    for f in ('ka', 'deaths', 'specials'):
        pv = p_own.get(f)
        rv = r_own.get(f)
        if pv != rv:
            field_diffs[f"own.{f}"] = {'pred': pv, 'reference': rv}

    # Event diffs
    event_diffs = {}
    for kind in KINDS:
        p_evs = pred_events(pred, kind)
        r_evs = pred_events(ref, kind)

        pairs = []
        for i, pt in enumerate(p_evs):
            for j, rt in enumerate(r_evs):
                d = abs(pt - rt)
                if d <= tol:
                    pairs.append((d, i, j))
        pairs.sort(key=lambda x: x[0])

        used_p = set()
        used_r = set()
        for d, i, j in pairs:
            if i not in used_p and j not in used_r:
                used_p.add(i)
                used_r.add(j)

        only_pred = [round(pt, 2) for i, pt in enumerate(p_evs) if i not in used_p]
        only_ref = [round(rt, 2) for j, rt in enumerate(r_evs) if j not in used_r]
        event_diffs[kind] = {'only_pred': only_pred, 'only_ref': only_ref}

    events_identical = all(
        len(ev['only_pred']) == 0 and len(ev['only_ref']) == 0
        for ev in event_diffs.values()
    )
    identical = (len(field_diffs) == 0 and events_identical)

    return {
        'identical': identical,
        'fields': field_diffs,
        'events': event_diffs,
    }


# -----------------------------------------------------------------------------
# 3. Pack Reproduction (Ported from learn.js)
# -----------------------------------------------------------------------------
def truth_for_match(m, target_field=None):
    """Extract ground truth for match: ok->result_screen[field]; wrong+fix->fix."""
    if not m or not isinstance(m, dict) or not m.get('review'):
        empty = {'mode': None, 'stage': None}
        return empty.get(target_field) if target_field else empty

    review = m.get('review') or {}
    rmarks = review.get('rmarks') or {}
    fix = review.get('fix') or {}
    res = m.get('result_screen') or {}

    def get_val(field):
        mark = rmarks.get(field)
        if mark == 'ok':
            return res.get(field)
        if mark == 'wrong' and fix.get(field) not in (None, ''):
            return fix[field]
        return None

    truths = {'mode': get_val('mode'), 'stage': get_val('stage')}
    return truths.get(target_field) if target_field else truths


def collect_samples_from_matches(matches):
    """Collect mode/stage samples from match objects.

    Returns list of dicts: {matchId, field, detected, score, truth, v}
    """
    samples = []
    if not matches or not isinstance(matches, list):
        return samples

    for m in matches:
        if not isinstance(m, dict) or not m.get('id'):
            continue
        truths = truth_for_match(m)
        feats = m.get('learnFeatures') or []
        for feat in feats:
            if not isinstance(feat, dict) or not feat.get('header'):
                continue
            h = feat['header']
            v = feat.get('v', 1)

            # mode sample
            m_truth = truths.get('mode')
            m_score = h.get('modeScore', h.get('mode_score'))
            if m_truth is not None and isinstance(m_score, (int, float)) and math.isfinite(m_score):
                samples.append({
                    'matchId': m['id'],
                    'field': 'mode',
                    'detected': h.get('mode'),
                    'score': float(m_score),
                    'truth': m_truth,
                    'v': v,
                })

            # stage sample
            s_truth = truths.get('stage')
            s_score = h.get('stageScore', h.get('stage_score'))
            if s_truth is not None and isinstance(s_score, (int, float)) and math.isfinite(s_score):
                samples.append({
                    'matchId': m['id'],
                    'field': 'stage',
                    'detected': h.get('stage'),
                    'score': float(s_score),
                    'truth': s_truth,
                    'v': v,
                })
    return samples


def load_samples(path):
    """Load samples from file:
    (a) list of {matchId, field, detected, score, truth}
    (b) {"samples": [...]}
    (c) list of match objects with review & learnFeatures
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Samples file not found: {path}")

    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if isinstance(data, dict):
        if 'samples' in data and isinstance(data['samples'], list):
            v = data.get('featureVersion', data.get('version'))
            samples_list = data['samples']
            if v is not None:
                for s in samples_list:
                    if isinstance(s, dict) and 'v' not in s:
                        s['v'] = v
            return samples_list
        if 'matches' in data and isinstance(data['matches'], list):
            return collect_samples_from_matches(data['matches'])
        if 'id' in data and ('learnFeatures' in data or 'review' in data):
            return collect_samples_from_matches([data])

    if isinstance(data, list):
        if not data:
            return []
        first = data[0]
        if isinstance(first, dict):
            if 'field' in first and ('score' in first or 'detected' in first or 'truth' in first):
                return data
            if 'id' in first and ('learnFeatures' in first or 'review' in first):
                return collect_samples_from_matches(data)
        return data

    return []


def predict_sample(sample, thr):
    """Port of learn.js predict: score > thr ? detected : null."""
    detected = sample.get('detected')
    score = sample.get('score', 0.0)
    pred = detected if score > thr else None
    is_correct = (pred == sample.get('truth'))
    return {'pred': pred, 'isCorrect': is_correct}


def compare_samples(samples, before, after):
    """Port of learn.js compareSamples.

    before and after can be float or dict {mode, stage}.
    Returns {total: {...}, mode: {...}, stage: {...}}
    """
    def init_metrics():
        return {
            'n': 0,
            'beforeCorrect': 0,
            'afterCorrect': 0,
            'beforeAcc': 0.0,
            'afterAcc': 0.0,
            'fixed': 0,
            'broken': 0,
            'unchanged': 0,
        }

    res = {
        'total': init_metrics(),
        'mode': init_metrics(),
        'stage': init_metrics(),
    }

    def update(m, b_corr, a_corr):
        m['n'] += 1
        if b_corr:
            m['beforeCorrect'] += 1
        if a_corr:
            m['afterCorrect'] += 1
        if not b_corr and a_corr:
            m['fixed'] += 1
        elif b_corr and not a_corr:
            m['broken'] += 1
        else:
            m['unchanged'] += 1
        m['beforeAcc'] = (m['beforeCorrect'] / m['n']) if m['n'] > 0 else 0.0
        m['afterAcc'] = (m['afterCorrect'] / m['n']) if m['n'] > 0 else 0.0

    if not samples or not isinstance(samples, list):
        return res

    for s in samples:
        f = s.get('field')
        if isinstance(before, (int, float)):
            b_thr = float(before)
        elif isinstance(before, dict):
            b_thr = float(before.get(f, DEFAULT_THRESHOLDS.get(f, 0.5)))
        else:
            b_thr = DEFAULT_THRESHOLDS.get(f, 0.5)

        if isinstance(after, (int, float)):
            a_thr = float(after)
        elif isinstance(after, dict):
            a_thr = float(after.get(f, DEFAULT_THRESHOLDS.get(f, 0.5)))
        else:
            a_thr = DEFAULT_THRESHOLDS.get(f, 0.5)

        b_corr = predict_sample(s, b_thr)['isCorrect']
        a_corr = predict_sample(s, a_thr)['isCorrect']

        update(res['total'], b_corr, a_corr)
        if f in res:
            update(res[f], b_corr, a_corr)

    return res


def extract_expected_metrics(data):
    """Extract pack total metrics from expected JSON data."""
    if not isinstance(data, dict):
        return None
    if 'pack' in data and isinstance(data['pack'], dict):
        p = data['pack']
        if 'metrics' in p and isinstance(p['metrics'], dict):
            if 'total' in p['metrics']:
                return p['metrics']['total']
            if 'train' in p['metrics'] and isinstance(p['metrics']['train'], dict):
                return p['metrics']['train'].get('total')
    if 'metrics' in data and isinstance(data['metrics'], dict):
        m = data['metrics']
        if 'total' in m:
            return m['total']
        if 'train' in m and isinstance(m['train'], dict):
            return m['train'].get('total')
    if 'total' in data and isinstance(data['total'], dict):
        return data['total']
    if any(k in data for k in ('afterCorrect', 'fixed', 'broken', 'n')):
        return data
    return None


def parse_threshold_override(thr_str):
    """Parse comma-separated threshold overrides: mode=0.4,stage=0.6."""
    if not thr_str:
        return {}
    res = {}
    for part in thr_str.split(','):
        part = part.strip()
        if not part:
            continue
        if '=' not in part:
            raise ValueError(f"Invalid threshold format '{part}', expected key=value")
        k, v = part.split('=', 1)
        res[k.strip()] = float(v.strip())
    return res


# -----------------------------------------------------------------------------
# 4. Evaluation Helper
# -----------------------------------------------------------------------------
def run_evaluation(labels, pred_resolver, tol=2.0):
    """Run evaluate_match per label against pred and aggregate totals like eval_ci."""
    by_video = {}
    for lab in labels:
        by_video.setdefault(lab.get('video'), []).append(lab)

    matches = {}
    totals = {i: {'tp': 0, 'fp': 0, 'fn': 0, 'n': 0} for i in ITEM_ORDER}

    for lab in labels:
        v = lab.get('video')
        labs = by_video.get(v, [])
        name = (
            f"{v} ({lab.get('match_id')})"
            if len(labs) > 1
            else (v or str(lab.get('match_id')))
        )
        pred, _ = pred_resolver(v)
        rows = evaluate_match(lab, pred, tol)
        if pred is None:
            rows = [
                dict(r, note=(r.get('note', '') + ' 予測なし').strip())
                for r in rows
            ]
        matches[name] = rows

        for r in rows:
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
                'n': t['n'],
            }
        else:
            total_metrics[item] = None

    return {'matches': matches, 'totals': total_metrics}


# -----------------------------------------------------------------------------
# 5. Output Writers: Markdown & JSON
# -----------------------------------------------------------------------------
def build_markdown_report(report_data):
    """Build Japanese Markdown report containing three main tables."""
    lines = [
        "# 自己学習S3 Grok側再現レポート",
        "",
        f"- 生成日時: {report_data.get('generated_at')}",
        f"- 対象動画: {', '.join(report_data.get('videos', [])) or '未指定'}",
        "",
        "## 1. 検出器の再現と参照比較（Detector Reproduction）",
        "",
        "| 試合 | 予測ソース | 参照ソース | 一致判定 | 差分詳細 |",
        "|---|---|---|---|---|",
    ]

    det_data = report_data.get('detector', {})
    det_matches = det_data.get('matches', {})
    if not det_matches:
        lines.append("| - | - | - | - | 試合データなし |")
    else:
        for v, m_info in det_matches.items():
            pred_src = m_info.get('pred_source') or '-'
            ref_src = m_info.get('reference_source') or '未指定'
            diff = m_info.get('diff')
            if m_info.get('reference') is None:
                verdict = "参照未指定"
                detail = m_info.get('reason', '参照（ブラウザ実行結果）が未指定')
            elif diff is None:
                verdict = "予測なし"
                detail = "予測データが取得できませんでした"
            elif diff.get('identical'):
                verdict = "一致"
                detail = "完全一致"
            else:
                verdict = "差分あり"
                parts = []
                f_diffs = diff.get('fields', {})
                for fk, fv in f_diffs.items():
                    parts.append(f"{fk}: {fv.get('pred')} vs {fv.get('reference')}")
                e_diffs = diff.get('events', {})
                for ek, ev in e_diffs.items():
                    if ev.get('only_pred') or ev.get('only_ref'):
                        parts.append(f"{KIND_JA.get(ek, ek)}: only_pred={ev.get('only_pred')}, only_ref={ev.get('only_ref')}")
                detail = "; ".join(parts) or "差分あり"
            lines.append(f"| {v} | {pred_src} | {ref_src} | {verdict} | {detail} |")

    lines.extend([
        "",
        "## 2. 正解ラベル評価（Evaluation Metrics）",
        "",
    ])

    eval_data = report_data.get('eval')
    if not eval_data or not eval_data.get('matches'):
        lines.append("正解ラベルが未指定のため評価をスキップしました。")
    else:
        lines.append("| 試合 | 項目 | TP | FP | FN | 適合率 | 再現率 | 備考 |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for match_name, rows in eval_data['matches'].items():
            for r in rows:
                lines.append(fmt_row(match_name, r))
        totals = eval_data.get('totals', {})
        for item in ITEM_ORDER:
            t = totals.get(item)
            if t:
                lines.append(fmt_row('合計', dict(
                    item=item,
                    tp=t['tp'],
                    fp=t['fp'],
                    fn=t['fn'],
                    note=f"{t['n']}試合",
                )))
            else:
                lines.append(fmt_row('合計', {'item': item, 'note': NOLABEL}))

    lines.extend([
        "",
        "## 3. パック再判定と合否判定（Pack Reproduction & Verdict）",
        "",
    ])

    pack_data = report_data.get('pack')
    if not pack_data:
        lines.append("学習パックまたはサンプルが未指定のためパック再判定をスキップしました。")
    else:
        pid = pack_data.get('pack_id', '-')
        fv = pack_data.get('feature_version', '-')
        ethr = pack_data.get('effective_thresholds', {})
        verdict = pack_data.get('verdict', '-')
        reason = pack_data.get('reason', '-')
        lines.extend([
            f"- パックID: `{pid}`",
            f"- 特徴量バージョン: `{fv}`",
            f"- 適用閾値: `mode={ethr.get('mode', '-')}, stage={ethr.get('stage', '-')}`",
            f"- **合否判定**: `{verdict}`",
            f"- 判定理由: {reason}",
            "",
            "| 項目 | サンプル数 | 変更前正解数 | 変更後正解数 | 改善(fixed) | 改悪(broken) | 不変(unchanged) | 変更前正解率 | 変更後正解率 |",
            "|---|---|---|---|---|---|---|---|---|",
        ])
        metrics = pack_data.get('metrics', {})
        for k, name in (('mode', 'ルール (mode)'), ('stage', 'ステージ (stage)'), ('total', '合計 (total)')):
            m = metrics.get(k)
            if m:
                b_acc = f"{m.get('beforeAcc', 0.0) * 100:.1f}%"
                a_acc = f"{m.get('afterAcc', 0.0) * 100:.1f}%"
                lines.append(
                    f"| {name} | {m.get('n')} | {m.get('beforeCorrect')} | {m.get('afterCorrect')} | "
                    f"{m.get('fixed')} | {m.get('broken')} | {m.get('unchanged')} | {b_acc} | {a_acc} |"
                )

    lines.append("")
    return "\n".join(lines)


# -----------------------------------------------------------------------------
# 6. Main CLI
# -----------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Grok-side reproduction harness S3 for detector & learn pack",
        add_help=True,
    )
    parser.add_argument('--videos', help="Comma-separated video names or paths (e.g. joined_match01.mp4,joined_match02.mp4)")
    parser.add_argument('--run-detector', action='store_true', help="Run python3 src/analyze.py VIDEO before evaluation")
    parser.add_argument('--pred', default='python', help="Prediction spec: 'python', 'web:PATH', or path to timeline.json")
    parser.add_argument('--reference', help="Reference spec: 'python', 'web:PATH', or path to timeline.json")
    parser.add_argument('--labels', nargs='*', default=[], help="Feedback zip files or json label files")
    parser.add_argument('--labels-dir', help="Directory containing *.json label files")
    parser.add_argument('--samples', help="Path to samples JSON file or match objects")
    parser.add_argument('--pack', help="Path to learning pack JSON file")
    parser.add_argument('--thresholds', help="Override thresholds (e.g. mode=0.4,stage=0.6)")
    parser.add_argument('--expected', help="Path to expected report JSON with pack totals")
    parser.add_argument('--out-dir', default='out/repro', help="Output directory for reports (default: out/repro)")
    parser.add_argument('--tol', type=float, default=2.0, help="Event matching tolerance in seconds (default: 2.0)")

    try:
        args = parser.parse_args()
    except SystemExit as e:
        sys.exit(2 if e.code != 0 else 0)

    # 1. Parse Thresholds Override
    cli_thresholds = {}
    if args.thresholds:
        try:
            cli_thresholds = parse_threshold_override(args.thresholds)
        except Exception as err:
            sys.stderr.write(f"Input error: {err}\n")
            sys.exit(2)

    # 2. Validate input paths
    if args.pack and not os.path.exists(args.pack):
        sys.stderr.write(f"Input error: pack file not found: {args.pack}\n")
        sys.exit(2)
    if args.samples and not os.path.exists(args.samples):
        sys.stderr.write(f"Input error: samples file not found: {args.samples}\n")
        sys.exit(2)
    if args.expected and not os.path.exists(args.expected):
        sys.stderr.write(f"Input error: expected file not found: {args.expected}\n")
        sys.exit(2)
    if args.labels_dir and not os.path.isdir(args.labels_dir):
        sys.stderr.write(f"Input error: labels-dir not found: {args.labels_dir}\n")
        sys.exit(2)
    for lf in args.labels:
        if not os.path.exists(lf):
            sys.stderr.write(f"Input error: label file not found: {lf}\n")
            sys.exit(2)
    if args.reference and not args.reference.startswith(('python', 'web:')):
        if not os.path.exists(args.reference):
            sys.stderr.write(f"Input error: reference file not found: {args.reference}\n")
            sys.exit(2)
    if args.reference and args.reference.startswith('web:'):
        ref_path = args.reference[4:]
        if not os.path.exists(ref_path):
            sys.stderr.write(f"Input error: reference web file not found: {ref_path}\n")
            sys.exit(2)

    # 3. Load Labels
    labels = []
    for lf in args.labels:
        if lf.endswith('.zip'):
            try:
                labels.extend(labels_from_feedback(lf))
            except Exception as err:
                sys.stderr.write(f"Input error reading zip {lf}: {err}\n")
                sys.exit(2)
        elif lf.endswith('.json'):
            try:
                with open(lf, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                    if isinstance(d, list):
                        labels.extend(d)
                    else:
                        labels.append(d)
            except Exception as err:
                sys.stderr.write(f"Input error reading label {lf}: {err}\n")
                sys.exit(2)

    if args.labels_dir:
        for fname in sorted(os.listdir(args.labels_dir)):
            if fname.endswith('.json'):
                full = os.path.join(args.labels_dir, fname)
                try:
                    with open(full, 'r', encoding='utf-8') as f:
                        d = json.load(f)
                        if isinstance(d, list):
                            labels.extend(d)
                        else:
                            labels.append(d)
                except Exception as err:
                    sys.stderr.write(f"Input error reading label {full}: {err}\n")
                    sys.exit(2)

    # 4. Resolve Videos
    videos = []
    if args.videos:
        videos = [v.strip() for v in args.videos.split(',') if v.strip()]
    elif labels:
        for lab in labels:
            v = lab.get('video')
            if v and v not in videos:
                videos.append(v)
    if not videos:
        videos = ['joined_match01.mp4', 'joined_match02.mp4', 'joined_match03.mp4']

    # 5. Handle --run-detector
    run_detector_dir = None
    if args.run_detector:
        run_detector_dir = os.path.join(args.out_dir, 'detected')
        for v in videos:
            mm = re.search(r'match0*(\d+)', v)
            match_dir = f"match{int(mm.group(1)):02d}" if mm else "match01"
            out_match_dir = os.path.join(run_detector_dir, match_dir)
            video_path = v if os.path.exists(v) else os.path.join(ROOT, v)
            if not os.path.exists(video_path):
                sys.stderr.write(f"Input error: Video file not found for --run-detector: {video_path}\n")
                sys.exit(2)
            print(f"[run-detector] Analyzing {video_path} -> {out_match_dir}...")
            cmd = [sys.executable, os.path.join(ROOT, 'src', 'analyze.py'), video_path, '-o', out_match_dir]
            res = subprocess.run(cmd)
            if res.returncode != 0:
                sys.stderr.write(f"Detector execution failed on {video_path} (exit code {res.returncode})\n")
                sys.exit(2)

    # 6. Prediction resolver helper
    def resolve_prediction(v):
        return resolve_pred(args.pred, v, run_detector_dir=run_detector_dir)

    # 7. Detector Reproduction & Reference Comparison per video
    detector_matches = {}
    for v in videos:
        pred, pred_src = resolve_prediction(v)
        if not args.reference:
            detector_matches[v] = {
                'pred_source': pred_src,
                'reference_source': None,
                'reference': None,
                'reason': "参照（ブラウザ実行結果）が未指定",
                'diff': None,
            }
        else:
            ref_pred, ref_src = resolve_pred(args.reference, v)
            diff = diff_preds(pred, ref_pred, tol=args.tol)
            detector_matches[v] = {
                'pred_source': pred_src,
                'reference_source': ref_src,
                'reference': ref_pred is not None,
                'identical': diff.get('identical'),
                'diff': diff,
            }

    # 8. Evaluation against ground truth labels
    eval_result = None
    if labels:
        eval_result = run_evaluation(labels, resolve_prediction, tol=args.tol)

    # 9. Pack Reproduction
    pack_result = None
    if args.pack or args.samples:
        samples = []
        sample_versions = set()
        if args.samples:
            try:
                samples = load_samples(args.samples)
            except Exception as err:
                sys.stderr.write(f"Input error reading samples {args.samples}: {err}\n")
                sys.exit(2)
            for s in samples:
                if isinstance(s, dict) and 'v' in s:
                    sample_versions.add(s['v'])

        pack_obj = {}
        if args.pack:
            try:
                with open(args.pack, 'r', encoding='utf-8') as f:
                    pack_obj = json.load(f)
            except Exception as err:
                sys.stderr.write(f"Input error reading pack {args.pack}: {err}\n")
                sys.exit(2)

        pack_v = pack_obj.get('featureVersion', pack_obj.get('version', 1))
        pack_id = pack_obj.get('packId', 'unknown-pack')
        base_thresholds = pack_obj.get('thresholds') or DEFAULT_THRESHOLDS
        effective_thresholds = dict(base_thresholds)
        if cli_thresholds:
            effective_thresholds.update(cli_thresholds)

        # Check version mismatch
        version_mismatch = any(sv != pack_v for sv in sample_versions)
        if version_mismatch:
            verdict = "再現不可"
            reason = f"特徴量バージョン不一致 (pack: {pack_v}, samples: {list(sample_versions)})"
            reproduced_metrics = compare_samples(samples, DEFAULT_THRESHOLDS, effective_thresholds)
        else:
            reproduced_metrics = compare_samples(samples, DEFAULT_THRESHOLDS, effective_thresholds)

            # Check expected
            if args.expected:
                try:
                    with open(args.expected, 'r', encoding='utf-8') as f:
                        exp_data = json.load(f)
                except Exception as err:
                    sys.stderr.write(f"Input error reading expected {args.expected}: {err}\n")
                    sys.exit(2)

                exp_totals = extract_expected_metrics(exp_data)
                if not exp_totals:
                    verdict = "再現不可"
                    reason = "期待値ファイル内に pack total 指標が見つかりません"
                else:
                    diff_keys = []
                    for k in ('afterCorrect', 'fixed', 'broken', 'n'):
                        exp_val = exp_totals.get(k)
                        act_val = reproduced_metrics['total'].get(k)
                        if exp_val is not None and act_val != exp_val:
                            diff_keys.append(f"{k} (actual={act_val}, expected={exp_val})")
                    if not diff_keys:
                        verdict = "一致"
                        reason = "期待値と全項目一致"
                    else:
                        verdict = "再現不可"
                        reason = f"不一致項目: {', '.join(diff_keys)}"
            else:
                verdict = "自己完結（端末レポート未指定）"
                reason = "期待値ファイル未指定のため自己完結検証"

        pack_result = {
            'pack_id': pack_id,
            'feature_version': pack_v,
            'effective_thresholds': effective_thresholds,
            'metrics': reproduced_metrics,
            'verdict': verdict,
            'reason': reason,
        }

    # 10. Assemble Full Report Data
    now_iso = datetime.datetime.now().astimezone().isoformat()
    report_data = {
        'generated_at': now_iso,
        'videos': videos,
        'detector': {
            'matches': detector_matches,
            'reference_specified': bool(args.reference),
        },
        'eval': eval_result,
        'pack': pack_result,
    }

    # 11. Write Outputs
    os.makedirs(args.out_dir, exist_ok=True)
    report_json_path = os.path.join(args.out_dir, 'report.json')
    report_md_path = os.path.join(args.out_dir, 'report.md')

    with open(report_json_path, 'w', encoding='utf-8') as f:
        json.dump(report_data, f, ensure_ascii=False, indent=2)

    md_content = build_markdown_report(report_data)
    with open(report_md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)

    # 12. Stdout Summary
    print("=== Grok-side Reproduction Harness S3 ===")
    print(f"Generated at: {now_iso}")
    print(f"Videos: {', '.join(videos)}")
    print("\n[Detector Reproduction]")
    for v, m_info in detector_matches.items():
        if m_info.get('reference') is None:
            print(f"  - {v}: 参照未指定 ({m_info.get('reason')})")
        elif m_info.get('diff', {}).get('identical'):
            print(f"  - {v}: 一致 (完全一致)")
        else:
            print(f"  - {v}: 差分あり")

    if eval_result:
        print("\n[Evaluation]")
        print(f"  - 評価試合数: {len(eval_result.get('matches', {}))} 試合")
        for item in ('デス', 'キル', 'スペシャル', '勝敗'):
            tm = eval_result.get('totals', {}).get(item)
            if tm:
                prec_str = f"{tm['precision']:.3f}" if tm['precision'] is not None else '-'
                rec_str = f"{tm['recall']:.3f}" if tm['recall'] is not None else '-'
                print(f"  - {item}: TP={tm['tp']}, FP={tm['fp']}, FN={tm['fn']} (適合率={prec_str}, 再現率={rec_str})")

    if pack_result:
        print("\n[Pack Reproduction]")
        print(f"  - パックID: {pack_result['pack_id']}")
        ethr = pack_result['effective_thresholds']
        print(f"  - 適用閾値: mode={ethr.get('mode')}, stage={ethr.get('stage')}")
        tot = pack_result['metrics']['total']
        print(f"  - サンプル数: {tot['n']}, 改善: {tot['fixed']}, 改悪: {tot['broken']}, 変更後正解数: {tot['afterCorrect']}")
        print(f"  - 判定: {pack_result['verdict']} ({pack_result['reason']})")

    print(f"\nReport written to:\n  {report_json_path}\n  {report_md_path}")
    sys.exit(0)


if __name__ == '__main__':
    main()
