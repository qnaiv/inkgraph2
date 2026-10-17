"""Unit tests for merge_death_runs (D38 death deduplication)."""
import sys, os, unittest
from unittest.mock import MagicMock

# Mock cv2 and scipy if not installed in local environment
for mod in ['cv2', 'scipy', 'scipy.ndimage', 'matplotlib', 'matplotlib.font_manager']:
    if mod not in sys.modules:
        try:
            __import__(mod)
        except ImportError:
            sys.modules[mod] = MagicMock()

# Ensure src/ is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

from inkgraph.detect import merge_death_runs


def gen_frames(specs, step=0.2):
    t, sig, ok, mp = [], [], [], []
    cur_t = 0.0
    for s in specs:
        count = int(round(s['dur'] / step))
        for _ in range(count):
            t.append(round(cur_t, 1))
            sig.append(1 if s.get('sig', False) else 0)
            ok.append(s.get('ok', True))
            mp.append(s.get('mp', False))
            cur_t += step
    return t, sig, ok, mp


class TestMergeDeathRuns(unittest.TestCase):
    def test_case_e_map_open_gap_over_4s(self):
        """Case (e): Two signal runs separated by map-open gap > 4.0s -> merged into 1 run."""
        t, sig, ok, mp = gen_frames([
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
            {'dur': 4.8, 'sig': False, 'ok': True, 'mp': True},  # map open > 4.0s
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
        ])
        runs = merge_death_runs(t, sig, ok, mp, minlen=1.5)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][0], t[0])
        self.assertAlmostEqual(runs[0][1], t[-1], delta=0.3)

    def test_case_f_hud_hidden_gap(self):
        """Case (f): Two signal runs separated by HUD-hidden (ok=False) gap -> merged into 1 run."""
        t, sig, ok, mp = gen_frames([
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
            {'dur': 3.0, 'sig': False, 'ok': False, 'mp': False},  # HUD hidden
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
        ])
        runs = merge_death_runs(t, sig, ok, mp, minlen=1.5)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][0], t[0])
        self.assertAlmostEqual(runs[0][1], t[-1], delta=0.3)

    def test_case_g_alive_gap_over_1s(self):
        """Case (g): Two signal runs separated by normal screen alive >= 1.0s -> 2 separate runs."""
        t, sig, ok, mp = gen_frames([
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
            {'dur': 1.4, 'sig': False, 'ok': True, 'mp': False},  # normal screen alive 1.4s (>=1.0s)
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
        ])
        runs = merge_death_runs(t, sig, ok, mp, minlen=1.5)
        self.assertEqual(len(runs), 2)
        self.assertEqual(runs[0][0], t[0])

    def test_case_h_alive_gap_under_1s(self):
        """Case (h): Two signal runs separated by alive gap < 1.0s (0.4s flicker) -> merged into 1 run."""
        t, sig, ok, mp = gen_frames([
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
            {'dur': 0.4, 'sig': False, 'ok': True, 'mp': False},  # flicker 0.4s (< 1.0s)
            {'dur': 2.0, 'sig': True, 'ok': True, 'mp': False},
        ])
        runs = merge_death_runs(t, sig, ok, mp, minlen=1.5)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][0], t[0])
        self.assertAlmostEqual(runs[0][1], t[-1], delta=0.3)

    def test_minlen_filter(self):
        """Runs shorter than minlen (1.5s) are filtered out."""
        t, sig, ok, mp = gen_frames([
            {'dur': 1.0, 'sig': True, 'ok': True, 'mp': False},  # 1.0s < 1.5s
        ])
        runs = merge_death_runs(t, sig, ok, mp, minlen=1.5)
        self.assertEqual(runs, [])

    def test_empty_signal(self):
        """Empty or no-signal inputs return empty list."""
        t, sig, ok, mp = gen_frames([
            {'dur': 2.0, 'sig': False, 'ok': True, 'mp': False},
        ])
        runs = merge_death_runs(t, sig, ok, mp, minlen=1.5)
        self.assertEqual(runs, [])


if __name__ == '__main__':
    unittest.main()
