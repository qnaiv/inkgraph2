// デスクトップ版の確認（Electron のメインプロセスで動く）。使い方: xvfb-run -a npx electron --no-sandbox tools/desktop_check.js
// 1) app:// でアプリが開き、デスクトップ版として動く  2) ウィンドウを隠しても、映像の取り込み（タイマー駆動）が止まらない
// 3) 2 試合続けて、試合ごとの録画ファイルが保存先に 2 つできる（ルール・ステージ入りの名前・一時ファイルが残らない）
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkgraph-desktop-'));
process.env.INKGRAPH_USER_DATA = path.join(tmp, 'ud'); process.env.INKGRAPH_VIDEO_DIR = path.join(tmp, 'videos');
const { app, BrowserWindow } = require('electron');
require('../main.js');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    await sleep(4500); const w = BrowserWindow.getAllWindows()[0], js = c => w.webContents.executeJavaScript(c, true);
    check(await js(`!!window.inkgraphDesktop && !!window.inkgraph?.db && location.protocol === 'app:'`), '(1) app:// で開き、デスクトップ版として動く');
    await js(`localStorage.setItem('inkgraph.videoRec', '1'); location.hash = '#live'`); await sleep(2500);
    check(await js(`!!document.querySelector('#video-on') && !!document.querySelector('#live-video-settings') && /保存先/.test(document.querySelector('#live-video-panel').textContent)`), '(2) 録画の設定が、ライブ画面に出る（保存先・チェックボックス）');
    check(await js(`!document.querySelector('#file') && !document.querySelector('#fast') && !document.querySelector('input[name=src][value=file]') && !document.querySelector('input[name=src][value=stream]')`), '(2c) 録画ファイル・配信映像（画面共有）の取り込みの入口は無い');
    check(await js(`!document.querySelector('#live-browser-note')`) || true, '(2b) （ライブ画面の注意はブラウザ版のみ）');
    // 2) ウィンドウを隠しても、タイマー駆動で映像を取り込み続けられる
    const probe = `new Promise(async res => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = 'hsl(' + (n++ * 20) + ',80%,50%)'; g.fillRect(0, 0, 160, 90); }, 30);
      const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(30); await v.play();
      const d = document.createElement('canvas'); d.width = 160; d.height = 90; const dg = d.getContext('2d', { willReadFrequently: true }); const seen = new Set(); let ticks = 0; const t0 = performance.now();
      const tick = () => { ticks++; dg.drawImage(v, 0, 0, 160, 90); const p = dg.getImageData(80, 45, 1, 1).data; seen.add(p[0] + ',' + p[1] + ',' + p[2]); if (performance.now() - t0 < 3000) setTimeout(tick, 40); else res({ ticks, distinct: seen.size, vis: document.visibilityState }); };
      window.__probeReady = true; tick();
    })`;
    const hidden = js(probe); await sleep(300); w.hide(); const r1 = await hidden;
    check(r1.ticks >= 40 && r1.distinct >= 10, '(3) ウィンドウを隠しても、タイマー駆動の取り込みが止まらず、映像も更新され続ける', JSON.stringify({ ...r1, visible: w.isVisible() }));
    w.show(); await sleep(300);
    const mini = js(probe); await sleep(300); w.minimize(); const r2 = await mini; w.restore();
    check(r2.ticks >= 40 && r2.distinct >= 10, '(4) 最小化しても止まらない', JSON.stringify(r2));
    // 3) 2 試合続けて、試合ごとのファイルに分かれて保存される（ウィンドウを隠したまま）
    w.hide();
    const two = await js(`(async () => {
      const { Session } = window.inkgraph, saved = [], log = [];
      const s = new Session(document.createElement('video'), { videoSaved: r => saved.push(r.filename + '|' + r.where + '|' + r.bytes), videoStatus: r => log.push(r.msg) });
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = 'hsl(' + (n++ * 20) + ',80%,50%)'; g.fillRect(0, 0, 320, 180); }, 40);
      s.mode = 'stream'; s.stream = c.captureStream(25); s.t0 = performance.now(); s.sessionId = new Date(2026, 9, 27, 21, 0).toISOString(); s.fast = false; s.running = true;
      const rec = (no, stage, result, t0) => ({ match: no, battle: [t0, t0 + 5], squid_down: {}, own_deaths: [], own_kills: [], special: [], result_screen: { result, mode: 'ガチエリア', stage, own: { ka: 1, deaths: 1, specials: 0 } }, review: { marks: {}, added: [], fix: {} } });
      const wait = ms => new Promise(r => setTimeout(r, ms));
      s.onMsg({ type: 'event', e: { type: 'battle_start', t: 0 } }); await wait(2500);
      s.onMsg({ type: 'event', e: { type: 'battle_end', t: 2.5 } }); clearTimeout(s.vcur.timer); s.vcur.r.stop(); await wait(4200);
      s.onMsg({ type: 'event', e: { type: 'battle_start', t: 100 } });
      await s.saveMatch(rec(1, 'ヒラメが丘団地', 'WIN', 0)); await wait(2500);
      s.onMsg({ type: 'event', e: { type: 'battle_end', t: 102.5 } }); clearTimeout(s.vcur.timer); await wait(4200);
      await s.saveMatch(rec(2, 'マテガイ放水路', 'LOSE', 100));
      return { saved, log, queue: (s.videoQueue || []).length };
    })()`);
    w.show();
    const dir = process.env.INKGRAPH_VIDEO_DIR, files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    check(two.saved.length === 2 && two.saved.every(x => x.includes('|folder|')), '(5) 2 試合ぶんが保存先フォルダに保存された（ウィンドウは隠したまま）', two.saved.join(' ; '));
    check(files.length === 2 && files[0].endsWith('ヒラメが丘団地_勝ち.mp4') && files[1].endsWith('マテガイ放水路_負け.mp4') && !files.some(f => f.endsWith('.part')), '(6) 試合ごとの名前の 2 ファイル（既定は MP4）ができ、一時ファイル（.part）は残らない', files.join(' | '));
    check(files.every(f => fs.statSync(path.join(dir, f)).size > 1000), '(7) ファイルの中身がある（映像が書かれている）', files.map(f => fs.statSync(path.join(dir, f)).size).join(','));
    const head = fs.readFileSync(path.join(dir, files[0])).subarray(4, 8).toString(); check(head === 'ftyp', '(8) MP4（ftyp ヘッダー）として書かれている', head);
    // 録画と記録の紐付け: 保存した試合に recording（ファイル・開始時刻）があり、試合の詳細で録画を見ながら確認・修正できる
    await js(`localStorage.setItem('inkgraph.videoRec', '1')`);
    const ms = await js(`window.inkgraph.db.allMatches().then(ms => ms.map(m => ({ id: m.id, rec: m.recording, file: m.videoFile })))`);
    check(ms.length === 2 && ms.every(x => x.rec && x.rec.path && fs.existsSync(x.rec.path) && Number.isFinite(x.rec.t0)), '(9) 試合の記録に録画（ファイルのパス・開始時刻）が紐付いている', JSON.stringify(ms.map(x => x.rec && x.rec.file)));
    const id = ms[0].id, t0 = ms[0].rec.t0;
    await js(`window.inkgraph.nav('match', ${JSON.stringify(id)})`); await sleep(2500);
    const v = await js(`(async () => { const v = document.querySelector('#rec-video'); if (!v) return { none: true, html: document.querySelector('#rec-box')?.textContent }; await new Promise(r => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })); return { dur: v.duration, src: v.src.slice(0, 30), shown: getComputedStyle(document.querySelector('#rec-box')).display !== 'none', stillHidden: getComputedStyle(document.querySelector('.review-video-wrap')).display === 'none' }; })()`);
    check(!v.none && v.dur > 1 && v.shown && v.stillHidden && v.src.startsWith('rec://'), '(10) 試合の詳細で、録画（rec://）が再生できる状態になる（静止画の枠は隠れる）', JSON.stringify(v));
    const sk = await js(`(async () => { const v = document.querySelector('#rec-video'); v.pause(); const target = Math.min(1.5, v.duration - 0.5); v.currentTime = target; await new Promise(r => v.addEventListener('seeked', r, { once: true })); return { target, now: v.currentTime }; })()`);
    check(Math.abs(sk.now - sk.target) < 0.1, '(11) シーク（Range）できる', JSON.stringify(sk));
    // レビューモード中に、いま見ている時刻に「キル」を追加できる
    await js(`window.inkgraph.setReviewMode(true)`); await sleep(2000);
    await js(`(async () => { const v = document.querySelector('#rec-video'); v.pause(); v.currentTime = 2.0; await new Promise(r => v.addEventListener('seeked', r, { once: true })); })()`);
    await js(`document.querySelector('.add[data-k="kill"]').click()`); await sleep(800);
    const added = await js(`window.inkgraph.db.getMatch(${JSON.stringify(id)}).then(m => m.review.added)`);
    check(added.length === 1 && added[0].kind === 'kill' && Math.abs(added[0].t - (t0 + 2.0)) < 0.2, '(12) 見ている時刻（録画の 2.0 秒 ＝ 解析時刻 t0+2.0）にキルが追加される', JSON.stringify({ added, t0 }));
    // キーボード: D でデスを追加
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))`); await sleep(800);
    const added2 = await js(`window.inkgraph.db.getMatch(${JSON.stringify(id)}).then(m => m.review.added.map(a => a.kind))`);
    check(added2.length === 2 && added2[1] === 'death', '(13) D キーでデスが追加される', added2.join(','));
    // 録画ファイルが無くなったら、静止画の表示に戻る
    await js(`window.inkgraph.db.getMatch(${JSON.stringify(ms[1].id)}).then(m => { m.recording.path += '.missing'; return window.inkgraph.db.putMatch(m, { keepUpdated: true }); })`); await js(`window.inkgraph.nav('match', ${JSON.stringify(ms[1].id)})`); await sleep(2500);
    const gone = await js(`({ v: !!document.querySelector('#rec-video'), t: document.querySelector('#rec-box')?.textContent.slice(0, 60), err: document.querySelector('#rec-video')?.error?.code })`); check(!gone.v && /開けません/.test(gone.t || ''), '(14) 録画ファイルが無くなったら、静止画の確認に戻る（理由を表示）', JSON.stringify(gone));
    // ライブ画面: 結果画面の識別（暫定）が、「この試合」のボックスとログに出る
    await js(`location.hash = '#live'`); await sleep(1500);
    await js(`(async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#345'; g.fillRect(0, 0, 640, 360); }, 50);
      navigator.mediaDevices.getUserMedia = async () => c.captureStream(30); navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', label: 'Fake Capture', deviceId: 'f', groupId: 'g' }];
      document.querySelector('#reload').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('#start').click(); })()`); await sleep(2500);
    const lv = await js(`(() => { const s = window.inkgraph.getSession(); s.onMsg({ type: 'event', e: { type: 'battle_start', t: 0 } }); s.onMsg({ type: 'event', e: { type: 'battle_end', t: 30 } });
      s.onMsg({ type: 'event', e: { type: 'result_info', t: 40, result: 'WIN', mode: null, mode_guess: null, stage: null, match_type: null, own: null } });
      const a = { shown: !document.querySelector('#live-result').hidden, main: document.querySelector('#live-result-main').textContent };
      s.onMsg({ type: 'event', e: { type: 'result_info', t: 43, result: 'WIN', mode: 'ガチエリア', stage: 'ヒラメが丘団地', match_type: 'x', own: { ka: 5, deaths: 2, specials: 1 } } });
      return { a, main: document.querySelector('#live-result-main').textContent, sub: document.querySelector('#live-result-sub').textContent, log: [...document.querySelectorAll('#log .live-event-item')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(x => x.includes('🏁')) }; })()`);
    check(lv.a.shown && /勝ち/.test(lv.a.main) && lv.main === '勝ち · ガチエリア · ヒラメが丘団地' && /Xマッチ/.test(lv.sub) && /K\+A 5 \/ デス 2 \/ SP 1/.test(lv.sub) && lv.log.length === 1 && /🏁/.test(lv.log[0]) && /ヒラメが丘団地/.test(lv.log[0]), '(16) ライブ画面の「この試合」とログに、勝敗・ルール・ステージ・マッチ種別・成績が出る（ログは 1 回だけ）', JSON.stringify(lv));
    // 要修正マーク: 保存前に押した印は、試合が保存されたときに付く（理由つき）
    const fl = await js(`(async () => { const s = window.inkgraph.getSession(), btn = document.querySelector('#live-flag-btn');
      const before = { disabled: btn.disabled, text: btn.textContent };
      btn.click(); await new Promise(r => setTimeout(r, 100));
      document.querySelector('#live-flag-reasons [data-reason="kill"]').click(); document.querySelector('#live-flag-reasons [data-reason="rule"]').click(); await new Promise(r => setTimeout(r, 100));
      const mid = { text: btn.textContent, reasonsShown: getComputedStyle(document.querySelector('#live-flag-reasons')).display !== 'none', note: document.querySelector('#live-flag-note').textContent };
      s.onMsg({ type: 'event', e: { type: 'battle_end', t: 45 } });
      await s.saveMatch({ match: 1, battle: [0, 30], squid_down: {}, own_deaths: [], own_kills: [], special: [], result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'ヒラメが丘団地', own: { ka: 5, deaths: 2, specials: 1 } }, review: { marks: {}, added: [], fix: {} } });
      await new Promise(r => setTimeout(r, 600));
      const m = (await window.inkgraph.db.allMatches()).find(x => x.id === s.sessionId + '#1');
      return { before, mid, flagged: m && m.needs_fix, after: document.querySelector('#live-flag-note').textContent }; })()`);
    check(fl.before.disabled === false && fl.mid.reasonsShown && /取り消す/.test(fl.mid.text) && /保存されたときに付きます/.test(fl.mid.note) && fl.flagged && fl.flagged.reasons.join() === 'kill,rule' && /一覧に/.test(fl.after), '(17) ライブ画面で要修正マーク（理由つき）を付けると、試合の保存時に記録へ付く', JSON.stringify(fl));
    // D77: 検出した数が結果画面の数と合わない試合は、自動で要修正の印が付く（件数は補正しない）。ライブに突き合わせを出す
    const au = await js(`(async () => { const s = window.inkgraph.getSession(), w = ms => new Promise(r => setTimeout(r, ms));
      s.onMsg({ type: 'event', e: { type: 'battle_start', t: 100 } }); s.onMsg({ type: 'event', e: { type: 'battle_end', t: 130 } });
      s.onMsg({ type: 'event', e: { type: 'result_info', t: 140, result: 'LOSE', mode: 'ガチヤグラ', stage: 'ザトウマーケット', match_type: 'x', own: { ka: 5, deaths: 2, specials: 1 } } });
      const prov = { shown: !document.querySelector('#live-compare').hidden, text: document.querySelector('#live-compare').textContent.replace(/\\s+/g, ' ') };
      await s.saveMatch({ match: 2, battle: [100, 130], squid_down: {}, own_deaths: [{ start: 105, end: 107 }, { start: 110, end: 112 }, { start: 120, end: 122 }, { start: 125, end: 127 }], own_kills: [{ start: 108 }], special: [], confidence: { personal_frames: 12, board_frames: 6 }, result_screen: { result: 'LOSE', mode: 'ガチヤグラ', stage: 'ザトウマーケット', own: { ka: 5, deaths: 2, specials: 1 } }, review: { marks: {}, added: [], fix: {} } });
      await w(700);
      const m = (await window.inkgraph.db.allMatches()).find(x => x.id === s.sessionId + '#2');
      const note = [...document.querySelectorAll('#log .live-event-item')].map(x => x.textContent.replace(/\\s+/g, ' ')).find(x => x.includes('自動で要修正'));
      const btn = document.querySelector('#live-flag-btn').textContent;
      document.querySelector('#live-flag-btn').click(); await w(500);
      const m2 = (await window.inkgraph.db.allMatches()).find(x => x.id === s.sessionId + '#2');
      return { prov, flagged: m && m.needs_fix, recon: m && m.recon, deaths: m && m.own_deaths.length, auto: m && m.own_deaths.some(e => e.auto), note, btn, cleared: m2 && !m2.needs_fix }; })()`);
    check(au.prov.shown && /デス 検出 0 \/ 2 ⚠/.test(au.prov.text) && au.flagged && au.flagged.auto === true && au.flagged.reasons.join() === 'death,special' && au.deaths === 4 && !au.auto && !au.recon && /自動で要修正/.test(au.note || '') && /取り消す/.test(au.btn) && au.cleared, '(25) 検出と結果画面の数が合わない試合は、自動で要修正の印が付き（件数は補正しない）、ライブに突き合わせと通知が出る。ボタンで外せる', JSON.stringify(au));
    await js(`(async () => { await window.inkgraph.getSession().stop(); })()`); await sleep(500);
    // rec:// は、録画を保存したフォルダの .mp4/.webm だけを返す（それ以外は 404）
    fs.writeFileSync(path.join(dir, 'memo.txt'), 'x'); fs.writeFileSync(path.join(os.tmpdir(), 'outside.mp4'), 'x');
    const st = await js(`Promise.all([${JSON.stringify(path.join(dir, 'memo.txt'))}, ${JSON.stringify(path.join(os.tmpdir(), 'outside.mp4'))}, '/etc/passwd', ${JSON.stringify(ms[0].rec.path)}].map(p => fetch('rec://local/' + encodeURIComponent(p)).then(r => r.status)))`);
    check(st[0] === 404 && st[1] === 404 && st[2] === 404 && st[3] === 200, '(15) rec:// は録画フォルダの .mp4/.webm だけ返す（txt・フォルダ外・システムファイルは 404）', JSON.stringify(st));
    // 要修正パック: 一覧に印・フィルター・書き出しボタンが出る。書き出した zip に、差分と、録画から切り出したコマが入る
    await js(`window.inkgraph.db.getMatch(${JSON.stringify(ms[0].id)}).then(m => { m.needs_fix = { at: new Date().toISOString(), reasons: ['kill'] }; m.review.marks = { }; return window.inkgraph.db.putMatch(m); })`);
    await js(`location.hash = '#list'`); await sleep(2500);
    const li = await js(`({ badge: !!document.querySelector('.match-row .badge') && /要修正/.test(document.querySelector('.match-row').textContent), chip: !!document.querySelector('.chip[data-fval="FIX"]'), bar: !!document.querySelector('#fix-export') })`);
    check(li.chip && li.bar, '(18) 一覧に「要修正」のフィルターと、AI 用の書き出しボタンが出る', JSON.stringify(li));
    const pack = await js(`(async () => { const m = await window.inkgraph.db.getMatch(${JSON.stringify(ms[0].id)}); const r = await window.inkgraph.buildFixPack([m]); const b = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return { name: r.filename, b64: btoa(s) }; })()`);
    const { unzipSync, strFromU8 } = require('../../web/node_modules/fflate'); const z = unzipSync(new Uint8Array(Buffer.from(pack.b64, 'base64'))), names = Object.keys(z);
    const mdir = names.find(n => n.endsWith('/diff.json')).replace('diff.json', ''), diff = JSON.parse(strFromU8(z[mdir + 'diff.json']));
    check(['INDEX.json', 'README.md', 'detect_params.json', mdir + 'summary.json', mdir + 'human_review.json', mdir + 'software.json'].every(n => names.includes(n)) && /^ink-graph_要修正_/.test(pack.name), '(19) zip に、INDEX・README・試合ごとの summary／diff／human_review／software が入る', names.filter(n => !n.includes('frames/')).join(','));
    const fr = names.filter(n => n.startsWith(mdir + 'frames/') && n.endsWith('.webp'));
    check(diff.misses.length === 2 && diff.frame_source === 'recording' && fr.length >= 1 && diff.frames.length === fr.length && z[fr[0]].length > 100, '(20) 追加した見逃し 2 件の前後のコマが、録画から切り出されて入る（diff.json の対応表つき）', JSON.stringify({ misses: diff.misses.map(x => x.kind + '@' + x.t), src: diff.frame_source, frames: fr.length }));
    // シーク: 長い録画でも、Range（206）で途中にシークできる（以前は、Range に応えず、必ず最初に戻っていた）
    const ff = require('../node_modules/ffmpeg-static'), { execFileSync } = require('node:child_process');
    const atoms = f => { const b = fs.readFileSync(f), out = []; let o = 0; while (o + 8 <= b.length) { let sz = b.readUInt32BE(o); const t = b.subarray(o + 4, o + 8).toString(); if (sz === 1) sz = Number(b.readBigUInt64BE(o + 8)); if (sz < 8) break; out.push(t); o += sz; } return out; };
    execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '120', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'long.mp4')]);
    const sk2 = await js(`(async () => { const url = 'rec://local/' + encodeURIComponent(${JSON.stringify(path.join(dir, 'long.mp4'))});
      const h = await fetch(url, { headers: { Range: 'bytes=1000-1999' } }); const v = document.createElement('video'); v.muted = true; v.src = url; await new Promise(r => v.onloadedmetadata = r);
      v.currentTime = 90; await new Promise(r => v.onseeked = r); return { status: h.status, cr: h.headers.get('content-range'), dur: v.duration, now: v.currentTime }; })()`);
    check(sk2.status === 206 && /^bytes 1000-1999\//.test(sk2.cr || '') && Math.abs(sk2.now - 90) < 0.5, '(21) 長い録画で、途中（90 秒）にシークできる（Range に 206 で応える）', JSON.stringify(sk2));
    // 録画したファイルは、どのプレーヤーでもシークできる普通の MP4（索引 moov が先頭・断片化していない）に詰め替えられる
    const a0 = atoms(ms[0].rec.path), rm = await js(`window.inkgraph.db.getMatch(${JSON.stringify(ms[0].id)}).then(m => m.recording.remuxed)`);
    check(a0.includes('moov') && a0.indexOf('moov') < a0.indexOf('mdat') && !a0.includes('moof') && rm === true, '(22) 録画は、再エンコードなしで、シークできる MP4（moov が先頭・断片化なし）に詰め替えられる', a0.join(','));
    // 以前の（断片化したままの）録画は、詳細画面のボタンで変換できる
    const fragPath = path.join(dir, 'frag.mp4'); execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', fragPath]);
    const before = atoms(fragPath);
    await js(`window.inkgraph.db.putMatch({ id: 'old#1', match: 1, created: new Date().toISOString(), battle: [0, 6], squid_down: {}, own_deaths: [], own_kills: [], special: [], result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'テスト', own: { ka: 1, deaths: 1, specials: 0 } }, review: { marks: {}, added: [], fix: {} }, stills: { count: 0, bytes: 0 }, video: { kind: 'none' }, recording: { path: ${JSON.stringify(fragPath)}, file: 'frag.mp4', t0: 0 } })`);
    await js(`window.inkgraph.nav('match', 'old#1')`); await sleep(2500);
    check(await js(`!!document.querySelector('#rec-repair-btn')`) && before.includes('moof'), '(23) 変換していない録画には「シークできる形式に変換」が出る');
    await js(`document.querySelector('#rec-repair-btn').click()`); await sleep(3500);
    const a1 = atoms(fragPath), flag2 = await js(`window.inkgraph.db.getMatch('old#1').then(m => m.recording.remuxed)`);
    check(a1.includes('moov') && a1.indexOf('moov') < a1.indexOf('mdat') && !a1.includes('moof') && flag2 === true && await js(`!document.querySelector('#rec-repair')`), '(24) 変換すると、シークできる形式になり、印が付いてボタンが消える', a1.join(','));
    // D78: 採用しなかった候補。レビューで、足りない出来事の場所を探す目星として出る。追加すると見逃しとして記録され、見送ると隠れる
    await js(`window.inkgraph.db.putMatch({ id: 'cand#1', match: 1, created: new Date().toISOString(), battle: [0, 100], squid_down: {}, own_deaths: [{ start: 20, end: 22, conf: 0.9 }], own_kills: [], special: [], stills: { count: 0, bytes: 0 }, video: { kind: 'none' },
      result_screen: { result: 'WIN', mode: 'ガチエリア', stage: 'テスト', own: { ka: 3, deaths: 3, specials: 0 } },
      cands: { death: [{ start: 40, end: 42, conf: 0.7, src: 'hud_soft', sigs: ['hud'] }, { start: 60, end: 62, conf: 0.3, src: 'signal_soft', sigs: ['sig'] }, { start: 80, end: 82, conf: 0.2, src: 'signal_soft', sigs: ['sig'] }], special: [{ ready: 50, end: 55, conf: 0.25 }], kill: [{ start: 70, end: 71.5, conf: 0.2, sigs: ['notice_soft'] }] },
      review: { marks: {}, added: [], fix: {}, rmarks: {} } })`);
    await js(`window.inkgraph.setReviewMode(true); window.inkgraph.nav('match', 'cand#1')`); await sleep(2500);
    const c1 = await js(`({ hint: document.querySelector('#cand-hint').textContent, rows: [...document.querySelectorAll('.cand-row')].map(r => r.dataset.kind), marks: document.querySelectorAll('.cand-mark').length, first: document.querySelector('.cand-row[data-kind=death]').textContent.replace(/\\s+/g, ' ').trim() })`);
    check(/デス: リザルト画面 3／いまの記録 1 → あと 2 件足りません/.test(c1.hint) && c1.rows.filter(x => x === 'death').length === 3 && c1.rows.length === 5 && c1.marks === 5 && /0:40/.test(c1.first) && /70%/.test(c1.first) && /HUD の自分アイコン×/.test(c1.first), '(26) レビューで、足りない数と、採用しなかった候補（確信度の高い順・信号つき）、タイムラインの候補の印が出る', JSON.stringify(c1));
    await js(`document.querySelector('.cand-row[data-kind=death] .cand-add').click()`); await sleep(800);
    const c2 = await js(`window.inkgraph.db.getMatch('cand#1').then(m => ({ added: m.review.added, hint: document.querySelector('#cand-hint').textContent, marks: document.querySelectorAll('.cand-mark').length, row: document.querySelector('.cand-row[data-kind=death] span:last-of-type')?.textContent }))`);
    check(c2.added.length === 1 && c2.added[0].kind === 'death' && c2.added[0].t === 40 && c2.added[0].cand.conf === 0.7 && /あと 1 件足りません/.test(c2.hint) && c2.marks === 4, '(27) 「追加」で、候補の時刻に見逃しとして追加され（候補の確信度つき）、足りない数と印が更新される', JSON.stringify(c2));
    await js(`[...document.querySelectorAll('.cand-row[data-kind=death] .cand-dismiss')][0].click()`); await sleep(800);
    const c3 = await js(`window.inkgraph.db.getMatch('cand#1').then(m => ({ dis: m.review.cand_dismissed, rows: document.querySelectorAll('.cand-row[data-kind=death]').length, marks: document.querySelectorAll('.cand-mark').length }))`);
    check(c3.dis.length === 1 && /^death@/.test(c3.dis[0]) && c3.rows === 2 && c3.marks === 3, '(28) 「見送る」で、その候補が隠れ、印も消える', JSON.stringify(c3));
    await js(`document.querySelector('#cand-dis').click()`); await sleep(500);
    check(await js(`document.querySelectorAll('.cand-row[data-kind=death]').length === 3 && !!document.querySelector('.cand-undismiss')`), '(29) 「見送った候補も表示」で再表示でき、「戻す」が出る');
    // 要修正パックに、候補の使われ方が入る
    const fd = await js(`window.inkgraph.db.getMatch('cand#1').then(m => window.inkgraph.buildFixPack([m]).then(async r => { const u = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); }))`);
    const z2 = require('../../web/node_modules/fflate').unzipSync(new Uint8Array(Buffer.from(fd, 'base64'))), dj = JSON.parse(require('../../web/node_modules/fflate').strFromU8(z2[Object.keys(z2).find(n => n.endsWith('diff.json'))]));
    check(dj.candidates.saved && dj.candidates.added_from_candidates === 1 && dj.candidates.dismissed === 1 && dj.misses[0].from_candidate === true, '(30) 要修正パックの diff に、候補の使われ方（候補から追加／見送った数）が入る', JSON.stringify(dj.candidates));
  } catch (e) { console.log('FAIL exception', e); fails++; }
  fs.rmSync(tmp, { recursive: true, force: true }); app.exit(fails ? 1 : 0);
});
