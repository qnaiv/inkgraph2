// zip_store_check.js: 無圧縮 ZIP の書き出し（通常・ZIP64 強制）を、Python の zipfile と unzip で検証する
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFileSync, spawnSync } = require('node:child_process');
const { writeZip } = require('../zip_store.js');
let fails = 0; const check = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); if (!ok) fails++; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-')), big = path.join(tmp, '動画 1.mp4');
  const buf = Buffer.alloc(9 * 1024 * 1024); for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + (i >> 8)) & 255; fs.writeFileSync(big, buf);
  const entries = [{ name: 'INDEX.json', data: '{"a":1}' }, { name: 'matches/日本語/diff.json', data: Buffer.from('{"か":"き"}') }, { name: 'matches/日本語/video/動画 1.mp4', path: big }, { name: 'empty.txt', data: '' }];
  const py = (zip) => spawnSync('python3', ['-I', '-c', `import zipfile,sys,zlib,hashlib\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nn=z.namelist()\nprint('|'.join(n))\nprint(hashlib.md5(z.read('matches/日本語/video/動画 1.mp4')).hexdigest())\nprint(z.read('matches/日本語/diff.json').decode())`, zip], { encoding: 'utf8' });
  const md5 = require('node:crypto').createHash('md5').update(buf).digest('hex');
  for (const z64 of [false, true]) {
    const out = path.join(tmp, z64 ? 'z64.zip' : 'plain.zip'); let last = 0;
    const r = await writeZip(out, entries, { forceZip64: z64, onProgress: p => { last = p.done; } });
    const p = py(out), lines = (p.stdout || '').split('\n');
    check(p.status === 0 && lines[0] === entries.map(e => e.name).join('|') && lines[1] === md5 && lines[2] === '{"か":"き"}', `(${z64 ? 2 : 1}) ${z64 ? 'ZIP64 強制' : '通常'}: Python の zipfile で全件読めて、動画の中身が一致する`, (p.stderr || '').slice(0, 200));
    const u = spawnSync('unzip', ['-tq', out], { encoding: 'utf8' }); check(u.status === 0 || u.error, `(${z64 ? 4 : 3}) unzip -t が通る`, (u.stdout || u.stderr || String(u.error || '')).trim().slice(0, 120));
    check(r.files === 4 && last === buf.length + 7 + Buffer.byteLength('{"か":"き"}') && !fs.existsSync(out + '.part'), `(${z64 ? 6 : 5}) 件数・進み具合・一時ファイルの後始末`, JSON.stringify({ files: r.files, last }));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `FAIL ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
