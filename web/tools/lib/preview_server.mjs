import { spawn } from 'node:child_process';

let activeGroupPids = [];

function killGroup(pid, sig = 'SIGTERM') {
  try {
    process.kill(-pid, sig);
  } catch {
    // 例外は握りつぶす
  }
}

function killAllGroups() {
  for (const pid of activeGroupPids) {
    killGroup(pid, 'SIGTERM');
  }
  activeGroupPids = [];
}

process.on('exit', () => {
  killAllGroups();
});

process.on('SIGINT', () => {
  killAllGroups();
  process.exit(130);
});

process.on('SIGTERM', () => {
  killAllGroups();
  process.exit(143);
});

export function startPreview(port, cwd, { host, ...extraOptions } = {}) {
  const args = ['vite', 'preview', '--port', String(port), '--strictPort'];
  if (host) {
    args.push('--host');
    if (typeof host === 'string') {
      args.push(host);
    }
  }

  const child = spawn('npx', args, {
    cwd,
    stdio: 'ignore',
    detached: true,
    ...extraOptions
  });

  if (child.pid) {
    activeGroupPids.push(child.pid);
    child.on('exit', () => {
      activeGroupPids = activeGroupPids.filter(p => p !== child.pid);
    });
  }

  child.kill = (sig) => {
    const s = sig || 'SIGTERM';
    if (child.pid) {
      activeGroupPids = activeGroupPids.filter(p => p !== child.pid);
      killGroup(child.pid, s);
    }
    return true;
  };

  return child;
}

export async function waitForPort(port, timeoutMs = 15000) {
  const url = `http://127.0.0.1:${port}/`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if ((res.status >= 200 && res.status < 300) || res.status === 404) {
        return;
      }
    } catch {
      // 待機してリトライ
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`waitForPort timed out after ${timeoutMs}ms for port ${port}`);
}
