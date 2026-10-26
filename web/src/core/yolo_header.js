// D56: 結果画面の見出し（ルール・ステージ・モード）を YOLO（yolo_stats.onnx、v1 の Roboflow 学習モデル）で読む。DOM 非依存の純粋関数。
// v1（qnaiv/InkGraph）の cascade.rs（run_header_cascade）と同じ手順：画面の右上を切り出し、アスペクト比を無視して 640x640 に引き伸ばし（学習時と同じ stretch）、
// 出力 [1, 4+nc, 8400] を conf>=0.5・クラスごとの NMS(0.45) で絞り、グループ（mode_/rule_/stage_）ごとに最高確信度のクラスを採る。
export const YOLO_CLASSES = ['digit_0', 'digit_1', 'digit_2', 'digit_3', 'digit_4', 'digit_5', 'digit_6', 'digit_7', 'digit_8', 'digit_9', 'icon_death', 'icon_kill', 'icon_special',
  'mode_challenge', 'mode_open', 'mode_regular', 'mode_x', 'rule_area', 'rule_asari', 'rule_hoko', 'rule_nawabari', 'rule_yagura',
  'stage_amabi', 'stage_baigai', 'stage_chozame', 'stage_dekarain', 'stage_gonzui', 'stage_hirame', 'stage_kajiki', 'stage_kinmedai', 'stage_konbu', 'stage_kusaya', 'stage_mahimahi', 'stage_manta',
  'stage_masaba', 'stage_mategai', 'stage_namerou', 'stage_nanpura', 'stage_negitoro', 'stage_ohyou', 'stage_ryuuguu', 'stage_sumeshi', 'stage_takaashi', 'stage_taraport', 'stage_yagara', 'stage_yunohana', 'stage_zatou'];
export const HEADER_CROP = { x0: 0.41, x1: 0.92, y0: 0.02, y1: 0.15 }; // フレーム比率（v1 の HEADER_CROP_*）
export const YOLO_SIZE = 640, YOLO_CONF = 0.5, YOLO_IOU = 0.45;
// このアプリ内の表記（既存のテンプレート名・RULE_OPTIONS と同じ）に合わせる
export const RULE_NAME = { rule_area: 'ガチエリア', rule_asari: 'ガチアサリ', rule_hoko: 'ガチホコバトル', rule_nawabari: 'ナワバリバトル', rule_yagura: 'ガチヤグラ' };
export const MATCH_TYPE = { mode_x: 'x', mode_open: 'bankara_open', mode_challenge: 'bankara_challenge', mode_regular: 'other' };
export const STAGE_NAME = { stage_yunohana: 'ユノハナ大渓谷', stage_gonzui: 'ゴンズイ地区', stage_yagara: 'ヤガラ市場', stage_mategai: 'マテガイ放水路', stage_namerou: 'ナメロウ金属', stage_nanpura: 'ナンプラー遺跡',
  stage_kusaya: 'クサヤ温泉', stage_hirame: 'ヒラメが丘団地', stage_masaba: 'マサバ海峡大橋', stage_sumeshi: 'スメーシーワールド', stage_kinmedai: 'キンメダイ美術館', stage_taraport: 'タラポートショッピングパーク',
  stage_baigai: 'バイガイ亭', stage_amabi: '海女美術大学', stage_chozame: 'チョウザメ造船', stage_zatou: 'ザトウマーケット', stage_ryuuguu: 'リュウグウターミナル', stage_ohyou: 'オヒョウ海運',
  stage_kajiki: 'カジキ空港', stage_negitoro: 'ネギトロ炭鉱', stage_dekarain: 'デカライン高架下', stage_konbu: 'コンブトラック', stage_mahimahi: 'マヒマヒリゾート&スパ', stage_manta: 'マンタマリア号', stage_takaashi: 'タカアシ経済特区' };

/** 見出しの切り出し矩形 [x, y, w, h]（ピクセル） */
export function headerRect(w, h) { const x = Math.floor(w * HEADER_CROP.x0), y = Math.floor(h * HEADER_CROP.y0), r = Math.min(w, Math.floor(w * HEADER_CROP.x1)), b = Math.min(h, Math.floor(h * HEADER_CROP.y1)); return [x, y, r - x, b - y]; }

/** RGBA フレーム {w,h,data} から見出しを切り出して 640x640 に引き伸ばし（双一次）、CHW・0..1 の Float32Array にする */
export function preprocessHeader(fr) {
  const [cx, cy, cw, ch] = headerRect(fr.w, fr.h), S = YOLO_SIZE, out = new Float32Array(3 * S * S), plane = S * S;
  const sx = cw / S, sy = ch / S;
  for (let y = 0; y < S; y++) {
    const fy = Math.min(ch - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < S; x++) {
      const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), wx = fx - x0;
      const i00 = ((cy + y0) * fr.w + cx + x0) * 4, i01 = ((cy + y0) * fr.w + cx + x1) * 4, i10 = ((cy + y1) * fr.w + cx + x0) * 4, i11 = ((cy + y1) * fr.w + cx + x1) * 4, o = y * S + x;
      for (let c = 0; c < 3; c++) out[c * plane + o] = ((fr.data[i00 + c] * (1 - wx) + fr.data[i01 + c] * wx) * (1 - wy) + (fr.data[i10 + c] * (1 - wx) + fr.data[i11 + c] * wx) * wy) / 255;
    }
  }
  return out;
}

const iou = (a, b) => { const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]), i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1), u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i; return u > 0 ? i / u : 0; };
/** 出力 [1, 4+nc, A]（平坦な Float32Array）→ 検出 [{cls, name, conf, box:[x1,y1,x2,y2]（640 座標）}]（確信度の降順、クラスごとに NMS） */
export function decodeYolo(data, nc = YOLO_CLASSES.length, anchors = 8400, conf = YOLO_CONF, nms = YOLO_IOU) {
  const out = [];
  for (let a = 0; a < anchors; a++) {
    let bc = -1, bs = 0; for (let c = 0; c < nc; c++) { const s = data[(4 + c) * anchors + a]; if (s > bs) { bs = s; bc = c; } }
    if (bs < conf) continue;
    const cx = data[a], cy = data[anchors + a], w = data[2 * anchors + a], h = data[3 * anchors + a];
    out.push({ cls: bc, name: YOLO_CLASSES[bc], conf: bs, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] });
  }
  out.sort((p, q) => q.conf - p.conf); const keep = [];
  for (const d of out) if (!keep.some(k => k.cls === d.cls && iou(k.box, d.box) > nms)) keep.push(d);
  return keep;
}

/** 検出から見出し（グループごとの最高確信度）を決める。read: {type, rule, stage, conf:{type,rule,stage}}。何も無ければ null */
export function headerFromDetections(dets) {
  const best = p => dets.filter(d => d.name.startsWith(p)).sort((a, b) => b.conf - a.conf)[0] || null;
  const m = best('mode_'), r = best('rule_'), s = best('stage_');
  if (!m && !r && !s) return null;
  return { type: m ? MATCH_TYPE[m.name] : null, rule: r ? RULE_NAME[r.name] : null, stage: s ? STAGE_NAME[s.name] : null, conf: { type: m ? +m.conf.toFixed(3) : 0, rule: r ? +r.conf.toFixed(3) : 0, stage: s ? +s.conf.toFixed(3) : 0 } };
}

/** 数フレームの読み取りを多数決（確信度の合計が最大の値）にまとめる */
export function voteReads(reads) {
  const reads2 = (reads || []).filter(Boolean); if (!reads2.length) return null;
  const pick = f => { const sum = new Map(); for (const r of reads2) if (r[f]) sum.set(r[f], (sum.get(r[f]) || 0) + (r.conf[f] || 0)); let bv = null, bs = 0; for (const [v, s] of sum) if (s > bs) { bs = s; bv = v; } return bv; };
  const o = { type: pick('type'), rule: pick('rule'), stage: pick('stage'), frames: reads2.length };
  return o.type || o.rule || o.stage ? o : null;
}

/**
 * YOLO の読み取りを試合に反映する（in place）。方針：テンプレートで読めなかった項目だけ埋める（読めていて食い違うものは直さずに記録だけ）。
 * 戻り値: 埋めた項目名の配列。powerFor は match_type から power を作る関数（result.js の powerForMatchType）。
 */
export function mergeYoloHeader(rec, reads, powerFor) {
  const v = voteReads(reads); if (!v) return [];
  const rs = rec.result_screen || (rec.result_screen = {}), filled = [], dis = {};
  rs.yolo = { type: v.type, rule: v.rule, stage: v.stage, frames: v.frames };
  if (v.rule) { if (!rs.mode) { rs.mode = v.rule; rs.mode_source = 'yolo'; rs.mode_unknown = undefined; rs.mode_guess = undefined; filled.push('mode'); } else if (rs.mode !== v.rule) dis.mode = { template: rs.mode, yolo: v.rule }; }
  if (v.stage) { if (!rs.stage) { rs.stage = v.stage; rs.stage_source = 'yolo'; filled.push('stage'); } else if (rs.stage !== v.stage) dis.stage = { template: rs.stage, yolo: v.stage }; }
  if (v.type) { if (!rec.match_type) { rec.match_type = v.type; rec.match_type_source = 'yolo'; if (powerFor) rec.power = powerFor(v.type); filled.push('match_type'); } else if (rec.match_type !== v.type) dis.match_type = { template: rec.match_type, yolo: v.type }; }
  if (Object.keys(dis).length) rs.yolo_disagree = dis;
  return filled;
}
