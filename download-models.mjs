import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';

const models = {
  'u2netp': '8e83ca70e441ab06c318d82300c84806',
  'isnet-general-use': 'fc16ebd8b0c10d971d3513d564d01e29',
};
const dest = new URL('./public/models/', import.meta.url);
await mkdir(dest, { recursive: true });
for (const [name, expected] of Object.entries(models)) {
  const file = new URL(`${name}.onnx`, dest);
  const digest = data => createHash('md5').update(data).digest('hex');
  try { if (digest(await readFile(file)) === expected) { console.log(`${name}: verified`); continue; } } catch {}
  try {
    const local = new URL(`./local-models/${name}.onnx`, import.meta.url);
    if (digest(await readFile(local)) === expected) { await copyFile(local, file); console.log(`${name}: copied and verified`); continue; }
  } catch {}
  console.log(`Downloading ${name} from the official rembg release...`);
  const response = await fetch(`https://github.com/danielgatis/rembg/releases/download/v0.0.0/${name}.onnx`, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error(`Checksum mismatch: ${name}`);
  const part = new URL(`${name}.part`, dest);
  await writeFile(part, bytes);
  await rename(part, file);
  console.log(`${name}: downloaded and verified`);
}
