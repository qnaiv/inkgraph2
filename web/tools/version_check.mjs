// version_check.mjs: 起動中のバージョン表示（整形と、define が無い環境での unknown）
import { formatVersion, currentVersion } from '../src/version.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
check(formatVersion({ version: '1.0.0', commit: 'abc1234', builtAt: '2026-11-02T09:00:00.000Z' }) === 'v1.0.0 (abc1234, 2026-11-02)', '(1) 通常: v版 (コミット, 日付)');
check(formatVersion({ version: '1.0.0', commit: 'abc1234+', builtAt: '2026-11-02T09:00:00Z', dev: true }) === 'v1.0.0 (dev, abc1234+, 2026-11-02)', '(2) 開発起動は dev と分かる。+ は未コミットの変更あり');
check(formatVersion({ version: '1.0.0', commit: 'abc1234', builtAt: '2026-11-02T09:00:00Z', desktop: '0.1.0' }).endsWith('／デスクトップ v0.1.0'), '(3) デスクトップ版は、本体のバージョンも併記');
check(formatVersion() === 'バージョン不明 (unknown, unknown)', '(4) 値が無くても落ちず unknown', formatVersion());
check(formatVersion({ version: '1.0.0', commit: 'abc', builtAt: 'x' }).includes('unknown'), '(5) 日付が壊れていれば unknown');
check(currentVersion() === 'バージョン不明 (unknown, unknown)', '(6) define が無い環境（テスト）でも unknown で動く', currentVersion());
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
