// fix_pack_check.mjs: D75 要修正パックの純関数（印の付け外し・差分・コマの時刻・要約）
import { flagMatch, diffOf, frameTimes, matchSummary, safeId, fixPackFilename } from '../src/fix_pack.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const mk = () => ({ id: 's#3', created: '2026-10-28T10:00:00Z', battle: [100, 400], match_type: 'x',
  own_deaths: [{ start: 120, end: 122, conf: 0.9 }, { start: 200, end: 202, conf: 0.4, auto: 'added' }], own_kills: [{ start: 150, end: 151, conf: 0.8 }], special: [{ ready: 180, end: 230, outcome: 'activated', activated_at: 230 }],
  result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'ヒラメが丘団地', own: { ka: 5, deaths: 2, specials: 1 } },
  recording: { path: '/v/a.mp4', file: 'a.mp4', t0: 99.5 },
  review: { marks: { 'death@120.0': 'ok', 'death@200.0': 'wrong' }, added: [{ kind: 'kill', t: 300.04 }], fix: { deaths: 1, stage: 'マテガイ放水路' }, rmarks: { deaths: 'wrong', stage: 'wrong', ka: 'wrong' } } });
const m = mk();
flagMatch(m, true, ['death', 'death', 'kill']); check(m.needs_fix && m.needs_fix.reasons.length === 2 && !!m.needs_fix.at, '(1) 要修正の印を付ける（理由は重ねない）', JSON.stringify(m.needs_fix));
const at = m.needs_fix.at; flagMatch(m, true, ['result']); check(m.needs_fix.at === at && m.needs_fix.reasons[0] === 'result', '(2) 付け直しても最初の日時を保つ');
flagMatch(m, false); check(!('needs_fix' in m), '(3) 外すと消える');
const d = diffOf(mk());
check(d.false_positives.length === 1 && d.false_positives[0].kind === 'death' && d.false_positives[0].rel === 100, '(4) ✗を付けた検出が誤検出に入る（バトル開始からの秒も）', JSON.stringify(d.false_positives));
check(d.misses.length === 1 && d.misses[0].kind === 'kill' && d.misses[0].t === 300 && d.misses[0].rel === 200, '(5) 追加した見逃しが入る', JSON.stringify(d.misses));
check(d.confirmed.length === 1 && d.unreviewed === 2, '(6) ✓は合っていた検出、印の無いものは未確認', `confirmed ${d.confirmed.length}, unreviewed ${d.unreviewed}`);
check(d.result_fixes.length === 2 && d.result_fixes.find(x => x.field === 'deaths').software === 2 && d.result_fixes.find(x => x.field === 'deaths').human === 1 && d.result_fixes.find(x => x.field === 'stage').software === 'ヒラメが丘団地' && JSON.stringify(d.result_wrong_without_value) === '["ka"]', '(7) 結果画面の読み違い（ソフトの値→人の値）。値を入れていない ✗ は別に出る', JSON.stringify(d.result_fixes));
const ft = frameTimes(mk(), d, { win: 3, step: 0.5 });
check(ft.length === 26 && ft[0] === 197 && ft.at(-1) === 303 && ft.every((t, i) => i === 0 || t > ft[i - 1]), '(8) コマの時刻は、差分の前後 ±3 秒を 0.5 秒おき（昇順・重複なし）', `${ft.length} 枚 ${ft[0]}〜${ft.at(-1)}`);
check(frameTimes(mk(), d, { whole: true, wholeStep: 1 }).length > 280, '(9) 試合全体（1 秒おき）も入れられる');
const sm = matchSummary(Object.assign(mk(), { needs_fix: { at: 'x', reasons: ['kill', 'rule'] } }));
check(sm.software_detected.deaths.length === 2 && sm.software_detected.deaths[1].auto === 'added' && sm.result_after_human_fix.deaths === 1 && sm.flagged.reasons.join() === 'キル数,ルール・ステージ' && sm.recording.t0 === 99.5, '(10) 要約: ソフトの検出・人が直したあとの値・理由・録画の開始時刻', JSON.stringify(sm.flagged));
check(safeId('2026-10-28T10:00:00.000Z#3') === '2026_10_28T10_00_00_000Z_3' && /^ink-graph_要修正_\d{8}-\d{4}\.zip$/.test(fixPackFilename(new Date(2026, 9, 28, 21, 5))), '(11) フォルダ名・zip 名');
process.exit(fails ? 1 : 0);
