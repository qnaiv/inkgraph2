// cloud_sync_check.mjs: D58 クラウド同期（端末が主・数値と時刻だけ・新しい方が勝ち）。Supabase は手元のメモリ上の偽物で、ネットワークは使わない。
import { createSync } from '../src/cloud/sync.js';
import { slimMatch, isSyncable, toRow, isDirty, mergeRemote, LOCAL_ONLY, MAX_BYTES } from '../src/cloud/slim.js';
let fails = 0;
const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };

// --- 偽の Supabase（1 ユーザー分。inkgraph_matches と inkgraph_settings だけ） ---
function fakeCloud({ signedIn = true, failOn = null } = {}) {
  const rows = new Map(), settings = new Map(); const user = { id: 'u1' };
  const client = {
    auth: { getSession: async () => ({ data: { session: signedIn ? { user } : null } }) },
    from: table => {
      if (table === 'inkgraph_settings') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: settings.get('u1') || null, error: null }) }) }), upsert: async r => { if (failOn === 'settings') return { error: { message: 'boom' } }; settings.set(r.user_id, r); return { error: null }; } };
      const q = { _gte: null, _off: 0, _end: 1e9 };
      const api = { select: () => api, order: () => api, gte: (_, v) => { q._gte = v; return api; }, range: (a, b) => { q._off = a; q._end = b; return api; },
        then: (res, rej) => { if (failOn === 'select') return Promise.resolve({ data: null, error: { message: 'select failed' } }).then(res, rej);
          let v = [...rows.values()].sort((a, b) => a.updated_at.localeCompare(b.updated_at)); if (q._gte) v = v.filter(r => r.updated_at >= q._gte); return Promise.resolve({ data: v.slice(q._off, q._end + 1), error: null }).then(res, rej); },
        upsert: async rs => { if (failOn === 'upsert') return { error: { message: 'upsert failed' } }; for (const r of rs) rows.set(r.user_id + '/' + r.id, r); return { error: null }; } };
      return api;
    } };
  return { client, rows, settings };
}
// --- 偽の端末（IndexedDB の代わり。db.js の putMatch / delMatch と同じ約束：putMatch は updated を付け、keepUpdated なら付けない） ---
let clock = 1000; const now = () => new Date(Date.UTC(2026, 9, 26, 12, 0, 0) + (clock++) * 1000).toISOString();
function fakeDevice(name) {
  const ms = new Map(), dels = []; let state = {}, params = null;
  const d = { name, ms,
    allMatches: async () => [...ms.values()].map(m => JSON.parse(JSON.stringify(m))), getMatch: async id => (ms.has(id) ? JSON.parse(JSON.stringify(ms.get(id))) : undefined),
    putMatch: async (m, o = {}) => { if (!o.keepUpdated) m.updated = now(); ms.set(m.id, JSON.parse(JSON.stringify(m))); },
    delMatch: async (id, o = {}) => { if (!o.fromCloud) dels.push({ id, at: now() }); ms.delete(id); },
    pendingDeletes: () => [...dels], clearPendingDeletes: ids => { for (const id of ids) { const i = dels.findIndex(x => x.id === id); if (i >= 0) dels.splice(i, 1); } },
    loadState: () => state, saveState: s => { state = s; }, getDetectParams: () => params, setDetectParams: p => { params = p; }, setParams: p => { params = p; } };
  return d;
}
const mk = (id, extra = {}) => ({ id, match: 1, created: '2026-10-26T10:00:00.000Z', battle: [0, 100], own_deaths: [{ start: 10, end: 12 }], own_kills: [], special: [], result_screen: { result: 'WIN', mode: 'ガチヤグラ', stage: 'クサヤ温泉', own: { ka: 5, deaths: 1, specials: 1 } },
  source: { kind: 'file', owner: 'self', height: 1080 }, review: { marks: {}, added: [], fix: {} }, cues: { n: 3000, t: 'x'.repeat(40000) }, tower_rows: [{ t: 1 }], learnFeatures: [{}], stills: { count: 9, bytes: 9 }, stillsState: 'kept', video: { kind: 'none' }, ...extra });

console.log('--- 切り出し（slim） ---');
{
  const m = mk('a#1'); const s = slimMatch(m);
  check(LOCAL_ONLY.every(k => !(k in s)) && s.own_deaths && s.result_screen && s.review, '(1) 端末専用の項目（cues・静止画・クリップ・生データ）は送らず、数値と時刻は送る');
  check(JSON.stringify(s).length < 3000 && JSON.stringify(m).length > 40000, '(2) 40KB 超の試合が数 KB になる', `${JSON.stringify(m).length} → ${JSON.stringify(s).length} bytes`);
  check(isSyncable(m) && !isSyncable(mk('v#1', { source: { owner: 'other' } })), '(3) 他人の試合（検証用）は同期しない');
  check(toRow(mk('big', { review: { marks: {}, added: [], fix: {}, memo: 'x'.repeat(MAX_BYTES + 10) } })) === null, '(4) 上限を超える試合は送らない');
  check(isDirty({ id: 'a', updated: '2026-01-02', synced: '2026-01-01' }) && !isDirty({ id: 'a', updated: '2026-01-02', synced: '2026-01-02' }) && isDirty({ id: 'a', updated: '2026-01-02' }), '(5) 未送信の変更だけが「送る対象」');
}
console.log('--- 2 台の端末（PC とスマホ） ---');
const cloud = fakeCloud(); const pc = fakeDevice('pc'), phone = fakeDevice('phone');
const S = d => createSync(cloud.client, d);
{
  await pc.putMatch(mk('a#1')); await pc.putMatch(mk('a#2')); await pc.putMatch(mk('v#1', { source: { owner: 'other' } }));
  const r1 = await S(pc).syncOnce();
  check(r1.ok && r1.pushed === 2 && cloud.rows.size === 2, '(6) PC: 自分の 2 試合だけがクラウドへ（検証用は送らない）', JSON.stringify(r1));
  check([...cloud.rows.values()].every(r => !('cues' in r.data) && JSON.stringify(r.data).length < 3000), '(7) クラウドの行に画像・信号は入っていない');
  const r2 = await S(phone).syncOnce(); const pm = phone.ms.get('a#1');
  check(r2.ok && r2.pulled === 2 && pm && pm.remote === true && !pm.cues && pm.result_screen.own.ka === 5 && pm.own_deaths.length === 1, '(8) スマホ: 取り込めて「閲覧用」（remote）。数値はそろい、画像・信号は無い');
  const r3 = await S(phone).syncOnce(); check(r3.ok && r3.pushed === 0 && r3.pulled === 0, '(9) 取り込んだ直後は何も送らない・取り込まない（往復しない）', JSON.stringify(r3));
}
{
  // PC で確認画面の修正 → スマホに届く。PC の cues は残る
  const m = await pc.getMatch('a#1'); m.review.fix = { deaths: 3 }; await pc.putMatch(m); await S(pc).syncOnce();
  const r = await S(phone).syncOnce(); check(r.pulled === 1 && phone.ms.get('a#1').review.fix.deaths === 3, '(10) PC の修正がスマホに届く');
  const m2 = await pc.getMatch('a#1'); check(m2.cues && m2.cues.n === 3000 && m2.stills.count === 9, '(11) PC 自身の端末専用の項目（cues・静止画）は同期で消えない');
}
{
  // 競合：スマホ側のほうが新しい更新なら勝つ（新しい方が勝ち）。古い更新は負ける
  const pm = await phone.getMatch('a#2'); pm.review.fix = { specials: 9 }; await phone.putMatch(pm); // スマホが新しい
  const m = await pc.getMatch('a#2'); m.review.fix = { specials: 1 }; await pc.putMatch(m); // その後 PC がさらに新しい
  await S(phone).syncOnce(); await S(pc).syncOnce(); await S(phone).syncOnce();
  check(pc.ms.get('a#2').review.fix.specials === 1 && phone.ms.get('a#2').review.fix.specials === 1, '(12) 同じ試合を両方で直したら、新しい更新が勝って両端末がそろう');
}
{
  // 消去
  await pc.delMatch('a#2'); const r = await S(pc).syncOnce(); const r2 = await S(phone).syncOnce();
  check(r.deletedSent === 1 && !phone.ms.has('a#2') && phone.ms.has('a#1') && r2.deleted === 1, '(13) PC で消した試合は、スマホからも消える（他の試合は残る）');
}
console.log('--- 失敗しても端末を壊さない ---');
{
  const before = JSON.stringify([...phone.ms.entries()]);
  for (const failOn of ['select', 'upsert', 'settings']) { const bad = fakeCloud({ failOn }); const dev = fakeDevice('x'); await dev.putMatch(mk('z#1')); dev.setDetectParams({ sig_th: 0.4 }); const r = await createSync(bad.client, dev).syncOnce();
    const ok = !r.ok && r.reason === 'error' && dev.ms.size === 1 && dev.ms.get('z#1').own_deaths.length === 1 && (failOn === 'settings' ? true : !dev.ms.get('z#1').synced);
    check(ok, `(14-${failOn}) ${failOn} が失敗しても端末の試合は無事（${failOn === 'settings' ? '試合は送れている' : '未送信のまま残る'}）`, r.error); }
  check(before === JSON.stringify([...phone.ms.entries()]), '(15) 他の端末の状態は変わらない');
  const r = await createSync(fakeCloud({ signedIn: false }).client, fakeDevice('y')).syncOnce(); check(!r.ok && r.reason === 'signed-out', '(16) 未ログインなら何もしない');
}
console.log('--- 設定（検出の自動調整） ---');
{
  const A = fakeDevice('A'), B = fakeDevice('B'), c = fakeCloud(); A.setDetectParams({ sig_th: 0.4 });
  await createSync(c.client, A).syncOnce(); await createSync(c.client, B).syncOnce();
  check(JSON.stringify(B.getDetectParams()) === '{"sig_th":0.4}', '(17) 検出の自動調整の値が別の端末に届く（持っていない端末だけ）');
}
console.log('--- 送り先（プロジェクト）が変わったとき（D63） ---');
{
  // PC は、前の送り先（旧プロジェクト）に 3 試合を送って、印（synced）が付いている。新しい送り先は空
  const pcB = fakeDevice('pcB'); pcB.backendKey = 'old-project'; for (const id of ['n#1', 'n#2', 'n#3']) await pcB.putMatch(mk(id));
  const oldCloud = fakeCloud(); const r0 = await createSync(oldCloud.client, pcB).syncOnce();
  check(r0.ok && r0.pushed === 3 && [...pcB.ms.values()].every(m => m.synced), '(18) 前の送り先には送れて、印が付く', JSON.stringify(r0));
  const newCloud = fakeCloud(); pcB.backendKey = 'new-project';
  const r1 = await createSync(newCloud.client, pcB).syncOnce();
  check(r1.ok && r1.reset === true && r1.pushed === 3 && newCloud.rows.size === 3, '(19) 送り先が変わったら、印を消して全部を新しい送り先へ送り直す（以前は 0 件のままだった）', JSON.stringify(r1));
  const r2 = await createSync(newCloud.client, pcB).syncOnce();
  check(r2.ok && !r2.reset && r2.pushed === 0, '(20) 同じ送り先なら、次からは何も送り直さない', JSON.stringify(r2));
  // 同じ送り先でもアカウントが変われば送り直す／「すべて送り直す」
  const c3 = fakeCloud(); const s3 = createSync(c3.client, pcB); const r3 = await s3.resyncAll();
  check(r3.ok && r3.pushed === 3 && c3.rows.size === 3, '(21)「すべて送り直す」で、空のクラウドにも全部が届く', JSON.stringify(r3));
  check((await createSync(c3.client, pcB).pendingCount()) === 0, '(22) 送り終えたら「まだ送っていない試合」は 0 件');
}
console.log('--- ブキアイコンの見本の同期（D65） ---');
{
  const A = fakeDevice('A'), B = fakeDevice('B'), c = fakeCloud(); let libA = [{ name: 'テストX', icon: 'AAAA' }], libB = [{ name: 'テストY', icon: 'BBBB' }];
  const depsFor = (d, get, set) => ({ ...d, getWeaponLib: get, mergeWeaponLib: items => { set(items); } });
  const sa = createSync(c.client, depsFor(A, () => libA, v => { libA = v; })), sb = createSync(c.client, depsFor(B, () => libB, v => { libB = v; }));
  await sa.syncOnce(); await sb.syncOnce(); await sa.syncOnce();
  const key = l => JSON.stringify(l.map(x => x.name).sort());
  check(key(libA) === '["テストX","テストY"]' && key(libB) === '["テストX","テストY"]', '(23) 別々に付けたブキアイコンの名前が、両方の端末で和集合になる', `${key(libA)} / ${key(libB)}`);
  const before = JSON.stringify(c.settings.get('u1').data.weaponLib.items.length); await sa.syncOnce(); check(JSON.stringify(c.settings.get('u1').data.weaponLib.items.length) === before && before === '2', '(24) 同じものを重ねて保存しない（2 件のまま）', before);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
