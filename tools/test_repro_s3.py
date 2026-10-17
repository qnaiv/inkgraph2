#!/usr/bin/env python3
"""Unit and integration tests for tools/repro_s3.py."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from repro_s3 import (
    DEFAULT_THRESHOLDS,
    collect_samples_from_matches,
    compare_samples,
    diff_preds,
    load_pred_file,
    load_samples,
    parse_threshold_override,
    run_evaluation,
)


class TestReproS3Diff(unittest.TestCase):
    """Tests for diff_preds."""

    def test_diff_identical(self):
        pred = {
            'result_screen': {
                'result': 'WIN',
                'mode': 'ガチヤグラ',
                'stage': 'クサヤ温泉',
                'own': {'ka': 4, 'deaths': 6, 'specials': 3},
            },
            'own_deaths': [{'start': 37.0}, {'start': 68.2}],
            'own_kills': [{'start': 123.2}],
            'special': [{'ready': 95.4}],
        }
        ref = {
            'result_screen': {
                'result': 'WIN',
                'mode': 'ガチヤグラ',
                'stage': 'クサヤ温泉',
                'own': {'ka': 4, 'deaths': 6, 'specials': 3},
            },
            'own_deaths': [{'start': 37.1}, {'start': 68.0}],
            'own_kills': [{'start': 123.0}],
            'special': [{'ready': 95.5}],
        }
        diff = diff_preds(pred, ref, tol=0.5)
        self.assertTrue(diff['identical'])
        self.assertEqual(diff['fields'], {})
        self.assertEqual(diff['events']['death']['only_pred'], [])
        self.assertEqual(diff['events']['death']['only_ref'], [])

    def test_diff_different_fields(self):
        pred = {
            'result_screen': {
                'result': 'WIN',
                'mode': 'ガチヤグラ',
                'stage': 'クサヤ温泉',
                'own': {'ka': 4, 'deaths': 6, 'specials': 3},
            },
        }
        ref = {
            'result_screen': {
                'result': 'LOSE',
                'mode': 'ガチエリア',
                'stage': 'クサヤ温泉',
                'own': {'ka': 4, 'deaths': 7, 'specials': 3},
            },
        }
        diff = diff_preds(pred, ref, tol=2.0)
        self.assertFalse(diff['identical'])
        self.assertIn('result', diff['fields'])
        self.assertEqual(diff['fields']['result'], {'pred': 'WIN', 'reference': 'LOSE'})
        self.assertIn('mode', diff['fields'])
        self.assertEqual(diff['fields']['mode'], {'pred': 'ガチヤグラ', 'reference': 'ガチエリア'})
        self.assertIn('own.deaths', diff['fields'])
        self.assertEqual(diff['fields']['own.deaths'], {'pred': 6, 'reference': 7})

    def test_diff_different_events(self):
        pred = {
            'result_screen': {'result': 'WIN'},
            'own_deaths': [{'start': 10.0}, {'start': 20.0}],
            'own_kills': [],
            'special': [],
        }
        ref = {
            'result_screen': {'result': 'WIN'},
            'own_deaths': [{'start': 10.2}, {'start': 40.0}],
            'own_kills': [{'start': 50.0}],
            'special': [],
        }
        diff = diff_preds(pred, ref, tol=1.0)
        self.assertFalse(diff['identical'])
        self.assertEqual(diff['events']['death']['only_pred'], [20.0])
        self.assertEqual(diff['events']['death']['only_ref'], [40.0])
        self.assertEqual(diff['events']['kill']['only_pred'], [])
        self.assertEqual(diff['events']['kill']['only_ref'], [50.0])


class TestReproS3Pack(unittest.TestCase):
    """Tests for learn.js port: compare_samples, thresholds, verdicts."""

    def test_pack_fixed_broken(self):
        # sample 1: mode score 0.45, truth 'A', detected 'A'.
        #   before(0.5): None != 'A' (wrong)
        #   after(0.4): 'A' == 'A' (correct) -> fixed!
        # sample 2: mode score 0.55, truth 'B', detected 'A'.
        #   before(0.5): 'A' != 'B' (wrong)
        #   after(0.4): 'A' != 'B' (wrong) -> unchanged!
        # sample 3: stage score 0.55, truth 'S1', detected 'S1'.
        #   before(0.5): 'S1' == 'S1' (correct)
        #   after(0.6): None != 'S1' (wrong) -> broken!
        samples = [
            {'matchId': 'm1', 'field': 'mode', 'detected': 'A', 'score': 0.45, 'truth': 'A'},
            {'matchId': 'm1', 'field': 'mode', 'detected': 'A', 'score': 0.55, 'truth': 'B'},
            {'matchId': 'm1', 'field': 'stage', 'detected': 'S1', 'score': 0.55, 'truth': 'S1'},
        ]
        res = compare_samples(samples, before={'mode': 0.5, 'stage': 0.5}, after={'mode': 0.4, 'stage': 0.6})
        tot = res['total']
        self.assertEqual(tot['n'], 3)
        self.assertEqual(tot['beforeCorrect'], 1)
        self.assertEqual(tot['afterCorrect'], 1)
        self.assertEqual(tot['fixed'], 1)
        self.assertEqual(tot['broken'], 1)
        self.assertEqual(tot['unchanged'], 1)

        m = res['mode']
        self.assertEqual(m['n'], 2)
        self.assertEqual(m['fixed'], 1)
        self.assertEqual(m['broken'], 0)

        s = res['stage']
        self.assertEqual(s['n'], 1)
        self.assertEqual(s['fixed'], 0)
        self.assertEqual(s['broken'], 1)

    def test_threshold_override(self):
        raw = "mode=0.35,stage=0.65"
        parsed = parse_threshold_override(raw)
        self.assertEqual(parsed, {'mode': 0.35, 'stage': 0.65})

        samples = [
            {'matchId': 'm1', 'field': 'mode', 'detected': 'A', 'score': 0.38, 'truth': 'A'},
        ]
        res = compare_samples(samples, DEFAULT_THRESHOLDS, parsed)
        self.assertEqual(res['mode']['fixed'], 1)

    def test_collect_from_matches(self):
        matches = [
            {
                'id': 'match_01',
                'review': {
                    'rmarks': {'mode': 'ok', 'stage': 'wrong'},
                    'fix': {'stage': 'クサヤ温泉'},
                },
                'result_screen': {
                    'mode': 'ガチヤグラ',
                    'stage': 'マサバ海峡大橋',
                },
                'learnFeatures': [
                    {
                        'v': 1,
                        'header': {
                            'mode': 'ガチヤグラ',
                            'modeScore': 0.85,
                            'stage': 'マサバ海峡大橋',
                            'stageScore': 0.42,
                        },
                    }
                ],
            }
        ]
        samples = collect_samples_from_matches(matches)
        self.assertEqual(len(samples), 2)
        mode_s = next(s for s in samples if s['field'] == 'mode')
        stage_s = next(s for s in samples if s['field'] == 'stage')

        self.assertEqual(mode_s['truth'], 'ガチヤグラ')
        self.assertEqual(mode_s['detected'], 'ガチヤグラ')
        self.assertEqual(mode_s['score'], 0.85)

        self.assertEqual(stage_s['truth'], 'クサヤ温泉')
        self.assertEqual(stage_s['detected'], 'マサバ海峡大橋')
        self.assertEqual(stage_s['score'], 0.42)

    def test_load_samples_formats(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # (a) list of samples
            p_list = os.path.join(tmpdir, 'samples_list.json')
            sample_data = [{'matchId': 'm1', 'field': 'mode', 'detected': 'X', 'score': 0.7, 'truth': 'X'}]
            with open(p_list, 'w') as f:
                json.dump(sample_data, f)
            loaded_a = load_samples(p_list)
            self.assertEqual(len(loaded_a), 1)

            # (b) dict with "samples"
            p_dict = os.path.join(tmpdir, 'samples_dict.json')
            with open(p_dict, 'w') as f:
                json.dump({'samples': sample_data, 'featureVersion': 1}, f)
            loaded_b = load_samples(p_dict)
            self.assertEqual(len(loaded_b), 1)
            self.assertEqual(loaded_b[0].get('v'), 1)

            # (c) dict with "matches"
            p_matches = os.path.join(tmpdir, 'matches.json')
            match_data = {
                'matches': [
                    {
                        'id': 'm2',
                        'review': {'rmarks': {'mode': 'ok'}},
                        'result_screen': {'mode': 'ガチホコ'},
                        'learnFeatures': [{'v': 1, 'header': {'mode': 'ガチホコ', 'modeScore': 0.9}}],
                    }
                ]
            }
            with open(p_matches, 'w') as f:
                json.dump(match_data, f)
            loaded_c = load_samples(p_matches)
            self.assertEqual(len(loaded_c), 1)
            self.assertEqual(loaded_c[0]['truth'], 'ガチホコ')


class TestReproS3PredLoader(unittest.TestCase):
    """Tests for load_pred_file."""

    def test_load_pred_file_dict_and_list(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Single dict
            p_dict = os.path.join(tmpdir, 'pred_single.json')
            with open(p_dict, 'w') as f:
                json.dump({'result_screen': {'result': 'WIN'}}, f)
            pred = load_pred_file(p_dict, 'any.mp4')
            self.assertEqual(pred['result_screen']['result'], 'WIN')

            # List with matching video name
            p_list = os.path.join(tmpdir, 'pred_list.json')
            with open(p_list, 'w') as f:
                json.dump([
                    {'source': {'name': 'match01.mp4'}, 'match': 1, 'result_screen': {'result': 'LOSE'}},
                    {'source': {'name': 'match02.mp4'}, 'match': 2, 'result_screen': {'result': 'WIN'}},
                ], f)
            pred1 = load_pred_file(p_list, 'match01.mp4')
            self.assertEqual(pred1['result_screen']['result'], 'LOSE')
            pred2 = load_pred_file(p_list, 'match02.mp4')
            self.assertEqual(pred2['result_screen']['result'], 'WIN')


class TestReproS3Integration(unittest.TestCase):
    """Integration tests with CLI and existing repository files."""

    def test_eval_integration_with_joined_match02(self):
        label_file = os.path.join(ROOT, 'labels', 'joined_match02.json')
        pred_file = os.path.join(ROOT, 'out', '1080p', 'match02', 'timeline.json')
        if not os.path.exists(label_file) or not os.path.exists(pred_file):
            self.skipTest("joined_match02.json or python pred timeline not present")

        with open(label_file, 'r', encoding='utf-8') as f:
            lab = json.load(f)

        def resolver(_):
            return load_pred_file(pred_file), "python"

        res = run_evaluation([lab], resolver, tol=2.0)
        self.assertIn('joined_match02.mp4', res['matches'])
        # match02 result_screen should match WIN
        win_row = next(r for r in res['matches']['joined_match02.mp4'] if r['item'] == '勝敗')
        self.assertEqual(win_row['tp'], 1)
        self.assertEqual(win_row['fp'], 0)

    def test_cli_full_run_synthetic(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = os.path.join(tmpdir, 'out_repro')
            samples_file = os.path.join(tmpdir, 'samples.json')
            pack_file = os.path.join(tmpdir, 'pack.json')
            expected_file = os.path.join(tmpdir, 'expected.json')
            labels_file = os.path.join(tmpdir, 'label.json')
            pred_file = os.path.join(tmpdir, 'pred.json')

            # Samples
            samples_data = [
                {'matchId': 'm1', 'field': 'mode', 'detected': 'ガチヤグラ', 'score': 0.6, 'truth': 'ガチヤグラ', 'v': 1},
                {'matchId': 'm1', 'field': 'stage', 'detected': 'クサヤ温泉', 'score': 0.4, 'truth': 'クサヤ温泉', 'v': 1},
            ]
            with open(samples_file, 'w') as f:
                json.dump({'samples': samples_data, 'featureVersion': 1}, f)

            # Pack
            pack_data = {
                'packId': 'lp-test-01',
                'featureVersion': 1,
                'thresholds': {'mode': 0.5, 'stage': 0.3},
            }
            with open(pack_file, 'w') as f:
                json.dump(pack_data, f)

            # Expected (at thr mode=0.5, stage=0.3: both are correct. before(0.5): stage wrong, mode correct. fixed=1, broken=0, n=2, afterCorrect=2)
            expected_data = {
                'total': {
                    'n': 2,
                    'afterCorrect': 2,
                    'fixed': 1,
                    'broken': 0,
                }
            }
            with open(expected_file, 'w') as f:
                json.dump(expected_data, f)

            # Pred & Label
            with open(pred_file, 'w') as f:
                json.dump({
                    'result_screen': {'result': 'WIN', 'mode': 'ガチヤグラ', 'stage': 'クサヤ温泉'},
                    'own_deaths': [{'start': 30.0}],
                    'own_kills': [{'start': 50.0}],
                    'special': [{'ready': 90.0}],
                }, f)

            with open(labels_file, 'w') as f:
                json.dump({
                    'video': 'test_video.mp4',
                    'match_id': 'm1',
                    'result': 'WIN',
                    'mode': 'ガチヤグラ',
                    'stage': 'クサヤ温泉',
                    'own': {'ka': None, 'deaths': None, 'specials': None},
                    'count_final': None,
                    'events': {
                        'death': {'times': [30.0], 'status': 'complete', 'unreviewed': []},
                        'kill': {'times': [50.0], 'status': 'complete', 'unreviewed': []},
                        'special': {'times': [90.0], 'status': 'complete', 'unreviewed': []},
                    },
                }, f)

            cmd = [
                sys.executable,
                os.path.join(HERE, 'repro_s3.py'),
                '--videos', 'test_video.mp4',
                '--pred', pred_file,
                '--reference', pred_file,
                '--labels', labels_file,
                '--samples', samples_file,
                '--pack', pack_file,
                '--expected', expected_file,
                '--out-dir', out_dir,
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(res.returncode, 0, f"CLI stderr: {res.stderr}")

            # Check report.json
            rep_json_p = os.path.join(out_dir, 'report.json')
            self.assertTrue(os.path.exists(rep_json_p))
            with open(rep_json_p) as f:
                rep_json = json.load(f)
            self.assertEqual(rep_json['pack']['verdict'], '一致')
            self.assertTrue(rep_json['detector']['matches']['test_video.mp4']['identical'])

            # Check report.md
            rep_md_p = os.path.join(out_dir, 'report.md')
            self.assertTrue(os.path.exists(rep_md_p))
            with open(rep_md_p) as f:
                md_text = f.read()
            self.assertIn('完全一致', md_text)
            self.assertIn('lp-test-01', md_text)
            self.assertIn('一致', md_text)

    def test_version_mismatch_verdict(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = os.path.join(tmpdir, 'out_repro')
            samples_file = os.path.join(tmpdir, 'samples.json')
            pack_file = os.path.join(tmpdir, 'pack.json')

            # Samples with version 2
            with open(samples_file, 'w') as f:
                json.dump([
                    {'matchId': 'm1', 'field': 'mode', 'detected': 'ガチヤグラ', 'score': 0.6, 'truth': 'ガチヤグラ', 'v': 2}
                ], f)

            # Pack with version 1
            with open(pack_file, 'w') as f:
                json.dump({'packId': 'lp-v1', 'featureVersion': 1, 'thresholds': {'mode': 0.5, 'stage': 0.5}}, f)

            cmd = [
                sys.executable,
                os.path.join(HERE, 'repro_s3.py'),
                '--samples', samples_file,
                '--pack', pack_file,
                '--out-dir', out_dir,
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(res.returncode, 0)
            rep_json_p = os.path.join(out_dir, 'report.json')
            with open(rep_json_p) as f:
                rep_json = json.load(f)
            self.assertEqual(rep_json['pack']['verdict'], '再現不可')
            self.assertIn('バージョン不一致', rep_json['pack']['reason'])

    def test_without_expected_verdict(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = os.path.join(tmpdir, 'out_repro')
            samples_file = os.path.join(tmpdir, 'samples.json')
            pack_file = os.path.join(tmpdir, 'pack.json')

            with open(samples_file, 'w') as f:
                json.dump([
                    {'matchId': 'm1', 'field': 'mode', 'detected': 'ガチヤグラ', 'score': 0.6, 'truth': 'ガチヤグラ', 'v': 1}
                ], f)

            with open(pack_file, 'w') as f:
                json.dump({'packId': 'lp-v1', 'featureVersion': 1, 'thresholds': {'mode': 0.5, 'stage': 0.5}}, f)

            cmd = [
                sys.executable,
                os.path.join(HERE, 'repro_s3.py'),
                '--samples', samples_file,
                '--pack', pack_file,
                '--out-dir', out_dir,
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(res.returncode, 0)
            rep_json_p = os.path.join(out_dir, 'report.json')
            with open(rep_json_p) as f:
                rep_json = json.load(f)
            self.assertEqual(rep_json['pack']['verdict'], '自己完結（端末レポート未指定）')

    def test_cli_input_error_exit_2(self):
        cmd = [
            sys.executable,
            os.path.join(HERE, 'repro_s3.py'),
            '--pack', 'non_existent_pack.json',
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(res.returncode, 2)


if __name__ == '__main__':
    unittest.main()
