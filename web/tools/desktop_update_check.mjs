// desktop_update_check.mjs: デスクトップ版の自動アップデート（b21）の、画面側の文言と通知を出す条件
import { describeUpdate, shouldBanner } from '../src/desktop_update.js';
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
check(/インストールした版だけ/.test(describeUpdate({ status: 'disabled' })) && /インストールした版だけ/.test(describeUpdate(null)), '(1) 開発起動／ブラウザ版相当(disabled)では、無効と伝える');
check(describeUpdate({ status: 'none' }) === '最新の版です。', '(2) 更新が無ければ「最新」');
check(/v0\.1\.12/.test(describeUpdate({ status: 'ready', version: '0.1.12' })) && /再起動/.test(describeUpdate({ status: 'ready', version: '0.1.12' })), '(3) 準備ができたら、版と「再起動」を出す');
check(/録画が終わってから/.test(describeUpdate({ status: 'ready', version: '0.1.12', recording: true })), '(4) 録画中は、録画が終わってからと出す');
check(/45%/.test(describeUpdate({ status: 'downloading', version: '0.1.12', percent: 45.2 })), '(5) ダウンロード中は割合を出す');
check(/net down/.test(describeUpdate({ status: 'error', message: 'net down' })), '(6) 失敗したら理由を出す');
check(shouldBanner({ status: 'ready', recording: false }) && !shouldBanner({ status: 'ready', recording: true }) && !shouldBanner({ status: 'available' }) && !shouldBanner(null), '(7) 通知バナーは「準備ができていて、録画中でない」ときだけ');
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
