"""Evaluate detector outputs against human labels from web-app feedback zips.
Webアプリのレビューモードで出力されたフィードバックzipを正解として、検出結果を評価する。

Usage:
    python3 tools/eval_labels.py FEEDBACK.zip [...] --pred python|web:PATH
        [--tol 2.0] [--videos a.mp4,b.mp4] [--write-labels DIR] [--json OUT]
"""
import os, re, sys, json, zipfile, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KINDS = ('death', 'kill', 'special')
KIND_JA = {'death': 'デス', 'kill': 'キル', 'special': 'スペシャル'}
NOLABEL = 'ラベルなし'


def _pick(fix, rmarks, rs, k):
    if fix.get(k) is not None:
        return fix[k]
    if rmarks.get(k) == 'ok' and rs.get(k) is not None:
        return rs[k]
    return None


def labels_from_feedback(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        meta = json.loads(zf.read('feedback.json').decode('utf-8'))
    out = []
    for m in meta.get('matches', []):
        rs = m.get('result_screen') or {}
        own = rs.get('own') or {}
        review = m.get('review') or {}
        fix = review.get('fix') or {}
        marks = review.get('marks') or {}
        rmarks = review.get('rmarks') or {}
        added = review.get('added') or []
        det = {
            'death': [float(e.get('start', e.get('t', 0.0))) for e in m.get('own_deaths', [])],
            'kill': [float(e.get('start', e.get('t', 0.0))) for e in m.get('own_kills', [])],
            'special': [float(e.get('ready', e.get('start', e.get('t', 0.0)))) for e in m.get('special', [])],
        }
        events = {}
        for k in KINDS:
            times, unrev = [], []
            for t in det[k]:
                mk = marks.get(f"{k}@{t:.1f}")
                if mk == 'ok':
                    times.append(round(t, 1))
                elif mk in ('wrong', 'deleted'):
                    pass
                else:
                    unrev.append(round(t, 1))
            n_marked = len(times) + sum(1 for t in det[k] if marks.get(f"{k}@{t:.1f}") in ('wrong', 'deleted'))
            for a in added:
                if a.get('kind') == k and 't' in a:
                    times.append(round(float(a['t']), 1))
                    n_marked += 1
            times.sort()
            reviewed = n_marked > 0
            if not reviewed:
                status = 'none'
            elif unrev:
                status = 'partial'
            else:
                status = 'complete'
            events[k] = {'times': times, 'status': status, 'unreviewed': sorted(unrev)}
        out.append({
            'video': (m.get('source') or {}).get('name'),
            'match_id': m.get('id'),
            'battle': m.get('battle'),
            'result': _pick(fix, rmarks, rs, 'result'),
            'mode': _pick(fix, rmarks, rs, 'mode'),
            'stage': _pick(fix, rmarks, rs, 'stage'),
            'own': {k: _pick(fix, rmarks, own, k) for k in ('ka', 'deaths', 'specials')},
            'count_final': fix.get('count') if fix.get('count') else None,
            'events': events,
            'tower_holder': review.get('tower_holder'),
            'count_series': review.get('count_series'),
        })
    return out


# ---------------------------------------------------------------- predictions
def load_pred(spec, video):
    if spec == 'python':
        mm = re.search(r'match0*(\d+)', video or '')
        if not mm:
            return None
        p = os.path.join(ROOT, 'out', '1080p', f"match{int(mm.group(1)):02d}", 'timeline.json')
        if not os.path.exists(p):
            return None
        with open(p, encoding='utf-8') as f:
            d = json.load(f)
        return d[0] if isinstance(d, list) else d
    if spec.startswith('web:'):
        cache = load_pred.__dict__.setdefault('cache', {})
        path = spec[4:]
        if path not in cache:
            with open(path, encoding='utf-8') as f:
                cache[path] = json.load(f)
        for m in cache[path]:
            if (m.get('source') or {}).get('name') == video:
                return m
        return None
    raise SystemExit(f"unknown --pred {spec}")


def pred_events(p, kind):
    if not p:
        return []
    if kind == 'death':
        return sorted(float(e.get('start', e.get('t', 0.0))) for e in p.get('own_deaths', []))
    if kind == 'kill':
        return sorted(float(e.get('start', e.get('t', 0.0))) for e in p.get('own_kills', []))
    return sorted(float(e.get('ready', e.get('start', e.get('t', 0.0)))) for e in p.get('special', []))


# ---------------------------------------------------------------- metrics
def match_events(truth, preds, tol):
    used = set()
    tp = 0
    for t in sorted(truth):
        best, bd = None, None
        for i, q in enumerate(preds):
            if i in used:
                continue
            d = abs(q - t)
            if d <= tol and (bd is None or d < bd):
                best, bd = i, d
        if best is not None:
            used.add(best)
            tp += 1
    return tp, [q for i, q in enumerate(preds) if i not in used]


def m_exact(label, pred):
    if label is None:
        return None
    if pred == label:
        return {'tp': 1, 'fp': 0, 'fn': 0}
    return {'tp': 0, 'fp': 1, 'fn': 1}


def nearest_sample(series, s, win=0.7):
    best, bd = None, None
    for e in series:
        d = abs(float(e['t']) - s)
        if d <= win and (bd is None or d < bd):
            best, bd = e, d
    return best


def parse_count_series(cs):
    res = {}
    for e in cs:
        if isinstance(e, dict):
            res[int(round(float(e['t'])))] = (e.get('own'), e.get('enemy'))
        else:
            res[int(round(float(e[0])))] = (e[1], e[2])
    return res


def evaluate_match(lab, pred, tol):
    """Return list of rows: dict(item, tp, fp, fn, note)."""
    rows = []
    for k in KINDS:
        ev = lab['events'][k]
        item = KIND_JA[k]
        if ev['status'] == 'none':
            rows.append({'item': item, 'note': NOLABEL})
            continue
        preds = pred_events(pred, k)
        tp, left = match_events(ev['times'], preds, tol)
        ign = [q for q in left if any(abs(q - u) <= tol for u in ev['unreviewed'])]
        fp = len(left) - len(ign)
        fn = len(ev['times']) - tp
        note = ''
        if ev['status'] == 'partial':
            note = f"ラベル一部（未確認{len(ev['unreviewed'])}件は除外）"
        rows.append({'item': item, 'tp': tp, 'fp': fp, 'fn': fn, 'note': note})

    rs = (pred or {}).get('result_screen') or {}
    for key, item in (('result', '勝敗'), ('mode', 'ルール'), ('stage', 'ステージ')):
        r = m_exact(lab[key], rs.get(key))
        rows.append(dict(item=item, **r) if r else {'item': item, 'note': NOLABEL})
    for key, item in (('ka', 'キル+アシスト'), ('deaths', 'デス数'), ('specials', 'スペシャル数')):
        r = m_exact(lab['own'][key], (rs.get('own') or {}).get(key))
        rows.append(dict(item=item, **r) if r else {'item': item, 'note': NOLABEL})

    ts = (pred or {}).get('tower_series') or []
    if lab['count_final'] is None:
        rows.append({'item': '最終カウント', 'note': NOLABEL})
    else:
        pc = f"{ts[-1]['own']}-{ts[-1]['enemy']}" if ts else None
        rows.append(dict(item='最終カウント', **m_exact(str(lab['count_final']), pc)))

    th = lab.get('tower_holder')
    if not th:
        rows.append({'item': 'ヤグラ保持(味方)', 'note': NOLABEL})
        rows.append({'item': 'ヤグラ保持(相手)', 'note': NOLABEL})
    else:
        b = lab.get('battle') or [min(s[0] for s in th), max(s[1] for s in th)]
        cnt = {c: {'tp': 0, 'fp': 0, 'fn': 0} for c in ('own', 'enemy')}
        import math
        for s in range(int(math.ceil(b[0])), int(math.floor(b[1])) + 1):
            lo = next((seg[2] for seg in th if seg[0] <= s < seg[1]), None)
            if lo is None:
                continue
            e = nearest_sample(ts, s)
            po = e.get('owner') if e else None
            for c in cnt:
                if lo == c and po == c:
                    cnt[c]['tp'] += 1
                elif po == c:
                    cnt[c]['fp'] += 1
                elif lo == c:
                    cnt[c]['fn'] += 1
        rows.append(dict(item='ヤグラ保持(味方)', note='', **cnt['own']))
        rows.append(dict(item='ヤグラ保持(相手)', note='', **cnt['enemy']))

    cs = lab.get('count_series')
    if not cs:
        rows.append({'item': 'カウント系列', 'note': NOLABEL})
    else:
        ls = parse_count_series(cs)
        ok = 0
        for s, v in ls.items():
            e = nearest_sample(ts, s)
            if e and (e.get('own'), e.get('enemy')) == tuple(v):
                ok += 1
        n = len(ls)
        rows.append({'item': 'カウント系列', 'tp': ok, 'fp': n - ok, 'fn': n - ok,
                     'note': f"秒単位正解率 {ok}/{n}"})
    return rows


ITEM_ORDER = ['デス', 'キル', 'スペシャル', '勝敗', 'ルール', 'ステージ', 'キル+アシスト',
              'デス数', 'スペシャル数', '最終カウント', 'ヤグラ保持(味方)', 'ヤグラ保持(相手)', 'カウント系列']


def ratio(a, b):
    return f"{a / b:.3f}" if b else '-'


def fmt_row(name, r):
    if 'tp' not in r:
        return f"| {name} | {r['item']} | - | - | - | - | - | {r.get('note', '')} |"
    tp, fp, fn = r['tp'], r['fp'], r['fn']
    return (f"| {name} | {r['item']} | {tp} | {fp} | {fn} | {ratio(tp, tp + fp)} | "
            f"{ratio(tp, tp + fn)} | {r.get('note', '')} |")


def main():
    ap = argparse.ArgumentParser(description='Evaluate detector output against feedback labels')
    ap.add_argument('zips', nargs='+')
    ap.add_argument('--pred', default='python')
    ap.add_argument('--tol', type=float, default=2.0)
    ap.add_argument('--videos', default='joined_match01.mp4,joined_match02.mp4,joined_match03.mp4')
    ap.add_argument('--write-labels', metavar='DIR')
    ap.add_argument('--json', metavar='OUT')
    a = ap.parse_args()

    labels = []
    for z in a.zips:
        labels += labels_from_feedback(z)

    if a.write_labels:
        os.makedirs(a.write_labels, exist_ok=True)
        for lab in labels:
            stem = os.path.splitext(lab['video'] or str(lab['match_id']))[0]
            with open(os.path.join(a.write_labels, stem + '.json'), 'w', encoding='utf-8') as f:
                json.dump(lab, f, ensure_ascii=False, indent=1)

    videos = [v for v in a.videos.split(',') if v]
    by_video = {}
    for lab in labels:
        by_video.setdefault(lab['video'], []).append(lab)
    for v in by_video:
        if v not in videos:
            videos.append(v)

    lines = ['| 試合 | 項目 | TP | FP | FN | 適合率 | 再現率 | 備考 |', '|---|---|---|---|---|---|---|---|']
    totals = {i: {'tp': 0, 'fp': 0, 'fn': 0, 'n': 0} for i in ITEM_ORDER}
    metrics = {}
    for v in videos:
        labs = by_video.get(v)
        if not labs:
            lines.append(f"| {v} | 全項目 | - | - | - | - | - | {NOLABEL} |")
            metrics[v] = None
            continue
        for lab in labs:
            name = f"{v} ({lab['match_id']})" if len(labs) > 1 else v
            pred = load_pred(a.pred, v)
            rows = evaluate_match(lab, pred, a.tol)
            if pred is None:
                rows = [dict(r, note=(r.get('note', '') + ' 予測なし').strip()) for r in rows]
            metrics[name] = rows
            for r in rows:
                lines.append(fmt_row(name, r))
                if 'tp' in r:
                    t = totals[r['item']]
                    for k in ('tp', 'fp', 'fn'):
                        t[k] += r[k]
                    t['n'] += 1
    for item in ITEM_ORDER:
        t = totals[item]
        if t['n']:
            lines.append(fmt_row('合計', dict(item=item, **{k: t[k] for k in ('tp', 'fp', 'fn')},
                                              note=f"{t['n']}試合")))
        else:
            lines.append(fmt_row('合計', {'item': item, 'note': NOLABEL}))
    print('\n'.join(lines))

    if a.json:
        out = {'tol': a.tol, 'pred': a.pred, 'matches': metrics,
               'total': {i: (totals[i] if totals[i]['n'] else None) for i in ITEM_ORDER}}
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
