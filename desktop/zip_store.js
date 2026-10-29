// 無圧縮（store）の ZIP を、ディスクへ順に書く。録画（MP4）は圧縮済みなので、そのまま入れる。メモリに全部は載せない。
// 4GiB を超えるファイル・全体は ZIP64 で書く（forceZip64 で小さくても ZIP64 にできる。テスト用）。
const fs = require('node:fs'), zlib = require('node:zlib');
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crcUpdate = (prev, buf) => { if (zlib.crc32) return zlib.crc32(buf, prev); let c = (prev ^ 0xFFFFFFFF) >>> 0; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const U32 = 0xFFFFFFFF, U16 = 0xFFFF, LIM = 0xFFFFFFFF;
const dosTime = d => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dosDate = d => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
const big = n => BigInt(n);

function writeAll(ws, buf) { return new Promise((res, rej) => { ws.write(buf, e => (e ? rej(e) : res())); }); }
async function fileCrc(p) { let crc = 0; await new Promise((res, rej) => { fs.createReadStream(p, { highWaterMark: 4 << 20 }).on('data', c => { crc = crcUpdate(crc, c); }).on('end', res).on('error', rej); }); return crc; }
async function copyFile(ws, p, onBytes) {
  await new Promise((res, rej) => { const rs = fs.createReadStream(p, { highWaterMark: 4 << 20 }); rs.on('data', c => { onBytes(c.length); if (!ws.write(c)) { rs.pause(); ws.once('drain', () => rs.resume()); } }); rs.on('end', res); rs.on('error', rej); ws.on('error', rej); });
}

/**
 * entries: [{ name, data: Buffer|Uint8Array|string } | { name, path }]（name は zip の中のパス。'/' 区切り）
 * onProgress({ done, total, name }): 書いたバイト数（total は全体）
 */
async function writeZip(outPath, entries, { onProgress = () => {}, forceZip64 = false } = {}) {
  const now = new Date(), tm = dosTime(now), dt = dosDate(now);
  const items = entries.map(e => {
    const name = Buffer.from(String(e.name).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    if (e.path) { const st = fs.statSync(e.path); return { name, path: e.path, size: st.size }; }
    const data = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data.buffer ? Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength) : e.data);
    return { name, data, size: data.length };
  });
  const total = items.reduce((s, x) => s + x.size, 0); let done = 0, offset = 0;
  const tmp = outPath + '.part', ws = fs.createWriteStream(tmp);
  const wr = async buf => { await writeAll(ws, buf); offset += buf.length; };
  const central = [];
  try {
    for (const it of items) {
      it.crc = it.data ? crcUpdate(0, it.data) : await fileCrc(it.path);
      it.z64 = forceZip64 || it.size >= LIM; it.off = offset; it.z64off = it.off >= LIM; // 中央ディレクトリで、オフセットだけ ZIP64 が要ることがある
      const extra = it.z64 ? (() => { const b = Buffer.alloc(20); b.writeUInt16LE(1, 0); b.writeUInt16LE(16, 2); b.writeBigUInt64LE(big(it.size), 4); b.writeBigUInt64LE(big(it.size), 12); return b; })() : Buffer.alloc(0);
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(it.z64 ? 45 : 20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(tm, 10); h.writeUInt16LE(dt, 12);
      h.writeUInt32LE(it.crc, 14); h.writeUInt32LE(it.z64 ? U32 : it.size, 18); h.writeUInt32LE(it.z64 ? U32 : it.size, 22); h.writeUInt16LE(it.name.length, 26); h.writeUInt16LE(extra.length, 28);
      await wr(Buffer.concat([h, it.name, extra]));
      if (it.data) { await wr(it.data); done += it.size; } else { await copyFile(ws, it.path, n => { done += n; offset += n; onProgress({ done, total, name: it.name.toString() }); }); }
      onProgress({ done, total, name: it.name.toString() });
      central.push(it);
    }
    const cdStart = offset;
    for (const it of central) {
      const fields = []; if (it.z64) { fields.push(big(it.size), big(it.size)); } if (it.z64off) fields.push(big(it.off));
      let extra = Buffer.alloc(0); if (fields.length) { extra = Buffer.alloc(4 + fields.length * 8); extra.writeUInt16LE(1, 0); extra.writeUInt16LE(fields.length * 8, 2); fields.forEach((v, i) => extra.writeBigUInt64LE(v, 4 + i * 8)); }
      const need64 = it.z64 || it.z64off, c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(need64 ? 45 : 20, 4); c.writeUInt16LE(need64 ? 45 : 20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(tm, 12); c.writeUInt16LE(dt, 14);
      c.writeUInt32LE(it.crc, 16); c.writeUInt32LE(it.z64 ? U32 : it.size, 20); c.writeUInt32LE(it.z64 ? U32 : it.size, 24); c.writeUInt16LE(it.name.length, 28); c.writeUInt16LE(extra.length, 30); c.writeUInt32LE(it.z64off ? U32 : it.off, 42);
      await wr(Buffer.concat([c, it.name, extra]));
    }
    const cdSize = offset - cdStart, n = central.length, need64 = forceZip64 || cdStart >= LIM || cdSize >= LIM || n >= U16;
    if (need64) {
      const e64 = Buffer.alloc(56); e64.writeUInt32LE(0x06064b50, 0); e64.writeBigUInt64LE(44n, 4); e64.writeUInt16LE(45, 12); e64.writeUInt16LE(45, 14); e64.writeUInt32LE(0, 16); e64.writeUInt32LE(0, 20);
      e64.writeBigUInt64LE(big(n), 24); e64.writeBigUInt64LE(big(n), 32); e64.writeBigUInt64LE(big(cdSize), 40); e64.writeBigUInt64LE(big(cdStart), 48);
      const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); loc.writeUInt32LE(0, 4); loc.writeBigUInt64LE(big(offset), 8); loc.writeUInt32LE(1, 16);
      await wr(Buffer.concat([e64, loc]));
    }
    const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(need64 ? U16 : n, 8); eo.writeUInt16LE(need64 ? U16 : n, 10); eo.writeUInt32LE(need64 ? U32 : cdSize, 12); eo.writeUInt32LE(need64 ? U32 : cdStart, 16);
    await wr(eo);
    await new Promise((res, rej) => ws.end(e => (e ? rej(e) : res())));
    fs.renameSync(tmp, outPath);
    return { path: outPath, bytes: offset, files: n };
  } catch (e) { try { ws.destroy(); fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } throw e; }
}
module.exports = { writeZip };
