#!/usr/bin/env python3
"""Unit tests for tools/eval_ci.py."""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import eval_ci


class TestEvalCI(unittest.TestCase):

    def test_evaluate_joined_match02(self):
        """Test evaluation using existing labels/joined_match02.json and python detector output."""
        label_file = os.path.join(ROOT, 'labels', 'joined_match02.json')
        with open(label_file, 'r', encoding='utf-8') as f:
            lab = json.load(f)

        res = eval_ci.evaluate_all([lab], pred_spec='python', tol=2.0)
        totals = res['totals']

        # デス/キル/スペシャル/勝敗の合計 precision/recall が数値であること
        for item in ('デス', 'キル', 'スペシャル', '勝敗'):
            self.assertIsNotNone(
                totals.get(item), f"Total for {item} should not be None"
            )
            prec = totals[item]['precision']
            rec = totals[item]['recall']
            self.assertIsInstance(
                prec, (int, float), f"precision for {item} should be a number"
            )
            self.assertIsInstance(
                rec, (int, float), f"recall for {item} should be a number"
            )

        # デスが (tp=4, fp=0, fn=0) であること
        death = totals['デス']
        self.assertEqual(death['tp'], 4)
        self.assertEqual(death['fp'], 0)
        self.assertEqual(death['fn'], 0)
        self.assertEqual(death['precision'], 1.0)
        self.assertEqual(death['recall'], 1.0)

        # ラベルなし項目 (ヤグラ保持など) が集計で null/除外になること
        self.assertIsNone(totals['ヤグラ保持(味方)'])
        self.assertIsNone(totals['ヤグラ保持(相手)'])
        self.assertIsNone(totals['最終カウント'])
        self.assertIsNone(totals['カウント系列'])

    def test_compare_baseline(self):
        """Test baseline comparison logic.

        - 現在値0.5 / 基準1.0 を渡して警告が1件以上返ること
        - 現在値 >= 基準 なら警告ゼロであること
        """
        # Case 1: current 0.5 < baseline 1.0 -> 警告が1件以上返ること
        totals_low = {
            'デス': {
                'tp': 1,
                'fp': 1,
                'fn': 1,
                'precision': 0.5,
                'recall': 0.5,
            },
            'キル': {
                'tp': 1,
                'fp': 0,
                'fn': 0,
                'precision': 1.0,
                'recall': 1.0,
            },
            'スペシャル': {
                'tp': 1,
                'fp': 0,
                'fn': 0,
                'precision': 1.0,
                'recall': 1.0,
            },
            '勝敗': {
                'tp': 1,
                'fp': 0,
                'fn': 0,
                'precision': 1.0,
                'recall': 1.0,
            },
        }
        baseline = {
            'metrics': {
                'デス': {'precision': 1.0, 'recall': 1.0},
                'キル': {'precision': 1.0, 'recall': 1.0},
                'スペシャル': {'precision': 1.0, 'recall': 1.0},
                '勝敗': {'precision': 1.0, 'recall': 1.0},
            }
        }
        warnings, notes = eval_ci.compare_baseline(totals_low, baseline)
        self.assertGreaterEqual(
            len(warnings), 1, 'Should return at least 1 warning for regression'
        )
        self.assertTrue(
            any('デス' in w for w in warnings),
            'Warning message should mention デス',
        )
        self.assertTrue(
            any('0.500 < 基準 1.000' in w for w in warnings),
            'Warning message should show current < baseline values',
        )

        # Case 2: current >= baseline -> 警告ゼロであること
        totals_ok = {
            'デス': {
                'tp': 1,
                'fp': 0,
                'fn': 0,
                'precision': 1.0,
                'recall': 1.0,
            },
            'キル': {
                'tp': 1,
                'fp': 0,
                'fn': 0,
                'precision': 1.0,
                'recall': 1.0,
            },
            'スペシャル': {
                'tp': 1,
                'fp': 0,
                'fn': 0,
                'precision': 1.0,
                'recall': 1.0,
            },
            '勝敗': {
                'tp': 1,
                'fp': 0,
                'fn': 0,
                'precision': 1.0,
                'recall': 1.0,
            },
        }
        warnings_ok, _ = eval_ci.compare_baseline(totals_ok, baseline)
        self.assertEqual(len(warnings_ok), 0, 'No warning when current >= baseline')

    def test_empty_labels_dir(self):
        """Test handling of directory with 0 label files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            labels = eval_ci.load_label_files(tmpdir)
            self.assertEqual(len(labels), 0)

            res = eval_ci.evaluate_all(labels, pred_spec='python')
            self.assertEqual(len(res['matches']), 0)
            for item in eval_ci.ITEM_ORDER:
                self.assertIsNone(res['totals'][item])

            # Running main with empty dir should exit 0 and write empty outputs
            md_path = os.path.join(tmpdir, 'empty_summary.md')
            json_path = os.path.join(tmpdir, 'empty_result.json')
            code = eval_ci.main([
                '--labels-dir',
                tmpdir,
                '--md',
                md_path,
                '--json',
                json_path,
            ])
            self.assertEqual(code, 0)
            self.assertTrue(os.path.exists(md_path))
            self.assertTrue(os.path.exists(json_path))

            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.assertEqual(len(data['warnings']), 1)
            self.assertIn('ラベルファイルが見つかりません', data['warnings'][0])
            for item in eval_ci.ITEM_ORDER:
                self.assertIsNone(data['total'][item])

    def test_cli_execution_and_file_outputs(self):
        """Test full CLI execution writing artifacts to temp directory only."""
        with tempfile.TemporaryDirectory() as tmpdir:
            md_path = os.path.join(tmpdir, 'summary.md')
            json_path = os.path.join(tmpdir, 'result.json')
            base_path = os.path.join(tmpdir, 'baseline.json')

            # 1. Update baseline
            code = eval_ci.main([
                '--labels-dir',
                os.path.join(ROOT, 'labels'),
                '--pred',
                'python',
                '--baseline',
                base_path,
                '--update-baseline',
                '--md',
                md_path,
                '--json',
                json_path,
            ])
            self.assertEqual(code, 0)
            self.assertTrue(os.path.exists(base_path))
            self.assertTrue(os.path.exists(md_path))
            self.assertTrue(os.path.exists(json_path))

            with open(base_path, 'r', encoding='utf-8') as f:
                base_data = json.load(f)
            self.assertIn('metrics', base_data)
            self.assertEqual(base_data['metrics']['デス']['precision'], 1.0)

            # 2. Normal run using the generated baseline -> 0 warnings
            code2 = eval_ci.main([
                '--labels-dir',
                os.path.join(ROOT, 'labels'),
                '--pred',
                'python',
                '--baseline',
                base_path,
                '--md',
                md_path,
                '--json',
                json_path,
            ])
            self.assertEqual(code2, 0)
            with open(json_path, 'r', encoding='utf-8') as f:
                res_data = json.load(f)
            self.assertEqual(len(res_data['warnings']), 0)
            self.assertEqual(res_data['total']['デス']['tp'], 4)


if __name__ == '__main__':
    unittest.main()
