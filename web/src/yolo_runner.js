// D56: Worker 内で yolo_stats.onnx（結果画面の見出し用）を onnxruntime-web（WASM・単一スレッド）で動かす。読み込みは最初に必要になったときに 1 回。
import * as ort from 'onnxruntime-web/wasm';
import { preprocessHeader, decodeYolo, headerFromDetections, YOLO_SIZE, YOLO_CLASSES } from './core/yolo_header.js';
let sessionP = null, dirUrl = null;
export function configureYolo(assetsDir) { dirUrl = assetsDir; }
function getSession() {
  if (!sessionP) {
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmPaths = dirUrl + 'ort/';
    sessionP = ort.InferenceSession.create(dirUrl + 'yolo_stats.onnx', { executionProviders: ['wasm'] }).catch(e => { sessionP = null; throw e; });
  }
  return sessionP;
}
/** 前処理済みテンソル（preprocessHeader の結果）から見出しを読む。失敗したら null（解析は続ける） */
export async function readHeaderTensor(chw) {
  try {
    const s = await getSession(), out = await s.run({ images: new ort.Tensor('float32', chw, [1, 3, YOLO_SIZE, YOLO_SIZE]) });
    const o = out[s.outputNames[0]];
    return headerFromDetections(decodeYolo(o.data, YOLO_CLASSES.length, o.dims[2]));
  } catch (e) { console.warn('yolo header failed', e); return null; }
}
export { preprocessHeader };
