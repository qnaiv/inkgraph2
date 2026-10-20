"""Check result-screen detection for X-match and joined-match videos."""
import os, sys, glob, re, json, argparse
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'src'))

from inkgraph import result
from inkgraph.detect import is_tower_rule
from inkgraph.common import frames

STARTS = {
    'match03_ガチヤグラ_ナンプラー遺跡': 99,
    'match04_ガチヤグラ_ヤガラ市場': 324,
    'match05_ガチヤグラ_ヤガラ市場': 124,
    'match01_ガチホコバトル_クサヤ温泉': 324,
    'match02_ガチホコバトル_タカアシ経済特区': 324,
    'match03_ガチホコバトル_タカアシ経済特区': 143,
    'joined_match01': 330,
    'joined_match02': 330,
    'joined_match03': 330,
}

LOO_IDS = {
    'match01_ガチホコバトル': 'xh1',
    'match02_ガチホコバトル': 'xh2',
    'match03_ガチホコバトル': 'xh3',
    'match03_ガチヤグラ': 'xy3',
    'match04_ガチヤグラ': 'xy4',
    'match05_ガチヤグラ': 'xy5',
    'joined_match01': 'm1',
    'joined_match02': 'm2',
    'joined_match03': 'm3',
}

def find_start(filename):
    for k, v in STARTS.items():
        if k in filename:
            return v
    raise ValueError(f"Unknown start time for file: {filename}")

def find_loo_id(filename):
    for k, v in LOO_IDS.items():
        if k in filename:
            return v
    raise ValueError(f"Unknown LOO ID for file: {filename}")

def load_truth_for_rules(filename):
    m = re.search(r'match\d+_(ガチヤグラ|ガチホコバトル)_([^_]+)_(WIN|LOSE)_KA(\d+)_D(\d+)_SP(\d+)', filename)
    if not m:
        raise ValueError(f"Cannot parse truth from filename: {filename}")
    return {
        'result': m.group(3),
        'ka': int(m.group(4)),
        'deaths': int(m.group(5)),
        'specials': int(m.group(6)),
        'mode': m.group(1),
        'stage': m.group(2),
        'match_type': 'x',
    }

def load_truth_for_joined(filename, truth_json_path):
    with open(truth_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    m = re.search(r'joined_match0([1-3])', filename)
    if not m:
        raise ValueError(f"Cannot parse joined match number: {filename}")
    idx = m.group(1)
    key = f"match0{idx}"
    entry = data[key]
    return {
        'result': entry['result'],
        'ka': entry['own']['kills_plus_assists'],
        'deaths': entry['own']['deaths'],
        'specials': entry['own']['specials'],
        'mode': 'ガチヤグラ',
        'stage': 'クサヤ温泉',
        'match_type': None,
    }

def main():
    parser = argparse.ArgumentParser(description="Check X-match and joined-match result reading")
    parser.add_argument('--rules-dir', default='/tmp/rules', help="Directory containing X-match mp4s")
    parser.add_argument('--raw-dir', default='/workspace/inkgraph/raw/1080p', help="Directory containing joined_match mp4s")
    parser.add_argument('--dump', default=None, help="Dump frame data to directory for JS verification")
    parser.add_argument('--loo', action='store_true', help="Run leave-one-out cross validation excluding match-derived templates")
    args = parser.parse_args()

    truth_json_path = os.path.join(ROOT, 'out', '1080p', 'result_truth.json')
    if not os.path.exists(truth_json_path):
        raise FileNotFoundError(f"Missing {truth_json_path}")

    # 動画一覧の収集
    x_files = sorted(glob.glob(os.path.join(args.rules_dir, '*.mp4')))
    joined_files = sorted(glob.glob(os.path.join(args.raw_dir, 'joined_match0[1-3].mp4')))
    all_files = [(f, 'x') for f in x_files] + [(f, 'joined') for f in joined_files]

    if not all_files:
        print("No videos found to check.")
        sys.exit(1)

    if args.dump:
        os.makedirs(args.dump, exist_ok=True)

    items = ['result', 'ka', 'deaths', 'specials', 'mode', 'stage', 'match_type']
    total_counts = {item: [0, 0] for item in items}  # [match_count, total_count]

    rows = []
    has_mismatch = False

    for idx, (path, vtype) in enumerate(all_files):
        vid_id = f"v{idx + 1}"
        fname = os.path.basename(path)
        start = find_start(fname)
        loo_id = find_loo_id(fname)

        if vtype == 'x':
            truth = load_truth_for_rules(fname)
        else:
            truth = load_truth_for_joined(fname, truth_json_path)

        # --dump 指定時のフレームダンプ処理
        if args.dump:
            raw_path = os.path.join(args.dump, f"{vid_id}.raw")
            json_path = os.path.join(args.dump, f"{vid_id}.json")
            ts = []
            with open(raw_path, 'wb') as raw_f:
                for t, img in frames(path, step_s=0.25, start=start):
                    ts.append(round(t, 3))
                    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                    raw_f.write(rgb.tobytes())
            info = {
                'id': vid_id,
                'name': fname,
                'truth': truth,
                'frames': ts,
                'w': 1280,
                'h': 720,
            }
            with open(json_path, 'w', encoding='utf-8') as jf:
                json.dump(info, jf, ensure_ascii=False, indent=2)

        # 結果読み取り
        if args.loo:
            exclude_hdr = f"__{loo_id}"
            res, S = result.read_results(path, start, exclude_hdr=exclude_hdr)
        else:
            res, S = result.read_results(path, start)

        # panel 内訳の集計
        panels = [p for _, p, _, _ in S.get('board', [])] + [p for _, p, _, _ in S.get('personal', [])]
        p_counts = {}
        for p in panels:
            p_counts[p] = p_counts.get(p, 0) + 1
        panel_breakdown = ", ".join(f"{k}:{v}" for k, v in sorted(p_counts.items())) if p_counts else "none"

        detected = {
            'result': res.get('result'),
            'ka': res['own']['ka'] if res.get('own') else None,
            'deaths': res['own']['deaths'] if res.get('own') else None,
            'specials': res['own']['specials'] if res.get('own') else None,
            'mode': res.get('mode'),
            'stage': res.get('stage'),
            'match_type': res.get('match_type'),
        }

        row_eval = {}
        for k in items:
            if args.loo and k in ('mode', 'stage'):
                # --loo では「不一致」を失敗にせず、mode/stage が None（不明）か正解なら安全
                ok = (detected[k] == truth[k]) or (detected[k] is None)
            else:
                ok = (detected[k] == truth[k])
            row_eval[k] = ok
            total_counts[k][1] += 1
            if ok:
                total_counts[k][0] += 1
            else:
                has_mismatch = True

        rows.append({
            'name': fname,
            'loo_id': loo_id,
            'panel': panel_breakdown,
            'detected': detected,
            'truth': truth,
            'eval': row_eval,
            'mode_margin': res.get('mode_margin'),
        })

    # 表の出力
    print("=" * 145)
    print(f"{'Video':<40} | {'Panel':<12} | {'Result':<10} | {'K+A':<8} | {'D':<8} | {'SP':<8} | {'Mode':<14} | {'Margin':<8} | {'Stage':<14} | {'Type':<8}")
    print("-" * 145)

    for r in rows:
        d = r['detected']
        t = r['truth']
        ev = r['eval']
        def mark(k):
            if ev[k]:
                if args.loo and k in ('mode', 'stage') and d[k] is None:
                    return "~(None:safe)"
                return "✓"
            return f"✗({t[k]})"

        res_str = f"{d['result']}{mark('result')}"
        ka_str = f"{d['ka']}{mark('ka')}"
        d_str = f"{d['deaths']}{mark('deaths')}"
        sp_str = f"{d['specials']}{mark('specials')}"
        mode_str = f"{d['mode']}{mark('mode')}"
        margin_str = f"{r['mode_margin']:.2f}" if r['mode_margin'] is not None else "None"
        stage_str = f"{d['stage']}{mark('stage')}"
        mt_str = f"{d['match_type']}{mark('match_type')}"

        short_name = r['name']
        if len(short_name) > 38:
            short_name = short_name[:18] + "..." + short_name[-17:]

        print(f"{short_name:<40} | {r['panel']:<12} | {res_str:<10} | {ka_str:<8} | {d_str:<8} | {sp_str:<8} | {mode_str:<14} | {margin_str:<8} | {stage_str:<14} | {mt_str:<8}")

    print("-" * 145)
    summary_parts = [f"{k}: {total_counts[k][0]}/{total_counts[k][1]}" for k in items]
    print("Summary matches: " + ", ".join(summary_parts))

    # 明示チェック: ホコと判定された試合で mode=='ガチヤグラ' になっていない／is_tower_rule が False
    print("-" * 145)
    print("Hoko guard checks (is_tower_rule == False on Hoko matches):")
    hoko_guard_failed = False
    for r in rows:
        is_hoko = (r['truth']['mode'] == 'ガチホコバトル') or (r['detected']['mode'] == 'ガチホコバトル')
        if is_hoko:
            det_mode = r['detected']['mode']
            tower_flag = is_tower_rule(det_mode)
            guard_ok = (det_mode != 'ガチヤグラ') and (not tower_flag)
            status = "PASS" if guard_ok else "FAIL"
            if not guard_ok:
                hoko_guard_failed = True
                has_mismatch = True
            print(f"  [{status}] {r['name']}: mode={det_mode}, is_tower_rule={tower_flag}")

    print("=" * 145)

    if has_mismatch:
        print("ERROR: Mismatch or guard failure detected.")
        sys.exit(1)
    else:
        mode_desc = " (LOO safe)" if args.loo else ""
        print(f"SUCCESS: All videos passed truth expectations{mode_desc}.")

if __name__ == '__main__':
    main()
