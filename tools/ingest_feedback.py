"""Ingest feedback zip from web app and update truth labels / templates.
Webアプリからエクスポートされたフィードバックzipを取り込み、正解ラベルの生成やリザルトテンプレートの追加を行う。

Usage:
    python tools/ingest_feedback.py FEEDBACK.zip [--apply] [--out work/feedback]
"""
import os, sys, json, zipfile, argparse, subprocess
import cv2, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'src'))

from inkgraph.common import imread_unicode, imwrite_unicode, TPL
from inkgraph.result import classify, panel_offset, header_crops, _lib, _best


def get_next_fb_n(folder, name, lib):
    n = 1
    while True:
        key = f"{name}__fb{n}"
        if not os.path.exists(os.path.join(folder, f"{key}.png")) and key not in lib:
            return n
        n += 1


def _own_str(own):
    """表示用。None（未確認）は「未確認」と表示する。"""
    labels = {'ka': 'キル+アシスト', 'deaths': 'デス', 'specials': 'スペシャル'}
    return ', '.join(f"{labels.get(k, k)}={'未確認' if v is None else v}" for k, v in own.items())


def main():
    p = argparse.ArgumentParser(description='Ingest web app feedback zip')
    p.add_argument('feedback_zip', help='Path to feedback zip file')
    p.add_argument('--apply', action='store_true', help='Save templates and refresh web assets')
    p.add_argument('--out', default='work/feedback', help='Output extraction directory')
    args = p.parse_args()

    zip_path = os.path.abspath(args.feedback_zip)
    stem = os.path.splitext(os.path.basename(zip_path))[0]
    out_dir = os.path.abspath(os.path.join(args.out, stem))
    os.makedirs(out_dir, exist_ok=True)

    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(out_dir)

    fb_json_path = os.path.join(out_dir, 'feedback.json')
    if not os.path.exists(fb_json_path):
        print(f"エラー: {fb_json_path} が見つかりません。")
        return 1

    with open(fb_json_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)

    matches = meta.get('matches', [])
    print(f"=== フィードバック取り込み: {stem} (試合数: {len(matches)}) ===")

    lib_mode, lib_stage = _lib('mode'), _lib('stage')
    truth_records, templates_to_add, manual_events = [], [], []
    tot_counts = {k: {'ok': 0, 'wrong': 0, 'added': 0} for k in ('death', 'kill', 'special')}
    events_out_dir = os.path.join(out_dir, 'events')

    for m in matches:
        mid = m.get('id', 'unknown')
        safe_id = str(mid).replace('/', '_').replace(':', '-')
        rs = m.get('result_screen') or {}
        own = rs.get('own') or {}
        review = m.get('review') or {}
        fix = review.get('fix') or {}
        marks = review.get('marks') or {}
        added = review.get('added') or []

        # 1. Corrected result / match info (fix overrides result_screen)
        c_res = fix.get('result') or rs.get('result')
        c_mode = fix.get('mode') or rs.get('mode')
        c_stage = fix.get('stage') or rs.get('stage')
        # 'ka'（キル+アシスト）はUIから廃止。欠けていても壊れず、None＝未確認として扱う。
        # 自分のキルはタイムラインのキルイベントで検証する。
        c_own = {k: fix[k] if fix.get(k) is not None else own.get(k) for k in ('ka', 'deaths', 'specials')}
        c_own = {k: (v if isinstance(v, (int, float)) else None) for k, v in c_own.items()}
        s_last = m.get('tower_series') or []
        c_cnt = fix.get('count') or (f"{s_last[-1]['own']}-{s_last[-1]['enemy']}" if s_last else rs.get('count'))

        # Detected events breakdown
        det_events = {
            'death': [float(e.get('start', e.get('t', 0.0))) for e in m.get('own_deaths', [])],
            'kill': [float(e.get('start', e.get('t', 0.0))) for e in m.get('own_kills', [])],
            'special': [float(e.get('ready', e.get('start', e.get('t', 0.0)))) for e in m.get('special', [])],
        }

        m_counts, corr_events = {}, {}
        for k in ('death', 'kill', 'special'):
            mk_fn = lambda t: marks.get(f"{k}@{t:.1f}") or marks.get(f"{k}@{t}")
            k_ok = sum(1 for t in det_events[k] if mk_fn(t) == 'ok')
            k_wrong = sum(1 for t in det_events[k] if mk_fn(t) == 'wrong')
            kept = [round(t, 1) for t in det_events[k] if mk_fn(t) not in ('wrong', 'deleted')]
            add_ts = [round(float(a['t']), 1) for a in added if a.get('kind') == k and 't' in a]
            corr_events[k] = sorted(kept + add_ts)
            m_counts[k] = {'ok': k_ok, 'wrong': k_wrong, 'added': len(add_ts)}
            for fld in ('ok', 'wrong', 'added'): tot_counts[k][fld] += m_counts[k][fld]

        truth_records.append({
            'id': mid, 'result': c_res, 'mode': c_mode, 'stage': c_stage,
            'own': c_own, 'count': c_cnt, 'events': corr_events,
        })

        print(f"\n[試合 {mid}] 判定結果: {c_res} | ルール: {c_mode} | ステージ: {c_stage} | カウント: {c_cnt} | 自身: {_own_str(c_own)}")
        for k in ('death', 'kill', 'special'):
            c = m_counts[k]
            print(f"  {k:7s}: ✓ {c['ok']}  ✗ {c['wrong']}  追加 {c['added']}")

        # 3 & 4. Process snapshots
        for s in m.get('snapshots', []):
            s_file = s.get('file')
            if not s_file: continue
            fpath = os.path.join(out_dir, *s_file.replace('\\', '/').split('/'))
            img = imread_unicode(fpath)
            if img is None: continue
            if img.shape[1] != 1280 or img.shape[0] != 720:
                img = cv2.resize(img, (1280, 720), interpolation=cv2.INTER_AREA)

            s_kind = s.get('kind')
            # Result templates (personal / board)
            if s_kind in ('personal', 'board'):
                pk, _, (dx, dy) = classify(img)
                if pk not in ('personal', 'board'):
                    sc_lobby, pdx, pdy = panel_offset(img)
                    if sc_lobby >= 0.6: pk, dx, dy = s_kind, pdx, pdy

                if pk in ('personal', 'board'):
                    mc, sc = header_crops(img, dx, dy)
                    for sub, name_val, crop, lib in [('res_mode', c_mode, mc, lib_mode), ('res_stage', c_stage, sc, lib_stage)]:
                        if name_val and crop.size > 0:
                            _, score = _best(crop, lib)
                            if score <= 0.9:
                                n = get_next_fb_n(os.path.join(TPL, sub), name_val, lib)
                                tname = f"{name_val}__fb{n}"
                                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
                                lib[tname] = gray
                                templates_to_add.append((sub, tname, gray, score))

            # Event snapshots (wrong / missed)
            ev = s.get('event') if isinstance(s.get('event'), dict) else {}
            ev_type = ev.get('type') or (s_kind if s_kind in ('wrong', 'missed') else None)
            if s_kind == 'event' or ev_type in ('wrong', 'missed'):
                ev_type = ev_type or 'event'
                os.makedirs(events_out_dir, exist_ok=True)
                t_val = float(s.get('t', 0.0))
                dst_path = os.path.join(events_out_dir, f"{safe_id}_{ev_type}_{t_val:.1f}.jpg")
                i = 1
                while os.path.exists(dst_path):
                    dst_path = os.path.join(events_out_dir, f"{safe_id}_{ev_type}_{t_val:.1f}_{i}.jpg")
                    i += 1
                imwrite_unicode(dst_path, img)
                manual_events.append(dst_path)

    # Print overall precision / recall
    print("\n=== 全体集計 (適合率 / 再現率) ===")
    for k in ('death', 'kill', 'special'):
        c = tot_counts[k]
        denom_p, denom_r = c['ok'] + c['wrong'], c['ok'] + c['added']
        prec = f"{c['ok'] / denom_p * 100:.1f}% ({c['ok']}/{denom_p})" if denom_p else "—"
        rec = f"{c['ok'] / denom_r * 100:.1f}% ({c['ok']}/{denom_r})" if denom_r else "—"
        print(f"  {k:7s}: ✓ {c['ok']:2d}  ✗ {c['wrong']:2d}  追加 {c['added']:2d} | 適合率(Precision): {prec} | 再現率(Recall): {rec}")

    # 2. Write labels/feedback/<stem>.json
    lbl_dir = os.path.join(ROOT, 'labels', 'feedback')
    os.makedirs(lbl_dir, exist_ok=True)
    lbl_path = os.path.join(lbl_dir, f"{stem}.json")
    with open(lbl_path, 'w', encoding='utf-8') as f:
        json.dump(truth_records, f, ensure_ascii=False, indent=2)
    print(f"\n正解ラベルを出力しました: {lbl_path}")

    # 3. Report or save templates
    if templates_to_add:
        print(f"\n=== リザルトテンプレートの検出 ({len(templates_to_add)}件) ===")
        for sub, name, gray, sc in templates_to_add:
            t_path = os.path.join(TPL, sub, f"{name}.png")
            if args.apply:
                imwrite_unicode(t_path, gray)
                print(f"  [保存] templates/{sub}/{name}.png (既存ベストスコア: {sc:.2f})")
            else:
                print(f"  [未適用] 追加候補: templates/{sub}/{name}.png (既存ベストスコア: {sc:.2f})")
    else:
        print("\n追加が必要なリザルトテンプレートはありませんでした（既存スコア > 0.9）。")

    # 4. List manual labelling event images
    if manual_events:
        print(f"\n=== 手動ラベリングが必要なイベントスナップショット ({len(manual_events)}件) ===")
        for p in manual_events:
            print(f"  {p}")

    # 5. Refresh web assets if --apply
    if args.apply:
        print("\n=== Webアセットの更新 ===")
        subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'export_web_assets.py')], check=True)

    return 0


if __name__ == '__main__':
    sys.exit(main())
