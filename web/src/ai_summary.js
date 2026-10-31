// AI 連携: 試合の記録（record）から、AI に渡す要約を作る。DOM・ネットワーク・他モジュール非依存の純粋関数。
// アプリ（書き出し）と MCP サーバー（絞り込みの再集計）の両方から読み込まれる。import を足さないこと。
//
// record（試合 1 件の、数値と時刻だけの形。ai_export.js の toRecord が作る）:
//   { id, created(ISO), owner:'self'|'other', fix:'none'|'todo'|'done', match_type, rule, stage,
//     result:'WIN'|'LOSE'|null, battle_sec, ka, deaths_result, deaths:[開始からの秒], kills:[開始からの秒],
//     special:{ ready, lost, activated }, first_death:秒|null }
export const FORMAT = 1;
export const SESSION_GAP_MIN = 60;   // 今日の連戦: 試合の間隔がこれ以上空いたら区切る（案）
export const LAST_N = 20;            // 直近 N 試合（案）
export const LAST_DAYS = 30;         // 直近 N 日（案）
export const MIN_RELIABLE = 10;      // 助言の根拠にしてよい最小の試合数（案）
export const FIRST_DEATH_EDGE = 30;  // 「開幕のデス」とみなす秒数（案）
export const WINDOWS = ['today', 'last20', 'last30d', 'all'];
export const WINDOW_LABEL = { today: '今日の連戦', last20: `直近 ${LAST_N} 試合`, last30d: `直近 ${LAST_DAYS} 日`, all: '全期間' };

const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const ms = r => { const t = Date.parse(r.created || ''); return Number.isFinite(t) ? t : 0; };

/** 割合の 95% 信頼区間（Wilson）。n=0 は null */
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { value: r3(p), lo: r3(Math.max(0, (c - h) / d)), hi: r3(Math.min(1, (c + h) / d)), n };
}
/** 回数/分 とその幅（回数をポアソンとみなした近似）。minutes=0 は null */
export function rate(count, minutes) {
  if (!(minutes > 0)) return null;
  const se = Math.sqrt(Math.max(count, 1)), v = count / minutes;
  return { value: r2(v), lo: r2(Math.max(0, (count - 1.96 * se) / minutes)), hi: r2((count + 1.96 * se) / minutes), count, minutes: r2(minutes), method: 'approx' };
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

/** 集計の対象になる記録（自分の試合・要修正のままでないもの）と、除外した件数 */
export function eligible(records) {
  const all = Array.isArray(records) ? records : [];
  const other = all.filter(r => r.owner === 'other').length;
  const todo = all.filter(r => r.owner !== 'other' && r.fix === 'todo').length;
  const list = all.filter(r => r.owner !== 'other' && r.fix !== 'todo').sort((a, b) => ms(a) - ms(b) || (a.id < b.id ? -1 : 1));
  return { list, excluded: { other_owner: other, needs_fix: todo, total: other + todo } };
}

/** 窓ごとの記録を選ぶ。list は eligible().list（古い順） */
export function pickWindow(list, win, now = Date.now()) {
  if (win === 'all') return list;
  if (win === 'last20') return list.slice(-LAST_N);
  if (win === 'last30d') return list.filter(r => ms(r) >= now - LAST_DAYS * 86400000);
  if (win === 'today') {
    const out = [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (out.length && ms(out[0]) - ms(list[i]) > SESSION_GAP_MIN * 60000) break;
      out.unshift(list[i]);
    }
    return out;
  }
  return [];
}

const tally = (rows, keyOf) => {
  const m = new Map();
  for (const r of rows) { const k = keyOf(r) || '不明'; const o = m.get(k) || { name: k, n: 0, wins: 0, losses: 0 }; o.n++; if (r.result === 'WIN') o.wins++; if (r.result === 'LOSE') o.losses++; m.set(k, o); }
  return [...m.values()].sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
};

/** 1 つの窓の統計 */
export function stats(rows) {
  const wins = rows.filter(r => r.result === 'WIN').length, losses = rows.filter(r => r.result === 'LOSE').length;
  const minutes = rows.reduce((s, r) => s + (r.battle_sec || 0), 0) / 60;
  const deathCount = rows.reduce((s, r) => s + (Array.isArray(r.deaths) ? r.deaths.length : 0), 0);
  const withFirst = rows.filter(r => typeof r.first_death === 'number');
  const early = withFirst.filter(r => r.first_death <= FIRST_DEATH_EDGE), late = withFirst.filter(r => r.first_death > FIRST_DEATH_EDGE);
  const wl = a => ({ n: a.length, wins: a.filter(r => r.result === 'WIN').length, losses: a.filter(r => r.result === 'LOSE').length });
  const spReady = rows.reduce((s, r) => s + (r.special ? r.special.ready || 0 : 0), 0), spLost = rows.reduce((s, r) => s + (r.special ? r.special.lost || 0 : 0), 0);
  const created = rows.map(ms).filter(Boolean);
  return {
    n: rows.length, enough: rows.length >= MIN_RELIABLE,
    range: created.length ? { from: new Date(Math.min(...created)).toISOString(), to: new Date(Math.max(...created)).toISOString() } : null,
    wins, losses, unknown_result: rows.length - wins - losses,
    win_rate: wilson(wins, wins + losses),
    minutes: r2(minutes),
    deaths: { total: deathCount, per_min: rate(deathCount, minutes), by_result: { win: rate(rows.filter(r => r.result === 'WIN').reduce((s, r) => s + (r.deaths || []).length, 0), rows.filter(r => r.result === 'WIN').reduce((s, r) => s + (r.battle_sec || 0), 0) / 60), lose: rate(rows.filter(r => r.result === 'LOSE').reduce((s, r) => s + (r.deaths || []).length, 0), rows.filter(r => r.result === 'LOSE').reduce((s, r) => s + (r.battle_sec || 0), 0) / 60) } },
    ka_total: rows.reduce((s, r) => s + (typeof r.ka === 'number' ? r.ka : 0), 0),
    first_death: { edge_sec: FIRST_DEATH_EDGE, matches_with_death: withFirst.length, median_sec: median(withFirst.map(r => r.first_death)), within_edge: wl(early), after_edge: wl(late) },
    special: { ready: spReady, lost_on_death: spLost, lost_share_of_deaths: deathCount ? r3(spLost / deathCount) : null, matches_with_lost: rows.filter(r => r.special && r.special.lost > 0).length },
    by_rule: tally(rows, r => r.rule), by_stage: tally(rows, r => r.stage),
    match_ids: rows.map(r => r.id)
  };
}

/**
 * 要約を作る。
 *  windows 省略: 既定の 3 つの窓（today / last20 / last30d）を全部返す。
 *  window 指定: その窓だけ。
 *  rule / stage: 絞り込み。窓の件数が MIN_RELIABLE 未満なら、widen が true（既定）のとき次に広い窓へ広げ、広げたことを widened_from に書く。
 */
export function aggregate(records, { now = Date.now(), window = null, rule = null, stage = null, widen = true } = {}) {
  const { list, excluded } = eligible(records);
  const filtered = list.filter(r => (!rule || r.rule === rule) && (!stage || r.stage === stage));
  const order = ['today', 'last20', 'last30d', 'all'];
  const build = name => {
    let use = name, rows = pickWindow(filtered, use, now), widenedFrom = null;
    if (widen && (rule || stage)) while (rows.length < MIN_RELIABLE && order.indexOf(use) < order.length - 1 && use !== 'today') { widenedFrom = widenedFrom || use; use = order[order.indexOf(use) + 1]; rows = pickWindow(filtered, use, now); }
    return { window: use, label: WINDOW_LABEL[use], requested: name, ...(widenedFrom ? { widened_from: widenedFrom } : {}), ...stats(rows) };
  };
  const names = window ? [window] : ['today', 'last20', 'last30d'];
  const out = {};
  for (const n of names) if (WINDOWS.includes(n)) out[n] = build(n);
  return {
    format: FORMAT, generated_at: new Date(now).toISOString(),
    filter: { rule: rule || null, stage: stage || null },
    windows: out,
    quality: {
      total_records: Array.isArray(records) ? records.length : 0, eligible: list.length, matching_filter: filtered.length,
      excluded, min_reliable: MIN_RELIABLE,
      notes: ['デス数は人が直した後の検出（effective）で数えている', 'K+A はアシストを含む。キルだけの数は取れていない', 'スペシャルの内訳は人が全件確認したものではない']
    }
  };
}
