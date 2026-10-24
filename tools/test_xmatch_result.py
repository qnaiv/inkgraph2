"""Unit tests for X-match result screen panel detection and header withholding."""
import os, sys, unittest
import numpy as np
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'src'))

from inkgraph import result
from inkgraph.common import tpl, W, H

class TestXmatchResult(unittest.TestCase):
    def test_panel_match_x(self):
        # 黒地に tpl_res_lobby_x を (550, 25) に貼る
        img = np.zeros((H, W, 3), dtype=np.uint8)
        tx = tpl('tpl_res_lobby_x.png')
        self.assertIsNotNone(tx, 'tpl_res_lobby_x.png must exist')
        th, tw = tx.shape[:2]
        img[25:25+th, 550:550+tw] = cv2.cvtColor(tx, cv2.COLOR_GRAY2BGR)

        score, dx, dy, panel = result.panel_match(img)
        self.assertGreater(score, 0.9)
        self.assertEqual(dx, 0)
        self.assertEqual(dy, 0)
        self.assertEqual(panel, 'x')

        # panel_offset 互換性チェック
        s, off_dx, off_dy = result.panel_offset(img)
        self.assertAlmostEqual(s, score)
        self.assertEqual(off_dx, 0)
        self.assertEqual(off_dy, 0)

        # classify チェック
        kind, c_panel, off = result.classify(img)
        self.assertIn(kind, ('personal', 'board'))
        self.assertEqual(c_panel, 'x')
        self.assertEqual(off, (0, 0))

    def test_panel_match_bankara(self):
        # 黒地に tpl_res_lobby を (550, 25) に貼る
        img = np.zeros((H, W, 3), dtype=np.uint8)
        tb = tpl('tpl_res_lobby.png')
        self.assertIsNotNone(tb, 'tpl_res_lobby.png must exist')
        th, tw = tb.shape[:2]
        img[25:25+th, 550:550+tw] = cv2.cvtColor(tb, cv2.COLOR_GRAY2BGR)

        score, dx, dy, panel = result.panel_match(img)
        self.assertGreater(score, 0.9)
        self.assertEqual(dx, 0)
        self.assertEqual(dy, 0)
        self.assertEqual(panel, 'bankara')

        # panel_offset 互換性チェック
        s, off_dx, off_dy = result.panel_offset(img)
        self.assertAlmostEqual(s, score)
        self.assertEqual(off_dx, 0)
        self.assertEqual(off_dy, 0)

        # classify チェック
        kind, c_panel, off = result.classify(img)
        self.assertIn(kind, ('personal', 'board'))
        self.assertEqual(c_panel, 'bankara')
        self.assertEqual(off, (0, 0))

    def test_read_header_withheld_on_x(self):
        dummy = np.zeros((H, W, 3), dtype=np.uint8)
        # panel='x' の場合: mode/stage は None、withheld は True、match_type は 'x'
        hx = result.read_header(dummy, 0, 0, panel='x')
        self.assertIsNone(hx['mode'])
        self.assertIsNone(hx['stage'])
        self.assertEqual(hx['match_type'], 'x')
        self.assertTrue(hx['withheld'])
        self.assertIsInstance(hx['mode_score'], float)
        self.assertIsInstance(hx['stage_score'], float)

        # panel=None の場合: withheld は False、match_type は None
        hn = result.read_header(dummy, 0, 0, panel=None)
        self.assertFalse(hn['withheld'])
        self.assertIsNone(hn['match_type'])

if __name__ == '__main__':
    unittest.main()
