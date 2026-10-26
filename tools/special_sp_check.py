#!/usr/bin/env python3
"""Check special outcome counts against ground truth (_SP<N> or result_truth.json)."""
import argparse, json, os, re, sys

TRUTH_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out', '1080p', 'result_truth.json')


def load_truth():
    if os.path.exists(TRUTH_PATH):
        try:
            with open(TRUTH_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: could not read {TRUTH_PATH}: {e}", file=sys.stderr)
    return {}


def extract_truth_sp(name, match_dict, truth_data):
    # 1. Check filename/source for _SP(\d+)
    sp_match = re.search(r'_SP(\d+)', name)
    if sp_match:
        return int(sp_match.group(1))

    # 2. Check for joined_match0N or match0N
    m_match = re.search(r'joined_(match\d+)', name) or re.search(r'(match\d+)', name)
    if m_match:
        m_key = m_match.group(1)
        if m_key in truth_data:
            sp = truth_data[m_key].get('own', {}).get('specials')
            if sp is not None:
                return int(sp)

    # 3. Check inside match dictionary
    rs = match_dict.get('result_screen') or {}
    if isinstance(rs, dict) and 'own' in rs and isinstance(rs['own'], dict):
        sp = rs['own'].get('specials')
        if sp is not None:
            return int(sp)

    own = match_dict.get('own') or {}
    if isinstance(own, dict) and 'specials' in own:
        sp = own.get('specials')
        if sp is not None:
            return int(sp)

    return None


def inspect_match(name, m, truth_data):
    truth_sp = extract_truth_sp(name, m, truth_data)
    specials = m.get('special', [])
    act_cnt = sum(1 for s in specials if s.get('outcome') == 'activated')
    lost_cnt = sum(1 for s in specials if s.get('outcome') == 'lost_on_death')
    unused_cnt = sum(1 for s in specials if s.get('outcome') == 'unused_at_end')
    diff_val = (act_cnt - truth_sp) if truth_sp is not None else None

    mid_deaths = []
    for s in specials:
        if s.get('mid_death'):
            mid_deaths.append(f"{s.get('ready')}-{s.get('end')} (drain:{s.get('drain')}, outcome:{s.get('outcome')})")
    mid_str = "; ".join(mid_deaths) if mid_deaths else "-"

    return {
        'name': name,
        'truth_sp': truth_sp if truth_sp is not None else '?',
        'activated': act_cnt,
        'lost': lost_cnt,
        'unused': unused_cnt,
        'diff': f"{diff_val:+d}" if diff_val is not None and diff_val != 0 else (str(diff_val) if diff_val == 0 else '?'),
        'mid_deaths': mid_str,
    }


def main():
    parser = argparse.ArgumentParser(description="Check special outcome vs truth.")
    parser.add_argument('files', nargs='+', help="Input JSON files")
    parser.add_argument('--web', action='store_true', help="Input is web_matches.json format (array with source.name and special)")
    args = parser.parse_args()

    truth_data = load_truth()
    rows = []

    for path in args.files:
        if not os.path.exists(path):
            print(f"File not found: {path}", file=sys.stderr)
            continue
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        base_name = os.path.splitext(os.path.basename(path))[0]
        if base_name == 'timeline':
            parent = os.path.basename(os.path.dirname(os.path.abspath(path)))
            if parent:
                base_name = parent

        if args.web:
            # data is array of matches, each with source.name and special
            if isinstance(data, list):
                for i, m in enumerate(data):
                    src_name = m.get('source', {}).get('name') if isinstance(m.get('source'), dict) else None
                    name = src_name or f"{base_name}#{i+1}"
                    rows.append(inspect_match(name, m, truth_data))
            elif isinstance(data, dict):
                src_name = data.get('source', {}).get('name') if isinstance(data.get('source'), dict) else None
                name = src_name or base_name
                rows.append(inspect_match(name, data, truth_data))
        else:
            # detect.analyze output: list of matches or single match dict
            if isinstance(data, list):
                for i, m in enumerate(data):
                    name = base_name if len(data) == 1 else f"{base_name}#{m.get('match', i+1)}"
                    rows.append(inspect_match(name, m, truth_data))
            elif isinstance(data, dict):
                rows.append(inspect_match(base_name, data, truth_data))

    if not rows:
        print("No matches inspected.")
        return

    # Print table
    headers = ["試合", "正解SP", "activated数", "lost数", "unused数", "差", "mid_death区間の一覧(ready-end, drain, outcome)"]
    col_keys = ['name', 'truth_sp', 'activated', 'lost', 'unused', 'diff', 'mid_deaths']

    col_widths = [len(h) for h in headers]
    for r in rows:
        for idx, k in enumerate(col_keys):
            val_len = len(str(r[k]))
            if val_len > col_widths[idx]:
                col_widths[idx] = val_len

    fmt = " | ".join(f"{{:{w}}}" for w in col_widths)
    sep = "-+-".join("-" * w for w in col_widths)

    print(fmt.format(*headers))
    print(sep)
    for r in rows:
        print(fmt.format(*(str(r[k]) for k in col_keys)))


if __name__ == '__main__':
    main()
