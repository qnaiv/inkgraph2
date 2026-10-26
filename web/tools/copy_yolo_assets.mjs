// ビルド前に、onnxruntime-web の WASM と、リポジトリ直下の yolo_stats.onnx を web/public/assets/ にコピーする（D56）。コピーは git に入れない。
import fs from 'node:fs'; import path from 'node:path';
const WEB = path.resolve(import.meta.dirname, '..'), OUT = path.join(WEB, 'public/assets'), ORT = path.join(OUT, 'ort');
fs.mkdirSync(ORT, { recursive: true });
const dist = path.join(WEB, 'node_modules/onnxruntime-web/dist');
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) fs.copyFileSync(path.join(dist, f), path.join(ORT, f));
const model = path.resolve(WEB, '../yolo_stats.onnx');
if (fs.existsSync(model)) fs.copyFileSync(model, path.join(OUT, 'yolo_stats.onnx')); else console.warn('yolo_stats.onnx が見つかりません（見出しの YOLO 読み取りは無効になります）:', model);
console.log('copied yolo assets to', OUT);
