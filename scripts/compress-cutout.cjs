const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const publicDir = path.join(__dirname, '..', 'public');
const target = path.join(publicDir, 'cutout-compressed');
fs.mkdirSync(target, { recursive: true });
for (const [folder, name] of [
  ['models', 'u2netp.onnx'],
  ['runtime', 'ort-wasm-simd-threaded.wasm'],
  ['runtime', 'ort-wasm-simd-threaded.mjs'],
]) {
  const input = fs.readFileSync(path.join(publicDir, folder, name));
  const compressed = zlib.gzipSync(input, { level: 9 });
  fs.writeFileSync(path.join(target, name + '.gz'), compressed);
  console.log(`${name}: ${input.length} -> ${compressed.length} bytes`);
}
