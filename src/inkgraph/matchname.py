"""autosplit用: ファイル名の部品（ルール/ステージ/勝敗/K+A/デス/SP）を録画から読む。
OCRは使わず、テンプレート照合＋小さな分類器だけで読む（result.read_results を流用）。
- ルール/ステージ: 試合開始直前の「ルール」スプラッシュ画面（中央にルール名、右下にステージ名）から読む。
  リザルト画面を飛ばした動画でも読める。
- 勝敗/K+A/デス/SP: 試合後のリザルト画面から読む。無ければ None（ファイル名では 不明 / KA- ）。
ルール/ステージの見本の追加: python -m inkgraph.matchname add VIDEO BATTLE_START_SEC ルール名 ステージ名"""
import glob, os, re, sys
import cv2, numpy as np
from . import result as R
from .common import TPL, frames, imread_unicode, imwrite_unicode

LABEL_FILE = 'tpl_intro_label.png'            # 「ルール」ラベル（2値）
LABEL_SEARCH = (170, 240, 570, 710)           # y0,y1,x0,x1: ラベルを探す範囲
LABEL_MIN = 0.9                               # ラベル検出のしきい値（正解は0.96以上）
RULE_BOX = (285, 410, 560, 720)               # ルール名（中央の黒いスプラッシュ内の白文字）
STAGE_BOX = (650, 705, 940, 1270)             # ステージ名（右下、右揃え）
RULE_MIN, STAGE_MIN = 0.8, 0.65               # 見本との相関がこれ未満なら「不明」
STAGE_MARGIN = 0.1                            # 1位のステージと、別のステージの最良との差がこれ未満なら「不明」（未登録ステージが似た名前に寄るのを防ぐ）
INTRO_WINDOW = 35.0                           # バトル開始の何秒前から探すか


def _gray(img): return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
def _wb(g, th): return cv2.threshold(g, th, 255, 0)[1]
def _box(img, b): y0, y1, x0, x1 = b; return img[y0:y1, x0:x1]


def _label_tpl():
    return imread_unicode(os.path.join(TPL, LABEL_FILE), 0)


def label_score(img, t):
    """「ルール」ラベルが見えているか（スプラッシュ画面の検出）。"""
    r = _wb(_gray(_box(img, LABEL_SEARCH)), 200)
    if r.shape[0] < t.shape[0] or r.shape[1] < t.shape[1]: return 0.0
    return float(np.nan_to_num(cv2.matchTemplate(r, t, cv2.TM_CCOEFF_NORMED)).max())


def rule_feat(img): return cv2.resize(_wb(_gray(_box(img, RULE_BOX)), 170), (64, 80), interpolation=cv2.INTER_AREA).astype(np.float32)
def stage_mask(img):
    """ステージ名の白文字だけを抜く（明るい/水色の背景が混ざらないよう、高輝度かつ低彩度の画素に限る）。"""
    hsv = cv2.cvtColor(_box(img, STAGE_BOX), cv2.COLOR_BGR2HSV)
    return (((hsv[..., 2] > 215) & (hsv[..., 1] < 45)) * 255).astype(np.uint8)
def stage_feat(img): return cv2.resize(stage_mask(img), (165, 28), interpolation=cv2.INTER_AREA).astype(np.float32)


def _ncc(a, b):
    a = a - a.mean(); b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-6))


def _ncc_shift(a, b, k=4):
    """右揃えのステージ名は長さが違うので、左右に少しずらして最良の相関を取る。"""
    best = -1.0
    for d in range(-k, k + 1):
        x, y = (a[:, d:], b[:, :b.shape[1] - d]) if d >= 0 else (a[:, :d], b[:, -d:])
        best = max(best, _ncc(x, y))
    return best


def _lib(kind):
    size = (64, 80) if kind == 'rule' else (165, 28)
    out = {}
    for p in glob.glob(os.path.join(TPL, 'intro_' + kind, '*.png')):
        out[os.path.splitext(os.path.basename(p))[0]] = cv2.resize(imread_unicode(p, 0), size, interpolation=cv2.INTER_AREA).astype(np.float32)
    return out


def _best(feat, lib, fn, exclude=None):
    """(最良のラベル, その相関, 別ラベルの最良との差) を返す。"""
    sc = {}
    for k, t in lib.items():
        if exclude and exclude in k: continue
        n = k.split('__')[0]; sc[n] = max(sc.get(n, -1.0), fn(feat, t))
    if not sc: return (None, -1.0, 0.0)
    top = sorted(sc.items(), key=lambda x: -x[1])
    return (top[0][0], top[0][1], top[0][1] - (top[1][1] if len(top) > 1 else -1.0))


def intro_frames(path, battle_start, window=INTRO_WINDOW):
    """バトル開始直前のスプラッシュ画面のフレーム（0.5秒刻み）を返す。"""
    t = _label_tpl()
    if t is None: return []
    return [(tt, img) for tt, img in frames(path, 0.5, max(0.0, battle_start - window), battle_start)
            if label_score(img, t) >= LABEL_MIN]


def read_intro(imgs, exclude=None):
    """スプラッシュ画面のフレーム群から (ルール, ステージ) を多数決で読む。読めなければ None。"""
    if not imgs: return {'rule': None, 'stage': None, 'rule_score': 0.0, 'stage_score': 0.0}
    mid = imgs[len(imgs) // 4: len(imgs) * 3 // 4 + 1] or imgs
    mid = mid[::max(1, len(mid) // 5)][:5]
    lr, ls = _lib('rule'), _lib('stage')
    rv, sv = [], []
    for img in mid:
        rv.append(_best(rule_feat(img), lr, _ncc, exclude)); sv.append(_best(stage_feat(img), ls, _ncc_shift, exclude))
    def vote(v, th, margin=0.0):
        v = [(n, s) for n, s, m in v if n and s >= th and m >= margin]
        if not v: return None, 0.0
        names = [n for n, _ in v]; top = max(set(names), key=names.count)
        return top, float(np.mean([s for n, s in v if n == top]))
    rule, rs = vote(rv, RULE_MIN); stage, ss = vote(sv, STAGE_MIN, STAGE_MARGIN)
    return {'rule': rule, 'stage': stage, 'rule_score': round(rs, 2), 'stage_score': round(ss, 2)}


def read_match_info(path, battle_start, battle_end, seg_end, pre=2.0):
    """1試合ぶんの情報を読む。失敗しても例外は出さず、読めた分だけ返す。
    ルール/ステージは開始時のスプラッシュ画面から読む。スプラッシュ画面が映っていない録画に限り、リザルト画面のヘッダーで補う。"""
    info = {'result': None, 'mode': None, 'stage': None, 'ka': None, 'deaths': None, 'specials': None}
    intro_seen = False
    try:
        imgs = [img for _, img in intro_frames(path, battle_start)]
        intro_seen = bool(imgs)
        intro = read_intro(imgs)
        info['mode'], info['stage'] = intro['rule'], intro['stage']
    except Exception as e:  # 読み取り失敗でも分割自体は止めない
        print(f'  WARNING: intro read failed: {e}')
    try:
        res, _ = R.read_results(path, max(0.0, battle_end - pre), seg_end)
        own = res.get('own') or {}
        info['result'] = res.get('result')
        if not intro_seen:  # スプラッシュ画面が映っていた場合は「不明」を優先する（ヘッダー照合は未登録のルールを似た別ルールに誤判定するため）
            info['mode'] = res.get('mode')
            info['stage'] = res.get('stage')
        info.update(ka=own.get('ka'), deaths=own.get('deaths'), specials=own.get('specials'))
    except Exception as e:
        print(f'  WARNING: result read failed: {e}')
    return info


def _safe(s):
    """Windowsのファイル名に使えない文字と空白を除く。"""
    return re.sub(r'[\\/:*?"<>|\s]+', '', s)


def name_suffix(info):
    """例: _ガチヤグラ_クサヤ温泉_LOSE_KA8_D8_SP5。読めなかった項目は「不明」/「KA-」のように明示する。"""
    num = lambda k, v: f'{k}{v}' if v is not None else f'{k}-'
    parts = [
        info.get('mode') or '不明',
        info.get('stage') or '不明',
        info.get('result') or '不明',
        num('KA', info.get('ka')),
        num('D', info.get('deaths')),
        num('SP', info.get('specials')),
    ]
    return '_' + '_'.join(_safe(p) for p in parts)


def add_samples(path, battle_start, rule, stage, tag):
    """スプラッシュ画面から見本を1件ずつ追加する（intro_rule / intro_stage）。ラベルはユーザーが画面を見て指定する。"""
    fr = intro_frames(path, battle_start)
    if not fr: sys.exit('スプラッシュ画面が見つかりません')
    _, img = fr[len(fr) // 2]
    for kind, name, mask in (('rule', rule, _wb(_gray(_box(img, RULE_BOX)), 170)), ('stage', stage, stage_mask(img))):
        d = os.path.join(TPL, 'intro_' + kind); os.makedirs(d, exist_ok=True)
        imwrite_unicode(os.path.join(d, f'{name}__{tag}.png'), mask)
        print('added', kind, name, tag)


if __name__ == '__main__':
    if len(sys.argv) == 6 and sys.argv[1] == 'add':
        add_samples(sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5], _safe(os.path.splitext(os.path.basename(sys.argv[2]))[0][-8:]) + '_' + sys.argv[3])
    else:
        sys.exit(__doc__)
