"""Split a long Splatoon 3 recording into per-match files (no re-encode).
usage: python autosplit.py INPUT.(mkv|mp4) [-o OUTDIR] [--pre 20] [--post 10]
                                          [--chunk-mb 95] [--dry-run]
Cues: battle = HUD timer visible (colon template), merged over gaps<25s, >=60s long.
      start = battle start - PRE s (includes rule intro / player list)
      end   = first result scoreboard after battle + POST s (fallback: battle end + 60s)
Lobby / waiting room has neither timer nor scoreboard -> skipped.

--chunk-mb N: after each match file, if it exceeds N MB, also split it losslessly
into upload/<name>_matchNN_part00.mp4 ... (ffmpeg -c copy -f segment). Full match
files are kept. segment_time is derived from bitrate so each part stays under N MB
with margin."""
import argparse, json, math, os, subprocess, sys, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inkgraph.common import frames, runs
from inkgraph import cues


def scan(path, step=1.0):
    T = []; tm = []; sb = []
    for t, img in frames(path, step):
        T.append(t); tm.append(cues.timer_present(img)); sb.append(cues.scoreboard(img))
    return T, tm, sb


def segments(T, tm, sb, pre=20, post=10):
    battles = runs(T, tm, minlen=60, gap=25); segs = []; prev_end = 0.0
    for i, (a, b) in enumerate(battles):
        nxt = battles[i + 1][0] if i + 1 < len(battles) else 1e9
        sbt = [t for t, s in zip(T, sb) if s and b < t < min(b + 240, nxt)]
        end = (sbt[0] + post) if sbt else b + 60
        start = max(prev_end, a - pre); end = min(end, nxt - pre)
        segs.append({
            'match': i + 1,
            'start': round(start, 1),
            'end': round(end, 1),
            'battle': [round(a, 1), round(b, 1)],
            'scoreboard': round(sbt[0], 1) if sbt else None,
        })
        prev_end = end
    return segs


def _ffprobe_bitrate(path, ffprobe='ffprobe'):
    """Return bitrate in bits/s (format or stream fallback), or None."""
    try:
        r = subprocess.run(
            [ffprobe, '-v', 'error', '-show_entries', 'format=bit_rate,duration,size',
             '-of', 'json', path],
            capture_output=True, text=True, check=True,
        )
        fmt = json.loads(r.stdout).get('format') or {}
        br = fmt.get('bit_rate')
        if br and int(br) > 0:
            return int(br)
        size = float(fmt.get('size') or 0)
        dur = float(fmt.get('duration') or 0)
        if size > 0 and dur > 0:
            return int(size * 8 / dur)
    except (subprocess.CalledProcessError, json.JSONDecodeError, ValueError, TypeError):
        pass
    return None


def chunk_match(match_path, chunk_mb, upload_dir, ffmpeg='ffmpeg', ffprobe='ffprobe', margin=0.85):
    """If match_path > chunk_mb MB, split losslessly into upload_dir as <stem>_partNN.mp4.
    Returns list of part paths (empty if no chunking needed)."""
    size = os.path.getsize(match_path)
    limit = chunk_mb * 1024 * 1024
    if size <= limit:
        return []
    br = _ffprobe_bitrate(match_path, ffprobe)
    if not br or br <= 0:
        # fallback: assume ~6 Mbps
        br = 6_000_000
    # bytes = bitrate * t / 8  ->  t = bytes * 8 / bitrate
    # target size with margin so parts stay under N MB even at keyframe snaps
    target_bytes = limit * margin
    seg_time = max(5.0, math.floor(target_bytes * 8 / br))
    os.makedirs(upload_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(match_path))[0]
    pattern = os.path.join(upload_dir, f'{stem}_part%02d.mp4')
    # clear old parts for this stem
    for name in os.listdir(upload_dir):
        if name.startswith(stem + '_part') and name.endswith('.mp4'):
            os.remove(os.path.join(upload_dir, name))
    subprocess.run(
        [ffmpeg, '-v', 'error', '-y', '-i', match_path,
         '-c', 'copy', '-map', '0', '-f', 'segment',
         '-segment_time', str(int(seg_time)),
         '-reset_timestamps', '1', pattern],
        check=True,
    )
    parts = sorted(
        os.path.join(upload_dir, n)
        for n in os.listdir(upload_dir)
        if n.startswith(stem + '_part') and n.endswith('.mp4')
    )
    # if any part still over limit (bitrate spike / keyframe), re-split that one finer
    oversized = [p for p in parts if os.path.getsize(p) > limit]
    if oversized and seg_time > 10:
        finer = max(5, int(seg_time * 0.7))
        for name in os.listdir(upload_dir):
            if name.startswith(stem + '_part') and name.endswith('.mp4'):
                os.remove(os.path.join(upload_dir, name))
        subprocess.run(
            [ffmpeg, '-v', 'error', '-y', '-i', match_path,
             '-c', 'copy', '-map', '0', '-f', 'segment',
             '-segment_time', str(finer),
             '-reset_timestamps', '1', pattern],
            check=True,
        )
        parts = sorted(
            os.path.join(upload_dir, n)
            for n in os.listdir(upload_dir)
            if n.startswith(stem + '_part') and n.endswith('.mp4')
        )
    for p in parts:
        mb = os.path.getsize(p) / (1024 * 1024)
        print(f'  chunk: {os.path.basename(p)}  {mb:.1f} MB')
        if os.path.getsize(p) > limit:
            print(f'  WARNING: {os.path.basename(p)} still exceeds {chunk_mb} MB '
                  f'({mb:.1f} MB); re-run with a smaller --chunk-mb or lower bitrate',
                  file=sys.stderr)
    return parts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('-o', '--outdir', default=None)
    ap.add_argument('--pre', type=float, default=20)
    ap.add_argument('--post', type=float, default=10)
    ap.add_argument('--step', type=float, default=1.0)
    ap.add_argument('--chunk-mb', type=float, default=95,
                    help='Split each match > N MB into upload/<name>_matchNN_partNN.mp4 (default 95, stays under the 100MB transfer limit; max 99)')
    ap.add_argument('--no-chunk', action='store_true', help='Disable chunking')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    if a.no_chunk:
        a.chunk_mb = None
    elif a.chunk_mb is not None and a.chunk_mb > 99:
        print(f'NOTE: --chunk-mb {a.chunk_mb} capped to 99 to stay under 100MB'); a.chunk_mb = 99
    out = a.outdir or os.path.splitext(a.input)[0] + '_matches'
    os.makedirs(out, exist_ok=True)
    T, tm, sb = scan(a.input, a.step)
    segs = segments(T, tm, sb, a.pre, a.post)
    ff = shutil.which('ffmpeg') or 'ffmpeg'
    ffp = shutil.which('ffprobe') or 'ffprobe'
    base = os.path.splitext(os.path.basename(a.input))[0]
    upload_dir = os.path.join(out, 'upload')
    for s in segs:
        s['file'] = os.path.join(out, f"{base}_match{s['match']:02d}.mp4")
        print(f"match {s['match']}: {s['start']:.1f}s - {s['end']:.1f}s "
              f"(battle {s['battle'][0]}-{s['battle'][1]}) -> {s['file']}")
        if not a.dry_run:
            subprocess.run(
                [ff, '-v', 'error', '-y',
                 '-ss', str(s['start']), '-to', str(s['end']),
                 '-i', a.input, '-map', '0', '-c', 'copy',
                 '-avoid_negative_ts', 'make_zero', s['file']],
                check=True,
            )
            if a.chunk_mb is not None:
                parts = chunk_match(s['file'], a.chunk_mb, upload_dir, ff, ffp)
                s['parts'] = parts
                s['chunk_mb'] = a.chunk_mb
    json.dump(segs, open(os.path.join(out, base + '_segments.json'), 'w'), indent=1)
    if not segs:
        print('no matches found')


if __name__ == '__main__':
    main()
