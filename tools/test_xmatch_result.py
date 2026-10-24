"""Unit tests for X-match result screen panel detection, mode/stage reading, and guard rules."""
import os, sys, unittest
import numpy as np
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'src'))

from inkgraph import result, detect
from inkgraph.common import tpl, W, H, TPL, imread_unicode

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

    def test_read_header_hoko_x(self):
        # (a) 黒地 1280x720 に tpl_res_lobby_x を (550,25) に貼り、
        # MODE_BOX にテンプレ ガチホコバトル__xh2 を、STAGE_BOX を+38px ずらした位置にタカアシ経済特区__xh2 を貼る
        img = np.zeros((H, W, 3), dtype=np.uint8)
        tx = tpl('tpl_res_lobby_x.png')
        th, tw = tx.shape[:2]
        img[25:25+th, 550:550+tw] = cv2.cvtColor(tx, cv2.COLOR_GRAY2BGR)

        t_mode = imread_unicode(os.path.join(TPL, 'res_mode', 'ガチホコバトル__xh2.png'))
        t_stage = imread_unicode(os.path.join(TPL, 'res_stage', 'タカアシ経済特区__xh2.png'))
        img[50:84, 552:650] = cv2.cvtColor(t_mode, cv2.COLOR_GRAY2BGR) if t_mode.ndim == 2 else t_mode
        img[52:84, 693:838] = cv2.cvtColor(t_stage, cv2.COLOR_GRAY2BGR) if t_stage.ndim == 2 else t_stage

        h = result.read_header(img, 0, 0, panel='x')
        self.assertEqual(h['mode'], 'ガチホコバトル')
        self.assertEqual(h['stage'], 'タカアシ経済特区')
        self.assertEqual(h['match_type'], 'x')
        self.assertNotIn('withheld', h)

    def test_read_header_yagura_x(self):
        # (b) ガチヤグラ__xy4 とヤガラ市場__xy4（ずらし0）
        img = np.zeros((H, W, 3), dtype=np.uint8)
        tx = tpl('tpl_res_lobby_x.png')
        th, tw = tx.shape[:2]
        img[25:25+th, 550:550+tw] = cv2.cvtColor(tx, cv2.COLOR_GRAY2BGR)

        t_mode = imread_unicode(os.path.join(TPL, 'res_mode', 'ガチヤグラ__xy4.png'))
        t_stage = imread_unicode(os.path.join(TPL, 'res_stage', 'ヤガラ市場__xy4.png'))
        img[50:84, 552:650] = cv2.cvtColor(t_mode, cv2.COLOR_GRAY2BGR) if t_mode.ndim == 2 else t_mode
        img[52:84, 655:800] = cv2.cvtColor(t_stage, cv2.COLOR_GRAY2BGR) if t_stage.ndim == 2 else t_stage

        h = result.read_header(img, 0, 0, panel='x')
        self.assertEqual(h['mode'], 'ガチヤグラ')
        self.assertEqual(h['stage'], 'ヤガラ市場')
        self.assertEqual(h['match_type'], 'x')

    def test_read_header_mode_margin_guard(self):
        # (c) MODE_BOX に ガチヤグラ__xy4 と ガチホコバトル__xh2 を混ぜた画像（margin < 0.1）-> mode None
        t_mode_yag = imread_unicode(os.path.join(TPL, 'res_mode', 'ガチヤグラ__xy4.png'))
        t_mode_hoko = imread_unicode(os.path.join(TPL, 'res_mode', 'ガチホコバトル__xh2.png'))
        mixed = np.zeros_like(t_mode_yag)
        mixed[:, :60] = t_mode_yag[:, :60]
        mixed[:, 60:] = t_mode_hoko[:, 60:]

        img = np.zeros((H, W, 3), dtype=np.uint8)
        img[50:84, 552:650] = cv2.cvtColor(mixed, cv2.COLOR_GRAY2BGR) if mixed.ndim == 2 else mixed

        h = result.read_header(img, 0, 0)
        self.assertIsNotNone(h['mode_margin'])
        self.assertLess(h['mode_margin'], 0.1)
        self.assertIsNone(h['mode'])

    def test_is_tower_rule(self):
        # (d) detect.is_tower_rule: 'ガチヤグラ' True、'ガチホコバトル'/None False
        self.assertTrue(detect.is_tower_rule('ガチヤグラ'))
        self.assertFalse(detect.is_tower_rule('ガチホコバトル'))
        self.assertFalse(detect.is_tower_rule('ガチエリア'))
        self.assertFalse(detect.is_tower_rule(None))

if __name__ == '__main__':
    unittest.main()
