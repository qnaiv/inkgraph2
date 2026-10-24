import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { startPreview, waitForPort } from './lib/preview_server.mjs';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const DIST_DIR = path.join(WEB_DIR, 'dist');

if (!fs.existsSync(DIST_DIR)) {
  console.error('Error: web/dist が見つかりません。先に `npx vite build` を実行してください。');
  process.exit(1);
}

let passCount = 0;
let totalCount = 0;

function check(name, ok, detail = '') {
  totalCount++;
  if (ok) {
    passCount++;
    console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function findPids(pattern) {
  try {
    const out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).trim(); // sh を挟むと sh 自身が一致するので直接呼ぶ
    if (!out) return [];
    return out.split('\n').map(p => Number(p.trim())).filter(p => !isNaN(p) && p !== process.pid);
  } catch {
    return [];
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function cleanupPort(port) {
  for (const pid of findPids(`vite preview --port ${port}`)) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {}
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

const libPath = path.resolve(WEB_DIR, 'tools/lib/preview_server.mjs');
const libUrl = pathToFileURL(libPath).href;

// 0. 対照：従来どおり spawn して srv.kill() だけだと、子の node が残る（直す前の挙動の再現）
{
  const port0 = 4249;
  const old = spawn('npx', ['vite', 'preview', '--port', String(port0), '--strictPort'], { cwd: WEB_DIR, stdio: 'ignore' });
  try {
    await waitForPort(port0);
    old.kill();
    await new Promise(r => setTimeout(r, 1500));
    const left = findPids(`vite preview --port ${port0}`);
    console.log(`INFO 対照(従来の spawn+kill): 残ったプロセス ${left.length} 件${left.length ? '（直す前はこれが次のチェックの邪魔をしていた）' : ''}`);
  } catch (e) {
    console.log(`INFO 対照の実行に失敗: ${e.message}`);
  } finally {
    cleanupPort(port0);
  }
}

// 1. ポート 4250: startPreview -> waitForPort -> pgrep 確認 -> srv.kill() -> 1.5s 後に pgrep/port 確認
const port1 = 4250;
let srv1 = null;
try {
  srv1 = startPreview(port1, WEB_DIR);
  await waitForPort(port1);
  const pidsBefore = findPids(`vite preview --port ${port1}`);
  check('4250: server started and process found', pidsBefore.length > 0, `pids: ${pidsBefore.join(',')}`);

  srv1.kill();
  await new Promise(r => setTimeout(r, 1500));

  const pidsAfter = findPids(`vite preview --port ${port1}`);
  check('4250: no vite process after srv.kill()', pidsAfter.length === 0, `remaining pids: ${pidsAfter.join(',')}`);

  const portFree = await isPortAvailable(port1);
  check('4250: port is available after srv.kill()', portFree);
} catch (e) {
  check('4250: test error', false, e.message);
} finally {
  if (srv1) srv1.kill();
  cleanupPort(port1);
}

// 2. ポート 4251: node -e で startPreview -> process.exit(0) -> 終了後に vite が残らない (exit ハンドラ)
const port2 = 4251;
try {
  const code = `
    import { startPreview, waitForPort } from ${JSON.stringify(libUrl)};
    startPreview(${port2}, ${JSON.stringify(WEB_DIR)});
    await waitForPort(${port2});
    process.exit(0);
  `;
  execFileSync('node', ['--input-type=module', '-e', code], { stdio: 'ignore', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  const pidsAfter = findPids(`vite preview --port ${port2}`);
  check('4251: no vite process after parent process.exit(0)', pidsAfter.length === 0, `remaining pids: ${pidsAfter.join(',')}`);

  const portFree = await isPortAvailable(port2);
  check('4251: port is available after parent exit', portFree);
} catch (e) {
  check('4251: test error', false, e.message);
} finally {
  cleanupPort(port2);
}

// 3. ポート 4252: 子プロセスに SIGTERM を送って止めた場合の確認
const port3 = 4252;
let childProc = null;
try {
  const code = `
    import { startPreview, waitForPort } from ${JSON.stringify(libUrl)};
    startPreview(${port3}, ${JSON.stringify(WEB_DIR)});
    await waitForPort(${port3});
    await new Promise(() => {});
  `;
  childProc = spawn('node', ['--input-type=module', '-e', code], {
    stdio: 'ignore'
  });

  await waitForPort(port3);
  const pidsBefore = findPids(`vite preview --port ${port3}`);
  check('4252: server started for SIGTERM test', pidsBefore.length > 0, `pids: ${pidsBefore.join(',')}`);

  childProc.kill('SIGTERM');

  await new Promise(r => childProc.on('exit', r));
  await new Promise(r => setTimeout(r, 1500));

  const pidsAfter = findPids(`vite preview --port ${port3}`);
  check('4252: no vite process after SIGTERM', pidsAfter.length === 0, `remaining pids: ${pidsAfter.join(',')}`);

  const portFree = await isPortAvailable(port3);
  check('4252: port is available after SIGTERM', portFree);
} catch (e) {
  check('4252: test error', false, e.message);
} finally {
  if (childProc && childProc.pid) {
    try { childProc.kill('SIGKILL'); } catch {}
  }
  cleanupPort(port3);
}

// 終了判定
if (passCount === totalCount && totalCount > 0) {
  console.log(`ALL ${totalCount} PASS`);
  process.exit(0);
} else {
  console.log(`FAIL (${passCount}/${totalCount} passed)`);
  process.exit(1);
}
