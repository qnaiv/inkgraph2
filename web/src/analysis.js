// Corrections-aware views of a match + accuracy + trend aggregation
import { aliveAt } from './core/analyzer.js';
import * as T from './core/tower.js';
import { powerForMatchType } from './core/result.js';
import { decodeFeat, featSim, KP, killerKind } from './core/killer.js';
import { decodeIcon, prepIcon, matchIcon, iconSimSym, iconHasDetail, BI } from './core/board_icons.js';

export const MATCH_TYPE_LABEL = {
  x: 'Xマッチ',
  bankara_open: 'バンカラ・オープン',
  bankara_challenge: 'バンカラ・チャレンジ',
  other: 'その他'
};

export const POWER_STATUS_LABEL = {
  acquired: '取得済み',
  not_applicable: '対象外',
  not_shown: '未表示',
  read_failed: '読取失敗',
  unknown_type: 'タイプ不明'
};

export function powerOf(m) {
  if (!m) return powerForMatchType(null);
  if (m.power && typeof m.power.status === 'string') {
    return {
      value: m.power.value ?? null,
      status: m.power.status,
      confidence: m.power.confidence ?? 0
    };
  }
  const mt = (m.review && m.review.fix && m.review.fix.match_type) ?? m.match_type ?? (m.result_screen && m.result_screen.match_type) ?? null;
  return powerForMatchType(mt);
}

export function matchOwner(m) { return (m && m.source && m.source.owner === 'other') ? 'other' : 'self'; }
export function isVerificationMatch(m) { return !!(m && m.source && m.source.owner === 'other'); }
export function ownMatches(ms) { if (!Array.isArray(ms)) return []; return ms.filter(m => !isVerificationMatch(m)); }
export const KINDS = { death: 'デス', kill: 'キル', special: 'スペシャル発動' };
export const SP_LABEL = { activated: '発動', lost_on_death: '未使用のままデス', unused_at_end: '未使用のまま終了' };
export const key = (kind, t) => `${kind}@${(+t).toFixed(1)}`;
export function series(m) { return (m.tower_series || []).map(s => ({ t: s.t, count_own: s.own, count_enemy: s.enemy, diff: s.own - s.enemy, owner: s.owner })); }
export function wpAt(m, S, t) { return T.wp(S.length ? T.at(S, t) : null, t, m.battle[1], aliveAt(m, t)); }
function ctx(m, S, kind, t) { const s = S.length ? T.at(S, t - 0.5) : null; const o = { phase: T.phase(s), count: s ? `${s.count_own}-${s.count_enemy}` : null, count_diff: s ? s.diff : null };
  if (kind !== 'special') { const b = wpAt(m, S, t - 1), a = wpAt(m, S, t + 1.5); o.wp_before = b; o.wp_after = a; o.wp_delta = a - b; } return o; }
/** pure interval view of m.special: [{ready, end, outcome, activated_at}] */
export function specialIntervals(m) {
  return (m.special || []).map(e => ({
    ready: e.ready,
    end: e.end,
    outcome: e.outcome,
    activated_at: e.activated_at ?? (e.outcome === 'activated' ? e.end : null)
  }));
}
/** aggregated special statistics for a match */
export function specialStats(m) {
  const intervals = specialIntervals(m);
  const readyCount = intervals.length;
  const readySeconds = +(intervals.reduce((s, e) => s + Math.max(0, e.end - e.ready), 0)).toFixed(1);
  const lost = intervals.filter(e => e.outcome === 'lost_on_death').length;
  const unusedEnd = intervals.filter(e => e.outcome === 'unused_at_end').length;
  const wastedRate = readyCount > 0 ? lost / readyCount : null;
  const activated = effective(m).filter(e => e.kind === 'special').length;
  return { activated, readyCount, readySeconds, lost, unusedEnd, wastedRate };
}
/** detected events with review status */
export function detected(m) { const r = m.review || { marks: {} }; const out = [];
  for (const e of (m.own_deaths || [])) out.push({ kind: 'death', t: e.start, end: e.end, src: e, key: key('death', e.start) });
  for (const e of (m.own_kills || [])) out.push({ kind: 'kill', t: e.start, end: e.end, src: e, key: key('kill', e.start) });
  for (const e of (m.special || [])) {
    if (e.outcome === 'activated') {
      const actT = e.activated_at ?? e.end;
      out.push({ kind: 'special', t: actT, ready: e.ready, end: e.end, activated_at: actT, outcome: e.outcome, src: e, key: key('special', e.ready) });
    }
  }
  out.forEach(e => { e.key = e.key || key(e.kind, e.t); e.mark = (r.marks && r.marks[e.key]) || null; }); return out.sort((a, b) => a.t - b.t); }
/** effective (corrected) events: detected minus ✗/deleted plus added; with phase & win-prob context */
export function effective(m) { const S = series(m), r = m.review || { added: [] };
  const ev = detected(m).filter(e => e.mark !== 'wrong' && e.mark !== 'deleted').concat((r.added || []).map(a => ({ kind: a.kind, t: a.t, end: a.t + (a.kind === 'death' ? 5 : 0.5), outcome: a.outcome || (a.kind === 'special' ? 'activated' : undefined), added: true, key: key('add-' + a.kind, a.t) })));
  ev.forEach(e => Object.assign(e, ctx(m, S, e.kind, e.t))); return ev.sort((a, b) => a.t - b.t); }
export const RESULT_STATUS_LABEL = { read: '読み取り済み', partial: '一部未取得', missing: '未取得（試合中データのみ）' };
export function resultStatus(m) {
  const rs = m ? m.result_screen : null;
  const cf = m ? m.confidence : null;
  const res = rs ? rs.result : null;
  const hasResult = res === 'WIN' || res === 'LOSE';
  const hasMode = rs && rs.mode != null;
  const hasStage = rs && rs.stage != null;
  const own = rs ? rs.own : null;
  const hasAnyOwn = own != null && (own.ka != null || own.deaths != null || own.specials != null);
  const hasAllOwn = own != null && own.ka != null && own.deaths != null && own.specials != null;
  const hasFrames = cf != null && (((cf.celebration_frames || 0) > 0) || ((cf.personal_frames || 0) > 0) || ((cf.board_frames || 0) > 0));

  if (!hasResult && !hasMode && !hasStage && !hasAnyOwn && !hasFrames) {
    return { key: 'missing', label: RESULT_STATUS_LABEL.missing };
  }
  if (hasResult && hasMode && hasStage && hasAllOwn) {
    return { key: 'read', label: RESULT_STATUS_LABEL.read };
  }
  return { key: 'partial', label: RESULT_STATUS_LABEL.partial };
}
export function resultSourceLabel(m) {
  if (m && m.review && m.review.fix && m.review.fix.result != null) return '手動訂正';
  const src = m && m.result_screen ? m.result_screen.result_source : null;
  if (src === 'celebration') return '演出';
  if (src === 'board') return '対戦表';
  if (src === 'fix') return '手動訂正';
  return '不明';
}
export const RESULT_FRAME_STEP = 0.08;
export function frameStepForState(state, base = 0.2) {
  return state === 'result' ? RESULT_FRAME_STEP : base;
}
export function resultOf(m) { const rs = (m && m.result_screen) || {}, f = ((m && m.review) || {}).fix || {}; const own = rs.own || {};
  const match_type = f.match_type ?? (m && m.match_type) ?? rs.match_type ?? null;
  return { result: f.result ?? rs.result, mode: f.mode ?? rs.mode, stage: f.stage ?? rs.stage, ka: f.ka ?? own.ka, deaths: f.deaths ?? own.deaths, specials: f.specials ?? own.specials, count: f.count ?? finalCount(m), result_source: resultSourceLabel(m), match_type, power: powerOf(m) }; }
/** D57: 結果画面の K+A（キル＋アシスト）と、検出したキル（アシストは画面に出ないので含まない）から、アシストの推定を出す。
 *  ka が読めていなければ null。キルの見逃しがあると、その分もアシストに数えられる（推定は「K+A − 検出したキル」の上限側）。 */
export function assistEstimate(ka, kills) {
  if (!Number.isInteger(ka) || ka < 0 || !Number.isInteger(kills)) return null;
  if (kills > ka) return { ka, kills, assists: 0, over: kills - ka };
  return { ka, kills, assists: ka - kills, over: 0 };
}
export function assistText(est) {
  if (!est) return '';
  return est.over ? `K+A ${est.ka}（検出キルが ${est.over} 多い：誤検出の可能性）` : `K+A ${est.ka}（アシスト推定 ${est.assists}）`;
}
export const ASSIST_NOTE = 'キル通知にアシストは出ないので、検出したキルは K+A より少なくなります。推定アシスト＝K+A−検出キルで、キルの見逃しがあるとその分もアシストに数えられます。';
export function finalCount(m) { const s = m.tower_series; if (!s || !s.length) return null; const l = s[s.length - 1]; return `${l.own}-${l.enemy}`; }
export const RESULT_FIELDS = { result: '勝敗', mode: 'ルール', stage: 'ステージ', ka: 'キル+アシスト', deaths: 'デス数', specials: 'スペシャル数', count: '最終カウント' };
/** accuracy from review marks. per kind: tp=✓, fp=✗, fn=added. result fields: rmarks ok/wrong */
export function accuracy(ms) { const A = {}; for (const k of Object.keys(KINDS)) A[k] = { tp: 0, fp: 0, fn: 0, unreviewed: 0 };
  const RF = {}; for (const k of Object.keys(RESULT_FIELDS)) RF[k] = { ok: 0, wrong: 0 };
  for (const m of ms) { const r = m.review || { marks: {}, added: [] };
    for (const e of detected(m)) { if (e.mark === 'ok') A[e.kind].tp++; else if (e.mark === 'wrong') A[e.kind].fp++; else if (!e.mark) A[e.kind].unreviewed++; }
    for (const a of r.added || []) A[a.kind].fn++;
    for (const [k, v] of Object.entries(r.rmarks || {})) if (RF[k]) RF[k][v === 'ok' ? 'ok' : 'wrong']++; }
  for (const a of Object.values(A)) { a.precision = a.tp + a.fp ? a.tp / (a.tp + a.fp) : null; a.recall = a.tp + a.fn ? a.tp / (a.tp + a.fn) : null; }
  return { events: A, result: RF }; }
export function countBucket(d) { if (d === null || d === undefined) return 'カウント不明'; if (d <= -30) return '30以上負け'; if (d <= -10) return '10〜29負け'; if (d < 0) return '1〜9負け'; if (d === 0) return '同点'; if (d < 10) return '1〜9勝ち'; if (d < 30) return '10〜29勝ち'; return '30以上勝ち'; }
export const BUCKETS = ['30以上負け', '10〜29負け', '1〜9負け', '同点', '1〜9勝ち', '10〜29勝ち', '30以上勝ち', 'カウント不明'];
export const mss = t => { t = Math.max(0, Math.round(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const pct = v => v === null || v === undefined || isNaN(v) ? '—' : `${Math.round(v * 100)}%`;

// ---------------------------------------------------------------------------
// ヤグラ保持の人手ラベル（D20: review.tower_holder / review.count_series）
// 検出の保持区間（同じ保持者が続く区間）を単位に、確認済みの値を review.tower_seg
// （キー＝区間開始秒 toFixed(1)）に保存し、そこから D20 形式の review.tower_holder を再生成する。
// 方針: tower_holder には「確認済みの区間だけ」を書き出す（ポップオーバーで値を設定した区間）。
// 未確認の区間は書かない（隙間になり、eval_labels.py は区間に覆われない秒を採点しない）。
// 隣り合う確認済み区間が同じ値なら結合する。1区間も確認していなければ tower_holder は書かない
// （評価側は未ラベル扱い）。
// ---------------------------------------------------------------------------
export const HOLDER_JA = { own: '味方', enemy: '敵', neutral: '中立' };
const holderOf = o => (o === 'own' || o === 'enemy') ? o : 'neutral';
const r1 = x => Math.round(x * 10) / 10;
/** detected holder runs over the battle, with review overlay: {key,ta,tb,det,val,confirmed,changed} */
export function holderSegments(m) {
  const S = series(m); if (!S.length) return [];
  const t0 = m.battle[0], t1 = m.battle[1], lab = (m.review && m.review.tower_seg) || {}; const runs = [];
  for (let i = 0; i < S.length; i++) {
    const o = holderOf(S[i].owner), ta = i === 0 ? t0 : (S[i - 1].t + S[i].t) / 2, tb = i === S.length - 1 ? t1 : (S[i].t + S[i + 1].t) / 2;
    if (runs.length && runs[runs.length - 1].det === o) runs[runs.length - 1].tb = tb; else runs.push({ ta, tb, det: o });
  }
  return runs.filter(r => r.tb > r.ta).map(r => { const key = r.ta.toFixed(1), v = lab[key];
    return { ...r, key, val: v || r.det, confirmed: !!v, changed: !!v && v !== r.det }; });
}
/** rebuild review.tower_holder ([start,end,value] sorted, adjacent same values merged) from per-segment labels */
export function syncTowerHolder(m) {
  const r = m.review; const segs = holderSegments(m);
  if (!r || !segs.some(s => s.confirmed)) { if (r) delete r.tower_holder; return; }
  const out = [];
  for (const s of segs) {
    if (!s.confirmed) continue;
    const a = r1(s.ta), b = r1(s.tb), l = out[out.length - 1];
    if (l && l[2] === s.val && Math.abs(l[1] - a) < 0.05) l[1] = b;
    else out.push([a, b, s.val]);
  }
  r.tower_holder = out;
}
export function setHolderLabel(m, key, val) {
  m.review = m.review || {};
  m.review.tower_seg = m.review.tower_seg || {};
  m.review.tower_seg[key] = val;
  syncTowerHolder(m);
}
/** remove the confirmation of one segment (back to unconfirmed) and rebuild tower_holder */
export function clearHolderLabel(m, key) {
  if (m.review && m.review.tower_seg) {
    delete m.review.tower_seg[key];
    if (!Object.keys(m.review.tower_seg).length) delete m.review.tower_seg;
  }
  syncTowerHolder(m);
}
export function addCountPoint(m, sec, own, enemy) {
  const cs = (m.review.count_series = m.review.count_series || []); sec = r1(sec);
  const i = cs.findIndex(c => Math.abs(c[0] - sec) < 0.05); if (i >= 0) cs[i] = [sec, own, enemy]; else cs.push([sec, own, enemy]);
  cs.sort((a, b) => a[0] - b[0]);
}
export function removeCountPoint(m, sec) {
  const cs = m.review.count_series || []; const i = cs.findIndex(c => c[0] === sec); if (i >= 0) cs.splice(i, 1);
  if (!cs.length) delete m.review.count_series;
}

// ---------------------------------------------------------------------------
// 傾向画面（エピックC・エピックB土台）フィルタ・集計関数群
// ---------------------------------------------------------------------------

export const MATCH_TYPE_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'x', label: 'Xマッチ' },
  { value: 'bankara_open', label: 'バンカラ・オープン' },
  { value: 'bankara_challenge', label: 'バンカラ・チャレンジ' },
  { value: 'other', label: 'その他' }
];

export const RULE_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'area', label: 'ガチエリア' },
  { value: 'hoko', label: 'ガチホコバトル' },
  { value: 'yagura', label: 'ガチヤグラ' },
  { value: 'asari', label: 'ガチアサリ' },
  { value: 'nawabari', label: 'ナワバリバトル' }
];

const RULE_VALUE_TO_MODE = {
  area: 'ガチエリア',
  hoko: 'ガチホコバトル',
  yagura: 'ガチヤグラ',
  asari: 'ガチアサリ',
  nawabari: 'ナワバリバトル'
};

export function parseTrendFilter(text) {
  let s = text || '';
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) s = s.slice(qIdx + 1);
  const params = new URLSearchParams(s);
  let matchType = params.get('matchType') || 'all';
  let rule = params.get('rule') || 'all';
  if (!MATCH_TYPE_OPTIONS.some(o => o.value === matchType)) matchType = 'all';
  if (!RULE_OPTIONS.some(o => o.value === rule)) rule = 'all';
  return { matchType, rule };
}

export function trendFilterToQuery(f) {
  const matchType = (f && f.matchType) || 'all';
  const rule = (f && f.rule) || 'all';
  const p = new URLSearchParams();
  p.set('matchType', matchType);
  p.set('rule', rule);
  return p.toString();
}

export function filterTrendMatches(matches, f) {
  if (!Array.isArray(matches)) return [];
  const filter = typeof f === 'object' && f !== null && ('matchType' in f || 'rule' in f)
    ? parseTrendFilter(trendFilterToQuery(f))
    : parseTrendFilter(f);
  const { matchType, rule } = filter;
  const targetMode = RULE_VALUE_TO_MODE[rule] || null;

  return matches.filter(m => {
    const r = resultOf(m);
    // match_type 判定
    if (matchType !== 'all') {
      if (matchType === 'other') {
        if (r.match_type !== 'other') return false;
      } else {
        if (r.match_type !== matchType) return false;
      }
    }
    // mode 判定
    if (rule !== 'all') {
      if (!r.mode || r.mode !== targetMode) return false;
    }
    return true;
  });
}

export function sampleTier(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (count < 5) return { key: 'insufficient', label: 'データ不足' };
  if (count <= 9) return { key: 'reference', label: '参考値' };
  return { key: 'normal', label: '通常' };
}

export function powerBreakdown(matches) {
  if (!Array.isArray(matches)) {
    return { acquired: 0, notApplicable: 0, notAcquired: 0, excluded: 0 };
  }
  let acquired = 0;
  let notApplicable = 0;
  let notAcquired = 0;
  for (const m of matches) {
    const p = powerOf(m);
    if (p.status === 'acquired' && p.value != null) {
      acquired++;
    } else if (p.status === 'not_applicable') {
      notApplicable++;
    } else {
      notAcquired++;
    }
  }
  return {
    acquired,
    notApplicable,
    notAcquired,
    excluded: notApplicable + notAcquired
  };
}

export function stageRuleRows(matches) {
  if (!Array.isArray(matches)) return [];
  const map = new Map();

  for (const m of matches) {
    const r = resultOf(m);
    const stage = r.stage || '不明';
    const rule = r.mode || 'ルール不明';
    const key = `${stage}::${rule}`;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        stage,
        rule,
        n: 0,
        wins: 0,
        losses: 0,
        killTotal: 0,
        deathTotal: 0,
        specialTotal: 0
      };
      map.set(key, entry);
    }

    entry.n++;
    if (r.result === 'WIN') entry.wins++;
    else if (r.result === 'LOSE') entry.losses++;

    const eff = effective(m);
    for (const e of eff) {
      if (e.kind === 'kill') entry.killTotal++;
      else if (e.kind === 'death') entry.deathTotal++;
      else if (e.kind === 'special') entry.specialTotal++;
    }
  }

  const rows = [];
  for (const entry of map.values()) {
    const known = entry.wins + entry.losses;
    const winRate = known > 0 ? entry.wins / known : null;
    const killsPer = entry.n > 0 ? entry.killTotal / entry.n : 0;
    const deathsPer = entry.n > 0 ? entry.deathTotal / entry.n : 0;
    const specialsPer = entry.n > 0 ? entry.specialTotal / entry.n : 0;
    const kd = entry.deathTotal > 0 ? entry.killTotal / entry.deathTotal : null;

    let badge = null;
    if (entry.n >= 10 && winRate != null) {
      if (winRate >= 0.6) badge = '得意';
      else if (winRate <= 0.4) badge = '苦手';
    }

    rows.push({
      stage: entry.stage,
      rule: entry.rule,
      n: entry.n,
      wins: entry.wins,
      losses: entry.losses,
      known,
      winRate,
      killsPer,
      deathsPer,
      specialsPer,
      kd,
      killTotal: entry.killTotal,
      deathTotal: entry.deathTotal,
      specialTotal: entry.specialTotal,
      badge
    });
  }

  rows.sort((a, b) => b.n - a.n || a.stage.localeCompare(b.stage) || a.rule.localeCompare(b.rule));
  return rows;
}

export function sortStageRows(rows, key = 'n', dir = 'desc') {
  if (!Array.isArray(rows)) return [];
  const list = [...rows];
  const mult = dir === 'asc' ? 1 : -1;

  if (key === 'winRate') {
    const eligible = [];
    const low = [];
    for (const r of list) {
      if (r.n < 5) low.push(r);
      else eligible.push(r);
    }
    eligible.sort((a, b) => {
      const va = a.winRate ?? -1;
      const vb = b.winRate ?? -1;
      if (va !== vb) return (va - vb) * mult;
      return b.n - a.n || a.stage.localeCompare(b.stage) || a.rule.localeCompare(b.rule);
    });
    return [...eligible, ...low];
  }

  list.sort((a, b) => {
    let diff = 0;
    if (key === 'stage') {
      diff = a.stage.localeCompare(b.stage);
    } else if (key === 'rule') {
      diff = a.rule.localeCompare(b.rule);
    } else if (key === 'n') {
      diff = a.n - b.n;
    } else if (key === 'record') {
      diff = (a.wins - b.wins) || (b.losses - a.losses);
    } else if (key === 'killsPer') {
      diff = a.killsPer - b.killsPer;
    } else if (key === 'deathsPer') {
      diff = a.deathsPer - b.deathsPer;
    } else if (key === 'specialsPer') {
      diff = a.specialsPer - b.specialsPer;
    } else if (key === 'kd') {
      const va = a.kd ?? -1;
      const vb = b.kd ?? -1;
      diff = va - vb;
    }
    if (diff !== 0) return diff * mult;
    return b.n - a.n || a.stage.localeCompare(b.stage) || a.rule.localeCompare(b.rule);
  });
  return list;
}

export function candidateShortage(totalOwn, filtered) {
  const t = Math.max(0, Math.floor(Number(totalOwn) || 0));
  const f = Math.max(0, Math.floor(Number(filtered) || 0));
  const enough = t >= 30 && f >= 10;
  const needed = Math.max(30 - t, 10 - f, 0);
  return { enough, needed, totalOwn: t, filtered: f };
}

function getUnknownWeaponName(index) {
  let s = '';
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return `未登録のブキ${s}`;
}

function getUnknownIconName(index) {
  let s = '';
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return `未登録のアイコン${s}`;
}

export function enemyWeaponRows(matches) {
  if (!Array.isArray(matches)) {
    return {
      rows: [],
      totalDeaths: 0,
      readDeaths: 0,
      unreadDeaths: 0,
      nMatches: 0,
      overallWinRate: null
    };
  }

  let totalDeaths = 0;
  let readDeaths = 0;
  let unreadDeaths = 0;
  let overallWins = 0;
  let overallLosses = 0;
  const nMatches = matches.length;

  const unknownGroups = [];
  const weaponMap = new Map();

  for (const m of matches) {
    const res = resultOf(m).result;
    if (res === 'WIN') overallWins++;
    else if (res === 'LOSE') overallLosses++;

    const eff = effective(m);
    const matchWeapons = new Map();

    for (const e of eff) {
      if (e.kind !== 'death') continue;
      totalDeaths++;

      const kb = e.src?.killed_by;
      if (!kb) {
        unreadDeaths++;
        continue;
      }
      readDeaths++;

      let key = null;
      let name = null;
      let kind = null;

      if (kb.name) {
        key = kb.name;
        name = kb.name;
        kind = kb.kind || killerKind(kb.name) || 'main';
      } else if (kb.sig && kb.ar != null) {
        const feat = decodeFeat(kb.sig);
        let ug = unknownGroups.find(g =>
          featSim(feat, g.repFeat) >= KP.match_th &&
          Math.abs(Math.log(kb.ar / g.repAr)) <= KP.ar_tol
        );
        if (!ug) {
          const groupName = getUnknownWeaponName(unknownGroups.length);
          ug = {
            name: groupName,
            repFeat: feat,
            repAr: kb.ar
          };
          unknownGroups.push(ug);
        }
        key = ug.name;
        name = ug.name;
        kind = 'unknown';
      } else {
        continue;
      }

      const cur = matchWeapons.get(key) || { name, kind, kills: 0 };
      cur.kills++;
      matchWeapons.set(key, cur);
    }

    for (const [k, mw] of matchWeapons.entries()) {
      let wep = weaponMap.get(k);
      if (!wep) {
        wep = {
          name: mw.name,
          kind: mw.kind,
          matches: 0,
          wins: 0,
          losses: 0,
          killed: 0
        };
        weaponMap.set(k, wep);
      }
      wep.matches++;
      wep.killed += mw.kills;
      if (res === 'WIN') wep.wins++;
      else if (res === 'LOSE') wep.losses++;
    }
  }

  const rows = [];
  for (const wep of weaponMap.values()) {
    const known = wep.wins + wep.losses;
    const winRate = known > 0 ? wep.wins / known : null;
    rows.push({
      name: wep.name,
      kind: wep.kind,
      matches: wep.matches,
      wins: wep.wins,
      losses: wep.losses,
      winRate,
      killed: wep.killed,
      low: wep.matches < 5
    });
  }

  rows.sort((a, b) => {
    if (b.killed !== a.killed) return b.killed - a.killed;
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.name.localeCompare(b.name, 'ja');
  });

  const overallKnown = overallWins + overallLosses;
  const overallWinRate = overallKnown > 0 ? overallWins / overallKnown : null;

  return {
    rows,
    totalDeaths,
    readDeaths,
    unreadDeaths,
    nMatches,
    overallWinRate
  };
}

/** 結果画面ボードのブキアイコンから、「そのブキがいた試合」の勝敗を数える。
 *  opts.field: 'enemy_icons'（既定。敵 4 人）／'ally_icons'（味方 4 人＋自分）。opts.pick: 数える枠の条件（例: 自分だけ・自分を除く）。
 *  各行の delta は「全体の勝率との差」（負けやすい武器を見つけるための目安）。 */
export function enemyPresenceRows(matches, lib, opts = {}) {
  const field = opts.field || 'enemy_icons', pick = typeof opts.pick === 'function' ? opts.pick : () => true;
  if (!Array.isArray(matches)) {
    return { rows: [], nMatches: 0, withIcons: 0, namedSlots: 0, totalSlots: 0, overallWinRate: null };
  }

  const iconLib = Array.isArray(lib) ? lib : (lib && Array.isArray(lib.lib) ? lib.lib : []);
  let totalSlots = 0, namedSlots = 0, withIcons = 0;
  let overallWins = 0, overallLosses = 0;

  const unknownGroups = [];
  const weaponMap = new Map();

  for (const m of matches) {
    const res = resultOf(m).result;
    const isWin = res === 'WIN';
    const isLose = res === 'LOSE';
    if (isWin) overallWins++;
    else if (isLose) overallLosses++;

    const icons = Array.isArray(m[field]) ? m[field].filter(it => it && it.icon && pick(it)) : [];
    const hasIcons = icons.length > 0;
    if (hasIcons) withIcons++;
    if (!hasIcons) continue;

    const matchWeapons = new Map();

    for (const item of icons) {
      if (!item || !item.icon || !iconHasDetail(item.icon)) continue; // 絵の無い（ボード以外を切り出した）記録は数えない
      totalSlots++;
      const mr = matchIcon(iconLib, item.icon);

      let key = null, name = null, kind = null;
      if (mr.name) {
        namedSlots++;
        key = mr.name;
        name = mr.name;
        kind = 'main';
      } else if (mr.ambiguous && mr.ambiguous.length > 0) {
        key = 'ambiguous:リッター4K／4Kスコープ';
        name = 'リッター4K／4Kスコープ';
        kind = 'ambiguous';
      } else {
        const pg = prepIcon(item.icon);
        let ug = unknownGroups.find(g0 => iconSimSym(pg, g0.rep) >= BI.group_th);
        if (!ug) {
          const groupName = getUnknownIconName(unknownGroups.length);
          ug = { name: groupName, rep: pg };
          unknownGroups.push(ug);
        }
        key = ug.name;
        name = ug.name;
        kind = 'unknown';
      }

      if (!matchWeapons.has(key)) {
        matchWeapons.set(key, { name, kind });
      }
    }

    if (!isWin && !isLose) continue;

    for (const [k, mw] of matchWeapons.entries()) {
      let wep = weaponMap.get(k);
      if (!wep) {
        wep = { name: mw.name, kind: mw.kind, matches: 0, wins: 0, losses: 0 };
        weaponMap.set(k, wep);
      }
      wep.matches++;
      if (isWin) wep.wins++;
      else if (isLose) wep.losses++;
    }
  }

  const rows = [];
  for (const wep of weaponMap.values()) {
    const known = wep.wins + wep.losses;
    const winRate = known > 0 ? wep.wins / known : null;
    rows.push({
      name: wep.name,
      kind: wep.kind,
      matches: wep.matches,
      wins: wep.wins,
      losses: wep.losses,
      winRate,
      low: wep.matches < 5
    });
  }
  const baseWins = overallWins, baseN = overallWins + overallLosses, baseRate = baseN > 0 ? baseWins / baseN : null;
  for (const r of rows) r.delta = (r.winRate !== null && baseRate !== null) ? r.winRate - baseRate : null;

  rows.sort((a, b) => {
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.name.localeCompare(b.name, 'ja');
  });

  const nMatches = overallWins + overallLosses;
  const overallWinRate = nMatches > 0 ? overallWins / nMatches : null;

  return {
    rows,
    nMatches,
    withIcons,
    namedSlots,
    totalSlots,
    overallWinRate
  };
}


/** D65: 見本に無い（名前が付かない）ブキアイコンを、似た絵どうしにまとめて返す。名前を付ける画面用。
 *  戻り値: [{ rep: アイコン(base64)、slots: 枠の数、matches: 試合の数、side: {enemy, ally} }]（枠の数の多い順）。区別不可（4K の組）は含めない。 */
export function unknownIconGroups(matches, lib) {
  const iconLib = Array.isArray(lib) ? lib : (lib && Array.isArray(lib.lib) ? lib.lib : []);
  const groups = [];
  for (const m of Array.isArray(matches) ? matches : []) {
    for (const [field, side] of [['enemy_icons', 'enemy'], ['ally_icons', 'ally']]) {
      for (const item of Array.isArray(m[field]) ? m[field] : []) {
        if (!item || !item.icon || !iconHasDetail(item.icon)) continue; // 絵の無い（ボード以外を切り出した）アイコンは出さない
        const mr = matchIcon(iconLib, item.icon); if (mr.name || (mr.ambiguous && mr.ambiguous.length)) continue;
        const pg = prepIcon(item.icon); let g = groups.find(x => iconSimSym(pg, x.prep) >= BI.group_th);
        if (!g) { g = { rep: item.icon, prep: pg, slots: 0, ids: new Set(), side: { enemy: 0, ally: 0 } }; groups.push(g); }
        g.slots++; g.ids.add(m.id); g.side[side]++;
      }
    }
  }
  return groups.map(g => ({ rep: g.rep, slots: g.slots, matches: g.ids.size, side: g.side })).sort((a, b) => b.slots - a.slots);
}
