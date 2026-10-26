"""Archive a feedback zip's images and labels into training/ (D60).
フィードバックzipの画像とラベルを、学習用に training/<stem>/ へ軽くして保存する。

- 画像は最大幅 1280・WebP（既定 品質80）に再エンコードして容量を抑える（元は 1080p の JPEG 約250KB → 約50〜80KB）。
- 内容が同じ画像（縮小後のハッシュが同じ）は、すでに training/ にあればそれを指す（バッチをまたいで重複させない）。
- feedback.json の snapshots[].file を、保存した画像の相対パス（training/ から）に書き換える。
- training/index.json に、バッチごとの試合数・画像数・容量と、画像ハッシュの対応を追記する。

Usage:
    python tools/archive_training.py EXTRACTED_DIR STEM [--out training] [--max-w 1280] [--quality 80]
"""
import os, sys, json, hashlib, argparse, datetime
import cv2, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'src'))
from inkgraph.common import imread_unicode


def encode_webp(img, max_w, quality):
    h, w = img.shape[:2]
    if w > max_w:
        img = cv2.resize(img, (max_w, int(round(h * max_w / w))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode('.webp', img, [cv2.IMWRITE_WEBP_QUALITY, quality])
    if not ok:
        raise RuntimeError('webp encode failed')
    return buf.tobytes()


def main():
    p = argparse.ArgumentParser(description='Archive feedback images/labels into training/')
    p.add_argument('extracted_dir'); p.add_argument('stem')
    p.add_argument('--out', default=os.path.join(ROOT, 'training'))
    p.add_argument('--max-w', type=int, default=1280); p.add_argument('--quality', type=int, default=80)
    a = p.parse_args()

    fb_path = os.path.join(a.extracted_dir, 'feedback.json')
    if not os.path.exists(fb_path):
        print(f'エラー: {fb_path} が見つかりません'); return 1
    with open(fb_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)

    out_dir = os.path.join(a.out, a.stem); os.makedirs(out_dir, exist_ok=True)
    idx_path = os.path.join(a.out, 'index.json')
    idx = {'v': 1, 'batches': [], 'hashes': {}}
    if os.path.exists(idx_path):
        with open(idx_path, 'r', encoding='utf-8') as f:
            idx = json.load(f)
    if any(b['stem'] == a.stem for b in idx['batches']):
        print(f'スキップ: {a.stem} はすでに取り込み済みです'); return 0

    n_img = n_dup = 0; total = 0; seen = {}
    for m in meta.get('matches', []):
        for s in m.get('snapshots', []) or []:
            rel = s.get('file')
            if not rel: continue
            src = os.path.join(a.extracted_dir, *rel.replace('\\', '/').split('/'))
            img = imread_unicode(src)
            if img is None:
                print(f'  [警告] 読めない画像: {rel}'); continue
            data = encode_webp(img, a.max_w, a.quality); h = hashlib.sha1(data).hexdigest()[:16]
            if h in idx['hashes']:
                s['file'] = idx['hashes'][h]; n_dup += 1; continue
            if h in seen:
                s['file'] = seen[h]; n_dup += 1; continue
            dst_rel = f"{a.stem}/images/{h}.webp"; dst = os.path.join(a.out, *dst_rel.split('/'))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as f: f.write(data)
            seen[h] = dst_rel; idx['hashes'][h] = dst_rel; s['file'] = dst_rel; n_img += 1; total += len(data)

    with open(os.path.join(out_dir, 'feedback.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    idx['batches'].append({'stem': a.stem, 'matches': len(meta.get('matches', [])), 'images': n_img, 'duplicates': n_dup, 'bytes': total,
                           'at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')})
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)
    print(f'training/{a.stem}: 試合 {len(meta.get("matches", []))}・画像 {n_img}（重複 {n_dup}）・{total / 1024:.0f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
