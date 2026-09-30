import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist/models');
await mkdir(root, { recursive: true });
const manifest = { version: 1, models: {} };
for (const name of ['u2netp', 'isnet-general-use']) {
  const file = path.join(root, `${name}.onnx`), bytes = await readFile(file);
  const parts = [];
  for (let start = 0, index = 0; start < bytes.length; start += 4 * 1024 ** 2, index++) {
    const data = bytes.subarray(start, Math.min(bytes.length, start + 4 * 1024 ** 2));
    const sha256 = createHash('sha256').update(data).digest('hex');
    const partFile = `${name}.${String(index).padStart(2, '0')}.${sha256.slice(0, 12)}.bin`;
    await writeFile(path.join(root, partFile), data);
    parts.push({ file: partFile, bytes: data.length, sha256 });
  }
  manifest.models[name] = { bytes: bytes.length, parts };
  // Only remove the known generated model file inside this build output.
  if (path.dirname(file) !== root) throw new Error('Unexpected build target');
  await unlink(file);
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
console.log('Model assets split into verified 4 MB parts.');
