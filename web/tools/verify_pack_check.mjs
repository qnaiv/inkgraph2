// D67: 検証パック（verify_pack.js）と検証録画の DB の確認
import * as VP from '../src/verify_pack.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const rec = { id: 's#3', match: 3, battle: [10, 310], match_type: 'X', result_screen: { result: 'WIN', mode: 'area', stage: 'ヒラメが丘団地', own: { ka: 5, deaths: 2, specials: 1 } },
  own_deaths: [{ start: 50, end: 52, conf: 0.9 }], own_kills: [{ start: 60, conf: 0.8 }], special: [{ ready: 70, end: 90, outcome: 'activated', activated_at: 90 }], review: { marks: {} } };
const s = VP.softwareSummary(rec);
ok(s.deaths.length === 1 && s.kills.length === 1 && s.specials.length === 1, '検出の件数');
ok(s.result_screen_counts.deaths === 2 && s.result === 'WIN' && s.stage === 'ヒラメが丘団地' && s.rule === 'area', '結果画面の値とルール・ステージ');
ok(VP.fullName(12.4) === 'frames/full/f_0012.40.webp', '全コマ名 ' + VP.fullName(12.4));
ok(VP.clipName(3, 5) === 'frames/clips/c03_0005.00.webp', 'クリップ名');
const meta = VP.buildVerifyMeta(rec, { full: [{ time: 1, file: 'a' }], clips: [], stills: [], params: null, exportedAt: 'x', step: 0.4 });
ok(meta.full.count === 1 && /全コマ: 1枚/.test(VP.verifyReadme(meta)), 'README');
ok(/検証_.*試合3\.zip$/.test(VP.verifyFilename(rec, new Date(2026, 9, 27, 21, 5))), 'zip名 ' + VP.verifyFilename(rec, new Date(2026, 9, 27, 21, 5)));
process.exit(fail ? 1 : 0);
