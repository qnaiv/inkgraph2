import * as db from './db.js';
import { Session, listDevices } from './session.js';
import { renderTimeline, LEGEND } from './timeline.js';
import { detected, effective, resultOf, accuracy, KINDS, RESULT_FIELDS, SP_LABEL, countBucket, BUCKETS, mss, pct, key } from './analysis.js';
import { zipSync, strToU8 } from 'fflate';
const app = document.getElementById('app'); const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let session = null, currentId = null; window.inkgraph = { db };
function nav(page, arg) { document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.page === page)); if (arg) currentId = arg; location.hash = page + (currentId && page === 'match' ? '/' + encodeURIComponent(currentId) : ''); PAGES[page](); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => nav(b.dataset.page));
const resCls = r => r === 'WIN' ? 'win' : r === 'LOSE' ? 'lose' : ''; const resJa = r => r === 'WIN' ? '勝ち' : r === 'LOSE' ? '負け' : '不明';
const download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const PAGES = {};
// ---------------- live ----------------
PAGES.live = async () => {
  if (session && session.running) { app.replaceChildren(session.page); return; }
  const page = document.createElement('div'); page.innerHTML = `
  <div class="card"><h2>映像の入力</h2><div class="row">
   <label><input type="radio" name="src" value="device" checked> キャプチャーボード（カメラとして認識される機器）</label>
   <select id="dev"><option value="">（読み込み中…）</option></select><button class="b sec" id="reload">機器を再検出</button></div>
   <div class="row" style="margin-top:8px"><label><input type="radio" name="src" value="file"> 録画ファイル</label><input type="file" id="file" accept="video/*">
   <label><input type="checkbox" id="fast" checked> ファイルは早送りで解析（再生しない）</label></div>
   <div class="row" style="margin-top:8px"><label><input type="checkbox" id="rec" checked> キャプチャー映像を試合ごとにブラウザ内へ録画する（あとで確認・訂正に使う）</label></div>
   <div class="row" style="margin-top:10px"><button class="b" id="start">解析を開始</button><button class="b red" id="stop" disabled>停止</button><span id="state" class="muted"></span></div></div>
  <div class="row"><div class="card grow"><video id="v" playsinline muted></video><div id="prog" class="muted"></div></div>
   <div class="card" style="width:380px"><h2>この試合</h2><div class="kpi"><div>キル<b id="k">0</b></div><div>デス<b id="d">0</b></div></div><h3>出来事</h3><div class="log" id="log"></div><h3>保存した試合</h3><div id="saved" class="muted">まだありません</div></div></div>`;
  app.replaceChildren(page);
  const fill = async () => { const ds = await listDevices(); const sel = $('#dev', page); sel.innerHTML = ds.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || 'カメラ ' + (i + 1))}</option>`).join('') || '<option value="">機器が見つかりません</option>';
    const cap = ds.find(d => /capvo|capture|usb video|hdmi|cam link|elgato|avermedia/i.test(d.label)); if (cap) sel.value = cap.deviceId; };
  fill().catch(() => {}); $('#reload', page).onclick = fill;
  const log = (txt) => { const l = $('#log', page); l.insertAdjacentHTML('afterbegin', `<div>${txt}</div>`); };
  $('#start', page).onclick = async () => {
    const mode = page.querySelector('input[name=src]:checked').value, file = $('#file', page).files[0];
    if (mode === 'file' && !file) { alert('録画ファイルを選んでください'); return; }
    let k = 0, d = 0, t0 = 0;
    session = new Session($('#v', page), {
      event: e => { const tt = mss(e.t - t0);
        if (e.type === 'battle_start') { t0 = e.t; k = d = 0; log('▶ バトル開始を検出'); } else if (e.type === 'battle_end') log(`■ バトル終了（${tt}）`); else if (e.type === 'battle_discard') log('（短すぎるため試合として扱いません）');
        else if (e.type === 'own_death') { d++; log(`${tt} ✕ 自分がやられた`); } else if (e.type === 'own_kill') { k++; log(`${tt} ★ 敵をたおした`); }
        $('#k', page).textContent = k; $('#d', page).textContent = d; },
      status: m => { $('#state', page).textContent = `状態：${{ idle: '待機中（試合外）', battle: 'バトル中', result: 'リザルト画面を読み取り中' }[m.state]}　1フレームの処理 ${m.ms.toFixed(0)}ミリ秒`; },
      progress: (p, t) => { $('#prog', page).textContent = `解析中 ${Math.round(p * 100)}%（${mss(t)}）`; },
      match: rec => { const r = resultOf(rec); log(`<b>試合を保存しました：${resJa(r.result)} ${esc(r.stage || '')}</b>`); const s = $('#saved', page); if (s.textContent.startsWith('まだ')) s.innerHTML = '';
        s.insertAdjacentHTML('beforeend', `<div><a href="#" data-id="${esc(rec.id)}">${esc(r.mode || 'ルール不明')} ${esc(r.stage || '')} <span class="${resCls(r.result)}">${resJa(r.result)}</span></a></div>`); s.querySelectorAll('a').forEach(a => a.onclick = ev => { ev.preventDefault(); nav('match', a.dataset.id); }); },
      stopped: () => { $('#start', page).disabled = false; $('#stop', page).disabled = true; $('#state', page).textContent = '停止しました'; } });
    session.page = page; $('#start', page).disabled = true; $('#stop', page).disabled = false;
    try { await session.start({ mode, deviceId: $('#dev', page).value, file, record: $('#rec', page).checked, fast: $('#fast', page).checked }); }
    catch (e) { alert('開始できませんでした：' + e.message); $('#start', page).disabled = false; $('#stop', page).disabled = true; }
  };
  $('#stop', page).onclick = () => session && session.stop();
};
// ---------------- list ----------------
PAGES.list = async () => {
  const ms = await db.allMatches(); const page = document.createElement('div');
  page.innerHTML = `<div class="card"><h2>試合一覧（${ms.length}試合）</h2><div class="row" style="margin-bottom:10px">
   <button class="b sec" id="exp">試合ログを書き出す（JSON）</button><label class="b sec" style="display:inline-block">試合ログを読み込む<input type="file" id="imp" accept=".json" hidden></label>
   <button class="b" id="fb">フィードバックを書き出す（訂正内容＋画像のzip）</button></div>
   <table><tr><th>日時</th><th>ルール</th><th>ステージ</th><th>勝敗</th><th>キル（検出）</th><th>デス（検出）</th><th>スペシャル（検出）</th><th>リザルト画面 K+A／デス／SP</th><th>確認状況</th><th></th></tr>
   ${ms.map(m => { const r = resultOf(m), ev = effective(m), det = detected(m), rv = det.filter(e => e.mark).length; const n = k => ev.filter(e => e.kind === k).length;
     return `<tr class="click" data-id="${esc(m.id)}"><td>${new Date(m.created).toLocaleString('ja-JP')}</td><td>${esc(r.mode || '不明')}</td><td>${esc(r.stage || '不明')}</td><td class="${resCls(r.result)}">${resJa(r.result)}</td><td>${n('kill')}</td><td>${n('death')}</td><td>${n('special')}</td><td>${r.ka ?? '?'}／${r.deaths ?? '?'}／${r.specials ?? '?'}</td><td>${rv}/${det.length} 件確認済み</td><td><button class="b red del" data-id="${esc(m.id)}">削除</button></td></tr>`; }).join('')}</table></div>`;
  app.replaceChildren(page);
  page.querySelectorAll('tr.click').forEach(tr => tr.onclick = e => { if (!e.target.classList.contains('del')) nav('match', tr.dataset.id); });
  page.querySelectorAll('.del').forEach(b => b.onclick = async () => { if (confirm('この試合を削除しますか？（録画も消えます）')) { await db.delMatch(b.dataset.id); PAGES.list(); } });
  $('#exp', page).onclick = async () => download(`inkgraph_matches_${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(await db.exportAll())], { type: 'application/json' }));
  $('#imp', page).onchange = async e => { const f = e.target.files[0]; if (!f) return; const n = await db.importAll(JSON.parse(await f.text())); alert(`${n}試合を読み込みました`); PAGES.list(); };
  $('#fb', page).onclick = () => exportFeedback(ms);
};
// ---------------- feedback ----------------
async function exportFeedback(ms) {
  const files = {}; const acc = accuracy(ms); const meta = { app: 'InkGraph', kind: 'feedback', format: 1, exported: new Date().toISOString(), accuracy: acc, matches: [] };
  for (const m of ms) { const snaps = await db.snapsOf(m.id); const safe = m.id.replace(/[^0-9A-Za-z]/g, '_'); const sn = [];
    for (const s of snaps) { const name = `images/${safe}/${s.kind || 'frame'}_${s.t.toFixed(1)}_${s.id}.jpg`; files[name] = new Uint8Array(await s.blob.arrayBuffer()); sn.push({ file: name, t: s.t, reason: s.reason, kind: s.kind, header: s.header, event: s.event || null }); }
    const { tower_series, squid_down, ...light } = m; meta.matches.push({ ...light, tower_series, squid_down, snapshots: sn }); }
  files['feedback.json'] = strToU8(JSON.stringify(meta, null, 1));
  const zip = zipSync(files, { level: 0 }); download(`inkgraph_feedback_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`, new Blob([zip], { type: 'application/zip' }));
}
async function grabFrames(video, times, reason, matchId, event) { // store still frames from the review video
  if (!video.src || !video.duration) return 0; const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const ctx = c.getContext('2d'); const back = video.currentTime; let n = 0;
  for (const t of times) { if (t < 0 || t > video.duration) continue; await new Promise(r => { video.onseeked = r; video.currentTime = t; }); ctx.drawImage(video, 0, 0, 1280, 720);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)); await db.putSnap({ matchId, t, reason, kind: 'event', event, blob }); n++; }
  video.onseeked = null; video.currentTime = back; return n;
}
// ---------------- match detail / review ----------------
PAGES.match = async () => {
  const ms = await db.allMatches(); if (!currentId && ms.length) currentId = ms[ms.length - 1].id; const m = currentId && await db.getMatch(currentId);
  if (!m) { app.innerHTML = '<div class="card">試合がありません。「ライブ分析」で解析するか、「試合一覧」から試合ログを読み込んでください。</div>'; return; }
  m.review = m.review || { marks: {}, added: [], fix: {}, rmarks: {} }; m.review.rmarks = m.review.rmarks || {}; m.review.fix = m.review.fix || {};
  const save = async () => { m.review.updated = new Date().toISOString(); await db.putMatch(m); };
  const r = resultOf(m), t0 = m.battle[0]; const page = document.createElement('div');
  page.innerHTML = `<div class="card"><div class="row"><select id="pick">${ms.map(x => { const rr = resultOf(x); return `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>${new Date(x.created).toLocaleString('ja-JP')} ${esc(rr.stage || '')} ${resJa(rr.result)}</option>`; }).join('')}</select></div>
   <h2 class="${resCls(r.result)}">${esc(r.mode || 'ルール不明')}　${esc(r.stage || 'ステージ不明')}　${resJa(r.result)}${r.count ? '　カウント ' + r.count : ''}　｜　キル+アシスト ${r.ka ?? '?'}　デス ${r.deaths ?? '?'}　スペシャル ${r.specials ?? '?'}</h2>
   <div id="tl"></div>${LEGEND}</div>
  <div class="row"><div class="card grow"><h2>確認用の映像</h2><video id="rv" controls muted></video><div class="row" style="margin-top:6px"><span id="vstat" class="muted"></span><label class="b sec">録画ファイルを選ぶ<input type="file" id="vf" accept="video/*" hidden></label></div>
    <div class="row" style="margin-top:8px"><b>見逃しを追加（いまの再生位置）：</b><button class="b sec add" data-k="kill">キル</button><button class="b sec add" data-k="death">デス</button><button class="b sec add" data-k="special">スペシャル発動</button></div></div>
   <div class="card" style="width:430px"><h2>リザルト画面の読み取り</h2><table id="rtab"></table><p class="muted">✓＝正しい　✗＝間違い（正しい値を入力）</p><h2>この試合の検出精度</h2><div id="acc"></div>
    <button class="b" id="fbone" style="margin-top:8px">この試合のフィードバックを書き出す</button></div></div>
  <div class="card"><h2>検出した出来事（クリックで映像の該当箇所へ）</h2><p class="muted">✓ 正しい　✗ 誤検出（実際は起きていない）　削除＝重複など、精度の集計に入れずに消す。✗と見逃し追加では、前後の映像を自動で静止画として保存し、フィードバックに入れます。</p><table id="etab"></table></div>`;
  app.replaceChildren(page); $('#pick', page).onchange = e => nav('match', e.target.value);
  const video = $('#rv', page); let offset = 0; // match time t = video.currentTime + offset
  const seek = t => { if (video.src) { video.currentTime = Math.max(0, t - offset - 2); video.play().catch(() => {}); } else $('#vstat', page).textContent = '映像が読み込まれていません。録画ファイルを選んでください。'; };
  const drawTL = () => { const tl = renderTimeline(m, { onSeek: seek }); $('#tl', page).replaceChildren(tl); video.ontimeupdate = () => tl.setPlayhead(video.currentTime + offset); };
  const vrec = await db.getVideo(m.id);
  if (vrec) { video.src = URL.createObjectURL(vrec.blob); offset = vrec.offset || 0; $('#vstat', page).textContent = 'ブラウザ内に保存した録画を表示しています'; }
  else $('#vstat', page).textContent = `この試合の元の録画ファイル（${esc(m.source?.name || '')}）を選ぶと、映像と照らし合わせて確認できます。`;
  $('#vf', page).onchange = e => { const f = e.target.files[0]; if (f) { video.src = URL.createObjectURL(f); offset = 0; $('#vstat', page).textContent = f.name; } };
  const accDraw = () => { const a = accuracy([m]); $('#acc', page).innerHTML = accTable(a); };
  const rtab = () => { const rs = m.result_screen || {}, own = rs.own || {}; const det = { result: rs.result, mode: rs.mode, stage: rs.stage, ka: own.ka, deaths: own.deaths, specials: own.specials, count: (m.tower_series && m.tower_series.length) ? `${m.tower_series.at(-1).own}-${m.tower_series.at(-1).enemy}` : null };
    $('#rtab', page).innerHTML = `<tr><th>項目</th><th>読み取り</th><th>確認</th><th>訂正</th></tr>` + Object.entries(RESULT_FIELDS).map(([k, lab]) => { const mk = m.review.rmarks[k];
      return `<tr><td>${lab}</td><td>${esc(det[k] === 'WIN' ? '勝ち' : det[k] === 'LOSE' ? '負け' : det[k] ?? '読めず')}</td><td><button class="mk ${mk === 'ok' ? 'on-ok' : ''}" data-f="${k}" data-v="ok">✓</button><button class="mk ${mk === 'wrong' ? 'on-wrong' : ''}" data-f="${k}" data-v="wrong">✗</button></td><td>${mk === 'wrong' ? `<input size="9" data-fix="${k}" value="${esc(m.review.fix[k] ?? '')}" placeholder="${k === 'result' ? 'WIN か LOSE' : k === 'count' ? '例 62-83' : '正しい値'}">` : ''}</td></tr>`; }).join('');
    $('#rtab', page).querySelectorAll('.mk').forEach(b => b.onclick = async () => { const f = b.dataset.f; m.review.rmarks[f] = m.review.rmarks[f] === b.dataset.v ? undefined : b.dataset.v; if (m.review.rmarks[f] !== 'wrong') delete m.review.fix[f]; await save(); rtab(); accDraw(); });
    $('#rtab', page).querySelectorAll('input[data-fix]').forEach(i => i.onchange = async () => { const f = i.dataset.fix; let v = i.value.trim(); if (['ka', 'deaths', 'specials'].includes(f)) v = v === '' ? undefined : +v; if (f === 'result') v = /^w|勝/i.test(v) ? 'WIN' : /^l|負/i.test(v) ? 'LOSE' : v; m.review.fix[f] = v; await save(); }); };
  const etab = () => { const det = detected(m), add = (m.review.added || []).map((a, i) => ({ ...a, addedIdx: i })); const effMap = new Map(effective(m).map(e => [e.added ? 'a' + e.t + e.kind : e.key, e]));
    const ctxCell = e => { const x = effMap.get(e.addedIdx !== undefined ? 'a' + e.t + e.kind : e.key) || {}; return `<td>${x.phase || '—'}</td><td>${x.count || '—'}</td><td class="${x.wp_delta > 0 ? 'pos' : x.wp_delta < 0 ? 'neg' : ''}">${x.wp_delta !== undefined ? (x.wp_delta > 0 ? '+' : '') + Math.round(x.wp_delta * 100) + '%' : '—'}</td>`; };
    $('#etab', page).innerHTML = `<tr><th>時刻</th><th>種類</th><th>局面</th><th>カウント（味方-敵）</th><th>勝率の変化</th><th>確認</th></tr>` +
      det.map(e => `<tr class="click ${e.mark || ''}" data-t="${e.t}"><td>${mss(e.t - t0)}</td><td>${KINDS[e.kind]}${e.outcome ? '（' + SP_LABEL[e.outcome] + '）' : ''}</td>${ctxCell(e)}<td>${['ok', 'wrong', 'deleted'].map(v => `<button class="mk ${e.mark === v ? 'on-' + v : ''}" data-key="${e.key}" data-v="${v}" data-t="${e.t}">${{ ok: '✓ 正しい', wrong: '✗ 誤検出', deleted: '削除' }[v]}</button>`).join('')}</td></tr>`).join('') +
      add.map(a => `<tr class="click added" data-t="${a.t}"><td>${mss(a.t - t0)}</td><td>${KINDS[a.kind]}（見逃し・手動追加）</td>${ctxCell(a)}<td><button class="mk rm" data-i="${a.addedIdx}">取り消す</button></td></tr>`).join('');
    $('#etab', page).querySelectorAll('tr.click').forEach(tr => tr.onclick = ev => { if (ev.target.tagName !== 'BUTTON') seek(+tr.dataset.t); });
    $('#etab', page).querySelectorAll('.mk[data-key]').forEach(b => b.onclick = async () => { const k = b.dataset.key; const v = m.review.marks[k] === b.dataset.v ? undefined : b.dataset.v; if (v) m.review.marks[k] = v; else delete m.review.marks[k]; await save(); refresh();
      if (v === 'wrong') grabFrames(video, [-1, 0, 1].map(d => +b.dataset.t - offset + d), '誤検出の前後', m.id, { type: 'wrong', key: k }); });
    $('#etab', page).querySelectorAll('.rm').forEach(b => b.onclick = async () => { m.review.added.splice(+b.dataset.i, 1); await save(); refresh(); }); };
  page.querySelectorAll('.add').forEach(b => b.onclick = async () => { if (!video.src) { alert('先に映像を読み込んでください'); return; } const t = Math.round((video.currentTime + offset) * 10) / 10; m.review.added.push({ kind: b.dataset.k, t }); await save(); refresh();
    grabFrames(video, [-1.5, -0.5, 0.5].map(d => t - offset + d), '見逃しの前後', m.id, { type: 'missed', kind: b.dataset.k, t }); });
  $('#fbone', page).onclick = () => exportFeedback([m]);
  const refresh = () => { drawTL(); etab(); accDraw(); }; rtab(); refresh();
};
function accTable(a) { return `<table><tr><th>種類</th><th>正しい</th><th>誤検出</th><th>見逃し</th><th>未確認</th><th>適合率（検出のうち正しい割合）</th><th>再現率（実際の出来事を拾えた割合）</th></tr>` +
  Object.entries(KINDS).map(([k, lab]) => { const x = a.events[k]; return `<tr><td>${lab}</td><td>${x.tp}</td><td>${x.fp}</td><td>${x.fn}</td><td>${x.unreviewed}</td><td>${pct(x.precision)}</td><td>${pct(x.recall)}</td></tr>`; }).join('') + `</table>
  <h3>リザルト画面</h3><table><tr><th>項目</th><th>正しい</th><th>間違い</th><th>正解率</th></tr>${Object.entries(RESULT_FIELDS).map(([k, lab]) => { const x = a.result[k]; return `<tr><td>${lab}</td><td>${x.ok}</td><td>${x.wrong}</td><td>${pct(x.ok + x.wrong ? x.ok / (x.ok + x.wrong) : null)}</td></tr>`; }).join('')}</table>`; }
// ---------------- trends ----------------
PAGES.trend = async () => {
  const ms = await db.allMatches(); const page = document.createElement('div'); if (!ms.length) { app.innerHTML = '<div class="card">試合がまだありません。</div>'; return; }
  const R = ms.map(m => ({ m, r: resultOf(m), ev: effective(m) })); const known = R.filter(x => x.r.result); const wins = known.filter(x => x.r.result === 'WIN').length;
  const cnt = (x, k) => x.ev.filter(e => e.kind === k).length; const sum = k => R.reduce((s, x) => s + cnt(x, k), 0);
  const deaths = R.flatMap(x => x.ev.filter(e => e.kind === 'death').map(e => ({ ...e, x }))), kills = R.flatMap(x => x.ev.filter(e => e.kind === 'kill').map(e => ({ ...e, x })));
  const byPhase = ['抑え', '打開', '互角', null].map(p => ({ p: p || '局面不明', d: deaths.filter(e => (e.phase || null) === p).length, k: kills.filter(e => (e.phase || null) === p).length, loss: deaths.filter(e => (e.phase || null) === p).reduce((s, e) => s + Math.min(0, e.wp_delta || 0), 0) }));
  const byB = BUCKETS.map(b => ({ b, d: deaths.filter(e => countBucket(e.count_diff) === b).length, k: kills.filter(e => countBucket(e.count_diff) === b).length }));
  const maxB = Math.max(1, ...byB.map(x => Math.max(x.d, x.k))); const bar = (v, c) => `<span style="display:inline-block;height:12px;width:${v / maxB * 220}px;background:${c};vertical-align:middle"></span> ${v}`;
  const top = (arr, asc) => arr.filter(e => e.wp_delta !== undefined).sort((a, b) => asc ? a.wp_delta - b.wp_delta : b.wp_delta - a.wp_delta).slice(0, 8);
  const row = e => `<tr class="click" data-id="${esc(e.x.m.id)}"><td>${new Date(e.x.m.created).toLocaleDateString('ja-JP')} ${esc(e.x.r.stage || '')} <span class="${resCls(e.x.r.result)}">${resJa(e.x.r.result)}</span></td><td>${mss(e.t - e.x.m.battle[0])}</td><td>${e.phase || '—'}</td><td>${e.count || '—'}</td><td class="${e.wp_delta > 0 ? 'pos' : 'neg'}">${e.wp_delta > 0 ? '+' : ''}${Math.round(e.wp_delta * 100)}%</td></tr>`;
  const maxK = Math.max(1, ...R.map(x => Math.max(cnt(x, 'kill'), cnt(x, 'death'), cnt(x, 'special'))));
  page.innerHTML = `<div class="card"><h2>全体（${ms.length}試合）</h2><div class="kpi"><div>勝率<b>${pct(known.length ? wins / known.length : null)}</b>${wins}勝${known.length - wins}敗</div><div>1試合あたりキル<b>${(sum('kill') / ms.length).toFixed(1)}</b></div><div>1試合あたりデス<b>${(sum('death') / ms.length).toFixed(1)}</b></div><div>1試合あたりスペシャル<b>${(sum('special') / ms.length).toFixed(1)}</b></div><div>キル÷デス<b>${(sum('kill') / Math.max(1, sum('death'))).toFixed(2)}</b></div></div><p class="muted">キル・デス・スペシャルは試合中の検出（確認画面での訂正を反映）。</p></div>
  <div class="card"><h2>試合ごとのキル・デス・スペシャル</h2><svg width="${Math.max(400, R.length * 70 + 60)}" height="220">${R.map((x, i) => { const bx = 50 + i * 70; const h = v => v / maxK * 150;
     return [['kill', '#2e7d32'], ['death', '#c62828'], ['special', '#f9a825']].map(([k, c], j) => `<rect x="${bx + j * 18}" y="${170 - h(cnt(x, k))}" width="16" height="${h(cnt(x, k))}" fill="${c}"><title>${KINDS[k]} ${cnt(x, k)}</title></rect><text x="${bx + j * 18 + 8}" y="${165 - h(cnt(x, k))}" font-size="11" text-anchor="middle">${cnt(x, k)}</text>`).join('') + `<text x="${bx + 26}" y="188" font-size="12" text-anchor="middle">第${i + 1}試合</text><text x="${bx + 26}" y="204" font-size="12" text-anchor="middle" fill="${x.r.result === 'WIN' ? '#1565c0' : '#c62828'}">${resJa(x.r.result)}</text>`; }).join('')}</svg><div class="legend"><span><i style="background:#2e7d32"></i>キル</span><span><i style="background:#c62828"></i>デス</span><span><i style="background:#f9a825"></i>スペシャル</span></div></div>
  <div class="row"><div class="card grow"><h2>局面別（抑え／打開）</h2><table><tr><th>局面</th><th>デス</th><th>キル</th><th>デスで失った勝率の合計</th></tr>${byPhase.map(x => `<tr><td>${x.p}</td><td>${x.d}</td><td>${x.k}</td><td class="neg">${Math.round(x.loss * 100)}%</td></tr>`).join('')}</table><p class="muted">抑え＝リード中または味方がヤグラを持っている、打開＝負けている・敵がヤグラを持っている。</p></div>
   <div class="card grow"><h2>カウント状況別</h2><table><tr><th>カウント差（味方−敵）</th><th>デス</th><th>キル</th></tr>${byB.map(x => `<tr><td>${x.b}</td><td>${bar(x.d, '#c62828')}</td><td>${bar(x.k, '#2e7d32')}</td></tr>`).join('')}</table></div></div>
  <div class="row"><div class="card grow"><h2>勝率を大きく下げたデス</h2><table><tr><th>試合</th><th>時刻</th><th>局面</th><th>カウント</th><th>勝率の変化</th></tr>${top(deaths, true).map(row).join('')}</table></div>
   <div class="card grow"><h2>勝率を大きく上げたキル</h2><table><tr><th>試合</th><th>時刻</th><th>局面</th><th>カウント</th><th>勝率の変化</th></tr>${top(kills, false).map(row).join('')}</table></div></div>
  <div class="card"><h2>検出精度（確認画面での訂正から集計）</h2>${accTable(accuracy(ms))}</div>`;
  app.replaceChildren(page); page.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => nav('match', tr.dataset.id));
};
const [p0, id0] = location.hash.slice(1).split('/'); if (id0) currentId = decodeURIComponent(id0); nav(PAGES[p0] ? p0 : 'live');
