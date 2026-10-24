// Verification of hoko guard functions and constants (isTowerRule, MODE_MARGIN, STAGE_DX_BY_MODE)
import { isTowerRule } from '../src/core/analyzer.js';
import { MODE_MARGIN, STAGE_DX_BY_MODE } from '../src/core/result.js';

let failed = false;

function assert(cond, desc) {
  if (cond) {
    console.log(`[PASS] ${desc}`);
  } else {
    console.error(`[FAIL] ${desc}`);
    failed = true;
  }
}

console.log('=== Hoko Guard Verification ===');

// isTowerRule tests
assert(isTowerRule('ガチヤグラ') === true, "isTowerRule('ガチヤグラ') === true");
assert(isTowerRule('ガチホコバトル') === false, "isTowerRule('ガチホコバトル') === false");
assert(isTowerRule('ガチエリア') === false, "isTowerRule('ガチエリア') === false");
assert(isTowerRule('ガチアサリ') === false, "isTowerRule('ガチアサリ') === false");
assert(isTowerRule(null) === false, "isTowerRule(null) === false");
assert(isTowerRule(undefined) === false, "isTowerRule(undefined) === false");
assert(isTowerRule('') === false, "isTowerRule('') === false");

// MODE_MARGIN tests
assert(MODE_MARGIN === 0.1, `MODE_MARGIN === 0.1 (got ${MODE_MARGIN})`);

// STAGE_DX_BY_MODE tests
assert(typeof STAGE_DX_BY_MODE === 'object' && STAGE_DX_BY_MODE !== null, 'STAGE_DX_BY_MODE is object');
assert(STAGE_DX_BY_MODE['ガチホコバトル'] === 38, `STAGE_DX_BY_MODE['ガチホコバトル'] === 38 (got ${STAGE_DX_BY_MODE['ガチホコバトル']})`);
assert(STAGE_DX_BY_MODE['ガチヤグラ'] === undefined, "STAGE_DX_BY_MODE['ガチヤグラ'] is undefined (shift 0)");

console.log('===============================');
if (failed) {
  console.error('FAIL: One or more checks failed.');
  process.exit(1);
} else {
  console.log('SUCCESS: All hoko guard checks passed.');
}
