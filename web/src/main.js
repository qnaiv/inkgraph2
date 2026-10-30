import * as db from './db.js';
import { Session, listDevices } from './session.js';
import { renderTimeline, LEGEND } from './timeline.js';
import { assistEstimate, assistText, ASSIST_NOTE, detected, effective, resultOf, accuracy, KINDS, RESULT_FIELDS, SP_LABEL, countBucket, BUCKETS, mss, pct, resultStatus, resultSourceLabel, frameStepForState, specialIntervals, specialStats, isVerificationMatch, ownMatches, MATCH_TYPE_LABEL, POWER_STATUS_LABEL, MATCH_TYPE_OPTIONS, RULE_OPTIONS, parseTrendFilter, trendFilterToQuery, filterTrendMatches, sampleTier, powerBreakdown, stageRuleRows, sortStageRows, candidateShortage, enemyWeaponRows, enemyPresenceRows, unknownIconGroups } from './analysis.js';
import { b64bytes } from './core/img.js';
import { prepEnemyIconLib, nearestNames } from './core/board_icons.js';
import * as AN from './analysis.js';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import * as VR from './video_rec.js';
import * as FP from './fix_pack.js';
import { compareCounts, mismatchText } from './count_check.js';
import { extractFrames } from './rec_frames.js';
import * as FB from './feedback.js';
import * as BK from './backup.js';
import * as CP from './capacity.js';
import { EXPORT_STATE_LABEL, exportStateOf, syncExportState, confirmedCount } from './feedback.js';
import { getCapBytes, formatCapacityLabel, TARGET_RATIO, MANUAL_TARGET_RATIO, planCapacityCleanup } from './capacity.js';
import { CLIP, CLIP_KIND_JA, clipAt } from './clips.js';
import { recountDiff } from './core/live_counts.js';
import * as Cloud from './cloud/index.js';
import * as WL from './weapon_lib.js';
import * as StageLib from './stage_lib.js';
import { STAGES } from './stage_lib.js';
import { WEAPON_TYPES, UNCLASSIFIED, typeOfWeapon, weaponOptions } from './core/weapons.js';

const app = document.getElementById('app');
const liveSlot = document.createElement('div');
liveSlot.id = 'slot-live';
const normalSlot = document.createElement('div');
normalSlot.id = 'slot-normal';
app.append(normalSlot, liveSlot);

let pageCleanup = null;

function mountPage(el, isLive = false) {
  if (pageCleanup) {
    try { pageCleanup(); } catch (e) {}
    pageCleanup = null;
  }
  if (isLive) {
    if (el && liveSlot.firstElementChild !== el) {
      if (!(session && session.running && session.page && liveSlot.contains(session.page))) {
        liveSlot.replaceChildren(el);
      }
    }
    liveSlot.style.display = '';
    normalSlot.style.display = 'none';
  } else {
    liveSlot.style.display = 'none';
    normalSlot.style.display = '';
    if (el) {
      normalSlot.replaceChildren(el);
    }
  }
}

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let session = null;
let currentId = null;
let pendingSeek = null;
let reviewMode = false;
let openDialogOnList = null; // 詳細画面から一覧へ遷移したとき自動で開くダイアログのモード
let lastTrendQuery = '';
let trendStageSort = { key: 'n', dir: 'desc' };
let enemyIconLibPromise = null;
function getEnemyIconLib() {
  if (!enemyIconLibPromise) enemyIconLibPromise = (async () => {
    try {
      const res = await fetch(new URL('assets/inkgraph_assets.json', document.baseURI).href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      weaponNames = [...new Set([...(j.enemy_icon && j.enemy_icon.lib || []).map(e => e.name), ...((j.killer && j.killer.lib) || []).filter(e => e.kind === 'main').map(e => e.name)])].filter(Boolean);
      return prepEnemyIconLib(j.enemy_icon, b64bytes);
    } catch (e) {
      return { lib: [] };
    }
  })();
  return enemyIconLibPromise;
}
let weaponNames = [];
async function getWeaponNames() { await getEnemyIconLib(); return weaponNames; }
// 傾向画面の描画を見本の読み込みで待たせないよう、起動時に先読みする
getEnemyIconLib();

window.inkgraph = {
  db,
  VR,
  Session,
  analysis: AN,
  capacity: CP,
  feedback: FB,
  backup: BK,
  AN,
  recountDiff,
  buildBatchZip: (...a) => buildBatchZip(...a),
  buildFixPack: (...a) => buildFixPack(...a),
  exportFixPack: (...a) => exportFixPack(...a),
  showFixExportDialog: () => showFixExportDialog(),
  buildBackupZip: (...a) => buildBackupZip(...a),
  showFeedbackExportDialog: (...a) => showFeedbackExportDialog(...a),
  showCapacityCleanupDialog: (...a) => showCapacityCleanupDialog(...a),
  setReviewMode: v => { reviewMode = !!v; if (currentPage === 'match') PAGES.match(); },
  getSession: () => session,
  nav: (...a) => nav(...a)
};

let currentPage = 'live';
const isNarrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 820px)').matches;

function parseHash(hashStr) {
  const raw = (hashStr || '').replace(/^#/, '');
  const [pathPart, ...rest] = raw.split('/');
  const qIdx = pathPart.indexOf('?');
  const page = qIdx >= 0 ? pathPart.slice(0, qIdx) : pathPart;
  const query = qIdx >= 0 ? pathPart.slice(qIdx + 1) : '';
  const id = rest.length ? rest.join('/') : null;
  return { page, query, id };
}

function updateNavActive(page) {
  document.querySelectorAll('.sidenav a[data-page], nav [data-page]').forEach(a => {
    const active = a.dataset.page === page;
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.classList.toggle('on', active);
  });
}

function nav(page, arg, seekTo = null) {
  let query = '';
  if (page.includes('?')) {
    const parts = page.split('?');
    page = parts[0];
    query = parts[1];
  }
  if (!PAGES[page]) page = 'live';
  if (page === 'live' && isNarrow()) page = 'list'; // D58: スマホなど狭い画面ではライブ分析を使わない
  if (currentPage === 'match' && page !== 'match') reviewMode = false; // D86: 試合の詳細は、開くたびに普通モード（レビューモードは自分で入る）
  currentPage = page;
  if (arg) currentId = arg;
  pendingSeek = seekTo;
  updateNavActive(page);

  let nextHash = page + (currentId && page === 'match' ? '/' + encodeURIComponent(currentId) : '');
  if (page === 'trend') {
    if (query) {
      lastTrendQuery = query;
    }
    if (lastTrendQuery) {
      nextHash = 'trend?' + lastTrendQuery;
    }
  }

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
  const { page: p, query: q, id } = parseHash(location.hash);
  if (id) currentId = decodeURIComponent(id);
  if (p === 'trend' && q) {
    lastTrendQuery = q;
  }
  if (PAGES[p]) {
    const q2 = p === 'live' && isNarrow() ? 'list' : p;
    if (q2 !== p) history.replaceState(null, '', '#list');
    currentPage = q2;
    updateNavActive(q2);
    PAGES[q2]();
  }
});

window.addEventListener('beforeunload', () => {
  if (pageCleanup) {
    try { pageCleanup(); } catch (e) {}
    pageCleanup = null;
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
  if (!summary) return '';
  const isFavOnly = (summary.favBytes > summary.capBytes);
  if (!isFavOnly && summary.level === 'ok') return '';

  if (isFavOnly) {
    return `
      <div class="capacity-banner capacity-banner--favonly">
        <div class="capacity-banner-text">
          <span class="capacity-banner-icon">⚠</span>
          <span>お気に入りの試合だけで容量がいっぱいです。試合一覧でお気に入りを外すか、手動で静止画を消してください</span>
        </div>
      </div>
    `;
  }

  const label = formatCapacityLabel(summary);
  return `
    <div class="capacity-banner">
      <div class="capacity-banner-text">
        <span class="capacity-banner-icon">⚠</span>
        <span>静止画の容量：${esc(label)}</span>
      </div>
      <button class="btn capacity-cleanup-btn" type="button">古い試合の静止画を整理する</button>
    </div>
  `;
}

async function showCapacityCleanupDialog() {
  document.querySelector('.capacity-dialog-overlay')?.remove();
  const cap = getCapBytes();
  const usage = await db.stillsUsage(cap);
  const plan = planCapacityCleanup(usage.matches, cap, MANUAL_TARGET_RATIO, { force: true });
  const targetCount = plan.removedIds.length;

  const overlay = document.createElement('div');
  overlay.className = 'capacity-dialog-overlay';
  document.body.appendChild(overlay);

  let isResult = false;
  const close = () => {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    if (isResult) {
      nav(currentPage);
    }
  };
  const onKey = e => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  overlay.innerHTML = `
    <div class="capacity-dialog" role="dialog" aria-modal="true" aria-label="古い試合の静止画を整理">
      <h2 class="capacity-dialog-title">古い試合の静止画を整理</h2>
      <div class="capacity-dialog-target">対象：古い順の${targetCount}試合（お気に入りを除く）</div>
      <div class="capacity-dialog-notes">
        <p>消えるのは静止画だけで、試合の記録と正解データは残ります。</p>
        <p class="capacity-dialog-warn-text">消した静止画は戻せないため、手元に残したい場合は、先にバックアップまたは正解データを書き出してください。</p>
      </div>
      <div class="capacity-dialog-shortcuts">
        <button type="button" class="btn capacity-dialog-backup">バックアップを書き出す</button>
        <button type="button" class="btn capacity-dialog-feedback">正解データを書き出す</button>
      </div>
      <div class="capacity-dialog-actions">
        <button type="button" class="btn capacity-dialog-cancel">キャンセル</button>
        <button type="button" class="btn capacity-dialog-execute">静止画だけを消す（記録は残ります）</button>
      </div>
    </div>
  `;

  const cancelBtn = overlay.querySelector('.capacity-dialog-cancel');
  if (cancelBtn) cancelBtn.onclick = close;

  const backupBtn = overlay.querySelector('.capacity-dialog-backup');
  if (backupBtn) {
    backupBtn.onclick = async () => {
      try {
        backupBtn.disabled = true;
        const { blob, filename } = await buildBackupZip();
        download(filename, blob);
      } catch (err) {
        alert('バックアップの書き出しに失敗しました: ' + (err?.message || err));
      } finally {
        backupBtn.disabled = false;
      }
    };
  }

  const feedbackBtn = overlay.querySelector('.capacity-dialog-feedback');
  if (feedbackBtn) {
    feedbackBtn.onclick = () => {
      close();
      showFeedbackExportDialog('diff');
    };
  }

  const executeBtn = overlay.querySelector('.capacity-dialog-execute');
  if (executeBtn) {
    executeBtn.onclick = async () => {
      executeBtn.disabled = true;
      try {
        const res = await db.enforceCapacity(getCapBytes(), MANUAL_TARGET_RATIO, { force: true });
        isResult = true;
        const pct = res.summaryAfter?.pct ?? 0;
        const n = res.removed.length;
        const dialog = overlay.querySelector('.capacity-dialog');
        dialog.innerHTML = `
          <h2 class="capacity-dialog-title">整理完了</h2>
          <div class="capacity-cleanup-result">
            ${n}試合分の静止画を消しました。使用量は${pct}%です
          </div>
          <div class="capacity-dialog-actions">
            <button type="button" class="btn capacity-dialog-close-result">閉じる</button>
          </div>
        `;
        const closeResultBtn = dialog.querySelector('.capacity-dialog-close-result');
        if (closeResultBtn) {
          closeResultBtn.onclick = close;
        }
      } catch (e) {
        console.warn('enforceCapacity failed', e);
        executeBtn.disabled = false;
      }
    };
  }
}

function wireCapacityBanner(page, summary) {
  const btn = $('.capacity-cleanup-btn', page);
  if (btn) {
    btn.onclick = () => showCapacityCleanupDialog();
  }
}

const PAGES = {};

// ============================================================================
// 1. ライブ分析
// ============================================================================
PAGES.live = async () => {
  if (session && session.running && session.page) {
    mountPage(session.page, true);
    if (typeof session.resume === 'function') {
      try {
        const p = session.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {}
    }
    return;
  }
  const savedMatches = await db.allMatches();
  const capUsage = await db.stillsUsage(getCapBytes());
  const capLabel = formatCapacityLabel(capUsage);
  const isBlocked = capUsage.level === 'block';
  const showBanner = capUsage.level !== 'ok' || (capUsage.favBytes > capUsage.capBytes);
  const page = document.createElement('div');
  page.innerHTML = `
    ${renderCapacityBanner(capUsage)}
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h1 class="page-title">ライブ分析</h1>
        ${!showBanner ? `<span class="capacity-status muted">${esc(capLabel)}</span>` : ''}
      </div>
    </div>

    <div class="card live-source-card">
      <div class="live-source-controls">
        <div id="device-controls" style="display:flex;align-items:center;gap:8px;flex:1">
          <select id="dev" class="input" style="min-width:220px"><option value="">（機器を読み込み中…）</option></select>
          <button class="btn" id="reload" type="button">再検出</button>
        </div>
      </div>
      <p class="muted" id="still-note" style="margin:6px 0 0">映像は保存しません。確認用に、リザルトやキル・デス・スペシャル発動などの要所の静止画だけを保存します。</p>

      <div class="live-source-actions">
        <button class="btn btn-primary" id="start" type="button" ${isBlocked ? 'disabled' : ''}>解析を開始</button>
        <button class="btn btn-stop" id="stop" type="button" disabled style="display:none">停止</button>
      </div>
      ${isBlocked ? `<div class="capacity-block-reason">⚠ 使用量${capUsage.pct}%で、解析を始められる上限（95%）を超えています。古い試合の静止画を消すと始められます</div>` : ''}
    </div>

    <details class="card live-video-settings" id="live-video-settings">
      <summary style="cursor:pointer;font-weight:var(--fw-bold)">録画の設定 <span class="muted" id="live-video-summary" style="font-weight:normal;font-size:var(--fs-xs)"></span></summary>
      <div id="live-video-panel" style="margin-top:var(--sp-3)"></div>
    </details>

    <div class="live-grid">
      <div class="card video-card">
        <div class="video-status-overlay">
          <span id="live-dot" class="status-dot-idle"></span>
          <span id="state">待機中（映像を選択して開始）</span>
        </div>
        <div class="video-empty-state" id="video-empty">
          <p>キャプチャーボードを接続して、解析を開始してください</p>
        </div>
        <video id="v" playsinline muted></video>
      </div>

      <div class="card live-match-card">
        <div class="live-match-header">
          <div class="card-title" style="margin-bottom:0">この試合</div>
          <span id="live-count-badge" class="live-count-badge is-provisional" title="試合中の数字は速報です。試合後に映像全体を数え直して確定します">速報</span>
        </div>
        <div id="live-result" class="live-result" hidden style="margin:var(--sp-2) 0;padding:var(--sp-3);border-radius:8px;background:var(--surface-2,rgba(255,255,255,.05))">
          <div id="live-result-main" style="font-size:var(--fs-lg,18px);font-weight:var(--fw-bold)"></div>
          <div id="live-result-sub" class="muted" style="font-size:var(--fs-xs);margin-top:2px"></div>
        </div>
        <div id="live-flag" class="live-flag" style="margin:var(--sp-2) 0">
          <button class="btn btn-sm" id="live-flag-btn" type="button" disabled>⚑ この試合を要修正にする</button>
          <span id="live-flag-note" class="muted" style="font-size:var(--fs-xs);margin-left:6px">分析結果が間違っていたら押しておくと、あとで一覧から見つけて、レビューモードで直せます</span>
          <div id="live-flag-reasons" style="display:none;flex-wrap:wrap;gap:6px;margin-top:6px">${Object.entries(FP.FIX_REASONS).map(([k, lab]) => `<button class="chip" type="button" data-reason="${k}">${lab}</button>`).join('')}<span class="muted" style="font-size:var(--fs-xs);align-self:center">どこが間違い？（任意）</span></div>
        </div>
        <div id="live-compare" class="live-compare" hidden style="margin:var(--sp-2) 0;padding:var(--sp-2) var(--sp-3);border-radius:8px;background:var(--surface-2,rgba(255,255,255,.05));font-size:var(--fs-xs)"></div>
        <div id="live-recount-note" class="live-recount-note" hidden></div>
        ${window.inkgraphDesktop ? '' : '<div id="live-browser-note" class="muted" style="font-size:var(--fs-xs);margin:var(--sp-2) 0">ブラウザ版: 解析中は、このウィンドウを<strong>隠さないで</strong>ください（最小化・別のタブへの切り替え・他のウィンドウで完全に覆うと、その試合は保存されません）。録画はデスクトップ版（Windows）のみ対応です。</div>'}

        <div id="live-capture-warn" class="live-capture-warn" role="status" hidden>
          <div style="font-weight:var(--fw-bold)">この試合は保存しません</div>
          <div id="live-capture-warn-reason"></div>
          <div style="color:var(--text-muted);margin-top:2px">次の試合からは通常どおり記録します。記録中はこの画面を表に出したままにしてください。</div>
        </div>

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
            <div class="stat-label">スペシャル発動</div>
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
        </div>

        <div>
          <div id="live-sp-ready" hidden style="background:var(--special-soft);color:var(--text);border:1px solid var(--special);border-radius:var(--r-md);padding:var(--sp-2) var(--sp-3);font-weight:var(--fw-bold);font-size:var(--fs-sm);text-align:center;margin-bottom:var(--sp-3)">スペシャル使用可能</div>
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
  mountPage(page, true);
  wireCapacityBanner(page, capUsage);
  renderVideoSettings($('#live-video-panel', page)).then(() => { const sm = $('#live-video-summary', page); if (sm) sm.textContent = window.inkgraphDesktop ? (VR.getVideoOn() ? '（オン）' : '（オフ）') : '（デスクトップ版のみ）'; }).catch(() => {});

  $('#to-list', page).onclick = e => { e.preventDefault(); nav('list'); };

  const syncStartDisabled = () => {
    if (session && session.running) return;
    $('#start', page).disabled = isBlocked;
  };

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
    if (!$('#live-wp', page)) return; // D81: 勝率の目安は出さない
    wpHistory.push(wpPct);
    if (wpHistory.length > 24) wpHistory.shift();
    if (!$('#live-wp', page)) return;
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
      alert(`使用量${curUsage.pct}%で、解析を始められる上限（95%）を超えています。古い試合の静止画を消すと始められます`);
      return;
    }
    let k = 0, d = 0, sp = 0, t0 = 0, estWp = 0.5, justSaved = false;
    $('#k', page).textContent = '0';
    $('#d', page).textContent = '0';
    $('#sp', page).textContent = '0';
    $('#live-capture-warn', page) && ($('#live-capture-warn', page).hidden = true);
    $('.live-stats-row', page)?.classList.remove('is-void');
    // D49: ライブの数字の状態（速報／確定／保存なし）と、数え直しの注記
    const COUNT_BADGE = { provisional: ['速報', '試合中の数字は速報です。試合後に映像全体を数え直して確定します'], final: ['確定', ''], discarded: ['保存なし', ''] };
    const setCountBadge = (state, note = '') => {
      const b = $('#live-count-badge', page);
      if (b) { b.textContent = COUNT_BADGE[state][0]; b.className = `live-count-badge is-${state}`; b.title = COUNT_BADGE[state][1]; }
      const n = $('#live-recount-note', page);
      if (n) { n.textContent = note; n.hidden = !note; }
    };
    setCountBadge('provisional');
    // D74: 試合終了の識別（結果画面を読めた分）をライブ画面に出す。勝敗・ルール・ステージ・マッチ種別・成績
    let resultLogged = false, battleActive = false; // 次のバトルが始まっていたら、前の試合の確定値でボックスを上書きしない
    const RES_JA = { WIN: '勝ち', LOSE: '負け' };
    const showResult = (info, final) => {
      const box = $('#live-result', page); if (!box) return;
      const own = info.own, ownTxt = own && Number.isInteger(own.ka) ? `K+A ${own.ka} / デス ${own.deaths ?? '?'} / SP ${own.specials ?? '?'}` : '';
      const head = [RES_JA[info.result] || (info.result ? info.result : '結果を読み取り中…'), info.mode || (info.stage || final ? 'ルール不明' : ''), info.stage].filter(Boolean).join(' · ');
      const sub = [MATCH_TYPE_LABEL[info.match_type] || '', ownTxt, final ? '確定' : '暫定（結果画面の読み取り中）'].filter(Boolean).join(' · ');
      box.hidden = false; $('#live-result-main', page).textContent = head; $('#live-result-sub', page).textContent = sub;
      box.style.borderLeft = `4px solid ${info.result === 'WIN' ? 'var(--kill, #4ade80)' : info.result === 'LOSE' ? 'var(--death, #f87171)' : 'var(--border, #555)'}`;
      if (!resultLogged && info.result && (info.mode || final) && info.stage && (info.own || final)) { resultLogged = true; addEventRow('', '🏁', `結果: ${head}${ownTxt ? '（' + ownTxt + '）' : ''}`, null); }
    };
    // D77: 検出した数と、結果画面（公式アプリの表示）の数の突き合わせ。補正はしない。合わなければ ⚠（保存時に自動で要修正の印が付く）
    const showCompare = (det, own, final) => {
      const box = $('#live-compare', page); if (!box) return;
      if (!own || ![own.deaths, own.specials, own.ka].some(Number.isInteger)) { box.hidden = true; return; }
      const mm = compareCounts(det, own), bad = key => mm.includes(key), mark = key => bad(key) ? ' ⚠' : ' ✓';
      box.hidden = false;
      box.innerHTML = `<div style="margin-bottom:2px"><strong>検出 と リザルト画面の突き合わせ</strong> <span class="muted">${final ? '確定' : '暫定'}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--sp-3)"><span class="${bad('kill') ? 'mismatch-val' : ''}">キル 検出 ${det.kills} / K+A ${own.ka ?? '?'}${mark('kill')}</span><span class="${bad('death') ? 'mismatch-val' : ''}">デス 検出 ${det.deaths} / ${own.deaths ?? '?'}${mark('death')}</span><span class="${bad('special') ? 'mismatch-val' : ''}">スペシャル 検出 ${det.specials} / ${own.specials ?? '?'}${mark('special')}</span></div>
        <div class="muted" style="margin-top:2px">${mm.length ? '合わない数があります。' + (final ? '自動で「要修正」にしました（外すときは下のボタン）。' : '試合が保存されたとき、自動で「要修正」の印が付きます。') : 'すべて一致しています。'}キルは K+A（アシスト込み）を超えたときだけ不一致です。</div>`;
    };
    // D75: 要修正マーク。試合の保存は次のバトル開始まで待つので、保存前に押した印は覚えておき、保存されたときに付ける
    let battleSeq = 0, curOrd = 0; let pendingOrd = []; const flags = new Map(), savedIds = new Map();
    const flagBtn = $('#live-flag-btn', page), flagReasons = $('#live-flag-reasons', page), flagNote = $('#live-flag-note', page);
    const flagUI = () => {
      const f = flags.get(curOrd);
      flagBtn.disabled = !curOrd; flagBtn.textContent = f ? '⚑ 要修正にしました（取り消す）' : '⚑ この試合を要修正にする';
      flagReasons.style.display = f ? 'flex' : 'none';
      flagReasons.querySelectorAll('[data-reason]').forEach(b => b.classList.toggle('active', !!f && f.has(b.dataset.reason)));
      if (curOrd) flagNote.textContent = f ? (savedIds.has(curOrd) ? '一覧に「⚑ 要修正」と出ます' : '試合が保存されたときに付きます（次のバトル開始か停止のとき）') : `対象: 今回の ${curOrd} 試合目`;
    };
    const applyFlag = async ord => {
      const id = savedIds.get(ord); if (!id) return;
      const m = await db.getMatch(id); if (!m) return;
      const f = flags.get(ord); FP.flagMatch(m, !!f, f ? [...f] : []); await db.putMatch(m);
    };
    flagBtn.onclick = async () => { if (!curOrd) return; if (flags.has(curOrd)) flags.delete(curOrd); else flags.set(curOrd, new Set()); flagUI(); await applyFlag(curOrd); };
    flagReasons.querySelectorAll('[data-reason]').forEach(b => { b.onclick = async () => { const f = flags.get(curOrd); if (!f) return; f.has(b.dataset.reason) ? f.delete(b.dataset.reason) : f.add(b.dataset.reason); flagUI(); await applyFlag(curOrd); }; });
    flagUI();
    const vEmpty = $('#video-empty', page);
    if (vEmpty) vEmpty.style.display = 'none';
    session = new Session($('#v', page), {
      videoSaved: r => { try { addEventRow('', '🎬', `録画を保存: ${r.filename}（${r.where === 'folder' ? 'フォルダ「' + r.folder + '」' : 'ダウンロード' + (r.why ? '・理由: ' + r.why : '')}・${fmtBytes(r.bytes)}）`, null); } catch { /* ignore */ } },
      videoStatus: r => { try { addEventRow('', r.level === 'error' ? '⚠' : '🎬', r.msg, null); } catch { /* ignore */ } },
      event: e => {
        if (e.type === 'special_end') return;
        if (e.type === 'result_info') { showResult(e, false); showCompare({ kills: k, deaths: d, specials: sp }, e.own, false); return; }
        if (e.type === 'battle_discard') { pendingOrd = pendingOrd.filter(o => o !== curOrd); flags.delete(curOrd); curOrd = pendingOrd.length ? pendingOrd[pendingOrd.length - 1] : 0; flagUI(); }
        const tt = mss(e.t - t0);
        if (e.type === 'battle_start') {
          t0 = e.t; k = d = sp = 0; estWp = 0.5; resultLogged = false; battleActive = true; { const cb = $('#live-compare', page); if (cb) cb.hidden = true; } curOrd = ++battleSeq; pendingOrd.push(curOrd); flagUI(); { const rb = $('#live-result', page); if (rb) rb.hidden = true; }
          const warn = $('#live-capture-warn', page); if (warn) warn.hidden = true;
          $('.live-stats-row', page)?.classList.remove('is-void');
          const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = true;
          setCountBadge('provisional');
          updateSpark(50);
          addEventRow('0:00', '▶', 'バトル開始', null);
        } else if (e.type === 'battle_end') {
          const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = true;
          battleActive = false;
          addEventRow(tt, '■', 'バトル終了', null);
        } else if (e.type === 'special_ready') {
          const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = false;
        } else if (e.type === 'own_kill') {
          k++;
          const delta = 0.08;
          estWp = Math.min(0.95, estWp + delta);
          updateSpark(estWp * 100);
          addEventRow(tt, '<b style="color:var(--kill)">★</b>', 'キル', delta);
        } else if (e.type === 'own_death') {
          d++;
          const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = true;
          const delta = -0.10;
          estWp = Math.max(0.05, estWp + delta);
          updateSpark(estWp * 100);
          addEventRow(tt, '<b style="color:var(--death)">×</b>', 'デス', delta);
        } else if (e.type === 'special') {
          sp++;
          const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = true;
          addEventRow(tt, '<b style="color:var(--special)">◆</b>', 'スペシャル発動', 0);
        } else if (e.type === 'special_lost') {
          const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = true;
          addEventRow(tt, '<b style="color:var(--special)">◇</b>', 'スペシャルを使う前にやられた', null);
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
        st.textContent = `解析中 · 経過 ${mss(session ? session.now() : 0)}`;
      },
      interrupted: info => {
        const warn = $('#live-capture-warn', page);
        const rEl = $('#live-capture-warn-reason', page);
        if (rEl) {
          if (info.reason === 'hidden') {
            rEl.textContent = '記録中にウィンドウやタブが裏に回り、映像の取り込みが止まったためです。';
          } else {
            const n = Math.round(info.gapSec || 0);
            rEl.textContent = `映像の取り込みが約${n}秒止まったためです。`;
          }
        }
        if (warn) warn.hidden = false;
        $('.live-stats-row', page)?.classList.add('is-void');
        const tt = mss(Math.max(0, (session ? session.now() : 0) - t0));
        const label = info.reason === 'hidden'
          ? '裏に回ったため、この試合は保存しません'
          : '取り込みが止まったため、この試合は保存しません';
        addEventRow(tt, '⚠', label, null);
      },
      discarded: ({ rec, interrupted }) => {
        { const ord = pendingOrd.shift(); if (ord) flags.delete(ord); flagUI(); }
        justSaved = true;
        const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = true;
        setCountBadge('discarded');
        const dot = $('#live-dot', page);
        if (dot) {
          dot.className = 'status-dot-idle';
          dot.style.background = 'var(--warn)';
        }
        const stateEl = $('#state', page);
        if (stateEl) {
          stateEl.textContent = interrupted?.reason === 'stall'
            ? '保存しませんでした（映像の取り込みが止まったため）'
            : '保存しませんでした（記録中に裏に回ったため）';
        }
        const tt = mss(Math.max(0, (session ? session.now() : 0) - t0));
        addEventRow(tt, '■', '試合を保存しませんでした', null);
      },
      match: rec => {
        savedCount++;
        justSaved = true;
        { const ord = pendingOrd.shift(); if (ord) { savedIds.set(ord, rec.id);
            if (rec.needs_fix && rec.needs_fix.auto && !flags.has(ord)) { flags.set(ord, new Set(rec.needs_fix.reasons || [])); flagUI(); const tt2 = mismatchText(rec.count_check); if (!battleActive) addEventRow('', '⚑', `検出と結果画面の数が合わないため、自動で要修正にしました${tt2 ? '：' + tt2 : ''}`, null); }
            else if (flags.get(ord)) applyFlag(ord).then(flagUI); } }
        if (!battleActive && rec.count_check && rec.count_check.result) showCompare(rec.count_check.detected, rec.count_check.result, true);
        if (!battleActive) { const rs = rec.result_screen || {}; showResult({ result: rs.result, mode: rs.mode ?? null, stage: rs.stage, match_type: rec.match_type, own: rs.own }, true); }
        const spBox = $('#live-sp-ready', page); if (spBox) spBox.hidden = true;
        $('#live-dot', page).className = 'status-dot-idle';
        $('#live-dot', page).style.background = 'var(--kill)';
        $('#state', page).textContent = '保存しました';
        const ev = effective(rec);
        const finK = ev.filter(x => x.kind === 'kill').length;
        const finD = ev.filter(x => x.kind === 'death').length;
        const finSp = ev.filter(x => x.kind === 'special').length;
        const diff = recountDiff({ k, d, sp }, { k: finK, d: finD, sp: finSp });
        k = finK;
        d = finD;
        sp = finSp;
        $('#k', page).textContent = k;
        $('#d', page).textContent = d;
        $('#sp', page).textContent = sp;
        setCountBadge('final', diff.text);
        if (diff.changed.length > 0) {
          const tt = mss(Math.max(0, (session ? session.now() : 0) - t0));
          const summary = diff.changed.map(c => `${c.label} ${c.from}→${c.to}`).join('、');
          addEventRow(tt, '↺', `数え直し：${summary}`, null);
        }
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
        syncStartDisabled();
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
      await session.start({ deviceId: $('#dev', page).value });
    } catch (e) {
      alert('開始できませんでした：' + e.message);
      syncStartDisabled();
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
let listFilters = { mode: 'ALL', stage: 'ALL', result: 'ALL', fix: 'ALL' };

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
    if (listFilters.fix === 'FIX' && FP.fixState(m) !== 'todo') return false;
    if (listFilters.fix === 'DONE' && FP.fixState(m) !== 'done') return false;
    return true;
  }).sort((a, b) => (b.created || '').localeCompare(a.created || '') || (b.match || 0) - (a.match || 0)); // 日時の降順（最新が一番上）

  const hasMatches = ms.length > 0;
  const fixCount = ms.filter(m => FP.fixState(m) === 'todo').length, fixDoneCount = ms.filter(m => FP.fixState(m) === 'done').length;
  const pending = FB.pendingMatches(ms);
  const pendingConfirmed = pending.reduce((a, m) => a + FB.confirmedCount(m), 0);
  const recentHist = [...FB.getFeedbackHistory()].slice(-5).reverse();

  const showBanner = capUsage.level !== 'ok' || (capUsage.favBytes > capUsage.capBytes);

  page.innerHTML = `
    ${renderCapacityBanner(capUsage)}
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h1 class="page-title">試合一覧 <span class="num muted">（${ms.length}試合）</span></h1>
        ${!showBanner ? `<span class="capacity-status muted">${esc(capLabel)}</span>` : ''}
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
        <div class="filter-group">
          <span class="filter-label">修正</span>
          <button class="chip ${listFilters.fix === 'ALL' ? 'active' : ''}" data-fkind="fix" data-fval="ALL">すべて</button>
          <button class="chip ${listFilters.fix === 'FIX' ? 'active' : ''}" data-fkind="fix" data-fval="FIX">⚑ 要修正（${fixCount}）</button>
          <button class="chip ${listFilters.fix === 'DONE' ? 'active' : ''}" data-fkind="fix" data-fval="DONE">✔ 修正済み（${fixDoneCount}）</button>
        </div>
      </div>
      ${fixCount || fixDoneCount ? `<div class="card fix-bar" id="fix-bar" style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-4)">
        <span><strong>⚑ 要修正 ${fixCount} 件・✔ 修正済み ${fixDoneCount} 件</strong>　試合を開いて、録画を見ながらレビューモードで直し、「修正完了」にすると、AI 用に書き出せます。</span>
        <button class="btn btn-sm" id="fix-export" type="button">修正済みの試合を AI 用に書き出す（zip）</button>
      </div>` : ''}

      <div class="match-list">
        ${filtered.map(m => {
          const r = resultOf(m);
          const rsStat = resultStatus(m);
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
            diffParts.push(`スペシャル発動<span class="num mismatch-val">${esc(r.specials)}</span>`);
            diffTipParts.push(`スペシャル発動：検出${spCnt} / リザルト画面${r.specials}`);
          }
          const diffTip = diffTipParts.join('、');
          const pctRv = det.length ? Math.round((rv / det.length) * 100) : 0;
          const dtStr = m.created ? new Date(m.created).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

          return `
            <div class="match-row click${m.remote ? ' is-remote' : ''}" data-id="${esc(m.id)}">
              <div class="match-row-col-res">
                <button class="fav-btn" data-id="${esc(m.id)}" type="button" aria-label="お気に入り" title="お気に入り">${m.favorite === true ? '★' : '☆'}</button>
                <span class="${badgeCls(r.result)}">${resJa(r.result)}</span>
                ${isVerificationMatch(m) ? '<span class="verify-badge">検証用</span>' : ''}
                ${m.needs_fix && m.needs_fix.done ? `<span class="badge" style="background:rgba(74,222,128,.15);color:#4ade80" title="修正済み（AI 用に書き出せます）">✔ 修正済み</span>` : m.needs_fix ? `<span class="badge" style="background:rgba(250,204,21,.15);color:#facc15" title="${esc((m.needs_fix.reasons || []).map(k => FP.FIX_REASONS[k] || k).join('・') || '要修正')}">⚑ 要修正${m.needs_fix.auto ? '（自動）' : ''}</span>` : ''}
                <span class="match-row-date num">${esc(dtStr)}</span>
              </div>

              <div class="match-row-col-stage">
                <span class="match-row-title">${esc(r.mode || 'ルール不明')}・${esc(r.stage || 'ステージ不明')}</span>
                ${(!r.mode && m.result_screen && m.result_screen.mode_unknown) ? '<span class="badge" title="結果画面は読めましたが、登録済みのどのルールとも十分に一致しませんでした（ガチアサリなど、見本の無いルールかもしれません）。確認画面でルール名を直して正解データを書き出すと、見本として追加できます。" style="font-size:11px">未登録のルール？</span>' : ''}
                <span class="stills-state">${esc(stillsStateLabel(m))}</span>
                <span class="export-state" data-state="${FB.exportStateOf(m)}">${esc(EXPORT_STATE_LABEL[FB.exportStateOf(m)])}</span>
                <span class="result-status" data-status="${rsStat.key}">${esc(rsStat.label)}</span>
                ${r.count ? `<span class="match-row-count num">${fmtCount(r.count)}</span>` : ''}
              </div>

              <div class="match-row-col-kda">
                <div class="kda-metrics">
                  <span class="kda-item"><span class="kda-label">キル</span><span class="kda-val num">${kCnt}</span>${(est => est ? `<span class="muted" style="font-size:11px;margin-left:3px" title="${esc(assistText(est) + '。' + ASSIST_NOTE)}">${est.over ? '⚠' : '+A' + est.assists}</span>` : '')(assistEstimate(r.ka, kCnt))}</span>
                  <span class="kda-item"><span class="kda-label">デス</span><span class="kda-val num ${dMismatch ? 'mismatch-val' : ''}" ${dMismatch ? `title="リザルト画面ではデス${esc(r.deaths)}"` : ''}>${dCnt}</span></span>
                  <span class="kda-item"><span class="kda-label">スペシャル発動</span><span class="kda-val num ${spMismatch ? 'mismatch-val' : ''}" ${spMismatch ? `title="リザルト画面ではスペシャル発動${esc(r.specials)}"` : ''}>${spCnt}</span></span>
                </div>
                ${showResultDiff ? `<span class="kda-mismatch" title="${esc(diffTip)}">リザルト画面では${diffParts.join('・')}</span>` : ''}
                ${(m.recon && m.recon.applied && m.recon.applied.length) ? `<span class="kda-auto" title="${esc(m.recon.applied.map(a => `${KINDS[a.kind] || a.kind} ${a.action === 'added' ? '追加' : a.action === 'promoted' ? '発動に変更' : '削除'} ${mss(a.t - ((m.battle && m.battle[0]) || 0))}`).join('、'))}">リザルト画面に合わせて自動補正 ${m.recon.applied.length}件</span>` : ''}
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

  mountPage(page, false);
  wireCapacityBanner(page, capUsage);

  const goLiveBtn = $('#empty-go-live', page);
  if (goLiveBtn) goLiveBtn.onclick = () => nav('live');

  page.querySelectorAll('.chip[data-fkind]').forEach(btn => {
    btn.onclick = () => {
      listFilters[btn.dataset.fkind] = btn.dataset.fval;
      PAGES.list();
    };
  });

  const fixExportBtn = $('#fix-export', page); if (fixExportBtn) fixExportBtn.onclick = () => showFixExportDialog();

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

};

// D84: 設定画面。記録の消去（リセット）とクラウド同期は、試合一覧から移した
PAGES.settings = async () => {
  const ms = await db.allMatches();
  const page = document.createElement('div');
  page.innerHTML = `
    <div class="page-header"><h1 class="page-title">設定</h1></div>
    <section id="cloud-panel" class="card learn-panel"></section>
    <section id="reset-panel" class="card learn-panel"></section>`;
  mountPage(page, false);
  // D58: クラウド同期パネル（アカウントに紐付けて、数値と時刻だけを同期する。画像・クリップ・信号は端末に残す）
  let cloudMsg = '', cloudBusy = false;
  const updateCloudPanel = async () => {
    const el = $('#cloud-panel', page); if (!el) return;
    const user = await Cloud.getUser().catch(() => null), st = Cloud.loadState();
    const when = t => (t ? new Date(t).toLocaleString('ja-JP') : '—');
    const remoteN = ms.filter(x => x.remote).length;
    el.innerHTML = `
      <div class="learn-panel-header"><div class="learn-panel-title-wrap"><h2 class="learn-panel-title">クラウド同期（スマホでも見る）</h2>
        <span class="learn-badge ${user ? 'badge-active' : 'badge-neutral'}">${user ? 'ログイン中' : '未ログイン'}</span></div></div>
      <div class="learn-panel-body">
        <p class="muted">アカウントに紐付けて、<strong>数値と時刻だけ</strong>（勝敗・ルール・ステージ・キル/デス/スペシャルの時刻・確認画面の修正など）を同期します。静止画・クリップ・検出用の信号は送らず、この端末に残ります。他人の試合（検証用）も送りません。スマホでは同じ URL を開いてログインすると、一覧・詳細・傾向分析を見られます（スマホからの修正はできません）。</p>
        ${user ? `
          <table class="table"><tbody>
            <tr><th>アカウント</th><td>${esc(user.email || user.id)}</td></tr>
            <tr><th>最後の同期</th><td class="num">${esc(when(st.lastSync))}</td></tr>
            <tr><th>この端末の試合</th><td class="num">${ms.length} 件（うち、クラウドから取り込んだ閲覧用 ${remoteN} 件）</td></tr>
            <tr><th>まだ送っていない試合</th><td class="num" id="cloud-pending">…</td></tr>
          </tbody></table>
          <div class="learn-actions-row">
            <button class="btn btn-primary" id="cloud-sync" type="button" ${cloudBusy ? 'disabled' : ''}>${cloudBusy ? '同期中…' : '今すぐ同期'}</button>
            <button class="btn" id="cloud-resync" type="button" title="送信済みの印を消して、全部の試合をもう一度送ります（クラウドの試合が足りないとき）" ${cloudBusy ? 'disabled' : ''}>すべて送り直す</button>
            <button class="btn" id="cloud-out" type="button">ログアウト</button>
            <label class="muted"><input type="checkbox" id="cloud-auto" ${Cloud.autoEnabled() ? 'checked' : ''}> 保存・修正のたびに自動で同期する</label>
          </div>` : `
          <div class="learn-actions-row">
            <input class="input-sm" id="cloud-id" type="text" placeholder="ID（メールアドレスの形）" size="26" autocomplete="username" autocapitalize="off">
            <input class="input-sm" id="cloud-pass" type="password" placeholder="パスワード（12文字以上）" size="22" autocomplete="current-password">
            <button class="btn btn-primary" id="cloud-login" type="button">ログイン</button>
            <button class="btn" id="cloud-signup" type="button">新規登録</button>
          </div>
          <p class="muted" style="font-size:12px">初めてなら「新規登録」。IDはメールアドレスの形で入力します（確認メールは送りません）。パスワードを忘れても再発行できませんが、データは各端末に残ります。</p>`}
        ${cloudMsg ? `<p class="muted" id="cloud-msg">${esc(cloudMsg)}</p>` : ''}
        ${st.lastError ? `<p class="muted" style="color:var(--lose)">直前の同期でエラー：${esc(st.lastError)}</p>` : ''}
      </div>`;
    const auth = async fn => { const id = $('#cloud-id', el).value.trim(), pw = $('#cloud-pass', el).value; if (!id || !pw) { cloudMsg = 'IDとパスワードを入力してください。'; updateCloudPanel(); return; } if (pw.length < 8) { cloudMsg = 'パスワードは 8 文字以上にしてください（12 文字以上をおすすめします）。'; updateCloudPanel(); return; }
      const r = await fn(id, pw); if (r.ok) { cloudMsg = 'ログインしました。同期を始めます…'; await updateCloudPanel(); const s = await Cloud.syncNow(); cloudMsg = s.ok ? `同期しました（取り込み ${s.pulled} 件・送信 ${s.pushed} 件）。` : '同期できませんでした：' + (s.error || s.reason); if (s.ok && s.pulled) PAGES.list(); else updateCloudPanel(); } else { cloudMsg = r.error; updateCloudPanel(); } };
    const li = $('#cloud-login', el); if (li) li.onclick = () => auth(Cloud.signInPassword);
    const su = $('#cloud-signup', el); if (su) su.onclick = () => auth(Cloud.signUpPassword);
    for (const id of ['#cloud-id', '#cloud-pass']) { const i = $(id, el); if (i) i.onkeydown = e => { if (e.key === 'Enter') auth(Cloud.signInPassword); }; }
    const sy = $('#cloud-sync', el); if (sy) sy.onclick = async () => { cloudBusy = true; cloudMsg = ''; updateCloudPanel(); const r = await Cloud.syncNow(); cloudBusy = false; cloudMsg = r.ok ? `同期しました（取り込み ${r.pulled} 件・送信 ${r.pushed} 件${r.deleted || r.deletedSent ? `・削除 ${r.deleted + r.deletedSent} 件` : ''}）。` : (r.reason === 'busy' ? '同期中です。' : '同期できませんでした：' + (r.error || r.reason)); if (r.ok && (r.pulled || r.deleted)) PAGES.list(); else updateCloudPanel(); };
    const rs = $('#cloud-resync', el); if (rs) rs.onclick = async () => { cloudBusy = true; cloudMsg = ''; updateCloudPanel(); const r = await Cloud.resyncAll(); cloudBusy = false; cloudMsg = r.ok ? `全部を送り直しました（取り込み ${r.pulled} 件・送信 ${r.pushed} 件）。` : '同期できませんでした：' + (r.error || r.reason); if (r.ok && (r.pulled || r.deleted)) PAGES.list(); else updateCloudPanel(); };
    if (user) Cloud.pendingCount().then(n => { const e = $('#cloud-pending', el); if (e) e.textContent = `${n} 件`; }).catch(() => {});
    const so = $('#cloud-out', el); if (so) so.onclick = async () => { await Cloud.signOut(); cloudMsg = 'ログアウトしました（この端末の試合はそのまま残ります）。'; updateCloudPanel(); };
    const au = $('#cloud-auto', el); if (au) au.onchange = e => Cloud.setAuto(e.target.checked);
  };
  await updateCloudPanel();

  const updateResetPanel = () => {
    const el = $('#reset-panel', page); if (!el) return;
    el.innerHTML = `<h3>記録をすべて消す（リセット）</h3>
      <p class="muted">この端末の<strong>試合の記録・静止画・場面クリップ</strong>をすべて消します（${ms.length} 試合）。元に戻せません（録画ファイルは消えません）。クラウド同期（ログイン中）をしていると、次の同期で<strong>クラウドの記録も消えます</strong>。必要なら先に「バックアップを書き出す」で保存してください。</p>
      <label class="row"><input type="checkbox" id="reset-learn"> ブキの名前・各種の設定も初期化する</label>
      <button class="btn btn-stop" id="reset-all" type="button">すべての記録を消す</button>`;
    $('#reset-all', el).onclick = async () => {
      const learn = $('#reset-learn', el).checked;
      if (!confirm(`${ms.length} 試合ぶんの記録をすべて消します。元に戻せません。${learn ? '\nブキの名前・設定も初期化します。' : ''}\n\nよろしいですか？`)) return;
      if (prompt('確認のため「消す」と入力してください') !== '消す') { alert('入力が違うので、中止しました'); return; }
      try { const r = await db.resetAll({ includeLearn: learn }); alert(`${r.matches} 試合の記録を消しました`); } catch (e) { alert('消去に失敗しました: ' + (e?.message || e)); }
      PAGES.settings();
    };
  };
  updateResetPanel();
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
    const snaps = (await db.snapsOf(m.id)).filter(s => s.kind !== 'clip');
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

// D74: 録画の設定（ライブ画面に出す）
async function renderVideoSettings(el) {
    if (!el) return;
    const updateVideoPanel = () => renderVideoSettings(el);
    const D = window.inkgraphDesktop || null;
    if (!VR.videoSupported()) { // ブラウザ版: 録画は非対応（デスクトップ版のみ）
      el.innerHTML = `<h3 style="margin:0 0 6px">試合ごとの録画</h3>
        <p class="muted">試合ごとの録画（ルール・ステージ入りのファイル名で 1 試合 1 ファイル）は<strong>デスクトップ版（Windows）だけ</strong>の機能です。ブラウザ版は、ウィンドウが隠れると映像の取り込みが止まるため、録画には対応していません。</p>`;
      return;
    }
    const on = VR.getVideoOn();
    const dirInfo = D ? await D.getVideoDir().catch(() => null) : null, dir = D ? null : await db.getVideoDir().catch(() => null), canPick = D || typeof window.showDirectoryPicker === 'function';
    const perm = dir ? await dir.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt') : null;
    el.innerHTML = `<h3 style="margin:0 0 6px">試合ごとの録画</h3>
      <p class="muted">オンにすると、配信映像／キャプチャー映像の解析中、バトル開始から結果画面までを<strong>1 試合 = 1 ファイル</strong>で保存します。ファイル名は <code>日時_ルール_ステージ_勝敗.mp4</code> で、結果画面を読めたあとに自動で付きます（例: 20261027_2105_ガチエリア_ヒラメが丘団地_勝ち.mp4）。録画した試合は、試合の詳細（レビュー）画面で録画を見ながら確認・修正できます。60fps・音声 192kbps。録画ファイルを読み込んでの解析（ファイル再生）では録画されません。</p>
      <label class="row"><input type="checkbox" id="video-on" ${on ? 'checked' : ''}> 試合ごとに録画する</label>
      <label class="row"><input type="checkbox" id="video-audio" ${VR.getAudioOn() ? 'checked' : ''}> ゲーム音も録音する（次に解析を始めるときから）</label>
      <label class="row">画質（60fps） <select id="video-bitrate" class="input-sm">${VR.BITRATE_CHOICES.map(m => `<option value="${m}" ${VR.getBitrateMbps() === m ? 'selected' : ''}>${m} Mbps${m === 8 ? '（おすすめ）' : ''}</option>`).join('')}</select></label>
      <label class="row">音質 <select id="video-audio-kbps" class="input-sm">${VR.AUDIO_CHOICES.map(k => `<option value="${k}" ${VR.getAudioKbps() === k ? 'selected' : ''}>${k} kbps${k === 192 ? '（おすすめ）' : ''}</option>`).join('')}</select></label>
      <p class="muted" id="video-size-est"></p>
      <p class="muted">${D ? '画面共有: ウィンドウ／画面を選ぶと、Windows ではシステム音も録れます。キャプチャー映像: ボードの音声入力（映像と同じ機器の音声）を自動で探して足します。' : '配信映像（画面共有）: 共有ダイアログの「タブの音声／システムの音声も共有」にチェックを入れてください。キャプチャー映像: ボードの音声入力を自動で探して足します。'} 見つからないときは音声なしで録画します。録画中、画面からの再生音は出しません（二重に聞こえるのを防ぐため）。</p>
      <p class="muted" id="video-dir">保存先: ${D ? esc(dirInfo?.dir || '') + (dirInfo?.custom ? '' : '（既定）') : (dir ? esc(dir.name) + (perm === 'granted' ? '（書き込み許可済み）' : '（許可が切れています。「保存先を選ぶ」で選び直してください）') : '未設定（ダウンロードフォルダに自動ダウンロード）')}</p>
      <button class="btn" id="video-pick" type="button" ${canPick ? '' : 'disabled'}>${D || dir ? '保存先を選び直す' : '保存先フォルダを選ぶ'}</button>${D ? ' <button class="btn" id="video-open" type="button">保存先を開く</button>' : ''}${!D && dir && perm !== 'granted' ? ' <button class="btn" id="video-regrant" type="button">書き込みを許可する</button>' : ''}`;
    $('#video-on', el).onchange = e => { VR.setVideoOn(e.target.checked); const sm = document.querySelector('#live-video-summary'); if (sm) sm.textContent = e.target.checked ? '（オン）' : '（オフ）'; };
    $('#video-audio', el).onchange = e => VR.setAudioOn(e.target.checked);
    const sizeEst = () => { const m = VR.getBitrateMbps(), k = VR.getAudioKbps(), mb = Math.round((m * 1000 + (VR.getAudioOn() ? k : 0)) * 6 * 60 / 8 / 1000); $('#video-size-est', el).textContent = `目安: 6 分の試合で 約 ${mb}MB（画質・音質を変えると、次の試合の録画から反映されます）`; };
    $('#video-bitrate', el).onchange = e => { VR.setBitrateMbps(+e.target.value); sizeEst(); };
    $('#video-audio-kbps', el).onchange = e => { VR.setAudioKbps(+e.target.value); sizeEst(); };
    $('#video-audio', el).addEventListener('change', sizeEst); sizeEst();
    const rg = $('#video-regrant', el); if (rg) rg.onclick = async () => { await VR.ensureDirPermission(dir); await updateVideoPanel(); };
    const op = $('#video-open', el); if (op) op.onclick = () => D.openVideoDir();
    $('#video-pick', el).onclick = async () => { try { if (D) { await D.pickVideoDir(); } else { const h = await window.showDirectoryPicker({ mode: 'readwrite' }); await db.setVideoDir(h); } await updateVideoPanel(); } catch { /* cancelled */ } };
  }

// D75: 要修正パック（AI 用）。要修正の試合ごとに、ソフトの分析結果・人の修正・差分・（録画があれば）差分の前後のコマを zip にする
async function buildFixPack(matches, { whole = false, video = false, onProgress = () => {} } = {}) {
  // video: true（デスクトップ版の書き出し）: 録画をそのまま入れる（コマの切り出しはしない）。zip は main 側がディスクへ順に書く（返すのは中身の一覧）
  const files = {}, videos = [], index = [], now = new Date(), D = window.inkgraphDesktop;
  let n = 0;
  for (const m of matches) {
    n++;
    const dir = `matches/${FP.safeId(m.id)}/`, d = FP.diffOf(m);
    const times = FP.frameTimes(m, d, { whole }), frames = [];
    const put = (name, blob) => blob.arrayBuffer().then(b => { files[dir + name] = new Uint8Array(b); });
    let source = 'none', vinfo = null;
    if (video && m.recording && m.recording.path && Number.isFinite(m.recording.t0)) {
      const vname = `video/${(m.recording.file || m.recording.path.split(/[\\/]/).pop() || 'recording.mp4')}`; videos.push({ name: dir + vname, path: m.recording.path, bytes: m.recording.bytes || 0 });
      vinfo = { file: vname, t0: m.recording.t0, note: '録画の位置[秒] ＝ 解析時刻 t − t0（各項目の video_pos）' }; source = 'video';
    } else if (m.recording && D && Number.isFinite(m.recording.t0) && times.length) {
      try {
        onProgress(`試合 ${n}/${matches.length}: 録画から ${times.length} コマを切り出し中…`);
        const got = await extractFrames(`rec://local/${encodeURIComponent(m.recording.path)}`, times.map(t => t - m.recording.t0), { onProgress: (i, tot) => onProgress(`試合 ${n}/${matches.length}: 録画からコマを切り出し中 ${i}/${tot}`) });
        for (let i = 0; i < got.length; i++) { const name = `frames/t${times[i].toFixed(1).padStart(7, '0')}.webp`; await put(name, got[i].blob); frames.push({ t: times[i], rel: Math.round((times[i] - m.battle[0]) * 10) / 10, file: dir + name }); }
        source = 'recording';
      } catch (e) { console.warn('frame extraction failed', e); source = 'recording-failed: ' + (e?.message || e); }
    }
    if (source !== 'recording' && source !== 'video') { // 録画が無い／開けない: 保存してある静止画・場面クリップ
      onProgress(`試合 ${n}/${matches.length}: 静止画・場面クリップを入れています…`);
      for (const sn of (await db.snapsOf(m.id)).sort((a, b) => a.t - b.t)) { const name = `frames/${sn.kind === 'clip' ? 'clip' : 'still'}_t${sn.t.toFixed(1).padStart(7, '0')}_${sn.id}.${sn.kind === 'clip' ? 'webp' : 'jpg'}`; await put(name, sn.blob); frames.push({ t: sn.t, rel: Math.round((sn.t - m.battle[0]) * 10) / 10, file: dir + name, kind: sn.kind || null }); }
      if (source === 'none') source = frames.length ? 'stills' : 'none';
    }
    files[dir + 'summary.json'] = strToU8(JSON.stringify(FP.matchSummary(m), null, 1));
    files[dir + 'diff.json'] = strToU8(JSON.stringify({ ...(vinfo ? FP.withVideoPos(d, m) : d), frame_source: source, ...(vinfo ? { video: vinfo } : {}), frames }, null, 1));
    files[dir + 'human_review.json'] = strToU8(JSON.stringify(m.review ?? null, null, 1));
    files[dir + 'software.json'] = strToU8(JSON.stringify(m));
    index.push({ id: m.id, dir, counts: { false_positives: d.false_positives.length, misses: d.misses.length, result_fixes: d.result_fixes.length, unreviewed: d.unreviewed }, frame_source: source, frames: frames.length, reasons: (m.needs_fix?.reasons || []).map(k => FP.FIX_REASONS[k] || k) });
  }
  // D93: 人が教えた見本（ブキの名前・ステージ名）。試合には紐づかない端末の見本全体。ソフトの同梱の見本に取り込む材料にする
  const wl = WL.loadUserLib().items, sl = StageLib.loadLib().items, teaching = wl.length || sl.length ? { weapons: wl.length, stages: sl.length } : null;
  if (teaching) {
    files['teaching/weapons.json'] = strToU8(JSON.stringify({ format: 1, note: 'icon＝結果画面ボードの 56x34 のグレー画像（base64）。同梱の見本に足す材料', items: wl.map(x => ({ name: x.name, type: x.type ?? null, icon: x.icon, at: x.at ?? null })) }, null, 1));
    files['teaching/stages.json'] = strToU8(JSON.stringify({ format: 1, note: 'feat＝ステージ名の文字の 120x32 の画像（base64）。同梱の見本（assets の lib.stage）に足す材料', items: sl }, null, 1));
  }
  const params = null; // D84: 検出の自動調整は廃止（常に既定値）
  files['INDEX.json'] = strToU8(JSON.stringify({ app: 'InkGraph', kind: 'fix-pack', format: 1, exported: now.toISOString(), ...(teaching ? { teaching } : {}), matches: index }, null, 1));
  files['detect_params.json'] = strToU8(JSON.stringify(params, null, 1));
  files['README.md'] = strToU8(FP.fixReadme({ count: matches.length, exported: now.toISOString(), withFrames: index.some(x => x.frame_source === 'recording'), withVideo: videos.length > 0, teaching }));
  if (video) return { files, videos, filename: FP.fixPackFilename(now), index };
  return { blob: new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), filename: FP.fixPackFilename(now), index };
}

// D87: 録画をそのまま入れた zip を、main 側がディスクへ順に書く（大きくてもメモリに載せない。保存ダイアログで保存先を選ぶ）
async function exportFixPack(sel, onProgress = () => {}) {
  const D = window.inkgraphDesktop, r = await buildFixPack(sel, { video: true, onProgress });
  const entries = Object.entries(r.files).map(([name, data]) => ({ name, data })).concat(r.videos.map(v => ({ name: v.name, path: v.path })));
  const off = D.onPackProgress ? D.onPackProgress(p => onProgress(`書き出し中… ${(p.done / 1048576).toFixed(0)} / ${(p.total / 1048576).toFixed(0)}MB`)) : null;
  try { return { ...(await D.packWrite({ filename: r.filename, entries })), filename: r.filename, index: r.index, videos: r.videos.length }; } finally { off?.(); }
}

async function showFixExportDialog() {
  document.querySelector('.fix-dialog-overlay')?.remove();
  const all = (await db.allMatches()).filter(m => m.needs_fix), doneAll = all.filter(m => FP.fixState(m) === 'done'), teachN = WL.loadUserLib().items.length + StageLib.loadLib().items.length;
  const ov = document.createElement('div'); ov.className = 'fix-dialog-overlay'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  const rows = all.map(m => { const d = FP.diffOf(m), r = resultOf(m); return `<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" class="fixsel" value="${esc(m.id)}" ${FP.fixState(m) === 'done' ? 'checked' : 'disabled'}> <span>${esc((m.created || '').slice(0, 16).replace('T', ' '))} ${esc(r.mode || 'ルール不明')}・${esc(r.stage || 'ステージ不明')} <span class="muted">誤検出 ${d.false_positives.length}・見逃し ${d.misses.length}・読み違い ${d.result_fixes.length}${d.unreviewed ? `・未確認 ${d.unreviewed}` : ''}${m.recording ? '・録画あり' : ''}</span>${FP.fixState(m) === 'done' ? '' : ' <span class="muted" style="font-size:var(--fs-xs)">未修正（先にレビューで正解を付けて、「修正完了」にしてください）</span>'}</span></label>`; }).join('');
  ov.innerHTML = `<div class="card" style="max-width:720px;width:92vw;max-height:84vh;overflow:auto;padding:var(--sp-4)"><h3>修正済みの試合を AI 用に書き出す</h3>
    <p class="muted" style="font-size:var(--fs-xs)">ソフトの分析結果と、人の修正（✓／✗・追加した見逃し・直した値）、録画（そのまま）または静止画を zip にします。Claude Code に渡して、検出ロジックの修正に生かせます。レビューモードで直してから書き出すと、差分が正しく入ります。</p>
    <div>${rows || '<p class="muted">要修正の試合がありません</p>'}</div>${all.length && !doneAll.length ? '<p class="muted">修正済みの試合がありません。試合の詳細で、レビューモードで直してから「修正完了」にしてください。</p>' : ''}
    <p id="fix-size" class="muted" style="font-size:var(--fs-xs);margin-top:8px"></p>
    <p id="fix-progress" class="muted" style="min-height:1.4em;font-size:var(--fs-xs)"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="fix-cancel" type="button">閉じる</button><button class="btn btn-primary" id="fix-go" type="button" ${doneAll.length || teachN ? '' : 'disabled'}>書き出す</button></div></div>`;
  document.body.appendChild(ov);
  $('#fix-cancel', ov).onclick = () => ov.remove();
  const D = window.inkgraphDesktop, canDisk = !!(D && D.packWrite);
  const selected = () => all.filter(m => [...ov.querySelectorAll('.fixsel:checked')].some(x => x.value === m.id));
  const sizeNote = () => { const v = selected().filter(m => m.recording && m.recording.path); const mb = v.reduce((n, m) => n + (m.recording.bytes || 0), 0) / 1048576;
    $('#fix-size', ov).textContent = canDisk && v.length ? `録画 ${v.length} 本をそのまま（無加工で）入れます。約 ${mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : mb < 1 ? '1MB 未満' : Math.round(mb) + 'MB'}。保存先は、書き出すときに選びます。` : '録画がない試合は、保存してある静止画・場面クリップを入れます。'; if (teachN) $('#fix-size', ov).textContent += ` 教えたブキ・ステージの見本（${teachN} 件）も、teaching/ に入れます。`; };
  ov.addEventListener('change', sizeNote); sizeNote();
  $('#fix-go', ov).onclick = async () => {
    const ids = [...ov.querySelectorAll('.fixsel:checked')].map(x => x.value), sel = all.filter(m => ids.includes(m.id)); if (!sel.length && !teachN) return;
    const go = $('#fix-go', ov); go.disabled = true; const prog = $('#fix-progress', ov);
    try {
      if (canDisk && sel.some(m => m.recording && m.recording.path)) {
        const r = await exportFixPack(sel, t => { prog.textContent = t; });
        prog.textContent = r.ok ? `書き出しました: ${r.path}（${sel.length} 試合・録画 ${r.videos} 本・${(r.bytes / 1048576).toFixed(1)}MB）` : r.canceled ? '書き出しを取りやめました' : '書き出しに失敗しました: ' + (r.reason || '') + (r.file ? '（' + r.file + '）' : '');
        go.disabled = false; return;
      }
      const { blob, filename, index } = await buildFixPack(sel, { onProgress: t => { prog.textContent = t; } });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      prog.textContent = `書き出しました: ${filename}（${sel.length} 試合・${(blob.size / 1024 / 1024).toFixed(1)}MB）`;
    } catch (e) { prog.textContent = '書き出しに失敗しました: ' + (e?.message || e); }
    go.disabled = false;
  };
}

async function showFeedbackExportDialog(initialMode = 'diff') {
  document.querySelector('.fb-dialog-overlay')?.remove();
  const all = await db.allMatches();
  const snapsById = new Map();
  for (const m of all.filter(FB.hasReview)) snapsById.set(m.id, (await db.snapsOf(m.id)).filter(s => s.kind !== 'clip'));
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
        <div class="fb-dialog-note">書き出した ZIP は、<a href="https://github.com/qnaiv/inkgraph2/upload/main/inbox" target="_blank" rel="noopener">GitHub の inbox にアップロード</a>すると、見本の追加・正解ラベル・学習用画像の保存を自動で行い、取り込み結果の PR を作ります（D60）。</div>
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
  m.review.cand_dismissed = m.review.cand_dismissed || [];
  m.review.fix = m.review.fix || {};
  const save = async () => {
    m.review.updated = new Date().toISOString();
    syncExportState(m);
    await db.putMatch(m);
    const st = document.getElementById('fbone-state');
    if (st) st.textContent = `この試合：${EXPORT_STATE_LABEL[exportStateOf(m)]}（確認済み ${confirmedCount(m)}件）`;
  };

  if (m.remote) reviewMode = false; // クラウドから取り込んだ試合は閲覧のみ（D58）
  const r = resultOf(m);
  const rsStat = resultStatus(m);
  const matchTypeLabel = (r.match_type && MATCH_TYPE_LABEL[r.match_type]) || '不明';
  const powerStatusLabel = (r.power?.status && POWER_STATUS_LABEL[r.power.status]) || 'タイプ不明';
  const powerValueExtra = (r.power?.status === 'acquired' && r.power.value !== null && r.power.value !== undefined)
    ? ` <b class="num" id="power-value">${esc(r.power.value)}</b>`
    : '';
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

    <div class="card detail-header-card ${reviewMode ? 'review-on' : ''}">
      <div class="detail-header-left">
        <span class="${badgeCls(r.result)} result-hero">${resJa(r.result)}</span>
        <div class="detail-stage-info">
          <div class="detail-stage-title">${esc(r.mode || 'ルール不明')}・${esc(r.stage || 'ステージ不明')} <span class="result-status" data-status="${rsStat.key}">${esc(rsStat.label)}</span></div>
          <div class="match-type-line">
            マッチタイプ <b id="match-type">${esc(matchTypeLabel)}</b> ・ パワー <b id="power-status">${esc(powerStatusLabel)}</b>${powerValueExtra}
          </div>
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
          <div class="hdr-res" id="hdr-res-k"></div>
          <div class="muted" id="hdr-ka" style="font-size:11px" title="${esc(ASSIST_NOTE)}">${esc(assistText(assistEstimate(r.ka, kCount)))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">デス</div>
          <div class="stat-value num" id="hdr-d">${dCount}</div>
          <div class="hdr-res" id="hdr-res-d"></div>
        </div>
        <div class="stat">
          <div class="stat-label">スペシャル発動</div>
          <div class="stat-value num" id="hdr-sp">${spCount}</div>
          <div class="hdr-res" id="hdr-res-sp"></div>
        </div>
      </div>

      ${m.remote ? '<div class="muted" id="remote-note" style="font-size:12px">クラウドから取り込んだ試合です（閲覧のみ）。画像・信号はこの端末に無いので、確認の修正はできません。修正は記録した端末で行ってください。</div>' : `<label class="review-toggle-label" for="review-toggle">
        <input type="checkbox" id="review-toggle" class="toggle-input" ${reviewMode ? 'checked' : ''}>
        <span class="toggle-switch" aria-hidden="true"></span>
        <span>レビューモード</span>
      </label>`}
      ${m.remote ? '' : `<span class="fix-flag-ctl" style="display:inline-flex;gap:6px;align-items:center;margin-left:12px"><button class="btn btn-sm" id="fix-toggle" type="button"></button> <button class="btn btn-sm" id="fix-done" type="button"></button></span>`}
    </div>

    <div class="detail-body ${reviewMode ? 'review-on' : ''}" id="detail-body">
      <div class="card detail-timeline-card" id="rec-top-card" style="display:none"><div class="card-title">録画</div><div id="rec-top-slot"></div></div>
      <div class="card detail-timeline-card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span>タイムライン</span>${m.remote || !m.cands ? '' : '<label class="muted" style="font-size:var(--fs-xs);font-weight:400;display:inline-flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" id="cand-tl"> 補正候補を表示</label>'}</div>
        <div id="tl"></div>
      </div>

      <div class="card detail-events-card">
        <div class="evt-scroll">
          <div class="card-title">出来事</div>
          <table class="table" id="etab"></table>
        </div>
      </div>

      <aside class="review-panel" id="review-panel"><div class="rv-scroll">
        <div class="card">
          <div class="card-title" id="rv-title">確認用の映像</div>
          <div id="rec-box" class="rec-box" style="display:none"></div>
          <div class="review-video-wrap" style="position:relative">
            <img id="still-img" alt="確認用の静止画" style="width:100%;height:100%;object-fit:contain;display:none">
            <div id="still-empty" class="muted" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:12px">静止画なし（この試合では静止画が保存されていません）</div>
          </div>
          <div id="still-cap" class="muted" style="margin-top:8px;min-height:1.4em"></div>
          <div id="clip-box" class="clip-box"></div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <div class="review-section-title">見逃しを追加（いま見ている時刻）</div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm add" data-k="kill" type="button">＋ キル</button>
              <button class="btn btn-sm add" data-k="death" type="button">＋ デス</button>
              <button class="btn btn-sm add" data-k="special" type="button">＋ スペシャル発動を追加</button>
            </div>
          </div>
        </div>

        ${m.remote ? '' : `<div class="card" id="cand-card">
          <div class="card-title">見逃しの候補（採用しなかった検出）</div>
          <div class="muted" id="cand-hint" style="font-size:var(--fs-xs);margin-bottom:6px"></div>
          <div id="cand-list"></div>
        </div>`}

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
      </div></aside>
    </div>
  `;

  mountPage(page, false);

  $('#pick', page).onchange = e => nav('match', e.target.value);
  // D88: 要修正の状態は 3 つ。確認不要（印なし）／要修正（まだ直していない）／修正済み（正解を付け終えた。AI 用に書き出せるのはこれだけ）
  const fixBtn = $('#fix-toggle', page), fixDoneBtn = $('#fix-done', page);
  const fixUI = () => { const st = FP.fixState(m); if (!fixBtn) return;
    fixBtn.textContent = st === 'none' ? '⚑ 要修正にする' : '要修正を外す（確認不要）';
    fixDoneBtn.style.display = st === 'none' ? 'none' : ''; fixDoneBtn.textContent = st === 'done' ? '✔ 修正済み（要修正に戻す）' : '✔ 修正完了にする'; fixDoneBtn.classList.toggle('btn-primary', st === 'todo'); };
  if (fixBtn) {
    fixBtn.onclick = async () => { FP.flagMatch(m, !m.needs_fix, m.needs_fix?.reasons || []); await db.putMatch(m); fixUI(); };
    fixDoneBtn.onclick = async () => {
      if (FP.fixState(m) === 'todo') { const un = FP.diffOf(m).unreviewed; if (un > 0 && !confirm(`未確認の検出が ${un} 件残っています。このまま「修正完了」にしますか？（AI は、確認していない検出を正しいものとして扱います）`)) return; FP.markFixDone(m, true); }
      else FP.markFixDone(m, false);
      await db.putMatch(m); fixUI();
    };
    fixUI();
  }
  if ($('#review-toggle', page)) $('#review-toggle', page).onchange = e => {
    reviewMode = e.target.checked;
    $('#detail-body', page).classList.toggle('review-on', reviewMode); $('.detail-header-card', page)?.classList.toggle('review-on', reviewMode);
    placeRec();
    if (!reviewMode && tlEl) tlEl.closePopover();
    candOnTL = reviewMode; { const ct = $('#cand-tl', page); if (ct) ct.checked = candOnTL; }
    drawTL();
  };

  let lastSeekTime = m.battle[0] + 45;
  let tlEl = null;

  const stills = (await db.snapsOf(m.id)).filter(s => s.kind !== 'clip').sort((a, b) => a.t - b.t);
  const clips = await db.clipsOf(m.id);
  const stillImg = $('#still-img', page), stillEmpty = $('#still-empty', page), stillCap = $('#still-cap', page);
  const KIND_JA = { kill: 'キル', death: 'デス', special: 'スペシャル発動', celebration: 'リザルト', personal: 'リザルト', board: 'リザルト', event: '見逃し・誤検出' };
  let stillUrl = null;
  const showEmpty = msg => { stillImg.style.display = 'none'; stillEmpty.textContent = msg; stillEmpty.style.display = 'flex'; };

  const relT = t => mss(t - m.battle[0]); /* clip labels use the same battle-relative time as the events table */
  const mss1 = t => {
    t = Math.max(0, t - m.battle[0]);
    const min = Math.floor(t / 60);
    const sec = (t % 60).toFixed(1).padStart(4, '0');
    return `${min}:${sec}`;
  };

  const clipBox = $('#clip-box', page);
  let activeClip = null;
  let currentFrameIdx = 0;
  let clipTimer = null;
  let clipUrl = null;

  const stopClipPlayback = () => {
    if (clipTimer) {
      clearInterval(clipTimer);
      clipTimer = null;
    }
    const btn = $('#clip-play', page);
    if (btn) btn.textContent = '▶ 再生';
  };

  pageCleanup = () => {
    stopClipPlayback();
    if (recKeyHandler) document.removeEventListener('keydown', recKeyHandler);
    if (recVideo) { try { recVideo.pause(); } catch { /* ignore */ } }
    if (clipUrl) { URL.revokeObjectURL(clipUrl); clipUrl = null; }
    if (stillUrl) { URL.revokeObjectURL(stillUrl); stillUrl = null; }
  };

  const updateActiveChip = idx => {
    page.querySelectorAll('.clip-chip').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.idx) === idx);
    });
  };

  const showClipFrame = (c, frameIdx) => {
    if (!c || !c.frames || frameIdx < 0 || frameIdx >= c.frames.length) return;
    const f = c.frames[frameIdx];
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    if (stillUrl) { URL.revokeObjectURL(stillUrl); stillUrl = null; }
    clipUrl = URL.createObjectURL(f.blob);
    stillImg.onerror = () => { stillCap.textContent = ''; showEmpty('静止画なし（静止画を表示できません）'); };
    stillImg.onload = () => { stillEmpty.style.display = 'none'; stillImg.style.display = 'block'; };
    stillImg.src = clipUrl;
    stillCap.textContent = `場面クリップ ${relT(c.t)}（${c.kinds.map(k => CLIP_KIND_JA[k] || k).join('・')}）`;
    const seekEl = $('#clip-seek', page);
    if (seekEl) {
      seekEl.max = c.frames.length - 1;
      seekEl.value = frameIdx;
    }
    const statEl = $('#clip-stat', page);
    if (statEl) {
      statEl.textContent = `${frameIdx + 1}/${c.frames.length}枚 · ${mss1(f.t)}`;
    }
    lastSeekTime = f.t; // 「見逃しを追加」は、いま見ているコマの時刻に付く
    if (tlEl && tlEl.setPlayhead) tlEl.setPlayhead(f.t);
  };

  // 再生は、クリップのコマ間隔（0.2 秒＝5fps）のとおりの等倍が既定。速度は「等倍／1/2／1/4」から選ぶ
  let clipSpeed = 1;
  const startClipTimer = () => {
    if (clipTimer) clearInterval(clipTimer);
    clipTimer = setInterval(() => {
      const c = activeClip;
      if (!c) { stopClipPlayback(); return; }
      if (currentFrameIdx + 1 < c.frames.length) { currentFrameIdx++; showClipFrame(c, currentFrameIdx); } else { stopClipPlayback(); }
    }, Math.round(CLIP.STEP * 1000 / clipSpeed));
  };
  const playClip = (c, startIdx = 0) => {
    if (!c || !c.frames || !c.frames.length) return;
    stopClipPlayback();
    activeClip = c;
    currentFrameIdx = startIdx;
    updateActiveChip(c.idx);
    showClipFrame(c, currentFrameIdx);
    const btn = $('#clip-play', page);
    if (btn) btn.textContent = '❚❚ 一時停止';

    startClipTimer();
  };

  if (!clips || clips.length === 0) {
    if (clipBox) clipBox.innerHTML = '<div class="muted clip-empty">この試合には場面クリップがありません</div>';
  } else {
    if (clipBox) {
      clipBox.innerHTML = `
        <div class="clip-box-title">場面クリップ（${Math.round(1 / CLIP.STEP)}fps・前後数秒）</div>
        <div class="clip-chips">
          ${clips.map(c => `
            <button type="button" class="clip-chip" data-idx="${c.idx}">
              ${relT(c.t)} ${CLIP_KIND_JA[c.kind] || c.kind}${c.events && c.events.length > 1 ? ' ほか' : ''}
            </button>
          `).join('')}
        </div>
        <div class="clip-controls">
          <button id="clip-play" class="btn btn-sm" type="button">▶ 再生</button>
          <button id="clip-prev" class="btn btn-sm" type="button" title="1コマ戻る">◀</button>
          <button id="clip-next" class="btn btn-sm" type="button" title="1コマ進む">▶</button>
          <input type="range" id="clip-seek" class="clip-seek" min="0" max="${clips[0].frames.length - 1}" value="0">
          <select id="clip-speed" class="input-sm" title="再生速度"><option value="1">等倍</option><option value="0.5">1/2</option><option value="0.25">1/4</option></select>
          <span id="clip-stat" class="clip-stat"></span>
        </div>
      `;

      activeClip = clips[0];
      const initialSeek = $('#clip-seek', page);
      if (initialSeek) {
        initialSeek.max = clips[0].frames.length - 1;
        initialSeek.value = 0;
      }
      const initialStat = $('#clip-stat', page);
      if (initialStat && clips[0].frames.length > 0) {
        initialStat.textContent = `1/${clips[0].frames.length}枚 · ${mss1(clips[0].frames[0].t)}`;
      }

      page.querySelectorAll('.clip-chip').forEach(btn => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.idx);
          const c = clips.find(x => x.idx === idx);
          if (c) playClip(c, 0);
        };
      });

      const playBtn = $('#clip-play', page);
      if (playBtn) {
        playBtn.onclick = () => {
          if (!activeClip && clips.length > 0) {
            activeClip = clips[0];
            updateActiveChip(activeClip.idx);
          }
          if (!activeClip) return;
          if (clipTimer) {
            stopClipPlayback();
          } else {
            if (currentFrameIdx >= activeClip.frames.length - 1) {
              playClip(activeClip, 0);
            } else {
              playBtn.textContent = '❚❚ 一時停止';
              startClipTimer();
            }
          }
        };
      }

      const stepFrame = d => { if (!activeClip && clips.length) { activeClip = clips[0]; updateActiveChip(activeClip.idx); } if (!activeClip) return; stopClipPlayback(); currentFrameIdx = Math.max(0, Math.min(activeClip.frames.length - 1, currentFrameIdx + d)); showClipFrame(activeClip, currentFrameIdx); };
      $('#clip-prev', page).onclick = () => stepFrame(-1);
      $('#clip-next', page).onclick = () => stepFrame(1);
      $('#clip-speed', page).onchange = e => { clipSpeed = +e.target.value || 1; if (clipTimer) startClipTimer(); };
      const seekSlider = $('#clip-seek', page);
      if (seekSlider) {
        seekSlider.oninput = () => {
          stopClipPlayback();
          if (!activeClip && clips.length > 0) {
            activeClip = clips[0];
            updateActiveChip(activeClip.idx);
          }
          if (!activeClip) return;
          currentFrameIdx = Math.max(0, Math.min(activeClip.frames.length - 1, parseInt(seekSlider.value, 10)));
          showClipFrame(activeClip, currentFrameIdx);
        };
      }
    }
  }


  // D73: 録画（デスクトップ版）があれば、静止画・場面クリップの代わりに録画を見ながら確認・修正する。見ている時刻が「見逃しを追加」の時刻になる
  const rcd = (m.recording && window.inkgraphDesktop && Number.isFinite(m.recording.t0)) ? m.recording : null;
  const recBox = $('#rec-box', page), recHome = recBox.parentNode, recHomeNext = recBox.nextSibling;
  let recVideo = null, recKeyHandler = null, placeRec = () => {};
  const setVideoMode = on => { for (const sel of ['.review-video-wrap', '#still-cap', '#clip-box']) { const el = $(sel, page); if (el) el.style.display = on ? 'none' : ''; } recBox.style.display = on ? '' : 'none'; };
  const recSeekTo = (t, play) => { if (!recVideo) return; recVideo.currentTime = Math.max(0, t - rcd.t0); lastSeekTime = t; if (play) recVideo.play().catch(() => {}); };
  if (rcd) {
    recBox.innerHTML = `<div class="muted" style="font-size:var(--fs-xs);margin-bottom:4px">${esc(rcd.file || '')}</div>
      <video id="rec-video" controls preload="metadata" src="rec://local/${encodeURIComponent(rcd.path)}" style="width:100%;background:#000;border-radius:6px"></video>
      <div class="rec-controls" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">
        <button class="btn btn-sm rec-step" data-d="-5" type="button">−5秒</button><button class="btn btn-sm rec-step" data-d="-1" type="button">−1秒</button>
        <button class="btn btn-sm rec-step" data-d="1" type="button">+1秒</button><button class="btn btn-sm rec-step" data-d="5" type="button">+5秒</button>
        <select id="rec-speed" class="input-sm" title="再生速度"><option value="0.25">1/4</option><option value="0.5">1/2</option><option value="1" selected>等倍</option><option value="2">2倍</option></select>
        <span class="rec-add-wrap" title="いま見ている時刻に追加（キー: K／D／S）"><button class="btn btn-sm rec-add" data-k="kill" type="button">＋ キル</button><button class="btn btn-sm rec-add" data-k="death" type="button">＋ デス</button><button class="btn btn-sm rec-add" data-k="special" type="button">＋ スペシャル</button></span>
      </div>
      <div id="rec-cap" class="muted" style="margin-top:6px;font-size:var(--fs-xs)"></div>
      <div class="muted" style="font-size:var(--fs-xs)">キー: Space 再生/停止・←→ 1秒・, . 1コマ・K キー／D デス／S スペシャルを、いま見ている時刻に追加（レビューモード中）</div>`;
    recVideo = $('#rec-video', page); setVideoMode(true);
    // D79・D88: 録画は、通常モードでもレビューモードでも、タイムラインの上に置く（タイムラインのクリックで、その秒数の録画が見られる。見ながら直せる）
    placeRec = () => {
      if (!recVideo) return; const top = true, was = { t: recVideo.currentTime, playing: !recVideo.paused };
      const card = $('#rec-top-card', page), slot = $('#rec-top-slot', page);
      if (top) { slot.appendChild(recBox); card.style.display = ''; } else { recHome.insertBefore(recBox, recHomeNext && recHomeNext.parentNode === recHome ? recHomeNext : null); card.style.display = 'none'; }
      recBox.style.display = ''; $('#detail-body', page).classList.add('has-rec'); { const rt = $('#rv-title', page); if (rt) rt.textContent = '確認・修正'; } // D89: 録画があるときは、上段＝録画｜出来事（｜確認パネル）、下段＝タイムライン
      if (Number.isFinite(was.t) && Math.abs(recVideo.currentTime - was.t) > 0.3) recVideo.currentTime = was.t; // 付け替えで位置が戻ることがあるので、直す
      if (was.playing) recVideo.play().catch(() => {});
    };
    // 以前の録画（断片化したまま）は、他のプレーヤーでシークできない。シークできる形式に変換するボタン
    if (rcd.remuxed !== true) {
      const note = document.createElement('div'); note.className = 'muted'; note.id = 'rec-repair'; note.style.cssText = 'font-size:var(--fs-xs);margin-top:6px';
      note.innerHTML = 'この録画は、他のプレーヤーでシークできない形式です。 <button class="btn btn-sm" id="rec-repair-btn" type="button">シークできる形式に変換</button> <span id="rec-repair-msg"></span>';
      recBox.appendChild(note);
      $('#rec-repair-btn', page).onclick = async () => {
        const msg = $('#rec-repair-msg', page), btn = $('#rec-repair-btn', page); btn.disabled = true; msg.textContent = '変換中…（再エンコードはしません）';
        const r = await window.inkgraphDesktop.recRepair(rcd.path).catch(e => ({ ok: false, reason: String(e) }));
        if (r.ok) { m.recording.remuxed = true; if (r.bytes) m.recording.bytes = r.bytes; await db.putMatch(m); const pos = recVideo.currentTime; recVideo.src = `rec://local/${encodeURIComponent(rcd.path)}?v=${Date.now()}`; recVideo.onloadedmetadata = () => { recVideo.currentTime = pos; }; note.remove(); }
        else { msg.textContent = '変換できませんでした（' + (r.reason === 'no-ffmpeg' ? 'ffmpeg が見つかりません' : r.reason === 'not-found' ? '録画ファイルが見つかりません' : '変換に失敗') + '）'; btn.disabled = false; }
      };
    }
    const cap = $('#rec-cap', page);
    recVideo.ontimeupdate = () => { const t = rcd.t0 + recVideo.currentTime; lastSeekTime = t; cap.textContent = `${mss1(t)}（バトル開始から）`; if (tlEl && tlEl.setPlayhead) tlEl.setPlayhead(t); };
    recVideo.onloadedmetadata = () => { recSeekTo(Math.max(rcd.t0, m.battle[0]), false); };
    recVideo.onerror = () => { recVideo = null; $('#detail-body', page).classList.remove('has-rec'); { const rt = $('#rv-title', page); if (rt) rt.textContent = '確認用の映像'; } $('#rec-top-card', page).style.display = 'none'; setVideoMode(false); recBox.style.display = ''; recBox.innerHTML = '<div class="muted">録画ファイルを開けません（移動・削除された可能性があります）。静止画で確認します。</div>'; showStill(lastSeekTime, Infinity); };
    page.querySelectorAll('.rec-add').forEach(b => { b.onclick = () => page.querySelector(`.review-panel .add[data-k="${b.dataset.k}"]`)?.click(); }); // D96: レビューモードで、録画の下から、いま見ている時刻にキル・デス・スペシャルを追加
    page.querySelectorAll('.rec-step').forEach(b => { b.onclick = () => { if (!recVideo) return; recVideo.pause(); recVideo.currentTime = Math.max(0, recVideo.currentTime + parseFloat(b.dataset.d)); }; });
    $('#rec-speed', page).onchange = e => { if (recVideo) recVideo.playbackRate = +e.target.value; };
    recKeyHandler = e => {
      if (!recVideo || e.target.closest?.('input, select, textarea, button, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); recVideo.paused ? recVideo.play() : recVideo.pause(); }
      else if (k === 'arrowleft') { e.preventDefault(); recVideo.currentTime = Math.max(0, recVideo.currentTime - (e.shiftKey ? 5 : 1)); }
      else if (k === 'arrowright') { e.preventDefault(); recVideo.currentTime += e.shiftKey ? 5 : 1; }
      else if (k === ',') { recVideo.pause(); recVideo.currentTime = Math.max(0, recVideo.currentTime - 1 / 60); }
      else if (k === '.') { recVideo.pause(); recVideo.currentTime += 1 / 60; }
      else if (reviewMode && ['k', 'd', 's'].includes(k)) page.querySelector(`.add[data-k="${{ k: 'kill', d: 'death', s: 'special' }[k]}"]`)?.click();
    };
    document.addEventListener('keydown', recKeyHandler);
    placeRec();
  }

  const showStill = (t, near = 15) => {
    stopClipPlayback();
    if (!stills.length) { stillCap.textContent = ''; showEmpty('静止画なし（この試合では静止画が保存されていません）'); return; }
    let best = stills[0];
    for (const s of stills) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    const d = Math.abs(best.t - t);
    if (d > near) { stillCap.textContent = `最も近い静止画は ${mss(best.t)}（対象から ±${d.toFixed(1)}秒）`; showEmpty(`静止画なし（${mss(t)} の近くには静止画がありません）`); return; }
    if (clipUrl) { URL.revokeObjectURL(clipUrl); clipUrl = null; }
    if (stillUrl) URL.revokeObjectURL(stillUrl);
    stillUrl = URL.createObjectURL(best.blob);
    stillImg.onerror = () => { stillCap.textContent = ''; showEmpty('静止画なし（静止画を表示できません）'); };
    stillImg.onload = () => { stillEmpty.style.display = 'none'; stillImg.style.display = 'block'; };
    stillImg.src = stillUrl;
    stillCap.textContent = `最も近い静止画 ${mss(best.t)}（対象から ±${d.toFixed(1)}秒） · ${KIND_JA[best.kind] || best.kind || '静止画'}${best.reason ? ' / ' + best.reason : ''}`;
  };

  const seek = (t, opts) => {
    lastSeekTime = t;
    if (recVideo) { recSeekTo(opts && opts.exact ? t : t - 2, true); lastSeekTime = t; return; } // 録画: 出来事は 2 秒前から再生。タイムラインの空き（時刻の指定）はその秒数から再生
    const clip = clipAt(clips, t);
    if (clip) {
      playClip(clip, 0);
      return;
    }
    stopClipPlayback();
    showStill(t);
    if (tlEl && tlEl.setPlayhead) tlEl.setPlayhead(t);
  };

  // D78: 採用しなかった候補。検知できなかった出来事（足りないデス等）の場所を探すための目星。録画の該当箇所を見て、あれば追加、無ければ見送る
  const CAND_KINDS = [['death', 'デス'], ['special', 'スペシャル発動'], ['kill', 'キル']];
  const SIG_JA = { sig: '「やられた」表示', hud: 'HUD の自分アイコン×', killer: '倒した相手の吹き出し', notice: 'キル通知', notice_soft: '弱いキル通知', enemy: '敵アイコン×' };
  const SRC_JA = { signal_soft: '「やられた」が弱い', hud_soft: 'HUD の自分アイコンだけ' };
  const candTime = (kind, c) => (kind === 'special' ? c.end : c.start);
  const candKey = (kind, c) => `${kind}@${candTime(kind, c).toFixed(1)}`;
  const candAdded = (kind, c) => (m.review.added || []).some(a => a.kind === kind && Math.abs(a.t - candTime(kind, c)) <= 1.5);
  const candDismissed = (kind, c) => (m.review.cand_dismissed || []).includes(candKey(kind, c));
  let candShowAll = false, candShowDismissed = false, candOnTL = reviewMode; // D88: タイムラインに補正候補を出すか（レビューモードに入ると自動でオン。あとは自分でオン・オフ）
  const visibleCands = () => { const out = []; for (const [k] of CAND_KINDS) for (const c of ((m.cands || {})[k] || [])) if (!candAdded(k, c) && !candDismissed(k, c)) out.push({ kind: k, t: candTime(k, c), from: k === 'special' ? c.ready : undefined, conf: c.conf }); return out; };
  const candDraw = () => {
    const host = $('#cand-list', page), hint = $('#cand-hint', page); if (!host) return;
    if (!m.cands) { hint.textContent = ''; host.innerHTML = '<div class="muted">この試合は、候補を保存する前の解析なので、候補はありません。</div>'; return; }
    const eff = effective(m), cnt = k => eff.filter(e => e.kind === k).length, r = resultOf(m), L = [];
    const gap = (lab, target, k) => { if (!Number.isInteger(target)) return; const n = cnt(k), d = target - n; L.push(`${lab}: リザルト画面 ${target}／いまの記録 ${n} → ${d > 0 ? `<strong>あと ${d} 件足りません</strong>` : d < 0 ? `<strong>${-d} 件多い</strong>（誤検出の可能性。出来事の ✗ で外せます）` : '一致'}`); };
    gap('デス', r.deaths, 'death'); gap('スペシャル発動', r.specials, 'special');
    if (Number.isInteger(r.ka)) L.push(`キル: K+A ${r.ka}／いまの記録 ${cnt('kill')}（アシスト込みなので、少なくても不足とは限りません${cnt('kill') > r.ka ? '。<strong>K+A を超えています</strong>' : ''}）`);
    hint.innerHTML = L.join('<br>') || 'リザルト画面の数を読めていないので、足りない数は分かりません。';
    const sigText = c => [...(c.sigs || []).map(x => SIG_JA[x] || x), ...(c.src && !(c.sigs || []).length ? [SRC_JA[c.src] || c.src] : [])].join('・') || '信号が弱い';
    let html = '';
    for (const [k, lab] of CAND_KINDS) {
      let list = ((m.cands || {})[k] || []).filter(c => candShowDismissed || !candDismissed(k, c)).sort((a, b) => b.conf - a.conf);
      if (!list.length) { html += `<div class="review-section-title" style="margin-top:8px">${lab}</div><div class="muted" style="font-size:var(--fs-xs)">候補なし</div>`; continue; }
      const total = list.length; if (!candShowAll) list = list.slice(0, 6);
      html += `<div class="review-section-title" style="margin-top:8px">${lab}（確信度の高い順）</div>` + list.map(c => {
        const added = candAdded(k, c), dis = candDismissed(k, c), t = candTime(k, c);
        return `<div class="cand-row" data-kind="${k}" data-t="${t}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:3px 0;opacity:${dis ? 0.5 : 1}">
          <span class="num" style="min-width:44px">${mss1(t)}</span><span class="muted" style="font-size:var(--fs-xs);min-width:40px">${Math.round(c.conf * 100)}%</span>
          <span class="muted" style="font-size:var(--fs-xs);flex:1;min-width:120px">${esc(sigText(c))}</span>
          <button class="btn btn-sm cand-see" type="button">見る</button>
          ${added ? '<span class="muted">追加済み</span>' : dis ? '<button class="btn btn-sm cand-undismiss" type="button">戻す</button>' : '<button class="btn btn-sm cand-add" type="button">＋ 追加</button><button class="btn btn-sm cand-dismiss" type="button">見送る</button>'}
        </div>`;
      }).join('') + (total > 6 && !candShowAll ? `<div class="muted" style="font-size:var(--fs-xs)">ほか ${total - 6} 件</div>` : '');
    }
    html += `<div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;font-size:var(--fs-xs)"><label><input type="checkbox" id="cand-all" ${candShowAll ? 'checked' : ''}> すべて表示</label><label><input type="checkbox" id="cand-dis" ${candShowDismissed ? 'checked' : ''}> 見送った候補も表示</label></div>
      <div class="muted" style="font-size:var(--fs-xs);margin-top:4px">タイムラインの点線の丸（？）が候補です。録画で確かめて、あれば「追加」、無ければ「見送る」。追加すると、時刻つきの正解データになります。</div>`;
    host.innerHTML = html;
    host.querySelectorAll('.cand-row').forEach(row => {
      const k = row.dataset.kind, t = +row.dataset.t, c = ((m.cands || {})[k] || []).find(x => Math.abs(candTime(k, x) - t) < 1e-6);
      $('.cand-see', row).onclick = () => seek(t);
      const add = $('.cand-add', row); if (add) add.onclick = async () => { m.review.added.push({ kind: k, t: Math.round(t * 10) / 10, cand: { conf: c.conf, src: c.src ?? null, sigs: c.sigs ?? null } }); await save(); refresh(); };
      const dis = $('.cand-dismiss', row); if (dis) dis.onclick = async () => { m.review.cand_dismissed.push(candKey(k, c)); await save(); refresh(); };
      const und = $('.cand-undismiss', row); if (und) und.onclick = async () => { m.review.cand_dismissed = m.review.cand_dismissed.filter(x => x !== candKey(k, c)); await save(); refresh(); };
    });
    $('#cand-all', host).onchange = e => { candShowAll = e.target.checked; candDraw(); };
    $('#cand-dis', host).onchange = e => { candShowDismissed = e.target.checked; candDraw(); };
  };

  const drawTL = (opts = {}) => {
    tlEl = renderTimeline(m, {
      reviewMode,
      cands: candOnTL ? visibleCands() : null,
      onSeek: seek,
      // ヤグラ保持ラベル / カウント点の変更: 保存して帯を描き直す（カウント追加・削除ではポップオーバーを開いたままにする）
      onReviewChange: async ({ reopen, focus }) => { await save(); drawTL({ reopen, focus }); },
    });
    $('#tl', page).replaceChildren(tlEl);
    if (opts.reopen) tlEl.openPopover(opts.reopen);
    else if (opts.focus) tlEl.focusSegment(opts.focus);
  };
  { const ct = $('#cand-tl', page); if (ct) { ct.checked = candOnTL; ct.onchange = () => { candOnTL = ct.checked; drawTL(); }; } }
  { if (window.__tlResize) window.removeEventListener('resize', window.__tlResize); let rt = null, lastW = $('#tl', page)?.clientWidth || 0; window.__tlResize = () => { clearTimeout(rt); rt = setTimeout(() => { const w = $('#tl', page)?.clientWidth || 0; if (currentPage === 'match' && w && Math.abs(w - lastW) > 24) { lastW = w; drawTL(); } }, 250); }; window.addEventListener('resize', window.__tlResize); } // D89: タイムラインは、幅に合わせて描き直す

  const accDraw = () => {
    const a = accuracy([m]);
    $('#acc', page).innerHTML = accTable(a);
  };

  let stageNote = '', stageOther = false; // D92: ステージの訂正（選ぶと、見本に登録する）
  const rtab = () => {
    const rs = m.result_screen || {}, own = rs.own || {};
    const det = {
      result: rs.result,
      mode: rs.mode,
      stage: rs.stage,
      ka: own.ka,
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
              ${k === 'stage' && (mk === 'wrong' || !det.stage) && !stageOther && !(m.review.fix.stage && !STAGES.includes(m.review.fix.stage)) ? `<select class="input-sm" data-stage-sel title="正しいステージを選ぶと、この端末の見本に登録して、次の解析から読めるようになります"><option value="">ステージを選ぶ…</option>${STAGES.map(n => `<option value="${esc(n)}" ${m.review.fix.stage === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__other__">その他（入力）…</option></select>${stageNote ? `<div class="muted" style="font-size:11px;margin-top:2px;max-width:220px">${esc(stageNote)}</div>` : ''}` : mk === 'wrong' ? `<input class="input-sm" size="8" data-fix="${k}" ${k === 'mode' ? 'list="rule-names"' : ''} value="${esc(m.review.fix[k] ?? '')}" placeholder="${k === 'result' ? 'WIN/LOSE' : '正しい値'}">${k === 'mode' ? '<datalist id="rule-names"><option value="ガチエリア"><option value="ガチヤグラ"><option value="ガチホコバトル"><option value="ガチアサリ"></datalist>' : ''}` : ''}
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
        if (['ka', 'deaths', 'specials'].includes(f)) v = v === '' || !Number.isFinite(+v) ? undefined : Math.max(0, Math.round(+v));
        if (f === 'result') v = /^w|勝/i.test(v) ? 'WIN' : /^l|負/i.test(v) ? 'LOSE' : v;
        m.review.fix[f] = v;
        await save();
        if (['ka', 'deaths', 'specials'].includes(f)) { rtab(); refresh(); }
      };
    });

    const ss = $('#rtab', page).querySelector('select[data-stage-sel]');
    if (ss) ss.onchange = async () => {
      const v = ss.value; if (!v) return;
      if (v === '__other__') { stageOther = true; m.review.rmarks.stage = 'wrong'; rtab(); return; }
      m.review.rmarks.stage = 'wrong'; m.review.fix.stage = v;
      const r = StageLib.addFromMatch(v, m, resultOf(m).mode);
      stageNote = r.ok ? `見本に登録しました（${v}・${StageLib.countOf(v)}枚）。次の解析から、読めるようになります` : r.reason === 'no-feats' ? 'この試合は、見本の素を残す前の解析なので、見本にはできません（ステージの訂正だけ記録しました）' : r.reason === 'no-mode' ? 'ルールが分からず、見本にできません。先に「ルール」を直してください' : r.reason === 'dup' ? 'この見本は、登録済みです' : '';
      await save(); rtab(); accDraw();
    };
  };

  // D91: レビューモードでは、ヘッダーの数字の下に、結果画面の読み取り値を並べる（見比べながら足していく）。キルは K+A なので、検出が K+A を超えたときだけ赤。デス・スペシャルは、違えば赤・同じなら緑
  const hdrRes = (effList = effective(m)) => {
    const r = resultOf(m), cnt = k => effList.filter(e => e.kind === k).length;
    const set = (id, val, label, bad, tip) => { const el = $(id, page); if (!el) return; if (!Number.isInteger(val)) { el.textContent = ''; el.hidden = true; return; } el.hidden = false; el.textContent = label.replace('{v}', val); el.title = tip; el.classList.toggle('res-bad', bad); el.classList.toggle('res-ok', !bad); };
    set('#hdr-res-k', r.ka, 'リザルト K+A {v}', cnt('kill') > r.ka, 'リザルト画面の K+A（キル＋アシスト）。検出したキルが、これを超えていたら赤');
    set('#hdr-res-d', r.deaths, 'リザルト {v}', cnt('death') !== r.deaths, 'リザルト画面のデス数');
    set('#hdr-res-sp', r.specials, 'リザルト {v}', cnt('special') !== r.specials, 'リザルト画面のスペシャル発動数');
  };
  const etab = () => {
    const det = detected(m);
    const add = (m.review.added || []).map((a, i) => ({ ...a, addedIdx: i }));
    const effList = effective(m);
    const effMap = new Map(effList.map(e => [e.added ? 'a' + e.t + e.kind : e.key, e]));

    // Update header K/D/SP counts after review edits
    $('#hdr-k', page).textContent = effList.filter(e => e.kind === 'kill').length;
    { const ka = $('#hdr-ka', page); if (ka) ka.textContent = assistText(assistEstimate(resultOf(m).ka, effList.filter(e => e.kind === 'kill').length)); }
    $('#hdr-d', page).textContent = effList.filter(e => e.kind === 'death').length;
    $('#hdr-sp', page).textContent = effList.filter(e => e.kind === 'special').length;
    hdrRes(effList);

    const allRows = [
      ...det.map(e => ({ ...e, isAdded: false })),
      ...add.map(a => ({ ...a, isAdded: true }))
    ].sort((a, b) => a.t - b.t);

    const spInts = specialIntervals(m);
    const unusedInts = spInts.filter(si => si.outcome === 'unused_at_end');
    const unusedRowHtml = unusedInts.length ? (() => {
      const lastUnused = unusedInts[unusedInts.length - 1];
      return `<tr class="sp-unused-end-row click" data-t="${lastUnused.end}">
        <td class="num">${mss(lastUnused.end - t0)}</td>
        <td>スペシャル未使用のまま終了</td>
        <td>—</td>
        <td class="num count-zero">—</td>
        <td><span class="num delta-zero">—</span></td>
        <td class="col-review-only"></td>
      </tr>`;
    })() : '';

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
          const kindText = KINDS[e.kind] + (e.kind !== 'special' && e.outcome ? `（${SP_LABEL[e.outcome]}）` : '') + (e.isAdded ? '（見逃し追加）' : '') + (e.src && e.src.auto ? (e.src.auto === 'fused' ? '（自動採用）' : '（自動補正）') : '');
          let extraBadge = '';
          if (e.src && typeof e.src.conf === 'number' && e.src.conf < 0.45 && e.src.auto !== 'added') extraBadge += ' <span class="badge" title="検出の確信度が低いです（複数の信号が一致していません）" style="margin-left:4px;font-size:11px">確信度 低</span>';
          if (e.kind === 'death') {
            const isWasted = spInts.some(si => si.outcome === 'lost_on_death' && Math.abs(e.t - si.end) <= 1.0);
            if (isWasted) extraBadge = ' <span class="badge sp-wasted-badge" style="background:var(--special-wasted);color:var(--text);margin-left:4px;font-size:11px">スペシャル未使用</span>';
          }

          const reviewCell = e.isAdded
            ? `<button class="mk rm" data-i="${e.addedIdx}" type="button">取り消す</button>`
            : ['ok', 'wrong', 'deleted'].map(v =>
                `<button class="mk ${e.mark === v ? 'on-' + v : ''}" data-key="${e.key}" data-v="${v}" data-t="${e.t}" type="button">${{ ok: '✓', wrong: '✗', deleted: '削除' }[v]}</button>`
              ).join('');

          return `<tr class="${rowClasses.join(' ')}" data-t="${e.t}">
            <td class="num">${mss(e.t - t0)}</td>
            <td>${kindIcon}${esc(kindText)}${extraBadge}</td>
            <td>${phaseBadge(x.phase)}</td>
            <td class="num ${diffCls(x.count_diff)}">${fmtDiff(x.count_diff)}</td>
            <td>${deltaCellHtml(x.wp_delta)}</td>
            <td class="col-review-only">${reviewCell}</td>
          </tr>`;
        }).join('')}${unusedRowHtml}
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
      const t = Math.round(lastSeekTime * 10) / 10;
      m.review.added.push({ kind: b.dataset.k, t });
      await save();
      refresh();
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
    candDraw();
  };

  rtab();
  refresh();
  if (!recVideo) showStill(lastSeekTime, Infinity);

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
  const allMs = await db.allMatches();
  const verifyCount = allMs.filter(isVerificationMatch).length;
  const ms = ownMatches(allMs);

  const currentFilter = parseTrendFilter(location.hash);
  lastTrendQuery = trendFilterToQuery(currentFilter);
  const currentHash = 'trend?' + lastTrendQuery;
  if (location.hash.slice(1) !== currentHash && currentPage === 'trend') {
    history.replaceState(null, '', '#' + currentHash);
  }

  const filtered = filterTrendMatches(ms, currentFilter);
  const page = document.createElement('div');

  const matchTypePills = MATCH_TYPE_OPTIONS.map(opt => `
    <button type="button" class="trend-pill" data-match-type="${opt.value}" aria-pressed="${currentFilter.matchType === opt.value ? 'true' : 'false'}">${opt.label}</button>
  `).join('');

  const rulePills = RULE_OPTIONS.map(opt => `
    <button type="button" class="trend-pill" data-rule="${opt.value}" aria-pressed="${currentFilter.rule === opt.value ? 'true' : 'false'}">${opt.label}</button>
  `).join('');

  const pb = powerBreakdown(filtered);
  const powerBreakdownHtml = pb.excluded > 0 ? `
    <details class="trend-power-breakdown">
      <summary>パワーの対象外・未取得の内訳</summary>
      <div>対象外（ナワバリバトルなど）${pb.notApplicable}件／未取得（取得できなかった試合）${pb.notAcquired}件</div>
    </details>
  ` : '';

  const filterHeaderHtml = `
    <section class="trends-filter">
      <div class="trends-filter-row">
        <span class="trends-filter-label">マッチタイプ</span>
        <div class="trends-filter-pills">${matchTypePills}</div>
      </div>
      <div class="trends-filter-row">
        <span class="trends-filter-label">ルール</span>
        <div class="trends-filter-pills">${rulePills}</div>
      </div>
    </section>
    <div class="trend-target-line">
      <span>対象 ${filtered.length}試合（全体${ms.length}試合）</span>
      ${powerBreakdownHtml}
    </div>
  `;

  const attachFilterListeners = root => {
    root.querySelectorAll('.trend-pill[data-match-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mt = btn.dataset.matchType;
        const nextFilter = { ...currentFilter, matchType: mt };
        lastTrendQuery = trendFilterToQuery(nextFilter);
        history.replaceState(null, '', '#trend?' + lastTrendQuery);
        PAGES.trend();
      });
    });
    root.querySelectorAll('.trend-pill[data-rule]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = btn.dataset.rule;
        const nextFilter = { ...currentFilter, rule: r };
        lastTrendQuery = trendFilterToQuery(nextFilter);
        history.replaceState(null, '', '#trend?' + lastTrendQuery);
        PAGES.trend();
      });
    });
    const resetBtn = root.querySelector('#trend-reset-filter');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        lastTrendQuery = trendFilterToQuery({ matchType: 'all', rule: 'all' });
        history.replaceState(null, '', '#trend?' + lastTrendQuery);
        PAGES.trend();
      });
    }
  };

  if (!filtered.length) {
    page.innerHTML = `
      <div class="page-header"><h1 class="page-title">傾向分析</h1></div>
      ${filterHeaderHtml}
      <div class="card trend-empty-filtered">
        <div class="empty-state">
          <p style="font-weight:var(--fw-bold);font-size:var(--fs-md);margin-bottom:var(--sp-2)">この条件の試合はまだありません</p>
          <p class="muted" style="margin-bottom:var(--sp-4)">マッチタイプとルールを変えると、記録済みの試合から集計します</p>
          <button class="btn btn-primary" id="trend-reset-filter" type="button">条件をすべてに戻す</button>
          ${!ms.length ? `<button class="btn" id="trend-empty-btn" type="button" style="margin-left:var(--sp-3)">試合一覧へ</button>` : ''}
        </div>
      </div>`;
    mountPage(page, false);
    attachFilterListeners(page);
    const emptyBtn = $('#trend-empty-btn', page);
    if (emptyBtn) emptyBtn.onclick = () => nav('list');
    return;
  }

  const R = filtered.map((m, idx) => ({ m, idx, r: resultOf(m), ev: effective(m) }));
  const known = R.filter(x => x.r.result === 'WIN' || x.r.result === 'LOSE');
  const unknown = R.length - known.length;
  const wins = known.filter(x => x.r.result === 'WIN').length;
  const losses = known.length - wins;
  const cnt = (x, k) => x.ev.filter(e => e.kind === k).length;
  const sum = k => R.reduce((s, x) => s + cnt(x, k), 0);
  const spStatsList = filtered.map(m => specialStats(m));
  const totActivated = spStatsList.reduce((s, x) => s + x.activated, 0);
  const totReadySec = spStatsList.reduce((s, x) => s + x.readySeconds, 0);
  const avgReadySec = filtered.length ? Math.round(totReadySec / filtered.length) : 0;
  const totLost = spStatsList.reduce((s, x) => s + x.lost, 0);
  const unusedEndMatches = spStatsList.filter(x => x.unusedEnd > 0).length;
  const totReadyCount = spStatsList.reduce((s, x) => s + x.readyCount, 0);
  const wastedRatePct = pct(totReadyCount > 0 ? totLost / totReadyCount : null);

  const deaths = R.flatMap(x => x.ev.filter(e => e.kind === 'death').map(e => ({ ...e, x })));
  const kills = R.flatMap(x => x.ev.filter(e => e.kind === 'kill').map(e => ({ ...e, x })));

  // 母数バナーと勝率表示
  const tier = sampleTier(filtered.length);
  let bannerHtml = '';
  if (tier.key === 'insufficient') {
    bannerHtml = `<div class="trend-sample-banner">対象が ${filtered.length} 件のため、傾向としてはまだ読めません。数字は記録の合計です</div>`;
  } else if (tier.key === 'reference') {
    bannerHtml = `<div class="trend-sample-banner">対象 ${filtered.length} 件のため参考値です</div>`;
  }

  let winrateValHtml = '';
  if (tier.key === 'insufficient') {
    winrateValHtml = `<span class="stat-value-2xl num">—</span>`;
  } else if (tier.key === 'reference') {
    winrateValHtml = `<span class="stat-value-2xl num trend-winrate-muted">${pct(known.length ? wins / known.length : null)}</span>`;
  } else {
    winrateValHtml = `<span class="stat-value-2xl num">${pct(known.length ? wins / known.length : null)}</span>`;
  }

  // 2. Winrate progression SVG (height 220px)
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
        const col = p.x.r.result === 'WIN' ? 'var(--win)' : (p.x.r.result === 'LOSE' ? 'var(--lose)' : 'var(--text-faint)');
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

  // Xパワーの推移カード（空状態）: matchType が all または x のときのみ表示
  const showXPower = currentFilter.matchType === 'all' || currentFilter.matchType === 'x';
  const xPowerCardHtml = showXPower ? `
    <div class="card trend-xpower-card" style="margin-bottom:var(--sp-6)">
      <div class="card-title">Xパワーの推移</div>
      <div class="empty-state">
        <p style="font-weight:var(--fw-bold);font-size:var(--fs-md);margin-bottom:var(--sp-2)">Xパワーはまだ記録されていません</p>
        <p class="muted">Xマッチの試合を記録すると、ここにパワーの推移が出ます</p>
      </div>
    </div>
  ` : '';

  // 3. Diverging bars: by phase & by count-diff (7 buckets)
  const kdText = (k, d) => (d === 0 ? '—' : (k / d).toFixed(2));
  const byPhase = ['抑え', '打開', '互角'].map(p => {
    const dList = deaths.filter(e => (e.phase || '互角') === p);
    const kList = kills.filter(e => (e.phase || '互角') === p);
    const loss = dList.reduce((s, e) => s + Math.min(0, e.wp_delta || 0), 0);
    const total = kList.length + dList.length;
    const insufficient = total < 5;
    return {
      p,
      d: dList.length,
      k: kList.length,
      total,
      insufficient,
      kd: insufficient ? '—' : kdText(kList.length, dList.length),
      empty: !kList.length && !dList.length,
      loss: insufficient ? null : loss
    };
  });
  const maxPhaseCnt = Math.max(1, ...byPhase.map(x => Math.max(x.d, x.k)));

  const sevenBuckets = BUCKETS.filter(b => b !== 'カウント不明');
  const byB = sevenBuckets.map(b => {
    const d = deaths.filter(e => countBucket(e.count_diff) === b).length;
    const k = kills.filter(e => countBucket(e.count_diff) === b).length;
    return { b, d, k, kd: kdText(k, d), empty: !k && !d };
  });
  const maxBucketCnt = Math.max(1, ...byB.map(x => Math.max(x.d, x.k)));

  // ステージ×ルールの成績
  const rawStageRows = stageRuleRows(filtered);
  const sortedStageRows = sortStageRows(rawStageRows, trendStageSort.key, trendStageSort.dir);

  const stageSortArrow = k => trendStageSort.key === k ? (trendStageSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const sortBtn = (k, label) => `<button type="button" class="trend-stage-sort" data-sort-key="${k}">${label}${stageSortArrow(k)}</button>`;

  const stageRowsHtml = sortedStageRows.map(r => {
    const isLow = r.n < 5;
    let winRateCell = '';
    if (isLow) {
      winRateCell = `—（${r.n}試合）`;
    } else {
      let badgeHtml = '';
      if (r.badge === '得意') {
        badgeHtml = ` <span class="trend-stage-badge-ally">得意</span>`;
      } else if (r.badge === '苦手') {
        badgeHtml = ` <span class="trend-stage-badge-enemy">苦手</span>`;
      }
      winRateCell = `${pct(r.winRate)}${badgeHtml}`;
    }
    const kdStr = r.kd != null ? r.kd.toFixed(2) : '—';
    return `
      <tr class="${isLow ? 'trend-stage-low' : ''}">
        <td>${esc(r.stage)}</td>
        <td>${esc(r.rule)}</td>
        <td class="num">${r.n}</td>
        <td class="num">${r.wins}勝${r.losses}敗</td>
        <td class="num">${winRateCell}</td>
        <td class="num">${r.killsPer.toFixed(1)}</td>
        <td class="num">${r.deathsPer.toFixed(1)}</td>
        <td class="num">${kdStr}</td>
        <td class="num">${r.specialsPer.toFixed(1)}</td>
      </tr>
    `;
  }).join('');

  const stageCardHtml = `
    <div class="card trend-stage-card" style="margin-bottom:var(--sp-6)">
      <div class="card-title">ステージとルールの成績</div>
      <div style="overflow-x:auto">
        <table class="table trend-stage-table">
          <thead>
            <tr>
              <th>${sortBtn('stage', 'ステージ')}</th>
              <th>${sortBtn('rule', 'ルール')}</th>
              <th>${sortBtn('n', '試合数')}</th>
              <th>${sortBtn('record', '勝敗')}</th>
              <th>${sortBtn('winRate', '勝率')}</th>
              <th>${sortBtn('killsPer', 'キル')}</th>
              <th>${sortBtn('deathsPer', 'デス')}</th>
              <th>${sortBtn('kd', 'キル÷デス')}</th>
              <th>${sortBtn('specialsPer', 'スペシャル発動')}</th>
            </tr>
          </thead>
          <tbody>${stageRowsHtml}</tbody>
        </table>
      </div>
      <div class="trend-stage-note" style="margin-top:var(--sp-3);font-size:var(--fs-xs);color:var(--text-muted)">5試合未満の行は参考になりません。表示は記録の確認用です</div>
    </div>
  `;

  const PRESENCE_KIND_LABEL = {
    main: 'メイン',
    unknown: '未登録',
    ambiguous: '区別不可'
  };

  const enemyIconLib = WL.combinedLib(await getEnemyIconLib()); // 静的な見本＋この端末で名前を付けた見本（D65）
  const userTypeMap = WL.userTypes();
  // D65: 結果画面ボードのブキアイコン（敵・味方・自分）から「そのブキがいた試合」の勝敗を出す。武器別。全体の勝率との差が小さい（負けやすい）順に見られるよう「全体との差」を付ける
  const presenceCard = (title, stats, noteLines) => {
    const noteHtml = `<div class="trend-stage-note trend-weapon-note" style="margin-top:var(--sp-3);font-size:var(--fs-xs);color:var(--text-muted)">${noteLines.map(l => `<div>${l}</div>`).join('')}<div>名前が付いた枠 ${stats.namedSlots}/${stats.totalSlots}</div></div>`;
    if (stats.withIcons === 0) return `<div class="card trend-weapon-card trend-presence-card" style="margin-bottom:var(--sp-6)"><div class="card-title">${esc(title)}</div><div class="empty-state"><p class="muted">まだ結果画面のアイコンを保存した試合がありません</p></div>${noteHtml}</div>`;
    const rowsHtml = stats.rows.map(r => {
      const kindLabel = r.kind === 'main' ? typeOfWeapon(r.name, userTypeMap) : (PRESENCE_KIND_LABEL[r.kind] || r.kind || '—'); // 種類（シューター等）は名前から自動で入る（D66）
      const winRateCell = r.low ? `${pct(r.winRate)}<span class="trend-weapon-low-note">（${r.matches}試合・少数）</span>` : pct(r.winRate);
      const dl = r.delta === null || r.delta === undefined ? '—' : `${r.delta > 0 ? '+' : ''}${Math.round(r.delta * 100)}pt`;
      return `<tr class="${r.low ? 'trend-stage-low' : ''}"><td>${esc(r.name)}</td><td>${esc(kindLabel)}</td><td class="num">${r.matches}</td><td class="num">${r.wins}勝${r.losses}敗</td><td class="num ${r.low ? 'muted' : ''}">${winRateCell}</td><td class="num ${r.low ? 'muted' : (r.delta < 0 ? 'neg' : '')}" ${r.delta !== null && r.delta < 0 && !r.low ? 'style="color:var(--lose)"' : ''}>${dl}</td></tr>`;
    }).join('');
    return `<div class="card trend-weapon-card trend-presence-card" style="margin-bottom:var(--sp-6)"><div class="card-title">${esc(title)}</div>
      <div style="overflow-x:auto"><table class="table trend-stage-table trend-weapon-table"><thead><tr><th>ブキ</th><th>種類</th><th>いた試合</th><th>勝敗</th><th>いた試合の勝率</th><th title="全試合の勝率との差。マイナスは、そのブキがいたとき負けやすい">全体との差</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${noteHtml}</div>`;
  };
  const NOTE_COMMON = ['結果画面のブキのアイコンを見本と照合した名前です。見本に無いアイコンは『未登録』としてまとめています（下の「名前を付ける」で登録できます）', 'リッター4K と 4Kスコープはアイコンでほぼ区別できないため 1 つにまとめています', '「全体との差」は、そのブキがいた試合の勝率と全試合の勝率の差です。5試合未満は参考になりません'];
  const presenceStats = enemyPresenceRows(filtered, enemyIconLib);
  const allyStats = enemyPresenceRows(filtered, enemyIconLib, { field: 'ally_icons', pick: it => !it.own });
  const ownStats = enemyPresenceRows(filtered, enemyIconLib, { field: 'ally_icons', pick: it => !!it.own });
  const enemyPresenceCardHtml = presenceCard('いた敵ブキ（結果画面のアイコン）', presenceStats, NOTE_COMMON)
    + presenceCard('いた味方ブキ（自分を除く）', allyStats, NOTE_COMMON.slice(0, 1).concat(['味方のアイコンは、このバージョン以降に記録した試合から貯まります']))
    + presenceCard('自分のブキ', ownStats, NOTE_COMMON.slice(0, 1).concat(['自分のブキは、結果画面のボードの自分の行のアイコンです']));
  // 未登録のアイコンに名前を付ける
  const unknownGroups = unknownIconGroups(filtered, enemyIconLib);
  const opts = weaponOptions(await getWeaponNames(), userTypeMap);
  const weaponNameSet = new Set([...WEAPON_TYPES, UNCLASSIFIED].flatMap(t => [...opts[t]]));
  const colorOf = new Map(); // D94: ブキの絵（グレー）→ 色つき版（解析のとき残した分）
  for (const mm of filtered) if (mm.icon_colors) for (const f of ['enemy_icons', 'ally_icons']) for (const it of mm[f] || []) if (it && it.icon && it.slot && mm.icon_colors[it.slot] && !colorOf.has(it.icon)) colorOf.set(it.icon, mm.icon_colors[it.slot]);
  const optionsHtml = [...WEAPON_TYPES, UNCLASSIFIED].filter(t => opts[t].length).map(t => `<optgroup label="${esc(t)}">${[...opts[t]].sort((x, y) => x.localeCompare(y, 'ja')).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>`).join('');
  const namingCardHtml = unknownGroups.length === 0 ? '' : `<div class="card trend-weapon-card" id="weapon-naming" style="margin-bottom:var(--sp-6)"><div class="card-title">未登録のブキアイコンに名前を付ける（${unknownGroups.length} 種類）</div>
      <p class="muted" style="font-size:var(--fs-xs)">絵を見て、「近いブキ」を押すか、ブキ名を入れて（文字を打つと候補が絞られます）選んでください（種類は自動で入ります）。この端末の見本に登録され、過去の試合にも反映されます（クラウド同期をしていれば他の端末にも届きます）。一覧に無いブキは「リストにない武器」を選んで、名前と種類を入れてください。</p>
      <datalist id="weapon-dl">${[...WEAPON_TYPES, UNCLASSIFIED].flatMap(t => [...opts[t]].map(n => `<option value="${esc(n)}">${esc(t)}</option>`)).join('')}</datalist>
      <div class="weapon-naming-list" style="display:flex;flex-direction:column;gap:var(--sp-3)">${unknownGroups.slice(0, 30).map((g, i) => { const near = nearestNames(enemyIconLib, g.rep, 3).filter(x => x.score >= 0.6); return `<div class="weapon-naming-row" data-i="${i}" style="display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap">
         <canvas class="weapon-icon-canvas" width="168" height="102" data-icon="${esc(g.rep)}" style="background:#000;border-radius:4px"></canvas>
         <div style="display:flex;flex-direction:column;gap:6px;min-width:260px">
           <span class="muted" style="font-size:var(--fs-xs)">${g.slots}枠・${g.matches}試合（敵 ${g.side.enemy}・味方 ${g.side.ally}）</span>
           ${near.length ? `<div class="weapon-near" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="muted" style="font-size:var(--fs-xs)">近いブキ:</span>${near.map(x => `<button class="btn btn-sm weapon-near-btn" type="button" data-name="${esc(x.name)}" title="似ている度 ${Math.round(x.score * 100)}%（見た目が近い順。違うこともあります）">${esc(x.name)} <span class="muted">${Math.round(x.score * 100)}%</span></button>`).join('')}</div>` : ''}
           <div style="display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap">
             <input class="input-sm weapon-name-input" list="weapon-dl" placeholder="ブキ名で探す（例: スプラ）" size="22" autocomplete="off">
             <select class="input-sm weapon-type-select" style="display:none">${[...WEAPON_TYPES, UNCLASSIFIED].map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
             <span class="weapon-type-auto muted" style="font-size:var(--fs-xs)"></span>
             <button class="btn btn-sm weapon-name-save" type="button" disabled>名前を付ける</button>
           </div>
         </div>
       </div>`; }).join('')}</div>${unknownGroups.length > 30 ? '<p class="muted" style="font-size:var(--fs-xs)">多い順に 30 種類まで出しています。名前を付けると次が出ます。</p>' : ''}</div>`;

  const WEAPON_KIND_LABEL = {
    main: 'メイン',
    special: 'スペシャル',
    sub: 'サブ',
    unknown: '未登録'
  };

  const weaponStats = enemyWeaponRows(filtered);
  let weaponBodyHtml = '';
  if (weaponStats.rows.length === 0) {
    weaponBodyHtml = `
      <div class="empty-state">
        <p class="muted">まだやられた相手のブキを読めたデスがありません</p>
      </div>
      <div class="trend-stage-note trend-weapon-note" style="margin-top:var(--sp-3);font-size:var(--fs-xs);color:var(--text-muted)">
        <div>デスしたときの吹き出し（「〇〇 で やられた!」）から読んだ名前です。読めたデス ${weaponStats.readDeaths}/${weaponStats.totalDeaths} 件</div>
      </div>
    `;
  } else {
    const weaponRowsHtml = weaponStats.rows.map(r => {
      const kindLabel = WEAPON_KIND_LABEL[r.kind] || r.kind || '—';
      const winRateCell = r.low
        ? `${pct(r.winRate)}<span class="trend-weapon-low-note">（${r.matches}試合・少数）</span>`
        : pct(r.winRate);
      return `
        <tr class="${r.low ? 'trend-stage-low' : ''}">
          <td>${esc(r.name)}</td>
          <td>${esc(kindLabel)}</td>
          <td class="num">${r.matches}</td>
          <td class="num">${r.wins}勝${r.losses}敗</td>
          <td class="num ${r.low ? 'muted' : ''}">${winRateCell}</td>
          <td class="num">${r.killed}</td>
        </tr>
      `;
    }).join('');

    weaponBodyHtml = `
      <div style="overflow-x:auto">
        <table class="table trend-stage-table trend-weapon-table">
          <thead>
            <tr>
              <th>ブキ</th>
              <th>種類</th>
              <th>やられた試合</th>
              <th>勝敗</th>
              <th>やられた試合の勝率</th>
              <th>やられた回数</th>
            </tr>
          </thead>
          <tbody>${weaponRowsHtml}</tbody>
        </table>
      </div>
      <div class="trend-stage-note trend-weapon-note" style="margin-top:var(--sp-3);font-size:var(--fs-xs);color:var(--text-muted)">
        <div>デスしたときの吹き出し（「〇〇 で やられた!」）から読んだ名前です。読めたデス ${weaponStats.readDeaths}/${weaponStats.totalDeaths} 件</div>
        <div>母数は“そのブキにやられた試合”です。試合にいても自分を倒していないブキは数えていません。スペシャル・サブの名前からは相手のメインブキは分かりません</div>
        <div>やられた試合は負けに偏りやすいため、この勝率は“そのブキがいた試合全体の勝率”より低めに出ます</div>
        <div>5試合未満の行は参考になりません。全体の勝率は ${pct(weaponStats.overallWinRate)} です</div>
      </div>
    `;
  }

  const weaponCardHtml = `
    <div class="card trend-weapon-card" style="margin-bottom:var(--sp-6)">
      <div class="card-title">やられた相手のブキ</div>
      ${weaponBodyHtml}
    </div>
  `;

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
                <text x="${(bx + barW / 2).toFixed(1)}" y="${bBot + 15}" text-anchor="middle" class="num" font-size="10" fill="${x.r.result === 'WIN' ? 'var(--win)' : (x.r.result === 'LOSE' ? 'var(--lose)' : 'var(--text-faint)')}">#${i + 1}</text>
              </g>`;
          }).join('')}
        </svg>
      </div>`;
  };

  // 候補ランキング
  const shortage = candidateShortage(ms.length, filtered.length);
  const candidateCardHtml = `
    <div class="card trend-candidate-card" style="margin-bottom:var(--sp-6)">
      <div class="card-title">勝ちに効いている動き（候補）</div>
      ${!shortage.enough ? `
        <div class="empty-state">
          <p style="font-weight:var(--fw-bold);font-size:var(--fs-md);margin-bottom:var(--sp-2)">まだ順位を付けられるほど試合がありません</p>
          <p class="muted">あと${shortage.needed}試合記録すると、ここに候補が出ます</p>
        </div>
      ` : `
        <div class="empty-state">
          <p class="muted">候補の計算は次段階で実装します</p>
        </div>
      `}
    </div>
  `;

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">傾向分析 <span class="num muted">（${ms.length}試合）</span></h1>
    </div>

    ${filterHeaderHtml}
    ${bannerHtml}

    <div class="trends-stat-band">
      <div class="stat">
        <div class="stat-label">勝率</div>
        <div style="display:flex;align-items:baseline;margin-top:2px">
          ${winrateValHtml}
          <span class="stat-sub num">${wins}勝${losses}敗</span>
        </div>
        ${unknown > 0 ? `<div class="trend-winrate-note">勝敗不明${unknown}試合を除く${known.length}試合で計算</div>` : ''}
        ${verifyCount > 0 ? `<div class="trend-verify-note">検証用${verifyCount}試合を除く${ms.length}試合で計算</div>` : ''}
      </div>
      <div class="stat">
        <div class="stat-label">1試合あたりのキル</div>
        <div class="stat-value num">${(sum('kill') / filtered.length).toFixed(1)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">1試合あたりのデス</div>
        <div class="stat-value num">${(sum('death') / filtered.length).toFixed(1)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">キル÷デス</div>
        <div class="stat-value num">${(sum('kill') / Math.max(1, sum('death'))).toFixed(2)}</div>
      </div>
    </div>
    <div class="trends-stat-band special-stat-band">
      <div class="stat">
        <div class="stat-label">スペシャル発動の回数</div>
        <div class="stat-value num">${totActivated}</div>
      </div>
      <div class="stat">
        <div class="stat-label">使用可能だった時間（秒／試合）</div>
        <div class="stat-value num">${avgReadySec}</div>
      </div>
      <div class="stat">
        <div class="stat-label">未使用のままデスの回数</div>
        <div class="stat-value num">${totLost}</div>
      </div>
      <div class="stat">
        <div class="stat-label">未使用のまま終了した試合</div>
        <div class="stat-value num">${unusedEndMatches}</div>
      </div>
      <div class="stat">
        <div class="stat-label">ためたままデスした割合</div>
        <div class="stat-value num">${wastedRatePct}</div>
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
          ${unknown > 0 ? '<span><i class="tl-swatch" style="background:var(--text-faint);border-radius:50%"></i>不明</span>' : ''}
        </div>
      </div>
      <div class="winrate-chart-wrap">${winrateSvg}</div>
    </div>

    ${xPowerCardHtml}

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
                ${x.insufficient ? `
                  <span class="num">—</span>
                  <span class="muted" style="font-size:11px">データ不足</span>
                ` : `
                  <span class="num">${x.kd}</span>
                  <span class="num ${lossFmt.cls}">${lossFmt.text}</span>
                `}
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

    ${stageCardHtml}
    ${enemyPresenceCardHtml}
    ${namingCardHtml}
    ${weaponCardHtml}

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
      <div class="card-title">試合ごとのキル・デス・スペシャル発動</div>
      <div class="small-charts-grid">
        ${smallChart('kill', 'キル', 'var(--kill)')}
        ${smallChart('death', 'デス', 'var(--special-wasted)')}
        ${smallChart('special', 'スペシャル発動', 'var(--special)')}
      </div>
    </div>

    ${candidateCardHtml}

    <details class="card collapsible-card">
      <summary>検出の精度（確認画面での訂正から集計） <span>▸</span></summary>
      ${accTable(accuracy(filtered))}
    </details>
  `;

  mountPage(page, false);
  attachFilterListeners(page);

  page.querySelectorAll('.trend-stage-sort').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sortKey;
      if (trendStageSort.key === key) {
        trendStageSort.dir = trendStageSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        trendStageSort.key = key;
        trendStageSort.dir = 'desc';
      }
      PAGES.trend();
    });
  });

  // D65: 未登録のブキアイコンの絵を描き、名前を付けたら見本に登録して描き直す
  page.querySelectorAll('.weapon-icon-canvas').forEach(cv => {
    // D85・D94: 色つき版があれば、それを描く。無ければ（保存してあるのは 56x34 のグレー）、明るさの幅を引き伸ばして、なめらかに拡大する
    const ctx = cv.getContext('2d'), im = ctx.createImageData(56, 34), col = colorOf.get(cv.dataset.icon);
    if (col) { const c = b64bytes(col); for (let i = 0; i < 56 * 34; i++) { im.data[i * 4] = c[i * 3]; im.data[i * 4 + 1] = c[i * 3 + 1]; im.data[i * 4 + 2] = c[i * 3 + 2]; im.data[i * 4 + 3] = 255; } }
    else { const g = b64bytes(cv.dataset.icon), sorted = Array.from(g.subarray(0, 56 * 34)).sort((a, b) => a - b), lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)], span = Math.max(24, hi - lo);
      for (let i = 0; i < 56 * 34; i++) { const v = Math.max(0, Math.min(255, Math.round((g[i] - lo) * 255 / span))); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } }
    const tmp = document.createElement('canvas'); tmp.width = 56; tmp.height = 34; tmp.getContext('2d').putImageData(im, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
  });
  page.querySelectorAll('.weapon-naming-row').forEach(row => {
    const inp = $('.weapon-name-input', row), tsel = $('.weapon-type-select', row), auto = $('.weapon-type-auto', row), btn = $('.weapon-name-save', row);
    const known = name => weaponNameSet.has(name);
    const current = () => { const name = inp.value.trim(); return known(name) ? { name, type: typeOfWeapon(name, userTypeMap) } : { name, type: tsel.value }; };
    const refresh = () => { const c = current(), isKnown = known(c.name); tsel.style.display = c.name && !isKnown ? '' : 'none'; auto.textContent = c.name ? (isKnown ? `種類: ${c.type}` : '一覧にないブキ: 種類を選んでください') : ''; btn.disabled = !c.name; };
    inp.oninput = refresh; inp.onchange = refresh; tsel.onchange = refresh;
    row.querySelectorAll('.weapon-near-btn').forEach(b => { b.onclick = () => { inp.value = b.dataset.name; refresh(); btn.focus(); }; });
    btn.onclick = () => { const c = current(); if (!c.name) return; const g = unknownGroups[+row.dataset.i]; WL.addNamed(c.name, [g.rep], c.type !== UNCLASSIFIED ? c.type : null); PAGES.trend(); };
  });

  page.querySelectorAll('.wp-dot, .click-match').forEach(el => {
    el.addEventListener('click', () => nav('match', el.dataset.id));
  });

  page.querySelectorAll('tr.click[data-id]').forEach(tr => {
    tr.onclick = () => nav('match', tr.dataset.id, tr.dataset.t ? +tr.dataset.t : null);
  });
};


const { page: p0, query: q0, id: id0 } = parseHash(location.hash);
if (id0) currentId = decodeURIComponent(id0);
if (p0 === 'trend' && q0) {
  lastTrendQuery = q0;
}
// D58: スマホなど狭い画面ではライブ分析を使わない（キャプチャーできないので）。最初の画面は試合一覧にする
const narrow = isNarrow();
nav(PAGES[p0] ? (p0 === 'trend' && q0 ? `trend?${q0}` : (narrow && p0 === 'live' ? 'list' : p0)) : (narrow ? 'list' : 'live'));
Cloud.startAutoSync();
Cloud.onChange(r => { if (currentPage === 'list' && r && r.ok && (r.pulled || r.deleted)) PAGES.list(); });

