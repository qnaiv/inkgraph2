"""Concatenate upload parts back into one file (ffmpeg concat demuxer, -c copy).
usage:
  python join_parts.py upload/full_match01_part00.mp4 [...] -o joined.mp4
  python join_parts.py upload/full_match01_part*.mp4 -o joined.mp4
  python join_parts.py --stem full_match01 --dir upload -o joined.mp4
"""
import argparse, glob, os, subprocess, sys, tempfile, shutil


def resolve_parts(args):
    if args.stem:
        d = args.dir or '.'
        parts = sorted(glob.glob(os.path.join(d, f'{args.stem}_part*.mp4')))
        if not parts:
            sys.exit(f'no parts matching {args.stem}_part*.mp4 in {d}')
        return parts
    files = []
    for p in args.parts:
        files.extend(sorted(glob.glob(p)) if any(c in p for c in '*?[') else [p])
    # de-dupe preserving order
    seen = set(); out = []
    for f in files:
        if f not in seen:
            seen.add(f); out.append(f)
    if not out:
        sys.exit('no part files given')
    return out


def join(parts, out_path, ffmpeg='ffmpeg'):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or '.', exist_ok=True)
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as f:
        for p in parts:
            ap = os.path.abspath(p).replace("'", r"'\''")
            f.write(f"file '{ap}'\n")
        list_path = f.name
    try:
        subprocess.run(
            [ffmpeg, '-v', 'error', '-y', '-f', 'concat', '-safe', '0',
             '-i', list_path, '-c', 'copy', out_path],
            check=True,
        )
    finally:
        os.unlink(list_path)


def main():
    ap = argparse.ArgumentParser(description='Join autosplit upload parts (lossless)')
    ap.add_argument('parts', nargs='*', help='part files or globs')
    ap.add_argument('-o', '--out', required=True, help='output mp4')
    ap.add_argument('--stem', help='e.g. full_match01 -> stem_part00.mp4 ...')
    ap.add_argument('--dir', help='directory for --stem (default .)')
    a = ap.parse_args()
    if not a.stem and not a.parts:
        ap.error('give part files or --stem')
    parts = resolve_parts(a)
    ff = shutil.which('ffmpeg') or 'ffmpeg'
    print('joining:')
    for p in parts:
        print(f'  {p}  ({os.path.getsize(p)/(1024*1024):.1f} MB)')
    join(parts, a.out, ff)
    print('wrote', a.out, f'({os.path.getsize(a.out)/(1024*1024):.1f} MB)')


if __name__ == '__main__':
    main()
