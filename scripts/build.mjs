import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { zlibSync } from 'fflate';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/icons', { recursive: true });
await cp('extension', 'dist', { recursive: true });
await build({ entryPoints: ['src/popup.js', 'src/background.js'], outdir: 'dist', bundle: true, format: 'esm', target: 'chrome120', legalComments: 'eof' });
await build({ entryPoints: ['src/collector.js'], outfile: 'dist/collector.js', bundle: true, format: 'iife', target: 'chrome120' });

// Deterministic local PNG icons; no remotely loaded code, fonts, or images.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function u32(number) { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(number >>> 0); return buffer; }
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return Buffer.concat([u32(data.length), bytes, u32((crc ^ 0xffffffff) >>> 0)]);
}
for (const size of [16, 48, 128]) {
  const data = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size; const dy = y / size;
      const arrow = (Math.abs(dx - .5) < .06 && dy > .21 && dy < .64)
        || (dy > .46 && dy < .72 && Math.abs(Math.abs(dx - .5) - (.72 - dy)) < .065)
        || (dy > .78 && dy < .84 && dx > .24 && dx < .76);
      const offset = y * (1 + size * 4) + 1 + x * 4;
      data.set(arrow ? [247, 248, 242, 255] : [27, 91, 68, 255], offset);
    }
  }
  const header = Buffer.concat([u32(size), u32(size), Buffer.from([8, 6, 0, 0, 0])]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(data)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(`dist/icons/${size}.png`, png);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', 'fflate 0.8.2 — Copyright (c) 2020 Arjun Barrett. MIT License.\n\n' + await (await import('node:fs/promises')).readFile('node_modules/fflate/LICENSE', 'utf8'));
console.log('Estensione pronta in dist/');
