import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const assets: Record<string, { folder: string; type: string }> = {
  'u2netp.onnx': { folder: 'models', type: 'application/octet-stream' },
  'ort-wasm-simd-threaded.wasm': { folder: 'runtime', type: 'application/wasm' },
  'ort-wasm-simd-threaded.mjs': { folder: 'runtime', type: 'text/javascript' },
};

// Versioned, allowlisted assets. Browsers decompress gzip before ONNX loads
// the bytes; the same runtime works without transferring the full 14 MB WASM.
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const asset = assets[name];
  if (!asset) return new Response('Not found', { status: 404 });
  const gzip = /\bgzip\b/.test(request.headers.get('accept-encoding') || '');
  const file = gzip
    ? path.join(process.cwd(), 'public', 'cutout-compressed', name + '.gz')
    : path.join(process.cwd(), 'public', asset.folder, name);
  const bytes = await readFile(file);
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': asset.type,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Vary': 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  } });
}
