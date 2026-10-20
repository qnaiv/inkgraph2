"""Unit tests for special_outcome (D44 mid-death handling)."""
import sys, os, unittest
from unittest.mock import MagicMock

for mod in ['cv2', 'scipy', 'scipy.ndimage', 'matplotlib', 'matplotlib.font_manager']:
    if mod not in sys.modules:
        try:
            __import__(mod)
        except ImportError:
            sys.modules[mod] = MagicMock()

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

import numpy as np
from inkgraph.detect import special_outcome


def make_timeline(b, drain_val=0.0):
    """Generate t and go arrays around interval end b."""
    t = [round(x, 1) for x in np.arange(0.0, 35.0, 0.2)]
    go = [0.0] * len(t)
    for i, ti in enumerate(t):
        if b < ti <= b + 1.5:
            go[i] = drain_val
    return t, go


class TestSpecialOutcome(unittest.TestCase):
    def test_case_1_mid_death_with_drain(self):
        """(1) 途中デス＋直後に橙0.28 -> activated, mid_death True, drain 0.28"""
        a, b = 10.0, 20.0
        death_starts = [15.0]
        t, go = make_timeline(b, drain_val=0.28)
        res = special_outcome(a, b, death_starts, t, go, last_ok=30.0)
        self.assertEqual(res['outcome'], 'activated')
        self.assertTrue(res['mid_death'])
        self.assertAlmostEqual(res['drain'], 0.28, places=2)

    def test_case_2_mid_death_without_drain(self):
        """(2) 途中デス＋直後の橙0.02 -> lost_on_death, mid_death True, drain 0.02"""
        a, b = 10.0, 20.0
        death_starts = [15.0]
        t, go = make_timeline(b, drain_val=0.02)
        res = special_outcome(a, b, death_starts, t, go, last_ok=30.0)
        self.assertEqual(res['outcome'], 'lost_on_death')
        self.assertTrue(res['mid_death'])
        self.assertAlmostEqual(res['drain'], 0.02, places=2)

    def test_case_3_end_death(self):
        """(3) 終端直後デス（b+0.2）-> lost_on_death（橙があっても mid_death False, drain None）"""
        a, b = 10.0, 20.0
        death_starts = [20.2]  # b + 0.2
        t, go = make_timeline(b, drain_val=0.28)
        res = special_outcome(a, b, death_starts, t, go, last_ok=30.0)
        self.assertEqual(res['outcome'], 'lost_on_death')
        self.assertFalse(res['mid_death'])
        self.assertIsNone(res['drain'])

    def test_case_4_no_death(self):
        """(4) デスなし・途中 -> activated、終端（b>=last_ok-1）-> unused_at_end"""
        a, b = 10.0, 20.0
        death_starts = []
        t, go = make_timeline(b, drain_val=0.0)

        # 途中
        res_mid = special_outcome(a, b, death_starts, t, go, last_ok=30.0)
        self.assertEqual(res_mid['outcome'], 'activated')
        self.assertFalse(res_mid['mid_death'])
        self.assertIsNone(res_mid['drain'])

        # 終端 (b >= last_ok - 1.0: 20.0 >= 20.5 - 1.0 = 19.5)
        res_end = special_outcome(a, b, death_starts, t, go, last_ok=20.5)
        self.assertEqual(res_end['outcome'], 'unused_at_end')
        self.assertFalse(res_end['mid_death'])
        self.assertIsNone(res_end['drain'])

    def test_case_5_death_outside_window(self):
        """(5) デスが a より前・b+1.0 より後 -> 影響なし"""
        a, b = 10.0, 20.0
        death_starts = [8.0, 21.5]
        t, go = make_timeline(b, drain_val=0.0)
        res = special_outcome(a, b, death_starts, t, go, last_ok=30.0)
        self.assertEqual(res['outcome'], 'activated')
        self.assertFalse(res['mid_death'])
        self.assertIsNone(res['drain'])

    def test_case_6_boundary_b_minus_05_and_06(self):
        """(6) 境界: s=b-0.5 は end_death、s=b-0.6 は mid_death"""
        a, b = 10.0, 20.0
        t, go = make_timeline(b, drain_val=0.28)

        # s = b - 0.5 = 19.5 -> end_death
        res_end = special_outcome(a, b, [19.5], t, go, last_ok=30.0)
        self.assertEqual(res_end['outcome'], 'lost_on_death')
        self.assertFalse(res_end['mid_death'])
        self.assertIsNone(res_end['drain'])

        # s = b - 0.6 = 19.4 -> mid_death
        res_mid = special_outcome(a, b, [19.4], t, go, last_ok=30.0)
        self.assertEqual(res_mid['outcome'], 'activated')
        self.assertTrue(res_mid['mid_death'])
        self.assertAlmostEqual(res_mid['drain'], 0.28, places=2)


if __name__ == '__main__':
    unittest.main()
