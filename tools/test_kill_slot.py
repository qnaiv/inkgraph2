"""Unit tests for kill notice vertical slot splitting (issue #140)."""
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

from inkgraph.detect import kill_events_from_slots


class TestKillSlot(unittest.TestCase):
    def test_single_slot0_continuous_3s(self):
        """single slot0 continuous 3s => 1 event, no false split."""
        t = [round(i * 0.2, 1) for i in range(25)]  # 0.0 to 4.8s
        # slot0 active from 1.0s to 4.0s (3.0s duration)
        slots = [[bool(1.0 <= ti <= 4.0)] for ti in t]
        events = kill_events_from_slots(t, slots)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0], {'start': 1.0, 'end': 4.0})

    def test_stacking_2(self):
        """stacking 2: slot0 continuous from t=1 (kill1 then kill2 occupies bottom without gap), slot1 from t=2 => total 2 events."""
        t = [round(i * 0.2, 1) for i in range(30)]  # 0.0 to 5.8s
        # slot0 continuous from 1.0s to 5.0s
        # slot1 active from 2.0s to 4.0s
        slots = [[bool(1.0 <= ti <= 5.0), bool(2.0 <= ti <= 4.0)] for ti in t]
        events = kill_events_from_slots(t, slots)
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0], {'start': 1.0, 'end': 5.0})
        self.assertEqual(events[1], {'start': 2.0, 'end': 4.0})

    def test_four_simultaneous(self):
        """4 simultaneous: slots0-3 all start same t => 4 events."""
        t = [round(i * 0.2, 1) for i in range(25)]  # 0.0 to 4.8s
        # slots 0..3 all active from 1.0s to 3.0s
        slots = [[bool(1.0 <= ti <= 3.0)] * 4 for ti in t]
        events = kill_events_from_slots(t, slots)
        self.assertEqual(len(events), 4)
        for e in events:
            self.assertEqual(e, {'start': 1.0, 'end': 3.0})

    def test_four_staggered_stacking(self):
        """4 staggered stacking => 4 events."""
        t = [round(i * 0.2, 1) for i in range(35)]  # 0.0 to 6.8s
        slots = [
            [
                bool(1.0 <= ti <= 4.0),
                bool(1.6 <= ti <= 4.0),
                bool(2.2 <= ti <= 4.0),
                bool(2.8 <= ti <= 4.0),
            ]
            for ti in t
        ]
        events = kill_events_from_slots(t, slots)
        self.assertEqual(len(events), 4)
        starts = [e['start'] for e in events]
        self.assertEqual(starts, [1.0, 1.6, 2.2, 2.8])
        for e in events:
            self.assertEqual(e['end'], 4.0)

    def test_gap_merging_and_minlen(self):
        """gap merging: slot flicker gap 0.4s within same slot => still 1 (runs gap1.0), and a slot signal shorter than 0.2 minlen dropped if applicable."""
        t = [round(i * 0.2, 1) for i in range(30)]  # 0.0 to 5.8s
        slots = [
            [
                # slot0: active 1.0..2.0, gap 2.2..2.4 (0.4s), active 2.6..3.6 -> merged into 1 event
                bool((1.0 <= ti <= 2.0) or (2.6 <= ti <= 3.6)),
                # slot1: single frame at 1.0s -> duration 0.0s < 0.2s minlen -> dropped
                bool(ti == 1.0),
            ]
            for ti in t
        ]
        events = kill_events_from_slots(t, slots)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0], {'start': 1.0, 'end': 3.6})

    def test_differing_frame_lengths_and_empty(self):
        """Missing slot in shorter frame is treated as False, and empty returns empty."""
        self.assertEqual(kill_events_from_slots([], []), [])
        t = [0.0, 0.2, 0.4, 0.6]
        slots = [[True], [True, True], [True], []]
        # slot 0 active 0.0..0.4 (dur 0.4 >= 0.2)
        # slot 1 active only at 0.2 (dur 0.0 < 0.2) -> dropped
        events = kill_events_from_slots(t, slots)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0], {'start': 0.0, 'end': 0.4})


if __name__ == '__main__':
    unittest.main()
