import * as db from './db.js';
import * as learn from './learn.js';
import { Session, listDevices } from './session.js';
import { renderTimeline, LEGEND } from './timeline.js';
import { detected, effective, resultOf, accuracy, KINDS, RESULT_FIELDS, SP_LABEL, countBucket, BUCKETS, mss, pct } from './analysis.js';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import * as FB from './feedback.js';
import * as BK from './backup.js';
import * as CP from './capacity.js';
import { EXPORT_STATE_LABEL, exportStateOf, syncExportState, confirmedCount } from './feedback.js';
import { getCapBytes, formatCapacityLabel, TARGET_RATIO } from './capacity.js';

const app = document.getElementById('app');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let session = null;
let currentId = null;
let pendingSeek = null;
let reviewMode = false;
let openDialogOnList = null; // 詳細画面から一覧へ遷移したとき自動で開くダイアログのモード

window.inkgraph = {
  db,
  learn,
  capacity: CP,
  feedback: FB,
  backup: BK,
  buildBatchZip: (...a) => buildBatchZip(...a),
  buildBackupZip: (...a) => buildBackupZip(...a),
  showFeedbackExportDialog: (...a) => showFeedbackExportDialog(...a),
  setReviewMode: v => { reviewMode = !!v; if (currentPage === 'match') PAGES.match(); }
};

let currentPage = 'live';

function updateNavActive(page) {
  document.querySelectorAll('.sidenav a[data-page], nav [data-page]').forEach(a => {
    const active = a.dataset.page === page;
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.classList.toggle('on', active);
  });
}

function nav(page, arg, seekTo = null) {
  if (!PAGES[page]) page = 'live';
  currentPage = page;
  if (arg) currentId = arg;
  pendingSeek = seekTo;
  updateNavActive(page);
  const nextHash = page + (currentId && page === 'match' ? '/' + encodeURIComponent(currentId) : '');
  if (location.hash.slice(1) !== nextHash) {
    history.replaceState(null, '', '#' + nextHash);
  }
  PAGES[page]();
}

document.querySelectorAll('.sidenav a[data-page], nav [data-page]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    nav(a.dataset.page);
  });
});

window.addEventListener('hashchange', () => {
  const [p, id] = location.hash.slice(1).split('/');
  if (id) currentId = decodeURIComponent(id);
  if (PAGES[p]) {
    currentPage = p;
    updateNavActive(p);
    PAGES[p]();
  }
});

// Formatting helpers per spec
const resJa = r => r === 'WIN' ? '勝ち' : r === 'LOSE' ? '負け' : '不明';
const badgeCls = r => r === 'WIN' ? 'badge badge-win' : r === 'LOSE' ? 'badge badge-lose' : 'badge';
const phaseCls = p => p === '抑え' ? 'phase-osae' : p === '打開' ? 'phase-dakai' : 'phase-gokaku';
const phaseBadge = p => {
  const label = p || '互角';
  return `<span class="phase-badge ${phaseCls(label)}">${esc(label)}</span>`;
};
const fmtCount = c => c ? String(c).replace('-', '\u2212') : '—';
const fmtDiff = d => d === null || d === undefined || isNaN(d) ? '—' : d > 0 ? `+${d}` : d < 0 ? `\u2212${Math.abs(d)}` : '±0';
const diffCls = d => d === null || d === undefined || isNaN(d) ? 'count-zero' : d > 0 ? 'count-pos' : d < 0 ? 'count-neg' : 'count-zero';

function fmtDelta(d) {
  if (d === null || d === undefined || isNaN(d)) {
    return { text: '—', cls: 'delta-zero', big: false, barW: 0, dir: 'zero' };
  }
  const p = d * 100;
  if (Math.abs(p) < 0.5) {
    return { text: '±0%', cls: 'delta-zero', big: false, barW: 0, dir: 'zero' };
  }
  const r = Math.round(Math.abs(p));
  const barW = Math.min(60, Math.max(3, Math.round(Math.abs(p) / 25 * 60)));
  return {
    text: p > 0 ? `+${r}%` : `\u2212${r}%`,
    cls: p > 0 ? 'delta-up' : 'delta-down',
    big: Math.abs(p) >= 10,
    barW,
    dir: p > 0 ? 'up' : 'down'
  };
}

function deltaCellHtml(d) {
  const f = fmtDelta(d);
  if (f.text === '—') return `<span class="num delta-zero">—</span>`;
  return `<div class="delta-cell">
    <span class="num ${f.cls}" style="min-width:42px">${f.text}</span>
    <span class="delta-bar-track">${f.barW > 0 ? `<span class="delta-bar-fill ${f.dir}" style="width:${f.barW}px"></span>` : ''}</span>
  </div>`;
}

const download = (name, blob) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

const fmtBytes = b => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB');

function renderCapacityBanner(summary) {
  if (!summary || summary.level === 'ok') return '';
  const label = formatCapacityLabel(summary);
  return `
    <div class="capacity-banner">
      <div class="capacity-banner-text">
        <span class="capacity-banner-icon">⚠</span>
        <span>静止画の容量：${esc(label)}</span>
      </div>
      <button class="btn capacity-cleanup-btn" type="button">古い試合を書き出して消す</button>
    </div>
  `;
}

function wireCapacityBanner(page, summary) {
  const btn = $('.capacity-cleanup-btn', page);
  if (btn) {
    btn.onclick = async () => {
      const ok = window.confirm(
        '古い試合（お気に入りを除く）の静止画を削除して容量を確保します。\n\n' +
        '※ 試合の記録・勝敗・正解データはそのまま残ります。\n' +
        '※ 静止画を手元に残したい場合は、先に試合一覧の「バックアップを書き出す」または「正解データを書き出す」を行ってください。\n\n' +
        '静止画のクリーンアップを実行しますか？'
      );
      if (!ok) return;
      try {
        await db.enforceCapacity(getCapBytes(), TARGET_RATIO, { force: true });
      } catch (e) {
        console.warn('enforceCapacity failed', e);
      }
      nav(currentPage);
    };
  }
}

const PAGES = {};

// ============================================================================
// 1. ライブ分析
// ============================================================================
PAGES.live = async () => {
  if (session && session.running && session.page) {
    app.replaceChildren(session.page);
    return;
  }
  const savedMatches = await db.allMatches();
  const capUsage = await db.stillsUsage(getCapBytes());
  const capLabel = formatCapacityLabel(capUsage);
  const isBlocked = capUsage.level === 'block';
  const page = document.createElement('div');
  page.innerHTML = `
    ${renderCapacityBanner(capUsage)}
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h1 class="page-title">ライブ分析</h1>
        <span class="capacity-status muted">${esc(capLabel)}</span>
      </div>
    </div>

    <div class="card live-source-card">
      <div class="pill-tabs" role="tablist" aria-label="入力元の切り替え">
        <label class="pill-tab active" data-src-tab="device">
          <input type="radio" name="src" value="device" checked>
          キャプチャーボード
        </label>
        <label class="pill-tab" data-src-tab="file">
          <input type="radio" name="src" value="file">
          録画ファイル
        </label>
      </div>

      <div class="live-source-controls">
        <div id="device-controls" style="display:flex;align-items:center;gap:8px;flex:1">
          <select id="dev" class="input" style="min-width:220px"><option value="">（機器を読み込み中…）</option></select>
          <button class="btn" id="reload" type="button">再検出</button>
        </div>
        <div id="file-controls" style="display:none;align-items:center;gap:8px;flex:1">
          <label class="btn" for="file">ファイルを選ぶ</label>
          <input type="file" id="file" accept="video/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">
          <span id="file-name" class="muted">ファイル未選択</span>
        </div>
      </div>

      <details class="details-popover">
        <summary>詳細設定 ▸</summary>
        <div class="details-popover-body">
          <label><input type="checkbox" id="fast" checked> ファイルは早送りで解析（再生しない）</label>
          <p class="muted" id="still-note" style="margin:6px 0 0">映像は保存しません。確認用に、リザルトやキル・デス・スペシャルなどの要所の静止画だけを保存します。</p>
        </div>
      </details>

      <div class="live-source-actions">
        <button class="btn btn-primary" id="start" type="button" ${isBlocked ? 'disabled' : ''}>解析を開始</button>
        <button class="btn btn-stop" id="stop" type="button" disabled style="display:none">停止</button>
        ${isBlocked ? `<div class="capacity-block-reason">使用量${capUsage.pct}%で上限に近づいているため解析を開始できません。古い試合の静止画を削除するか、上の「古い試合を書き出して消す」を実行してください。</div>` : ''}
      </div>
    </div>

    <div class="live-grid">
      <div class="card video-card">
        <div class="video-status-overlay">
          <span id="live-dot" class="status-dot-idle"></span>
          <span id="state">待機中（映像を選択して開始）</span>
        </div>
        <div class="video-empty-state" id="video-empty">
          <p>キャプチャーボードを接続するか、録画ファイルを選んで解析を開始してください</p>
          <button class="btn" id="video-pick-file" type="button">録画ファイルを選ぶ</button>
        </div>
        <video id="v" playsinline muted></video>
      </div>

      <div class="card live-match-card">
        <div class="card-title" style="margin-bottom:0">この試合</div>

        <div class="live-stats-row">
          <div class="stat">
            <div class="stat-label">キル</div>
            <div class="stat-value-2xl num" id="k">—</div>
          </div>
          <div class="stat">
            <div class="stat-label">デス</div>
            <div class="stat-value-2xl num" id="d">—</div>
          </div>
          <div class="stat">
            <div class="stat-label">スペシャル</div>
            <div class="stat-value-2xl num" id="sp">—</div>
          </div>
        </div>

        <div class="live-context-row">
          <div class="live-context-box phase-gokaku" id="live-phase-box">
            <span class="stat-label">今の局面</span>
            <span class="live-context-val" id="live-phase">互角</span>
          </div>
          <div class="live-context-box">
            <span class="stat-label">カウント差</span>
            <span class="live-context-val num count-zero" id="live-diff">±0</span>
          </div>
          <div class="live-context-box">
            <span class="stat-label" style="white-space:nowrap">勝率の目安</span>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px">
              <span class="live-context-val num" id="live-wp">50%</span>
              <svg id="live-spark" viewBox="0 0 100 24" width="64" height="20" style="flex:1;max-width:72px">
                <line x1="0" x2="100" y1="12" y2="12" stroke="var(--border-strong)" stroke-dasharray="2,2"/>
                <polyline id="live-spark-line" fill="none" stroke="var(--ally)" stroke-width="2" points="0,12 100,12"/>
              </svg>
            </div>
          </div>
        </div>

        <div>
          <div class="stat-label" style="margin-bottom:6px">出来事（新しい順）</div>
          <div class="live-events-list" id="log">
            <div class="faint" id="log-empty" style="padding:16px 8px;text-align:center">解析を開始すると出来事が表示されます</div>
          </div>
        </div>

        <div class="live-footer">
          <span id="saved">保存した試合：<b class="num">${savedMatches.length}</b>件</span>
          <a href="#list" class="link-accent" id="to-list">試合一覧へ →</a>
        </div>
      </div>
    </div>
  `;
  app.replaceChildren(page);
  wireCapacityBanner(page, capUsage);

  $('#to-list', page).onclick = e => { e.preventDefault(); nav('list'); };

  const syncSourceTabs = () => {
    const mode = page.querySelector('input[name="src"]:checked')?.value || 'device';
    page.querySelectorAll('.pill-tab').forEach(lbl => {
      lbl.classList.toggle('active', lbl.dataset.srcTab === mode);
    });
    $('#device-controls', page).style.display = mode === 'device' ? 'flex' : 'none';
    $('#file-controls', page).style.display = mode === 'file' ? 'flex' : 'none';
  };
  page.querySelectorAll('input[name="src"]').forEach(r => r.addEventListener('change', syncSourceTabs));

  $('#video-pick-file', page).onclick = () => {
    const fileRadio = page.querySelector('input[name="src"][value="file"]');
    if (fileRadio && !fileRadio.checked) {
      fileRadio.checked = true;
      syncSourceTabs();
    }
    $('#file', page).click();
  };

  $('#file', page).addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) {
      $('#file-name', page).textContent = f.name;
      const fileRadio = page.querySelector('input[name="src"][value="file"]');
      if (fileRadio && !fileRadio.checked) {
        fileRadio.checked = true;
        syncSourceTabs();
      }
    }
  });

  const fillDevices = async () => {
    const ds = await listDevices();
    const sel = $('#dev', page);
    sel.innerHTML = ds.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'カメラ ' + (i + 1))}</option>`).join('') || '<option value="">機器が見つかりません</option>';
    const cap = ds.find(d => /capvo|capture|usb video|hdmi|cam link|elgato|avermedia/i.test(d.label));
    if (cap) sel.value = cap.deviceId;
  };
  fillDevices().catch(() => {});
  $('#reload', page).onclick = fillDevices;

  const wpHistory = [50];
  const updateSpark = wpPct => {
    wpHistory.push(wpPct);
    if (wpHistory.length > 24) wpHistory.shift();
    $('#live-wp', page).textContent = `${Math.round(wpPct)}%`;
    const pts = wpHistory.map((v, i) => {
      const x = wpHistory.length === 1 ? 100 : (i / (wpHistory.length - 1)) * 100;
      const y = 22 - (Math.max(0, Math.min(100, v)) / 100) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    $('#live-spark-line', page)?.setAttribute('points', pts);
  };

  const addEventRow = (timeStr, iconHtml, label, deltaVal) => {
    const empty = $('#log-empty', page);
    if (empty) empty.remove();
    const d = fmtDelta(deltaVal);
    $('#log', page).insertAdjacentHTML('afterbegin', `
      <div class="live-event-item">
        <span class="num muted">${esc(timeStr)}</span>
        <span>${iconHtml}</span>
        <span>${esc(label)}</span>
        <span class="num ${d.cls}">${d.text}</span>
      </div>
    `);
  };

  let savedCount = savedMatches.length;

  $('#start', page).onclick = async () => {
    const curUsage = await db.stillsUsage(getCapBytes()).catch(() => null);
    if (curUsage && curUsage.level === 'block') {
      alert(`使用量${curUsage.pct}%で上限に近づいているため解析を開始できません。古い試合の静止画を削除してください。`);
      return;
    }
    const mode = page.querySelector('input[name="src"]:checked').value;
    const file = $('#file', page).files[0];
    if (mode === 'file' && !file) {
      alert('録画ファイルを選んでください');
      return;
    }
    let k = 0, d = 0, sp = 0, t0 = 0, estWp = 0.5, justSaved = false;
    $('#k', page).textContent = '0';
    $('#d', page).textContent = '0';
    $('#sp', page).textContent = '0';
    const vEmpty = $('#video-empty', page);
    if (vEmpty) vEmpty.style.display = 'none';
    session = new Session($('#v', page), {
      event: e => {
        const tt = mss(e.t - t0);
        if (e.type === 'battle_start') {
          t0 = e.t; k = d = sp = 0; estWp = 0.5;
          updateSpark(50);
          addEventRow('0:00', '▶', 'バトル開始', null);
        } else if (e.type === 'battle_end') {
          addEventRow(tt, '■', 'バトル終了', null);
        } else if (e.type === 'own_kill') {
          k++;
          const delta = 0.08;
          estWp = Math.min(0.95, estWp + delta);
          updateSpark(estWp * 100);
          addEventRow(tt, '<b style="color:var(--kill)">★</b>', 'キル', delta);
        } else if (e.type === 'own_death') {
          d++;
          const delta = -0.10;
          estWp = Math.max(0.05, estWp + delta);
          updateSpark(estWp * 100);
          addEventRow(tt, '<b style="color:var(--death)">×</b>', 'デス', delta);
        } else if (e.type === 'special') {
          sp++;
          addEventRow(tt, '<b style="color:var(--special)">◆</b>', 'スペシャル', 0);
        }
        $('#k', page).textContent = k;
        $('#d', page).textContent = d;
        $('#sp', page).textContent = sp;
      },
      status: m => {
        if (m.state === 'battle' || m.state === 'result') justSaved = false;
        if (justSaved) return;
        const dot = $('#live-dot', page), st = $('#state', page);
        if (m.state === 'idle') {
          dot.className = 'status-dot-idle'; dot.style.background = 'var(--text-muted)';
          st.textContent = '試合の開始を待っています';
          return;
        }
        dot.className = 'pulse-dot'; dot.style.background = '';
        const dur = $('#v', page).duration;
        st.textContent = session?.mode === 'file'
          ? `解析中 · ${mss($('#v', page).currentTime)}${isFinite(dur) ? ' / ' + mss(dur) : ''}`
          : `解析中 · 経過 ${mss(session ? session.now() : 0)}`;
      },
      
      match: rec => {
        savedCount++;
        justSaved = true;
        $('#live-dot', page).className = 'status-dot-idle';
        $('#live-dot', page).style.background = 'var(--kill)';
        $('#state', page).textContent = '保存しました';
        const ev = effective(rec);
        $('#k', page).textContent = ev.filter(x => x.kind === 'kill').length;
        $('#d', page).textContent = ev.filter(x => x.kind === 'death').length;
        $('#sp', page).textContent = ev.filter(x => x.kind === 'special').length;
        if (rec.tower_series?.length) {
          const last = rec.tower_series[rec.tower_series.length - 1];
          const diff = last.own - last.enemy;
          const ph = diff > 0 ? '抑え' : diff < 0 ? '打開' : '互角';
          const pb = $('#live-phase-box', page);
          pb.className = `live-context-box ${phaseCls(ph)}`;
          $('#live-phase', page).textContent = ph;
          const dfEl = $('#live-diff', page);
          dfEl.className = `live-context-val num ${diffCls(diff)}`;
          dfEl.textContent = fmtDiff(diff);
        }
        $('#saved', page).innerHTML = `保存した試合：<b class="num">${savedCount}</b>件`;
      },
      stopped: () => {
        $('#start', page).disabled = false;
        $('#start', page).style.display = 'inline-flex';
        $('#stop', page).disabled = true;
        $('#stop', page).style.display = 'none';
        if (justSaved) return;
        $('#live-dot', page).className = 'status-dot-idle';
        $('#live-dot', page).style.background = '';
        $('#state', page).textContent = '停止しました';
      }
    });
    session.page = page;
    $('#start', page).disabled = true;
    $('#start', page).style.display = 'none';
    $('#stop', page).disabled = false;
    $('#stop', page).style.display = 'inline-flex';
    $('#live-dot', page).className = 'pulse-dot';
    $('#live-dot', page).style.background = '';
    $('#state', page).textContent = '解析中';
    try {
      await session.start({
        mode,
        deviceId: $('#dev', page).value,
        file,
        fast: $('#fast', page).checked
      });
    } catch (e) {
      alert('開始できませんでした：' + e.message);
      $('#start', page).disabled = false;
      $('#start', page).style.display = 'inline-flex';
      $('#stop', page).disabled = true;
      $('#stop', page).style.display = 'none';
      $('#live-dot', page).className = 'status-dot-idle';
      $('#state', page).textContent = '待機中';
      if (vEmpty && !$('#v', page).src) vEmpty.style.display = 'flex';
    }
  };
  $('#stop', page).onclick = () => session && session.stop();
};

// ============================================================================
// 2. 試合一覧
// ============================================================================
let listFilters = { mode: 'ALL', stage: 'ALL', result: 'ALL' };

// 表示用: 静止画の状態キー (旧レコードは stills.count から推定)
function stillsStateKey(m) {
  if (m.stillsState === 'kept' || m.stillsState === 'deleted' || m.stillsState === 'none') return m.stillsState;
  return m.stills?.count > 0 ? 'kept' : 'none';
}
function stillsStateLabel(m) {
  const k = stillsStateKey(m);
  if (k === 'kept') return m.stills?.count ? `静止画 保持中・${m.stills.count}枚` : '静止画 保持中';
  if (k === 'deleted') return '静止画 削除済み';
  return '静止画 未保存';
}

PAGES.list = async () => {
  const ms = await db.allMatches();
  const snapsById = new Map();
  for (const m of ms) snapsById.set(m.id, await db.snapsOf(m.id));

  // 学習パネル表示時に, features欠けのsnapがあれば computeStillFeature で補完し db.updateSnapFeatures + setMatchLearnFeatures で永続化 (失敗は無視/表示のみ)
  for (const m of ms) {
    const snaps = snapsById.get(m.id) || [];
    let updatedAny = false;
    for (const s of snaps) {
      if (!s.features && s.blob) {
        try {
          const feat = await learn.computeStillFeature(s.blob, s);
          s.features = feat;
          await db.updateSnapFeatures(s.id, feat);
          updatedAny = true;
        } catch (e) {
          console.warn('computeStillFeature backfill failed', s.id, e);
        }
      }
    }
    if (updatedAny) {
      const validFeats = snaps.map(s => s.features).filter(Boolean);
      if (validFeats.length > 0) {
        await db.setMatchLearnFeatures(m.id, validFeats).catch(() => {});
        m.learnFeatures = validFeats;
      }
    }
  }

  const summary = BK.summarize(ms, snapsById);
  const expLabel = `バックアップを書き出す（ZIP）・${summary.matches}試合／静止画${summary.stills}枚／約${fmtBytes(summary.bytes)}`;
  const capUsage = await db.stillsUsage(getCapBytes());
  const capLabel = formatCapacityLabel(capUsage);

  const page = document.createElement('div');

  const modes = [...new Set(ms.map(m => resultOf(m).mode || '不明'))];
  const stages = [...new Set(ms.map(m => resultOf(m).stage || '不明'))];

  const filtered = ms.filter(m => {
    const r = resultOf(m);
    if (listFilters.mode !== 'ALL' && (r.mode || '不明') !== listFilters.mode) return false;
    if (listFilters.stage !== 'ALL' && (r.stage || '不明') !== listFilters.stage) return false;
    if (listFilters.result !== 'ALL' && r.result !== listFilters.result) return false;
    return true;
  });

  const hasMatches = ms.length > 0;
  const pending = FB.pendingMatches(ms);
  const pendingConfirmed = pending.reduce((a, m) => a + FB.confirmedCount(m), 0);
  const recentHist = [...FB.getFeedbackHistory()].slice(-5).reverse();

  page.innerHTML = `
    ${renderCapacityBanner(capUsage)}
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h1 class="page-title">試合一覧 <span class="num muted">（${ms.length}試合）</span></h1>
        <span class="capacity-status muted">${esc(capLabel)}</span>
      </div>
      <div class="page-header-actions">
        <label class="btn ${hasMatches ? 'btn-primary' : ''}">
          バックアップを読み込む
          <input type="file" id="imp" accept=".json,.zip" hidden>
        </label>
        <details class="dropdown">
          <summary class="btn">バックアップ ▾</summary>
          <div class="dropdown-menu">
            <button class="dropdown-item" id="bkexp" type="button" title="${esc(expLabel)}">${esc(expLabel)}</button>
          </div>
        </details>
      </div>
    </div>

    ${hasMatches ? (pending.length > 0 ? `
      <div class="fb-bar">
        <span class="fb-bar-dot"></span>
        <span id="fb-pending">未書き出しの正解データ <span class="fb-bar-count">${pending.length}</span>試合（確認済み <span class="num">${pendingConfirmed}</span>件）</span>
        <button class="btn btn-primary" id="fbbar" type="button">正解データを書き出す</button>
      </div>
    ` : `
      <div class="fb-bar">
        <span id="fb-pending" class="fb-bar-empty-text">未書き出しの正解データはありません</span>
      </div>
    `) : ''}

    ${hasMatches ? `
      <details class="fb-history">
        <summary>書き出し履歴（最近5件）▸</summary>
        <div class="fb-history-content">
          ${recentHist.length === 0 ? `<div class="fb-history-empty">まだ書き出し履歴がありません</div>` : `
            <table class="table fb-history-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>区分</th>
                  <th>試合数</th>
                  <th>ファイル名</th>
                </tr>
              </thead>
              <tbody>
                ${recentHist.map(h => {
                  const f = FB.formatHistoryItem(h);
                  return `<tr>
                    <td class="num">${esc(f.dtStr)}</td>
                    <td>${esc(f.modeStr)}</td>
                    <td class="num">${esc(f.countStr)}</td>
                    <td class="fb-history-fname">${esc(h.filename)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          `}
        </div>
      </details>
    ` : ''}

    <section id="learn-panel" class="card learn-panel"></section>

    ${!hasMatches ? `
      <div class="card">
        <div class="empty-state">
          <p>保存された試合がまだありません。ライブ分析で録画を解析するか、バックアップを読み込んでください。</p>
          <button class="btn btn-primary" id="empty-go-live" type="button">ライブ分析へ移動</button>
        </div>
      </div>
    ` : `
      <div class="filter-bar">
        <div class="filter-group">
          <span class="filter-label">ルール</span>
          <button class="chip ${listFilters.mode === 'ALL' ? 'active' : ''}" data-fkind="mode" data-fval="ALL">すべて</button>
          ${modes.map(md => `<button class="chip ${listFilters.mode === md ? 'active' : ''}" data-fkind="mode" data-fval="${esc(md)}">${esc(md)}</button>`).join('')}
        </div>
        <div class="filter-group">
          <span class="filter-label">ステージ</span>
          <button class="chip ${listFilters.stage === 'ALL' ? 'active' : ''}" data-fkind="stage" data-fval="ALL">すべて</button>
          ${stages.map(st => `<button class="chip ${listFilters.stage === st ? 'active' : ''}" data-fkind="stage" data-fval="${esc(st)}">${esc(st)}</button>`).join('')}
        </div>
        <div class="filter-group">
          <span class="filter-label">勝敗</span>
          <button class="chip ${listFilters.result === 'ALL' ? 'active' : ''}" data-fkind="result" data-fval="ALL">すべて</button>
          <button class="chip ${listFilters.result === 'WIN' ? 'active' : ''}" data-fkind="result" data-fval="WIN">勝ち</button>
          <button class="chip ${listFilters.result === 'LOSE' ? 'active' : ''}" data-fkind="result" data-fval="LOSE">負け</button>
        </div>
      </div>

      <div class="match-list">
        ${filtered.map(m => {
          const r = resultOf(m);
          const ev = effective(m);
          const det = detected(m);
          const rv = det.filter(e => e.mark).length;
          const kCnt = ev.filter(e => e.kind === 'kill').length;
          const dCnt = ev.filter(e => e.kind === 'death').length;
          const spCnt = ev.filter(e => e.kind === 'special').length;
          const dMismatch = r.deaths !== undefined && r.deaths !== null && r.deaths !== dCnt;
          const spMismatch = r.specials !== undefined && r.specials !== null && r.specials !== spCnt;
          const showResultDiff = dMismatch || spMismatch;
          const diffParts = [];
          const diffTipParts = [];
          if (dMismatch) {
            diffParts.push(`デス<span class="num mismatch-val">${esc(r.deaths)}</span>`);
            diffTipParts.push(`デス：検出${dCnt} / リザルト画面${r.deaths}`);
          }
          if (spMismatch) {
            diffParts.push(`スペシャル<span class="num mismatch-val">${esc(r.specials)}</span>`);
            diffTipParts.push(`スペシャル：検出${spCnt} / リザルト画面${r.specials}`);
          }
          const diffTip = diffTipParts.join('、');
          const pctRv = det.length ? Math.round((rv / det.length) * 100) : 0;
          const dtStr = m.created ? new Date(m.created).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

          return `
            <div class="match-row click" data-id="${esc(m.id)}">
              <div class="match-row-col-res">
                <button class="fav-btn" data-id="${esc(m.id)}" type="button" aria-label="お気に入り" title="お気に入り">${m.favorite === true ? '★' : '☆'}</button>
                <span class="${badgeCls(r.result)}">${resJa(r.result)}</span>
                <span class="match-row-date num">${esc(dtStr)}</span>
              </div>

              <div class="match-row-col-stage">
                <span class="match-row-title">${esc(r.mode || 'ルール不明')}・${esc(r.stage || 'ステージ不明')}</span>
                <span class="stills-state">${esc(stillsStateLabel(m))}</span>
                <span class="export-state" data-state="${FB.exportStateOf(m)}">${esc(EXPORT_STATE_LABEL[FB.exportStateOf(m)])}</span>
                ${r.count ? `<span class="match-row-count num">${fmtCount(r.count)}</span>` : ''}
              </div>

              <div class="match-row-col-kda">
                <div class="kda-metrics">
                  <span class="kda-item"><span class="kda-label">キル</span><span class="kda-val num">${kCnt}</span></span>
                  <span class="kda-item"><span class="kda-label">デス</span><span class="kda-val num ${dMismatch ? 'mismatch-val' : ''}" ${dMismatch ? `title="リザルト画面ではデス${esc(r.deaths)}"` : ''}>${dCnt}</span></span>
                  <span class="kda-item"><span class="kda-label">スペシャル</span><span class="kda-val num ${spMismatch ? 'mismatch-val' : ''}" ${spMismatch ? `title="リザルト画面ではスペシャル${esc(r.specials)}"` : ''}>${spCnt}</span></span>
                </div>
                ${showResultDiff ? `<span class="kda-mismatch" title="${esc(diffTip)}">リザルト画面では${diffParts.join('・')}</span>` : ''}
              </div>

              <div class="match-row-col-prog">
                <div class="progress-bar-120"><div class="progress-bar-fill" style="width:${pctRv}%"></div></div>
                <span class="progress-label">確認 <span class="num">${rv}/${det.length}</span></span>
              </div>

              <details class="dropdown row-menu">
                <summary class="btn-dots" title="メニュー">⋯</summary>
                <div class="dropdown-menu">
                  <button class="dropdown-item del-stills" data-id="${esc(m.id)}" type="button">静止画だけ消す</button>
                  <button class="dropdown-item btn-danger-ghost del" data-id="${esc(m.id)}" type="button">削除</button>
                </div>
              </details>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  app.replaceChildren(page);
  wireCapacityBanner(page, capUsage);

  const goLiveBtn = $('#empty-go-live', page);
  if (goLiveBtn) goLiveBtn.onclick = () => nav('live');

  page.querySelectorAll('.chip[data-fkind]').forEach(btn => {
    btn.onclick = () => {
      listFilters[btn.dataset.fkind] = btn.dataset.fval;
      PAGES.list();
    };
  });

  page.querySelectorAll('.row-menu').forEach(menu => {
    menu.addEventListener('click', e => e.stopPropagation());
  });

  page.querySelectorAll('.match-row.click').forEach(row => {
    row.onclick = e => {
      if (e.target.closest('.row-menu') || e.target.closest('.fav-btn') || e.target.classList.contains('del')) return;
      nav('match', row.dataset.id);
    };
  });

  page.querySelectorAll('.fav-btn').forEach(b => {
    b.onclick = async e => {
      e.stopPropagation();
      const cur = await db.getMatch(b.dataset.id);
      await db.setFavorite(b.dataset.id, !(cur && cur.favorite === true));
      PAGES.list();
    };
  });

  page.querySelectorAll('.del-stills').forEach(b => {
    b.onclick = async e => {
      e.stopPropagation();
      if (confirm('静止画だけを削除しますか？（試合の記録と確認データは残ります）')) {
        await db.deleteStills(b.dataset.id);
        PAGES.list();
      }
    };
  });

  page.querySelectorAll('.del').forEach(b => {
    b.onclick = async e => {
      e.stopPropagation();
      if (confirm('この試合を削除しますか？（静止画も消えます）')) {
        await db.delMatch(b.dataset.id);
        PAGES.list();
      }
    };
  });

  const bkexp = $('#bkexp', page);
  if (bkexp) {
    bkexp.onclick = async () => {
      try {
        const { blob, filename } = await buildBackupZip();
        download(filename, blob);
      } catch (err) {
        alert('バックアップの書き出しに失敗しました: ' + (err?.message || err));
      }
    };
  }
  $('#imp', page).onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const isZip = f.name.toLowerCase().endsWith('.zip') || (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B);
      if (isZip) {
        const unzipped = unzipSync(buf);
        const metaU8 = unzipped['backup.json'];
        if (!metaU8) {
          throw new Error('ZIP内に backup.json が見つかりません');
        }
        const meta = JSON.parse(new TextDecoder().decode(metaU8));
        if (meta.kind !== 'backup') {
          throw new Error('バックアップ形式ではありません');
        }
        BK.applySettings(meta.settings, localStorage);
        const stills = [];
        for (const s of (meta.stills || [])) {
          const u8 = unzipped[s.file];
          if (u8) {
            stills.push({
              matchId: s.matchId,
              t: s.t,
              reason: s.reason,
              kind: s.kind,
              header: s.header,
              event: s.event,
              blob: new Blob([u8], { type: 'image/jpeg' })
            });
          }
        }
        const res = await db.importBackup({ matches: meta.matches || [], stills });
        alert(`バックアップから ${res.matches}試合（静止画${res.stills}枚）を読み込みました`);
      } else {
        const text = new TextDecoder().decode(buf);
        const j = JSON.parse(text);
        const n = await db.importAll(j);
        alert(`旧形式の試合ログから ${n}試合を読み込みました（静止画・設定は含まれません）`);
      }
      PAGES.list();
    } catch (err) {
      alert('読み込みに失敗しました: ' + (err?.message || err));
    } finally {
      e.target.value = '';
    }
  };
  const fbbar = $('#fbbar', page);
  if (fbbar) fbbar.onclick = () => showFeedbackExportDialog('diff');
  if (openDialogOnList) { const md = openDialogOnList; openDialogOnList = null; showFeedbackExportDialog(md); }

  // 自己学習パネル（S0-S1）
  let learnCandidate = null;
  let learnConfirming = false;

  function renderCandidateResult(cand, confirming) {
    const renderRow = (section, fieldLabel, cmp, isInsuf) => {
      if (isInsuf) {
        return `<tr>
          <td>${esc(section)}</td>
          <td>${esc(fieldLabel)}</td>
          <td colspan="5" class="muted">材料不足（サンプル3件未満）</td>
        </tr>`;
      }
      const p1 = (cmp.beforeAcc * 100).toFixed(1) + '%';
      const p2 = (cmp.afterAcc * 100).toFixed(1) + '%';
      return `<tr>
        <td>${esc(section)}</td>
        <td>${esc(fieldLabel)}</td>
        <td class="num">${cmp.beforeCorrect} → ${cmp.afterCorrect} / ${cmp.n}</td>
        <td class="num">${p1} → ${p2}</td>
        <td class="num ${cmp.fixed > 0 ? 'text-success' : 'muted'}">${cmp.fixed > 0 ? `+${cmp.fixed}` : '0'}</td>
        <td class="num ${cmp.broken > 0 ? 'text-danger' : 'muted'}">${cmp.broken > 0 ? `-${cmp.broken}` : '0'}</td>
        <td class="num muted">${cmp.unchanged}</td>
      </tr>`;
    };

    const trn = cand.trainCompare;
    const hld = cand.holdoutCompare;
    const isModeInsuf = cand.insufficient.includes('mode');
    const isStageInsuf = cand.insufficient.includes('stage');

    const rows = [];
    rows.push(renderRow('train (学習)', 'ルール (mode)', trn.mode, isModeInsuf));
    rows.push(renderRow('train (学習)', 'ステージ (stage)', trn.stage, isStageInsuf));
    rows.push(renderRow('train (学習)', '合計', trn.total, false));

    if (hld) {
      rows.push(renderRow('holdout (評価)', 'ルール (mode)', hld.mode, isModeInsuf));
      rows.push(renderRow('holdout (評価)', 'ステージ (stage)', hld.stage, isStageInsuf));
      rows.push(renderRow('holdout (評価)', '合計', hld.total, false));
    }

    const totalBroken = trn.total.broken + (hld?.total?.broken || 0);

    return `
      <div class="learn-candidate-card">
        <div class="learn-candidate-header">
          <h3 class="learn-candidate-title">再判定結果（候補閾値: ルール <strong>${cand.thresholds.mode.toFixed(2)}</strong> / ステージ <strong>${cand.thresholds.stage.toFixed(2)}</strong>）</h3>
          <span class="learn-candidate-note muted">${esc(cand.note)}</span>
        </div>

        <table class="table learn-result-table">
          <thead>
            <tr>
              <th>区分</th>
              <th>対象</th>
              <th>正解数 (前 → 後)</th>
              <th>一致率 (前 → 後)</th>
              <th>直った</th>
              <th>新たに壊れた</th>
              <th>不変</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>

        ${cand.insufficient.length > 0 ? `
          <div class="learn-insufficient-banner muted">
            ⚠️ 材料不足（サンプル3件未満）: ${cand.insufficient.map(f => f === 'mode' ? 'ルール' : 'ステージ').join(', ')} は既定値（0.50）を維持します。
          </div>
        ` : ''}

        <div class="learn-decision-actions">
          <button class="btn btn-primary" id="learn-apply" type="button">この候補を端末内に適用</button>
          <button class="btn btn-ghost" id="learn-reject" type="button">候補を却下</button>
        </div>

        <div id="learn-confirm" class="learn-confirm-card" ${confirming ? '' : 'hidden'}>
          ${totalBroken > 0 ? `
            <div class="learn-broken-warning">
              ⚠️ <strong>警告: 新たに判定が壊れた件数が ${totalBroken} 件あります。</strong><br>
              適用すると、これまで正解判定されていた試合の一部が不正解（未検出）になる可能性があります。
            </div>
          ` : `
            <div class="learn-confirm-msg">
              この候補を端末内に適用します。今後の試合解析および静止画再判定に反映されます。よろしいですか？
            </div>
          `}
          <div class="learn-confirm-actions">
            <button class="btn ${totalBroken > 0 ? 'btn-danger' : 'btn-primary'}" id="learn-confirm-yes" type="button">確認して適用</button>
            <button class="btn btn-secondary" id="learn-confirm-no" type="button">やめる</button>
          </div>
        </div>
      </div>
    `;
  }

  const updateLearnPanel = async () => {
    const learnPanelEl = $('#learn-panel', page);
    if (!learnPanelEl) return;

    const allSamples = learn.collectSamples(ms, snapsById);
    const confirmedMatchesCount = new Set(allSamples.map(s => s.matchId)).size;
    const { train: trn, holdout: hld } = learn.splitHoldout(allSamples);
    const hasHoldout = hld.length > 0;
    const activePack = await db.activeLearnPack().catch(() => null);

    learnPanelEl.innerHTML = `
      <div class="learn-panel-header">
        <div class="learn-panel-title-wrap">
          <h2 class="learn-panel-title">自己学習（候補提示）</h2>
          <span class="learn-badge ${activePack ? 'badge-active' : 'badge-neutral'}">${activePack ? '学習適用中' : '未適用（既定値）'}</span>
        </div>
        ${activePack ? `<button class="btn btn-secondary btn-sm" id="learn-rollback" type="button">学習を1つ前に戻す</button>` : ''}
      </div>

      <div class="learn-panel-body">
        <div class="learn-meta-row">
          <div class="learn-meta-item">確認済み試合数: <strong class="num">${confirmedMatchesCount}</strong> 試合</div>
          <div class="learn-meta-item">サンプル数: <strong class="num">${allSamples.length}</strong> 件</div>
          <div class="learn-meta-item">holdout: <strong>${hasHoldout ? `あり（${hld.length}件）` : 'なし'}</strong></div>
        </div>
        <p class="learn-note muted">※ 映像は保存されていないため再判定は静止画・特徴量・系列のみで行われます。</p>

        <div class="learn-active-info">
          ${activePack ? `
            <div class="learn-pack-desc">
              適用中パック: <strong class="num">${esc(activePack.packId)}</strong>（作成: ${esc(activePack.created.slice(0, 16).replace('T', ' '))}) / 
              閾値: ルール <strong>${activePack.thresholds.mode.toFixed(2)}</strong>、ステージ <strong>${activePack.thresholds.stage.toFixed(2)}</strong> / 
              元試合: <strong>${activePack.sourceMatchIds.length}</strong> 試合
            </div>
          ` : `
            <div class="learn-pack-desc muted">適用中パック: なし（既定値: ルール 0.50 / ステージ 0.50）</div>
          `}
        </div>

        <div class="learn-actions-row">
          <button class="btn btn-primary" id="learn-candidate" type="button">候補を作って再判定</button>
        </div>

        <div id="learn-result" class="learn-result" ${learnCandidate ? '' : 'hidden'}>
          ${learnCandidate ? renderCandidateResult(learnCandidate, learnConfirming) : ''}
        </div>
      </div>
    `;

    const btnCand = $('#learn-candidate', learnPanelEl);
    if (btnCand) {
      btnCand.onclick = () => {
        learnCandidate = learn.generateCandidate(allSamples);
        learnConfirming = false;
        updateLearnPanel();
      };
    }
    const btnRollback = $('#learn-rollback', learnPanelEl);
    if (btnRollback) {
      btnRollback.onclick = async () => {
        await db.rollbackLearnPack();
        learnCandidate = null;
        learnConfirming = false;
        PAGES.list();
      };
    }
    const btnReject = $('#learn-reject', learnPanelEl);
    if (btnReject) {
      btnReject.onclick = () => {
        learnCandidate = null;
        learnConfirming = false;
        updateLearnPanel();
      };
    }
    const btnApply = $('#learn-apply', learnPanelEl);
    if (btnApply) {
      btnApply.onclick = () => {
        learnConfirming = true;
        updateLearnPanel();
      };
    }
    const btnConfirmNo = $('#learn-confirm-no', learnPanelEl);
    if (btnConfirmNo) {
      btnConfirmNo.onclick = () => {
        learnConfirming = false;
        updateLearnPanel();
      };
    }
    const btnConfirmYes = $('#learn-confirm-yes', learnPanelEl);
    if (btnConfirmYes) {
      btnConfirmYes.onclick = async () => {
        const pack = learn.makePack(learnCandidate, new Date().toISOString());
        await db.applyLearnPack(pack);
        learnCandidate = null;
        learnConfirming = false;
        PAGES.list();
      };
    }
  };

  await updateLearnPanel();
};

// ============================================================================
// Backup ZIP & Still-Frame Export
// ============================================================================
// バックアップの書き出し (#34)。試合データ＋設定＋保持中の静止画 (videosは含めない)。
async function buildBackupZip() {
  const matches = await db.allMatches();
  const files = {};
  const stillsById = new Map();

  for (const m of matches) {
    const snaps = await db.snapsOf(m.id);
    if (!snaps || snaps.length === 0) continue;
    const safe = m.id.replace(/[^0-9A-Za-z]/g, '_');
    const snapMetaList = [];
    for (const s of snaps) {
      const name = `stills/${safe}/${s.kind || 'frame'}_${s.t.toFixed(1)}_${s.id}.jpg`;
      const buf = new Uint8Array(await s.blob.arrayBuffer());
      files[name] = buf;
      snapMetaList.push({
        file: name,
        t: s.t,
        reason: s.reason,
        kind: s.kind,
        header: s.header ?? null,
        event: s.event ?? null,
        bytes: buf.byteLength
      });
    }
    stillsById.set(m.id, snapMetaList);
  }

  const settings = BK.collectSettings(typeof localStorage !== 'undefined' ? localStorage : null);
  const now = new Date();
  const meta = BK.buildBackupMeta(matches, stillsById, settings, now.toISOString());
  files['backup.json'] = strToU8(JSON.stringify(meta, null, 1));
  files['README.txt'] = strToU8(BK.backupReadme(meta));
  const zip = zipSync(files, { level: 0 });
  return { blob: new Blob([zip], { type: 'application/zip' }), filename: BK.BACKUP_FILENAME(now), meta };
}

// ============================================================================
// Feedback ZIP & Still-Frame Extraction
// ============================================================================
// 正解データのバッチ書き出し (#33)。即ダウンロードはせず、試合一覧のダイアログでまとめて出す。
async function buildBatchZip(matches, { mode = 'diff', batchId = FB.makeBatchId() } = {}) {
  const files = {};
  const snapshotsById = {};
  for (const m of matches) {
    const snaps = await db.snapsOf(m.id);
    const safe = m.id.replace(/[^0-9A-Za-z]/g, '_');
    const sn = [];
    for (const s of snaps) {
      const name = `images/${safe}/${s.kind || 'frame'}_${s.t.toFixed(1)}_${s.id}.jpg`;
      files[name] = new Uint8Array(await s.blob.arrayBuffer());
      sn.push({ file: name, t: s.t, reason: s.reason, kind: s.kind, header: s.header, event: s.event || null });
    }
    snapshotsById[m.id] = sn;
  }
  const now = new Date();
  const meta = FB.buildFeedbackMeta(matches, { mode, batchId, exportedAt: now.toISOString(), accuracy: accuracy(matches), snapshotsById });
  files['feedback.json'] = strToU8(JSON.stringify(meta, null, 1));
  files['README.txt'] = strToU8(FB.feedbackReadme(meta));
  const zip = zipSync(files, { level: 0 });
  return { blob: new Blob([zip], { type: 'application/zip' }), filename: FB.batchFilename(mode, now), meta };
}

async function showFeedbackExportDialog(initialMode = 'diff') {
  document.querySelector('.fb-dialog-overlay')?.remove();
  const all = await db.allMatches();
  const snapsById = new Map();
  for (const m of all.filter(FB.hasReview)) snapsById.set(m.id, await db.snapsOf(m.id));
  let mode = initialMode === 'full' ? 'full' : 'diff';
  const unchecked = new Set();
  let markExported = true;

  const overlay = document.createElement('div');
  overlay.className = 'fb-dialog-overlay';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  const render = () => {
    const targets = FB.exportableMatches(all, mode).sort((a, b) => String(b.created).localeCompare(String(a.created)));
    const selected = targets.filter(m => !unchecked.has(m.id));
    const est = FB.estimateExport(selected, snapsById);
    const perAll = FB.estimateExport(targets, snapsById).perMatch;
    const hist = FB.getFeedbackHistory();
    const last = hist[hist.length - 1];
    const lastTxt = last ? `前回：${FB.formatHistoryItem(last).label}` : '前回：なし';
    const none = targets.length === 0;
    const noSel = !none && selected.length === 0;

    let removeCount = 0;
    if (est.over50MB) {
      const sorted = [...selected].sort((a, b) => (est.perMatch.get(b.id)?.bytes || 0) - (est.perMatch.get(a.id)?.bytes || 0));
      let rem = est.totalBytes;
      for (const sm of sorted) {
        rem -= (est.perMatch.get(sm.id)?.bytes || 0);
        removeCount++;
        if (rem <= FB.LIMIT_BYTES) break;
      }
    }
    const mbStr = (est.totalBytes / (1024 * 1024)).toFixed(1);

    overlay.innerHTML = `
      <div class="fb-dialog" role="dialog" aria-label="正解データを書き出す">
        <h2 class="fb-dialog-title">正解データを書き出す</h2>
        <div class="fb-dialog-modes">
          <label><input type="radio" name="fbmode" value="diff" ${mode === 'diff' ? 'checked' : ''}> 差分（未書き出し分のみ）</label>
          <label><input type="radio" name="fbmode" value="full" ${mode === 'full' ? 'checked' : ''}> 全件（確認済みすべて）</label>
        </div>
        <div class="fb-dialog-last">${esc(lastTxt)}</div>
        ${none ? `<div class="fb-dialog-empty" id="fbd-empty">${mode === 'diff' ? '未書き出しの正解データがありません（全件モードで出し直せます）。' : '確認済みの試合がありません。'}</div>` : `
        <div class="fb-dialog-list">
          ${targets.map(m => {
            const r = resultOf(m);
            const p = perAll.get(m.id);
            const dt = m.created ? new Date(m.created).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            return `<label class="fb-dialog-row" data-id="${esc(m.id)}">
              <input type="checkbox" class="fbd-chk" data-id="${esc(m.id)}" ${unchecked.has(m.id) ? '' : 'checked'}>
              <span class="num">${esc(dt)}</span>
              <span>${esc(r.stage || 'ステージ不明')}</span>
              <span>${esc(resJa(r.result))}</span>
              <span class="export-state" data-state="${FB.exportStateOf(m)}">${esc(EXPORT_STATE_LABEL[FB.exportStateOf(m)])}</span>
              <span class="num">確認済み ${FB.confirmedCount(m)}件</span>
              <span class="${p.stillsAvailable ? 'num' : 'fb-nostill'}">${p.stillsAvailable ? `静止画 ${p.snaps}枚・${fmtBytes(p.bytes)}` : '静止画なし（削除済み／未保存）'}</span>
            </label>`;
          }).join('')}
        </div>`}
        <div class="fb-dialog-total" id="fbd-total">対象 <span class="num">${selected.length}</span>試合・合計 約<span class="num">${fmtBytes(est.totalBytes)}</span></div>
        ${est.over50MB ? `<div class="fb-dialog-warn" id="fbd-warn">合計 約${mbStr}MBで目安の50MBを超えています。チェックを外して分けてください。あと${removeCount}試合外すと50MB以内です</div>` : ''}
        ${noSel ? `<div class="fb-dialog-empty" id="fbd-reason">書き出す試合が選ばれていません。</div>` : ''}
        <div class="fb-dialog-note">静止画にはプレイヤー名が映る場合があります。ZIPは自動送信されません。手動で渡してください。</div>
        <label class="fb-dialog-mark"><input type="checkbox" id="fbd-mark" ${markExported ? 'checked' : ''}> 書き出し済みにする（次回は差分に出ません）</label>
        ${!markExported ? `<div class="fb-dialog-skip-note" id="fbd-skip-note">今回は記録を残さないため、次回も差分に出ます</div>` : ''}
        <div class="fb-dialog-actions">
          <button class="btn" id="fbd-cancel" type="button">キャンセル</button>
          <button class="btn btn-primary" id="fbd-go" type="button" ${selected.length ? '' : 'disabled'}>ZIPを書き出す</button>
        </div>
      </div>`;
    overlay.querySelectorAll('input[name="fbmode"]').forEach(r => { r.onchange = () => { mode = r.value; unchecked.clear(); render(); }; });
    overlay.querySelectorAll('.fbd-chk').forEach(c => { c.onchange = () => { if (c.checked) unchecked.delete(c.dataset.id); else unchecked.add(c.dataset.id); render(); }; });
    $('#fbd-mark', overlay).onchange = e => { markExported = e.target.checked; render(); };
    $('#fbd-cancel', overlay).onclick = close;
    $('#fbd-go', overlay).onclick = async () => {
      const btn = $('#fbd-go', overlay);
      btn.disabled = true;
      const batchId = FB.makeBatchId();
      const { blob, filename, meta } = await buildBatchZip(selected, { mode, batchId });
      download(filename, blob);
      const at = new Date().toISOString();
      if (markExported) {
        for (const em of meta.matches) {
          const cur = await db.getMatch(em.id);
          if (!cur || !cur.review) continue;
          cur.review.reviewHash = em.reviewHash;
          cur.review.export = { state: 'exported', lastExportedAt: at, lastExportedHash: em.reviewHash, lastBatchId: batchId };
          await db.putMatch(cur);
        }
      }
      FB.addFeedbackHistory({ at, batchId, count: meta.matches.length, filename, mode });
      close();
      if (currentPage === 'list') PAGES.list();
    };
  };
  render();
}


async function grabFrames(video, times, reason, matchId, event) {
  if (!video.src || !video.duration) return 0;
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const ctx = c.getContext('2d');
  const back = video.currentTime;
  let n = 0;
  for (const t of times) {
    if (t < 0 || t > video.duration) continue;
    await new Promise(r => { video.addEventListener('seeked', r, { once: true }); video.currentTime = t; });
    ctx.drawImage(video, 0, 0, 1280, 720);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    await db.putSnap({ matchId, t, reason, kind: 'event', event, blob });
    n++;
  }
  video.currentTime = back;
  return n;
}

// ============================================================================
// 3. 試合の詳細・確認
// ============================================================================
PAGES.match = async () => {
  const ms = await db.allMatches();
  if (!currentId && ms.length) currentId = ms[ms.length - 1].id;
  const m = currentId && await db.getMatch(currentId);
  if (!m) {
    app.innerHTML = `
      <div class="page-header"><h1 class="page-title">試合の詳細・確認</h1></div>
      <div class="card">
        <div class="empty-state">
          <p>表示できる試合がありません。ライブ分析で解析するか、試合一覧からログを読み込んでください。</p>
          <button class="btn btn-primary" id="empty-to-list" type="button">試合一覧へ</button>
        </div>
      </div>`;
    $('#empty-to-list', app).onclick = () => nav('list');
    return;
  }

  m.review = m.review || { marks: {}, added: [], fix: {}, rmarks: {} };
  m.review.rmarks = m.review.rmarks || {};
  m.review.fix = m.review.fix || {};
  const save = async () => {
    m.review.updated = new Date().toISOString();
    syncExportState(m);
    await db.putMatch(m);
    const st = document.getElementById('fbone-state');
    if (st) st.textContent = `この試合：${EXPORT_STATE_LABEL[exportStateOf(m)]}（確認済み ${confirmedCount(m)}件）`;
  };

  const r = resultOf(m);
  const t0 = m.battle[0];
  const evAll = effective(m);
  const kCount = evAll.filter(e => e.kind === 'kill').length;
  const dCount = evAll.filter(e => e.kind === 'death').length;
  const spCount = evAll.filter(e => e.kind === 'special').length;

  const finalDiff = m.tower_series?.length
    ? m.tower_series[m.tower_series.length - 1].own - m.tower_series[m.tower_series.length - 1].enemy
    : null;

  const page = document.createElement('div');
  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">試合の詳細・確認</h1>
      <div class="page-header-actions">
        <select id="pick" class="input">
          ${ms.map((x, idx) => {
            const rr = resultOf(x);
            return `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>第${idx + 1}試合 · ${esc(rr.mode || '')} ${esc(rr.stage || '')}（${resJa(rr.result)}）</option>`;
          }).join('')}
        </select>
      </div>
    </div>

    <div class="card detail-header-card">
      <div class="detail-header-left">
        <span class="${badgeCls(r.result)} result-hero">${resJa(r.result)}</span>
        <div class="detail-stage-info">
          <div class="detail-stage-title">${esc(r.mode || 'ルール不明')}・${esc(r.stage || 'ステージ不明')}</div>
          <div class="detail-count-line">
            <span>最終カウント <b class="num">${fmtCount(r.count)}</b></span>
            ${finalDiff !== null ? `<span class="num ${diffCls(finalDiff)}">（カウント差 ${fmtDiff(finalDiff)}）</span>` : ''}
          </div>
          ${m.stills ? (stillsStateKey(m) === 'deleted' ? `<div class="muted" id="stills-info">静止画 削除済み（記録は残っています。もとの静止画 ${m.stills.count}枚・合計 ${Math.round((m.stills.bytes || 0) / 1024)} KB）</div>` : `<div class="muted" id="stills-info">静止画 ${m.stills.count}枚・合計 ${Math.round((m.stills.bytes || 0) / 1024)} KB（映像は保存されていません）</div>`) : ''}
        </div>
      </div>

      <div class="detail-header-stats">
        <div class="stat">
          <div class="stat-label">キル</div>
          <div class="stat-value num" id="hdr-k">${kCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">デス</div>
          <div class="stat-value num" id="hdr-d">${dCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">スペシャル</div>
          <div class="stat-value num" id="hdr-sp">${spCount}</div>
        </div>
      </div>

      <label class="review-toggle-label" for="review-toggle">
        <input type="checkbox" id="review-toggle" class="toggle-input" ${reviewMode ? 'checked' : ''}>
        <span class="toggle-switch" aria-hidden="true"></span>
        <span>レビューモード</span>
      </label>
    </div>

    <div class="detail-body ${reviewMode ? 'review-on' : ''}" id="detail-body">
      <div class="card detail-timeline-card">
        <div class="card-title">タイムライン</div>
        <div id="tl"></div>
        ${LEGEND}
      </div>

      <div class="card detail-events-card">
        <div class="card-title">出来事</div>
        <table class="table" id="etab"></table>
      </div>

      <aside class="review-panel" id="review-panel">
        <div class="card">
          <div class="card-title">確認用の静止画</div>
          <div class="review-video-wrap" style="position:relative">
            <img id="still-img" alt="確認用の静止画" style="width:100%;height:100%;object-fit:contain;display:none">
            <div id="still-empty" class="muted" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:12px">静止画なし（この試合では静止画が保存されていません）</div>
            <video id="rv" controls muted style="display:none"></video>
          </div>
          <div id="still-cap" class="muted" style="margin-top:8px;min-height:1.4em"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px">
            <span id="vstat" class="muted" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
            <label class="btn btn-sm">録画ファイルを選ぶ<input type="file" id="vf" accept="video/*" hidden></label>
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <div class="review-section-title">見逃しを追加（いまの再生位置）</div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm add" data-k="kill" type="button">＋ キル</button>
              <button class="btn btn-sm add" data-k="death" type="button">＋ デス</button>
              <button class="btn btn-sm add" data-k="special" type="button">＋ スペシャル発動</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">リザルト画面の読み取り</div>
          <table class="table" id="rtab"></table>
        </div>

        <details class="card collapsible-card">
          <summary>検出の精度 <span>▸</span></summary>
          <div id="acc"></div>
        </details>

        <button class="btn btn-primary" id="fbone" type="button" style="width:100%">試合一覧でまとめて書き出す →</button>
        <div class="export-state" id="fbone-state">この試合：${esc(EXPORT_STATE_LABEL[exportStateOf(m)])}（確認済み ${confirmedCount(m)}件）</div>
      </aside>
    </div>
  `;

  app.replaceChildren(page);

  $('#pick', page).onchange = e => nav('match', e.target.value);
  $('#review-toggle', page).onchange = e => {
    reviewMode = e.target.checked;
    $('#detail-body', page).classList.toggle('review-on', reviewMode);
    if (!reviewMode && tlEl) tlEl.closePopover();
    drawTL();
  };

  const video = $('#rv', page);
  let offset = 0;
  let lastSeekTime = m.battle[0] + 45;
  let tlEl = null;

  const updatePlayhead = () => {
    if (tlEl && video.src) tlEl.setPlayhead(video.currentTime + offset);
  };
  video.addEventListener('timeupdate', updatePlayhead);
  video.addEventListener('seeked', updatePlayhead);

  const stills = (await db.snapsOf(m.id)).sort((a, b) => a.t - b.t);
  const stillImg = $('#still-img', page), stillEmpty = $('#still-empty', page), stillCap = $('#still-cap', page);
  const KIND_JA = { kill: 'キル', death: 'デス', special: 'スペシャル', celebration: 'リザルト', personal: 'リザルト', board: 'リザルト', event: '見逃し・誤検出' };
  let stillUrl = null;
  const showEmpty = msg => { stillImg.style.display = 'none'; stillEmpty.textContent = msg; stillEmpty.style.display = 'flex'; };
  const showStill = (t, near = 15) => {
    if (video.src && video.style.display !== 'none') return;
    if (!stills.length) { stillCap.textContent = ''; showEmpty('静止画なし（この試合では静止画が保存されていません）'); return; }
    let best = stills[0];
    for (const s of stills) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    const d = Math.abs(best.t - t);
    if (d > near) { stillCap.textContent = `最も近い静止画は ${mss(best.t)}（対象から ±${d.toFixed(1)}秒）`; showEmpty(`静止画なし（${mss(t)} の近くには静止画がありません）`); return; }
    if (stillUrl) URL.revokeObjectURL(stillUrl);
    stillUrl = URL.createObjectURL(best.blob);
    stillImg.onerror = () => { stillCap.textContent = ''; showEmpty('静止画なし（静止画を表示できません）'); };
    stillImg.onload = () => { stillEmpty.style.display = 'none'; stillImg.style.display = 'block'; };
    stillImg.src = stillUrl;
    stillCap.textContent = `最も近い静止画 ${mss(best.t)}（対象から ±${d.toFixed(1)}秒） · ${KIND_JA[best.kind] || best.kind || '静止画'}${best.reason ? ' / ' + best.reason : ''}`;
  };

  const seek = t => {
    lastSeekTime = t;
    showStill(t);
    if (tlEl && tlEl.setPlayhead && !video.src) tlEl.setPlayhead(t);
    if (video.src) {
      video.currentTime = Math.max(0, t - offset - 2);
      video.play().catch(() => {});
    }
  };

  const drawTL = (opts = {}) => {
    tlEl = renderTimeline(m, {
      reviewMode,
      onSeek: seek,
      // ヤグラ保持ラベル / カウント点の変更: 保存して帯を描き直す（カウント追加・削除ではポップオーバーを開いたままにする）
      onReviewChange: async ({ reopen, focus }) => { await save(); drawTL({ reopen, focus }); },
    });
    $('#tl', page).replaceChildren(tlEl);
    if (opts.reopen) tlEl.openPopover(opts.reopen);
    else if (opts.focus) tlEl.focusSegment(opts.focus);
    if (video.src && video.currentTime > 0) {
      tlEl.setPlayhead(video.currentTime + offset);
    }
  };

  $('#vstat', page).textContent = '映像は保存されていません（手元の録画ファイルを選ぶと映像でも確認できます）';

  $('#vf', page).onchange = e => {
    const f = e.target.files[0];
    if (f) {
      video.src = URL.createObjectURL(f);
      video.style.display = 'block'; stillImg.style.display = 'none'; stillEmpty.style.display = 'none';
      offset = 0;
      $('#vstat', page).textContent = f.name;
    }
  };

  const accDraw = () => {
    const a = accuracy([m]);
    $('#acc', page).innerHTML = accTable(a);
  };

  const rtab = () => {
    const rs = m.result_screen || {}, own = rs.own || {};
    const det = {
      result: rs.result,
      mode: rs.mode,
      stage: rs.stage,
      deaths: own.deaths,
      specials: own.specials,
      count: (m.tower_series && m.tower_series.length) ? `${m.tower_series.at(-1).own}-${m.tower_series.at(-1).enemy}` : null
    };
    $('#rtab', page).innerHTML = `
      <thead><tr><th>項目</th><th>読み取り</th><th>確認</th><th>訂正</th></tr></thead>
      <tbody>
        ${Object.entries(RESULT_FIELDS).map(([k, lab]) => {
          const mk = m.review.rmarks[k];
          const valStr = det[k] === 'WIN' ? '勝ち' : det[k] === 'LOSE' ? '負け' : k === 'count' ? fmtCount(det[k]) : (det[k] ?? '読めず');
          return `<tr>
            <td>${esc(lab)}</td>
            <td class="num">${esc(valStr)}</td>
            <td>
              <button class="mk ${mk === 'ok' ? 'on-ok' : ''}" data-f="${k}" data-v="ok" type="button">✓</button>
              <button class="mk ${mk === 'wrong' ? 'on-wrong' : ''}" data-f="${k}" data-v="wrong" type="button">✗</button>
            </td>
            <td>
              ${mk === 'wrong' ? `<input class="input-sm" size="8" data-fix="${k}" value="${esc(m.review.fix[k] ?? '')}" placeholder="${k === 'result' ? 'WIN/LOSE' : '正しい値'}">` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>`;

    $('#rtab', page).querySelectorAll('.mk').forEach(b => {
      b.onclick = async () => {
        const f = b.dataset.f;
        m.review.rmarks[f] = m.review.rmarks[f] === b.dataset.v ? undefined : b.dataset.v;
        if (m.review.rmarks[f] !== 'wrong') delete m.review.fix[f];
        await save();
        rtab();
        accDraw();
      };
    });

    $('#rtab', page).querySelectorAll('input[data-fix]').forEach(i => {
      i.onchange = async () => {
        const f = i.dataset.fix;
        let v = i.value.trim();
        if (['deaths', 'specials'].includes(f)) v = v === '' ? undefined : +v;
        if (f === 'result') v = /^w|勝/i.test(v) ? 'WIN' : /^l|負/i.test(v) ? 'LOSE' : v;
        m.review.fix[f] = v;
        await save();
      };
    });
  };

  const etab = () => {
    const det = detected(m);
    const add = (m.review.added || []).map((a, i) => ({ ...a, addedIdx: i }));
    const effList = effective(m);
    const effMap = new Map(effList.map(e => [e.added ? 'a' + e.t + e.kind : e.key, e]));

    // Update header K/D/SP counts after review edits
    $('#hdr-k', page).textContent = effList.filter(e => e.kind === 'kill').length;
    $('#hdr-d', page).textContent = effList.filter(e => e.kind === 'death').length;
    $('#hdr-sp', page).textContent = effList.filter(e => e.kind === 'special').length;

    const allRows = [
      ...det.map(e => ({ ...e, isAdded: false })),
      ...add.map(a => ({ ...a, isAdded: true }))
    ].sort((a, b) => a.t - b.t);

    $('#etab', page).innerHTML = `
      <thead>
        <tr>
          <th>時刻</th>
          <th>種類</th>
          <th>局面</th>
          <th>カウント差</th>
          <th>勝率の変化</th>
          <th class="col-review-only">確認</th>
        </tr>
      </thead>
      <tbody>
        ${allRows.map(e => {
          const x = effMap.get(e.isAdded ? 'a' + e.t + e.kind : e.key) || e;
          const dInfo = fmtDelta(x.wp_delta);
          const rowClasses = ['click'];
          if (e.isAdded) rowClasses.push('added');
          else if (e.mark) rowClasses.push(e.mark);
          if (dInfo.big) rowClasses.push('row-big-swing');

          const kindIcon = e.kind === 'kill'
            ? '<b style="color:var(--kill)">★</b> '
            : e.kind === 'death'
              ? '<b style="color:var(--death)">×</b> '
              : '<b style="color:var(--special)">◆</b> ';
          const kindText = KINDS[e.kind] + (e.outcome ? `（${SP_LABEL[e.outcome]}）` : '') + (e.isAdded ? '（見逃し追加）' : '');

          const reviewCell = e.isAdded
            ? `<button class="mk rm" data-i="${e.addedIdx}" type="button">取り消す</button>`
            : ['ok', 'wrong', 'deleted'].map(v =>
                `<button class="mk ${e.mark === v ? 'on-' + v : ''}" data-key="${e.key}" data-v="${v}" data-t="${e.t}" type="button">${{ ok: '✓', wrong: '✗', deleted: '削除' }[v]}</button>`
              ).join('');

          return `<tr class="${rowClasses.join(' ')}" data-t="${e.t}">
            <td class="num">${mss(e.t - t0)}</td>
            <td>${kindIcon}${esc(kindText)}</td>
            <td>${phaseBadge(x.phase)}</td>
            <td class="num ${diffCls(x.count_diff)}">${fmtDiff(x.count_diff)}</td>
            <td>${deltaCellHtml(x.wp_delta)}</td>
            <td class="col-review-only">${reviewCell}</td>
          </tr>`;
        }).join('')}
      </tbody>
    `;

    $('#etab', page).querySelectorAll('tr.click').forEach(tr => {
      tr.onclick = ev => {
        if (ev.target.tagName !== 'BUTTON') seek(+tr.dataset.t);
      };
    });

    $('#etab', page).querySelectorAll('.mk[data-key]').forEach(b => {
      b.onclick = async e => {
        e.stopPropagation();
        const k = b.dataset.key;
        const v = m.review.marks[k] === b.dataset.v ? undefined : b.dataset.v;
        if (v) m.review.marks[k] = v;
        else delete m.review.marks[k];
        await save();
        refresh();
        if (v === 'wrong') {
          grabFrames(video, [-1, 0, 1].map(d => +b.dataset.t - offset + d), '誤検出の前後', m.id, { type: 'wrong', key: k });
        }
      };
    });

    $('#etab', page).querySelectorAll('.rm').forEach(b => {
      b.onclick = async e => {
        e.stopPropagation();
        m.review.added.splice(+b.dataset.i, 1);
        await save();
        refresh();
      };
    });
  };

  page.querySelectorAll('.add').forEach(b => {
    b.onclick = async () => {
      const baseT = video.src ? (video.currentTime + offset) : (video.currentTime > 0 ? video.currentTime + offset : lastSeekTime);
      const t = Math.round(baseT * 10) / 10;
      m.review.added.push({ kind: b.dataset.k, t });
      await save();
      refresh();
      if (video.src) {
        grabFrames(video, [-1.5, -0.5, 0.5].map(d => t - offset + d), '見逃しの前後', m.id, { type: 'missed', kind: b.dataset.k, t });
      }
    };
  });

  $('#fbone', page).onclick = () => {
    const s = exportStateOf(m);
    openDialogOnList = (s === 'accumulated' || s === 'changed') ? 'diff' : null;
    nav('list');
  };

  const refresh = () => {
    drawTL();
    etab();
    accDraw();
  };

  rtab();
  refresh();
  showStill(lastSeekTime, Infinity);

  if (pendingSeek !== null) {
    const t = pendingSeek;
    pendingSeek = null;
    seek(t);
  }
};

function accTable(a) {
  return `
    <table class="table">
      <thead>
        <tr><th>種類</th><th>正しい</th><th>誤検出</th><th>見逃し</th><th>未確認</th><th>適合率</th><th>再現率</th></tr>
      </thead>
      <tbody>
        ${Object.entries(KINDS).map(([k, lab]) => {
          const x = a.events[k];
          return `<tr>
            <td>${esc(lab)}</td>
            <td class="num">${x.tp}</td>
            <td class="num">${x.fp}</td>
            <td class="num">${x.fn}</td>
            <td class="num">${x.unreviewed}</td>
            <td class="num">${pct(x.precision)}</td>
            <td class="num">${pct(x.recall)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="review-section-title" style="margin-top:12px">リザルト画面</div>
    <table class="table">
      <thead>
        <tr><th>項目</th><th>正しい</th><th>間違い</th><th>正解率</th></tr>
      </thead>
      <tbody>
        ${Object.entries(RESULT_FIELDS).map(([k, lab]) => {
          const x = a.result[k] || { ok: 0, wrong: 0 };
          return `<tr>
            <td>${esc(lab)}</td>
            <td class="num">${x.ok}</td>
            <td class="num">${x.wrong}</td>
            <td class="num">${pct(x.ok + x.wrong ? x.ok / (x.ok + x.wrong) : null)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ============================================================================
// 4. 傾向分析
// ============================================================================
PAGES.trend = async () => {
  const ms = await db.allMatches();
  const page = document.createElement('div');
  if (!ms.length) {
    page.innerHTML = `
      <div class="page-header"><h1 class="page-title">傾向分析</h1></div>
      <div class="card">
        <div class="empty-state">
          <p>分析できる試合がまだありません。ライブ分析または試合一覧から試合を追加してください。</p>
          <button class="btn btn-primary" id="trend-empty-btn" type="button">試合一覧へ</button>
        </div>
      </div>`;
    app.replaceChildren(page);
    $('#trend-empty-btn', page).onclick = () => nav('list');
    return;
  }

  const R = ms.map((m, idx) => ({ m, idx, r: resultOf(m), ev: effective(m) }));
  const known = R.filter(x => x.r.result === 'WIN' || x.r.result === 'LOSE');
  const wins = known.filter(x => x.r.result === 'WIN').length;
  const losses = known.length - wins;
  const cnt = (x, k) => x.ev.filter(e => e.kind === k).length;
  const sum = k => R.reduce((s, x) => s + cnt(x, k), 0);

  const deaths = R.flatMap(x => x.ev.filter(e => e.kind === 'death').map(e => ({ ...e, x })));
  const kills = R.flatMap(x => x.ev.filter(e => e.kind === 'kill').map(e => ({ ...e, x })));

  // 2. Winrate progression SVG (height 220px): cumulative solid line + win/lose dots + rolling-10 dashed line
  const cwW = 1000, cwH = 220, padL = 44, padR = 24, padT = 20, padB = 32;
  const plotW = cwW - padL - padR, plotH = cwH - padT - padB;
  const Xm = i => R.length === 1 ? padL + plotW / 2 : padL + (i / (R.length - 1)) * plotW;
  const Yw = v => padT + plotH - Math.max(0, Math.min(1, v)) * plotH;

  let cumWins = 0, cumKnown = 0;
  const ptsData = R.map((x, i) => {
    const isWin = x.r.result === 'WIN';
    if (x.r.result === 'WIN' || x.r.result === 'LOSE') {
      cumKnown++;
      if (isWin) cumWins++;
    }
    const cumWp = cumKnown ? cumWins / cumKnown : 0.5;
    const winSlice = R.slice(Math.max(0, i - 9), i + 1).filter(z => z.r.result === 'WIN' || z.r.result === 'LOSE');
    const rollWp = winSlice.length ? winSlice.filter(z => z.r.result === 'WIN').length / winSlice.length : cumWp;
    return { x, i, cumWp, rollWp, isWin };
  });

  const cumLine = ptsData.map(p => `${Xm(p.i).toFixed(1)},${Yw(p.cumWp).toFixed(1)}`).join(' ');
  const showRoll = R.length >= 10;
  const rollLine = ptsData.map(p => `${Xm(p.i).toFixed(1)},${Yw(p.rollWp).toFixed(1)}`).join(' ');

  const winrateSvg = `
    <svg viewBox="0 0 ${cwW} ${cwH}" width="100%" height="220" style="display:block">
      <line x1="${padL}" x2="${cwW - padR}" y1="${Yw(1)}" y2="${Yw(1)}" stroke="var(--border)" stroke-opacity="0.5"/>
      <line x1="${padL}" x2="${cwW - padR}" y1="${Yw(0.5)}" y2="${Yw(0.5)}" stroke="var(--border-strong)" stroke-dasharray="4,4"/>
      <line x1="${padL}" x2="${cwW - padR}" y1="${Yw(0)}" y2="${Yw(0)}" stroke="var(--border)" stroke-opacity="0.5"/>
      <text x="${padL - 8}" y="${Yw(1) + 4}" text-anchor="end" class="num" font-size="11" fill="var(--text-muted)">100%</text>
      <text x="${padL - 8}" y="${Yw(0.5) + 4}" text-anchor="end" class="num" font-size="11" fill="var(--text-muted)">50%</text>
      <text x="${padL - 8}" y="${Yw(0) + 4}" text-anchor="end" class="num" font-size="11" fill="var(--text-muted)">0%</text>

      <polyline fill="none" stroke="var(--ally)" stroke-width="2.5" points="${cumLine}"/>
      ${showRoll ? `<polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6,4" points="${rollLine}"/>` : ''}

      ${ptsData.map(p => {
        const cx = Xm(p.i).toFixed(1), cy = Yw(p.cumWp).toFixed(1);
        const col = p.isWin ? 'var(--win)' : 'var(--lose)';
        const tip = `第${p.i + 1}試合: ${p.x.r.mode || ''} ${p.x.r.stage || ''}（${resJa(p.x.r.result)}） 累計勝率 ${Math.round(p.cumWp * 100)}%`;
        return `
          <g class="wp-dot" data-id="${esc(p.x.m.id)}" style="cursor:pointer">
            <title>${esc(tip)}</title>
            <circle cx="${cx}" cy="${cy}" r="6" fill="${col}" stroke="var(--surface)" stroke-width="2"/>
            <text x="${cx}" y="${cwH - 8}" text-anchor="middle" class="num" font-size="11" fill="var(--text-muted)">#${p.i + 1}</text>
          </g>`;
      }).join('')}
    </svg>
  `;

  // 3. Diverging bars: by phase & by count-diff (7 buckets)
  const kdText = (k, d) => (d === 0 ? '—' : (k / d).toFixed(2));
  const byPhase = ['抑え', '打開', '互角'].map(p => {
    const dList = deaths.filter(e => (e.phase || '互角') === p);
    const kList = kills.filter(e => (e.phase || '互角') === p);
    const loss = dList.reduce((s, e) => s + Math.min(0, e.wp_delta || 0), 0);
    return { p, d: dList.length, k: kList.length, kd: kdText(kList.length, dList.length), empty: !kList.length && !dList.length, loss };
  });
  const maxPhaseCnt = Math.max(1, ...byPhase.map(x => Math.max(x.d, x.k)));

  const sevenBuckets = BUCKETS.filter(b => b !== 'カウント不明');
  const byB = sevenBuckets.map(b => {
    const d = deaths.filter(e => countBucket(e.count_diff) === b).length;
    const k = kills.filter(e => countBucket(e.count_diff) === b).length;
    return { b, d, k, kd: kdText(k, d), empty: !k && !d };
  });
  const maxBucketCnt = Math.max(1, ...byB.map(x => Math.max(x.d, x.k)));

  // 4. Top 8 winrate-lowering deaths & winrate-raising kills
  const topDeaths = deaths.filter(e => e.wp_delta !== undefined).sort((a, b) => a.wp_delta - b.wp_delta).slice(0, 8);
  const topKills = kills.filter(e => e.wp_delta !== undefined && e.wp_delta >= 0.005).sort((a, b) => b.wp_delta - a.wp_delta).slice(0, 8);

  const swingRow = e => {
    const dInfo = fmtDelta(e.wp_delta);
    return `
      <tr class="click ${dInfo.big ? 'row-big-swing' : ''}" data-id="${esc(e.x.m.id)}" data-t="${e.t}">
        <td>
          <span class="${badgeCls(e.x.r.result)}">${resJa(e.x.r.result)}</span>
          <span style="margin-left:6px;font-size:12px">${esc(e.x.r.stage || '')}</span>
        </td>
        <td class="num">${mss(e.t - e.x.m.battle[0])}</td>
        <td>${phaseBadge(e.phase)}</td>
        <td class="num ${diffCls(e.count_diff)}">${fmtDiff(e.count_diff)}</td>
        <td>${deltaCellHtml(e.wp_delta)}</td>
      </tr>`;
  };

  // 5. Per-match kill/death/special small horizontal charts
  const smallChart = (kind, label, color) => {
    const vals = R.map(x => cnt(x, kind));
    const maxV = Math.max(1, ...vals);
    const avg = (vals.reduce((a, b) => a + b, 0) / R.length).toFixed(1);
    const sw = 280, sh = 110, bTop = 18, bBot = 86, bH = bBot - bTop;
    const slotW = (sw - 20) / R.length;
    const barW = Math.min(28, Math.max(10, slotW * 0.55));
    return `
      <div class="small-chart-box">
        <div class="small-chart-title">
          <span>${esc(label)}</span>
          <span class="num">平均 ${avg}</span>
        </div>
        <svg viewBox="0 0 ${sw} ${sh}" width="100%" height="110">
          <line x1="10" x2="${sw - 10}" y1="${bBot}" y2="${bBot}" stroke="var(--border-strong)"/>
          ${R.map((x, i) => {
            const v = vals[i];
            const h = (v / maxV) * (bH - 6);
            const bx = 10 + i * slotW + (slotW - barW) / 2;
            const by = bBot - h;
            return `
              <g class="click-match" data-id="${esc(x.m.id)}" style="cursor:pointer">
                <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="3" fill="${color}"/>
                <text x="${(bx + barW / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" class="num" font-size="11" font-weight="700" fill="var(--text)">${v}</text>
                <text x="${(bx + barW / 2).toFixed(1)}" y="${bBot + 15}" text-anchor="middle" class="num" font-size="10" fill="${x.r.result === 'WIN' ? 'var(--win)' : 'var(--lose)'}">#${i + 1}</text>
              </g>`;
          }).join('')}
        </svg>
      </div>`;
  };

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">傾向分析 <span class="num muted">（${ms.length}試合）</span></h1>
    </div>

    <div class="trends-stat-band">
      <div class="stat">
        <div class="stat-label">勝率</div>
        <div style="display:flex;align-items:baseline;margin-top:2px">
          <span class="stat-value-2xl num">${pct(known.length ? wins / known.length : null)}</span>
          <span class="stat-sub num">${wins}勝${losses}敗</span>
        </div>
      </div>
      <div class="stat">
        <div class="stat-label">1試合あたりのキル</div>
        <div class="stat-value num">${(sum('kill') / ms.length).toFixed(1)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">1試合あたりのデス</div>
        <div class="stat-value num">${(sum('death') / ms.length).toFixed(1)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">1試合あたりのスペシャル</div>
        <div class="stat-value num">${(sum('special') / ms.length).toFixed(1)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">キル÷デス</div>
        <div class="stat-value num">${(sum('kill') / Math.max(1, sum('death'))).toFixed(2)}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--sp-6)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-2)">
        <div class="card-title" style="margin-bottom:0">勝率の推移</div>
        <div class="tl-legend" style="margin:0;padding:0;border:0">
          <span><i class="tl-swatch" style="background:var(--ally)"></i>累計勝率</span>
          ${showRoll ? '<span><i class="tl-swatch" style="background:var(--accent)"></i>直近10試合（破線）</span>' : ''}
          <span><i class="tl-swatch" style="background:var(--win);border-radius:50%"></i>勝ち</span>
          <span><i class="tl-swatch" style="background:var(--lose);border-radius:50%"></i>負け</span>
        </div>
      </div>
      <div class="winrate-chart-wrap">${winrateSvg}</div>
    </div>

    <div class="trends-two-col">
      <div class="card">
        <div class="card-title">状況別のキルとデス — 局面別</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);padding-bottom:6px;border-bottom:1px solid var(--border)">
          <span>局面</span>
          <span>← デス（グレー） ｜ キル（緑） →</span>
          <span>キル÷デス · 失った勝率</span>
        </div>
        ${byPhase.map(x => {
          const dw = Math.round((x.d / maxPhaseCnt) * 100);
          const kw = Math.round((x.k / maxPhaseCnt) * 100);
          const lossFmt = fmtDelta(x.loss);
          return `
            <div class="div-row ${x.empty ? 'div-row-empty' : ''}">
              <div>${phaseBadge(x.p)}</div>
              <div class="div-DualBar">
                <div class="div-side-left">
                  <span class="num muted">${x.d}</span>
                  <div class="div-bar-death" style="width:${dw}%"></div>
                </div>
                <div class="div-center-axis"></div>
                <div class="div-side-right">
                  <div class="div-bar-kill" style="width:${kw}%"></div>
                  <span class="num" style="color:var(--kill);font-weight:700">${x.k}</span>
                </div>
              </div>
              <div class="div-meta">
                <span class="num">${x.kd}</span>
                <span class="num ${lossFmt.cls}">${lossFmt.text}</span>
              </div>
            </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-title">状況別のキルとデス — カウント差別</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);padding-bottom:6px;border-bottom:1px solid var(--border)">
          <span>カウント差</span>
          <span>← デス ｜ キル →</span>
          <span>キル÷デス</span>
        </div>
        ${byB.map(x => {
          const dw = Math.round((x.d / maxBucketCnt) * 100);
          const kw = Math.round((x.k / maxBucketCnt) * 100);
          return `
            <div class="div-row ${x.empty ? 'div-row-empty' : ''}">
              <div style="font-size:12px;color:var(--text-muted)">${esc(x.b)}</div>
              <div class="div-DualBar">
                <div class="div-side-left">
                  <span class="num muted">${x.d}</span>
                  <div class="div-bar-death" style="width:${dw}%"></div>
                </div>
                <div class="div-center-axis"></div>
                <div class="div-side-right">
                  <div class="div-bar-kill" style="width:${kw}%"></div>
                  <span class="num" style="color:var(--kill);font-weight:700">${x.k}</span>
                </div>
              </div>
              <div class="div-meta" style="min-width:132px">
                <span class="num">${x.kd}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <div class="trends-two-col">
      <div class="card">
        <div class="card-title">勝率を大きく下げたデス（上位8件）</div>
        <table class="table">
          <thead><tr><th>試合</th><th>時刻</th><th>局面</th><th>カウント差</th><th>変化</th></tr></thead>
          <tbody>${topDeaths.map(swingRow).join('')}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">勝率を大きく上げたキル（上位8件）</div>
        <table class="table">
          <thead><tr><th>試合</th><th>時刻</th><th>局面</th><th>カウント差</th><th>変化</th></tr></thead>
          <tbody>${topKills.map(swingRow).join('')}</tbody>
        </table>
        ${topKills.length ? '' : '<div class="empty-state"><p>大きく勝率を上げたキルはまだありません</p></div>'}
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-title">試合ごとのキル・デス・スペシャル</div>
      <div class="small-charts-grid">
        ${smallChart('kill', 'キル', 'var(--kill)')}
        ${smallChart('death', 'デス', 'var(--special-wasted)')}
        ${smallChart('special', 'スペシャル', 'var(--special)')}
      </div>
    </div>

    <details class="card collapsible-card">
      <summary>検出の精度（確認画面での訂正から集計） <span>▸</span></summary>
      ${accTable(accuracy(ms))}
    </details>
  `;

  app.replaceChildren(page);

  page.querySelectorAll('.wp-dot, .click-match').forEach(el => {
    el.addEventListener('click', () => nav('match', el.dataset.id));
  });

  page.querySelectorAll('tr.click[data-id]').forEach(tr => {
    tr.onclick = () => nav('match', tr.dataset.id, tr.dataset.t ? +tr.dataset.t : null);
  });
};

const [p0, id0] = location.hash.slice(1).split('/');
if (id0) currentId = decodeURIComponent(id0);
nav(PAGES[p0] ? p0 : 'live');
