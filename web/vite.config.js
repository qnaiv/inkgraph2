import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// 起動中のバージョン表示用（src/version.js）。git が無い環境では commit は 'unknown'
const git = (args, fallback) => { try { return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback; } catch { return fallback; } };
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ command }) => {
  const sha = git('rev-parse --short=7 HEAD', '');
  const commit = sha ? sha + (git('status --porcelain', '') ? '+' : '') : 'unknown'; // '+' は未コミットの変更あり
  return {
    base: './', worker: { format: 'es' }, server: { host: '127.0.0.1', port: 5173 }, preview: { port: 4173 },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_COMMIT__: JSON.stringify(commit),
      __APP_BUILT__: JSON.stringify(new Date().toISOString()),
      __APP_DEV__: JSON.stringify(command === 'serve')
    }
  };
});
